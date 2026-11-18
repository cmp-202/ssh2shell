# Migrating from 3.x to 4.x

4.0.0 is a breaking release. Most upgrade problems fall into a small number of
categories, and this page maps the symptom you are seeing to the change that
caused it. The authoritative list is the
[4.0.0 changelog entry](../CHANGELOG.md#400---2026-11-15); this page is the
practical path through it.

## Check what you are running

```bash
npm ls ssh2shell
```

`4.x` — read the checklist below. `3.x` — your current code still works, but
3.x is deprecated and receives no fixes. See
[If you cannot migrate yet](#if-you-cannot-migrate-yet).

## Ten-minute checklist

- [ ] Remove `server.ssh` from every host object.
- [ ] Remove `exitCommands`; there is no nested shell to leave.
- [ ] Rename `host.msg` to `host.onMsg`.
- [ ] Replace `server.hashMethod` with `hostHash` or `hostVerifier`.
- [ ] Replace the `sshObj.stop` flag with `sshObj.abort`.
- [ ] Rename host `idleTime` / `dataIdleTime` to `idleTimeOut` /
      `dataIdleTimeOut`.
- [ ] Replace `passphrasePrompt` with `passwordPrompt`.
- [ ] Never construct with an empty host list.
- [ ] Clone a host object before reusing it with another instance.

## Renamed and removed options

| 3.x | 4.x |
| --- | --- |
| `server.ssh` | `ssh2` connection options on that host |
| `server.ssh.identityFile` | local `privateKey` contents, or a local `agent` |
| `server.ssh.cipherSpec` | `algorithms: { cipher: [...] }` |
| `server.ssh.macSpec` | `algorithms: { mac: [...] }` |
| `server.ssh.forceAddressType` | `forceIPv4: true` / `forceIPv6: true` |
| `server.ssh.forcePseudoTTY` / `disablePseudoTTY` | `pty: true` / `pty: false` |
| `server.ssh.loginName` | `server.userName` |
| `server.ssh.verbose` | `debug: true` on the host |
| `exitCommands` | removed |
| `host.msg` | `host.onMsg` |
| `server.hashMethod` | `hostHash` / `hostVerifier` |
| `sshObj.stop` | `sshObj.abort` |
| `host.idleTime` | `host.idleTimeOut` |
| `host.dataIdleTime` | `host.dataIdleTimeOut` |
| `passphrasePrompt` | `passwordPrompt` |

`SSH.idleTime` and `SSH.dataIdleTime` at instance level are unchanged. The full
`server.ssh` mapping, including options with no replacement, is in
[Host-to-host connections](./NEXT-HOST-CONNECTION.md#serverssh-migration).

## Hops: `server.ssh` becomes `ssh2` options

This is the change most upgrades trip over. In 3.x the nested host was reached
by running `ssh` **on the jump host**, so the key had to exist there:

```javascript
// 3.x: the nested ssh runs on the jump host.
const target = {
  server: {
    host: '192.168.1.20',
    userName: 'deploy',
    ssh: {
      identityFile: '/home/deploy/.ssh/id_ed25519',
    },
  },
  commands: ['hostname', 'uptime'],
};
```

In 4.x every hop is an `ssh2` connection opened through the parent's
`forwardOut` channel. Authentication happens in **your process**, so the key
must be local:

```javascript
// 4.x: the hop authenticates from this process.
const target = {
  server: {
    host: '192.168.1.20',
    userName: 'deploy',
    privateKey: fs.readFileSync(process.env.PRIVATE_KEY_PATH),
  },
  commands: ['hostname', 'uptime'],
};
```

Consequences worth checking:

- A key or agent that exists only on the jump host no longer works. Copy the key
  to the process, or use an agent there.
- A hop does not inherit the parent's credentials. Set `userName`, `password`,
  `privateKey`, `passPhrase`, and `agent` on each host object.
- `server.host` and `server.port` are the destination the **jump host**
  connects to, so names resolve from the jump host's network.
- The jump host must allow `AllowTcpForwarding`; a host that denies
  `direct-tcpip` channels fails with an `error` event of type `Hop`.
- Each hop verifies its own host key. Set `hostHash` / `hostVerifier` on a
  nested host if the primary pins its key.

## Behaviour changes that look like bugs

- **A silent command times out.** The idle timer is armed when a command is
  written, not after the first output, and there is no longer an opt-in flag.
  A command that returns to a prompt with no output is a normal completion.
- **Response text is shorter.** Responses are sliced after the last echoed
  command, so earlier session noise is gone. Assertions against the old,
  noisier text need updating.
- **Host objects are mutated.** `commands` is consumed, `sessionText`
  accumulates, and flags such as `pwSent` and `sudoFailed` change. Reusing an
  object with a second instance continues from where the first stopped. Create
  a fresh object or clone it. The `hosts` array is copied for the run, so it is
  the exception.
- **An empty host list throws.** `new SSH2Shell([])`, `null`, and `undefined`
  raise a `TypeError` instead of starting a run with nothing to do.
- **A failed hop is contained.** The `error` event fires with type `Hop`, that
  host's commands and unstarted descendants are skipped, and the parent
  continues with its remaining hosts. This is new; a 3.x nested failure could
  end the run.

## Symptom to cause

| Symptom | Cause |
| --- | --- |
| Hop fails with `error` type `Hop` | `server.ssh` still set, a key that is not local, or the jump host denies `direct-tcpip` |
| Hop authenticates as the wrong user | The hop does not inherit parent credentials; set them per host |
| Commands after the last host command do not run | `exitCommands` removed |
| No messages delivered | `msg: { send }` still in the host object |
| Host key is never verified | `hashMethod` still set; use `hostHash` / `hostVerifier` |
| A handler that sets `sshObj.stop` no longer ends the run | The flag is now `sshObj.abort`, or call `SSH.stop()` |
| Idle timeouts are ignored | Old `idleTime` / `dataIdleTime` names on the host |
| A silent command hangs, then times out | Expected: the idle timer is always armed |
| `error` type `Parameters` | A host object has no `server`; add one before connecting |
| Key passphrase is never prompted | `passphrasePrompt` removed; use `passwordPrompt` |
| Second run does nothing, or repeats output | Host object reused; `commands` is consumed and `sessionText` accumulates |
| `TypeError` when constructing | Empty host list, `null`, or `undefined` |
| Output no longer contains earlier session text | Responses are sliced after the last echoed command |

## Getting diagnostics

Attach the `error` listener before connecting, and include the type in any
report:

```javascript
const SSH = new SSH2Shell(host);

SSH.on('error', (err, type, close) => {
  console.error({ type, close }, err);
});

SSH.on('msg', (message) => {
  // Debug output while a command runs.
  console.error(message);
});

SSH.connect((sessionText) => {
  console.log(sessionText);
});
```

Set `debug: true` and `verbose: true` on the host for connection-level detail.
The common error types are `Connection`, `Hop`, `Command Timeout`, `Stream`,
and `Connection close`; see [Error handling](./ERROR-HANDLING.md) for the full
contract.

When you open an issue, include the `ssh2shell` and Node.js versions, the error
type, and a minimal host object and command list. Remove keys, passwords, and
real host names first.

## If you cannot migrate yet

3.x is deprecated and unpatched, but it still installs:

```bash
npm install ssh2shell@3.3.0
```

Use that as a short-term pin, not a destination. If a hop or option has no
workable replacement, open an issue with the host object and the error type
rather than staying on 3.x silently.

## See also

- [4.0.0 changelog](../CHANGELOG.md#400---2026-11-15) — the authoritative
  breaking-change list.
- [Host-to-host connections](./NEXT-HOST-CONNECTION.md) — the hop design and
  the full `server.ssh` mapping.
- [Error handling](./ERROR-HANDLING.md) — `error` payloads and close behaviour.
- [README](../README.md) — current host, command, and tunnelling usage.
