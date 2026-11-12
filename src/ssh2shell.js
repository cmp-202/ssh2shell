// ssh2shell
// A wrapper class for ssh2 to run multiple sequential commands in an SSH shell
// session, handle command responses, and tunnel through to other hosts using
// nested host objects.
//
// The class is the public facade. Pure default application, prompt/filter
// compilation, and nested-SSH command construction live in ./ssh2shell/*.
// Behavior matches the baseline except for the signed-off L5/L6/L6.1 fixes.

const Stream = require('node:stream');

const { buildSshCommand } = require('./ssh2shell/ssh-command');
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

class SSH2Shell extends Stream {
  constructor(hosts) {
    super(hosts);

    // Methods that were CoffeeScript fat-arrows are bound in the constructor.
    // Keep the same list and order so callbacks and event listeners keep
    // their `this`.
    this._connect = this._connect.bind(this);
    this.connect = this.connect.bind(this);
    this._loadDefaults = this._loadDefaults.bind(this);
    this._initiate = this._initiate.bind(this);
    this._removeListeners = this._removeListeners.bind(this);
    this.close = this.close.bind(this);
    this._runExit = this._runExit.bind(this);
    this._sshConnect = this._sshConnect.bind(this);
    this._nextPrimaryHost = this._nextPrimaryHost.bind(this);
    this._nextHost = this._nextHost.bind(this);
    this._previousHost = this._previousHost.bind(this);
    this._runCommand = this._runCommand.bind(this);
    this._checkCommand = this._checkCommand.bind(this);
    this._nextCommand = this._nextCommand.bind(this);
    this._commandComplete = this._commandComplete.bind(this);
    this._processNotifications = this._processNotifications.bind(this);
    this._processSSHPrompt = this._processSSHPrompt.bind(this);
    this._resetFromSudoError = this._resetFromSudoError.bind(this);
    this._processSudoPrompt = this._processSudoPrompt.bind(this);
    this._sanitizeResponse = this._sanitizeResponse.bind(this);
    this._onData = this._onData.bind(this);
    this._callback = this._callback.bind(this);
    this._systemMsg = this._systemMsg.bind(this);
    this._detachListener = this._detachListener.bind(this);
    this._boundListener = this._boundListener.bind(this);
    this._loadDefaultListeners = this._loadDefaultListeners.bind(this);    
    this.ssh2Client = require('ssh2').Client;
    this._hosts = typeIsArray(hosts) && hosts.length > 0 ? hosts : [hosts];
    this._primaryHostCount = this._hosts.length;
    this._multipleHosts = this._primaryHostCount > 1;
    this._boundListeners = {};
    this.sshObj = {}; 
    this._connections = [];
    this.host = "No host";
    this._allSessions = '';
    this._defaultErrorListener = null;
    this._loadDefaultListeners();
  }
  
  _loadDefaultListeners() {
    if (!this.msg) {
      this.msg = (message) => {
          console.log(message);
        };
    }
    if(!this._boundListeners['msg']){
      this._boundListener('msg', this.msg); 
    }    
    if(!this._boundListeners['data']){
        const data = (data) => {
          this._onData(data);
        };
        this._boundListener ( 'data', data);
    }
    if(!this._boundListeners['stderrData']){
        const stderrData = (data) => {
          console.error(data);
        };
        this._boundListener ( 'stderrData', stderrData);
    }
    // Track the default error listener separately from host `onError` handlers.
    // The host cache entry is cleared when a host handler is detached, which
    // used to make the next host install a second default listener.
    if (!this._defaultErrorListener) {
      this._defaultErrorListener = (err, type, close = false, callback) => {
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

        // Only close a real shell stream. Before the shell opens, `_stream` is
        // the prototype `{}` placeholder, which has no close method.
        if (close && this._hasLiveStream()) {
          this._stream.close();
        }
      };
    }
    if (!this.listeners('error').includes(this._defaultErrorListener)) {
      this.on('error', this._defaultErrorListener);
    }
    if(!this._boundListeners['keyboard-interactive']){
        // Only install the fallback when the caller has not supplied a handler.
        // Two handlers would both call finish(), resetting the handshake.
        const hasUserHandler =
          this.listeners('keyboard-interactive').length > 0 ||
          typeof this.sshObj?.onKeyboardInteractive === 'function';
        if (
          this.sshObj &&
          this.sshObj.server &&
          this.sshObj.server.tryKeyboard &&
          !hasUserHandler
        ) {
          const keyboardInteractive = (name, instructions, instructionsLang, prompts, finish) => {
            this._systemMsg('debug',`keyboard-interactive:`);
            
            this._systemMsg('verbose',`name: ${name}`);
            this._systemMsg('verbose',`instructions: ${instructions}`);
            
            const responses = prompts.map(p => {
              this._systemMsg('verbose',`prompts: ${p.prompt}`);
              return ''; // Baseline fallback response
            });
            this._systemMsg('verbose',`Prompts object: ${responses}`);
            // The handshake stalls unless finish() receives the responses as an
            // array of strings.
            finish(responses);
          };
          this._boundListener ( 'keyboard-interactive', keyboardInteractive);
        }
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
  // that, `_stream` is the prototype `{}` placeholder.
  _hasLiveStream() {
    return Boolean(this._stream && typeof this._stream.close === 'function');
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
  // callers can keep their existing commandTimeout payloads.
  _scheduleIdleTimeout(response) {
    this.idleTimer = setTimeout(() => {
      this.emit(
        'commandTimeout',
        this.command,
        response,
        this._stream,
        this.connection
      );
    }, this.idleTime);

    return this.idleTimer;
  }
  
  _onData(data) {
    this._buffer += data;
    if (
      this.command.length > 0 &&
      !this.standardPrompt.test(this._sanitizeResponse())
    ) {
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
    } else if (
      this.command.length < 1 &&
      !this.standardPrompt.test(this._buffer)
    ) {
      this.emit(
        'commandProcessing',
        this.command,
        this._buffer,
        this.sshObj,
        this._stream
      );
    }

    // Set a timer to fire when no more data events are received and then
    // process the buffer based on command and prompt combinations.
    if (this.dataReceivedTimer) {
      clearTimeout(this.dataReceivedTimer);
    }
    return (this.dataReceivedTimer = setTimeout(() => {
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
        // Check if ssh authentication needs to be handled.
        case this.sshObj.sshToNextHost &&
          this.command.length > 0 &&
          this.command.indexOf('ssh ') === 0:
          this._systemMsg('debug', `onData: SSH command data`);
          
          return this._processSSHPrompt();
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
    }, this.dataIdleTime));
  }

  _sanitizeResponse() {
    return this._buffer.replace(
      this.command.slice(0, this._buffer.length),
      ''
    );
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
        
        return this._resetFromSudoError();
      case passwordPrompt && !this.sshObj.pwSent:
        this._systemMsg('debug', `processSudoPrompt: Send password`);
                      
        this._systemMsg('verbose',`processSudoPrompt: Password: ${this.sshObj.server.password}`);
        
        // Send password.
        this.sshObj.pwSent = true;
        return this._runCommand(`${this.sshObj.server.password}`);
      case passwordPrompt && this.sshObj.pwSent:
        this._systemMsg('debug', `processSudoPrompt: Failed login`);
        
        // A rejected sudo password is a notification, not a terminator: the
        // command is cancelled and the session continues. Report it as debug
        // output instead of raising a non-closing `error`.
        this._systemMsg(
          'debug',
          `Password was incorrect for ${this.sshObj.server.userName}`
        );
        this._systemMsg('verbose',`processSudoPrompt: Failed login: Response: ${response}`);
        
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
    this.sshObj.pwSent = false;
    this.sshObj.sessionText += `${this._buffer}`;
    this._buffer = '';
    this.command = '';
    // Cancel command on host.
    return this._stream.write('\x03');
  }

  _sshConnect() {
    const result = buildSshCommand(this.sshObj);
    if (result.error) {
      this.emit('error', result.error, 'Security Alert', true);
      return;
    }

    // A nested connection that authenticates with a key has no prompt to
    // answer. Mark it authenticated up front so the first remote shell prompt
    // is treated as success instead of a failed connection. Password and
    // passphrase auth still start unauthenticated so the first prompt can be
    // answered.
    const server = this.sshObj.server;
    this.sshObj.sshAuth = !server.password && !server.passPhrase;
    this.sshObj.sshToNextHost = true;

    // Perfectly combined secure connection command string.
    this.command = result.command;
    this._systemMsg('debug',`SSH command: connect`);
    
    return this._runCommand(this.command);
  }
  
  _processSSHPrompt() {
    // Not authenticated yet so detect prompts.
    const response = this._sanitizeResponse().trim();
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    const passwordPrompt =
      this.passwordPrompt.test(response) &&
      !this.sshObj.server.hasOwnProperty('passPhrase');
    const passphrasePrompt =
      this.passphrasePrompt.test(response) &&
      this.sshObj.server.hasOwnProperty('passPhrase');
    const standardPrompt = this.standardPrompt.test(response);
    
    this._systemMsg('debug', `processSSHPrompt: SSH password handling`);
    
    this._systemMsg(
        'verbose',
        `processSSHPrompt: Password prompt: ${passwordPrompt}, Passphase prompt: ${passphrasePrompt}, Standard prompt: ${standardPrompt}, Password previously sent: ${this.sshObj.sshAuth}`
      );

    if (!this.sshObj.sshAuth) {
      this._systemMsg(
        'debug',
          `processSSHPrompt: First prompt detection`
        );

      // Provide password.
      if (passwordPrompt) {
        this._systemMsg('debug', `processSSHPrompt: send password`);
        
        this.sshObj.sshAuth = true;
        this._buffer = '';

        return this._runCommand(`${this.sshObj.server.password}`);
      } else if (passphrasePrompt) {
        this._systemMsg('debug', `processSSHPrompt: send passphrase`);
        
        this.sshObj.sshAuth = true;
        this._buffer = '';
        return this._runCommand(`${this.sshObj.server.passPhrase}`);
      } else if (standardPrompt) {
        this._systemMsg('debug', `processSSHPrompt: standard prompt: connection failed`);
        
        this._systemMsg('verbose',`processSSHPrompt: SSH failed: Response: ${response}`);
        
        this.sshObj.sessionText += `${this.host}: SSH failed: Response: ${response}`;
        return this._runExit();
      } else {
        this._systemMsg('debug', `processSSHPrompt: No prompt detected`);
        
        this._systemMsg('verbose',`processSSHPrompt: Response: ${response}`);
        
        if (this.verbose){
          if (!this.sshObj.server.hasOwnProperty('password')) 
          {
            this._systemMsg(
              'verbose',
              `processSSHPrompt: SSH password prompt: ${this.sshObj.passwordPrompt}`
            );
          }
          if (this.sshObj.server.hasOwnProperty('passPhrase')) 
          {
            this._systemMsg(
              'verbose',
              `processSSHPrompt: SSH passphrase prompt: ${this.sshObj.passphrasePrompt}`
            );
          }
          this._systemMsg(
            'verbose',
            `processSSHPrompt: SSH standard prompt: ${this.sshObj.standardPrompt}`
          );
        }

        return this._runExit();
      }
    } else {
      this._systemMsg(
        'debug',
          `processSSHPrompt: Post authentication prompt detection`
        );
    
      if (standardPrompt) {
        this._systemMsg('debug', `processSSHPrompt: SSH complete: normal prompt`);
        
        if (this.sshObj.showBanner) {
          this.sshObj.sessionText += `\n ${response}`;
        }
        this.sshObj.exitCommands.push('exit');
        this.emit('msg', `${this.sshObj.connectedMessage}`);
        this.emit('msg', `${this.sshObj.readyMessage}`);
        this._systemMsg('debug', `processSSHPrompt: next command`);
        
        this.sshObj.sshToNextHost = false;
        return this._nextCommand();
      } else if (passwordPrompt || passphrasePrompt) {
        // Password or passphrase detected a second time after authentication
        // indicates failure.
        this.emit(
          'msg',
          `SSH authentication failed`
        );
        this._systemMsg('debug', `processSSHPrompt: Authentication failed`);
        
        this._systemMsg('verbose',`processSSHPrompt: failed response: ${response}`);
        
        this.sshObj.sshAuth = false;
        let using;
        switch (true) {
          case passwordPrompt:
            using = `SSH password: ${this.sshObj.server.password}`;
            break;
          case passphrasePrompt:
            using = `SSH passphrase: ${this.sshObj.server.passPhrase}`;
            break;
        }
        this.emit(
          'error',
          `${this.host}: SSH authentication failed for ${this.sshObj.server.userName}@${this.host}`,
          'SSH multi host authentication failure'
        );
        
        // No connection so drop back to first host settings if there was one.
        if (this._connections.length > 0) {
          return this._previousHost();
        }

        return this._runExit();
      }

      // Authenticated, but the response is neither a prompt nor a repeated
      // credential prompt. Re-arm the idle timer so a silent nested shell
      // cannot leave the session with no timer at all.
      this._systemMsg(
        'debug',
        `processSSHPrompt: No prompt after authentication, reset timeout`
      );
      return this._scheduleIdleTimeout(response);
    }
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
    const response = this._buffer.trim();
    // Check sudo su has been authenticated and add an extra exit command.
    if (
      this.command !== '' &&
      this.command !== 'exit' &&
      this.sshObj.sshToNextHost !== true
    ) {
      this._systemMsg('debug',`commandComplete: Raising commandComplete event`);
      
      this._systemMsg(
        'verbose',
        `commandComplete:\nCommand:\n ${this.command}\nResponse: ${response}`
      );
      this.sshObj.sessionText += response;
      
      this.emit('commandComplete', this.command, this._buffer, this.sshObj);
    }
    return this._nextCommand();
  }

  _nextCommand() {
    this._buffer = '';
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
    // If there is still a command to run then run it or exit.
    if (this.command !== '') {
      return this._runCommand(this.command);
    }

    // No more commands so exit.
    this._systemMsg('debug',`checkCommand: No command so exit`);
    
    return this._runExit();
  }

  _runCommand(command) {
    this._systemMsg('debug',`runCommand:`);
    
    this._systemMsg('verbose',`runCommand: Command: ${command}`);
    
    return this._stream.write(`${command}${this.sshObj.enter}`);
  }

  _previousHost() {
    this._systemMsg('debug',`previousHost: raise end event on current connection: ${this.host}`);
    
    this.emit(
      'end',
      `${this.sshObj.server.host}: \n${this.sshObj.sessionText}`,
      this.sshObj
    );
    this._systemMsg(
      'debug', 
      `previousHost: Check for previous connections and reload its configuration if one exists`
    );

    // Remove the outgoing host's handlers before restoring the previous host.
    // Without this, a stale commandComplete (or similar) handler keeps firing
    // against the new current host and duplicates session text.
    this._removeListeners();

    if (this._connections.length > 0) {
      this.sshObj = this._connections.pop();
      this.host = this.sshObj.server.host;
      // Reapply the previous host's timer config over the base restored by
      // _removeListeners.
      this._applyHostTimerValues();
      this._systemMsg('debug',`previousHost: previous host loaded: ${this.host} `);
      
    }

    return this._runExit();
  }

  _nextHost() {
    this._removeListeners();
    const nextHost = this.sshObj.hosts.shift();
    this._systemMsg(
      'debug', 
      `nextHost: load ${nextHost.server.host} config, prepare and start SSH connection`
    );
    this._connections.push(this.sshObj);

    this.sshObj = nextHost;
    this.host = nextHost.server.host;

    return this._initiate(this._sshConnect);
  }

  _nextPrimaryHost(connect) {
    if (this._hosts.length > 0) {
      this._systemMsg('debug', `nextPrimaryHost: load next host for ssh2 connection`);
      
      // Check this is not loading the first primary host before removing
      // listeners.
      if (this.sshObj.server) {
        this._systemMsg('debug', `nextPrimaryHost: end current host ${this.host}`);
        
        this.emit('end', this._primaryhostSessionText, this.sshObj);
      }
      
      this._systemMsg('debug',`nextPrimaryHost: Load next primary host: ${this.host}`);
      
      this._removeListeners();
      // A new primary host gets a new connection, so drop the previous host's
      // stream reference. Otherwise an early error could close the old stream.
      this._stream = {};
      this.sshObj = this._hosts.shift();
      this.host = this.sshObj.server.host;
      this._primaryhostSessionText = `${this.host}: `;
      return this._initiate(connect);
    }
  }

  _runExit() {
    this._systemMsg('debug',`runExit: Process an exit`);
    
    // Run the exit commands loaded by ssh and sudo su commands.
    if (this.sshObj.exitCommands && this.sshObj.exitCommands.length > 0) {
      this._systemMsg(
        'verbose',
          `runExit: Queued exit commands: ${this.sshObj.exitCommands.length}`
        );
      
      this.command = this.sshObj.exitCommands.pop();
      if (this._connections && this._connections.length > 0) {
        this._systemMsg('verbose',`runExit: Primary host: ${this._connections[0].server.host}`);
        
        this._connections[0].sessionText += `\n${this.host}: ${this.sshObj.sessionText}`;
      }
      return this._runCommand(this.command);
    } else if (this.sshObj.hosts && this.sshObj.hosts.length > 0) {
      // More hosts to connect to so process the next one.
      this._systemMsg('debug',`runExit: Load next host`);
      
      return this._nextHost();
    } else if (this._connections && this._connections.length > 0) {
      // Leaving last host so load previous host.
      this._systemMsg('debug',`runExit: load previous host`);
      
      this.emit('msg', `${this._hostPrefix()}${this.sshObj.closedMessage}`);
      return this._previousHost();
    } else if (this.command === 'exit') {
      this._systemMsg('debug',`runExit: run exit command`);
      
      return this._runCommand('exit');
      // Nothing more to do so end the stream with last exit.
    } else {
      return this.close();
    }
  }

  close() {
    this._systemMsg('debug',`Stream: close`);

    // Calling close() before the shell opens would otherwise throw on the
    // prototype `{}` placeholder. There is nothing to close yet.
    if (!this._hasLiveStream()) {
      return;
    }

    return this._stream.close();
  }

  _removeListeners() {
    this._systemMsg('debug',`removeListeners: removing event listeners linked to the host`);
    
    if (
      typeof this.sshObj.onKeyboardInteractive === 'function' ||
      typeof this._boundListeners['keyboard-interactive'] === 'function'
    ){
      this._detachListener('keyboard-interactive', 'onKeyboardInteractive');
    }
    if (typeof this.sshObj.onStderrData === 'function'){
      this._detachListener('stderrData', 'onStderrData');
    }
    if (typeof this.sshObj.onData === 'function'){
      this._detachListener('data', 'onData');
    }
    if (typeof this.sshObj.onEnd === 'function'){
      this._detachListener('end', 'onEnd');
    }
    if (typeof this.sshObj.onCommandProcessing === 'function'){
      this._detachListener('commandProcessing', 'onCommandProcessing');
    }
    if (typeof this.sshObj.onCommandComplete === 'function'){
      this._detachListener('commandComplete', 'onCommandComplete');
    }
    if (typeof this.sshObj.onCommandTimeout === 'function'){
      this._detachListener('commandTimeout', 'onCommandTimeout');
    }
    if (typeof this.sshObj.onError === 'function'){
      this._detachListener('error', 'onError');
    }
    if (
      typeof this.sshObj.msg === 'function' ||
      typeof this._boundListeners['msg'] === 'function'
    ){
      this._detachListener('msg', 'msg');
    }
    // Keep a message sink for _systemMsg between leaving this host and loading
    // the next one. _loadDefaults swaps in a host handler when one exists.
    this._boundListener('msg', this.msg);
    
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    if (this.dataReceivedTimer) {
      clearTimeout(this.dataReceivedTimer);
    }

    // Roll timer values back to the instance base so one host's override does
    // not leak into the next host.
    if (this._baseIdleTime !== undefined) {
      this.idleTime = this._baseIdleTime;
    }
    if (this._baseDataIdleTime !== undefined) {
      this.dataIdleTime = this._baseDataIdleTime;
    }
    
    return;
  }

  _initiate(action) {
    
    this._loadDefaults();
    
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
  _applyHostTimerValues() {
    // `idleTimeOut` is the documented key; `idleTime` is a legacy alias.
    const idleTimeOut =
      toPositiveNumber(this.sshObj.idleTimeOut) ||
      toPositiveNumber(this.sshObj.idleTime);
    if (idleTimeOut > 0) {
      this.idleTime = idleTimeOut;
    }

    // Public key is `dataIdleTimeOut` (README). Keep the undocumented
    // `dataIdleTime` as a fallback for existing callers.
    const dataIdleTimeOut =
      toPositiveNumber(this.sshObj.dataIdleTimeOut) ||
      toPositiveNumber(this.sshObj.dataIdleTime);
    if (dataIdleTimeOut > 0) {
      this.dataIdleTime = dataIdleTimeOut;
    }
  }

  _loadDefaults() {
    this.command = '';
    this._buffer = '';
    this.debug = this.sshObj.debug ?? false;
    this.verbose = this.sshObj.verbose ?? false;
    this.exposeCredentials = this.sshObj.exposeCredentials ?? false;
    this.host = this.sshObj.server.host;

    // Remember that this session uses nested hosts even after the queue has
    // been consumed, so message prefixes stay consistent.
    if (Array.isArray(this.sshObj.hosts) && this.sshObj.hosts.length > 0) {
      this._multipleHosts = true;
    }

    // Support the legacy { send: fn } message handler shape.
    if (
      this.sshObj.msg &&
      this.sshObj.msg.send &&
      typeof this.sshObj.msg.send === 'function'
    ) {
      this.sshObj.msg = this.sshObj.msg.send;
    }

    if (typeof this._boundListeners['msg'] === 'function') {      
      this._detachListener('msg', 'msg');
    }    
    if (typeof this.sshObj.msg === 'function') {
      this._boundListener('msg', this.sshObj.msg);
    } else {
      this._boundListener('msg', this.msg);
    }
    this._systemMsg('debug',`Load Defaults`);
    
    applyHostDefaults(this.sshObj);

    this._captureBaseTimerValues();
    this._applyHostTimerValues();

    // Keep the instance base when no host value was supplied; only repair an
    // invalid current value.
    if (!(toPositiveNumber(this.idleTime) > 0)) {
      this.idleTime = this._baseIdleTime;
    }
    if (!(toPositiveNumber(this.dataIdleTime) > 0)) {
      this.dataIdleTime = this._baseDataIdleTime;
    }

    // Compile ASCII Filter with Safe Fallback. These compiled regexes are
    // internal state, not public config: recompile from the current host on
    // every load so a later host with different filters/prompts is honoured.
    const ascii = compileAsciiFilter(this.sshObj.asciiFilter);
    this.asciiFilter = ascii.filter;
    if (ascii.usedFallback && this.debug) {
      this._systemMsg(
        'debug',
        `loadDefaults: AsciiFilter: incorrect regular expression reverting to default: ${this.sshObj.asciiFilter}`
      );
    }

    // Compile Text Color Filter with Safe Fallback.
    const color = compileTextColorFilter(this.sshObj.textColorFilter);
    this.textColorFilter = color.filter;
    if (color.usedFallback && this.debug) {
      this._systemMsg(
        'debug',
        `loadDefaults: TextColorFilter: incorrect regular expression reverting to default: ${this.sshObj.textColorFilter}`
      );
    }

    // Prompts: fully sanitized at runtime via escapeRegex (never need
    // fallbacks because they are cast as pure literals).
    const prompts = compilePrompts(this.sshObj);
    this.passwordPrompt = prompts.passwordPrompt;
    this.passphrasePrompt = prompts.passphrasePrompt;
    this.standardPrompt = prompts.standardPrompt;

    // Listener defaults for command processing.
    this.sshObj.onCommandProcessing =
      this.sshObj.onCommandProcessing ??
      ((command, response, sshObj, stream) => {});
    
    this.sshObj.onCommandComplete =
      this.sshObj.onCommandComplete ??
      ((command, response, sshObj) => {
        this._systemMsg('debug', `onCommandComplete:`);
      });

    this.sshObj.onCommandTimeout =
      this.sshObj.onCommandTimeout ??
      ((command, response, stream, connection) => {
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

    // Explicitly cache references right before binding them to the event emitter
    if (typeof this.sshObj.onKeyboardInteractive === 'function') {      
      this._boundListener('keyboard-interactive', this.sshObj.onKeyboardInteractive);
    }
    if (typeof this.sshObj.onError === 'function') {
      // Host handlers run before the default listener so they can observe the
      // error before the default listener closes the stream.
      this._boundListener('error', this.sshObj.onError, true);
    }
    if (typeof this.sshObj.onData === 'function') {
      this._boundListener('data', this.sshObj.onData);
    }
    if (typeof this.sshObj.onStderrData === 'function') {
      this._boundListener('stderrData', this.sshObj.onStderrData);
    }
    if (typeof this.sshObj.onEnd === 'function') {
      this._boundListener('end', this.sshObj.onEnd);
    }
    
    this._boundListener('commandProcessing', this.sshObj.onCommandProcessing);

    this._boundListener('commandComplete', this.sshObj.onCommandComplete);

    this._boundListener('commandTimeout', this.sshObj.onCommandTimeout);

    this._loadDefaultListeners();

    this._systemMsg('debug',`loadDefaults: Host loaded`);
    
    this._systemMsg('verbose', 'loadDefaults: Config:', this.sshObj);
  }

  connect(callback) {
    if (typeof callback === 'function') {
      this._callback = callback;
    }

    return this.emit('newPrimaryHost', this._nextPrimaryHost(this._connect));
  }

  _connect() {
    this.connection = new this.ssh2Client();

    this.connection.on(
      'keyboard-interactive',
      (name, instructions, instructionsLang, prompts, finish) => {
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

    this.connection.on('connect', () => {
      this._systemMsg('debug',`connect: Connection.connect`);
      
      this.emit('msg', this.sshObj.connectedMessage);
    });

    this.connection.on('ready', () => {
      this._systemMsg('debug',`connect: Connection.ready`);
      
      this.emit('msg', this.sshObj.readyMessage);

      // Open a shell.
      this.connection.shell(
        this.sshObj.window,
        { pty: this.sshObj.pty },
        (err, stream) => {
          this._stream = stream;
          if (err instanceof Error) {
            this.emit('error', err, 'Shell', this._hasLiveStream());
            return;
          }
          this._systemMsg('debug', `connect: Connection.shell`);
          
          this._stream.setEncoding(this.sshObj.streamEncoding);

          this._stream.on('error', (err) => {
            this._systemMsg('debug', `connect: Stream.error`);
            
            this.emit('error', err, 'Stream', true);
          });

          this._stream.stderr.on('data', (data) => {
            this._systemMsg('debug', `connect: Stream.stderr.data`);
            
            this.emit('stderrData', data);
          });

          this._stream.on('data', (data) => {
            try {
              this.emit('data', data);
            } catch (e) {
              const err = new Error(`${e} ${e.stack}`);
              err.level = 'Data handling';
              this.emit('error', err, 'Stream.read error', true);
            }
          });

          this._stream.on('finish', () => {
            this._systemMsg('debug', `connect: Stream.finish`);

            this._primaryhostSessionText += `${this.sshObj.sessionText}\n`;
            this._allSessions += this._primaryhostSessionText;
            if (this._hosts.length === 0) {
              this.emit('end', this._allSessions, this.sshObj);
            }
          });

          this._stream.on('close', (code, signal) => {
            this._systemMsg('debug', `connect: Stream.close`);
            
            this.connection.end();
          });
        }
      );
    });

    this.connection.on('error', (err) => {
      this._systemMsg('debug',`connect: Connection.error`);
      
      // Before the shell opens there is no live stream to close, so report the
      // error without terminating. Once a shell exists, the connection error
      // is a terminator.
      this.emit('error', err, 'Connection', this._hasLiveStream());
    });

    this.connection.on('close', (had_error) => {
      this._systemMsg('debug',`connect: Connection.close`);
      
      if (this.idleTimer) {
        clearTimeout(this.idleTimer);
      }
      if (this.dataReceivedTimer) {
        clearTimeout(this.dataReceivedTimer);
      }
      if (had_error) {
        this.emit('error', had_error, 'Connection close');
      } else {
        this.emit('msg', this.sshObj.closedMessage);
      }

      if (this._hosts.length === 0) {
        if (typeof this._callback === 'function') {
          this._callback(this._allSessions);
          return this._allSessions;
        }
      } else {
        return this.emit(
          'newPrimaryHost',
          this._nextPrimaryHost(this._connect)
        );
      }
    });

    if (this.sshObj.server && this.sshObj.commands) {
      try {
        if (!this.sshObj.server.username) {
          this.sshObj.server.username = this.sshObj.server.userName;
        }
        if (!this.sshObj.server.hostHash) {
          this.sshObj.server.hostHash = this.sshObj.server.hashMethod;
        }
        if (!this.sshObj.server.passphrase) {
          this.sshObj.server.passphrase = this.sshObj.server.passPhrase;
        }
        
        this.connection.connect(this.sshObj.server);
      } catch (e) {
        this.emit(
          'error',
          `${e} ${e.stack}`,
          'Connection.connect',
          this._hasLiveStream()
        );
      }
    } else {
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
    }
    return this._stream;
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
SSH2Shell.prototype._sshToNextHost = false;
SSH2Shell.prototype._primaryhostSessionText = '';
SSH2Shell.prototype._allSessions = '';
SSH2Shell.prototype._connections = [];
SSH2Shell.prototype._stream = {};
SSH2Shell.prototype._buffer = '';
SSH2Shell.prototype._boundListeners = {};
SSH2Shell.prototype.idleTime = 5000;
SSH2Shell.prototype.asciiFilter = '';
SSH2Shell.prototype.textColorFilter = '';
SSH2Shell.prototype.passwordPrompt = '';
SSH2Shell.prototype.passphrasePrompt = '';
SSH2Shell.prototype.standardPrompt = '';
SSH2Shell.prototype._callback = function () {};
SSH2Shell.prototype.onCommandProcessing = function () {};
SSH2Shell.prototype.onCommandComplete = function () {};
SSH2Shell.prototype.onCommandTimeout = function () {};
SSH2Shell.prototype.onEnd = function () {};

module.exports = SSH2Shell;
