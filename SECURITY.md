# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| 4.x | Yes |
| 3.x and earlier | No |

3.x and earlier are deprecated on npm and do not receive fixes. If you are
still on 3.x, upgrade to 4.x; see the [4.0.0 changelog entry](./CHANGELOG.md)
for the host-hop and `server.ssh` changes.

## Reporting a vulnerability

Do not open a public issue for a security problem. Use GitHub's private
vulnerability reporting:

<https://github.com/cmp-202/ssh2shell/security/advisories/new>

Please include:

- the ssh2shell version, Node.js version, and operating system;
- what an attacker could do with the issue;
- a minimal reproduction, with secrets and real host names removed;
- any mitigation you have already identified.

I will acknowledge the report, confirm the impact, and prepare a fix and
release. I will credit you in the advisory unless you ask me not to.

## Scope

In scope:

- escaping the command flow to run unintended commands on a host;
- bypassing `hostHash` / `hostVerifier` when a host key is pinned;
- leaking credentials, private keys, or passphrases through events,
  `sessionText`, logs, or errors;
- a hop reaching a host it should not reach, or a failure that leaves a
  session open.

Out of scope:

- the security of the remote host, the commands you choose to run, or the
  privileges you grant them;
- vulnerabilities in [`ssh2`](https://github.com/mscdex/ssh2) itself, which
  should be reported upstream;
- host-key acceptance when `hostHash` / `hostVerifier` is not set, which is
  `ssh2`'s documented default and is described in the README.
