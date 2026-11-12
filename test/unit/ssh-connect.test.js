'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  installFakeSsh2,
  isBaseline,
  loadSSH2Shell,
  createHost,
} = require('./helpers/harness');
const { FakeStream } = require('./helpers/fake-ssh2');

installFakeSsh2();
const SSH2Shell = loadSSH2Shell();

function build(sshConfig, serverOverrides = {}) {
  const host = createHost({
    server: Object.assign(
      {
        host: 'target.test',
        port: 22,
        userName: 'user',
        password: 'pass',
      },
      serverOverrides,
      { ssh: sshConfig }
    ),
  });
  const ssh = new SSH2Shell(host);
  ssh.sshObj = host;
  ssh._loadDefaults();
  ssh._stream = new FakeStream();

  const writes = [];
  const errors = [];
  ssh._runCommand = (command) => writes.push(command);
  ssh.on('error', (...args) => errors.push(args));

  return { ssh, host, writes, errors };
}

describe('_sshConnect command construction', () => {
  it('builds a quoted ssh command with safe defaults', () => {
    const { ssh, writes } = build();

    ssh._sshConnect();

    assert.equal(writes.length, 1);
    const command = writes[0];
    assert.ok(command.startsWith('ssh -x '));
    assert.ok(command.includes('-o "StrictHostKeyChecking=no"'));
    assert.ok(command.includes('-p 22'));
    assert.ok(command.includes("'user'@'target.test'"));
    assert.equal(ssh.command, command);
    assert.equal(ssh.sshObj.sshAuth, false);
    assert.equal(ssh.sshObj.sshToNextHost, true);
  });

  it('adds tty and verbose flags', () => {
    const { ssh, writes } = build({
      disablePseudoTTY: true,
      forcePseudoTTY: true,
      verbose: true,
    });

    ssh._sshConnect();

    assert.ok(writes[0].includes('-xTtv'));
  });

  it('quotes custom ssh options', () => {
    const { ssh, writes } = build({
      options: { StrictHostKeyChecking: 'yes' },
    });

    ssh._sshConnect();

    assert.ok(writes[0].includes("-o StrictHostKeyChecking='yes'"));
  });

  it('ignores inherited properties in custom ssh options', () => {
    const options = Object.create({ inherited: 'leak' });
    options.StrictHostKeyChecking = 'yes';
    const { ssh, writes } = build({ options });

    ssh._sshConnect();

    assert.ok(writes[0].includes("-o StrictHostKeyChecking='yes'"));

    if (isBaseline()) {
      // for...in also walks inherited enumerable properties.
      assert.ok(writes[0].includes("-o inherited='leak'"));
    } else {
      assert.ok(!writes[0].includes('inherited'));
    }
  });

  it('escapes single quotes in paths', () => {
    const { ssh, writes } = build({ identityFile: "/tmp/it's" });

    ssh._sshConnect();

    assert.ok(writes[0].includes("-i '/tmp/it'\\''s'"));
  });

  it('strips non-digits from the port', () => {
    const { ssh, writes } = build(undefined, { port: '22; rm -rf /' });

    ssh._sshConnect();

    assert.ok(writes[0].includes('-p 22'));
    assert.ok(!writes[0].includes('rm -rf'));
  });

  it('shell-quotes a host containing shell metacharacters', () => {
    const payload = 'target.test; touch /tmp/pwn';
    const { ssh, writes } = build(undefined, { host: payload });

    ssh._sshConnect();

    assert.equal(writes.length, 1);
    assert.ok(writes[0].endsWith(`'user'@'${payload}'`));
  });

  it('shell-quotes a userName containing single quotes and commands', () => {
    const payload = "user'; touch /tmp/pwn; #";
    const { ssh, writes } = build(undefined, { userName: payload });

    ssh._sshConnect();

    assert.equal(writes.length, 1);
    assert.ok(
      writes[0].endsWith("'user'\\''; touch /tmp/pwn; #'@'target.test'")
    );
  });

  it('rejects control characters in custom ssh option names', () => {
    const { ssh, writes, errors } = build({
      options: { 'StrictHostKeyChecking;touch /tmp/pwn': 'yes' },
    });

    ssh._sshConnect();

    assert.equal(writes.length, 0);
    assert.ok(
      errors.some((args) =>
        String(args[0]).includes('Malicious characters detected in SSH options')
      )
    );
  });

  it('rejects control characters in ssh options', () => {
    const { ssh, writes, errors } = build({ cipherSpec: 'aes;rm -rf /' });

    ssh._sshConnect();

    assert.equal(writes.length, 0);
    assert.ok(
      errors.some((args) =>
        String(args[0]).includes('Malicious characters detected in SSH cipherSpec')
      )
    );
  });

  it('rejects control characters in custom ssh options', () => {
    const { ssh, writes, errors } = build({
      options: { UserKnownHostsFile: '/tmp/x;touch /tmp/pwn' },
    });

    ssh._sshConnect();

    assert.equal(writes.length, 0);
    assert.ok(
      errors.some((args) =>
        String(args[0]).includes('Malicious characters detected in SSH options')
      )
    );
  });

  it('maps forceProtocolVersion to a valid ssh flag', () => {
    const boolean = build({ forceProtocolVersion: true });
    boolean.ssh._sshConnect();

    if (isBaseline()) {
      assert.ok(boolean.writes[0].startsWith('ssh -xtrue '));
    } else {
      assert.ok(boolean.writes[0].startsWith('ssh -x -2 '));
    }

    const explicit = build({ forceProtocolVersion: 1 });
    explicit.ssh._sshConnect();

    if (isBaseline()) {
      assert.ok(explicit.writes[0].startsWith('ssh -x1 '));
    } else {
      assert.ok(explicit.writes[0].startsWith('ssh -x -1 '));
    }
  });

  it('maps forceAddressType to a valid ssh flag', () => {
    const boolean = build({ forceAddressType: true });
    boolean.ssh._sshConnect();

    if (isBaseline()) {
      assert.ok(boolean.writes[0].startsWith('ssh -xtrue '));
    } else {
      assert.ok(boolean.writes[0].startsWith('ssh -x -4 '));
    }

    const explicit = build({ forceAddressType: 6 });
    explicit.ssh._sshConnect();

    if (isBaseline()) {
      assert.ok(explicit.writes[0].startsWith('ssh -x6 '));
    } else {
      assert.ok(explicit.writes[0].startsWith('ssh -x -6 '));
    }
  });

  it('rejects invalid force flag values on current', () => {
    const protocol = build({ forceProtocolVersion: 3 });
    protocol.ssh._sshConnect();

    const address = build({ forceAddressType: 5 });
    address.ssh._sshConnect();

    if (isBaseline()) {
      assert.ok(protocol.writes[0].startsWith('ssh -x3 '));
      assert.ok(address.writes[0].startsWith('ssh -x5 '));
    } else {
      assert.equal(protocol.writes.length, 0);
      assert.ok(
        protocol.errors.some((args) =>
          String(args[0]).includes('Invalid forceProtocolVersion: 3')
        )
      );
      assert.equal(protocol.ssh._stream.closed, true);

      assert.equal(address.writes.length, 0);
      assert.ok(
        address.errors.some((args) =>
          String(args[0]).includes('Invalid forceAddressType: 5')
        )
      );
      assert.equal(address.ssh._stream.closed, true);
    }
  });
});

describe('_sshConnect nested authentication state', () => {
  function buildKeyOnly(serverOverrides = {}) {
    const host = createHost({
      server: Object.assign(
        // createHost supplies a default password; clear it so the key-only
        // case really has no interactive credential.
        { host: 'target.test', port: 22, userName: 'user', password: undefined },
        serverOverrides
      ),
    });
    const ssh = new SSH2Shell(host);
    ssh.sshObj = host;
    ssh._loadDefaults();
    ssh._stream = new FakeStream();
    ssh._runCommand = () => {};
    return { ssh, host };
  }

  it('starts key-only nested connections authenticated', () => {
    if (isBaseline()) {
      // The baseline always starts unauthenticated.
      return;
    }

    const { ssh } = buildKeyOnly();
    ssh._sshConnect();

    assert.equal(ssh.sshObj.sshAuth, true);
  });

  it('starts password nested connections unauthenticated', () => {
    if (isBaseline()) return;

    const { ssh } = buildKeyOnly({ password: 'secret' });
    ssh._sshConnect();

    assert.equal(ssh.sshObj.sshAuth, false);
  });

  it('starts passphrase nested connections unauthenticated', () => {
    if (isBaseline()) return;

    const { ssh } = buildKeyOnly({ passPhrase: 'phrase' });
    ssh._sshConnect();

    assert.equal(ssh.sshObj.sshAuth, false);
  });

  it('treats the first remote prompt as success for key auth', () => {
    if (isBaseline()) return;

    const { ssh } = buildKeyOnly();
    let next = false;
    ssh._nextCommand = () => {
      next = true;
    };

    ssh._sshConnect();
    ssh._buffer = 'Welcome\nuser@target:~$ ';
    ssh._processSSHPrompt();

    assert.equal(next, true);
    assert.equal(ssh.sshObj.sshToNextHost, false);
    assert.ok(ssh.sshObj.exitCommands.includes('exit'));
  });
});
