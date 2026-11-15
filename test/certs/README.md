# Live-test SSH keys

These keys are only for the local live-test VMs. The private keys are
gitignored; the matching `.pub` files are committed so the expected identities
are visible in review.

CI does not use these files: the live workflow generates a throwaway key pair
per run and [`test/ci/setup-live-hosts.sh`](../ci/setup-live-hosts.sh) installs
its public half.

## Key pairs

| Key | Purpose | Installed for |
| --- | --- | --- |
| `test_ed25519` / `test_ed25519.pub` | Primary test login and `forwardOut` hops | `tester`, `nopasswd`, `suuser` on all hosts; `kbduser` on server1 |
| `admin_ed25519` / `admin_ed25519.pub` | Bootstrap/admin login | `ssh2shell` on all hosts |

Hops are opened with `forwardOut` from the parent connection and authenticate
with the runner's local private key, so the private key is never copied to a
test host. Only the public keys go into `authorized_keys`.

## Regenerating

```sh
ssh-keygen -q -t ed25519 -N "" -C ssh2shell-test  -f test/certs/test_ed25519
ssh-keygen -q -t ed25519 -N "" -C ssh2shell-admin -f test/certs/admin_ed25519
```

Then install `test_ed25519.pub` in each test user's `authorized_keys` and
`admin_ed25519.pub` in `ssh2shell`'s. `test/provision/provision.js` does both
for you.

## Live host and user matrix

| Host | Static IP | Hostname | Test users |
| --- | --- | --- | --- |
| server1 | `192.168.44.10` | `server1` | `tester` (sudo), `nopasswd` (sudo), `suuser` (no sudo), `kbduser` (keyboard-interactive test; password auth disabled) |
| server2 | `192.168.44.11` | `server2` | `tester` (sudo), `nopasswd` (sudo, `NOPASSWD` on this host), `suuser` (no sudo) |
| server3 | `192.168.44.12` | `server3` | `tester` (sudo), `nopasswd` (sudo), `suuser` (no sudo) |

`ssh2shell` is the bootstrap/admin login created by the provisioning script. It
is not used by the automated tests, which log in as `tester`. Older VMs may
still have a manually created `andrew` account; the provisioning script does not
create it.
