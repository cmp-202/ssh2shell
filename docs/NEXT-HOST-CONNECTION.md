# Host-to-host connections: ssh2 hop design

- **Status:** implemented on this branch. The record stack, `forwardOut` hop
  transport, failure containment, and the `_sanitizeResponse` long-command fix
  are in `src/ssh2shell.js`; the nested `ssh` command path is removed. Both live
  acceptance tests (`test/live/host_traversal.js` and
  `test/live/host_faults.js`) pass against `src`, including on a freshly
  provisioned VM.
- **Branch:** `next-host-connection`.
- **Release:** next major. The `server.ssh` removal and the jump-host
  credential change are breaking, so this does not ship as a 3.x minor.
- **Target:** replace the nested `ssh` command with a real `ssh2` connection
  hop, then remove the command-based path.
- **Source of truth:** `src/ssh2shell.js` (current build). `lib/ssh2shell.js` is
  its published copy.
- **Related docs:** [CLOSE-SEMANTICS.md](CLOSE-SEMANTICS.md),
  [API-BASELINE.md](API-BASELINE.md), [ERROR-HANDLING.md](ERROR-HANDLING.md).

The primary connection is already a clear state engine: `_connect` opens an
`ssh2.Client`, `ready` opens a shell, the stream feeds `_onData`, and
`_commandComplete` / `_nextCommand` / `_runExit` drive the command loop. This
design reuses that engine for host-to-host hops. The old nested `ssh` command
path is not a comparison baseline; it is removed.

## Decision

Nested hosts keep the same public host objects, `hosts` arrays, command queues,
handlers, `sessionText`, and traversal order. The transport changes:

| | Current | New |
| --- | --- | --- |
| Nested transport | `ssh ...` written to the parent shell | `ssh2.Client` connected through the parent connection |
| Authentication | Parsed password/passphrase prompts | `ssh2` authentication on the new client |
| Host key | `StrictHostKeyChecking=no` in the command | `ssh2` `hostHash` / `hostVerifier` |
| Exit | Queued `exit` command | Child connection is closed |
| Security hardening | `Security Alert` on shell metacharacters; `shellQuote` | Removed; values go to `ssh2` as data |
| `server.ssh` options | Mapped to `ssh` command-line flags | Removed; use `ssh2` connection options |

This is a breaking change. It removes `server.ssh`, the nested `ssh` command,
the jump-host credential model, the queued `exit` command, and the
shell-metacharacter hardening layer. Plan it for a major release, not a 3.x
minor.

### Decisions locked from design review

| Topic | Decision |
| --- | --- |
| Nested host reuse | `_pushContext()` copies `host.hosts` into `context.pendingHosts`; `_nextHost()` shifts that copy. The caller's nested arrays are never consumed. |
| Active aliases during a hop | `_pushContext()` sets `this.connection = null` and `this._stream = {}` for the child. `_openClient()` / `_openShell()` fill them. `_hasLiveStream()` is false while `forwardOut` is pending. |
| Primary close reporting | The primary `connection.on('close')` handler emits the `Connection close` error or `closedMessage`; `_endPrimary()` only finalizes and advances. The synchronous-throw path reports before calling `_failContext()`. |
| `_removeListeners(context)` | Pure listener/timer cleanup. It does not call `_progressEnd()` and does not reset instance `idleTime` / `dataIdleTime`. Progress ends on the active-record switch. |
| Record timers | `idleTime` and `dataIdleTime` are stored on the record by `_loadDefaults(context)` and reapplied by `_restoreContext()`. |
| Close-event guards | Handlers return when `context.closed` or `context.failing` is set. The hop close handler also returns when `_closing`, `_stopping`, or `_runComplete` is set, so a plain `close()` does not navigate back to the parent. |
| Missing hop parent | `_connectHop()` without a parent routes to `_failContext()` (or `_callFinalCallback()`), so the run terminates. |
| Pending `forwardOut` | A stop/close during `forwardOut` closes the channel and the pending child record, then restores the parent. |
| Expected-drop reconnect | Out of scope. This change adds `_appendPartial()` for unexpected drops only. `breaksConnection`, `expectedClose`, the partial `commandComplete`, and the retry loop stay in the follow-up. |
| Keyboard-interactive | The fallback responder is bound into `context.listeners` when the host sets `tryKeyboard`; instance re-emits are guarded by `context === _activeContext()`. |
| Hop host keys | Same as the primary: `ssh2` accepts unless `hostHash` / `hostVerifier` is set. Documented, no warning. |
| Compatibility switch | Rejected. The nested `ssh` path is removed; this is a major release. |
| `newPrimaryHost` | Emitted only when a primary actually starts, with that host config. |
| Failed host `end` | The failed record is finalized and emits `end`; unstarted descendants do not. |


## Why replace the command path

- **No shell prompt parsing for authentication.** `_processSSHPrompt` and the
  `sshAuth` / `sshToNextHost` flags exist only because `ssh` asks for
  credentials in the parent shell. `ssh2` reports authentication directly.
- **No command building or shell hardening.** `buildSshCommand`,
  `shellQuote`, `shellControlChars`, and the `Security Alert` path exist to make
  a command string safe. The hop passes values to `ssh2` as data.
- **No command injection surface.** Nothing is interpolated into a remote shell.
- **No dependency on the remote `ssh` binary or its configuration.** The hop
  works when the jump host has no `ssh` client, a restricted shell, or a
  `~/.ssh/config` that changes behaviour.
- **Real host-key verification.** The command path injects
  `StrictHostKeyChecking=no`. The hop can use the same `hostHash` /
  `hostVerifier` contract as the primary connection.
- **One connection lifecycle.** Connection, shell, data, timeout, error, and
  close handling become the same code for primary and nested hosts.
- **Per-hop failure isolation.** A dropped target connection is a distinct event
  from a dropped jump host. The connection model can report which hop failed and
  leave the parent shell intact; this is also the foundation for a future
  reconnect/retry policy.
- **Less state to keep consistent.** No `exitCommands` queue, no
  `sshToNextHost` guard in `_commandComplete`, no SSH case in `_onData`, and no
  exit-command branch in `_runExit`.

The cost is a state change: the library must hold more than one live
connection. The rest of this document maps that change.

## New method

### One `_connect`, two transports

`_connect()` is the right place for both connection kinds. Once a transport
exists, primary and hop connections are identical: create an `ssh2.Client`, bind
the connection handlers, wait for `ready`, open a shell, and feed the same data
engine. The only difference is where the socket comes from.

- **Primary:** `client.connect(server)` opens a TCP socket.
- **Hop:** `parent.connection.forwardOut(...)` opens a direct-tcpip channel, then
  `client.connect({ ...server, sock: channel })` uses that channel as its
  transport.

`this.connection` is an `ssh2.Client` in both cases. A hop does **not** use a
different connection type; `sock` is an `ssh2` channel, not a client. That is why
one method can own both paths without branching in the command engine, the
handlers, or the close code.

`_connect(parent = null)` takes the parent context. `null` means a primary host;
a context means a hop.

```js
_connect(parent = null) {
  if (this._stopping || this._runComplete) {
    return;
  }

  const context = this._pushContext(this.sshObj, parent);
  const server = this._normalizeServer(this.sshObj.server);
  // Defaults now belong to the record, so they are loaded after the record
  // exists and before the client is opened.
  this._loadDefaults(context);

  if (context.isPrimary) {
    return this._openClient(context, server);
  }

  parent.connection.forwardOut(
    '127.0.0.1',
    0,
    server.host,
    Number(server.port) || 22,
    (err, channel) => {
      if (err) {
        return this._hopFailed(context, err);
      }
      if (this._stopping || this._runComplete || this._closing) {
        channel.close();
        // The child record is already active. Close it and restore the parent
        // so a stop/close during forwardOut does not leave a half-open stack.
        return this._failContext(context, new Error('Connection cancelled'), 'cancelled');
      }
      return this._openClient(
        context,
        Object.assign({}, server, { sock: channel })
      );
    }
  );
}

// Readability alias used by _nextHost(). The transport branch is in _connect().
_connectHop() {
  const parent = this._activeContext();
  if (!parent || !parent.connection) {
    this.emit('error', 'No parent connection for host hop', 'Hop', false);
    return;
  }
  return this._connect(parent);
}
```

`_openClient()` is the shared tail for both paths:

```js
_openClient(context, options) {
  context.connection = new this._ssh2Client();
  this._bindConnection(context);
  try {
    context.connection.connect(options);
  } catch (err) {
    if (context.isPrimary) {
      this.emit(
        'error',
        `${err} ${err.stack}`,
        'Connection.connect',
        this._hasLiveStream()
      );
      return this._failContext(context, err, 'connect-throw');
    }
    return this._hopFailed(context, err);
  }
}
```

`_nextHost()` only changes the method it initiates:

```js
_nextHost() {
  if (this._stopping || this._runComplete) {
    return;
  }

  // The outgoing record is still active; remove its handlers before the child
  // config replaces the aliases. `pendingHosts` is the record's copy, so the
  // caller's nested array is never consumed.
  const parent = this._activeContext();
  this._removeListeners(parent);
  const nextHost = parent.pendingHosts.shift();
  this._systemMsg('debug', `nextHost: hop to ${nextHost.server.host}`);

  this.sshObj = nextHost;
  this.host = nextHost.server.host;

  return this._initiate(this._connectHop);
}
```

`_connectHop()` has no logic of its own; it exists so `_nextHost()` reads as a
host switch. If preferred, `_nextHost()` can call
`_initiate(() => this._connect(parent))` and the alias can be deleted.

Because `_loadDefaults` is now record-scoped, it moves out of `_initiate()` and
into `_connect()` after `_pushContext()`. `_initiate(action)` keeps only its stop
guard and the `action()` call:

```js
_initiate(action) {
  if (this._stopping || this._runComplete) {
    return;
  }
  return action();
}
```

That keeps one ordering rule: a record exists before its defaults are loaded, and
the client is opened after both. `_loadDefaults(context)` reads `context.host`
instead of `this.sshObj` and stores its timers on the record.

### Shared helpers extracted from `_connect`

`_connect` keeps its shape but delegates event wiring and shell setup to
context-aware helpers. Each handler closes over `context`, not `this.sshObj`, so
a late event from a parent connection cannot act on the active child.

| Helper | Responsibility |
| --- | --- |
| `_normalizeServer(server)` | Copy the server object, map `userName` / `passPhrase` to ssh2's `username` / `passphrase`, strip `ssh`, and leave the host object untouched. |
| `_pushContext(host, parent)` | When `parent` is set, push that parent record onto `_connections`; then create `{ host, parent, connection: null, stream: null, isPrimary: parent === null, closed: false, failing: false, listeners: {}, idleTimer: null, dataReceivedTimer: null, expectedClose: false, idleTime, dataIdleTime, pendingHosts }`, make it `_active`, set `this.sshObj` / `this.host` / `this.connection = null` / `this._stream = {}`, and return it. A primary starts with `_connections = []`. |
| `_activeContext()` | Return `this._active`, or `null`. |
| `_bindConnection(context)` | Attach `keyboard-interactive`, `connect`, `ready`, `error`, and `close` handlers. Each handler closes over `context`. |
| `_openShell(context)` | Call `context.connection.shell(...)`, set the encoding, and attach `data`, `stderr`, `error`, `finish`, and `close` handlers that ignore events when the context is no longer active. |
| `_openClient(context, options)` | Create the client, bind the handlers, and connect. A synchronous `connect()` throw is routed to `_failContext`. |
| `_restoreContext(context)` | Set `this.connection` / `this._stream` / `this.sshObj` / `this.host` back to a context after a child closes, and reapply the context's `idleTime` / `dataIdleTime` values. |
| `_popContext()` | Pop the top ancestor from `_connections`, make it active, restore the aliases, and reapply its timer values. Used by `_previousHost()`. |
| `_popTo(context)` | Drop `context` and every record above it from `_connections` until `context.parent` is on top, then pop it to make the parent active. Used by `_failContext()`. |
| `_descendantsOf(context)` | Return the active record plus every record deeper than `context` (`_connections.slice(indexOf(context) + 1)` reversed), deepest-first, excluding `context`. Used for teardown. |
| `_closeContext(context, reason)` | The only record teardown point: remove `context.listeners`, close the stream and connection, and finalize the host. Idempotent through `context.closed`. |
| `_closeAllContexts(reason)` | Close the active record and every ancestor, deepest-first, through `_closeContext()`. Used by `_nextPrimaryHost()`, `close()`, and `stop()`. |
| `_failContext(context, err, reason)` | The only record failure entry point: tear down descendants, close the record, then `_endPrimary` for a primary or `_popTo()` + `_runExit()` for a hop. |
| `_endPrimary(reason)` | Exactly-once primary advance: finalize the run, then start the next primary or call the callback. Used by `connection.on('close')`, the synchronous connect throw, and `_failContext`. |
| `_hopFailed(context, err)` | Emit the record's `error`, then delegate to `_failContext(context, err, 'hop-failed')`. |
| `_removeListeners(context)` | Remove only the handlers in `context.listeners` and clear that record's timers; never read `this.sshObj` or the instance `_boundListeners` cache. Pure cleanup: no `_progressEnd()`, no instance timer reset. |
| `_loadDefaults(context)` | Bind host handlers into `context.listeners` and apply record-scoped timers. Instance defaults stay on the instance. |

The primary path through `_connect()` is then just:

```js
const context = this._pushContext(this.sshObj, null);
this._loadDefaults(context);
return this._openClient(context, this._normalizeServer(this.sshObj.server));
```

The hop path adds one asynchronous transport step before the same
`_openClient()`. There is no second connection implementation to keep in sync.

### Where connection objects live

**Decision: one regressive stack. `_connections` holds the ancestors of the
active host; the active host is a separate record.**

```js
// Active host: hostaaa
this._active = {
  host: hostaaa, parent: hostaa, connection: aaaaClient,
  stream: aaaaStream, isPrimary: false, closed: false,
  listeners: {}, idleTimer: null, dataReceivedTimer: null, expectedClose: false,
};
this._connections = [
  { host: host1,  parent: null,  connection: host1Client,  stream: host1Stream,  isPrimary: true,  closed: false, listeners: {}, idleTimer: null, dataReceivedTimer: null, expectedClose: false },
  { host: hosta,  parent: host1, connection: hostaClient,  stream: hostaStream,  isPrimary: false, closed: false, listeners: {}, idleTimer: null, dataReceivedTimer: null, expectedClose: false },
  { host: hostaa, parent: hosta, connection: hostaaClient, stream: hostaaStream, isPrimary: false, closed: false, listeners: {}, idleTimer: null, dataReceivedTimer: null, expectedClose: false },
];
```

Every record has the same shape. `_pushContext()` creates all fields, including
`listeners`, the two record-scoped timers, `expectedClose`, and the `failing`
re-entry guard used by `_failContext()`. It also stores `idleTime`,
`dataIdleTime`, and `pendingHosts` (a copy of `host.hosts`) on the record so a
parent can be restored without reading the active aliases and so a host's
nested array is never consumed.

This answers "should connection objects be added to the connections with the
configs?" **Yes, but as a record around the config, not as properties on the
config.**

The stack is a single regressive path, not a tree. `_connections` holds only the
hosts above the active one; the active host is not in the array. Forward paths
wait in `host.hosts`. A host with several nested hosts runs them one at a time:
push the active record, make child A active, finish A (pop), make the parent
active, push it again for child B, and so on. When the primary finishes,
`_nextPrimaryHost()` closes and resets the stack, then the next primary becomes
active with `_connections = []` and its own `hosts` are traversed the same way.

- `_connections[0]` is the primary record while a hop is active. At a primary,
  `_connections` is empty.
- `_active` is the active record; `this.connection`, `this._stream`, `this.sshObj`,
  and `this.host` are aliases for it.
- `parent` points at the record that supplied the `forwardOut` channel, so a
  three-hop chain closes and restores in order.
- `closed` makes teardown idempotent when the normal exit path and a connection
  event race.

#### Why not attach `connection` / `stream` to the host config

The host object is user configuration, not lifecycle state. Attaching live
handles to it would:

- put sockets and channels into the `verbose` config dump and the credential
  redaction walk;
- make a host object single-use, so the same config could not appear in
  `_hosts` or be reused across runs;
- leak connection state into `_loadDefaults`, which mutates the host config;
- change the documented host shape for no user benefit.

#### Why not a separate parallel stack

A second array (`_contexts`) would have to stay in lockstep with `_connections`
at every push, pop, close, and finalize point. One array of records removes that
class of bug and answers the close question directly: to close a hop, close the
record you already have.

#### Why not bind `sshObj` to the connection

The reverse binding — `connection.sshObj = host`, or making the connection the
context — is tempting because a connection event handler could recover the host
without a closure. It is not the right owner:

- **The connection is ephemeral; the host is not.** A reconnect replaces the
  client. `expectedClose`, the retry count, and the timer belong to the host
  context and must survive the swap. If the connection owns them, reconnect has
  to rebuild the context and transfer the state.
- **The host exists before the connection.** `_nextHost()` sets `this.sshObj`
  and `_connect()` runs `_loadDefaults(context)` before `_openClient()` creates
  the client. There is a real window where the host has no connection to bind to.
- **`ssh2.Client` is not ours.** Adding `sshObj`, `stream`, `parent`, and
  `closed` to a third-party object couples us to its extensibility and leaks
  library state through the documented `this.connection`.
- **Teardown is array-shaped.** `stop()`, `close()`, and `_finalizeRun()` walk
  records deepest-first. A linked list via `connection.parent` needs a second
  child link or an array anyway.
- **The stream is separate from the client.** `ready` creates the stream after
  the connection, so the context has to hold both. The connection cannot be the
  single container without more mutation.

If a back-reference is useful for handlers or debugging, make it
non-authoritative:

```js
context.connection.context = context; // or a WeakMap<Client, Context>
```

The stack stays the source of truth; the connection just points back at its
record. Event handlers already close over `context` in `_bindConnection()` and
`_openShell()`, so this is a convenience, not a dependency.

#### How `_connect` interacts with the stack

| Step | Stack effect |
| --- | --- |
| `connect()` -> `_connect(null)` | Create the primary as the active record. `_connections` stays `[]`. |
| `_nextHost()` -> `_connectHop()` -> `_connect(parent)` | `parent = _activeContext()`. Push the parent record onto `_connections`, then make the child active. |
| `forwardOut` | Reads `parent.connection`; no stack change. |
| `_openClient(child)` | Fills `child.connection`; `_openShell` fills `child.stream`. |
| Commands | Active aliases point at the child record. |
| `_runExit()` -> `_previousHost()` | Close the active child, pop its parent, make the parent active again. |
| Next sibling or `close()` | Uses the restored parent record; a sibling pushes it again. |
| `_nextPrimaryHost()` | Close the active record and every ancestor, reset `_connections` to `[]`, then `_connect(null)` makes the next primary active. |

#### Checks that keep their meaning

Because the active host is outside `_connections`, `_connections.length > 0`
still means "we are inside a nested host". The checks do not flip; only the
record shape changes from a host config to `record.host`:

| Location | Current check | New check |
| --- | --- | --- |
| `_processNotifications()` | `_connections.length > 0` prefixes the host on session notes | Unchanged |
| `_runExit()` | `_connections.length > 0` means "return to the previous host" | Unchanged |
| `_finalizeHost()` | primary when `_connections.length === 0` or `host === _connections[0]` | `host === _connections[0].host`, with the empty-stack fallback kept |
| `_mergeNestedText()` | root is `_connections[0]` | parent is the record below the host, or the last ancestor |
| `_finalizeRun()` | current host plus `_connections` in reverse | active host plus `_connections` records in reverse |
| `stop()` / `_prepareGracefulClose()` | `clearQueues(host)` over `_connections` | `clearQueues(record.host)` for the active record and each ancestor |
| `_nextPrimaryHost()` | `_connections = []` | close the active record and every ancestor, then reset |
| `_nextHost()` | `_connections.push(this.sshObj)` | `_connect` pushes the parent record before the child becomes active |

## Primary connection vs host hop

| Concern | Primary (`_connect(null)`) | Hop (`_connect(parent)`) | Shared |
| --- | --- | --- | --- |
| Entry point | `connect()` -> `_nextPrimaryHost(this._connect)` | `_runExit()` -> `_nextHost()` -> `_connectHop()` -> `_connect(parent)` | `_initiate` loads defaults and binds host handlers. |
| Stack | Creates the active record; `_connections` is `[]` | Pushes the parent record onto `_connections`, then makes the child active | One record shape for both. |
| Client | `new ssh2.Client()` | `new ssh2.Client()` | Same client type. |
| Transport | `client.connect(server)` | `parent.connection.forwardOut(...)` then `client.connect({ ...server, sock: channel })` | `_normalizeServer` and `_openClient`. |
| Credentials | Local process: `password`, `privateKey`, `passPhrase`, `agent` | Local process, same fields | Same `ssh2` authentication. |
| Host key | `hostHash` / `hostVerifier` on `server` | Same fields passed to the child client | `_normalizeServer` applies `hostHash`. |
| Auth prompts | `ssh2` handles them; `keyboard-interactive` is re-emitted | Same | `_bindConnection` installs the same handler. |
| Shell | `context.connection.shell(window, { pty })` | Same | `_openShell`. |
| Stream encoding | `streamEncoding`, default `utf8` | Same | `_openShell`. |
| Data routing | Active stream only | Active stream only; inactive parent streams are ignored | Stream handler compares `context` with `_activeContext()`. |
| Host defaults | `_loadDefaults` | `_loadDefaults` | Same host object contract. |
| Command loop | `_nextCommand` / `_checkCommand` / `_runCommand` | Same | No change. |
| Timeout | `_scheduleIdleTimeout` | Same | The idle timer is armed per command and retries work per command. |
| Session text | `_finalizeHost` / `_finalizeRun` | Same, with the record stack | `_mergeNestedText` merges one level at a time into the immediate parent, so the primary still receives the whole subtree. |
| Close | Active primary close ends the primary | Active child close returns to the parent record | `_closeContext` and `_finalizeRun`. |
| Next step | Next primary host, or final callback | Parent `_runExit()` | Same order, no exit commands. |

### Deviation register

Logging is not a deviation. `_systemMsg`, `debug`, `verbose`, `msg` prefixes,
progress, sudo prompts, command-response handling, `captureStderr`, and the
default error listener all read the active aliases and keep their current
behaviour. Only the following need code changes.

| ID | Deviation | Impact | Resolution |
| --- | --- | --- | --- |
| D1 | More than one live connection | `this.connection` / `this._stream` are aliases, not the whole session | `_connections` records plus active aliases. |
| D2 | Parent stream stays open during a hop | Late parent data could enter the child buffer | Stream handlers check `context === _activeContext()` before emitting `data` / `stderrData`. |
| D3 | Child connection has its own `close` | A child close must not advance the primary-host queue | Close handler branches on `context.isPrimary`; child close -> `_previousHost()`. |
| D4 | No `exit` command leaves a hop | The old `exitCommands` queue has no producer | Remove the queue and its drains; leaving a hop closes its connection. |
| D5 | Credentials are local to the runner | Keys and agents on the jump host no longer work | Migration to a local `privateKey` or local `agent`. |
| D6 | Host-key policy changes | `StrictHostKeyChecking=no` is gone | `ssh2` defaults; opt in with `hostHash` / `hostVerifier`. |
| D7 | `server.ssh` has no equivalent | Flags such as `logFile`, `configFile`, `escape` disappear | Remove in the major release; map supported fields in the migration table. |
| D8 | `forwardOut` can fail before a child client exists | No child connection to close | `_hopFailed` pops the record, restores the parent, emits `error`, and resumes the parent path. |
| D9 | An inactive ancestor can emit `close` / `error` | The active child is not the failed connection | Close/error handlers act on the event's context; an ancestor failure tears down its descendants first. |
| D10 | A close can be expected | A reboot or network command closes the connection on purpose | Record `expectedClose` from the command; the transport change still follows the normal close path, and the reconnect policy uses the flag later. |

`keyboard-interactive` is also unchanged in contract: `_bindConnection` already
installs it per client, and the instance event carries that client's `finish`.
Inactive-parent timers are cleared by `_removeListeners(context)` on every host
switch; `_hopFailed` must do the same through `_closeContext`.

## Properties

### Host properties: unchanged

These stay on the host object and apply to the active context exactly as they do
for a primary host:

`commands`, `hosts`, `sessionText`, `connectedMessage`,
`readyMessage`, `closedMessage`, `showBanner`, `verbose`, `debug`, `progress`,
`exposeCredentials`, `commandResponse`, `captureStderr`,
`commandTimeoutRetries`, `abortOnSudoFailure`, `pty`, `window`,
`streamEncoding`, `standardPrompt`, `standardPromptRegex`, `passwordPrompt`,
`passPromptText`, `textColorFilter`, `asciiFilter`,
`disableColorFilter`, `disableASCIIFilter`, `enter`, `idleTimeOut`,
`dataIdleTimeOut`, and the `on*` handlers.

`passwordPrompt` and `passPromptText` stay because `sudo` still detects
password prompts. `passphrasePrompt` and `exitCommands` are removed with the
command path.

`sessionText` remains per host. `_mergeNestedText` prefixes a nested host's
text with `\n<host>: ` and merges it into its **immediate parent**, not the
primary. A child finalizes before its parent, so the deepest text travels up one
level at a time and lands in traversal order. The primary ends up carrying the
whole subtree, and a three-level run reads
`host1,hosta,hostaa,hostaaa` rather than `host1,hostaaa,hostaa,hosta`.

### Server properties: same contract, different source

| Property | Primary | Hop | Notes |
| --- | --- | --- | --- |
| `host` | `ssh2` connect | `forwardOut` destination | The jump host resolves the name. |
| `port` | `ssh2` connect | `forwardOut` destination port | Defaults to `22`. |
| `userName` | `ssh2` connect | `ssh2` connect | `username` alias applied by `_normalizeServer`. |
| `password` | `ssh2` connect | `ssh2` connect | Used for the hop login, not the parent shell. |
| `privateKey` | `ssh2` connect | `ssh2` connect | Must be readable by the **local** process. |
| `passPhrase` | `ssh2` connect | `ssh2` connect | `passphrase` alias applied. |
| `agent` | `ssh2` connect | `ssh2` connect | Local agent, not the jump host's agent. |
| `tryKeyboard` | `ssh2` connect | `ssh2` connect | Same event path. |
| `hostHash` | `ssh2` connect | `ssh2` connect | Same verifier contract. |
| `hostVerifier` | `ssh2` connect | `ssh2` connect | Recommended for hops. |
| `algorithms` | `ssh2` connect | `ssh2` connect | Replaces `server.ssh.cipherSpec` / `macSpec`. |
| `readyTimeout` | `ssh2` connect | `ssh2` connect | Applies to the child login. |
| `keepaliveInterval` / `keepaliveCountMax` | `ssh2` connect | `ssh2` connect | Applies per connection. |
| `forceIPv4` / `forceIPv6` | `ssh2` connect | `ssh2` connect | Replaces `server.ssh.forceAddressType`. |
| `sock` | not used | set by the hop | Do not set it on the host object. |
| `ssh` | not used | **removed** | See the migration table. |

### Removed internals

| Item | Reason |
| --- | --- |
| `src/ssh2shell/ssh-command.js` and `buildSshCommand()` | No command line to build. |
| `shellQuote()` and `shellControlChars` in `util.js` | Only used to build and validate the nested `ssh` command. |
| The `Security Alert` error path | There is no shell string to validate. |
| `_sshConnect()` | Replaced by the hop branch of `_connect(parent)` (via `_connectHop()`). |
| `_processSSHPrompt()` | `ssh2` owns authentication. |
| The `sshToNextHost` case in `_onData()` | There is no `ssh` command in the parent shell. |
| The `sshToNextHost !== true` guard in `_commandComplete()` | There is no nested-command output to suppress. |
| `sshObj.sshAuth` and `sshObj.sshToNextHost` | No prompt state to track. |
| The `exitCommands` queue, `exitCommands.push('exit')`, the `_runExit()` drain, and the `_beginStopExit()` drain | There is no nested shell to leave; leaving a hop closes its connection. |
| `passphrasePrompt` | Only used by `_processSSHPrompt()`. `passwordPrompt` stays for `sudo`. |
| `server.ssh.*` and the forced `StrictHostKeyChecking=no` | There are no command-line flags to map. |

## Methods

| Method | Change |
| --- | --- |
| `connect()` | Unchanged; still starts the primary host. |
| `_connect(parent = null)` | **Shared.** Makes a context record active, then either connects directly (`parent === null`) or pushes the parent and connects via `parent.connection.forwardOut` (`parent` set). All wiring goes through `_openClient`. |
| `_connectHop()` | **New, thin adapter.** `_connect(_activeContext())`. Holds no logic. |
| `_openClient(context, options)` | **New.** Creates the client, binds context-scoped handlers, and connects. |
| `_nextHost()` | Switches the host and calls `_initiate(this._connectHop)` instead of `_sshConnect`. Queues no exit command. |
| `_previousHost()` | Closes the active child through `_closeContext` (listeners, stream, connection, finalize), pops the parent record, makes the parent active again, then calls `_runExit()` on it. |
| `_nextPrimaryHost()` | Finalizes the current primary, closes the active record and every ancestor, clears the stack, resets `_stream` / `connection`, then starts the next primary. |
| `_runExit()` | Simplified. `hosts` -> `_nextHost()`; `_connections.length > 0` -> `_previousHost()`; literal `exit` -> run it; else `close()`. No `exitCommands` drain. |
| `_finalizeHost()` | Primary detection uses `host === _connections[0].host`. |
| `_finalizeRun()` | Iterates the record stack deepest-first. |
| `_mergeNestedText()` | Merges into the immediate parent record; falls back to the last ancestor for legacy bare-host stacks. |
| `_onData()` | The SSH prompt case is removed. Sudo, normal prompt, first prompt, and timeout handling are unchanged. |
| `_commandComplete()` | The `sshToNextHost` guard is removed. Response handling, `commandResponse`, `captureStderr`, and handler flags are unchanged. |
| `_processSudoPrompt()` | Unchanged. `passwordPrompt` is still used for `sudo`. |
| `stop()` | Clears queues as today, sends Ctrl-C if a command is in flight, then closes the active record and every ancestor. No exit commands. |
| `_beginStopExit()` | Waits for the prompt or `_finishStop()`. No exit-command drain. |
| `_finishStop()` | Closes the active stream and every ancestor connection, then finalizes. |
| `close()` / `_closeStreamNow()` | Closes the active record and its ancestors, then follows the primary-host contract. |
| `_hasLiveStream()` | Checks the active record's stream. |
| `_removeListeners(context)` | **Signature change.** Removes only the handlers in `context.listeners` and clears that record's timers. Never reads `this.sshObj`; does not call `_progressEnd()` or reset instance timer values. |
| `_loadDefaults(context)` | **Signature change.** Binds host handlers into `context.listeners`, stores the record's `idleTime` / `dataIdleTime`, and resets per-command state. No longer resets `sshAuth` / `sshToNextHost`. |
| `_closeContext(context, reason)` | **New.** The only record teardown: remove listeners, close stream and connection, finalize the host. Idempotent. |
| `_failContext(context, err, reason)` | **New.** The only record failure entry: descendants deepest-first, close the record, then `_endPrimary` (primary) or `_popTo()` + `_runExit()` (hop). |
| `_popTo(context)` | **New.** Drop the failed record and its descendants, then restore the parent. Used only by `_failContext`. |
| `_endPrimary(reason)` | **New.** Exactly-once primary advance; shared by the primary `connection.on('close')` handler, the synchronous connect throw, and `_failContext`. The public `close()` / `stop()` still go straight to the callback. |
| `_hopFailed(context, err)` | **New.** Emits the record's `error`, then calls `_failContext`. |
| `_descendantsOf(context)` | **New.** Active record and records above `context`, deepest-first, excluding `context`, for teardown. |
| `_runCommand()`, `_nextCommand()`, `_checkCommand()`, `_processNotifications()`, `_scheduleIdleTimeout()`, `_applyHandlerFlags()` | Reused unchanged, against the active record. |
| `_captureStderr()`, `_mergeStderr()`, `_handleCommandResponse()` | Reused unchanged. |
| `_progressStart()` / `_progressEnd()` / `_progressBreak()` | Reused unchanged; one heartbeat for the active command. |
| `_sanitizeResponse()` | **Changed.** Slices after the **last** echoed command instead of the first. A long command makes the PTY redraw, and the redraw can place the previous prompt before the echoed command; that prompt must not complete the new command. When the full echo is not in the buffer yet, the old partial-echo removal still applies. |

### Long-command redraw fix

The clean-VM provisioning run exposed a prompt-detection bug that the existing
live suite did not hit. The network command in `test/provision/provision.js` is
about 2,900 characters. The PTY redraws it with `\u001b[H\u001b[J`, NUL bytes,
and an OSC title update. The redraw can put a prompt **before** the echoed
command. `_sanitizeResponse()` removed the command from the middle and left that
prompt at the end of the buffer, so the end-anchored `standardPrompt` matched and
the command was treated as complete before its output arrived. The session then
closed and `network: OK` never appeared.

`_sanitizeResponse()` now finds `lastIndexOf(command)` and tests only the text
after it. A prompt that belongs to the previous command is outside the slice; the
prompt that follows the real output still matches. The fallback keeps the
partial-echo behavior for a buffer that contains only the start of the echoed
command. `commandResponse: 'handled'` is unaffected because it strips the echo
through `stripEchoedCommand()` in `_handleCommandResponse()`.

Regression tests live in `test/unit/command-response.test.js`: one for a prompt
before the echo, and one for command text repeated in the output.

## Close handling

### Record teardown

Add one helper that is the only way a connection is closed:

```js
_closeContext(context, reason) {
  if (!context || context.closed) {
    return;
  }
  context.closed = true;

  // Remove this record's host handlers before the connection closes. The
  // active aliases may already point at a parent or child when a late close
  // event arrives, so the record must carry the config that bound them.
  this._removeListeners(context);

  if (context.stream && typeof context.stream.close === 'function') {
    context.stream.close();
  }
  if (context.connection && typeof context.connection.end === 'function') {
    context.connection.end();
  }

  this._finalizeHost(context.host, reason);
}
```

`_closeStreamNow()`, `_finishStop()`, `_previousHost()`, `_failContext()`,
`_closeAllContexts()`, and `_nextPrimaryHost()` all use it. Closing a record is
idempotent, and `context.closed` is what stops the resulting `stream` /
`connection` events from re-entering the close path. Popping the record is the
caller's job: `_previousHost()` closes the active child and pops its parent;
`_nextPrimaryHost()` closes the active record and clears the stack.

### Listener ownership

Host handlers are bound by `_loadDefaults()` and must be removed using the config
that supplied them. Today `_removeListeners()` reads `this.sshObj`, which is
correct only while one host is active. A hop breaks that assumption: a close or
error for an ancestor can arrive after the active aliases point at a child, and
the child's `sshObj` does not have the ancestor's handlers.

Give each record its own listener set:

```js
context.listeners = {
  data: fn,
  stderrData: fn,
  commandProcessing: fn,
  commandComplete: fn,
  commandTimeout: fn,
  end: fn,
  error: fn,
  msg: fn,
  'keyboard-interactive': fn,
};
```

`_loadDefaults(context)` binds into `context.listeners`;
`_removeListeners(context)` iterates that map and calls
`this.removeListener(eventName, listener)`. It never reads `this.sshObj`. The
instance defaults (`_onData`, the default `error` listener, the progress
listener, the fallback `msg`) stay on the instance and are never removed by a
host switch.

Timers follow the same rule: `idleTimer` and `dataReceivedTimer` become
record-scoped (`context.idleTimer`, `context.dataReceivedTimer`) so an ancestor
close cannot cancel the active child's timeout. `_stopTimer` and `_closeTimer`
remain run-level.

Removal points:

| Moment | Records whose listeners are removed |
| --- | --- |
| Hop completes (`_previousHost`) | The hop |
| Hop fails (`_hopFailed`) | The hop |
| Hop's descendants are torn down | Each descendant, deepest-first |
| Primary completes and a next primary exists (`_nextPrimaryHost`) | The primary |
| Primary fails and a next primary exists (`_endPrimary`) | The primary |
| `close()` / `stop()` / `_finishStop()` | Active record and ancestors, deepest-first |
| Final primary close, no next primary | Same `_closeContext` path, so teardown is uniform |
| Any host switch | Only the outgoing record; never the incoming one |

`_closeContext(context, reason)` is the single place that closes a record, so it
is also the right place to remove that record's listeners, before closing the
stream and connection. That keeps the rule true for normal completion, failure,
and run-ending teardown.

The current code removed `_removeListeners()` from the connection `close`
handler because the run terminates there. That is still true for the final
primary, but not for a hop: a hop close returns to a live parent, so its
handlers must be removed or they keep firing against the parent's events.

### `stop()`

The queue clearing and Ctrl-C behaviour is unchanged. The difference is the
final teardown:

1. Clear every `commands` and `hosts` queue, plus `_hosts`.
2. If a command is in flight, write `Ctrl-C` to the active stream and wait for
   the prompt or `idleTimeOut`.
3. `_finalizeRun()` deepest-first: one `end` per visited host.
4. Close the active record, then each ancestor, deepest-first. Do not send
   `exit` to a hop.
5. Call the final callback once.

There is no `exitCommands` step: the child connection is the exit.

`_forceStop()` uses the same teardown, so a stuck hop cannot leave a parent
connection open. If a hop is still waiting on `forwardOut`, `_hopFailed` sees
`_stopping` and closes the parent record instead of restoring it as active.

### `close()` and `close({ graceful: true })`

- **Plain `close()`** closes the active record and its ancestors, finalizes
  them, and then follows the existing primary-host contract. If the active
  record is a hop, the parent is closed too; the run does not continue on a
  half-closed stack.
- **Graceful `close()`** keeps the existing intent: finish the current command
  path, back out of nested hosts, then close. `_runExit()` walks `hosts` and
  `_previousHost()` closes each child connection. No `exit` command is needed
  for a hop.
- Remaining primary hosts still run after either close, matching the current
  compatibility contract.

### Connection and stream events

Every handler returns immediately when `context.closed` or `context.failing` is
set, so a close that races the normal teardown cannot navigate twice. The hop
`connection.on('close')` handler also returns when `_closing`, `_stopping`, or
`_runComplete` is set: a plain `close()` tears the stack down itself and must not
restore the parent.

| Event | Primary record | Hop record |
| --- | --- | --- |
| `stream.on('finish')` | `_finalizeHost(context.host, 'stream-finish')` | Same. |
| `stream.on('close')` | `context.connection.end()` | Same. |
| `connection.on('close')` | Finalize, emit `closedMessage`, then next primary or callback | Finalize child, restore parent, `_previousHost()` / `_runExit()`. |
| `connection.on('error')` | Existing `error` contract | Existing `error` contract; do not close the parent unless the error is terminal for the child. |
| `forwardOut` error | n/a | Emit `error`, make the parent active again, continue the parent path. |

A hop `connection.on('close')` must never call `_nextPrimaryHost`. The
`context.isPrimary` flag is the guard. If an ancestor closes or errors while a
child is active, tear down the descendants first, then let the ancestor event
follow the primary contract.

### Finalization

`_finalizeRun()` currently collects the current host and `_connections` in
reverse. It becomes:

```js
const hosts = [];
if (this._active && this._active.host) {
  hosts.push(this._active.host);
}
for (let index = this._connections.length - 1; index >= 0; index -= 1) {
  const host = this._connections[index].host;
  if (host && host.server) {
    hosts.push(host);
  }
}
for (const host of hosts) {
  this._finalizeHost(host, reason);
}
```

The active host is not in `_connections`, so it is added first and the ancestors
follow in reverse. Keep a fallback that adds `this.sshObj` when there is no
active record (before `_connect` or after a reset). `_finalizedHosts` and
`_mergedHosts` keep finalization and text merging idempotent across the normal
path and an abrupt drop.

A failed record is finalized like any other record, so it emits `end` with the
text it produced. Only descendants that never started are skipped: they are not
active and not in `_connections`, so they are never finalized. This is why
`test/live/host_faults.js` expects `bad-deep` and `bad-primary` in `end-order`
but not `bad-deep-child`.

## Primary failure policy

**Decision: a failed primary does not end the run. Each remaining primary is
attempted once, in order.** This is the current `connection.on('close')`
behaviour; the change makes it explicit and covers the paths that bypass it.

| Outcome | Action |
| --- | --- |
| Primary connects and finishes | Finalize, next primary or callback (unchanged) |
| Primary connect/auth/stream fails | Emit `error` for that primary, finalize it, advance to the next primary |
| Synchronous throw from `connection.connect()` | Same as a connect failure; do not rely on a `close` event |
| `stop()` / `abort` | No advance; finalize the run and call the callback once |
| `close()` | No advance; close and call the callback once |
| `skipPrimaryHosts` | `_hosts` cleared; callback after the current primary |
| No primaries left | `_callFinalCallback()` with `_allSessions` |

“Keep trying” means the next primary, not the same one. Retrying the same
primary is reconnect, and stays out of scope.

Exactly-once advance: route both `connection.on('close')` and the synchronous
throw catch through one method:

```js
_endPrimary(reason) {
  // Navigation only. The caller reports first: the close handler emits the
  // `Connection close` error or `closedMessage`; the synchronous-throw path
  // emits its error before calling _failContext().
  if (this._primaryEnded || this._runComplete) {
    return;
  }
  this._primaryEnded = true;
  this._finalizeRun(reason);

  if (this._stopping || this._closing) {
    return this._callFinalCallback();
  }
  if (this._hosts.length > 0) {
    return this._nextPrimaryHost(this._connect);
  }
  return this._callFinalCallback();
}
```

`_nextPrimaryHost()` resets `_primaryEnded = false` when it starts the next
primary, so a late `close` from the previous client hits the guard instead of
starting a second primary.

Nested failures do **not** advance primaries. A hop failure is terminal for that
host and its subtree because the path to it is gone:

- `_hopFailed(context, err)` emits `error`, finalizes the failed host, restores
  the parent, then runs `_runExit()` on the parent.
- The parent's remaining `hosts` (siblings) still run.
- The failed host's own `hosts` (descendants that have not started) never run and
  get no `end`. Descendants that were already active are finalized deepest-first
  before the failed host is closed.
- The failed hop is not retried. Reconnect, if ever added, starts from the
  nearest live ancestor, not from the failed record.

With `host1.hosts = [hosta, hostb]` and `hostb.hosts = [hostbb]`:

| Failure | What runs next |
| --- | --- |
| `hosta` fails | `hostb` (sibling) still runs |
| `hostb` fails | `hostbb` does not run (its parent never connected); the run backs out to `host1`, then to the next primary |

A nested failure therefore costs one subtree, not the primary and not the run.
A primary failure costs that primary only; later primaries still run.

### What counts as a failure

“Failure” is not one thing, and the current code treats these differently:

| Failure | Current code | New model |
| --- | --- | --- |
| Primary connect/auth fails | `error` + `close` -> next primary (verified: the next primary is attempted) | Same, via `_endPrimary()` |
| Hop connect/auth fails | Inferred from shell text in `_processSSHPrompt()`, then `_previousHost()`; siblings continue | `_hopFailed()`; siblings continue |
| Command timeout on a hop | The nested shell shares the primary stream, so the default handler closes the primary stream and the primary ends | Closes only that hop's stream/connection; siblings continue |
| Stream error on a hop | Same: the primary stream is closed | Scoped to the hop |

The last two are a real improvement, not just tidying. Today a single nested
command that never returns a prompt takes down the whole primary. With one
stream per record, a hop failure costs only that hop and its descendants.

The verified primary behaviour is worth recording because it is easy to assume
otherwise:

```text
CONNECT 1 one.test
ERR ECONNREFUSED | Connection
END one.test
CONNECT 2 two.test
CALLBACK "one.test: \ntwo.test: ..."
```

The first primary fails before `ready`, `close` fires, and `_nextPrimaryHost()`
starts the second. The gap is only the synchronous `connection.connect()` throw,
which has no `close` event to trigger that advance.

## Host navigation on failure

Error handling answers "what is reported". Host navigation answers "what runs
next". They are separate decisions, and a command failure that changes connection
state takes the same navigation path as a connection failure.

### Failure classes

| Class | Examples | Navigation |
| --- | --- | --- |
| Fatal to the run | `stop()`, `abort`, `close()`, `close({ graceful: true })` | No navigation. Tear down the active record and ancestors deepest-first, finalize, call the callback once. |
| Fatal to a record | connect/auth/`forwardOut` error, connection `close`, stream `error`, command timeout that closes the stream | Contained by position: a primary goes to `_endPrimary`, a hop goes to `_hopFailed`. |
| Expected drop | A command marked `breaksConnection` or matching `connectionBreakingCommands` | Same navigation as a fatal record failure in this change. `expectedClose` only changes reporting and the future reconnect decision. |
| Command failure that keeps the connection | Non-zero exit, missing command, handled error text | Not a failure for navigation. `commandComplete` runs and `_nextCommand()` continues. |

The single entry point for a record failure:

```js
_failContext(context, err, reason) {
  if (!context || context.closed || context.failing) {
    return;
  }
  context.failing = true;

  // Descendants ride on this record's transport. Tear them down deepest-first
  // before the record itself, so each is finalized once with its own text.
  for (const descendant of this._descendantsOf(context)) {
    this._closeContext(descendant, 'ancestor-failed');
  }
  this._closeContext(context, reason);

  if (context.isPrimary) {
    return this._endPrimary(reason);
  }
  this._popTo(context);    // drop the failed record and its descendants
  return this._runExit();  // parent siblings, then up
}
```

`_endPrimary` finalizes and either starts the next primary or calls the callback.
`_hopFailed(context, err)` is the hop wrapper: it emits the record's `error`, then
calls `_failContext(context, err, 'hop-failed')`. The connection handlers, the
`forwardOut` error, the stream `error`, and a connection-breaking command timeout
all call `_failContext`, so there is one navigation rule rather than one per
source. The `failing` flag makes a close that arrives while descendants are being
torn down a no-op instead of a second unwind.

`_popTo(context)` drops the failed record and its descendants from
`_connections` until `context.parent` is on top, then pops it to make the parent
active. `_popContext()` alone is not enough: the stack above a failed ancestor
still holds the descendants that were just closed.

Because `_popTo()` restores the parent and `_runExit()` re-evaluates the parent's
`hosts` and `_connections`, a contained failure needs no special sibling logic.
The parent simply continues its normal path.

### Navigation matrix

Using the confirmed configuration:

```text
host1.hosts = [hosta]        hosta.hosts = [hostaa]     hostaa.hosts = [hostaaa]
host2.hosts = [hostb,hostc]  hostb.hosts = [hostbb]     hostc.hosts = [hostcc]
host3.hosts = [hostd,hoste,hostf]
primary list = [host1, host2, host3]
```

| Failure at | Descendants torn down | Runs next | Eventually |
| --- | --- | --- | --- |
| `hosta` connect/auth | none started | `hostb` (host1's next sibling) | host1 completes, then host2 |
| `hosta` after `hostaa` is active | `hostaaa` if active, then `hostaa`, deepest-first | `hostb` | host1 completes, then host2 |
| `hostaa` | its active descendants only | `hosta`'s remaining siblings (none), then `host1`'s remaining siblings (`hostb`) | host2 |
| `host2` connect/auth | none | `host3` | callback after host3 |
| `host2` after `hostbb` is active | `hostbb` | `host3` (host2 has no parent) | callback |
| `hostb` command timeout | none beyond the record | `hostc` (sibling) | host2 completes, then host3 |
| `host3` (last primary) | active hop, if any | callback | run ends |
| Any record during `stop()` / `close()` | all active records | callback | run ends |

The rows encode four rules:

- **A hop failure never skips its siblings** and never advances the primary
  queue. The parent is restored and `_runExit()` continues.
- **A primary failure never resumes inside that primary**, because there is no
  parent. It advances to the next primary. Active descendants are finalized
  before the advance.
- **Descendants that never connected get no `end`.** Descendants that were
  active are finalized with their own session text, deepest-first, because they
  did run.
- **No retry.** Each record is attempted once. A failed hop is not re-opened and a
  failed primary is not retried. Reconnect is the separate follow-up.

### Interaction with the traversal loop

`_failContext` only chooses the failure branch. It does not duplicate the normal
loop:

```text
failure on a record
  -> _failContext(record)
       -> tear down active descendants (deepest-first)
       -> close and finalize the record
       -> primary: _endPrimary() -> next primary or callback
       -> hop:     _popTo(record) -> _runExit() on the parent
                     -> parent.hosts      (siblings)
                     -> _connections      (keep backing out)
                     -> primary 'exit'    (unchanged)
                     -> close()
```

This is why a command failure that affects connection state needs no separate
navigation: it calls `_failContext` at the same level a connection failure does.
A command that only fails, without touching the transport, never enters this
path.

## Connection loss and reconnection

The transport swap does not add automatic reconnection. It makes connection loss
observable per hop, which the command path cannot do: a nested `ssh` drop is only
inferred from shell text, and the parent shell is the only connection the library
owns.

| Failure | Records affected | This change | Possible follow-up |
| --- | --- | --- | --- |
| Target (leaf) connection drops | Leaf record and its descendants | Emit `error` / `close` for that record, finalize it, restore the parent, continue the parent path | Re-open the leaf with `forwardOut` and retry, subject to an idempotency policy |
| Expected drop after a breaking command | The record that ran the command | Same as an unexpected drop for now | Record `expectedClose`, then reconnect with `reconnectRetries` / `reconnectDelay`; emit `reconnect` with `expected: true` and resume at the next command. Only exhaustion emits an `error`. |
| Jump host connection drops | That record and every descendant | Tear down the descendants, then follow the primary close contract | Reconnect from the nearest live ancestor, or fail the run |
| Primary connection drops | The whole stack | Existing behavior: finalize, next primary or callback | Optional reconnect before advancing |

Design constraints for a future reconnect policy:

- **Command replay is not automatically safe.** A command may have partially
  executed before the drop. Retry must be opt-in per host and documented.
- **Reconnect from a live ancestor.** Use `forwardOut` from the nearest record
  that is still connected, not from the failed record.
- **Keep the pre-drop text.** `sessionText` must retain what ran and mark the
  boundary, so callers can tell what was lost.
- **Do not resurrect finalized hosts.** A reconnect must respect `stop()`,
  `close()`, and `_finalizedHosts`.

### Expected drops: reconnect after a known breaking command

A close event on its own is not a reconnect signal. An unexpected drop is a
failure, but a drop caused by a command the run just issued (`reboot`,
`shutdown -r`, `systemctl restart sshd`, a network reconfiguration) is expected.
Treating both the same either retries on a real failure or gives up on a planned
restart.

Mark the intent at the command level:

- A command can opt in with `breaksConnection: true`, or a host can list
  `connectionBreakingCommands` as regular expressions. Before the command is
  written, the active record gets `expectedClose = true`.
- If the command completes normally, clear `expectedClose`; the connection
  stayed up and nothing special happened.
- On `close`, if `record.expectedClose` is set, do not run the failure path.
  Mark the record `reconnecting`, keep it on the stack, and schedule a
  reconnect. Otherwise follow the normal finalize path.

Reconnect uses the same transport as the original connection:

| Record | Reconnect |
| --- | --- |
| Primary | `client.connect(server)` |
| Hop | `parent.connection.forwardOut(...)` then `client.connect({ ...server, sock })` |

The retry budget mirrors `commandTimeoutRetries`:

```js
sshObj.reconnectRetries = 3;   // attempts after the first drop
sshObj.reconnectDelay = 5000;  // ms between attempts
```

- Each attempt waits `reconnectDelay`, reconnects, waits for `ready`, and opens
  a new shell.
- The record's timer is tracked and cleared by `stop()`, `close()`, and
  `_finalizeRun()`.
- On success, the record resumes at the next command. The command that broke
  the connection is treated as complete; see
  [The breaking command's completion](#the-breaking-commands-completion).
- On exhaustion, emit `error` with the attempt count and fall back to today's
  close semantics: finalize the record, restore the parent, and continue the
  parent path.

### The breaking command's completion

The command that broke the connection still completes from the caller's point of
view: it ran, and the connection ended before a prompt. Fire the handler with
whatever output arrived:

- `commandComplete` fires with the buffer captured before the close and
  `details = { rawResponse, connectionClosed: true, expectedClose: true, reason }`.
- `details.rawResponse` is the partial buffer. `commandResponse: 'handled'` and
  `captureStderr` apply as usual, so `payload` and `details.stderr` behave the
  same as a normal completion.
- `sessionText` keeps the partial response and gets a boundary marker recording
  that the command did not return a prompt.
- Handler flags (`abort`, `skipCommands`, `skipHosts`, `skipPrimaryHosts`) are
  applied before the reconnect is scheduled, so a handler can still cancel the
  run.
- The handler does not advance the queue. `_nextCommand()` runs after the
  reconnect succeeds, so the next command is not written to a dead shell.

Guard the emission with the existing `_commandInFlight` flag. If the prompt
already completed the command before the close arrived, the handler has already
fired and the close only handles the reconnect.

An unexpected drop does not fire `commandComplete`: the command did not
complete, and the existing `Connection close` error is the signal. The partial
buffer still has to reach `sessionText`, because `_finalizeHost` only reads
`sessionText` and never looks at `_buffer`.

Add one helper for the partial-buffer append:

```js
_appendPartial(reason) {
  if (!this._buffer) {
    return '';
  }
  const partial = this._buffer;
  this._buffer = '';
  this.sshObj.sessionText += partial;
  this.sshObj.sessionText += `\n[connection closed${reason ? `: ${reason}` : ''}]\n`;
  return partial;
}
```

- **Expected drop:** the completion path appends the partial response and the
  boundary marker, then clears `_buffer` before scheduling the reconnect. The
  close path then sees an empty buffer and adds nothing, so the text is not
  duplicated.
- **Unexpected drop:** no `commandComplete`; `_appendPartial('connection-close')`
  runs before `_finalizeRun()`, so `end` and the callback see the partial text.
- **No command in flight:** the same helper preserves banner or prompt text that
  arrived before the close.
- Clearing `_buffer` in both paths is what stops a later stream `finish` from
  appending the same text twice.

### Reporting an expected drop

A planned reboot should not look like a failure, and a failed reconnect should
not look like the original drop. Report both through one event:

| Event | Payload | When |
| --- | --- | --- |
| `reconnect` | `(sshObj, details)` | When a reconnect is scheduled, before each attempt, and once on success |
| `error` | `(err, 'Reconnect', false)` | Only when the last reconnect attempt fails; an unexpected drop still emits the existing `Connection close` error |

`details` is `{ phase, attempt, maxRetries, delay, expected, reason }`:

- `phase` is `'scheduled'`, `'attempt'`, or `'success'`.
- `reason` is the matched command (`'reboot'`, `'systemctl restart sshd'`) for
  an expected drop. `'connection-lost'` is reserved for a future opt-in to
  retry unexpected drops.
- `expected` is `true` for a planned drop.

The initial close is reported as:

- **Expected drop:** `msg` plus a `reconnect` event with `expected: true`. No
  `error`; a reboot is not a fault.
- **Unexpected drop:** the existing `Connection close` error and no retry.

On exhaustion, the error carries the same details:

```js
const err = new Error(`Reconnect failed after ${details.maxRetries} attempts`);
err.level = 'Reconnect';
err.reconnect = details;
this.emit('error', err, 'Reconnect', false);
```

That keeps a reboot out of the error stream while still surfacing a real
reconnect failure, and lets a handler log "host rebooted" from the `reconnect`
event without treating it as a fault. Wire it like the other handlers: a host
`onReconnect(sshObj, details)` receives the same payload, and the event is a
no-op when no handler is set.

Rules:

- **Only the record whose connection closed reconnects.** A jump-host drop
  cannot be repaired from below. Reconnect the jump host from its own parent,
  then re-establish its descendants; until that is implemented, a jump-host drop
  tears down the descendants and follows the close contract.
- **Only expected closes reconnect.** An unmarked drop is a failure. Do not
  silently retry it; command replay is unsafe.
- **Respect stop and close.** A scheduled reconnect is cancelled by `stop()` and
  `close()`, and never resurrects a finalized host.
- **Keep the text boundary.** `sessionText` keeps the pre-drop output and gets a
  marker, so the caller can tell the command was cut short.
- **Do not replay the breaking command.** The restart is the point of the
  command; rerunning it would restart the host again. Replay, if ever needed, is
  a separate per-command option.

This stays out of the transport change. The initial implementation preserves
today's close semantics: a hop drop finalizes that host, returns to the parent,
and lets the normal traversal decide what runs next. The reconnect policy above
is the designed follow-up, because the transport change is what makes the close
event trustworthy enough to act on.

## Host config traversal

### Current code order

This is the order the code actually runs, verified against `src/ssh2shell.js`.
It is a loop, not a single pass: `_nextPrimaryHost()` is both the start and the
continuation after each primary closes.

| Step | Entry | What happens |
| --- | --- | --- |
| 1. Normalize the host list | `constructor()` | `typeIsArray(hosts) && hosts.length > 0 ? hosts : [hosts]`; `_primaryHostCount` and `_multipleHosts` are fixed here. |
| 2. Start / next primary | `connect()` -> `_nextPrimaryHost(this._connect)` | If `_hosts` has an entry: finalize the current primary, `_removeListeners()`, reset `_stream` and `_connections`, shift the next primary, reset `_primaryhostSessionText`, then `_initiate()`. |
| 3. Load defaults | `_initiate(action)` | `_loadDefaults()` first, then the action. Defaults, prompts, filters, timers, and host handlers are per host. |
| 4. Connect | `_connect()` | Bind client events, open the shell on `ready`, bind stream events, then `connection.connect(server)`. |
| 5. First command | `_onData()` | The first `standardPrompt` with `command === ''` calls `_nextCommand()`, which shifts `sshObj.commands` into `this.command`. |
| 6. Run commands | `_runCommand()` / `_commandComplete()` | A prompt with a command calls `_commandComplete()`, then `_nextCommand()` for the next one. |
| 7. No commands, nested hosts | `_nextCommand()` -> `_runExit()` -> `_nextHost()` | `_removeListeners()`, shift the child, push the current `sshObj` onto `_connections`, assign the child, `_initiate(_sshConnect)`. |
| 8. No nested host, ancestors | `_runExit()` -> `_previousHost()` | Finalize the child, `_removeListeners()`, pop the parent, reapply its timers, `_runExit()` on the parent. The parent has no commands left, so it goes to its remaining `hosts` or backs out again. |
| 9. Drained | `_runExit()` -> `close()` | `_closeStreamNow()` -> `_finalizeRun('close')` -> stream/connection close -> `connection.on('close')` -> `_callFinalCallback(_allSessions)`. |
| 10. Next primary | `connection.on('close')` | If `_hosts` still has entries, `_nextPrimaryHost(this._connect)`; otherwise the callback. |

Notes that matter for the transport change:

- **Nested text is merged one level at a time.** `_finalizeHost(nested)` calls
  `_mergeNestedText()` into its immediate parent's `sessionText`. Because a
  child finalizes before its parent, the parent then carries the child's text
  when it merges upward. `_finalizeHost(primary)` appends
  `_primaryhostSessionText` to `_allSessions`, so the callback sees one string
  per primary with the whole subtree in traversal order.
- **The parent never re-runs commands.** Its queue was consumed before it
  nested; on return `_runExit()` only looks at `hosts`, then `_connections`.
- **`_finalizeRun()` is the safety net.** It finalizes the active host plus
  `_connections` in reverse, so a transport drop still yields complete text.
- **The final close does not call `_removeListeners()`.** Host handlers are
  detached on a switch only; the final close relies on `_closing` /
  `_runComplete` and the `close` event.
- **Connection failure has no direct branch in `_connect()`.** It relies on
  `connection.on('error')` + `connection.on('close')` -> `_nextPrimaryHost`.
  A synchronous throw from `connection.connect()` only emits `error`, and there
  is no guaranteed `close`, so that case can stall. A nested failure is inferred
  from shell text in `_processSSHPrompt()` and backs out with `_previousHost()` /
  `_runExit()`. The hop path replaces both with `_hopFailed`.

#### The current nested topology is flat, not chained

This is the most important behaviour the transport change fixes, and it is easy
to miss because the traversal order looks correct.

`_processSSHPrompt()` pushes `exit` onto `sshObj.exitCommands` when the nested
shell reports a standard prompt. `_runExit()` drains `exitCommands` before it
looks at `sshObj.hosts`, so a nested host leaves its `ssh` shell before it runs
its own nested hosts. The next host is then connected from whatever shell is
active, which is the primary, not the host that just finished:

```text
host1 -> ssh hosta        (from host1's shell)
hosta commands
hosta _runExit: exit      (leaves hosta, back on host1's shell)
hosta _runExit: hosts     (ssh hostaa from host1's shell, not from hosta)
```

So with `host1.hosts = [hosta]`, `hosta.hosts = [hostaa]`,
`hostaa.hosts = [hostaaa]`, the real transport is:

```text
host1 -> hosta
host1 -> hostaa
host1 -> hostaaa
```

not `host1 -> hosta -> hostaa -> hostaaa`. The `_connections` config stack still
records `[host1, hosta, hostaa]`, but only one nested shell is open at a time and
it is always opened from the primary. `tunnel`, `chaining`, and
`tunnel_3_hop` pass today only because every test VM can reach every other test
VM directly. They do not prove a chain.

This also explains the fault result: a failed `ssh` command returns the parent
prompt, which `_processSSHPrompt()` accepts as success when `sshAuth` is already
true, so the failed host's commands run on the parent shell instead of being
reported as a connection failure. `test/live/host_faults.js` records that
behaviour and is the acceptance test for the new per-hop transport.

The new model opens a child client through `forwardOut` from its immediate
parent record and keeps every ancestor connection open until the child is closed,
so the topology becomes the real chain and a failed hop is a connection event
rather than shell text.


Two edge cases are worth fixing before changing step 1:

- `hosts = []` becomes `[[]]`, not an empty run; `_loadDefaults()` then reads
  `sshObj.server.host` and throws.
- `_nextPrimaryHost()` has no `else`, so it relies on the constructor
  guaranteeing at least one entry. `connect()` would emit `newPrimaryHost` with
  `undefined` otherwise.

### Host list normalization

The constructor should produce a well-defined list, and `connect()` should always
terminate:

```js
// constructor
const list = typeIsArray(hosts) ? hosts : [hosts];
if (list.length === 0 || list.some((host) => !host || typeof host !== 'object')) {
  throw new TypeError(
    'ssh2shell: a host config object or a non-empty array of host configs is required'
  );
}
this._hosts = list.slice(); // do not consume the caller's array
this._primaryHostCount = this._hosts.length;
this._multipleHosts = this._primaryHostCount > 1;
```

- A single host object stays supported.
- An empty array, `null`, or `undefined` fails at construction with a clear
  `TypeError`, instead of throwing later inside `_loadDefaults()`.
- `slice()` keeps `shift()` from mutating the caller's array. Today the same
  array passed to two runs is drained by the first.
- Nested `hosts` arrays stay lazy; only the primary list is validated.

`_nextPrimaryHost()` must always finish:

```js
_nextPrimaryHost(connect) {
  if (this._stopping || this._runComplete) {
    return this._callFinalCallback();
  }
  if (this._hosts.length === 0) {
    return this._callFinalCallback();
  }
  // ... existing body
}
```

`connect()` then always reaches either a primary or the callback.
`_callFinalCallback()` is already idempotent through `_callbackCalled`, so the
extra exit cannot double-call it.

The traversal contract is unchanged except that there is no exit command to
queue:

```text
command completes
  -> _commandComplete()
  -> _nextCommand(): next command, or _runExit()
       -> sshObj.hosts          (hop to the next nested host)
       -> _connections parent  (close the child record, return to the parent)
       -> literal 'exit'        (primary shell)
       -> close()
```

The confirmed walk, using the full test configuration:

```text
host1.hosts = [hosta]        hosta.hosts = [hostaa]     hostaa.hosts = [hostaaa]
host2.hosts = [hostb,hostc]  hostb.hosts = [hostbb]     hostc.hosts = [hostcc]
host3.hosts = [hostd,hoste,hostf]
primary list = [host1, host2, host3]
```

| Step | Active | `_connections` |
| --- | --- | --- |
| 1 | host1 | `[]` |
| 2 | hosta | `[host1]` |
| 3 | hostaa | `[host1, hosta]` |
| 4 | hostaaa | `[host1, hosta, hostaa]` |
| 5 | hostaa | `[host1, hosta]` |
| 6 | hosta | `[host1]` |
| 7 | host1 | `[]` |
| 8 | host2 | `[]` |
| 9 | hostb | `[host2]` |
| 10 | hostbb | `[host2, hostb]` |
| 11 | hostb | `[host2]` |
| 12 | host2 | `[]` |
| 13 | hostc | `[host2]` |
| 14 | hostcc | `[host2, hostc]` |
| 15 | hostc | `[host2]` |
| 16 | host2 | `[]` |
| 17 | host3 | `[]` |
| 18 | hostd | `[host3]` |
| 19 | host3 | `[]` |
| 20 | hoste | `[host3]` |
| 21 | host3 | `[]` |
| 22 | hostf | `[host3]` |
| 23 | host3 | `[]` |
| 24 | close() | n/a |

The pattern is the same at every depth: going down pushes the active record,
finishing a child pops its parent back to active, and siblings push that same
parent again. The primary never sits in `_connections` while it is active, and
`_nextPrimaryHost()` starts the next primary with an empty stack.

`_runExit()` becomes:

```js
_runExit() {
  if (this._runComplete) {
    return;
  }

  this._progressEnd();

  if (this._stopping) {
    return this._beginStopExit();
  }

  if (!this._gracefulClosing && this.sshObj.hosts && this.sshObj.hosts.length > 0) {
    return this._nextHost();
  }

  if (this._connections && this._connections.length > 0) {
    this.emit('msg', `${this._hostPrefix()}${this.sshObj.closedMessage}`);
    return this._previousHost();
  }

  if (!this._gracefulClosing && this.command === 'exit') {
    return this._runCommand('exit');
  }

  return this.close();
}
```

The literal `'exit'` branch stays for a user command or the primary shell. The
only remaining use is the user-issued `exit` that leaves `su` / `sudo -i` and
the final primary shell; it is not how a hop is left. `_previousHost()` closes
the child connection.

`exitCommands` is removed because its only producer was `_processSSHPrompt()`
pushing `exit` for a nested `ssh` shell. The `su` test in
`test/live/sudo_su.js` already uses a normal command entry, so it is unaffected.
Remove the stale "sudo su has been authenticated and add an extra exit command"
comment in `_commandComplete()` with the `sshToNextHost` guard.

### Stack operations

`_nextHost()` no longer pushes the parent config. It hands the child to
`_connectHop()`, and `_connect(parent)` pushes the parent record before the child
becomes active:

```js
_nextHost() {
  if (this._stopping || this._runComplete) {
    return;
  }
  // The outgoing record is still active here; its handlers must go before the
  // child's config replaces the aliases.
  this._removeListeners(this._activeContext());
  const nextHost = this.sshObj.hosts.shift();
  this.sshObj = nextHost;
  this.host = nextHost.server.host;
  return this._initiate(this._connectHop);
}
```

`_nextHost()` sets `this.sshObj` to the child before `_connectHop()` runs, so
`_pushContext()` must push the `parent` argument it is given, not `this.sshObj`.
The parent record is already authoritative in `this._active`.

`_previousHost()` closes the active child record, pops its parent, makes the
parent active, and lets `_runExit()` decide what runs next:

```js
_previousHost() {
  if (this._stopping || this._runComplete) {
    return;
  }
  const child = this._activeContext();
  this._closeContext(child, 'previous-host'); // removes listeners + finalizes
  this._popContext(); // pops the parent, makes it active, restores the aliases
  return this._runExit();
}
```

`_nextPrimaryHost()` closes the active record and every ancestor before it resets
the stack, so a new primary never inherits a hop's socket:

```js
_nextPrimaryHost(connect) {
  // ...
  this._closeAllContexts('next-primary-host');
  this._connections = [];
  this._stream = {};
  this.sshObj = this._hosts.shift();
  // ...
  return this._initiate(connect); // _connect(null) makes the new primary active
}
```

`_closeContext()` is idempotent through `context.closed`; `_popContext()` pops
the parent, makes it active, and re-points `this.connection`, `this._stream`,
`this.sshObj`, and `this.host` at it. That is the whole array contract: push the
parent in `_connect` when `parent` is set, close and pop in `_previousHost` /
`_closeAllContexts`, restore aliases on every change.

What changes is the stack:

| Current | New |
| --- | --- |
| `_connections` holds parent host configs | `_connections` holds ancestor records: host config **plus** connection, stream, parent, and flags |
| `_connections[0]` is the first ancestor, not the primary | `_connections[0]` is the primary record while a hop is active; at a primary the stack is empty |
| `_nextHost()` pushes the current host | `_connect(parent)` pushes the current active record, then makes the child active |
| `_previousHost()` pops a host | `_previousHost()` closes the active child, then pops its parent |
| `_nextPrimaryHost()` resets `_connections` | `_nextPrimaryHost()` closes the active record and every ancestor, then resets the stack |

Because the active host is outside the stack, "is there a parent to return to?"
stays `_connections.length > 0`. The traversal order itself does not change:
nested `hosts`, then the parent record, then the primary `exit`, then `close()`.

Nested host objects are still consumed from `sshObj.hosts` with `shift()`, so
`skipHosts`, `skipPrimaryHosts`, `skipCommands`, `abort`, and `stop` keep their
documented behavior. `_multipleHosts` and the `[host]` message prefix are
unchanged.

`_loadDefaults` still runs on every host switch, so prompt/filter compilation,
timer overrides, and handler binding follow the active host. `_removeListeners`
still detaches the outgoing host's handlers before the next context becomes
active, but it now takes that host's record so it cannot remove a parent's or a
child's handlers by mistake. `_restoreContext()` reapplies the parent's timer
values, so the instance-level `idleTime` / `dataIdleTime` match the active host
after backing out of a hop.

## Reuse of standard handlers

The handlers are reused as they are. `debug`, `verbose`, `onMsg`, `progress`,
sudo prompts, command responses, stderr capture, and the default error listener
all read the active host and active aliases, which is still the child while the
child is active. No handler needs to know whether the host is primary or nested.

| Handler / event | Behaviour on a hop |
| --- | --- |
| `onCommandProcessing` | Fires for the active child command, same as a primary command. |
| `onCommandComplete` | Receives the child host's `sshObj` and the same `details` (`rawResponse`, optional `stderr`). |
| `onCommandTimeout` | Same `details` (`attempt`, `maxRetries`, `final`). The idle timer and retries work per command. |
| `onData` | Fires for active child data. Inactive parent stream data is dropped before it reaches `_onData`. |
| `onStderrData` | Fires for the active child stream. `captureStderr` still merges into the child response. |
| `onEnd` | Fires once per visited host, child before parent. |
| `onError` | Host handler runs for the event's record; the default listener keeps its existing close semantics for the active record. |
| `onMsg` | Same `_systemMsg` path and `[host]` prefix rules. |
| `onKeyboardInteractive` | Bound per connection; the instance event fires with that connection's `finish`. |
| `reconnect` | Follow-up only. Fires with the record's `sshObj` and `{ phase, attempt, maxRetries, delay, expected, reason }`; a reboot reports `expected: true`, a real failure is an `error` with `level: 'Reconnect'`. |
| `progress` | One heartbeat for the active command; `_progressEnd()` runs before a host switch. |

The one implementation rule is for library code, not users: an event handler
must act on the record it was bound to, not on `this.connection` /
`this._stream`. Those aliases always mean "active record", and a late parent
event is not the active record.

## `server.ssh` migration

`server.ssh` is removed with the command path. This table is the user-facing
replacement:

| `server.ssh` | Replacement |
| --- | --- |
| `identityFile` | Local `privateKey` (contents) or a local `agent`. A path on the jump host no longer works. |
| `forceAddressType` | `forceIPv4: true` or `forceIPv6: true`. |
| `forceProtocolVersion` | Not supported; `ssh2` speaks SSH-2 only. |
| `disablePseudoTTY` | `pty: false` on the host. |
| `forcePseudoTTY` | `pty: true` on the host. |
| `verbose` | `debug: true` on the host, or `ssh2` debug output. |
| `cipherSpec` | `algorithms: { cipher: [...] }`. |
| `macSpec` | `algorithms: { mac: [...] }`. |
| `loginName` | `userName` on `server`. |
| `options` | The equivalent `ssh2` connect option. |
| `escape`, `logFile`, `configFile` | No equivalent; use local `ssh2` options or the local SSH configuration. |
| `StrictHostKeyChecking=no` (implicit) | `ssh2` accepts the key when no verifier is set; set `hostHash` / `hostVerifier` to verify. |

## Risks and open questions

1. **Credential location is a breaking change.** The current nested path uses
   keys and agents on the jump host. The hop uses the local process. This must
   be called out in the release notes and migration guide.
2. **Host-key policy.** The current path disables strict checking. The hop
   inherits `ssh2` defaults, which accept any key unless `hostVerifier` is set.
   Decision: match the primary contract and stay silent; document that a hop
   should set `hostHash` / `hostVerifier` when verification is required.
3. **`forwardOut` restrictions.** A jump host can deny direct-tcpip channels.
   The error must be visible and must not leave the parent record inactive.
4. **Source address for `forwardOut`.** Use `127.0.0.1:0` unless a server
   rejects it. Make the source values internal constants, not host properties.
5. **Name resolution.** `forwardOut` sends the destination to the jump host, so
   names resolve there. Document this; it matches the current `ssh` command
   behaviour.
6. **Inactive parent data.** A parent shell can emit a late prompt or keepalive
   output while the child runs. Drop it before it reaches the child's `_buffer`.
7. **`keyboard-interactive` on a child.** Already bound per client by
   `_bindConnection`; keep the `finish` callback with that connection. No
   contract change.
8. **`exitCommands` is removed.** There is no nested shell to leave. Stop and
   close now close connections directly. If a caller relied on the runtime
   array, call that out in the migration notes.
9. **Versioning.** Removing `server.ssh` and the command path is a major
   change. A temporary `hostHop: 'ssh2' | 'ssh'` compatibility switch was
   considered and rejected: the requirement is to remove the nested `ssh` path,
   not keep it as a baseline. Ship the removal in the major release.
10. **`this.connection` / `this._stream` aliases.** They remain for
    compatibility, but they now mean "active record". Document that they are
    not stable across a host hop.
11. **Active host outside the stack.** `_connections` holds only ancestors, so
    `length > 0` keeps meaning "nested" and `_connections[0]` is the primary only
    while nested. The record-shape changes at the sites listed in
    [Checks that keep their meaning](#checks-that-keep-their-meaning) must land
    before the command path is removed.
12. **Pending `forwardOut` during stop/close.** There is no child stream yet
    while the channel is being opened. `_hopFailed` and the stop path must
    close the parent record, not assume an active child.
13. **`Security Alert` removal.** There is no shell string to validate, so the
    `Security Alert` error type and `shellQuote` / `shellControlChars` are gone.
    Host-key acceptance becomes an `ssh2` policy (`hostHash` / `hostVerifier`)
    instead of a forced `StrictHostKeyChecking=no`.
14. **Reconnection is out of scope.** The per-hop model makes it possible, but
    command replay is unsafe by default. Do not bundle it with the transport
    change; see
    [Connection loss and reconnection](#connection-loss-and-reconnection). The
    intended follow-up is an expected-drop reconnect: a command marked
    `breaksConnection` records `expectedClose`, and a bounded
    `reconnectRetries` / `reconnectDelay` timer reconnects that record and
    resumes at the next command.
15. **Listener ownership is part of the transport change, not cleanup.** A hop
    close returns to a live parent, so the hop's handlers must be removed before
    the parent's aliases are restored. `_removeListeners(context)` must use the
    config that bound the handlers, not `this.sshObj`, or a late ancestor event
    removes the wrong host's handlers. Land record-scoped `listeners` and timers
    before the first hop is enabled.
16. **Navigation policy must be one rule.** Primary failure advances; hop failure
    is contained. Connection failures, `forwardOut` errors, stream errors, and
    connection-breaking command timeouts all enter `_failContext`; do not add a
    second failure branch in a handler. The navigation matrix in
    [Host navigation on failure](#host-navigation-on-failure) is the acceptance
    test for that rule.

## Test plan

### Unit

- Replace `test/unit/ssh-connect.test.js` with a hop suite:
  - `_connect(null)` makes the primary active with `_connections = []`.
  - `_connect(parent)` pushes the active parent record and calls
    `parent.connection.forwardOut` with the child host and port.
  - The child client receives `sock`.
  - A `forwardOut` error emits `error`, leaves the parent active, and continues
    the parent path.
  - `_nextHost` switches to `_connectHop` and does not queue `exit`.
  - `_previousHost` closes the child stream and connection, pops the parent, and
    restores the parent aliases.
  - A leaf `connection.on('close')` finalizes only the leaf record and restores
    the parent.
  - An ancestor `connection.on('close')` tears down its descendants first.
  - Child `close` does not advance the primary-host queue.
  - A primary connect failure advances to the next primary (verified today); a
    synchronous `connect()` throw does the same through `_endPrimary`.
  - A failed hop does not run its own descendants and does not skip its siblings.
  - A connection-breaking command timeout on a hop closes only that hop; the
    parent's remaining siblings still run.
  - `_failContext` is re-entrant-safe: a close that arrives during descendant
    teardown does not unwind twice.
  - `_removeListeners(context)` removes only that record's handlers; a parent's
    handler still fires after a child is closed, and a child's handler does not
    fire against the parent.
  - `stop()` closes the active record and its ancestors deepest-first and
    finalizes each host once.
  - `_finalizeRun` emits one `end` per visited host.
  - Inactive parent stream data is dropped.
- Update traversal tests in `test/unit/hosts.test.js` to build records instead
  of bare host configs in `_connections`.
- Remove the nested-prompt cases from `test/unit/prompts.test.js` and
  `test/unit/prompt-regex.test.js`; keep the primary prompt and sudo cases.
- Remove the command-building and `Security Alert` cases with
  `test/unit/ssh-connect.test.js`.
- Update `test/unit/error-handling.test.js` for hop connection errors and for
  the active record living outside `_connections`.
- Update `test/unit/api-baseline.test.js` and `test/unit/credentials.test.js`
  for the removed `sshAuth` / `sshToNextHost` fields.
- Guard new hop tests with `if (isBaseline()) return;`; the frozen baseline
  still has the command path and cannot run them.

### Reconnect follow-up

- A command marked `breaksConnection` sets `expectedClose`; a normal completion
  clears it.
- Expected close fires `commandComplete` with the partial buffer,
  `details.connectionClosed = true`, and no `error`.
- `reconnect` fires with `scheduled`, `attempt`, and `success` phases; the next
  command runs only after success.
- Exhaustion emits `error` with `level: 'Reconnect'` and falls back to the close
  path.
- `stop()` and `close()` cancel a pending reconnect timer.

### Live

Run in this order. The existing suite is the regression gate; a new hop test is
not trusted until the existing tests still pass.

Live tests and `provision.js` load their build through
`test/utils/module.js`, so the same suite can run against `src` (the default
development target), `lib` (the release build), `baseline` (the frozen
regression fixture), or a repo-relative path:

```bash
SSH2SHELL_MODULE=src node scripts/run-live.js --all
SSH2SHELL_MODULE=lib node scripts/run-live.js --all
SSH2SHELL_MODULE=baseline node scripts/run-live.js --all
```

`scripts/run-live.js` resolves the target once and passes an absolute
`SSH2SHELL_LIVE_MODULE` to the instrumentation preload and the test process, so
both use the same module instance. The runner prints the selected module.

1. **Existing live suite, unchanged.** Run every test that exercises the
   current nested path:

   - `tunnel`
   - `chaining`
   - `tunnel_3_hop`
   - `multiple_primary_hosts`
   - `stop_multiple_hosts`
   - `graceful_close`
   - `transport_drop`

   `tunnel`, `chaining`, and `tunnel_3_hop` are the hop tests: as part of the
   change they stop using `server.ssh.identityFile` on the jump host and use the
   runner's local `privateKey` for every host. That is the migration proof.

2. **New hop tests.** Extend `transport_drop` for a leaf hop drop (parent path
   continues) and a jump-host drop (descendants tear down). Add a case for a
   jump host that denies `forwardOut`, if the test VMs can be configured that
   way.

   Two tests already cover the host-array shape:

   - `test/live/host_traversal.js` walks three primaries with nested hosts at
     three depths and sibling branches. It asserts the depth-first marker order
     and logs `end-order`. It passes on both transports.
   - `test/live/host_faults.js` fails a nested leaf, a descendant that never
     starts, and a primary. It asserts the containment contract:

     ```text
     fault-order:primary1,good-hop,good-sibling,primary2
     error-count:2
     end-order:bad-deep,good-hop,good-sibling,primary1,bad-primary,primary2
     ```

     The current nested-`ssh` path fails it: `bad-deep` runs on the parent
     shell, `good-sibling` is skipped, and only the primary error is reported.
     Treat a green `host_faults` run as the acceptance check for
     `_failContext` and the primary/hop navigation split.

   Run them through the runner, which allows the expected `ECONNREFUSED`
   marker:

   ```bash
   node scripts/run-live.js host_traversal host_faults --timeout 180
   ```

3. **Clean-VM provisioning.** After the suite is green, rebuild a VM with
   `test/provision/provision.js` and rerun the hop tests against it. A fresh VM
   has no cached keys, no `~/.ssh/id_ed25519` on the test users, and default
   `sshd` settings, so it catches assumptions the existing VMs hide.

   - Remove the `hopKeyUsers` private-key copy from provisioning. It exists only
     for the nested `ssh -i` model; `forwardOut` uses the runner's local key.
   - Keep the public key in every test user's `authorized_keys`.
   - Run `npm run provision -- server1`, then `tunnel`, `chaining`, and
     `tunnel_3_hop` with server1 as the jump host.
   - Confirm the hop works with no private key on server1 or server2. That is
     the real-world proof that credentials are local to the runner.

### Verification

- `npm test` — unit and frozen baseline.
- `node scripts/run-live.js --all` — existing suite first.
- Re-run the hop tests after a clean provisioning.
- `git diff --check`.

## Implementation order

1. Normalize the host list in the constructor and make `_nextPrimaryHost()`
   terminate: validate a single object or non-empty array, `slice()` the caller's
   array, and fall back to `_callFinalCallback()` when the queue is empty or the
   run is stopping.
2. Turn `_connections` into the ancestor stack: `_pushContext()`,
   `_activeContext()`, `_popContext()`, `_popTo()`, `_restoreContext()`,
   `_descendantsOf()`, and `_closeContext()`. `_connect(null)` makes the primary
   active with an empty stack. `_closeContext` calls `_removeListeners(context)`.
3. Move listener and timer ownership onto the record: `_loadDefaults(context)`
   binds into `context.listeners`, `_removeListeners(context)` removes only that
   map, and `idleTimer` / `dataReceivedTimer` become record-scoped. Remove the
   instance `_boundListeners` dependency for host handlers.
4. Extract `_normalizeServer()`, `_bindConnection()`, `_openShell()`, and
   `_openClient()` from `_connect()`; keep the primary path green.
5. Add the hop branch to `_connect(parent)`, add the `_connectHop()` adapter, and
   switch `_nextHost()` to it.
6. Add `_failContext()`, `_endPrimary()`, `_hopFailed()`, and `_popTo()`, and route
   `connection.on('close')`, the synchronous `connect()` throw, `forwardOut`
   errors, stream errors, and connection-breaking command timeouts through them.
   Verify the primary-advance and hop-contained cases from the navigation matrix.
7. Update `_previousHost()`, `_nextPrimaryHost()`, `_finalizeHost()`,
   `_finalizeRun()`, `_mergeNestedText()`, `_processNotifications()`, and
   `_runExit()` for the record stack. The `length > 0` checks keep their meaning.
8. Update `stop()`, `_beginStopExit()`, `_finishStop()`, `close()`, and
   `_closeStreamNow()` to close the active record and its ancestors without an
   exit-command drain.
9. Remove `_sshConnect()`, `_processSSHPrompt()`, the SSH case in `_onData()`,
   the `sshToNextHost` guard in `_commandComplete()`, `sshAuth`,
   `sshToNextHost`, `passphrasePrompt`, `exitCommands`, `buildSshCommand()`,
   `ssh-command.js`, `shellQuote`, `shellControlChars`, the `Security Alert`
   path, and `server.ssh` handling.
10. Update the README, `docs/API-BASELINE.md`, `docs/CLOSE-SEMANTICS.md`, and
    `docs/ERROR-HANDLING.md`.
11. Replace the unit suites and run the live suite.

## Rollback

- The work is isolated on `next-host-connection`.
- Until the branch merges, `v3.3.0` is the stable boundary.
- If the change ships, tag the major release and record it in
  [REFACTORING.md](../REFACTORING.md) as the rollback boundary.
