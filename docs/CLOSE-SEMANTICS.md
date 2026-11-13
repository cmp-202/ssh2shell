# Stopping and closing: behavior and semantics

- **Scope:** what happens to the command queue, hosts, `sessionText`, the shell
  stream, the SSH connection, and process output when a run is stopped from an
  event handler or by a timeout.
- **Source of truth:** `src/ssh2shell.js` (current build). `lib/ssh2shell.js` is
  its published copy.
- **Status:** R1–R8 are implemented and covered by
  `test/unit/shutdown.test.js` plus the live stop/close tests. Open question 5 is
  still pending; see [Open questions](#open-questions).

## Why this matters

Provisioning is a long, linear state machine: many commands, frequent `sudo`,
sometimes nested hosts, and a final callback whose `sessionText` is checked for
markers. The worst outcomes are:

- a failure that silently continues into later commands;
- a stop that loses the text of the command that failed;
- a stop that leaves the callback without the final host's text;
- a stop that leaves a `sudo` or nested shell open;
- a stop whose reason is only visible with `debug`.

The API now separates "stop this host", "skip the remaining hosts", "abort the
whole run", and "close the current connection", so those outcomes are explicit.

## Current state machine

The normal finish path is:

```text
command completes
  -> _commandComplete(): response is appended to sshObj.sessionText
  -> commandComplete event
  -> _applyHandlerFlags(): consume abort/stop/skip* flags set by the handler
  -> _nextCommand(): shift the next command, or _runExit()
       -> _runExit(): queued exitCommands
                   -> sshObj.hosts (nested hosts)
                   -> _connections (back out to the previous host)
                   -> literal 'exit'
                   -> close()
  -> close(): _finalizeHost() then _stream.close()
       -> stream 'finish': _finalizeHost()
       -> stream 'close': connection.end()
            -> connection 'close': clear timers; _finalizeRun();
                                   closedMessage or error;
                                   final callback or the next primary host
```

`_commandComplete()` appends the response **before** it emits
`commandComplete`. That is why clearing the queue in `onCommandComplete` still
keeps the completed command's output.

The shutdown paths are:

```text
stop(reason)
  -> clear every command queue, every nested hosts queue, and _hosts
  -> keep sshObj.exitCommands
  -> if a command is in flight: Ctrl-C, wait for prompt or idleTimeOut
  -> run queued exit commands (bounded by idleTimeOut)
  -> _finalizeRun(): one `end` per visited host, nested text merged
  -> close once; callback once; `Stop requested: <reason>`

close() / close({ graceful: true })
  -> finalize the current host and ancestors
  -> continue with remaining primary hosts (compatibility)
  -> graceful: clear queues, run exit commands, back out of nested shells
```

## Current outcomes (implemented)

| Action | Remaining commands | Nested and primary hosts | `sessionText` and `end` | Stream and connection | Process output |
| --- | --- | --- | --- | --- | --- |
| Queue empties (default) | none | nested hosts run, then remaining primary hosts | every response is added; `end` fires per host | stream closes when the run is done | progress ends; `closedMessage` on a clean close |
| `sshObj.commands.length = 0` or `sshObj.skipCommands = true` in `onCommandComplete` | current host stops | that host's nested hosts still run; remaining primary hosts still run | response already added; `end` once per visited host | normal close | progress ends; normal close message |
| also `sshObj.hosts.length = 0` or `sshObj.skipHosts = true` | current host stops | that host's own nested hosts are skipped; remaining primary hosts still run | response already added; `end` once per visited host | normal close | progress ends; normal close message |
| `sshObj.skipPrimaryHosts = true` | current host stops | no further primary hosts | response already added; `end` once per visited host | normal close | progress ends; normal close message |
| `sshObj.abort = true` / `sshObj.stop = true` / `this.stop(reason)` | all queues cleared | no nested or primary hosts run | current response and nested text merged; `end` once per visited host; callback once | one close; queued exit commands run first | progress ends; `Stop requested: <reason>`; `closedMessage` on clean close |
| `this.close()` in a handler | no further writes | current connection ends; remaining primary hosts still connect; current host's nested children are skipped | current host finalized; `end` once per visited host | stream closes, then `connection.end()` | progress ends; `closedMessage` |
| `this.close({ graceful: true })` | no further commands | runs queued exit commands and backs out of nested shells; remaining primary hosts still run | complete for every visited host | one close | progress ends; normal close message |
| `this.connection.end()` | same as `close()` | same as `close()`, but bypasses exit commands and host back-out | text may be missing because finalization is skipped | connection ends directly | progress ends |
| `stream.write('\x03')` (Ctrl-C) | unchanged | unchanged | partial output stays in the buffer | stays open | unchanged |
| Default `onCommandTimeout` | current command ends | remaining primary hosts still connect | the default handler adds the partial buffer to `sessionText` | emits a closing error; stream closes, then the connection | progress ends; error `msg` |

Notes:

- A host `onCommandComplete` or `onCommandTimeout` handler replaces the default
  handler for that host. An instance listener runs in addition.
- `close()` no longer walks the queue. `_nextCommand()`, `_checkCommand()`, and
  `_runCommand()` return early after a close or stop, so no write is attempted on
  a closed channel.
- `stop()` is the only operation that abandons the remaining primary hosts.
  `close()` keeps the earlier "continue with the next primary host" behavior for
  compatibility.
- `sessionText` is finalized by `_finalizeHost()` / `_finalizeRun()`, not only by
  stream `finish`. A transport drop still produces the callback text, and each
  visited host gets one `end`.
- A dropped connection emits an `error` with type `Connection close` whose
  payload is an `Error` (`Connection closed with error`, `level` set to
  `Connection close`, `hadError` set to the original value).
- A rejected `sudo` password is a normal `msg` by default and sets
  `sshObj.sudoFailed`. `abortOnSudoFailure: true` calls `stop('sudo-failed')`.

## Gaps and resolution

| ID | Gap | Status |
| --- | --- | --- |
| G1 | `close()` cannot stop a whole run: the next primary host still connects. | **Resolved by `stop()`.** `close()` keeps the compatibility behavior. |
| G2 | `close()` bypasses `_runExit()`, so queued exit commands and the nested-host text merge do not run. | **Resolved.** `close({ graceful: true })` runs exit commands and backs out; plain `close()` finalizes the current host. |
| G3 | `close()` from `onCommandComplete` does not stop `_nextCommand()`, so the queue is still walked. | **Resolved.** The command loop checks `_closing`/`_runComplete`. |
| G4 | Clearing `sshObj.commands` stops only the current host; nested and primary hosts continue. | **By design.** `stop()` aborts the whole run; `skipPrimaryHosts` skips primaries only. |
| G5 | There is no public way to skip the remaining primary hosts (`_hosts` is private). | **Resolved** by `sshObj.skipPrimaryHosts = true`. |
| G6 | `connection.end()` is exposed through `onCommandTimeout` and bypasses the shell close path. | **Unchanged.** The default timeout handler closes the stream; direct `connection.end()` remains a foot-gun and is documented as such. |
| G7 | The `Connection close` payload is a boolean, and `closedMessage` is skipped on a dropped connection. | **Resolved.** The payload is an `Error`; a clean close still emits `closedMessage`. |
| G8 | `sessionText` finalization depends on stream `finish`, so a drop can lose the last host's text. | **Resolved** by centralized finalization on stream finish, connection close, `close()`, and `stop()`. |
| G9 | A rejected `sudo` password is invisible unless `debug`/`verbose` is on, and later commands fail in sequence. | **Resolved.** Visible `msg`, `sshObj.sudoFailed`, optional `abortOnSudoFailure`. |
| G10 | `close()` before `connect()` is a silent no-op; the run can still start. | **Unchanged.** `close()` before a live stream is still a no-op; `stop()` before `connect()` is also a no-op. |
| G11 | Clearing `sshObj.hosts` skips only the current host's children. Sibling nested hosts queued on a parent still run, and the parent's queue is private. | **Open question 5.** Current behavior is unchanged: only the current host's `hosts` array is cleared. |

## Provisioning experience

`test/provision/provision.js` is the best stress case for these rules. It:

- builds a long command list, nearly all of it `sudo`;
- logs each `commandComplete` response but does not stop on failure;
- relies on the final callback's `sessionText` to find `SSH2SHELL_*_OK` markers;
- reconfigures the network near the end, which can drop or stall the transport.

With the implemented changes:

- A wrong sudo password is a normal `msg`, sets `sudoFailed`, and can abort the
  run with `abortOnSudoFailure: true` (G9).
- A failed command can fail fast with `sshObj.abort`, `sshObj.skipCommands`, or
  `stop()` (G4).
- A transport drop during the final network step still finalizes every visited
  host, so the callback keeps the markers it received (G8).
- `stop()` aborts a multi-host run from one handler; `close()` still lets the
  next primary host connect (G1).
- A close from `commandComplete` no longer tries to write the rest of the queue
  into a closed channel (G3).

## Implemented operations

| Operation | Meaning |
| --- | --- |
| `sshObj.commands.length = 0` / `sshObj.skipCommands = true` | Stop the current host after this command. Let the normal back-out run. |
| `sshObj.hosts.length = 0` / `sshObj.skipHosts = true` | Stop the current host's nested hosts. Continue with the next primary host. |
| `sshObj.skipPrimaryHosts = true` | Stop after the current host; do not connect the remaining primary hosts. |
| `SSH.stop(reason)` / `sshObj.abort = true` / `sshObj.stop = true` | Stop the whole run: no more commands, no more nested or primary hosts. |
| `SSH.close()` | Immediate close of the current shell connection. Remaining primary hosts still run. |
| `SSH.close({ graceful: true })` | Run queued exit commands and back out of nested shells before closing. |

Implemented matrix:

| Action | Commands | Nested / primary hosts | `sessionText` and `end` | Stream and connection | Output |
| --- | --- | --- | --- | --- | --- |
| Clear `commands` / `skipCommands` | current host stops | children and primary hosts continue | complete; `end` once per host | normal close | progress ends; normal close |
| Clear `hosts` / `skipHosts` | current host stops | current host's children skipped; primary hosts continue | complete; `end` once per host | normal close | progress ends; normal close |
| `skipPrimaryHosts` | current host stops | no further primary hosts | complete; `end` once per host | normal close | progress ends; normal close |
| `stop(reason)` | all queues cleared | all remaining hosts skipped | current response and nested text merged; `end` once per visited host; callback once | one close; exit commands run first | progress ends; `Stop requested: <reason>`; `closedMessage` on clean close |
| `close()` | no further writes | current connection ends; primary hosts continue (compat) | current host finalized; `end` once per visited host | one close | progress ends; `closedMessage` |
| `close({ graceful: true })` | no further commands | exit commands and back-out run; primary hosts continue | complete; `end` once per visited host | one close | progress ends; normal close |
| `stream.write('\x03')` | unchanged | unchanged | partial buffer retained | stays open | unchanged |
| Timeout | current command ends | policy from `onCommandTimeout` | partial buffer saved before close | close by default | progress ends; error `msg` |

Behavior in detail:

1. **Command queue:** after a stop or close is requested, no new command is
   shifted and no write is attempted. `_nextCommand()`, `_checkCommand()`, and
   `_runCommand()` check the shutdown flags and `_hasLiveStream()`.
2. **Connections:** a stop closes the shell stream once, then ends the SSH
   connection once. `connection.end()` is never required from a handler.
3. **Hosts:** the current host and every ancestor are finalized exactly once.
   `end` is emitted once per visited host, including nested hosts stopped early.
4. **`sessionText`:** the current response and every visited nested host's text
   are merged before the final callback, even when the transport drops. The
   callback receives the same text written to `end`.
5. **Process output:** progress stops immediately. `debug`/`verbose` report the
   stop reason. A clean close emits `closedMessage`; a dropped connection emits
   an `error` with a readable message. `stderrData` is unchanged.
6. **Reason:** a stop has a reason (`command-failed`, `sudo-failed`, `timeout`,
   `user`, `connection-error`) available as `sshObj.stopReason` and in the
   `Stop requested: <reason>` message.

## Implemented code changes (R1–R8)

R1–R8 were signed off and implemented.

### R1. `stop(reason)` is the whole-run stop

- Clears the current `sshObj.commands`, every nested `hosts` array, and the
  private primary-host queue.
- If a command is in flight, writes Ctrl-C and waits for the prompt or the idle
  timeout before closing.
- Runs the library's queued `exitCommands` (the `exit` it adds when a nested
  `ssh` shell opens) when the shell is still healthy. Explicit `exit` entries in
  `commands` are cleared with the rest of the queue; closing the connection still
  ends any `sudo -i` or `su` shell.
- Closes once and calls the final callback with the complete `sessionText`.
- Records the reason as `sshObj.stopReason` and emits `Stop requested: <reason>`.
- Is a no-op before `connect()` and after the run has finished.

### R2. `close()` is a safe shutdown, not a raw stream call

- Sets `_closing` and makes the queue methods return early.
- Finalizes the current host through `_finalizeHost`/`_finalizeRun` so its text is
  snapshotted and its `end` is emitted exactly once.
- Keeps the existing "continue with the next primary host" behavior for
  compatibility; `stop()` is the whole-run abort.
- `close({ graceful: true })` runs queued exit commands and backs out of nested
  shells before the stream closes.

### R3. The command loop is guarded

- `_nextCommand()`, `_checkCommand()`, and `_runCommand()` check `_closing`,
  `_runComplete`, and `_hasLiveStream()`.
- `_commandComplete()` still lets the handler observe the response, then
  `_applyHandlerFlags()` decides whether the run continues.

### R4. Handler stop flags

- `sshObj.abort` or `sshObj.stop` calls `stop()` after the handler returns.
- `sshObj.skipCommands` clears the current host's `commands` array.
- `sshObj.skipHosts` clears the current host's `hosts` array. It does **not**
  clear a parent's queue (open question 5).
- `sshObj.skipPrimaryHosts` clears the private primary-host queue.
- Flags are consumed (reset to `false`) so a later host does not inherit them.

### R5. Centralized host finalization

- `_finalizeHost()` is used by `_runExit()`, `_previousHost()`,
  `_nextPrimaryHost()`, `close()`, `stop()`, and the connection `close` handler.
- `_finalizeRun()` finalizes the current host and every ancestor, deepest first.
- Nested text is merged into the parent exactly once via `_mergedHosts`;
  `_primaryhostSessionText` and `_allSessions` are appended exactly once via
  `_finalizedHosts`.
- `end` is emitted exactly once per host.

### R6. Connection close has a readable payload

- Emits `new Error('Connection closed with error')` with `err.level =
  'Connection close'` and `err.hadError = had_error`.
- Keeps `closedMessage` for a clean close.

### R7. Sudo rejection is visible and optionally fatal

- Emits a normal `msg` when the sudo password is rejected or no password is
  configured.
- Sets `sshObj.sudoFailed = true`.
- `abortOnSudoFailure` (default `false`) calls `stop('sudo-failed')`.

### R8. Every outcome is documented and tested

- Unit coverage lives in `test/unit/shutdown.test.js`.
- Live coverage lives in `test/live/stop_on_failure.js`,
  `test/live/close_from_handler.js`, and `test/live/stop_multiple_hosts.js`; the
  curated live batch includes them.
- The README stopping/closing section documents the same matrix.

## API sketch

```js
// Stop the current host only. Normal back-out, remaining hosts continue.
onCommandComplete(command, response, sshObj) {
  if (failed(response)) sshObj.skipCommands = true;
}

// Stop the current host and its own nested hosts. Primary hosts continue.
onCommandComplete(command, response, sshObj) {
  if (failed(response)) {
    sshObj.skipCommands = true;
    sshObj.skipHosts = true;
  }
}

// Skip every remaining primary host, but finish this host cleanly.
onCommandComplete(command, response, sshObj) {
  if (failed(response)) {
    sshObj.skipCommands = true;
    sshObj.skipPrimaryHosts = true;
  }
}

// Stop the whole run.
onCommandComplete(command, response, sshObj) {
  if (failed(response)) this.stop('command-failed');
}

// Declarative form for the same outcome.
onCommandComplete(command, response, sshObj) {
  if (failed(response)) sshObj.abort = 'command-failed';
}

// Immediate close, current connection only. Remaining primary hosts continue.
onError(err, type, close) {
  if (fatal(type)) this.close();
}
```

## Compatibility and versioning

- Additions (`stop()`, `abort`, `stop`, `skipCommands`, `skipHosts`,
  `skipPrimaryHosts`, `sudoFailed`, `abortOnSudoFailure`) are non-breaking. A
  minor release is enough.
- Fixes that change text or events (`sessionText` finalization, readable
  connection-close payload, visible sudo message) are behavior changes. They are
  called out in the changelog and covered by level-aware tests.
- Changing `close()` to cancel remaining primary hosts would break existing
  multi-host callers. The current behavior is kept and `stop()` is the abort.

## Open questions

1. ~~Should `close()` continue with remaining primary hosts (compatibility) or
   abort the run?~~ **Signed off:** continue; use `stop()` to abort.
2. ~~Should `stop()` run queued exit commands by default?~~ **Signed off:** yes,
   bounded by the idle timeout; `close()` remains the immediate path.
3. ~~Should a rejected sudo password abort by default?~~ **Signed off:** no, emit
   a visible message and offer `abortOnSudoFailure`.
4. ~~Should handlers use `sshObj` flags or return values?~~ **Signed off:** flags,
   for compatibility with the existing mutation style.
5. **Pending:** should `skipHosts` also clear nested-host queues on the parent
   hosts in `_connections`? The current implementation clears only the current
   host's `hosts` array, so sibling nested hosts queued on a parent still run.
   This needs a documentation review before deciding.
