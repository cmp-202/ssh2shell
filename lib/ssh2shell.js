// ssh2shell
// A wrapper class for ssh2 to run multiple sequential commands in an SSH shell
// session, handle command responses, and tunnel through to other hosts using
// nested host objects.
//
// The class is the public facade. Pure default application, prompt/filter
// compilation, and credential redaction live in ./ssh2shell/*. Host hops are
// real ssh2 connections opened through the parent connection's forwardOut
// channel; there is no nested `ssh` command.

const Stream = require('node:stream');

const { applyHostDefaults } = require('./ssh2shell/defaults');
const {
  compileAsciiFilter,
  compilePrompts,
  compileTextColorFilter,
  credentialSecrets,
  redactCredentials,
  redactString,
  stripTerminalEscapes,
  typeIsArray,
} = require('./ssh2shell/util');

// Timer config values may arrive as numbers or numeric strings. Anything that
// is not a finite positive number is treated as "not configured".
function toPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

// Retry counts are whole numbers; anything else is treated as zero.
function toNonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

// Removes the echoed command from the start of a response. A PTY can wrap a
// long command across lines, so CR/LF are skipped while matching. Returns the
// original buffer when the echo is not present.
function stripEchoedCommand(buffer, command) {
  if (!command) {
    return buffer;
  }

  let index = 0;
  for (let position = 0; position < command.length; position += 1) {
    while (buffer[index] === '\r' || buffer[index] === '\n') {
      index += 1;
    }
    if (buffer[index] !== command[position]) {
      return buffer;
    }
    index += 1;
  }

  // Remove the line break that follows the echoed command.
  if (buffer[index] === '\r') {
    index += 1;
  }
  if (buffer[index] === '\n') {
    index += 1;
  }

  return buffer.slice(index);
}

class SSH2Shell extends Stream {
  constructor(hosts) {
    super(hosts);

    // Methods that were CoffeeScript fat-arrows are bound in the constructor.
    // Keep the same list and order so callbacks and event listeners keep
    // their `this`.
    this._connect = this._connect.bind(this);
    this.connect = this.connect.bind(this);
    this._connectHop = this._connectHop.bind(this);
    this._loadDefaults = this._loadDefaults.bind(this);
    this._initiate = this._initiate.bind(this);
    this._removeListeners = this._removeListeners.bind(this);
    this.close = this.close.bind(this);
    this.stop = this.stop.bind(this);
    this._runExit = this._runExit.bind(this);
    this._nextPrimaryHost = this._nextPrimaryHost.bind(this);
    this._nextHost = this._nextHost.bind(this);
    this._previousHost = this._previousHost.bind(this);
    this._runCommand = this._runCommand.bind(this);
    this._checkCommand = this._checkCommand.bind(this);
    this._nextCommand = this._nextCommand.bind(this);
    this._commandComplete = this._commandComplete.bind(this);
    this._finalizeHost = this._finalizeHost.bind(this);
    this._finalizeRun = this._finalizeRun.bind(this);
    this._mergeNestedText = this._mergeNestedText.bind(this);
    this._applyHandlerFlags = this._applyHandlerFlags.bind(this);
    this._resetRunState = this._resetRunState.bind(this);
    this._callFinalCallback = this._callFinalCallback.bind(this);
    this._beginStopExit = this._beginStopExit.bind(this);
    this._finishStop = this._finishStop.bind(this);
    this._forceStop = this._forceStop.bind(this);
    this._clearStopTimer = this._clearStopTimer.bind(this);
    this._armStopTimer = this._armStopTimer.bind(this);
    this._prepareGracefulClose = this._prepareGracefulClose.bind(this);
    this._clearCloseTimer = this._clearCloseTimer.bind(this);
    this._armCloseTimer = this._armCloseTimer.bind(this);
    this._forceClose = this._forceClose.bind(this);
    this._closeStreamNow = this._closeStreamNow.bind(this);
    this._processNotifications = this._processNotifications.bind(this);
    this._resetFromSudoError = this._resetFromSudoError.bind(this);
    this._processSudoPrompt = this._processSudoPrompt.bind(this);
    this._sanitizeResponse = this._sanitizeResponse.bind(this);
    this._onData = this._onData.bind(this);
    this._callback = this._callback.bind(this);
    this._systemMsg = this._systemMsg.bind(this);
    this._detachListener = this._detachListener.bind(this);
    this._boundListener = this._boundListener.bind(this);
    this._loadDefaultListeners = this._loadDefaultListeners.bind(this);
    this._normalizeServer = this._normalizeServer.bind(this);
    this._bindConnection = this._bindConnection.bind(this);
    this._openShell = this._openShell.bind(this);
    this._openClient = this._openClient.bind(this);
    this._pushContext = this._pushContext.bind(this);
    this._activeContext = this._activeContext.bind(this);
    this._popContext = this._popContext.bind(this);
    this._popTo = this._popTo.bind(this);
    this._restoreContext = this._restoreContext.bind(this);
    this._attachContextListeners = this._attachContextListeners.bind(this);
    this._descendantsOf = this._descendantsOf.bind(this);
    this._closeContext = this._closeContext.bind(this);
    this._closeAllContexts = this._closeAllContexts.bind(this);
    this._failContext = this._failContext.bind(this);
    this._hopFailed = this._hopFailed.bind(this);
    this._endPrimary = this._endPrimary.bind(this);
    this._pendingHosts = this._pendingHosts.bind(this);
    this._appendPartial = this._appendPartial.bind(this);
    this._reportMissingParameters = this._reportMissingParameters.bind(this);
    this._bindHostListener = this._bindHostListener.bind(this);
    this._streamFor = this._streamFor.bind(this);
    this._hasLiveStreamFor = this._hasLiveStreamFor.bind(this);
    this.ssh2Client = require('ssh2').Client;

    // A single host config or a non-empty array of host configs. The caller's
    // array is copied so shift() cannot drain a config reused by another run.
    const list = typeIsArray(hosts) ? hosts : [hosts];
    if (
      list.length === 0 ||
      list.some((host) => !host || typeof host !== 'object')
    ) {
      throw new TypeError(
        'ssh2shell: a host config object or a non-empty array of host configs is required'
      );
    }
    this._hosts = list.slice();
    this._primaryHostCount = this._hosts.length;
    this._multipleHosts = this._primaryHostCount > 1;
    this._boundListeners = {};
    this.sshObj = {};
    // `_connections` holds the ancestors of the active record; `_active` is the
    // active record itself. A primary host has an empty stack.
    this._connections = [];
    this._active = null;
    this._primaryEnded = false;
    this.host = "No host";
    this._allSessions = '';
    this._defaultErrorListener = null;
    this._defaultDataListener = null;
    this._defaultStderrListener = null;
    // Progress output is on by default and written to stderr so it never
    // touches sessionText. The stream and interval are instance state so a test
    // or a consumer can substitute a TTY-like sink without changing the host
    // config.
    this._progressStream = process.stderr;
    this._progressInterval = 1000;
    this._progressTimer = null;
    this._progressRunning = false;
    this._progressLine = false;
    this._progressHost = null;
    this._progressMsgListener = null;

    // Shutdown state. `_closing` means no more writes; `_stopping` means the
    // whole run (commands, nested hosts, and primary hosts) is being aborted.
    this._closing = false;
    this._stopping = false;
    this._stopReason = null;
    this._stopTimer = null;
    this._commandInFlight = false;
    this._stderrBuffer = '';
    this._inCommandComplete = false;
    this._started = false;
    this._runComplete = false;
    this._callbackCalled = false;
    this._gracefulClosing = false;
    this._closeTimer = null;
    // Hosts are tracked by object identity so finalization and nested-text
    // merging are idempotent across the normal path and an abrupt close.
    this._finalizedHosts = new Set();
    this._mergedHosts = new Set();
    this._loadDefaultListeners();
  }
  
  _loadDefaultListeners() {
    if (!this.msg) {
      this.msg = (message) => {
          console.log(message);
        };
    }
    // Keep the instance fallback available between hosts. A host-specific `msg`
    // handler replaces it while that record is active; _removeListeners
    // restores it when the record is left. Check whether the host handler is
    // actually attached, not just present in the record: a switch detaches it
    // before the child is created.
    const active = this._activeContext();
    const hostMsgAttached = Boolean(
      active &&
        active.listeners &&
        typeof active.listeners.msg === 'function' &&
        this.listeners('msg').includes(active.listeners.msg)
    );
    if (!hostMsgAttached && !this.listeners('msg').includes(this.msg)) {
      this.on('msg', this.msg);
    }
    // Break the progress line before any msg listener runs, including a
    // caller-supplied handler. This keeps a heartbeat from prefixing a message.
    if (!this._progressMsgListener) {
      this._progressMsgListener = () => {
        this._progressBreak();
      };
      this.prependListener('msg', this._progressMsgListener);
    }
    if (!this._defaultDataListener) {
      this._defaultDataListener = (data) => {
        this._onData(data);
      };
      this.on('data', this._defaultDataListener);
    }
    if (!this._defaultStderrListener) {
      this._defaultStderrListener = (data) => {
        console.error(data);
      };
      this.on('stderrData', this._defaultStderrListener);
    }
    // Track the default error listener separately from host `onError` handlers.
    // The host cache entry is cleared when a host handler is detached, which
    // used to make the next host install a second default listener.
    if (!this._defaultErrorListener) {
      this._defaultErrorListener = (err, type, close = false, callback, context) => {
        this._progressEnd();
        this._systemMsg('debug', `Class.error: ${err}, ${type}`);

        if (err instanceof Error) {
          this.emit('msg', `Error: ${err.message}, Level: ${err.level}`);
        } else {
          this.emit('msg', `${type} error: ${err}`);
        }

        // Run the optional callback before closing so timeout bookkeeping (for
        // example appending the partial buffer to sessionText) happens while
        // the stream can still finish normally.
        if (typeof callback === 'function') {
          callback.call(this, err, type, close);
        }

        // Only close a real shell stream. Before the shell opens, the active
        // stream is the `{}` placeholder, which has no close method. The
        // optional context lets an ancestor error close its own stream instead
        // of the active child's.
        if (close) {
          const target = context || this._activeContext();
          const stream = target && target.stream ? target.stream : this._stream;
          if (stream && typeof stream.close === 'function') {
            stream.close();
          }
        }
      };
    }
    if (!this.listeners('error').includes(this._defaultErrorListener)) {
      this.on('error', this._defaultErrorListener);
    }
    return;
  }
  
  _boundListener ( eventName, listener, prepend = false ) {
    if ( typeof listener === `function` ){
      // Avoid attaching the same handler twice when _loadDefaults runs again.
      if (this._boundListeners[eventName] === listener) {
        return;
      }
      this._boundListeners[eventName] = listener;
      if (prepend) {
        this.prependListener(eventName, listener);
      } else {
        this.on(eventName, listener);
      }
    }
    
    return;
  }

  // A real shell stream exists only after `connection.shell` succeeds. Before
  // that, the active stream is the `{}` placeholder.
  _hasLiveStream() {
    const context = this._activeContext();
    const stream = context && context.stream ? context.stream : this._stream;
    return Boolean(stream && typeof stream.close === 'function');
  }

  // Bind a host handler to this instance and remember it on the record so the
  // exact function can be removed when the record is left. Replacing a handler
  // for the same event removes the previous record handler first.
  _bindHostListener(context, eventName, listener, prepend = false) {
    if (!context || typeof listener !== 'function') {
      return;
    }

    const previous = context.listeners[eventName];
    if (previous === listener && this.listeners(eventName).includes(listener)) {
      return;
    }
    if (typeof previous === 'function' && previous !== listener) {
      this.removeListener(eventName, previous);
    }

    context.listeners[eventName] = listener;
    if (prepend) {
      this.prependListener(eventName, listener);
    } else {
      this.on(eventName, listener);
    }
  }

  // Re-attaches the handlers a record bound before it was left for a child.
  // Host handlers are detached on every switch, so restoring an ancestor has
  // to put its own handlers back before it can finish (for example `onEnd`).
  _attachContextListeners(context) {
    if (!context || !context.listeners) {
      return;
    }

    for (const [eventName, listener] of Object.entries(context.listeners)) {
      if (typeof listener !== 'function') {
        continue;
      }
      if (this.listeners(eventName).includes(listener)) {
        continue;
      }
      if (eventName === 'msg' && this.listeners('msg').includes(this.msg)) {
        this.removeListener('msg', this.msg);
      }
      if (eventName === 'error') {
        this.prependListener(eventName, listener);
      } else {
        this.on(eventName, listener);
      }
    }
  }

  // Returns the stream that belongs to a record. Tests and embedders can set
  // `_stream` directly without going through `_openShell`, so the active record
  // falls back to the instance alias.
  _streamFor(context) {
    if (!context) {
      return null;
    }
    if (context.stream) {
      return context.stream;
    }
    return context === this._activeContext() ? this._stream : null;
  }

  _hasLiveStreamFor(context) {
    const stream = this._streamFor(context);
    return Boolean(stream && typeof stream.close === 'function');
  }

  // Copy the server options so the host config is not mutated. `ssh2` uses
  // `username` / `passphrase`; the public API keeps the legacy aliases.
  _normalizeServer(server) {
    const options = Object.assign({}, server || {});
    delete options.ssh;
    if (!options.username) {
      options.username = options.userName;
    }
    if (!options.hostHash) {
      options.hostHash = options.hashMethod;
    }
    if (!options.passphrase) {
      options.passphrase = options.passPhrase;
    }
    return options;
  }

  // Creates the record for the active host. `parent === null` is a primary;
  // otherwise the parent record is pushed onto the ancestor stack first.
  _pushContext(host, parent) {
    if (parent) {
      this._connections.push(parent);
    }

    const record = {
      host,
      parent: parent || null,
      connection: null,
      stream: null,
      isPrimary: !parent,
      closed: false,
      failing: false,
      listeners: {},
      idleTimer: null,
      dataReceivedTimer: null,
      expectedClose: false,
      idleTime: this.idleTime,
      dataIdleTime: this.dataIdleTime,
      pendingHosts: null,
      reportedError: false,
    };

    this._active = record;
    this.sshObj = host;
    this.host = host.server ? host.server.host : 'No host';
    this.connection = null;
    this._stream = {};
    this.idleTimer = null;
    this.dataReceivedTimer = null;
    return record;
  }

  _activeContext() {
    return this._active || null;
  }

  // Makes a record the active host again and re-points the compatibility
  // aliases at it.
  _restoreContext(context) {
    if (!context) {
      return null;
    }
    this._active = context;
    this.connection = context.connection;
    this._stream = context.stream || {};
    this.sshObj = context.host;
    this.host = context.host && context.host.server
      ? context.host.server.host
      : this.host;
    this.idleTime = context.idleTime;
    this.dataIdleTime = context.dataIdleTime;
    this.idleTimer = context.idleTimer || null;
    this.dataReceivedTimer = context.dataReceivedTimer || null;

    // Compiled prompts/filters and logging flags belong to the active record.
    // Parents are restored after a child closes, so put theirs back too.
    if (context.standardPrompt) {
      this.standardPrompt = context.standardPrompt;
    }
    if (context.passwordPrompt) {
      this.passwordPrompt = context.passwordPrompt;
    }
    if (context.asciiFilter) {
      this.asciiFilter = context.asciiFilter;
    }
    if (context.textColorFilter) {
      this.textColorFilter = context.textColorFilter;
    }
    if (typeof context.debug === 'boolean') {
      this.debug = context.debug;
    }
    if (typeof context.verbose === 'boolean') {
      this.verbose = context.verbose;
    }
    if (typeof context.progress === 'boolean') {
      this.progress = context.progress;
    }
    if (typeof context.exposeCredentials === 'boolean') {
      this.exposeCredentials = context.exposeCredentials;
    }

    this._attachContextListeners(context);
    return context;
  }

  // Pops the top ancestor and makes it active. Used when a hop completes.
  _popContext() {
    const parent = this._connections.pop();
    if (!parent) {
      return null;
    }
    return this._restoreContext(parent);
  }

  // Drops a failed record and everything above it, then restores its parent.
  _popTo(context) {
    if (!context) {
      return null;
    }

    const index = this._connections.indexOf(context);
    if (index >= 0) {
      // Remove the record and its descendants from the stack.
      this._connections.length = index;
    }

    const parent = this._connections.pop() || context.parent || null;
    if (parent) {
      return this._restoreContext(parent);
    }
    this._active = null;
    return null;
  }

  // Active record plus every record deeper than `context`, deepest-first.
  // `context` itself is excluded; callers close it separately.
  _descendantsOf(context) {
    if (!context) {
      return [];
    }

    const result = [];
    const active = this._activeContext();
    if (active && active !== context && !active.closed) {
      result.push(active);
    }

    const index = this._connections.indexOf(context);
    if (index >= 0) {
      for (let position = this._connections.length - 1; position > index; position -= 1) {
        const record = this._connections[position];
        if (record && record !== context && !record.closed) {
          result.push(record);
        }
      }
    }
    return result;
  }

  // The only record teardown point. Idempotent through `context.closed`.
  _closeContext(context, reason) {
    if (!context || context.closed) {
      return false;
    }

    context.closed = true;

    // Finalize while the record's own handlers are still attached so a host
    // `onEnd` observes its `end`. `closed` already makes transport events
    // no-ops, so the close below cannot re-enter this path.
    this._finalizeHost(context.host, reason);
    this._removeListeners(context);

    const stream = this._streamFor(context);
    if (stream && typeof stream.close === 'function') {
      try {
        stream.close();
      } catch (e) {
        // The transport may already be gone; teardown continues.
      }
    }
    if (context.connection && typeof context.connection.end === 'function') {
      try {
        context.connection.end();
      } catch (e) {
        // The transport may already be gone; teardown continues.
      }
    }

    return true;
  }

  // Closes the active record and every ancestor, deepest-first.
  _closeAllContexts(reason) {
    const active = this._activeContext();
    if (active) {
      this._closeContext(active, reason);
    }
    for (let index = this._connections.length - 1; index >= 0; index -= 1) {
      this._closeContext(this._connections[index], reason);
    }
  }

  // The only record failure entry point. Descendants are torn down first, then
  // the record itself, and navigation follows the primary/hop split.
  _failContext(context, err, reason) {
    if (!context || context.closed || context.failing) {
      return;
    }
    context.failing = true;

    for (const descendant of this._descendantsOf(context)) {
      this._closeContext(descendant, 'ancestor-failed');
    }
    this._closeContext(context, reason);

    if (context.isPrimary) {
      return this._endPrimary(reason);
    }

    this._popTo(context);
    return this._runExit();
  }

  _hopFailed(context, err) {
    if (!context || context.closed || context.failing) {
      return;
    }
    context.reportedError = true;
    this.emit('error', err, 'Hop', false, null, context);
    return this._failContext(context, err, 'hop-failed');
  }

  // Exactly-once primary advance. Callers report the close before calling this;
  // `_endPrimary` only navigates.
  _endPrimary(reason) {
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

  // Nested host queues are copied lazily so a config can be reused across runs
  // without `shift()` draining the caller's array.
  _pendingHosts(context = this._activeContext()) {
    const host = context ? context.host : this.sshObj;
    if (context && context.pendingHosts) {
      return context.pendingHosts;
    }

    const list = host && Array.isArray(host.hosts) ? host.hosts : [];
    if (!context) {
      return list;
    }
    context.pendingHosts = list.slice();
    return context.pendingHosts;
  }

  // Preserves the partial response of a command that never returned a prompt,
  // so `end` and the final callback see it even though `_finalizeHost` only
  // reads `sessionText`.
  _appendPartial(reason, host = this.sshObj) {
    if (!this._buffer) {
      return '';
    }
    const partial = this._buffer;
    this._buffer = '';
    if (host) {
      host.sessionText += partial;
      host.sessionText += `\n[connection closed${reason ? `: ${reason}` : ''}]\n`;
    }
    return partial;
  }

  _reportMissingParameters() {
    this.emit(
      'error',
      'Missing connection parameters',
      'Parameters',
      false,
      function (err, type, close) {
        const expose = this.exposeCredentials === true;
        this.emit(
          'msg',
          expose ? this.sshObj.server : redactCredentials(this.sshObj.server)
        );
        this.emit('msg', this.sshObj.commands);
      }
    );
    return this._stream;
  }

  // Helper to safely detach listeners using cached references
  _detachListener(eventName, currentKey) {
    const cachedHandler = this._boundListeners[eventName];
    const hostHandler = this.sshObj ? this.sshObj[currentKey] : undefined;
    let removed = false;

    if (typeof cachedHandler === 'function') {
      this.removeListener(eventName, cachedHandler);
      delete this._boundListeners[eventName]; // clear cache item
      removed = true;
    }
    if (typeof hostHandler === 'function' && hostHandler !== cachedHandler) {
      this.removeListener(eventName, hostHandler);
      removed = true;
    }
       
    return removed;
  };
  
  // Host prefixes disambiguate messages when the session can span more than
  // one host. A single host reads better without repeating its address on
  // every line. Nested hosts keep the prefix, including after their queue has
  // been consumed, because `_multipleHosts` is sticky.
  _hostPrefix() {
    if (this._multipleHosts || this._primaryHostCount > 1) {
      return `${this.host}: `;
    }

    if (
      this.sshObj &&
      Array.isArray(this.sshObj.hosts) &&
      this.sshObj.hosts.length > 0
    ) {
      return `${this.host}: `;
    }

    return '';
  }

  // Progress output is an on-by-default liveness indicator for long-running
  // commands. Set `progress: false` on the host to opt out. It goes to stderr
  // and is gated on a TTY so redirected output and CI logs stay clean. It never
  // writes to sessionText or the msg stream. Debug and verbose already report
  // every internal step, so the heartbeat is suppressed while either is enabled.
  _progressEnabled() {
    return (
      this.progress === true &&
      this.debug !== true &&
      this.verbose !== true &&
      this._progressStream &&
      this._progressStream.isTTY === true
    );
  }

  // The host label is only useful when the session can span more than one
  // host, matching the message prefix rule.
  _progressLabel() {
    if (this._multipleHosts || this._primaryHostCount > 1) {
      return `[${this.host}] `;
    }

    if (
      this.sshObj &&
      Array.isArray(this.sshObj.hosts) &&
      this.sshObj.hosts.length > 0
    ) {
      return `[${this.host}] `;
    }

    return '';
  }

  // Finish the current progress line without stopping the heartbeat. Used
  // before normal msg/debug output so a message never starts mid-dot-line.
  _progressNewline() {
    if (this._progressLine) {
      if (this._progressStream) {
        this._progressStream.write('\n');
      }
      this._progressLine = false;
    }
  }

  _progressStart() {
    if (!this._progressEnabled()) {
      return;
    }

    this._progressRunning = true;
    this._progressNewline();

    const label = this._progressLabel();
    if (label && this._progressHost !== this.host) {
      this._progressStream.write(label);
      this._progressLine = true;
    }
    this._progressHost = this.host;

    if (!this._progressTimer) {
      this._progressTimer = setInterval(() => {
        this._progressTick();
      }, this._progressInterval);
      // Do not keep the process alive just for the indicator.
      if (typeof this._progressTimer.unref === 'function') {
        this._progressTimer.unref();
      }
    }
  }

  _progressTick() {
    if (!this._progressRunning || !this._progressEnabled()) {
      return;
    }

    this._progressStream.write('.');
    this._progressLine = true;
  }

  _progressEnd() {
    if (this._progressTimer) {
      clearInterval(this._progressTimer);
      this._progressTimer = null;
    }
    this._progressRunning = false;
    this._progressNewline();
  }

  _progressBreak() {
    this._progressNewline();
  }

  // Emits debug/verbose messages only when the matching host flag is enabled.
  // An optional object payload is emitted as a second message.
  _systemMsg(type, message, object = null){
    const enabled =
      (type === 'debug' && this.debug) ||
      (type === 'verbose' && this.verbose);

    if (!enabled) {
      return;
    }

    // Credentials are hidden in debug/verbose output unless the host opts in
    // with `exposeCredentials: true`. Strings are scrubbed for the configured
    // password/passphrase; object dumps have credential keys replaced.
    const expose = this.exposeCredentials === true;
    const secrets = expose ? [] : credentialSecrets(this.sshObj);

    this.emit('msg', `${this._hostPrefix()}${redactString(message, secrets)}`);
    if (typeof object === 'object' && object !== null) {
      this.emit('msg', expose ? object : redactCredentials(object));
    }
  }

  // Arms the command idle timer. The response is passed through unchanged so
  // callers can keep their existing commandTimeout payloads. With
  // `commandTimeoutRetries` set, the library owns the attempt count and re-arms
  // the timer for each non-final attempt; a handler only reacts.
  _scheduleIdleTimeout(response) {
    // During shutdown the stop/close timer is the only bound that matters.
    if (this._stopping || this._closing || this._runComplete) {
      return null;
    }

    const context = this._activeContext();
    const timer = setTimeout(() => {
      // A timer left over from an inactive or closed record must not fire
      // against the active host.
      if (context && (context.closed || context !== this._activeContext())) {
        return;
      }

      // This timer has fired. Clearing the reference lets the re-arm check
      // below detect whether _onData already scheduled the next one.
      if (context) {
        context.idleTimer = null;
      }
      if (this.idleTimer === timer) {
        this.idleTimer = null;
      }
      this._progressEnd();

      const attempt = (this.sshObj.commandTimeoutAttempt || 0) + 1;
      this.sshObj.commandTimeoutAttempt = attempt;
      const maxRetries = toNonNegativeInteger(this.sshObj.commandTimeoutRetries);
      const final = attempt > maxRetries;

      this._systemMsg(
        'debug',
        `commandTimeout: no prompt detected (${attempt}/${maxRetries})`
      );

      this.emit(
        'commandTimeout',
        this.command,
        response,
        this._stream,
        this.connection,
        { attempt, maxRetries, final }
      );

      // Re-arm for the next attempt unless this was the last one, the handler
      // opted out, or a data event already scheduled the next timer. The guard
      // in _scheduleIdleTimeout covers the stop/close checks again.
      if (
        !final &&
        this.sshObj.retryCommandTimeout !== false &&
        !this.idleTimer
      ) {
        this._scheduleIdleTimeout(response);
      }
    }, this.idleTime);

    if (context) {
      context.idleTimer = timer;
    }
    this.idleTimer = timer;
    return timer;
  }
  
  _onData(data) {
    // After close no further command processing is meaningful. During a stop
    // data still arrives so the prompt can trigger the exit commands.
    if (this._closing || this._runComplete) {
      return;
    }

    this._buffer += data;
    const hasCommand = this.command.length > 0;
    const promptDetected =
      hasCommand && this.standardPrompt.test(this._sanitizeResponse());

    if (hasCommand && !promptDetected) {
      this.emit(
        'commandProcessing',
        this.command,
        this._buffer,
        this.sshObj,
        this._stream
      );
      if (this.idleTimer) {
        clearTimeout(this.idleTimer);
      }
      this._scheduleIdleTimeout(this._buffer);
    } else if (!hasCommand && !this.standardPrompt.test(this._buffer)) {
      this.emit(
        'commandProcessing',
        this.command,
        this._buffer,
        this.sshObj,
        this._stream
      );
    }

    // A detected prompt means the command returned to the shell, so the idle
    // timeout no longer applies. Clearing it here (rather than only in the
    // settle callback) keeps a short `idleTimeOut` from firing before a longer
    // `dataIdleTimeOut` has grouped the response.
    if (promptDetected && this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
      const active = this._activeContext();
      if (active) {
        active.idleTimer = null;
      }
    }

    // Set a timer to fire when no more data events are received and then
    // process the buffer based on command and prompt combinations.
    const context = this._activeContext();
    if (context && context.dataReceivedTimer) {
      clearTimeout(context.dataReceivedTimer);
    }
    if (this.dataReceivedTimer) {
      clearTimeout(this.dataReceivedTimer);
    }
    const timer = setTimeout(() => {
      // A timer left over from an inactive or closed record must not process
      // the active host's buffer.
      if (context && (context.closed || context !== this._activeContext())) {
        return;
      }
      if (context) {
        context.dataReceivedTimer = null;
      }
      if (this.dataReceivedTimer === timer) {
        this.dataReceivedTimer = null;
      }

      // Clear the command and SSH timeout timer.
      if (this.idleTimer) {
        clearTimeout(this.idleTimer);
      }

      // Remove text colouring from responses like [32m[31m.
      if (!this.sshObj.disableColorFilter) {
        this._buffer = this._buffer.replace(this.textColorFilter, '');
      }

      // Remove non-standard ascii from terminal responses. Strip complete
      // escape sequences first so their printable payload does not survive as
      // text after the ESC byte is removed.
      if (!this.sshObj.disableASCIIFilter) {
        this._buffer = stripTerminalEscapes(this._buffer);
        this._buffer = this._buffer.replace(this.asciiFilter, '');
      }

      switch (true) {
        // Check if sudo password is needed.
        case this.command.length > 0 && this.command.indexOf('sudo ') !== -1:
          this._systemMsg('debug', `onData: Sudo command data`);
          
          return this._processSudoPrompt();
        // Check for standard prompt from a command.
        case this.command.length > 0 &&
          this.standardPrompt.test(this._sanitizeResponse()):
          this._systemMsg('debug', `onData: Normal prompt detected`);
          
          this.sshObj.pwSent = false;
          return this._commandComplete();
        // Check for no command but first prompt detected.
        case this.command.length < 1 && this.standardPrompt.test(this._buffer):
          this._systemMsg('debug', `onData: First prompt detected`);
          
          if (this.sshObj.showBanner) {
            this.sshObj.sessionText += this._buffer;
          }
          return this._nextCommand();
        default:
          this._systemMsg('debug', `onData: Reset timeout`);
          
          return this._scheduleIdleTimeout(this._buffer);
      }
    }, this.dataIdleTime);
    if (context) {
      context.dataReceivedTimer = timer;
    }
    this.dataReceivedTimer = timer;
    return timer;
  }

  _sanitizeResponse() {
    const command = this.command;
    if (!command) {
      return this._buffer;
    }

    // The shell echoes the command before running it. A long line can make the
    // terminal redraw, and that redraw may put a prompt or control text before
    // the final echo. Slice after the last echo so only what the command
    // produced is tested for a prompt; a prompt that appears before the echo
    // belongs to the previous command and must not complete this one.
    const index = this._buffer.lastIndexOf(command);
    if (index >= 0) {
      return this._buffer.slice(index + command.length);
    }

    // The buffer may still hold only part of the echoed command.
    return this._buffer.replace(command.slice(0, this._buffer.length), '');
  }

  // Opt-in `commandResponse: 'handled'` payload: the echoed command and the
  // trailing prompt are removed and the result is trimmed. The raw buffer is
  // still available to handlers as `details.rawResponse`, and `sessionText`
  // stays raw. Without a `standardPromptRegex`, only the final prompt
  // character (plus optional whitespace) can be removed.
  _handleCommandResponse(rawResponse) {
    const withoutEcho = stripEchoedCommand(rawResponse, this.command);
    // Trim trailing whitespace first so an end-anchored prompt regex can match
    // even when the PTY ends the prompt with CR/LF.
    const trimmed = withoutEcho.replace(/[ \t\r\n]+$/, '');
    return trimmed.replace(this.standardPrompt, '').trim();
  }

  // Opt-in `captureStderr: true` buffer. Chunks are filtered with the same
  // response filters so the captured text matches the stdout response. The
  // `stderrData` event is still emitted separately.
  _captureStderr(data) {
    if (!this.sshObj || this.sshObj.captureStderr !== true) {
      return;
    }

    let text = typeof data === 'string' ? data : String(data);
    if (!this.sshObj.disableColorFilter) {
      text = text.replace(this.textColorFilter, '');
    }
    if (!this.sshObj.disableASCIIFilter) {
      text = stripTerminalEscapes(text);
      text = text.replace(this.asciiFilter, '');
    }
    this._stderrBuffer += text;
  }

  // Appends captured stderr to a command response with one separating newline.
  // The trimmed stdout payload is used for `handled` so the prompt removal has
  // already happened before stderr is added.
  _mergeStderr(response, stderr) {
    if (!stderr) {
      return response;
    }
    if (!response) {
      return stderr;
    }
    const separator = /[\r\n]$/.test(response) ? '' : '\n';
    return `${response}${separator}${stderr}`;
  }

  _processSudoPrompt() {
    const response = this._sanitizeResponse().trim();
    const passwordPrompt = this.passwordPrompt.test(response);
    const standardPrompt = this.standardPrompt.test(response);
    this._systemMsg('debug', `processSudoPrompt: Password handling`);
    
    this._systemMsg(
        'verbose',
        `processSudoPrompt: Password prompt: ${passwordPrompt}, Standard prompt: ${standardPrompt}, Password previously sent: ${this.sshObj.pwSent}`
      );

    // Prompt detection.
    switch (true) {
      // No password.
      case passwordPrompt && !this.sshObj.server.password:
        this._systemMsg('debug', `processSudoPrompt: No password set`);
        this.sshObj.sudoFailed = true;
        this.emit(
          'msg',
          `${this._hostPrefix()}Sudo authentication failed for ${this.sshObj.server.userName}: no password configured`
        );
        
        return this._resetFromSudoError();
      case passwordPrompt && !this.sshObj.pwSent:
        this._systemMsg('debug', `processSudoPrompt: Send password`);
                      
        this._systemMsg('verbose',`processSudoPrompt: Password: ${this.sshObj.server.password}`);
        
        // Send password.
        this.sshObj.pwSent = true;
        return this._runCommand(`${this.sshObj.server.password}`);
      case passwordPrompt && this.sshObj.pwSent:
        this._systemMsg('debug', `processSudoPrompt: Failed login`);
        
        // A rejected sudo password is visible by default. It is not fatal
        // unless the host opts in with `abortOnSudoFailure: true`.
        this._systemMsg(
          'debug',
          `Password was incorrect for ${this.sshObj.server.userName}`
        );
        this._systemMsg('verbose',`processSudoPrompt: Failed login: Response: ${response}`);
        this.sshObj.sudoFailed = true;
        this.emit(
          'msg',
          `${this._hostPrefix()}Sudo authentication failed for ${this.sshObj.server.userName}`
        );
        
        this.sshObj.pwSent = false;
        // Add buffer to sessionText so the sudo response can be seen.
        return this._resetFromSudoError();
      case standardPrompt:
        this._systemMsg('debug', `processSudoPrompt: Password accepted`);
        
        this.sshObj.pwSent = false;
        this._systemMsg('verbose',`processSudoPrompt: Successful response: ${response}`);
        
        return this._commandComplete();
      default:
        this._systemMsg('debug', `processSudoPrompt: Reset timeout`);
        
        return this._scheduleIdleTimeout(response);
    }
  }

  _resetFromSudoError() {
    this._progressEnd();
    this.sshObj.pwSent = false;
    this.sshObj.sessionText += `${this._buffer}`;
    this._buffer = '';
    this.command = '';
    this._commandInFlight = false;
    // Cancel command on host.
    const result = this._stream.write('\x03');

    if (this.sshObj.abortOnSudoFailure && !this._stopping) {
      // Wait for the shell to return to a prompt (or the idle timeout) before
      // running exit commands, so the Ctrl-C has a chance to cancel sudo.
      this._commandInFlight = true;
      this.stop('sudo-failed');
    }

    return result;
  }

  _processNotifications() {
    // An empty command has nothing to run or report, so skip it and continue
    // with the queue instead of leaving the state machine idle.
    if (!this.command) {
      this._systemMsg('debug', `processNotifications: Empty command, skip`);
      return this._nextCommand();
    }

    // This is a message for the sessionText like an echo command in bash.
    const sessionNote = this.command.match(/^`(.*)`$/);
    if (sessionNote) {
      this._systemMsg('debug', `processNotifications: sessionText output`);

      if (this._connections.length > 0) {
        this.sshObj.sessionText += `${this.host}: Note: ${sessionNote[1]}${this.sshObj.enter}`;
      } else {
        this.sshObj.sessionText += `Note: ${sessionNote[1]}${this.sshObj.enter}`;
      }
      this._systemMsg('verbose', sessionNote[1]);

      return this._nextCommand();
    }

    // This is a message to output in process.
    const msgNote = this.command.match(/^msg:(.*)$/);
    if (msgNote) {
      this._systemMsg('debug', `processNotifications: msg to output`);

      this.emit('msg', `${this._hostPrefix()}Note: ${msgNote[1]}`);
      return this._nextCommand();
    }

    this._systemMsg('debug', `processNotifications: Normal Command to run`);

    return this._checkCommand();
  }

  _commandComplete() {
    this._progressEnd();
    this._commandInFlight = false;
    const rawResponse = this._buffer;
    const response = rawResponse.trim();
    // Captured stderr is consumed once per command. It is empty unless the
    // host opts in with `captureStderr: true`.
    const capturedStderr =
      this.sshObj.captureStderr === true
        ? (this._stderrBuffer || '').trim()
        : '';
    // `exit` is reported by the shell, not as a command response. It is the
    // literal command that leaves `su` / `sudo -i` or the primary shell.
    if (this.command !== '' && this.command !== 'exit') {
      this._systemMsg('debug',`commandComplete: Raising commandComplete event`);

      this._systemMsg(
        'verbose',
        `commandComplete:\nCommand:\n ${this.command}\nResponse: ${response}`
      );
      this.sshObj.sessionText += this._mergeStderr(response, capturedStderr);

      // `commandResponse: 'handled'` opts into a response without the echoed
      // command or trailing prompt. The raw buffer stays available to handlers
      // as `details.rawResponse`; `sessionText` remains raw in this release.
      const handled = this.sshObj.commandResponse === 'handled';
      const payload = handled
        ? this._mergeStderr(
            this._handleCommandResponse(rawResponse),
            capturedStderr
          )
        : this._mergeStderr(rawResponse, capturedStderr);
      const details = { rawResponse };
      if (this.sshObj.captureStderr === true) {
        details.stderr = capturedStderr;
      }

      // Handlers may set `sshObj` flags (abort/skip*) or call stop()/close().
      // Apply the flags after the event so a handler always sees the completed
      // response, then let the guarded command loop decide what runs next.
      this._inCommandComplete = true;
      try {
        this.emit('commandComplete', this.command, payload, this.sshObj, details);
      } finally {
        this._inCommandComplete = false;
      }
      this._applyHandlerFlags();
    }
    // The next command starts a fresh timeout budget.
    this.sshObj.commandTimeoutAttempt = 0;
    this.sshObj.retryCommandTimeout = undefined;
    return this._nextCommand();
  }

  // Applies the declarative flags a commandComplete handler can set. The
  // handlers receive `sshObj`, so this is the compatibility-friendly way to
  // fail fast without reaching into private instance state.
  _applyHandlerFlags() {
    const sshObj = this.sshObj;
    if (!sshObj) {
      return;
    }

    if (sshObj.skipCommands) {
      if (Array.isArray(sshObj.commands)) {
        sshObj.commands.length = 0;
      }
      sshObj.skipCommands = false;
    }

    if (sshObj.skipHosts) {
      // By design: this clears only the current host's own nested queue.
      // Sibling nested hosts queued on a parent still run, matching the
      // documented skipHosts behavior. The record's lazy copy is the queue
      // `_nextHost()` reads, so clear it too.
      if (Array.isArray(sshObj.hosts)) {
        sshObj.hosts.length = 0;
      }
      const active = this._activeContext();
      if (active && Array.isArray(active.pendingHosts)) {
        active.pendingHosts.length = 0;
      }
      sshObj.skipHosts = false;
    }

    if (sshObj.skipPrimaryHosts) {
      this._hosts.length = 0;
      sshObj.skipPrimaryHosts = false;
    }

    if (sshObj.abort || sshObj.stop) {
      const reason =
        typeof sshObj.abort === 'string'
          ? sshObj.abort
          : typeof sshObj.stop === 'string'
            ? sshObj.stop
            : 'command-failed';
      sshObj.abort = false;
      sshObj.stop = false;
      this.stop(reason);
    }
  }

  _nextCommand() {
    if (this._closing || this._runComplete) {
      return;
    }

    this._buffer = '';
    if (this._stopping || this._gracefulClosing) {
      return this._runExit();
    }

    // Process the next command if there are any.
    if (this.sshObj.commands.length > 0) {
      this._systemMsg('debug',`nextCommand: Setting next command`);      
      
      this._systemMsg(
        'verbose',
        `nextCommand: Host commands: ${this.sshObj.commands}`
      );
      
      this.command = this.sshObj.commands.shift();
      this._systemMsg(
        'verbose',
          `nextCommand: Next command: ${this.command}`
        );
      
      return this._processNotifications();
    }

    this._systemMsg('debug',`nextCommand: No commands so exit`);
    
    // No more commands so exit.
    return this._runExit();
  }

  _checkCommand() {
    if (this._closing || this._runComplete) {
      return;
    }

    if (this._stopping || this._gracefulClosing) {
      return this._runExit();
    }

    // If there is still a command to run then run it or exit.
    if (this.command !== '') {
      this._progressStart();
      return this._runCommand(this.command);
    }

    // No more commands so exit.
    this._systemMsg('debug',`checkCommand: No command so exit`);
    
    return this._runExit();
  }

  _runCommand(command) {
    // After a stop or close no write is attempted. The baseline silently wrote
    // the rest of the queue into a closed channel; that produced confusing
    // session notes and debug output.
    if (this._closing || this._runComplete || !this._hasLiveStream()) {
      return false;
    }

    // A new command starts a fresh timeout budget and a fresh stderr capture.
    // Internal writes (the sudo password) pass a different string, so they do
    // not reset the count or capture for the command that is still in flight.
    const isCommandWrite = command === this.command;
    if (isCommandWrite) {
      this.sshObj.commandTimeoutAttempt = 0;
      this.sshObj.retryCommandTimeout = undefined;
      this._stderrBuffer = '';
    }

    this._systemMsg('debug',`runCommand:`);
    
    this._systemMsg('verbose',`runCommand: Command: ${command}`);
    
    this._commandInFlight = Boolean(command);
    const written = this._stream.write(`${command}${this.sshObj.enter}`);

    // Arm the idle timer as soon as a command is written. Incoming data resets
    // it through `_onData`, and a detected prompt cancels it. This makes a
    // silent command time out like any other command that never returns to the
    // prompt. The literal `exit` closes the shell, so it has no prompt to wait
    // for, and a graceful close is already bounded by the stop/close timer.
    if (
      written !== false &&
      isCommandWrite &&
      command.length > 0 &&
      command !== 'exit' &&
      !this._gracefulClosing
    ) {
      if (this.idleTimer) {
        clearTimeout(this.idleTimer);
      }
      this._scheduleIdleTimeout('');
    }

    return written;
  }

  // Merge a nested host's text into its immediate parent's sessionText exactly
  // once. Merging one level at a time keeps the text in traversal order: a
  // child finalizes before its parent, so the deepest text travels up the
  // chain and lands after the parent's own output. The primary host then
  // carries the whole subtree.
  _mergeNestedText(host = this.sshObj) {
    if (!host || !host.server || !this._connections || this._connections.length === 0) {
      return false;
    }
    if (this._mergedHosts.has(host)) {
      return false;
    }

    const active = this._activeContext();
    let parentRecord = null;

    if (active && active.host === host) {
      // The active host sits outside the stack; its parent is the last record.
      parentRecord = this._connections[this._connections.length - 1];
    } else {
      // A host being finalized from the stack has its parent one level up.
      const index = this._connections.findIndex(
        (record) => (record && record.host ? record.host : record) === host
      );
      if (index > 0) {
        parentRecord = this._connections[index - 1];
      } else if (index === -1) {
        // Legacy callers can put bare host configs on the stack without a
        // record for the active host. The last ancestor is still the parent.
        parentRecord = this._connections[this._connections.length - 1];
      }
    }

    const parent =
      parentRecord && parentRecord.host ? parentRecord.host : parentRecord;
    if (!parent || parent === host) {
      return false;
    }

    this._mergedHosts.add(host);
    parent.sessionText += `\n${host.server.host}: ${host.sessionText || ''}`;
    return true;
  }

  // Finalizes one visited host exactly once: nested text is merged, the
  // primary host's text is appended to _allSessions, and `end` is emitted.
  _finalizeHost(host = this.sshObj, reason = null) {
    if (!host || !host.server) {
      return false;
    }
    if (this._finalizedHosts.has(host)) {
      return false;
    }
    this._finalizedHosts.add(host);

    // The active host is outside the stack, so the primary is the first
    // ancestor's host (or the active host when the stack is empty). Records
    // built by older tests may still hold a bare host config.
    const rootRecord = this._connections ? this._connections[0] : null;
    const root = rootRecord && rootRecord.host ? rootRecord.host : rootRecord;
    const isPrimary = !root || host === root;

    if (!isPrimary) {
      this._mergeNestedText(host);
      this._systemMsg(
        'debug',
        `finalizeHost: end nested host ${host.server.host}${reason ? ` (${reason})` : ''}`
      );
      this.emit('end', `${host.server.host}: \n${host.sessionText || ''}`, host);
      return true;
    }

    this._primaryhostSessionText += `${host.sessionText || ''}\n`;
    this._allSessions += this._primaryhostSessionText;
    this._systemMsg(
      'debug',
      `finalizeHost: end primary host ${host.server.host}${reason ? ` (${reason})` : ''}`
    );
    this.emit('end', this._primaryhostSessionText, host);
    return true;
  }

  // Finalizes the current host and any ancestors still on the connection
  // stack, deepest first. This is the safety net for an abrupt transport drop:
  // every visited host gets one `end`, and the callback still receives the
  // complete session text.
  _finalizeRun(reason = null) {
    const hosts = [];
    const active = this._activeContext();
    if (active && active.host && active.host.server) {
      hosts.push(active.host);
    } else if (this.sshObj && this.sshObj.server) {
      hosts.push(this.sshObj);
    }
    if (this._connections) {
      for (let index = this._connections.length - 1; index >= 0; index -= 1) {
        const record = this._connections[index];
        const host = record && record.host ? record.host : record;
        if (host && host.server) {
          hosts.push(host);
        }
      }
    }

    for (const host of hosts) {
      this._finalizeHost(host, reason);
    }
  }

  _previousHost() {
    if (this._stopping || this._runComplete) {
      return;
    }

    const child = this._activeContext();
    this._systemMsg(
      'debug',
      `previousHost: close child connection: ${this.host}`
    );

    if (child) {
      // Closing the child removes its handlers and finalizes it exactly once.
      this._closeContext(child, 'previous-host');
      this._popContext();
      this._systemMsg('debug', `previousHost: previous host loaded: ${this.host}`);
    } else if (this._connections.length > 0) {
      // Fallback for callers that built the stack manually. The record form is
      // the supported one.
      this._finalizeHost(this.sshObj, 'previous-host');
      this._removeListeners();
      const parent = this._connections.pop();
      const parentHost = parent && parent.host ? parent.host : parent;
      if (parent && parent.host) {
        this._restoreContext(parent);
      } else if (parentHost) {
        this.sshObj = parentHost;
        this.host = parentHost.server.host;
      }
      this._systemMsg('debug', `previousHost: previous host loaded: ${this.host}`);
    }

    return this._runExit();
  }

  _nextHost() {
    if (this._stopping || this._runComplete) {
      return;
    }

    // The outgoing record is still active; its handlers must go before the
    // child's config replaces the aliases. `pendingHosts` is the record's own
    // copy, so the caller's nested array is never consumed.
    const parent = this._activeContext();
    if (!parent) {
      // Without an active record there is no connection to hop from. Terminate
      // instead of recursing through `_runExit()`.
      return this._callFinalCallback();
    }

    this._removeListeners(parent);
    const pending = this._pendingHosts(parent);
    const nextHost = pending.shift();
    if (!nextHost) {
      return this._runExit();
    }

    this._systemMsg(
      'debug',
      `nextHost: hop to ${nextHost.server.host} through ${this.host}`
    );

    this.sshObj = nextHost;
    this.host = nextHost.server.host;

    return this._initiate(this._connectHop);
  }

  _nextPrimaryHost(connect) {
    if (this._stopping || this._runComplete) {
      return this._callFinalCallback();
    }
    if (this._hosts.length === 0) {
      return this._callFinalCallback();
    }

    this._systemMsg('debug', `nextPrimaryHost: load next host for ssh2 connection`);

    // Close the current primary and every active hop before resetting the
    // stack, so a new primary never inherits a hop's socket.
    if (this._activeContext()) {
      this._closeAllContexts('next-primary-host');
    } else if (this.sshObj && this.sshObj.server) {
      this._finalizeHost(this.sshObj, 'next-primary-host');
    }

    this._progressEnd();
    this._stream = {};
    this.connection = null;
    this._connections = [];
    this._active = null;
    this._primaryEnded = false;
    this._buffer = '';
    this._stderrBuffer = '';
    this.sshObj = this._hosts.shift();
    this.host = this.sshObj.server.host;
    this._primaryhostSessionText = `${this.host}: `;
    this._closing = false;
    this._gracefulClosing = false;
    this._commandInFlight = false;
    return this._initiate(connect);
  }

  _runExit() {
    if (this._runComplete) {
      return;
    }

    this._progressEnd();
    this._systemMsg('debug',`runExit: Process an exit`);

    if (this._stopping) {
      return this._beginStopExit();
    }

    // Nested hosts only exist on an active record. A bare `sshObj.hosts` array
    // without a record has no connection to hop from, so it must not drive
    // navigation here.
    const active = this._activeContext();
    const pending = active ? this._pendingHosts(active) : [];

    if (!this._gracefulClosing && pending.length > 0) {
      // More nested hosts to connect to so process the next one.
      this._systemMsg('debug',`runExit: Load next host`);

      return this._nextHost();
    }

    if (this._connections && this._connections.length > 0) {
      // Leaving last host so load previous host.
      this._systemMsg('debug',`runExit: load previous host`);

      this.emit('msg', `${this._hostPrefix()}${this.sshObj.closedMessage}`);
      return this._previousHost();
    }

    if (!this._gracefulClosing && this.command === 'exit') {
      // The literal `exit` leaves `su` / `sudo -i` or the primary shell. A hop
      // is left by closing its connection, not by an exit command.
      this._systemMsg('debug',`runExit: run exit command`);

      return this._runCommand('exit');
    }

    return this.close();
  }

  // ---------------------------------------------------------------------------
  // Shutdown
  // ---------------------------------------------------------------------------

  stop(reason = 'user') {
    if (this._runComplete || this._stopping) {
      return this;
    }
    // Safe before connect() and after the run has finished: no-op.
    if (!this._started && !this._hasLiveStream()) {
      return this;
    }

    this._stopping = true;
    this._stopReason = reason;
    this._gracefulClosing = false;
    this._clearCloseTimer();
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    if (this.sshObj) {
      this.sshObj.stopReason = reason;
    }

    // Clear every command and host queue, including the private primary-host
    // queue and the nested queues held by the active record and its ancestors.
    const clearRecord = (record) => {
      if (!record) {
        return;
      }
      const host = record.host || record;
      if (Array.isArray(host.commands)) {
        host.commands.length = 0;
      }
      if (Array.isArray(host.hosts)) {
        host.hosts.length = 0;
      }
      if (Array.isArray(record.pendingHosts)) {
        record.pendingHosts.length = 0;
      }
    };
    clearRecord(this._activeContext());
    if (!this._activeContext() && this.sshObj) {
      clearRecord({ host: this.sshObj });
    }
    if (Array.isArray(this._connections)) {
      for (const record of this._connections) {
        clearRecord(record);
      }
    }
    this._hosts.length = 0;

    this._systemMsg('debug', `stop: requested (${reason})`);
    this.emit('msg', `${this._hostPrefix()}Stop requested: ${reason}`);

    if (this._commandInFlight) {
      // Interrupt the running command and wait for the prompt or the idle
      // timeout before closing the records.
      this._armStopTimer();
      if (this._hasLiveStream()) {
        this._stream.write('\x03');
      }
      return this;
    }

    if (this._inCommandComplete) {
      // The handler is still running. _nextCommand() will start the exit path
      // as soon as the handler returns.
      this._armStopTimer();
      return this;
    }

    this._beginStopExit();
    return this;
  }

  _beginStopExit() {
    if (this._runComplete) {
      return;
    }

    // A command that is still in flight gets the stop timer and the Ctrl-C
    // already sent by stop(). The prompt (or the timer) reaches _finishStop().
    if (this._commandInFlight && this._hasLiveStream()) {
      this._armStopTimer();
      return;
    }

    return this._finishStop();
  }

  _finishStop() {
    if (this._runComplete) {
      return this._allSessions;
    }

    this._clearStopTimer();
    this._clearCloseTimer();
    this._commandInFlight = false;
    this._closing = true;
    this._runComplete = true;

    // Closing every record finalizes each host once, deepest-first.
    this._closeAllContexts(this._stopReason || 'stop');
    this._active = null;
    this._connections = [];
    this._stream = {};
    this.connection = null;

    return this._callFinalCallback();
  }

  _forceStop() {
    this._clearStopTimer();
    this._systemMsg('debug', `stop: idle timeout while stopping`);
    return this._finishStop();
  }

  _clearStopTimer() {
    if (this._stopTimer) {
      clearTimeout(this._stopTimer);
      this._stopTimer = null;
    }
  }

  _armStopTimer() {
    this._clearStopTimer();
    const timeout = toPositiveNumber(this.idleTime) || 5000;
    this._stopTimer = setTimeout(() => {
      this._forceStop();
    }, timeout);
    if (typeof this._stopTimer.unref === 'function') {
      this._stopTimer.unref();
    }
  }

  // Graceful close drops queued commands and nested hosts, then backs out of
  // the active records before closing. Remaining primary hosts still run,
  // matching close()'s compatibility contract.
  _prepareGracefulClose() {
    const clearRecord = (record) => {
      if (!record) {
        return;
      }
      const host = record.host || record;
      if (Array.isArray(host.commands)) {
        host.commands.length = 0;
      }
      if (Array.isArray(host.hosts)) {
        host.hosts.length = 0;
      }
      if (Array.isArray(record.pendingHosts)) {
        record.pendingHosts.length = 0;
      }
    };
    clearRecord(this._activeContext());
    if (!this._activeContext() && this.sshObj) {
      clearRecord({ host: this.sshObj });
    }
    if (Array.isArray(this._connections)) {
      for (const record of this._connections) {
        clearRecord(record);
      }
    }
  }

  _clearCloseTimer() {
    if (this._closeTimer) {
      clearTimeout(this._closeTimer);
      this._closeTimer = null;
    }
  }

  _armCloseTimer() {
    this._clearCloseTimer();
    const timeout = toPositiveNumber(this.idleTime) || 5000;
    this._closeTimer = setTimeout(() => {
      this._forceClose();
    }, timeout);
    if (typeof this._closeTimer.unref === 'function') {
      this._closeTimer.unref();
    }
  }

  _forceClose() {
    this._clearCloseTimer();
    this._systemMsg('debug', `close: idle timeout while closing`);
    return this._closeStreamNow();
  }

  _closeStreamNow() {
    this._clearCloseTimer();
    this._clearStopTimer();
    this._gracefulClosing = false;
    this._closing = true;
    this._progressEnd();
    this._systemMsg('debug',`Stream: close`);

    // Close the active record and every ancestor. `_closeContext` finalizes
    // each host once and closes its stream/connection.
    this._closeAllContexts('close');
    this._active = null;
    this._connections = [];
    this._stream = {};
    this.connection = null;

    // A plain close() still honours the primary-host contract: remaining
    // primaries run. Advance directly because the records are already closed
    // and their close events are suppressed.
    if (!this._stopping && !this._runComplete && this._hosts.length > 0) {
      this._closing = false;
      this._primaryEnded = false;
      return this.emit('newPrimaryHost', this._nextPrimaryHost(this._connect));
    }

    this._runComplete = true;
    return this._callFinalCallback();
  }

  close(options = {}) {
    if (this._runComplete || this._closing) {
      return;
    }

    // Calling close() before the shell opens is a no-op; the run can still
    // start. This preserves the existing behavior (G10).
    if (!this._started && !this._hasLiveStream() && !this.connection) {
      return;
    }

    const graceful = Boolean(options && options.graceful);
    if (graceful && !this._stopping && this._hasLiveStream()) {
      this._gracefulClosing = true;
      this._progressEnd();
      this._systemMsg('debug',`Stream: graceful close`);
      this._prepareGracefulClose();

      if (this._commandInFlight) {
        this._armCloseTimer();
        this._stream.write('\x03');
        return;
      }
      if (this._inCommandComplete) {
        this._armCloseTimer();
        return;
      }
      return this._runExit();
    }

    return this._closeStreamNow();
  }

  _callFinalCallback() {
    if (this._callbackCalled) {
      return this._allSessions;
    }
    this._callbackCalled = true;
    if (typeof this._callback === 'function') {
      this._callback(this._allSessions);
    }
    return this._allSessions;
  }

  _resetRunState() {
    this._clearStopTimer();
    this._clearCloseTimer();
    this._closing = false;
    this._stopping = false;
    this._stopReason = null;
    this._commandInFlight = false;
    this._stderrBuffer = '';
    this._inCommandComplete = false;
    this._runComplete = false;
    this._callbackCalled = false;
    this._gracefulClosing = false;
    this._finalizedHosts = new Set();
    this._mergedHosts = new Set();
    this._connections = [];
    this._active = null;
    this._primaryEnded = false;
    this._stream = {};
    this.connection = null;
    this.sshObj = {};
    this.host = 'No host';
    this._buffer = '';
    this._allSessions = '';
    this._primaryhostSessionText = '';
  }

  // Removes only the handlers a record bound, plus that record's timers. Host
  // handlers are owned by the record, never by `this.sshObj`: an ancestor event
  // can arrive while a child is active. Instance defaults stay attached.
  _removeListeners(context = this._activeContext()) {
    if (!context) {
      return;
    }

    this._systemMsg(
      'debug',
      `removeListeners: removing event listeners linked to ${context.host ? context.host.server.host : 'host'}`
    );

    if (context.listeners) {
      // Keep the map: restoring an ancestor after a hop needs the exact
      // handlers that host bound. Only the emitter attachment is removed.
      for (const [eventName, listener] of Object.entries(context.listeners)) {
        if (typeof listener === 'function') {
          this.removeListener(eventName, listener);
        }
      }
    }

    if (context.idleTimer) {
      clearTimeout(context.idleTimer);
      context.idleTimer = null;
    }
    if (context.dataReceivedTimer) {
      clearTimeout(context.dataReceivedTimer);
      context.dataReceivedTimer = null;
    }
    if (context === this._activeContext()) {
      if (this.idleTimer) {
        clearTimeout(this.idleTimer);
        this.idleTimer = null;
      }
      if (this.dataReceivedTimer) {
        clearTimeout(this.dataReceivedTimer);
        this.dataReceivedTimer = null;
      }
    }

    // Keep a message sink available between hosts. `_loadDefaultListeners`
    // restores the fallback only when the active record has no host `msg`.
    this._loadDefaultListeners();
  }

  _initiate(action) {
    if (this._stopping || this._runComplete) {
      return;
    }

    if (typeof action === 'function') {
      return action();
    }
    return;
  }

  // Timer values can be set on the instance (`SSH.idleTime` / `SSH.dataIdleTime`)
  // before connect() and overridden per host. The first load captures the
  // instance-level base so leaving a host can restore it.
  _captureBaseTimerValues() {
    if (this._baseIdleTime === undefined) {
      this._baseIdleTime = toPositiveNumber(this.idleTime) || 5000;
    }
    if (this._baseDataIdleTime === undefined) {
      this._baseDataIdleTime = toPositiveNumber(this.dataIdleTime) || 500;
    }
  }

  // Applies a host's timer config only when it supplies a valid value, so an
  // instance value is not overwritten by the defaults.
  _applyHostTimerValues(host = this.sshObj) {
    // `idleTimeOut` is the documented key; `idleTime` is a legacy alias.
    const idleTimeOut =
      toPositiveNumber(host.idleTimeOut) ||
      toPositiveNumber(host.idleTime);
    if (idleTimeOut > 0) {
      this.idleTime = idleTimeOut;
    }

    // Public key is `dataIdleTimeOut` (README). Keep the undocumented
    // `dataIdleTime` as a fallback for existing callers.
    const dataIdleTimeOut =
      toPositiveNumber(host.dataIdleTimeOut) ||
      toPositiveNumber(host.dataIdleTime);
    if (dataIdleTimeOut > 0) {
      this.dataIdleTime = dataIdleTimeOut;
    }
  }

  // Loads a host's defaults and binds its handlers to the record that owns
  // them. When no record is supplied, the active one is used; direct calls
  // before a connection (unit tests and embedders) create the primary record.
  _loadDefaults(context = null) {
    let record = context || this._activeContext();
    // A direct call (tests and embedders) can set `sshObj` without creating a
    // record. Treat that as a new primary config rather than reusing the
    // previous record's host.
    if (!record || (!context && record.host !== this.sshObj)) {
      record = this._pushContext(this.sshObj, null);
    }

    const host = record.host || this.sshObj;
    this.sshObj = host;
    this.host = host.server ? host.server.host : 'No host';

    this._progressEnd();
    this.command = '';
    this._buffer = '';
    this._stderrBuffer = '';
    this.debug = host.debug ?? false;
    this.verbose = host.verbose ?? false;
    this.progress = host.progress !== false;
    this.exposeCredentials = host.exposeCredentials ?? false;

    // Remember that this session uses nested hosts even after the queue has
    // been consumed, so message prefixes stay consistent.
    if (Array.isArray(host.hosts) && host.hosts.length > 0) {
      this._multipleHosts = true;
    }

    // Support the legacy { send: fn } message handler shape.
    if (host.msg && host.msg.send && typeof host.msg.send === 'function') {
      host.msg = host.msg.send;
    }

    // A host `msg` handler replaces the instance fallback while the record is
    // active. `_removeListeners` restores the fallback when the record leaves.
    const previousMsg = record.listeners.msg;
    if (previousMsg && previousMsg !== host.msg) {
      this.removeListener('msg', previousMsg);
      delete record.listeners.msg;
    }
    if (typeof host.msg === 'function') {
      if (this.listeners('msg').includes(this.msg)) {
        this.removeListener('msg', this.msg);
      }
      this._bindHostListener(record, 'msg', host.msg);
    } else if (!this.listeners('msg').includes(this.msg)) {
      this.on('msg', this.msg);
    }
    this._systemMsg('debug',`Load Defaults`);

    applyHostDefaults(host);

    this._captureBaseTimerValues();
    // Every host starts from the instance base; only a valid host value
    // overrides it. This keeps one host's timers from leaking into the next.
    this.idleTime = this._baseIdleTime;
    this.dataIdleTime = this._baseDataIdleTime;
    this._applyHostTimerValues(host);
    record.idleTime = this.idleTime;
    record.dataIdleTime = this.dataIdleTime;

    // Compile ASCII Filter with Safe Fallback. These compiled regexes are
    // internal state, not public config: recompile from the current host on
    // every load so a later host with different filters/prompts is honoured.
    const ascii = compileAsciiFilter(host.asciiFilter);
    this.asciiFilter = ascii.filter;
    if (ascii.usedFallback && this.debug) {
      this._systemMsg(
        'debug',
        `loadDefaults: AsciiFilter: incorrect regular expression reverting to default: ${host.asciiFilter}`
      );
    }

    // Compile Text Color Filter with Safe Fallback.
    const color = compileTextColorFilter(host.textColorFilter);
    this.textColorFilter = color.filter;
    if (color.usedFallback && this.debug) {
      this._systemMsg(
        'debug',
        `loadDefaults: TextColorFilter: incorrect regular expression reverting to default: ${host.textColorFilter}`
      );
    }

    // Prompts: fully sanitized at runtime via escapeRegex (never need
    // fallbacks because they are cast as pure literals).
    const prompts = compilePrompts(host);
    this.passwordPrompt = prompts.passwordPrompt;
    this.standardPrompt = prompts.standardPrompt;
    if (prompts.standardPromptFallback) {
      this._systemMsg(
        'debug',
        `loadDefaults: StandardPromptRegex: incorrect regular expression reverting to standardPrompt: ${host.standardPromptRegex}`
      );
    }

    // Store the compiled state on the record so restoring an ancestor after a
    // child closes does not keep the child's prompts or filters.
    record.standardPrompt = this.standardPrompt;
    record.passwordPrompt = this.passwordPrompt;
    record.asciiFilter = this.asciiFilter;
    record.textColorFilter = this.textColorFilter;
    record.debug = this.debug;
    record.verbose = this.verbose;
    record.progress = this.progress;
    record.exposeCredentials = this.exposeCredentials;

    // Listener defaults for command processing.
    host.onCommandProcessing =
      host.onCommandProcessing ??
      ((command, response, sshObj, stream) => {});

    host.onCommandComplete =
      host.onCommandComplete ??
      ((command, response, sshObj) => {
        this._systemMsg('debug', `onCommandComplete:`);
      });

    host.onCommandTimeout =
      host.onCommandTimeout ??
      ((command, response, stream, connection, details) => {
        // With `commandTimeoutRetries` configured, only the final attempt
        // closes the run. The library re-arms the timer for earlier attempts.
        if (details && details.final === false) {
          this._systemMsg(
            'debug',
            `loadDefaults: Class.commandTimeout retry ${details.attempt}/${details.maxRetries}`
          );
          return;
        }

        response = response.replace(this.command, '');
        this._systemMsg('debug', `loadDefaults: Class.commandTimeout`);

        this._systemMsg('verbose',`loadDefaults: Timeout command: ${command} response: ${response}`);

        this.emit(
          'error',
          `${this.host}: Command timed out after ${this.idleTime / 1000} seconds`,
          'Command Timeout',
          true,
          (err, type) => {
            this.sshObj.sessionText += this._buffer;
            this._buffer = '';
          }
        );
      });

    // Bind the host handlers into the record. They are removed with the same
    // record on a host switch, failure, or teardown.
    if (typeof host.onKeyboardInteractive === 'function') {
      this._bindHostListener(record, 'keyboard-interactive', host.onKeyboardInteractive);
    }
    if (typeof host.onError === 'function') {
      // Host handlers run before the default listener so they can observe the
      // error before the default listener closes the stream.
      this._bindHostListener(record, 'error', host.onError, true);
    }
    if (typeof host.onData === 'function') {
      this._bindHostListener(record, 'data', host.onData);
    }
    if (typeof host.onStderrData === 'function') {
      this._bindHostListener(record, 'stderrData', host.onStderrData);
    }
    if (typeof host.onEnd === 'function') {
      this._bindHostListener(record, 'end', host.onEnd);
    }

    this._bindHostListener(record, 'commandProcessing', host.onCommandProcessing);
    this._bindHostListener(record, 'commandComplete', host.onCommandComplete);
    this._bindHostListener(record, 'commandTimeout', host.onCommandTimeout);

    // The tryKeyboard fallback belongs to the record that set it. It is only
    // installed when no host or instance handler exists, because two handlers
    // would both call finish() and reset the handshake.
    if (
      host.server &&
      host.server.tryKeyboard &&
      typeof host.onKeyboardInteractive !== 'function' &&
      this.listeners('keyboard-interactive').length === 0
    ) {
      const keyboardInteractive = (
        name,
        instructions,
        instructionsLang,
        prompts,
        finish
      ) => {
        this._systemMsg('debug', `keyboard-interactive:`);

        this._systemMsg('verbose', `name: ${name}`);
        this._systemMsg('verbose', `instructions: ${instructions}`);

        const responses = prompts.map((prompt) => {
          this._systemMsg('verbose', `prompts: ${prompt.prompt}`);
          return ''; // Baseline fallback response
        });
        this._systemMsg('verbose', `Prompts object: ${responses}`);
        // The handshake stalls unless finish() receives an array of strings.
        finish(responses);
      };
      this._bindHostListener(record, 'keyboard-interactive', keyboardInteractive);
    }

    this._loadDefaultListeners();

    this._systemMsg('debug',`loadDefaults: Host loaded`);

    this._systemMsg('verbose', 'loadDefaults: Config:', host);
  }

  connect(callback) {
    if (typeof callback === 'function') {
      this._callback = callback;
    }

    this._resetRunState();
    this._started = true;

    return this.emit('newPrimaryHost', this._nextPrimaryHost(this._connect));
  }

  // The only connection method. `parent === null` opens a primary host; a
  // parent record opens a hop through `parent.connection.forwardOut`. Both
  // paths share `_openClient()` and `_openShell()`, so there is one command
  // engine, one set of handlers, and one close policy.
  _connect(parent = null) {
    if (this._stopping || this._runComplete) {
      return this._stream;
    }

    const host = this.sshObj;
    const context = this._pushContext(host, parent || null);
    const server = this._normalizeServer(host.server);
    // Defaults belong to the record, so they are loaded after the record
    // exists and before the client is opened.
    this._loadDefaults(context);

    if (!host.server) {
      if (context.isPrimary) {
        return this._reportMissingParameters();
      }
      this._hopFailed(context, new Error('Missing connection parameters'));
      return this._stream;
    }

    if (context.isPrimary) {
      this._systemMsg('debug', `Connect: primary`);
      return this._openClient(context, server);
    }

    const parentConnection = parent && parent.connection;
    if (!parentConnection || typeof parentConnection.forwardOut !== 'function') {
      this._hopFailed(context, new Error('No parent connection for host hop'));
      return this._stream;
    }
    this._systemMsg('debug', `Connect: forwardOut`);
    parentConnection.forwardOut(
      '127.0.0.1',
      0,
      server.host,
      Number(server.port) || 22,
      (err, channel) => {
        if (context.closed || context.failing) {
          if (channel && typeof channel.close === 'function') {
            try {
              channel.close();
            } catch (e) {
              // The channel may already be gone.
            }
          }
          return;
        }

        if (err) {
          return this._hopFailed(context, err);
        }

        if (this._stopping || this._runComplete || this._closing) {
          if (channel && typeof channel.close === 'function') {
            try {
              channel.close();
            } catch (e) {
              // The channel may already be gone.
            }
          }
          // The child record is already active. Close it and restore the
          // parent so a stop/close during forwardOut does not leave a
          // half-open stack.
          return this._failContext(
            context,
            new Error('Connection cancelled'),
            'cancelled'
          );
        }

        return this._openClient(
          context,
          Object.assign({}, server, { sock: channel })
        );
      }
    );

    return this._stream;
  }

  // Readability alias used by `_nextHost()`. The transport branch lives in
  // `_connect()`.
  _connectHop() {
    const parent = this._activeContext();
    if (!parent || !parent.connection) {
      this.emit('error', 'No parent connection for host hop', 'Hop', false);
      return this._callFinalCallback();
    }
    return this._connect(parent);
  }

  // Shared tail for primary connections and hops. The only difference is the
  // `sock` option a hop supplies.
  _openClient(context, options) {
    context.connection = new this.ssh2Client();
    this.connection = context.connection;
    this._bindConnection(context);

    try {
      context.connection.connect(options);
    } catch (err) {
      if (context.isPrimary) {
        // A synchronous throw has no guaranteed `close` event, so report it
        // and advance the primary here.
        this.emit(
          'error',
          `${err} ${err.stack}`,
          'Connection.connect',
          this._hasLiveStreamFor(context),
          null,
          context
        );
        return this._failContext(context, err, 'connect-throw');
      }
      return this._hopFailed(context, err);
    }

    return this._stream;
  }

  // Attaches the transport handlers to one record. Every handler closes over
  // `context`, so a late event from an ancestor cannot act on the active
  // child.
  _bindConnection(context) {
    const connection = context.connection;

    connection.on(
      'keyboard-interactive',
      (name, instructions, instructionsLang, prompts, finish) => {
        if (context.closed || context !== this._activeContext()) {
          return;
        }
        this._systemMsg('debug', `Connection.keyboard-interactive`);

        this.emit(
          'keyboard-interactive',
          name,
          instructions,
          instructionsLang,
          prompts,
          finish
        );
      }
    );

    connection.on('connect', () => {
      if (context.closed) {
        return;
      }
      this._systemMsg('debug', `connect: Connection.connect`);
      this.emit('msg', context.host.connectedMessage);
    });

    connection.on('ready', () => {
      if (context.closed || context.failing) {
        return;
      }
      this._systemMsg('debug', `connect: Connection.ready`);
      this.emit('msg', context.host.readyMessage);
      return this._openShell(context);
    });

    connection.on('error', (err) => {
      if (context.closed || context.failing) {
        return;
      }
      this._systemMsg('debug', `connect: Connection.error`);

      if (context.isPrimary) {
        // Before the shell opens there is no live stream to close, so report
        // the error without terminating. ssh2 follows a connection error with
        // `close`, which advances the primary.
        this.emit(
          'error',
          err,
          'Connection',
          this._hasLiveStreamFor(context),
          null,
          context
        );
        return;
      }

      // A failed hop connection is contained to that host and its subtree.
      return this._hopFailed(context, err);
    });

    connection.on('close', (had_error) => {
      this._progressEnd();
      this._systemMsg('debug', `connect: Connection.close`);

      if (context.closed || context.failing) {
        return;
      }

      if (context.isPrimary) {
        // Preserve any partial command output before the host is finalized.
        this._appendPartial('connection-close', context.host);

        if (had_error) {
          const err = new Error('Connection closed with error');
          err.level = 'Connection close';
          err.hadError = had_error;
          this.emit('error', err, 'Connection close', null, null, context);
        } else {
          const closedMessage =
            context.host && context.host.closedMessage
              ? context.host.closedMessage
              : 'Closed';
          this.emit('msg', closedMessage);
        }

        return this._failContext(
          context,
          had_error ? new Error('Connection closed with error') : null,
          this._stopping ? this._stopReason : 'connection-close'
        );
      }

      // A plain close/stop tears the stack down itself; the child close event
      // must not navigate back to the parent.
      if (this._closing || this._stopping || this._runComplete) {
        return;
      }

      // An unplanned hop close is a record failure. It is contained: the
      // parent's remaining hosts still run.
      this._appendPartial('connection-close', context.host);
      return this._hopFailed(context, new Error('Connection closed'));
    });
  }

  // Opens the shell for a record and routes its stream events. Inactive
  // ancestor streams are ignored so only the active host drives the command
  // engine.
  _openShell(context) {
    const connection = context.connection;
    const host = context.host;

    connection.shell(host.window, { pty: host.pty }, (err, stream) => {
      if (context.closed || context.failing) {
        if (stream && typeof stream.close === 'function') {
          try {
            stream.close();
          } catch (e) {
            // The stream may already be gone.
          }
        }
        return;
      }

      if (err instanceof Error) {
        this._systemMsg('debug', `connect: Connection.shell`);

        // ssh2 can hand back a stream alongside the error. Store it on the
        // record so teardown closes it instead of leaking the shell.
        if (stream) {
          context.stream = stream;
          if (context === this._activeContext()) {
            this._stream = stream;
          }
        }

        if (context.isPrimary) {
          this.emit(
            'error',
            err,
            'Shell',
            this._hasLiveStreamFor(context),
            null,
            context
          );
          return this._failContext(context, err, 'shell');
        }
        return this._hopFailed(context, err);
      }

      context.stream = stream;
      if (context === this._activeContext()) {
        this._stream = stream;
      }
      this._systemMsg('debug', `connect: Connection.shell`);

      stream.setEncoding(host.streamEncoding);

      stream.on('error', (err) => {
        if (context.closed || context.failing) {
          return;
        }
        this._systemMsg('debug', `connect: Stream.error`);

        if (context.isPrimary) {
          this.emit('error', err, 'Stream', true, null, context);
          return;
        }
        return this._hopFailed(context, err);
      });

      stream.stderr.on('data', (data) => {
        if (context.closed || context !== this._activeContext()) {
          return;
        }
        this._systemMsg('debug', `connect: Stream.stderr.data`);

        // Opt-in capture happens before the event so a handler can rely on
        // the buffer being current. The event still fires either way.
        this._captureStderr(data);
        this.emit('stderrData', data);
      });

      stream.on('data', (data) => {
        if (context.closed || context !== this._activeContext()) {
          return;
        }
        try {
          this.emit('data', data);
        } catch (e) {
          const readError = new Error(`${e} ${e.stack}`);
          readError.level = 'Data handling';
          if (context.isPrimary) {
            this.emit(
              'error',
              readError,
              'Stream.read error',
              true,
              null,
              context
            );
            return;
          }
          return this._hopFailed(context, readError);
        }
      });

      stream.on('finish', () => {
        if (context.closed) {
          return;
        }
        this._progressEnd();
        this._systemMsg('debug', `connect: Stream.finish`);

        // Finalize through the same path as close/connection close so the
        // text is appended and `end` fires exactly once per host.
        this._finalizeHost(context.host, 'stream-finish');
      });

      stream.on('close', (code, signal) => {
        this._progressEnd();
        this._systemMsg('debug', `connect: Stream.close`);

        if (context.closed || context.failing) {
          return;
        }
        if (context.connection && typeof context.connection.end === 'function') {
          try {
            context.connection.end();
          } catch (e) {
            // The transport may already be gone.
          }
        }
      });
    });
  }
}

// Class-body properties in the CoffeeScript source become prototype
// properties. They are intentionally shared until an instance assigns an own
// value, matching the baseline (and its known prototype-state quirk).
SSH2Shell.prototype.sshObj = {};
SSH2Shell.prototype.command = '';
SSH2Shell.prototype._hosts = [];
SSH2Shell.prototype._primaryHostCount = 1;
SSH2Shell.prototype._multipleHosts = false;
SSH2Shell.prototype._primaryhostSessionText = '';
SSH2Shell.prototype._allSessions = '';
SSH2Shell.prototype._connections = [];
SSH2Shell.prototype._stream = {};
SSH2Shell.prototype._buffer = '';
SSH2Shell.prototype._stderrBuffer = '';
SSH2Shell.prototype._boundListeners = {};
SSH2Shell.prototype.idleTime = 5000;
SSH2Shell.prototype.asciiFilter = '';
SSH2Shell.prototype.textColorFilter = '';
SSH2Shell.prototype.passwordPrompt = '';
SSH2Shell.prototype.standardPrompt = '';
SSH2Shell.prototype._callback = function () {};
SSH2Shell.prototype.onCommandProcessing = function () {};
SSH2Shell.prototype.onCommandComplete = function () {};
SSH2Shell.prototype.onCommandTimeout = function () {};
SSH2Shell.prototype.onEnd = function () {};

module.exports = SSH2Shell;
