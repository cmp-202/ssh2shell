# Error handling and connection termination review

- **Scope:** every `error` event the code emits, what payload it carries, whether
  it closes the shell stream, and how the session ends or continues afterwards.
- **Source of truth:** `src/ssh2shell.js` (current build). `lib/ssh2shell.js` is
  its published copy.
- **Comparison target:** `test/fixtures/baseline-ssh2shell.js`, the frozen L0
  artifact, run with `SSH2SHELL_TEST_MODULE`.
- **Method:** code reading plus offline probes against the mocked `ssh2` in
  `test/unit/helpers/`. No live hosts.

The review originally required sign-off for every behavior change. The fixes
were signed off and implemented; see [Implemented changes](#implemented-changes-signed-off)
and the findings table for the final status.

## The `error` event contract

All internal failures are emitted on the `SSH2Shell` instance as:

```js
this.emit('error', err, type, close = false, callback);
```

| Argument | Meaning |
| --- | --- |
| `err` | An `Error` for transport failures, otherwise a message string. `Connection close` now carries an `Error` with `level` and `hadError` properties. |
| `type` | Short label for the failure source, such as `Connection` or `Command Timeout`. |
| `close` | When truthy and a live shell stream exists, the default listener calls `this._stream.close()`. |
| `callback` | Optional follow-up. The default listener calls it before closing (L6). |

The constructor installs a default `error` listener. From L6 the host `onError`
handler is prepended, so the host handler observes the error before the default
listener closes the stream.

Default listener behavior:

1. Emit a debug `msg` (only when `debug` is on).
2. Emit an unconditional `msg`: `Error: <message>, Level: <level>` for `Error`
   instances, otherwise `<type> error: <err>`.
3. If `callback` is a function, call `callback.call(this, err, type, close)`.
4. If `close` is truthy and `_hasLiveStream()` is true, call
   `this._stream.close()`.

`_stream` is the prototype placeholder `{}` until the shell callback assigns a
real stream. From L6 it is reset before each new primary host, so an early error
cannot close the previous host's stream.

## Emit sites

`close` is the value passed to the default listener, not necessarily a direct
call to `close()`.

| # | Source | Trigger | Emitted payload `(err, type, close, callback)` | Close | Flow immediately after emit | Effect on session |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `_processSudoPrompt` | Sudo password rejected (`pwSent` true) or no password configured | **No `error` event** (current). Baseline emitted `("<host>: Sudo password was incorrect...", "Sudo authentication")` when `debug` was on. | n/a | Set `sshObj.sudoFailed = true`, emit a normal `msg`, then `_resetFromSudoError()`: append buffer to `sessionText`, clear buffer/command, write `Ctrl-C`. With `abortOnSudoFailure: true`, `stop('sudo-failed')`. | Notification only by default. Connection stays open; the sudo command is cancelled and the session continues. |
| 2 | `_sshConnect` | `buildSshCommand` returns an error (security alert) | `(result.error, "Security Alert", true)` | `true` | `return` | Closes the current shell stream, which ends the connection. Remaining secondary hosts are not resumed. |
| 3 | `_processSSHPrompt` | Nested SSH authentication fails after the password/passphrase was sent | `("<host>: SSH authentication failed for <user>@<host>", "SSH multi host authentication failure")` | `false` | `_previousHost()` if `_connections` is non-empty, otherwise `_runExit()` | No direct close. The back-out/exit path eventually closes or resumes the previous host. |
| 4 | `_loadDefaults` default `onCommandTimeout` | Command idle timer fires on the final attempt | `("<host>: Command timed out after <n> seconds", "Command Timeout", true, callback)` | `true` | None | With `commandTimeoutRetries` set, non-final attempts return without closing and the library re-arms; only the final attempt closes. The default listener now runs the callback (saving `_buffer` to `sessionText` and clearing it) before closing the stream. |
| 5 | `_connect` shell callback | `connection.shell` returns an `Error` | `(err, "Shell", <live>)` | `true` only when a stream was supplied | `return` | Closes the supplied stream. With no stream the error is reported without a close, and the guarded default listener cannot throw. |
| 6 | `_connect` stream `error` | The shell stream emits `error` | `(err, "Stream", true)` | `true` (baseline: no close) | None | Current: closes the stream, ends the connection. Baseline: leaves the stream/connection open. |
| 7 | `_connect` stream `data` handler | A `data` listener throws | `(err, "Stream.read error", true)` with `err.level = "Data handling"` | `true` | None | Closes the stream, ends the connection. |
| 8 | `_connect` connection `error` | The `ssh2.Client` emits `error` | `(err, "Connection", <live>)` | `true` only once a shell stream exists | None | Before the shell opens this is a notification (`close=false`) and the guarded listener does not throw. Once a stream exists it closes and ends the connection. Baseline: always reports without closing. |
| 9 | `_connect` connection `close` | `ssh2` reports `had_error` truthy | `(Error("Connection closed with error"), "Connection close")` with `err.level = "Connection close"` and `err.hadError = had_error` | `false` | Clear timers, `_finalizeRun()`, then call `_callback(_allSessions)` or start the next primary host | Non-fatal. The readable error is reported, every visited host is finalized, and the session still finishes or advances. |
| 10 | `_connect` connect `try` | `connection.connect` throws synchronously | `(e + " " + e.stack, "Connection.connect", <live>)` | `true` only once a shell stream exists | None | Before the shell opens this is a notification and the guarded listener does not throw. `_stream` is reset per primary host, so a stale stream is never closed. |
| 11 | `_connect` missing parameters | No `sshObj.server` or no `sshObj.commands` | `("Missing connection parameters", "Parameters", false, callback)` | `false` | None | No close. The default listener now runs the diagnostic callback, which prints `server` and `commands`; the session still neither starts nor ends. |

## Notification vs terminator

Not every failure should be an `error` event. The current classification is:

| Class | Emit sites | Meaning |
| --- | --- | --- |
| **Terminator** (`close=true`) | Security Alert, Command Timeout, Stream, Stream.read error, and Shell/Connection/Connection.connect **once a live shell stream exists** | The current connection cannot continue; closing the stream is the intended way to end it. |
| **Notification** (`close=false`) | Pre-shell Shell/Connection/Connection.connect errors, missing connection parameters, sudo password rejection | The error is reported but nothing is closed. Sudo rejection emits a normal `msg` (and sets `sudoFailed`) instead of an `error`. |
| **Flow control** (`close=false`) | Nested SSH authentication failure, Connection close (`had_error`) | The error is reported, but the existing back-out/advance logic decides what happens next. Connection close finalizes the visited hosts first. |

The rule: only emit a closing `error` when a live connection must end. Before a
shell stream exists there is nothing to close, so Shell, Connection, and
Connection.connect errors are notifications. `_hasLiveStream()` decides this at
emit time. The guarded default listener never throws on the prototype `{}`
placeholder.

The host `onError` handler is prepended, so it observes the error before the
default listener closes the stream. The default `error` listener is tracked
separately from host handlers and is installed exactly once.

## How a close actually terminates the session

There is no `process.exit` anywhere in the code. Termination is cooperative and
depends on the stream and connection events:

```text
emit('error', ..., close=true)
  -> default listener -> this._stream.close()
       -> stream 'finish'  -> _finalizeHost(): append session text; emit 'end' once per host
       -> stream 'close'   -> this.connection.end()
            -> connection 'close' (had_error=false)
                 -> clear idle/data timers; _finalizeRun(); emit closedMessage
                 -> if _hosts is empty: _callback(_allSessions)
                 -> otherwise: emit 'newPrimaryHost' -> _nextPrimaryHost -> next _connect
```

Consequences:

- **A truthy `close` is the only normal way an `error` ends a connection.**
  Errors with `close=false` leave the stream open and rely on a later exit path
  (`_runExit`, `_previousHost`) or on the caller to close.
- **A throw inside a listener aborts the emit.** If the default listener throws,
  later listeners (including the host's `onError`) do not run.
- **An `error` event with no listeners throws** (standard `EventEmitter`
  behavior). The default listener normally prevents that, but removing it or
  calling `removeAllListeners('error')` turns any later error into an uncaught
  exception.
- **Nothing guarantees the connection closes.** If an error path neither closes
  the stream nor reaches `_runExit`, the connection and timers can keep the
  process alive.

## Findings

| ID | Finding | Baseline | Current | Severity | Sign-off needed |
| --- | --- | --- | --- | --- | --- |
| F1 | A connection `error` before the shell opens throws `TypeError: this._stream.close is not a function`, so the host `onError` listener never runs. | Does not throw: `Connection` errors are emitted with no close. | Throws, because L5 passes `close=true`. | High (crash) | **Resolved:** guarded close; pre-shell errors report with `close=false`. |
| F2 | `Connection` and `Stream` errors close the shell stream and end the session. | Only report the error; stream and connection stay open. | Close the stream, which triggers `connection.end()`, the callback, or the next primary host. | High (behavior change) | **Resolved:** classify by live stream — pre-shell non-fatal, post-shell terminate. |
| F3 | `_stream.close()` is unguarded. | Shell errors and `Connection.connect` throws can hit the `{}` placeholder or an undefined stream. | Same, plus F1's connection-error path. | High (crash) | **Resolved:** `_hasLiveStream()` guards every close. |
| F4 | The default listener ignores `callback`. | Same. | Same. | Medium: command-timeout text is not appended to `sessionText`; missing-parameter diagnostics are never printed. | **Resolved:** the callback runs before the close, with the shell as `this`. |
| F5 | The default listener is registered before the host `onError`, and closes the stream before the host handler runs. | Same. | Same. | Medium: a host cannot observe the error before termination. | **Resolved:** host `onError` is prepended and runs before the default close. |
| F6 | Default `error` listeners accumulate. After a host with `onError` is followed by a host without it, `_loadDefaultListeners` installs another default. | One default listener is installed in the constructor and never duplicated by `_loadDefaults`. | Count grows across that host pattern (`1 -> 2 -> 3 ...`). | Medium (duplicate messages, repeated closes) | **Resolved:** the default listener is tracked separately and installed once. |
| F7 | Sudo authentication failure was emitted as `error` only when `debug` was true. | Conditional `error`. | Visible `msg`, `sshObj.sudoFailed = true`, and optional `abortOnSudoFailure`. No `error` event. | Resolved | Done. |
| F8 | `Connection close` emitted the boolean `had_error` as `err`, then still advanced or called back. | Same. | `Error("Connection closed with error")` with `level` and `hadError`, followed by `_finalizeRun()`. | Resolved | Done. |
| F9 | No `process.exit`; a path that never closes can hang the process. | Same. | Same. | Informational | Design decision. |
| F10 | `_stream` is not reset between primary hosts. | Same. | Same. | Medium: an early error on a later host can close the previous host's stream. | **Resolved:** `_nextPrimaryHost` resets `_stream` before the new host. |
| F11 | The sudo timeout path passes `this._connection`, which is never assigned, as the `commandTimeout` connection argument. | Same. | Same. | Low | **Resolved:** passes `this.connection`. |
| F12 | Post-auth `_processSSHPrompt` output that matches no prompt returns without arming the idle timer. | Same. | Same. | Medium: a silent nested shell can hang. | **Resolved (L6.1):** re-arm the idle timer. |

### F1 reproduction

```js
// NoReady fake client: connect() never emits ready, so no shell stream exists.
const ssh = new SSH2Shell(host);
ssh.ssh2Client = NoReady;
ssh.on('error', () => { /* never runs on current L5 */ });
ssh.connect();
ssh.connection.emit('error', new Error('boom'));
// current: TypeError: this._stream.close is not a function
// baseline: returns normally and emits (Error, "Connection")
```

### F6 reproduction

```js
const withError = createHost({ onError: () => {} });
const ssh = new SSH2Shell(withError);
ssh.sshObj = withError;
ssh._loadDefaults();       // default + host handler = 2
ssh._removeListeners();    // host handler removed, cache cleared = 1
ssh.sshObj = createHost(); // next host has no onError
ssh._loadDefaults();       // baseline: 1; fixed current: 1 (no duplicate)
```

## Implemented changes (signed off)

1. **Guarded the close call.** The default listener now closes only when
   `_hasLiveStream()` is true (a real stream with a `close` method). Pre-shell
   errors no longer throw on the prototype `{}` placeholder.
2. **Classified `Connection` / `Stream` close policy by stream state.** Pre-shell
   Shell/Connection/Connection.connect errors report with `close=false`; once a
   shell stream exists, Connection/Stream errors terminate. `Stream` and
   `Stream.read error` always terminate because the stream exists by definition.
3. **Invoked the callback.** The default listener calls `callback.call(this, ...)`
   after the messages and before the close, so timeout bookkeeping lands in
   `sessionText` before `finish` snapshots it, and missing-parameter diagnostics
   print.
4. **Installed the default `error` listener exactly once.** It is tracked in
   `_defaultErrorListener` and attached only if absent, independent of the host
   `onError` cache.
5. **Sudo authentication failures are a visible notification, not an `error`.**
   The rejection emits a normal `msg`, sets `sshObj.sudoFailed`, and optionally
   calls `stop('sudo-failed')` when `abortOnSudoFailure` is true.
6. **Reset `_stream` per primary host.** `_nextPrimaryHost` sets it to `{}`
   before loading the next host, so an early error cannot close the previous
   host's stream.
7. **Fixed `this._connection` to `this.connection`** in the sudo timeout path.
8. **Prepended the host `onError` handler** so it observes the error before the
   default listener closes the stream.
9. **Made the `Connection close` payload readable.** A truthy `had_error` now
   emits `Error("Connection closed with error")` with `level = "Connection close"`
   and `hadError` set to the original value.
10. **Finalized visited hosts on a transport drop.** The connection `close`
    handler runs `_finalizeRun()` before reporting the close, so the callback and
    `end` events still receive each host's session text.
11. **Added whole-run `stop()` and safe `close()`.** Both avoid writing to a
    closed channel, finalize each visited host once, and call the final callback
    once. `stop()` also runs queued exit commands, bounded by `idleTimeOut`.
12. **Timeout retries close only on the final attempt.** With
    `commandTimeoutRetries` set, the library re-arms the idle timer for each
    non-final attempt and the default handler returns without emitting an
    `error`. The first timeout is still final when the option is `0`, so the
    default behavior is unchanged. Test:
    `test/unit/timeout-retries.test.js`.

### L6.1 follow-ups (signed off)

- **Post-auth nested-SSH timeout.** `_processSSHPrompt` re-arms the idle timer
  when authenticated output matches no prompt, instead of returning with no
  timer. A silent nested shell now times out rather than hanging.
- **Guarded `close()`.** The public `close()` is a no-op before a live stream
  exists, extending the F1/F3 guard to the public method.
- **Empty commands.** `_processNotifications` advances the queue instead of
  leaving the state machine idle.
- **Own SSH option properties.** `buildSshCommand` uses `Object.entries`, so
  inherited properties cannot reach the generated command line.

## Verification

The characterization tests for this review live in
`test/unit/error-handling.test.js` and run against both the current build and
the frozen baseline:

```bash
npm run test:unit
npm run test:baseline
```

Where the current build intentionally differs from the baseline, the test
branches on `isBaseline()` and records the difference. Where a defect exists in
both, the test locks in the current behavior and points at the finding above.

Shutdown and finalization behavior is covered separately by
`test/unit/shutdown.test.js`. The live suite also covers graceful close, sudo
rejection, and a transport drop in `test/live/graceful_close.js`,
`test/live/sudo_rejected.js`, and `test/live/transport_drop.js`.
