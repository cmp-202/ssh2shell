# API baseline and README reconciliation

- **Baseline:** `refactor/L0-baseline` (`v2.0.14`)
- **Source of truth:** `src/ssh2shell.js`, a 1:1 port of the baseline
  `src/ssh2shell.coffee`; `lib/ssh2shell.js` is its published copy.
- **Method:** read the implementation, exercise it with the offline harness in
  `test/unit/`, and compare every documented claim in `README.md` against the
  actual code.
- **Status:** L1 baseline characterization, preserved through L4; L5 records the
  signed-off behavior changes separately.

The README is treated as *documented intent*. Where it disagrees with the code,
the code is recorded as the current behavior and the mismatch is listed below.
Nothing here is fixed during L1 except the documentation-only corrections
explicitly agreed at L1 (see [L1 README corrections](#l1-readme-corrections)).

## Host model: primary and secondary hosts

The code has two distinct host layers. They are iterated by different methods and
must not be conflated.

| Layer | Stored in | Connection method | Iterated by |
| --- | --- | --- | --- |
| Primary host | `_hosts` | A new `ssh2.Client` (`_connect`) | `_nextPrimaryHost` |
| Secondary/nested host | current `sshObj.hosts` | An `ssh ...` command typed into the current shell (`_sshConnect`) | `_nextHost` |

`_nextPrimaryHost(connect)` is the primary-host loop. It shifts the next entry
from `_hosts`, emits `end` for the outgoing primary host, removes that host's
listeners, and starts the next `ssh2` connection via `_initiate(connect)`.

`_runExit()` is the "finish this host" routine, not the primary-host loop. It
decides what happens when the current host has no commands left (`_nextCommand`
/ `_checkCommand`), or after a manual `exit`, a failed nested connection, or
`_previousHost`. When the current host's own `hosts` array is exhausted, its
back-out branch is what returns to the previous connection. Its order is:

1. Run queued `exitCommands` (for example the `exit` pushed after a nested
   `ssh` connection or `sudo su`).
2. If the current host still has entries in `sshObj.hosts`, call `_nextHost()`
   to open the next secondary host with an `ssh ...` command.
3. Otherwise, if `_connections` is non-empty, emit `end` for the current host
   and call `_previousHost()`.
4. Otherwise, if the command is the literal `exit`, send it.
5. Otherwise, `close()`.

`_previousHost()` emits `end` for the outgoing host, detaches that host's
listeners (L5), pops one entry from `_connections`, makes it current again, and
calls `_runExit()` on it. That is what lets the code resume a previous host's
*remaining* `hosts` array: backing out does not discard unvisited secondary
hosts. A chain may be several levels deep; each level is backed out in turn
until `_connections` is empty and `close()` runs.

## Public surface (code-derived)

### Export

`module.exports = SSH2Shell` — a constructible class that extends Node's legacy
`stream.Stream` (which in turn extends `EventEmitter`).

### Constructor

`new SSH2Shell(host)` or `new SSH2Shell([host1, host2, ...])`

- A non-empty array is used as the primary-host queue (`_hosts`).
- Any other value is wrapped as a single primary host.
- An empty array becomes `[[]]` (one empty host) because the length check fails.

### Public methods

| Member | Status | Notes |
| --- | --- | --- |
| `connect(callback)` | Implemented | Starts the first primary host. Callback receives full session text. |
| `close()` | Implemented | Calls `_stream.close()`. |
| `on`, `emit`, `once`, `removeListener` | Inherited | Normal `EventEmitter` API. |
| `pipe(destination)` | Inherited | Legacy `Stream.prototype.pipe`; works by listening to `data`/`end`. |
| `unpipe(destination)` | **Missing** | `Stream.prototype.unpipe` is undefined; README documents it. |

### Public properties

| Property | Meaning |
| --- | --- |
| `sshObj` | Current host object plus runtime state. |
| `command` | Command currently being run (`""` between commands). |
| `connection` | Current `ssh2.Client` instance. |
| `_hosts` | Remaining **primary** hosts (each connected with `ssh2`). |
| `_connections` | Stack of previous hosts used to back out through secondary/nested connections. |
| `_stream` | Current shell stream. |
| `_buffer` | Raw response buffer for the current command. |
| `idleTime` | Command timeout in ms (`idleTimeOut`, default 5000). |
| `dataIdleTime` | Internal data-settle timer in ms; intended public key is `dataIdleTimeOut`, default 500. |
| `standardPrompt`, `passwordPrompt`, `passphrasePrompt` | Compiled `RegExp` prompt detectors. |
| `asciiFilter`, `textColorFilter` | Compiled `RegExp` response filters. |

### Events emitted by the code

| Event | Payload | Emitted from |
| --- | --- | --- |
| `msg` | message (string or object) | Throughout; default prints to console, overridden by `host.msg`. |
| `data` | raw chunk | `_connect` stream handler; also consumed internally by `_onData`. |
| `stderrData` | raw chunk | `_connect` stream stderr handler; default prints to `console.error`. |
| `error` | `(err, type, close = false, callback)` | Connection, shell, stream, timeout, sudo, and nested-SSH failures. |
| `end` | `(sessionText, sshObj)` | Stream `finish`, `_previousHost`, `_nextPrimaryHost`. |
| `commandProcessing` | `(command, response, sshObj, stream)` | `_onData` while a command is still producing output. |
| `commandComplete` | `(command, response, sshObj)` | `_commandComplete` after a prompt is detected. |
| `commandTimeout` | `(command, response, stream, connection)` | Idle/data-settle timers in `_onData`. |
| `keyboard-interactive` | `(name, instructions, lang, prompts, finish)` | Re-emitted from the `ssh2.Client`. |
| `newPrimaryHost` | value returned by `_nextPrimaryHost`, which is `_initiate`'s return value: at `connect()` time this is `_stream` (the prototype placeholder `{}` until the shell opens) | `connect` and connection `close`. |
| `pipe` / `Unpipe` | — | Not emitted by the class. These are stream-level concepts; the README events section still lists them and needs an L6 rewrite. |

## Host configuration keys recognized by the code

**Connection and session:** `server`, `hosts`, `commands`, `msg`,
`connectedMessage`, `readyMessage`, `closedMessage`, `showBanner`, `verbose`,
`debug`, `enter`, `streamEncoding`, `window`, `pty`, `idleTimeOut`,
`dataIdleTime` (undocumented; see `dataIdleTimeOut` below), `sessionText`,
`exitCommands`.

**Prompts and filters:** `standardPrompt`, `passwordPrompt`, `passphrasePrompt`,
`passPromptText`, `asciiFilter`, `disableASCIIFilter`, `textColorFilter`,
`disableColorFilter`.

**Runtime flags:** `pwSent`, `sshAuth`, `sshToNextHost`.

**Event handlers:** `onCommandProcessing`, `onCommandComplete`,
`onCommandTimeout`, `onKeyboardInteractive`, `onData`, `onStderrData`,
`onError`, `onEnd`.

**Nested SSH command options (`server.ssh`):** `forceProtocolVersion`,
`forceAddressType`, `disablePseudoTTY`, `forcePseudoTTY`, `verbose`,
`cipherSpec`, `escape`, `logFile`, `configFile`, `identityFile`, `loginName`,
`macSpec`, `options`.

**Legacy aliases:** `passwordPromt` and `passphrasePromt` are read as fallbacks
for `passwordPrompt` and `passphrasePrompt`.

## README claims that are confirmed by the code

- `connect(callback)` starts the session and returns full session text.
- `sshObj` and `command` are the public state handles.
- The documented prompt keys and defaults are used.
- The documented filter keys and defaults are used.
- `idleTimeOut`, `connectedMessage`, `readyMessage`, `closedMessage`,
  `showBanner`, `verbose`, `debug`, `enter`, `streamEncoding` work as described.
- `onCommandProcessing`, `onCommandComplete`, `onCommandTimeout`,
  `onKeyboardInteractive`, `onData`, `onStderrData`, `onError`, and `onEnd`
  are registered per host.
- Multiple primary hosts, nested `hosts` arrays, notifications, sudo/su prompt
  handling, and `server.ssh` option construction are implemented.
- Fingerprint validation is delegated to `ssh2` through `server.hashMethod` and
  `server.hostVerifier`.

## L1 README corrections

These documentation-only corrections were made at L1 because the README was
wrong, not because the code changed:

- Removed `onPipe` / `onUnpipe` from the host configuration block. Pipe and
  unpipe are stream-level operations, already covered by the API section; the
  class never reads these host handlers.
- Removed the `callback` host property. Only `connect(callback)` is read.
- Corrected the `host.idleTimeout` comment to `host.idleTimeOut`.

## L5 behavior changes (signed off)

These changes intentionally differ from the L0 baseline. Each is covered by a
test that runs against both the current build and the frozen baseline artifact.

- **Debug/verbose gating.** `_systemMsg` emits debug and verbose messages only
  when the host's `debug` / `verbose` flags are enabled. Normal `msg` output is
  unchanged.
- **Listener lifecycle.** Default listeners are installed once; host listeners
  replace defaults; leaving a host detaches both the cached handler and the
  current host handler. Reloading defaults does not attach duplicates.
- **Multi-host back-out.** `_previousHost` now detaches the outgoing host's
  handlers, so a stale `commandComplete` (or similar) handler cannot fire
  against the new current host and repeat `sessionText`. This is the signed-off
  fix for the known multi-host duplication defect.
- **Host tracking.** `this.host` is updated when moving to the next nested host
  and the next primary host, so session/callback text starts with the correct
  host name.
- **Keyboard-interactive.** The event is registered and dispatched under the
  dashed name, host handlers are honored, and the default handler calls
  `finish([''])` instead of stalling the handshake.
- **Restored baseline payloads.** `commandComplete` emits the raw `_buffer`;
  `hostHash` is written to `sshObj.server.hostHash`; the legacy
  `msg: { send }` shape is mapped to `msg`; the default keyboard response is
  `''`.

## README vs code discrepancies

| # | README claim | Code reality | Impact | Action |
| --- | --- | --- | --- | --- |
| 1 | `dataIdleTimeOut: 500` | Reads `dataIdleTime`; the internal timer variable has the same name | Documented key is ignored | Open (future L5+): map `dataIdleTimeOut` to internal `dataIdleTime` |
| 2 | `window: false` default | `window` is forced to `true` when falsy | Explicit `false` cannot be used | Open (future L5+): nullish/undefined check |
| 3 | `pty` is not documented | `pty` defaults to and is forced to `true` | `{ pty: false }` cannot be used | Open (future L5+): nullish/undefined check |
| 4 | `.unpipe(stream)` | `unpipe` is undefined on instances | Calling it throws `TypeError` | Open (future L5+/L6): add it or remove the claim |
| 5 | `onPipe` / `onUnpipe` host handlers | Never read | Redundant | **Resolved at L1** (removed from README) |
| 6 | `pipe` / `Unpipe` events on the instance | Not emitted by the class; stream-level only | Listeners never fire | L6: rewrite the events section |
| 7 | `host.callback` | Only `connect(callback)` is read | Ignored | **Resolved at L1** (removed from README) |
| 8 | `SSH2Shell extends events.EventEmitter` | Extends legacy `stream.Stream` | Mostly compatible, but not the documented base | L6: document accurately |
| 9 | `forceProtocolVersion: true/false` | Appends the value literally (`-xtrue`) | Produces an invalid ssh flag | Open (future L5+): valid flag mapping |
| 10 | `forceAddressType: true/false` | Appends the value literally | Produces an invalid ssh flag | Open (future L5+): valid flag mapping |
| 11 | `asciiFilter` default `[^\r\n\x20-\x7e]` | Default regex is `[^\t\r\n\x20-\x7e]` | Tab is preserved in code but stripped by the documented filter | L6: align docs and code |
| 12 | `host.idleTimeout` in a comment | Actual key is `idleTimeOut` | Documentation typo | **Resolved at L1** |
| 13 | `onError` says `this.connection.close()` | Code uses `_stream.close()` / `connection.end()` | Misleading guidance | L6: correct docs |
| 14 | `.emit("eventName", function, parms, ...)` | `emit(name, ...args)` | Misleading API description | L6: correct docs |
| 15 | `passwordPromt` / `passphrasePromt` | Supported aliases, undocumented | Works, but undocumented | L6: document aliases |
| 16 | `window` passed to `ssh2` | Code passes the value as the `window` argument to `connection.shell` | A forced `true` may not match the intended pty settings | Open (future L5+): see truthiness audit |
| 17 | Prompts/filters are per host | Compiled once per instance and reused across hosts | Nested/primary hosts can inherit the first host's filters | Open (future L5+): compile per host |
| 18 | Sudo errors are reported | Error is only emitted when `debug` is true | Incorrect sudo passwords can fail silently | Open (future L5+): emit regardless of `debug` |

## `dataIdleTimeOut` and the internal timer

`_onData` schedules `dataReceivedTimer` with `@dataIdleTime` (source line 84).
The internal variable is `dataIdleTime`. `_loadDefaults` currently reads
`@sshObj.dataIdleTime` (source line 564), so the documented public key
`dataIdleTimeOut` (README line 137) is ignored.

The intended shape is:

- public host key: `dataIdleTimeOut` (milliseconds, default 500)
- internal instance variable: `dataIdleTime` (used by the timer)

A future fix should set `@dataIdleTime = @sshObj.dataIdleTimeOut ? 500`,
optionally falling back to `@sshObj.dataIdleTime` for anyone who used the
undocumented name. This is a behavior fix, not a rename of the internal
variable.

The timer's purpose is to stop the script hanging when a command response does
not satisfy the state-engine tests (for example, a standard prompt is never
detected). It is separate from `idleTimeOut`, which is the command timeout.

## Truthiness defaults audit (`_loadDefaults`)

The code uses `unless @sshObj.X` for many defaults. This is safe when the
documented default is itself falsy and the value is a boolean (`showBanner`,
`verbose`, `debug`, `disableColorFilter`, `disableASCIIFilter`). It is unsafe
for properties whose default is truthy and where `false` is meaningful:

- `window = true unless @sshObj.window` — explicit `false` becomes `true`.
- `pty = true unless @sshObj.pty` — explicit `false` becomes `true`.

`window` is passed as the first argument to
`connection.shell(window, { pty }, callback)`, and `pty` is passed in the options
object. Both should use an undefined/null check (`?`) rather than truthiness so
`false` survives. The same audit should be applied to any new boolean host
property: use `?` (nullish) or `isnt undefined`, not `unless`.

`hosts`, `commands`, `exitCommands`, and `sessionText` also use `unless`, but
empty arrays/strings are truthy or the replacement is equivalent, so they do not
change explicit values. `idleTime` and `dataIdleTime` already use `?`.

## `forceProtocolVersion` / `forceAddressType`

Locations:

- `README.md` lines 688-689 (inside the `host.server.ssh` block).
- `src/ssh2shell.js` (inside `_sshConnect`; baseline CoffeeScript lines 331-332).

Current behavior:

```js
let sshFlags = '-x';
if (this.sshObj.server.ssh.forceProtocolVersion) {
  sshFlags += this.sshObj.server.ssh.forceProtocolVersion;
}
if (this.sshObj.server.ssh.forceAddressType) {
  sshFlags += this.sshObj.server.ssh.forceAddressType;
}
```

The value is appended directly to the flag bundle. With the documented boolean
usage, `forceProtocolVersion: true` produces `-xtrue`; `forceAddressType: true`
produces `-xtrue` as well. Both are invalid `ssh` flags, so these options are
effectively unusable as documented.

Valid `ssh` CLI flags for the underlying concepts are:

- `-1` / `-2` — force protocol version 1 / 2.
- `-4` / `-6` — force IPv4 / IPv6 address family.

There is no boolean `-x` variant. Proposed future handling, subject to sign-off
because it changes behavior for anyone who currently passes these keys:

- Accept an explicit value and map it to an allow-listed flag, appended as a
  separate token: `forceProtocolVersion: 2` → ` -2`; `forceAddressType: 4` →
  ` -4`. (The current code appends without a separator, so the mapping must
  include one.)
- Reject anything outside the allow-list with a clear `error` event.
- If boolean compatibility is required, define `true` as a sane default
  (`-2` for protocol, `-4` for address) and document it. Otherwise, treat
  `true` as invalid and explain the required value.

## Defects and quirks confirmed by the L1 harness

These are recorded so a refactor does not accidentally "fix" them without
sign-off:

1. `_nextPrimaryHost`'s empty-queue branch uses `@_runExit` (a reference)
   instead of `@_runExit()`. In the normal flow `_nextPrimaryHost` is only
   re-entered when `_hosts.length > 0` (from the connection `close` handler), so
   this branch is latent/dead code rather than the nested-host back-out path.
   Backing out of secondary hosts is `_runExit`'s job (see
   [Host model](#host-model-primary-and-secondary-hosts)).
2. `_connections` and `sshObj` are class-body objects on the prototype. Before
   `connect()` assigns an own `sshObj`, two instances share them.
   **Fixed at L5:** the constructor now assigns per-instance `sshObj` and
   `_connections`.
3. The constructor listens for `newPrimmaryHost` (typo) while the code emits
   `newPrimaryHost`; the constructor listener is dead code.
4. `connect()` emits `newPrimaryHost` with the *return value* of
   `_nextPrimaryHost` (the shell stream placeholder, not a handler).
5. `_removeListeners` removes the `stderrData` listener twice.
6. `_sanitizeResponse` uses `command.substr(0, buffer.length)`; this can remove
   unintended text when the buffer is shorter than or unrelated to the command.
7. The constructor's `keyboard-interactive` listener only logs; it never calls
   `finish(prompts)`. A host that enables `tryKeyboard` without its own handler
   can hang. **Fixed at L5:** the default handler calls `finish([''])`.
8. `_loadDefaults` only compiles filters and prompt regexes when the instance
   property is empty, so they persist across hosts.
9. `_previousHost` does not call `_removeListeners`, unlike `_nextHost` and
   `_nextPrimaryHost`. The previous secondary host's event handlers stay
   attached, so a later `commandComplete` (or similar) can fire a stale handler
   with the now-current host as `sshObj`. A handler that appends
   `sshObj.sessionText` to the final output therefore repeats the current host's
   text each time the chain changes. **Fixed at L5 (signed off):** `_previousHost`
   calls `_removeListeners`, and `test/unit/hosts.test.js` asserts the baseline
   leak and the current clean result in the same test.

## Verification

```bash
npm run test:unit       # offline, mocked ssh2, current lib/
npm run test:baseline   # same suite against the frozen L0 artifact
npm test                # both of the above
npm run build           # copies src/ssh2shell.js to lib/ssh2shell.js
```

The harness lives in `test/unit/` and injects a fake `ssh2` module through the
require cache, so it never opens a network connection. `test:baseline` sets
`SSH2SHELL_TEST_MODULE` to `test/fixtures/baseline-ssh2shell.js`, the frozen
compiled L0 artifact.
