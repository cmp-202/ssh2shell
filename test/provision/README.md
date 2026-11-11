# Live-test VM provisioning

`provision.js` rebuilds one of the live-test VMs from a fresh Ubuntu install.
It logs in with `ssh2shell`, then applies the same hostname, static address,
users, sudo rules, SSH keys, and `sshd` settings as the existing
`192.168.44.0/24` test VMs.

This is only for the local live-test environment. It is not a staging or
production hardening script.

## Requirements

- A fresh Ubuntu VM with OpenSSH server, `sudo`, `base64`, and either netplan
  (Ubuntu 26.04) or `ifupdown` (Ubuntu 18.04). The script detects which network
  stack is in use.
- A bootstrap login that can run `sudo`. The default Ubuntu install user works;
  set `PROVISION_<ROLE>_USER` / `PROVISION_<ROLE>_PASSWORD` for it in
  `test/provision/.env`.
- The repository's dependencies installed (`npm install`), because the script
  uses `dotenv` and `ssh2`.
- The key files in `test/certs/` (or override them, see below). The private test
  key is gitignored; generate it with the commands in
  [`test/certs/README.md`](../certs/README.md).

## Quick start

The VM needs internet while it is being installed and updated, but the live-test
network is host-only and has no gateway. Set the adapter up in this order:
install and update on a **bridged** (or NAT) adapter, then switch Adapter 1 to
**host-only** before provisioning. Doing it the other way round leaves a fresh
VM with no way to install `openssh-server`.

1. Create the VM with **Adapter 1 = Bridged Adapter** (or NAT) and install
   Ubuntu Server. On the SSH Setup screen, tick **Install OpenSSH server**.
2. Update the VM and take a clean snapshot while it still has internet:

   ```sh
   sudo apt update && sudo apt full-upgrade -y
   sudo systemctl enable --now ssh
   ```

3. Power off, switch Adapter 1 to the host-only network, and boot:

   ```powershell
   $vbm = 'C:\Program Files\Oracle\VirtualBox\VBoxManage.exe'
   & $vbm controlvm 'Testing Server' acpipowerbutton
   # wait until the VM has powered off
   & $vbm modifyvm 'Testing Server' --nic1 hostonly `
     --hostonlyadapter1 'VirtualBox Host-Only Ethernet Adapter'
   & $vbm startvm 'Testing Server' --type headless
   ```

   With NAT instead of bridged, use `--nic1 nat` during install and
   `--nic1 hostonly` afterwards.

4. On the VM console, read the DHCP address and confirm SSH is listening. Ubuntu
   may use socket activation, so check both `ssh.service` and `ssh.socket`; the
   port check is the one that matters:

   ```sh
   ip -br addr
   systemctl status ssh --no-pager
   systemctl status ssh.socket --no-pager
   ss -ltn | grep ':22'
   ```

5. Put that address in `test/provision/.env` as `PROVISION_<ROLE>_HOST` and run
   the role:

   ```powershell
   npm run provision -- server1
   ```

   The script writes the role's static address, so the VM leaves the DHCP range
   and is reachable at `192.168.44.10` (server1), `.11` (server2), or `.12`
   (server3) afterwards.

6. To install updates later, add a temporary second adapter instead of changing
   Adapter 1, so the static address stays put:

   ```powershell
   & $vbm controlvm 'Testing Server' acpipowerbutton
   & $vbm modifyvm 'Testing Server' --nic2 nat
   & $vbm startvm 'Testing Server' --type headless
   # apt update / upgrade on the console, then power off and remove it
   & $vbm modifyvm 'Testing Server' --nic2 none
   ```

Bridged puts the VM on your LAN and gets DHCP from the router; NAT gives
outbound internet only. Either is fine for the install/update step. Host-only is
the live-test network on `192.168.44.0/24`.

## Roles

The role is the first CLI argument, or `PROVISION_ROLE`, or `server1` by
default.

| Role | Hostname | Static IP | Test users | Extra |
| --- | --- | --- | --- | --- |
| `server1` | `server1` | `192.168.44.10` | `andrew`, `tester`, `nopasswd`, `suuser`, `kbduser` | `kbduser` is keyboard-interactive only |
| `server2` | `server2` | `192.168.44.11` | `andrew`, `tester`, `nopasswd`, `suuser` | `nopasswd` has `NOPASSWD` sudo |
| `server3` | `server3` | `192.168.44.12` | `andrew`, `tester`, `nopasswd`, `suuser` | — |

`andrew` is the manual admin account. `tester` is the primary test login.
`nopasswd` is a normal sudo user except on server2, where
`/etc/sudoers.d/90-ssh2shell-nopasswd` grants passwordless sudo. `suuser` has no
sudo and exists for the `su` test.

The test key is installed in every test user's `authorized_keys`. It is also
copied to `~/.ssh/id_ed25519` for `tester`, `nopasswd`, and `suuser` so nested
`ssh -i` hops work. `andrew` gets the admin key instead.

## Building the three VMs

The live suite needs three hosts. The quickest repeatable setup is one clean
Ubuntu Server VM, a snapshot, and a clone or revert for each role.

1. Install Ubuntu Server with a bridged or NAT adapter so the installer and the
   first `apt update` have internet (see [Quick start](#quick-start)). On the
   SSH Setup screen, tick **Install OpenSSH server**, and create a bootstrap
   account that can run `sudo`.
2. Update the VM and take a clean snapshot (for example `clean-install`).
3. Switch Adapter 1 to host-only on `192.168.44.0/24`, then clone the snapshot
   three times, or revert the same VM between roles. Give each clone a unique
   MAC address; VirtualBox does this when you clone.
4. Boot a clone, find its DHCP address (`ip -br addr`), and set the matching
   role in `test/provision/.env`:

   ```sh
   PROVISION_SERVER1_HOST=192.168.44.50
   PROVISION_SERVER1_USER=ubuntu
   PROVISION_SERVER1_PASSWORD=the-install-password
   PROVISION_SERVER1_KEY_PATH=none
   PROVISION_SERVER1_REGENERATE_MACHINE_ID=true
   ```

5. Run `npm run provision -- server1`. Repeat for `server2` and `server3`,
   changing the role and its `PROVISION_SERVERx_*` block.
6. Verify the static address and log in as `tester` with the test key.
7. Revert to the clean snapshot before the next attempt.

`PROVISION_SERVERx_REGENERATE_MACHINE_ID=true` is only needed for clones. A
fresh install already has a unique `/etc/machine-id`. Keep the DHCP range out
of `192.168.44.10`–`192.168.44.12` so a lease cannot collide with a static
address.

## Bootstrap SSH access

The script cannot configure a VM until it can log in over SSH. On a fresh
install, check this from the VM console before running the role.

1. Confirm `sshd` is installed and listening. Ubuntu may use socket activation,
   so check `ssh.socket` as well as `ssh.service`:

   ```sh
   systemctl status ssh --no-pager
   systemctl status ssh.socket --no-pager
   ss -ltn | grep ':22'
   ```

   If it is missing, install and start it:

   ```sh
   sudo apt update && sudo apt install -y openssh-server
   sudo systemctl enable --now ssh
   ```

   If a firewall is active, allow the port: `sudo ufw allow 22/tcp`.

2. Give the bootstrap user a login. For password auth:

   ```sh
   sudo passwd ssh2shell
   sudo usermod -aG sudo ssh2shell
   ```

   For key auth, install the repository test key (or your own):

   ```sh
   sudo install -d -m 700 -o ssh2shell -g ssh2shell /home/ssh2shell/.ssh
   echo 'ssh-ed25519 AAAA...' | sudo tee -a /home/ssh2shell/.ssh/authorized_keys
   sudo chown ssh2shell:ssh2shell /home/ssh2shell/.ssh/authorized_keys
   sudo chmod 600 /home/ssh2shell/.ssh/authorized_keys
   ```

   Then set `PROVISION_<ROLE>_KEY_PATH` to that private key. If
   `PROVISION_<ROLE>_USER` matches `USER_NAME`, leaving the key path unset uses
   the default test key.

3. Make sure password auth is actually enabled. Ubuntu cloud images often put
   `PasswordAuthentication no` in `/etc/ssh/sshd_config.d/*.conf`. `sshd` keeps
   the first value it reads and the `Include` comes before the main file, so
   edit the drop-in or add one that sorts first:

   ```sh
   printf '%s\n' 'PasswordAuthentication yes' \
     | sudo tee /etc/ssh/sshd_config.d/00-ssh2shell-bootstrap.conf
   sudo sshd -t && sudo systemctl restart ssh
   ```

   Use `KbdInteractiveAuthentication yes` on OpenSSH 8.7+; older releases need
   `ChallengeResponseAuthentication yes`.

4. Verify from the host before provisioning:

   ```sh
   ssh -i test/certs/test_ed25519 ssh2shell@192.168.44.105 'id'
   # or
   ssh ssh2shell@192.168.44.105 'id'
   ```

   Then set `PROVISION_<ROLE>_HOST` to that address.

If you log in with a key only, also set `PROVISION_<ROLE>_SUDO_PASSWORD` (or
`PASSWORD`) unless the bootstrap user has `NOPASSWD` sudo; the script needs a
password to answer the `sudo` prompt.

## Configuration

Per-server settings live in `test/provision/.env`. Copy
`test/provision/.env.example` to `test/provision/.env` and edit it there. The
local `.env` is gitignored; the example is committed.

Values are read in this order:

1. the shell environment,
2. `PROVISION_<ROLE>_*` in `test/provision/.env`,
3. generic `PROVISION_*` in `test/provision/.env` or the repository `.env`,
4. built-in defaults.

`<ROLE>` is `SERVER1`, `SERVER2`, or `SERVER3`. The first CLI argument selects
the role, then `PROVISION_ROLE`, then `server1`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PROVISION_ROLE` | `server1` | Role when no CLI argument is given. |
| `PROVISION_<ROLE>_HOST` | role static IP | Address of the VM as it is reachable now. Use the DHCP address for a fresh install. |
| `PROVISION_<ROLE>_PORT` | `PORT` or `22` | SSH port. |
| `PROVISION_<ROLE>_IP` | role static IP | Static address written to netplan or `/etc/network/interfaces`. |
| `PROVISION_<ROLE>_HOSTNAME` | role name | Hostname. |
| `PROVISION_<ROLE>_INTERFACE` | `enp0s3` | Guest network interface. |
| `PROVISION_<ROLE>_USER` | `USER_NAME` | Bootstrap login user. A fresh Ubuntu install usually has `ubuntu`. |
| `PROVISION_<ROLE>_PASSWORD` | `PASSWORD` when the user matches `USER_NAME` | Bootstrap login password. |
| `PROVISION_<ROLE>_SUDO_PASSWORD` | login password, then `PASSWORD` | Password used for `sudo`. |
| `PROVISION_<ROLE>_KEY_PATH` | test private key | Bootstrap private key. Set to `none` to force password auth. |
| `PROVISION_<ROLE>_APPLY_NETWORK` | `true` | Set to `false` to write and validate the network config without bringing it up. |
| `PROVISION_<ROLE>_REGENERATE_MACHINE_ID` | `false` | Set to `true` for a VM cloned from another VM. A fresh install already has a unique id. |
| `PROVISION_<ROLE>_IDLE_TIMEOUT` | `20000` | `idleTimeOut` for the `ssh2shell` session. |

The same names without the role prefix (`PROVISION_HOST`, `PROVISION_USER`,
`PROVISION_PASSWORD`, and so on) work as generic fallbacks for every role.

The test key is only the default bootstrap key for the normal test login. If
you set a different bootstrap user, such as `ubuntu`, also set that role's
password or key path.

The repository `.env` supplies the live-test users and keys:

| Variable | Purpose |
| --- | --- |
| `TEST_PRIVATE_KEY_PATH` | Private test key, also used as the default bootstrap key. Defaults to `test/certs/test_ed25519`. |
| `TEST_PUBLIC_KEY_PATH` | Public test key installed on the VM. Defaults to `<private>.pub`. |
| `ADMIN_PUBLIC_KEY_PATH` | Public admin key for `andrew`. Defaults to `test/certs/admin_ed25519.pub`. |
| `PASSWORD` | Password for `tester`; also the default bootstrap password. |
| `NOPASSWD_PASSWORD` | Password for `nopasswd`. |
| `SECOND_USER_PASSWORD` | Password for `suuser`. |
| `KBD_PASSWORD` | Password for `kbduser` (server1). |
| `ANDREW_PASSWORD` | Sets `andrew`'s password when present. Leave empty to keep the existing one. |
| `KEY_PASSPHRASE` | Passphrase for the bootstrap key, if any. |
| `DEBUG` / `VERBOSE` | `ssh2shell` session output. |

`TEST_PRIVATE_KEY_PATH` falls back to `PRIVATE_KEY_PATH` before the
`test/certs` default.

## Usage

1. Copy `.env-example` to `.env` and fill in the test-user passwords.
2. Copy `test/provision/.env.example` to `test/provision/.env`.
3. For a fresh DHCP install, set the role's bootstrap values in
   `test/provision/.env`:

   ```sh
   PROVISION_SERVER3_HOST=192.168.44.50
   PROVISION_SERVER3_USER=ubuntu
   PROVISION_SERVER3_PASSWORD=the-install-password
   PROVISION_SERVER3_KEY_PATH=none
   ```

4. Run the role:

   ```sh
   node test/provision/provision.js server3
   # or
   npm run provision -- server3
   ```

5. Reconnect at the role's static IP as `tester` (or `andrew` with the admin
   key). The script applies the network last because changing it can drop the
   current session.

The script is safe to re-run against an already-provisioned VM. Users are
created only when missing, keys and sudo files are rewritten, and `sshd` is
validated before it is reloaded. Leave `PROVISION_<ROLE>_REGENERATE_MACHINE_ID`
unset on re-runs.

## Output and checks

Each run writes `test/logs/provision-<role>.js.log` and prints a summary:

```text
Provisioning server3 finished.
  sudoers: OK
  sshd: OK
  network: OK
Log: .../test/logs/provision-server3.js.log
```

The session text contains the markers the summary looks for:

- `SSH2SHELL_SUDOERS_OK` — `visudo -c` passed after removing the legacy rule.
- `SSH2SHELL_SSHD_OK` — `sshd -t` passed and the service reloaded.
- `SSH2SHELL_NETWORK_OK` — `netplan generate` or `ifquery` accepted the new
  network config.

`*_RESTORED` means the script put the backup back. `SSH2SHELL_SSHD_RELOAD_FAILED`
means the config validated but the reload command failed. Any failure sets a
non-zero exit code.

## Caveats

- Password and key payloads are sent as base64 so they do not appear as bare
  text in the session log. The `.env` files themselves are still plaintext and
  are gitignored.
- The network step runs in the background. If the static address does not come
  up, it restores the previous netplan directory or
  `/etc/network/interfaces.dhcp-backup` and re-applies it so the VM remains
  reachable on its old address.
- A freshly created `andrew` has the admin key and no password unless
  `ANDREW_PASSWORD` is set. Set it before provisioning a new VM if you want
  password-based admin login.
- The script detects netplan vs `ifupdown` at runtime. The netplan path replaces
  `/etc/netplan/*.yaml` with a single static config, so it assumes one network
  interface. If the interface is not `enp0s3`, set
  `PROVISION_<ROLE>_INTERFACE` (or `PROVISION_INTERFACE`).
- OpenSSH 8.7 renamed `ChallengeResponseAuthentication` to
  `KbdInteractiveAuthentication`. The script selects the directive that works
  on the installed release, and updates `/etc/ssh/sshd_config.d/*.conf` so a
  cloud-image `PasswordAuthentication no` does not win.
- The script does not install packages, configure DNS, or set a gateway. The
  test network is host-only.
- The Ubuntu Server installer leaves **Install OpenSSH server** unchecked by
  default. If you miss it, the VM has no `sshd`, no `ssh` client, and no service
  to enable. A host-only VM with no NAT cannot `apt install openssh-server`
  either, so either select the checkbox during install or add a temporary NAT
  adapter, install it, and remove the adapter. See
  [Bootstrap SSH access](#bootstrap-ssh-access).
