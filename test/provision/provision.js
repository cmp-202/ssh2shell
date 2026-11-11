'use strict';

// Rebuild a live-test VM from a fresh Ubuntu install.
//
// This is a live test: it logs into the target with ssh2shell and applies the
// same hostname, static address, users, sudo rules, SSH keys, and sshd config
// as the existing 192.168.44.0/24 test VMs.
//
// Run it from the repository root:
//   node test/provision/provision.js server1
//
// Before the first run the VM needs SSH access. Install and update it with a
// bridged or NAT adapter, then switch Adapter 1 to the host-only network and
// note its DHCP address. See test/provision/README.md ("Quick start") for the
// exact VirtualBox and console commands.
//
// See test/provision/README.md for the full environment list.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..', '..');

// Provisioning config lives next to this script so the per-host addresses and
// bootstrap credentials can be changed without editing code. Load it before
// the repository .env: dotenv keeps the first value it sees, so the
// provisioning file wins and the root .env fills in the live-test passwords.
const provisionEnvPath = path.join(__dirname, '.env');
if (fs.existsSync(provisionEnvPath)) {
  require('dotenv').config({ path: provisionEnvPath });
}
require('dotenv').config({ path: path.join(repoRoot, '.env') });

const SSH2Shell = require(path.join(repoRoot, 'src', 'ssh2shell'));
const { logFile, log } = require(path.join(repoRoot, 'test', 'utils', 'logging.js'));

const ROLE_NAME = (process.argv[2] || process.env.PROVISION_ROLE || 'server1').toLowerCase();

const ROLES = {
  server1: {
    hostname: 'server1',
    ip: '192.168.44.10',
    interfaceName: 'enp0s3',
    users: ['andrew', 'tester', 'nopasswd', 'suuser', 'kbduser'],
    sudoUsers: ['andrew', 'tester', 'nopasswd'],
    hopKeyUsers: ['tester', 'nopasswd', 'suuser'],
    nopasswdSudo: false,
    hasKbdUser: true,
    challengeResponse: 'yes',
  },
  server2: {
    hostname: 'server2',
    ip: '192.168.44.11',
    interfaceName: 'enp0s3',
    users: ['andrew', 'tester', 'nopasswd', 'suuser'],
    sudoUsers: ['andrew', 'tester', 'nopasswd'],
    hopKeyUsers: ['tester', 'nopasswd', 'suuser'],
    nopasswdSudo: true,
    hasKbdUser: false,
    challengeResponse: 'no',
  },
  server3: {
    hostname: 'server3',
    ip: '192.168.44.12',
    interfaceName: 'enp0s3',
    users: ['andrew', 'tester', 'nopasswd', 'suuser'],
    sudoUsers: ['andrew', 'tester', 'nopasswd'],
    hopKeyUsers: ['tester', 'nopasswd', 'suuser'],
    nopasswdSudo: false,
    hasKbdUser: false,
    challengeResponse: 'no',
  },
};

const roleDefaults = ROLES[ROLE_NAME];
if (!roleDefaults) {
  console.error(`Unknown role: ${ROLE_NAME}`);
  console.error(`Choose one of: ${Object.keys(ROLES).join(', ')}`);
  process.exit(1);
}

// Per-role variables such as PROVISION_SERVER1_USER override the generic
// PROVISION_* variables and the built-in defaults.
function roleEnv(name) {
  return (
    process.env[`PROVISION_${ROLE_NAME.toUpperCase()}_${name}`] ||
    process.env[`PROVISION_${name}`]
  );
}

const role = {
  ...roleDefaults,
  hostname: roleEnv('HOSTNAME') || roleDefaults.hostname,
  ip: roleEnv('IP') || roleDefaults.ip,
  interfaceName: roleEnv('INTERFACE') || roleDefaults.interfaceName,
};

logFile(`provision-${ROLE_NAME}.js`);
const logPath = path.join(repoRoot, 'test', 'logs', `provision-${ROLE_NAME}.js.log`);

function resolvePath(value) {
  return path.resolve(value.replace(/^~(?=$|[\\/])/, os.homedir()));
}

function readRequiredFile(label, filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`${label} not found: ${filePath}`);
    process.exit(1);
  }
  return fs.readFileSync(filePath, 'utf8');
}

// The test key is always needed: it is installed for the test users and copied
// to the hop users so nested `ssh -i` connections work.
const testPrivateKeyPath = resolvePath(
  process.env.TEST_PRIVATE_KEY_PATH ||
    process.env.PRIVATE_KEY_PATH ||
    path.join(repoRoot, 'test', 'certs', 'test_ed25519')
);
const testPublicKeyPath = process.env.TEST_PUBLIC_KEY_PATH
  ? resolvePath(process.env.TEST_PUBLIC_KEY_PATH)
  : `${testPrivateKeyPath}.pub`;
const adminPublicKeyPath = resolvePath(
  process.env.ADMIN_PUBLIC_KEY_PATH ||
    path.join(repoRoot, 'test', 'certs', 'admin_ed25519.pub')
);

const testPrivateKey = readRequiredFile('Test private key', testPrivateKeyPath);
const testPublicKey = readRequiredFile('Test public key', testPublicKeyPath);
const adminPublicKey = readRequiredFile('Admin public key', adminPublicKeyPath);

const loginUser = roleEnv('USER') || process.env.USER_NAME;
if (!loginUser) {
  console.error(
    `Set PROVISION_${ROLE_NAME.toUpperCase()}_USER, PROVISION_USER, or USER_NAME for the bootstrap login.`
  );
  process.exit(1);
}

// The test key is the default only for the normal test login. A fresh-install
// account such as ubuntu needs its own password or an explicitly configured
// key. Set PROVISION_<ROLE>_KEY_PATH=none to force password auth.
const bootstrapKeySetting = roleEnv('KEY_PATH');
let bootstrapKeyPath = null;
if (bootstrapKeySetting !== 'none') {
  const keyPath =
    bootstrapKeySetting ||
    (loginUser === process.env.USER_NAME ? testPrivateKeyPath : '');
  if (keyPath) {
    bootstrapKeyPath = resolvePath(keyPath);
  }
}

const loginPassword =
  roleEnv('PASSWORD') ||
  (loginUser === process.env.USER_NAME ? process.env.PASSWORD : undefined);

if (!loginPassword && !bootstrapKeyPath) {
  console.error(
    `Set PROVISION_${ROLE_NAME.toUpperCase()}_PASSWORD or PROVISION_${ROLE_NAME.toUpperCase()}_KEY_PATH for the bootstrap login.`
  );
  process.exit(1);
}

const sudoPassword =
  roleEnv('SUDO_PASSWORD') ||
  loginPassword ||
  process.env.PASSWORD;

const b64 = (value) => Buffer.from(value, 'utf8').toString('base64');

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

// Create or truncate a file with the requested mode/owner, then write the
// content through base64 so passwords and keys never appear as bare text in
// the session log.
function installFile(file, content, mode, owner) {
  const normalized = content.endsWith('\n') ? content : `${content}\n`;
  return [
    `sudo install -m ${mode} -o ${owner} -g ${owner} /dev/null ${shellQuote(file)}`,
    `echo '${b64(normalized)}' | base64 -d | sudo tee ${shellQuote(file)} >/dev/null`,
    `sudo chown ${owner}:${owner} ${shellQuote(file)}`,
    `sudo chmod ${mode} ${shellQuote(file)}`,
  ];
}

function ensureSshDir(user) {
  return [
    `sudo install -d -m 700 -o ${user} -g ${user} /home/${user}/.ssh`,
    `sudo chown ${user}:${user} /home/${user}/.ssh`,
    `sudo chmod 700 /home/${user}/.ssh`,
  ];
}

function buildCommands() {
  const commands = [];

  const passwords = {
    tester: process.env.PASSWORD,
    nopasswd: process.env.NOPASSWD_PASSWORD,
    suuser: process.env.SECOND_USER_PASSWORD,
  };
  if (role.hasKbdUser) {
    passwords.kbduser = process.env.KBD_PASSWORD;
  }

  const missing = Object.entries(passwords)
    .filter(([, value]) => !value)
    .map(([user]) => user);
  if (missing.length > 0) {
    console.error(`Missing passwords for: ${missing.join(', ')}`);
    console.error(
      'Set PASSWORD, NOPASSWD_PASSWORD, SECOND_USER_PASSWORD, and KBD_PASSWORD (server1) in .env.'
    );
    process.exit(1);
  }

  const passwordLines = Object.entries(passwords).map(
    ([user, password]) => `${user}:${password}`
  );
  if (process.env.ANDREW_PASSWORD) {
    passwordLines.unshift(`andrew:${process.env.ANDREW_PASSWORD}`);
  }

  commands.push(
    `echo "=== ssh2shell provision ${ROLE_NAME} (${role.hostname}) -> ${role.ip} ==="`
  );
  commands.push('id');
  commands.push('sudo -v');

  // /etc/hosts is updated before the hostname changes so sudo does not warn
  // about an unresolvable host.
  commands.push(
    `grep -qE '^127\\.0\\.1\\.1[[:space:]]+${role.hostname}([[:space:]]|$)' /etc/hosts || ` +
      `echo '127.0.1.1 ${role.hostname}' | sudo tee -a /etc/hosts >/dev/null`
  );
  commands.push(`sudo hostnamectl set-hostname ${role.hostname}`);

  for (const user of role.users) {
    commands.push(
      `id -u ${user} >/dev/null 2>&1 || sudo useradd -m -U -s /bin/bash ${user}`
    );
  }

  commands.push(
    `echo '${b64(`${passwordLines.join('\n')}\n`)}' | base64 -d | sudo chpasswd`
  );

  for (const user of role.sudoUsers) {
    commands.push(`sudo usermod -aG sudo ${user}`);
  }
  for (const user of role.users.filter((name) => !role.sudoUsers.includes(name))) {
    commands.push(`sudo gpasswd -d ${user} sudo >/dev/null 2>&1 || true`);
  }
  // Remove the old shared test account from sudo if it still exists.
  commands.push('sudo gpasswd -d user sudo >/dev/null 2>&1 || true');

  const nopasswdFile = '/etc/sudoers.d/90-ssh2shell-nopasswd';
  if (role.nopasswdSudo) {
    commands.push(
      ...installFile(
        nopasswdFile,
        'nopasswd ALL=(ALL) NOPASSWD:ALL',
        440,
        'root'
      )
    );
  } else {
    commands.push(`sudo rm -f ${nopasswdFile}`);
  }

  // Remove the legacy `user ALL=(ALL) NOPASSWD:ALL` line and validate the
  // result. If validation fails, put the original backup back. `cp -n` keeps
  // the first backup across re-runs.
  commands.push('sudo cp -n /etc/sudoers /etc/sudoers.ssh2shell-bak');
  commands.push(
    `sudo sed -i '/^user[[:space:]]\\+ALL=(ALL)[[:space:]]\\+NOPASSWD:ALL[[:space:]]*$/d' /etc/sudoers`
  );
  commands.push('sudo chown root:root /etc/sudoers');
  commands.push('sudo chmod 440 /etc/sudoers');
  // The check markers are expanded from a variable so the command text in the
  // session log does not contain the literal marker. That lets the callback
  // distinguish real command output from the echoed command.
  commands.push(
    'CHECK=SUDOERS; if sudo visudo -c; then echo "SSH2SHELL_${CHECK}_OK"; ' +
      'else sudo cp /etc/sudoers.ssh2shell-bak /etc/sudoers && ' +
      'sudo chown root:root /etc/sudoers && sudo chmod 440 /etc/sudoers && ' +
      'echo "SSH2SHELL_${CHECK}_RESTORED"; fi'
  );

  for (const user of role.users) {
    const key = user === 'andrew' ? adminPublicKey : testPublicKey;
    commands.push(...ensureSshDir(user));
    commands.push(
      ...installFile(`/home/${user}/.ssh/authorized_keys`, key.trim(), 600, user)
    );
  }
  for (const user of role.hopKeyUsers) {
    commands.push(
      ...installFile(
        `/home/${user}/.ssh/id_ed25519`,
        testPrivateKey.trim(),
        600,
        user
      )
    );
    commands.push(
      ...installFile(
        `/home/${user}/.ssh/id_ed25519.pub`,
        testPublicKey.trim(),
        644,
        user
      )
    );
  }

  // sshd: password auth stays available for the test users; keyboard-interactive
  // is enabled only where kbduser exists, and the Match block is kept last.
  //
  // OpenSSH 8.7 renamed ChallengeResponseAuthentication to
  // KbdInteractiveAuthentication. Older releases accept the new name in
  // `sshd -t` but ignore it, so pick the directive that actually works on this
  // release. Ubuntu 18.04 needs the old name; Ubuntu 26.04 needs the new one.
  //
  // Ubuntu cloud images put `PasswordAuthentication no` in
  // /etc/ssh/sshd_config.d/*.conf. That Include is processed before the main
  // file and sshd keeps the first value it sees, so the drop-ins have to be
  // updated as well.
  commands.push(
    'sudo cp -n /etc/ssh/sshd_config /etc/ssh/sshd_config.ssh2shell-bak'
  );
  commands.push(
    'V=$(ssh -V 2>&1); ' +
      'M=$(echo "$V" | sed -n \'s/^OpenSSH_\\([0-9][0-9]*\\)\\.\\([0-9][0-9]*\\).*/\\1/p\'); ' +
      'N=$(echo "$V" | sed -n \'s/^OpenSSH_\\([0-9][0-9]*\\)\\.\\([0-9][0-9]*\\).*/\\2/p\'); ' +
      'if [ -n "$M" ] && { [ "$M" -lt 8 ] || { [ "$M" -eq 8 ] && [ "$N" -lt 7 ]; }; }; then ' +
      'D=ChallengeResponseAuthentication; else D=KbdInteractiveAuthentication; fi; ' +
      'echo "$D" | sudo tee /tmp/ssh2shell-kbd-directive >/dev/null; echo "ssh2shell: $D"'
  );
  commands.push(
    'KBD=$(sudo cat /tmp/ssh2shell-kbd-directive); ' +
      'for f in /etc/ssh/sshd_config.d/*.conf; do [ -e "$f" ] || continue; ' +
      'sudo sed -i -E "s/^#?[[:space:]]*PasswordAuthentication[[:space:]].*/PasswordAuthentication yes/" "$f"; ' +
      'sudo sed -i -E "s/^#?[[:space:]]*(ChallengeResponseAuthentication|KbdInteractiveAuthentication)[[:space:]].*/${KBD} ' +
      role.challengeResponse +
      '/" "$f"; ' +
      'done'
  );
  commands.push(
    'KBD=$(sudo cat /tmp/ssh2shell-kbd-directive); ' +
      'sudo sed -i -E "s/^#?[[:space:]]*PasswordAuthentication[[:space:]].*/PasswordAuthentication yes/" /etc/ssh/sshd_config; ' +
      'sudo sed -i -E "s/^#?[[:space:]]*(ChallengeResponseAuthentication|KbdInteractiveAuthentication)[[:space:]].*/${KBD} ' +
      role.challengeResponse +
      '/" /etc/ssh/sshd_config'
  );
  commands.push(
    `grep -qE '^[[:space:]]*PasswordAuthentication[[:space:]]' /etc/ssh/sshd_config || ` +
      `echo 'PasswordAuthentication yes' | sudo tee -a /etc/ssh/sshd_config >/dev/null`
  );
  commands.push(
    'KBD=$(sudo cat /tmp/ssh2shell-kbd-directive); ' +
      'grep -qE "^[[:space:]]*${KBD}[[:space:]]" /etc/ssh/sshd_config || ' +
      'echo "${KBD} ' +
      role.challengeResponse +
      '" | sudo tee -a /etc/ssh/sshd_config >/dev/null'
  );
  commands.push(`sudo sed -i '/^Match User kbduser$/,+1d' /etc/ssh/sshd_config`);
  if (role.hasKbdUser) {
    commands.push(
      `printf '\\nMatch User kbduser\\n    PasswordAuthentication no\\n' | sudo tee -a /etc/ssh/sshd_config >/dev/null`
    );
  }
  commands.push('sudo chmod 644 /etc/ssh/sshd_config');
  commands.push(
    'CHECK=SSHD; if sudo sshd -t; then ' +
      '(sudo systemctl reload ssh 2>/dev/null || sudo service ssh reload) && ' +
      'echo "SSH2SHELL_${CHECK}_OK" || echo "SSH2SHELL_${CHECK}_RELOAD_FAILED"; ' +
      'else sudo cp /etc/ssh/sshd_config.ssh2shell-bak /etc/ssh/sshd_config; ' +
      'echo "SSH2SHELL_${CHECK}_RESTORED"; fi'
  );

  // A fresh install already has a unique machine-id. Set
  // PROVISION_<ROLE>_REGENERATE_MACHINE_ID=true when the VM was cloned from
  // another VM and still shares its source id.
  if (roleEnv('REGENERATE_MACHINE_ID') === 'true') {
    commands.push('sudo install -d -m 755 /var/lib/dbus');
    commands.push('sudo rm -f /etc/machine-id /var/lib/dbus/machine-id');
    commands.push('sudo systemd-machine-id-setup');
    commands.push('sudo cp /etc/machine-id /var/lib/dbus/machine-id');
    commands.push('sudo chmod 444 /etc/machine-id');
  }

  commands.push('hostname');
  commands.push('hostname -I');
  commands.push(`getent passwd ${role.users.join(' ')}`);
  commands.push('getent group sudo');
  commands.push('sudo -n -l -U nopasswd 2>&1 || true');
  commands.push('sudo sshd -t && echo SSH2SHELL_SSHD_VERIFY_OK');
  commands.push('sudo visudo -c');
  commands.push('cat /etc/machine-id');
  commands.push(
    'sudo ls -la /home/tester/.ssh /home/nopasswd/.ssh /home/suuser/.ssh 2>&1'
  );
  if (role.hasKbdUser) {
    commands.push('sudo ls -la /home/kbduser/.ssh 2>&1');
  }
  // Show whichever network configuration this release uses. One of these
  // files will not exist; the diagnostics are best effort.
  commands.push('cat /etc/network/interfaces 2>/dev/null || true');
  commands.push('sudo cat /etc/netplan/*.yaml 2>/dev/null || true');

  // Static network last: changing it can drop the current SSH session.
  //
  // Ubuntu 18.04 uses ifupdown and Ubuntu 26.04 uses netplan. Detect the stack
  // at runtime so the same script works on both. The config is written and
  // validated first; the actual apply runs in the background because it can
  // drop this session. If the static address does not come up, the previous
  // config is restored so the VM stays reachable.
  const applyNetwork = (roleEnv('APPLY_NETWORK') || 'true') !== 'false';
  // Use the absolute path because a non-login SSH session may not have
  // /sbin or /usr/sbin in PATH. /sbin resolves through usrmerge on newer
  // releases.
  const interfaceUp =
    `/sbin/ip -4 addr show dev ${role.interfaceName} 2>/dev/null | grep -qw ${role.ip}`;

  const ifupdownConfig = [
    '# This file describes the network interfaces available on your system',
    '# and how to activate them. For more information, see interfaces(5).',
    '',
    'source /etc/network/interfaces.d/*',
    '',
    '# The loopback network interface',
    'auto lo',
    'iface lo inet loopback',
    '',
    '# The primary network interface (static, host-only network)',
    `auto ${role.interfaceName}`,
    `iface ${role.interfaceName} inet static`,
    `    address ${role.ip}`,
    '    netmask 255.255.255.0',
  ].join('\n');

  const netplanConfig = [
    'network:',
    '  version: 2',
    '  ethernets:',
    `    ${role.interfaceName}:`,
    '      dhcp4: false',
    '      dhcp6: false',
    '      addresses:',
    `        - ${role.ip}/24`,
    '      optional: true',
  ].join('\n');

  const ifupdownBranch = [
    'sudo cp -n /etc/network/interfaces /etc/network/interfaces.dhcp-backup',
    `echo '${b64(`${ifupdownConfig}\n`)}' | base64 -d | sudo tee /etc/network/interfaces >/dev/null`,
    `if sudo ifquery ${role.interfaceName} >/dev/null 2>&1; then :`,
    'echo "SSH2SHELL_${NET_CHECK}_OK"',
    ...(applyNetwork
      ? [
          `if ! ${interfaceUp}; then sudo nohup sh -c 'sleep 2; /sbin/ifdown ${role.interfaceName}; /sbin/ifup ${role.interfaceName}; for i in 1 2 3 4 5; do ${interfaceUp} && break; sleep 2; done; if ! ${interfaceUp}; then cp /etc/network/interfaces.dhcp-backup /etc/network/interfaces; /sbin/ifdown ${role.interfaceName}; /sbin/ifup ${role.interfaceName}; fi' </dev/null >/tmp/ssh2shell-network.log 2>&1 & fi`,
        ]
      : []),
    'else :',
    'sudo cp /etc/network/interfaces.dhcp-backup /etc/network/interfaces',
    'echo "SSH2SHELL_${NET_CHECK}_RESTORED"',
    'fi',
  ].join('; ');

  const netplanBranch = [
    'if { command -v netplan >/dev/null 2>&1 || [ -x /usr/sbin/netplan ]; } && ls /etc/netplan/*.yaml >/dev/null 2>&1; then :',
    '[ -d /etc/netplan.ssh2shell-bak ] || sudo cp -a /etc/netplan /etc/netplan.ssh2shell-bak',
    'if [ -d /etc/cloud/cloud.cfg.d ]; then echo "network: {config: disabled}" | sudo tee /etc/cloud/cloud.cfg.d/99-ssh2shell-disable-network-config.cfg >/dev/null; fi',
    "sudo find /etc/netplan -maxdepth 1 -type f -name '*.yaml' -delete",
    `echo '${b64(`${netplanConfig}\n`)}' | base64 -d | sudo tee /etc/netplan/99-ssh2shell.yaml >/dev/null`,
    'sudo chmod 600 /etc/netplan/99-ssh2shell.yaml',
    'if sudo /usr/sbin/netplan generate; then :',
    'echo "SSH2SHELL_${NET_CHECK}_OK"',
    ...(applyNetwork
      ? [
          `if ! ${interfaceUp}; then sudo nohup sh -c 'sleep 2; /usr/sbin/netplan apply; for i in 1 2 3 4 5 6 7 8 9 10; do ${interfaceUp} && break; sleep 2; done; if ! ${interfaceUp}; then rm -rf /etc/netplan; cp -a /etc/netplan.ssh2shell-bak /etc/netplan; /usr/sbin/netplan apply; fi' </dev/null >/tmp/ssh2shell-network.log 2>&1 & fi`,
        ]
      : []),
    'else :',
    'sudo rm -rf /etc/netplan',
    'sudo cp -a /etc/netplan.ssh2shell-bak /etc/netplan',
    'echo "SSH2SHELL_${NET_CHECK}_RESTORED"',
    'fi',
    'else :',
    ifupdownBranch,
    'fi',
  ].join('; ');

  commands.push(`NET_CHECK=NETWORK; ${netplanBranch}`);

  return commands;
}

const host = {
  server: {
    host: roleEnv('HOST') || role.ip,
    port: roleEnv('PORT') || process.env.PORT || 22,
    userName: loginUser,
    password: sudoPassword,
    privateKey: bootstrapKeyPath ? fs.readFileSync(bootstrapKeyPath) : undefined,
  },
  commands: buildCommands(),
  idleTimeOut: Number(roleEnv('IDLE_TIMEOUT') || 20000),
  debug: process.env.DEBUG === 'true',
  verbose: process.env.VERBOSE === 'true',
};

if (process.env.KEY_PASSPHRASE) {
  host.server.passPhrase = process.env.KEY_PASSPHRASE;
}

const SSH = new SSH2Shell(host);

SSH.on('msg', log);
SSH.on('commandComplete', (command, response, sshObj) => {
  log(`${sshObj.server.host} $ ${command}`);
  log(response.trim());
});
SSH.on('error', (err, type) => log(`${type}: ${err}`));

SSH.connect((sessionText) => {
  log(`-----Callback session text:\n${sessionText}\n-----Callback end`);

  // Only the expanded marker is checked. The command text contains
  // `SSH2SHELL_${CHECK}_...`, so a marker in sessionText means the command
  // actually ran and printed it. A restored or reload-failed marker means the
  // validation failed even if an earlier OK marker was printed.
  const checks = {
    sudoers:
      sessionText.includes('SSH2SHELL_SUDOERS_OK') &&
      !sessionText.includes('SSH2SHELL_SUDOERS_RESTORED'),
    sshd:
      sessionText.includes('SSH2SHELL_SSHD_OK') &&
      !sessionText.includes('SSH2SHELL_SSHD_RESTORED') &&
      !sessionText.includes('SSH2SHELL_SSHD_RELOAD_FAILED'),
    network:
      sessionText.includes('SSH2SHELL_NETWORK_OK') &&
      !sessionText.includes('SSH2SHELL_NETWORK_RESTORED'),
  };

  console.log(`Provisioning ${ROLE_NAME} finished.`);
  for (const [name, ok] of Object.entries(checks)) {
    console.log(`  ${name}: ${ok ? 'OK' : 'FAILED (see log)'}`);
  }
  console.log(`Log: ${logPath}`);

  if (Object.values(checks).some((ok) => !ok)) {
    process.exitCode = 1;
  }
});
