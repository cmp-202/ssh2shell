# API baseline and README reconciliation

- **Baseline:** `refactor/L0-baseline` (`v2.0.14`)
- **Source of truth:** `src/ssh2shell.js`, a 1:1 port of the baseline
  `src/ssh2shell.coffee`; `lib/ssh2shell.js` is its published copy.
- **Method:** read the implementation, exercise it with the offline harness in
  `test/unit/`, and compare every documented claim in `README.md` against the
  actual code.
- **Status:** L1 baseline characterization, preserved through L4; L5, L6, and
  L6.1 record the signed-off behavior changes separately.

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
| `close()` | Implemented | Closes the live shell stream. Before the shell opens it is a no-op (L6.1); baseline threw on the prototype `{}` placeholder. |
| `on`, `emit`, `once`, `removeListener` | Inherited | Normal `EventEmitter` API. |
| `pipe(destination)` | Inherited | Legacy `Stream.prototype.pipe`; works by listening to `data`/`end`. |
| `unpipe(destination)` | **Missing** | `Stream.prototype.unpipe` is undefined. The README no longer documents it; `pipe`/`unpipe` are stream-level operations on the instance, not host config. |

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
| `pipe` / `Unpipe` | — | Not emitted by the class. These are stream-level concepts; the README no longer lists them. |

## Host configuration keys recognized by the code

**Connection and session:** `server`, `hosts`, `commands`, `msg`,
`connectedMessage`, `readyMessage`, `closedMessage`, `showBanner`, `verbose`,
`debug`, `exposeCredentials`, `enter`, `streamEncoding`, `window`, `pty`,
`idleTimeOut`, `dataIdleTimeOut` (public timer key; falls back to the
undocumented `dataIdleTime`), `sessionText`, `exitCommands`.

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

**Removed legacy aliases:** the misspelled `passwordPromt` and
`passphrasePromt` fallbacks were removed post-L7. Only `passwordPrompt` and
`passphrasePrompt` are read. The frozen baseline still honours the aliases.

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

- Removed the `callback` host property. Only `connect(callback)` is read.
- Corrected the `host.idleTimeout` comment to `host.idleTimeOut`.

## Post-L5 README corrections (signed off)

- Removed `onPipe` / `onUnpipe` from the host configuration block, the
  `.pipe` / `.unpipe` methods, and the `pipe` / `Unpipe` events. Pipe and unpipe
  are stream-level operations on the instance, not host config or host events.
  The inherited `pipe` remains available.
- Updated `forceProtocolVersion` / `forceAddressType` to show their accepted
  values instead of `true/false`.

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

## L6.1 behavior changes (signed off)

These are the approved robustness follow-ups from the optimisation review. They
are covered by level-aware tests that also run against the frozen baseline.

- **Post-auth nested-SSH timeout.** After the nested `ssh` password/passphrase is
  accepted, output that matches neither a standard prompt nor a repeated
  credential prompt now re-arms the idle timer. Baseline returned without a
  timer, so a silent nested shell could hang indefinitely.
- **Guarded `close()`.** Calling the public `close()` before the shell opens is
  a no-op. Baseline called `close()` on the prototype `{}` placeholder and
  threw `TypeError`.
- **Empty commands.** `_processNotifications` treats an empty command as
  nothing to run and advances to the next queued command. Baseline left the
  state machine idle.
- **Own SSH option properties.** `buildSshCommand` iterates
  `server.ssh.options` with `Object.entries`, so inherited enumerable
  properties cannot leak into the generated `ssh` command. Baseline used
  `for...in`.

## Post-L6.1 behavior changes (signed off)

- **Credential redaction in debug/verbose output.** `_systemMsg` now scrubs the
  configured password and passphrase from every debug/verbose string and masks
  `password` / `passphrase` keys in object dumps (including nested `hosts`
  config). The sudo and nested-SSH credential messages, the verbose
  `runCommand` echo, and the config dump therefore show `[REDACTED]` instead of
  the plaintext value. The frozen baseline logs the raw credentials.
- **`exposeCredentials` (default `false`).** A per-host opt-in that restores the
  raw credential output for fault-finding. It is applied in `_loadDefaults` and
  read by `_systemMsg`; it does not change the connection itself. Test:
  `test/unit/credentials.test.js`.
- **Instance timer base values.** `SSH.idleTime` / `SSH.dataIdleTime` set before
  `connect()` are preserved instead of being replaced by the hard-coded 5000 /
  500 defaults. A host's `idleTimeOut` / `dataIdleTimeOut` still overrides them,
  and leaving a host restores the base. `idleTime` is accepted as a legacy host
  alias for `idleTimeOut`. Test: `test/unit/timers.test.js`.
- **Message listener continuity.** `_removeListeners` keeps the default `msg`
  listener attached while a host is being swapped, so `_systemMsg` debug/verbose
  output is not dropped between hosts. `_loadDefaults` swaps in a host `msg`
  handler when one exists and falls back to the default handler otherwise.
  Tests: `test/unit/l5-behavior.test.js` — message-sink and duplicate-listener
  cases.
- **Single-host message prefix.** Debug/verbose and `msg:` notification
  messages omit the `${host}: ` prefix when the session has one primary host and
  no nested hosts. Multi-host and nested-host sessions keep the prefix. The
  frozen baseline always prefixes. Tests: `test/unit/l5-behavior.test.js` —
  host-prefix cases.

## README vs code discrepancies

| # | README claim | Code reality | Impact | Action |
| --- | --- | --- | --- | --- |
| 1 | `dataIdleTimeOut: 500` | Reads `dataIdleTime`; the internal timer variable has the same name | Documented key is ignored | **Resolved post-L5:** `dataIdleTimeOut` is mapped, with `dataIdleTime` fallback |
| 2 | `window: false` default | `window` is forced to `true` when falsy | Explicit `false` cannot be used | **Resolved post-L5:** nullish check preserves `false` |
| 3 | `pty` is not documented | `pty` defaults to and is forced to `true` | `{ pty: false }` cannot be used | **Resolved post-L5:** nullish check preserves `false` |
| 4 | `.unpipe(stream)` | `unpipe` is undefined on instances | Calling it throws `TypeError` | **Resolved post-L5:** removed from the README; `pipe` is inherited |
| 5 | `onPipe` / `onUnpipe` host handlers | Never read | Redundant | **Resolved post-L5:** removed from the README |
| 6 | `pipe` / `Unpipe` events on the instance | Not emitted by the class; stream-level only | Listeners never fire | **Resolved post-L5:** removed from the README |
| 7 | `host.callback` | Only `connect(callback)` is read | Ignored | **Resolved at L1** (removed from README) |
| 8 | `SSH2Shell extends events.EventEmitter` | Extends legacy `stream.Stream` | Mostly compatible, but not the documented base | **Resolved at L7 (README):** now documents `stream.Stream` |
| 9 | `forceProtocolVersion: true/false` | Appends the value literally (`-xtrue`) | Produces an invalid ssh flag | **Resolved post-L5:** maps to `-1`/`-2`; `true` → `-2` |
| 10 | `forceAddressType: true/false` | Appends the value literally | Produces an invalid ssh flag | **Resolved post-L5:** maps to `-4`/`-6`; `true` → `-4` |
| 11 | `asciiFilter` default `[^\r\n\x20-\x7e]` | Default regex is `[^\t\r\n\x20-\x7e]` | Tab is preserved in code but stripped by the documented filter | **Resolved at L7 (README):** both the config default and the later example now include `\t` |
| 12 | `host.idleTimeout` in a comment | Actual key is `idleTimeOut` | Documentation typo | **Resolved at L1** |
| 13 | `onError` says `this.connection.close()` | Code uses `_stream.close()` / `connection.end()` | Misleading guidance | **Resolved at L7 (README):** guidance now uses `this.connection.end()` |
| 14 | `.emit("eventName", function, parms, ...)` | `emit(name, ...args)` | Misleading API description | **Resolved at L7 (README):** signature is now `emit(name, ...args)` |
| 15 | `passwordPromt` / `passphrasePromt` | Supported aliases, undocumented | Works, but undocumented | **Resolved post-L7:** the misspelled fallbacks were removed; only `passwordPrompt` / `passphrasePrompt` are read |
| 16 | `window` passed to `ssh2` | Code passes the value as the `window` argument to `connection.shell` | A forced `true` may not match the intended pty settings | **Resolved post-L5:** the nullish check preserves `false` and still passes the value to `connection.shell` |
| 17 | Prompts/filters are per host | Compiled once per instance and reused across hosts | Nested/primary hosts can inherit the first host's filters | **Resolved post-L5:** `_loadDefaults` recompiles prompts and filters from the current host |
| 18 | Sudo errors are reported | Error is only emitted when `debug` is true | Incorrect sudo passwords can fail silently | **Resolved post-L5:** sudo rejection is a debug notification; the command is cancelled and the session continues |

## `dataIdleTimeOut` and the internal timer

`_onData` schedules `dataReceivedTimer` with `@dataIdleTime` (source line 84).
The internal variable is `dataIdleTime`. At baseline, `_loadDefaults` reads
`@sshObj.dataIdleTime` (source line 564), so the documented public key
`dataIdleTimeOut` (README line 137) is ignored.

The intended shape is:

- public host key: `dataIdleTimeOut` (milliseconds, default 500)
- internal instance variable: `dataIdleTime` (used by the timer)

**Fixed post-L5:** `_loadDefaults` now resolves the public key first:

```js
const dataIdleTimeOut =
  toPositiveNumber(this.sshObj.dataIdleTimeOut) ||
  toPositiveNumber(this.sshObj.dataIdleTime);
if (dataIdleTimeOut > 0) {
  this.dataIdleTime = dataIdleTimeOut;
}
```

`dataIdleTimeOut` wins; the undocumented `dataIdleTime` remains as a fallback
for existing callers. This is a behavior fix, not a rename of the internal
variable. The timer's purpose is to stop the script hanging when a command
response does not satisfy the state-engine tests (for example, a standard prompt
is never detected). It is separate from `idleTimeOut`, which is the command
timeout.

**Post-L6.1:** timer values can also be set on the instance before `connect()`
(for example `SSH.idleTime = 15000`). The first `_loadDefaults` captures that as
the base; a host `idleTimeOut` / `dataIdleTimeOut` overrides it for that host,
and `_removeListeners` restores the base when leaving the host so the override
does not leak into the next one. Non-positive or non-numeric values are treated
as "not configured". `idleTime` is also accepted as a legacy host alias for
`idleTimeOut`.

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

**Fixed post-L5:** `applyHostDefaults` now uses `== null` for both, so explicit
`window: false` and `pty: false` are preserved. `hosts`, `commands`,
`exitCommands`, and `sessionText` still use truthiness checks, but empty
arrays/strings are truthy or the replacement is equivalent, so they do not
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

There is no boolean `-x` variant.

**Fixed post-L5:** `buildSshCommand` maps these options through an allow-list:

- `forceProtocolVersion: 1` or `2` (number or string) → ` -1` / ` -2`.
  `true` selects the modern default, ` -2`.
- `forceAddressType: 4` or `6` (number or string) → ` -4` / ` -6`.
  `true` selects the IPv4 default, ` -4`.
- `false`, `null`, and `undefined` disable the option.
- Any other truthy value returns a `Security Alert` error
  (`Invalid forceProtocolVersion: <value>` or
  `Invalid forceAddressType: <value>`) instead of producing an invalid flag.

The flags are appended as separate tokens (`ssh -x -2 ...`), so they no longer
merge with `-x`.

## Per-host prompt/filter compilation (resolved post-L5)

`_loadDefaults` runs for every primary host (`_initiate`) and every nested host
(`_nextHost`), so it always has the current `sshObj`. At baseline it only
compiled the regexes when the **instance** property was falsy:

- `asciiFilter` when `this.asciiFilter` is falsy
- `textColorFilter` when `this.textColorFilter` is falsy
- `passwordPrompt` when `this.passwordPrompt` is falsy
- `passphrasePrompt` when `this.passphrasePrompt` is falsy
- `standardPrompt` when `this.standardPrompt` is falsy

After the first host those instance properties were set, so later hosts reused
the first host's compiled regexes. `applyHostDefaults` still updated the `sshObj`
strings, but they were never recompiled.

**Consequence:** a second host with a different `standardPrompt`,
`passwordPrompt`, `passphrasePrompt`, `asciiFilter`, or `textColorFilter` was
still detected and filtered with the first host's patterns. In a chain this could
miss a prompt, time out a command, or filter output incorrectly.

**What "per-host" means:** the compiled regexes must be derived from the current
`sshObj` every time `_loadDefaults` runs. The instance properties
(`this.asciiFilter`, `this.passwordPrompt`, ...) are internal compiled state, not
public config; the public config is `sshObj.*`.

**Fixed post-L5 (signed off):** `_loadDefaults` now always assigns the
compilation result instead of guarding on the instance property:

```js
const ascii = compileAsciiFilter(this.sshObj.asciiFilter);
this.asciiFilter = ascii.filter;

const color = compileTextColorFilter(this.sshObj.textColorFilter);
this.textColorFilter = color.filter;

const prompts = compilePrompts(this.sshObj);
this.passwordPrompt = prompts.passwordPrompt;
this.passphrasePrompt = prompts.passphrasePrompt;
this.standardPrompt = prompts.standardPrompt;
```

The fallback debug messages stay conditional on `debug`.

**Impact:**

- Single-host behavior is unchanged.
- Multi-host behavior changes for hosts with different prompt/filter config.
  That is the intended fix.
- `test/unit/api-baseline.test.js` is level-aware: baseline keeps the stale
  first-host patterns; current recompiles. A two-host test asserts that the
  second host's regex matches.
- Directly assigning `ssh.passwordPrompt = /.../` on the instance is not a
  documented config path and would be overwritten; use `host.passwordPrompt`.

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
   property is empty, so they persist across hosts. **Fixed post-L5 (signed
   off):** compiled state is rebuilt from the current host on every call. See
   [Per-host prompt/filter compilation](#per-host-promptfilter-compilation-resolved-post-l5).
9. `_previousHost` does not call `_removeListeners`, unlike `_nextHost` and
   `_nextPrimaryHost`. The previous secondary host's event handlers stay
   attached, so a later `commandComplete` (or similar) can fire a stale handler
   with the now-current host as `sshObj`. A handler that appends
   `sshObj.sessionText` to the final output therefore repeats the current host's
   text each time the chain changes. **Fixed at L5 (signed off):** `_previousHost`
   calls `_removeListeners`, and `test/unit/hosts.test.js` asserts the baseline
   leak and the current clean result in the same test.
10. Error handling had several latent defects and one L5 behavior change:
    `_stream.close()` was unguarded, connection/stream errors gained `close=true`
    at L5 (baseline only reported them), the default listener ignored its
    callback, and default `error` listeners could accumulate after a host with
    `onError` was followed by one without. **Fixed post-L5 (signed off):** the
    close is guarded, Shell/Connection/Connection.connect classify by live
    stream state, the callback runs before the close, the host `onError` runs
    before the default close, the default listener is installed once, `_stream`
    is reset per primary host, and the sudo timeout uses `this.connection`. Sudo
    rejection was converted from a conditional `error` to a debug notification.
    See `docs/ERROR-HANDLING.md` for the emit-site map and F1-F11.

## Verification

```bash
npm run test:unit       # offline, mocked ssh2, current lib/
npm run test:src        # same suite against src/ before building
npm run test:lib        # same suite against lib/
npm run test:baseline   # same suite against the frozen L0 artifact
npm test                # check:build, then lib and baseline
npm run check:build     # fails if lib/ differs from src/
npm run build           # copies src/ssh2shell.js to lib/ssh2shell.js
npm pack --dry-run      # show the published tarball contents
```

The harness lives in `test/unit/` and injects a fake `ssh2` module through the
require cache, so it never opens a network connection. `test:src`, `test:lib`,
and `test:baseline` all use `scripts/run-tests.js` to set
`SSH2SHELL_TEST_MODULE` to `src/ssh2shell.js`, `lib/ssh2shell.js`, or
`test/fixtures/baseline-ssh2shell.js`. You can also pass a module path directly:
`node scripts/run-tests.js src/ssh2shell.js`.

`scripts/run-tests.js` passes the test files explicitly rather than a directory,
so the suite also runs on Node 18. CI runs `npm test` and `npm pack --dry-run` on
Node 18, 20, 22, and 24; the package publishes only `lib/` plus the README,
`LICENSE`, and `package.json`, and `prepublishOnly` runs the full suite before a
publish.
