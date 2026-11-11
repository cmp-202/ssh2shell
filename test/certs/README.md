# Live-test SSH keys

These keys are only for the local live-test VMs. The private keys are
gitignored; the matching `.pub` files are committed so the expected identities
are visible in review.

## Key pairs

| Key | Purpose | Installed for |
| --- | --- | --- |
| `test_ed25519` / `test_ed25519.pub` | Primary test login and nested SSH hops | `tester`, `nopasswd`, `suuser` on all hosts; `kbduser` on server1 |
| `admin_ed25519` / `admin_ed25519.pub` | Manual administration only | `andrew` on all hosts |

The private test key is also copied to each host as
`~/.ssh/id_ed25519` for the hop users, so a nested `ssh -i` can authenticate
without a password. Override the remote path with `HOP_KEY_PATH` /
`HOP2_KEY_PATH` if a key is installed somewhere else.

## Regenerating

```sh
ssh-keygen -q -t ed25519 -N "" -C ssh2shell-test  -f test/certs/test_ed25519
ssh-keygen -q -t ed25519 -N "" -C ssh2shell-admin -f test/certs/admin_ed25519
```

Then install `test_ed25519.pub` in each test user's `authorized_keys` and
`admin_ed25519.pub` in `andrew`'s.

## Live host and user matrix

| Host | Static IP | Hostname | Test users |
| --- | --- | --- | --- |
| server1 | `192.168.44.10` | `server1` | `tester` (sudo), `nopasswd` (sudo), `suuser` (no sudo), `kbduser` (keyboard-interactive only) |
| server2 | `192.168.44.11` | `server2` | `tester` (sudo), `nopasswd` (sudo, `NOPASSWD` on this host), `suuser` (no sudo) |
| server3 | `192.168.44.12` | `server3` | `tester` (sudo), `nopasswd` (sudo), `suuser` (no sudo) |

`andrew` is the manual admin login and is not used by the automated tests.
