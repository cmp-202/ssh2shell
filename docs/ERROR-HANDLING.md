# Error handling and connection termination review

- **Scope:** every `error` event the code emits, what payload it carries, whether
  it closes the shell stream, and how the session ends or continues afterwards.
- **Source of truth:** `src/ssh2shell.js` (current L5). `lib/ssh2shell.js` is its
  published copy.
- **Comparison target:** `test/fixtures/baseline-ssh2shell.js`, the frozen L0
  artifact, run with `SSH2SHELL_TEST_MODULE`.
- **Method:** code reading plus offline probes against the mocked `ssh2` in
  `test/unit/helpers/`. No live hosts.

This is a review, not a fix. Every behavior change below needs sign-off, per the
compatibility contract in `REFACTORING.md`.

## The `error` event contract

All internal failures are emitted on the `SSH2Shell` instance as:

```js
this.emit('error', err, type, close = false, callback);
```

| Argument | Meaning |
| --- | --- |
| `err` | An `Error` for transport failures, otherwise a message string (or, for `Connection close`, a boolean). |
| `type` | Short label for the failure source, such as `Connection` or `Command Timeout`. |
| `close` | When truthy, the default listener calls `this._stream.close()`. |
| `callback` | Optional follow-up. **The default listener never calls it.** |

The constructor installs a default `error` listener before any host
`onError` listener. Node calls listeners in registration order, so the default
listener always runs first, even when the host supplies `onError`.

Default listener behavior:

1. Emit a debug `msg` (only when `debug` is on).
2. Emit an unconditional `msg`: `Error: <message>, Level: <level>` for `Error`
   instances, otherwise `<type> error: <err>`.
3. If `close` is truthy, call `this._stream.close()` **without checking that
   `_stream` exists or has a `close` method**.
4. Ignore `callback`.

`_stream` is the prototype placeholder `{}` until the shell callback assigns a
real stream. It is also not reset between primary hosts, so an early error on a
later host can still point at the previous host's stream.

## Emit sites

`close` is the value passed to the default listener, not necessarily a direct
call to `close()`.

| # | Source | Trigger | Emitted payload `(err, type, close, callback)` | Close | Flow immediately after emit | Effect on session |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `_processSudoPrompt` | Sudo password rejected (`pwSent` true) | **No `error` event** (current). Baseline emitted `("<host>: Sudo password was incorrect...", "Sudo authentication")` when `debug` was on. | n/a | `_resetFromSudoError()`: append buffer to `sessionText`, clear buffer/command, write `Ctrl-C` | Notification only. Connection stays open; the sudo command is cancelled. Current emits a debug `msg`. |
| 2 | `_sshConnect` | `buildSshCommand` returns an error (security alert) | `(result.error, "Security Alert", true)` | `true` | `return` | Closes the current shell stream, which ends the connection. Remaining secondary hosts are not resumed. |
| 3 | `_processSSHPrompt` | Nested SSH authentication fails after the password/passphrase was sent | `("<host>: SSH authentication failed for <user>@<host>", "SSH multi host authentication failure")` | `false` | `_previousHost()` if `_connections` is non-empty, otherwise `_runExit()` | No direct close. The back-out/exit path eventually closes or resumes the previous host. |
| 4 | `_loadDefaults` default `onCommandTimeout` | Command idle timer fires | `("<host>: Command timed out after <n> seconds", "Command Timeout", true, callback)` | `true` | None | Closes the stream and ends the session. The callback that would append `_buffer` to `sessionText` and clear it **never runs**. |
| 5 | `_connect` shell callback | `connection.shell` returns an `Error` | `(err, "Shell", true)` | `true` | `return` | Closes the supplied stream. If `ssh2` passes no stream, `this._stream.close` throws. |
| 6 | `_connect` stream `error` | The shell stream emits `error` | `(err, "Stream", true)` | `true` (baseline: no close) | None | Current: closes the stream, ends the connection. Baseline: leaves the stream/connection open. |
| 7 | `_connect` stream `data` handler | A `data` listener throws | `(err, "Stream.read error", true)` with `err.level = "Data handling"` | `true` | None | Closes the stream, ends the connection. |
| 8 | `_connect` connection `error` | The `ssh2.Client` emits `error` | `(err, "Connection", true)` | `true` (baseline: no close) | None | Current: closes the stream, ends the connection. Before the shell opens, `_stream` is `{}` and this throws. Baseline: only reports, leaves the connection open. |
| 9 | `_connect` connection `close` | `ssh2` reports `had_error` truthy | `(had_error, "Connection close")` | `false` | Clear timers, then call `_callback(_allSessions)` or start the next primary host | Non-fatal. The error is reported and the session still finishes or advances. |
| 10 | `_connect` connect `try` | `connection.connect` throws synchronously | `(e + " " + e.stack, "Connection.connect", true)` | `true` | None | Attempts to close the stream. Before the shell opens this throws; on a later primary host it can close a stale stream from the previous host. |
| 11 | `_connect` missing parameters | No `sshObj.server` or no `sshObj.commands` | `("Missing connection parameters", "Parameters", false, callback)` | `false` | None | No close and no callback. The diagnostic callback that would print `server` and `commands` never runs; the session neither starts nor ends. |

## Notification vs terminator

Not every failure should be an `error` event. The current classification is:

| Class | Emit sites | Meaning |
| --- | --- | --- |
| **Terminator** (`close=true`) | Security Alert, Command Timeout, Shell, Stream, Stream.read error, Connection, Connection.connect | The current connection cannot continue; closing the stream is the intended way to end it. |
| **Flow control** (`close=false`) | Nested SSH authentication failure, Connection close (`had_error`) | The error is reported, but the existing back-out/advance logic decides what happens next. |
| **Notification** | Sudo password rejection (current: debug `msg`; baseline: conditional `error`) | The command was cancelled and the session continues. Raising `error` added noise without changing termination. |
| **Unclassified** | Missing connection parameters | No close and no callback. The session neither starts nor ends, so it is neither a notification nor a clean terminator. Needs a decision. |

The rule going forward: only emit `error` when the caller must know the
connection is ending or the flow has changed. Otherwise use `_systemMsg` or a
non-error event. Sudo rejection now follows that rule; the remaining
`close=false` sites still need their own sign-off before changing.

## How a close actually terminates the session

There is no `process.exit` anywhere in the code. Termination is cooperative and
depends on the stream and connection events:

```text
emit('error', ..., close=true)
  -> default listener -> this._stream.close()
       -> stream 'finish'  -> append session text; emit 'end' when no primary hosts remain
       -> stream 'close'   -> this.connection.end()
            -> connection 'close' (had_error=false)
                 -> clear idle/data timers; emit closedMessage
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
| F1 | A connection `error` before the shell opens throws `TypeError: this._stream.close is not a function`, so the host `onError` listener never runs. | Does not throw: `Connection` errors are emitted with no close. | Throws, because L5 passes `close=true`. | High (crash) | Yes: restore the baseline close flag and/or guard `_stream.close()`. |
| F2 | `Connection` and `Stream` errors close the shell stream and end the session. | Only report the error; stream and connection stay open. | Close the stream, which triggers `connection.end()`, the callback, or the next primary host. | High (behavior change) | Yes: keep the new behavior or restore baseline. |
| F3 | `_stream.close()` is unguarded. | Shell errors and `Connection.connect` throws can hit the `{}` placeholder or an undefined stream. | Same, plus F1's connection-error path. | High (crash) | Yes: guard the call. |
| F4 | The default listener ignores `callback`. | Same. | Same. | Medium: command-timeout text is not appended to `sessionText`; missing-parameter diagnostics are never printed. | Yes: calling it changes observable behavior. |
| F5 | The default listener is registered before the host `onError`, and closes the stream before the host handler runs. | Same. | Same. | Medium: a host cannot observe the error before termination. | Yes if listener order changes. |
| F6 | Default `error` listeners accumulate. After a host with `onError` is followed by a host without it, `_loadDefaultListeners` installs another default. | One default listener is installed in the constructor and never duplicated by `_loadDefaults`. | Count grows across that host pattern (`1 -> 2 -> 3 ...`). | Medium (duplicate messages, repeated closes) | Arguably an L5 regression fix; confirm. |
| F7 | Sudo authentication failure was emitted as `error` only when `debug` was true. | Conditional `error`. | **Fixed in the backlog:** debug `msg` notification, no `error`. | Resolved | Done. |
| F8 | `Connection close` emits the boolean `had_error` as `err`, then still advances or calls back. | Same. | Same. | Informational: errors are non-fatal on this path; the message is `Connection close error: true`. | Only if the semantics change. |
| F9 | No `process.exit`; a path that never closes can hang the process. | Same. | Same. | Informational | Design decision. |
| F10 | `_stream` is not reset between primary hosts. | Same. | Same. | Medium: an early error on a later host can close the previous host's stream. | Yes if resetting. |
| F11 | The sudo timeout path passes `this._connection`, which is never assigned, as the `commandTimeout` connection argument. | Same. | Same. | Low | Yes if corrected to `this.connection`. |

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
ssh._loadDefaults();       // current: adds another default = 2; baseline: 1
```

## Recommended changes (all require sign-off)

1. **Guard the close call.** In the default listener:

   ```js
   if (close && this._stream && typeof this._stream.close === 'function') {
     this._stream.close();
   }
   ```

   This removes the pre-shell and undefined-stream crashes without changing any
   successful path.

2. **Decide the `Connection` / `Stream` close policy.** Restoring the baseline
   flags (`close=false`) keeps pre-shell errors non-fatal and matches the
   compatibility contract. Keeping `close=true` is arguably more robust, but it
   is an L5 behavior change and should be recorded as one.

3. **Invoke the callback after the default handling** if the callback is a
   function. This restores the intended timeout bookkeeping and missing-parameter
   diagnostics, but changes `sessionText` and `msg` output.

4. **Install the default `error` listener exactly once.** Track it separately
   from the host `onError` cache, or do not delete the cache entry when detaching
   a host handler, so `_loadDefaultListeners` cannot add duplicates.

5. **Done in the backlog: sudo authentication failures are a debug `msg`, not
   an `error`.** No further sign-off needed for that notification change.

6. **Reset or validate `_stream` per host.** Set it to `null`/`{}` when starting
   a primary host, or check that it belongs to the current connection before
   closing it.

7. **Fix `this._connection` to `this.connection`** in the sudo timeout path.

## Verification

The characterization tests for this review live in
`test/unit/error-handling.test.js` and run against both the current build and
the frozen baseline:

```bash
npm run test:unit
npm run test:baseline
```

Where current L5 intentionally differs from the baseline, the test branches on
`isBaseline()` and records the difference. Where a defect exists in both, the
test locks in the current behavior and points at the finding above.
