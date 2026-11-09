// ssh2shell
// A wrapper class for ssh2 to run multiple sequential commands in an SSH shell
// session, handle command responses, and tunnel through to other hosts using
// nested host objects.
//
// The class is the public facade. Pure default application, prompt/filter
// compilation, and nested-SSH command construction live in ./ssh2shell/*.
// Behavior is intentionally identical to the baseline (refactor/L1).

const Stream = require('node:stream');

const { buildSshCommand } = require('./ssh2shell/ssh-command');
const { applyHostDefaults } = require('./ssh2shell/defaults');
const {
  compileAsciiFilter,
  compilePrompts,
  compileTextColorFilter,
  typeIsArray,
} = require('./ssh2shell/util');

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
    this._processPasswordPrompt = this._processSudoPrompt.bind(this);
    this._sanitizeResponse = this._sanitizeResponse.bind(this);
    this._onData = this._onData.bind(this);
    this.onEnd = this.onEnd.bind(this);
    this.onCommandTimeout = this.onCommandTimeout.bind(this);
    this.onCommandComplete = this.onCommandComplete.bind(this);
    this.onCommandProcessing = this.onCommandProcessing.bind(this);
    this._callback = this._callback.bind(this);
    this._systemMsg = this._systemMsg.bind(this);
    this._detach = this._detach.bind(this);
    this._boundListener = this._boundListener.bind(this);
    
    if (typeIsArray(hosts) && hosts.length > 0) {
      this._hosts = hosts;
    } else {
      this._hosts = [hosts];
    }

    this.ssh2Client = require('ssh2').Client;
    
    //bonds listener functions for correct later removal when changing hosts
    this._boundListeners = {};
    this.msg = (message) => {
        console.log(message);
      };
    this._boundListener('msg', this.msg);  
    
    const data = (data) => {
      this._onData(data);
    };
    this._boundListener ( 'data', data);
    
    const stderrData = (data) => {
      console.error(data);
    };
    this._boundListener ( 'stderrData', stderrData);
    
    const error = (err, type, close = false, callback) => {
      this._systemMsg('debug',`Class.error: ${err}, ${type}`);
      
      if (err instanceof Error) {
        this.emit('msg', `Error: ${err.message}, Level: ${err.level}`);
      } else {
        this.emit('msg', `${type} error: ${err}`);
      }

      if (close) {
        this._stream.close();
      }
    };
    this._boundListener ( 'error', error);
    
    if (this._hosts[0].server.tryKeyboard) {
      this.keyboardInteractive = (name, instructions, instructionsLang, prompts, finish) => {
        this._systemMsg('debug',`keyboard-interactive:`);
        
        this._systemMsg('verbose',`name: ${name}`);
        this._systemMsg('verbose',`instructions: ${instructions}`);
        
        const responses = prompts.map(p => {
          /* handle prompts here     
          if (p.prompt.toLowerCase().includes('password')) {
            return "YOUR_ACTUAL_PASSWORD"; 
          }
          */
          return ""; // Default fallback response
        });
        this._systemMsg('verbose',`Prompts object: ${responses}`);
        // 2. CRITICAL: You must execute finish() and pass the responses as an array of strings.
        // Skipping this will freeze the SSH connection handshake.
        finish(responses);
      };
      this._boundListener ( 'keyboard-interactive', this.keyboardInteractive);
    }
    this.host = "No host";
    this._allSessions = '';    
  }
  
  _boundListener ( eventName, listener ) {
    if ( typeof listener === `function` ){
      this._boundListeners[eventName] = listener;
      this.on(eventName, this._boundListeners[eventName]);
      return;
    }
    return;
  }
  
  // Helper to safely detach listeners using cached references
  _detach(eventName, currentKey) {
    const targetHandler = this._boundListeners[eventName] || this.sshObj[currentKey];
    if (typeof targetHandler === `function` ) {
      this.removeListener(eventName, targetHandler);
      delete this._boundListeners[eventName]; // clear cache
    }
  };
  
  //handles check against debug and verbose flags for proccessing messages
  _systemMsg(type, message, object = null){
    // Check if message is an object (and not null)
    
    switch (true) {
      case type === 'debug' && this.debug:
        this.emit('msg', `${this.host}: ${message}`);
        if( typeof object === 'object' && object !== null) {
          this.emit('msg', object);
        }
        return;
      case type === 'verbose' && this.verbose:
        this.emit('msg', `${this.host}: ${message}`);
        if( typeof object === 'object' && object !== null) {
          this.emit('msg', object);
        }
        return; // Added missing return to prevent falling through to default
      default:
        return;
    }
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
      this.idleTimer = setTimeout(() => {
        this.emit(
          'commandTimeout',
          this.command,
          this._buffer,
          this._stream,
          this.connection
        );
      }, this.idleTime);
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

      // Remove non-standard ascii from terminal responses.
      if (!this.sshObj.disableASCIIFilter) {
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
          
          return (this.idleTimer = setTimeout(() => {
            this.emit(
              'commandTimeout',
              this.command,
              this._buffer,
              this._stream,
              this.connection
            );
          }, this.idleTime));
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
        
        if (this.debug) {
          this.emit(
            'error',
            `${this.host}: Password was incorrect for ${this.sshObj.server.userName}`, 
            'Sudo authentication failed'
          );
        }
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
        
        return (this.idleTimer = setTimeout(() => {
          this.emit(
            'commandTimeout',
            this.command,
            response,
            this._stream,
            this._connection
          );
        }, this.idleTime));
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

    this.sshObj.sshAuth = false;
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
    }
  }

  _processNotifications() {
    // Check for notifications in commands.
    if (this.command) {
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
        
        this.emit('msg', `${this.host}: Note: ${msgNote[1]}`);
        return this._nextCommand();
      }

      this._systemMsg('debug', `processNotifications: Normal Command to run`);
      
      return this._checkCommand();
    }
  }

  _commandComplete() {
    const response = this._buffer.trim();
    // Check sudo su has been authenticated and add an extra exit command.
    if (
      this.command !== '' &&
      this.command !== 'exit' &&
      this.sshObj.sshToNextHost !== true
    ) {
      this._systemMsg(
        'debug',
          `commandComplete: Raising commandComplete event`
        );
      
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
      `${this.host}: \n${this.sshObj.sessionText}`,
      this.sshObj
    );
    this._systemMsg(
      'debug', 
      `previousHost: Check for previous connections and reload its configuration if one exists`
    );

    if (this._connections.length > 0) {
      this.sshObj = this._connections.pop();
      this.host = this.sshObj.server.host;
      this._systemMsg('debug',`previousHost: previous host loaded: ${this.host} `);
      
    }

    return this._runExit();
  }

  _nextHost() {
    const nextHost = this.sshObj.hosts.shift();
    this._systemMsg(
      'debug', 
      `nextHost: load ${nextHost.server.host} config, prepare and start SSH connection`
    );
    
    this._removeListeners();

    this._connections.push(this.sshObj);

    this.sshObj = nextHost;

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
        this._removeListeners();
      }
      
      this._systemMsg('debug',`nextPrimaryHost: Load next primary host: ${this.host}`);
      
      this.sshObj = this._hosts.shift();
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
      
      this.emit('msg', `${this.host}: ${this.sshObj.closedMessage}`);
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
    
    return this._stream.close();
  }

  _removeListeners() {
    this._systemMsg('debug',`removeListeners: removing event listeners linked to a host`);
      
    // Initialize tracking object if it doesn't exist yet
    this._boundListeners = this._boundListeners || {};

    
    // Remove host-defined listeners instead of all listeners.
    this._detach('keyboard-interactive', 'onKeyboardInteractive');
    this._detach('stderrData', 'onStderrData');
    this._detach('data', 'onData');
    this._detach('error', 'onError');
    this._detach('end', 'onEnd');
    this._detach('commandProcessing', 'onCommandProcessing');
    this._detach('commandComplete', 'onCommandComplete');
    this._detach('commandTimeout', 'onCommandTimeout');
    this._detach('msg', 'msg');
    
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    if (this.dataReceivedTimer) {
      return clearTimeout(this.dataReceivedTimer);
    }
  }

  _initiate(action) {
    
    this._systemMsg('debug',`Initalise`);
    this._loadDefaults();
    
    if (typeof action === 'function') {
      return action();
    }
  }

  _loadDefaults() {
    this.command = '';
    this._buffer = '';
    this._boundListeners = {};
    this.debug = this.sshObj.debug ?? false;
    this.verbose = this.sshObj.verbose ?? false;
    this.host = this.sshObj.server.host;
    
    if (typeof this.msg === 'function') {
      this.removeListener('msg', this.msg);
      delete this._boundListeners['msg'];
      this.msg = '';
    }    
    if (typeof this.sshObj.msg === 'function') {
      this._boundListener('msg', this.sshObj.msg);
    } else {
      const msg = (message) => {
        console.log(message);
      };
      this._boundListener('msg', msg);
    }
    
    this._systemMsg('debug',`Load Defaults`);
    
    applyHostDefaults(this.sshObj);

    this.idleTime = this.sshObj.idleTimeOut ?? 5000;
    this.dataIdleTime = this.sshObj.dataIdleTime ?? 500;

    // Compile ASCII Filter with Safe Fallback.
    if (!this.asciiFilter) {
      const ascii = compileAsciiFilter(this.sshObj.asciiFilter);
      this.asciiFilter = ascii.filter;
      if (ascii.usedFallback && this.debug) {
        this._systemMsg(
          'debug',
          `loadDefaults: AsciiFilter: incorrect regular expression reverting to default: ${this.sshObj.asciiFilter}`
        );
      }
    }

    // Compile Text Color Filter with Safe Fallback.
    if (!this.textColorFilter) {
      const color = compileTextColorFilter(this.sshObj.textColorFilter);
      this.textColorFilter = color.filter;
      if (color.usedFallback && this.debug) {
        this._systemMsg(
          'debug',
          `loadDefaults: TextColorFilter: incorrect regular expression reverting to default: ${this.sshObj.textColorFilter}`
        );
      }
    }

    // Prompts: fully sanitized at runtime via escapeRegex (never need
    // fallbacks because they are cast as pure literals).
    const prompts = compilePrompts(this.sshObj);
    if (!this.passwordPrompt) {
      this.passwordPrompt = prompts.passwordPrompt;
    }
    if (!this.passphrasePrompt) {
      this.passphrasePrompt = prompts.passphrasePrompt;
    }
    if (!this.standardPrompt) {
      this.standardPrompt = prompts.standardPrompt;
    }

    //listeners defaults for command processing
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
      if ( this.keyboardInteractive === 'function' ){
        this.removeListener('keyboard-interactive', this.keyboardInteractive);
        delete this._boundListeners['keyboard-interactive'];
        this.keyboardInteractive = '';
      }
      this._boundListener('keyboard-interactive', this.sshObj.onKeyboardInteractive);
    }
    if (typeof this.sshObj.onError === 'function') {
      this._boundListener('error', this.sshObj.onError);
      this.on('error', this._boundListeners['error']);
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
            this.emit('error', err, 'Shell', true);
            return;
          }
          this._systemMsg('debug', `connect: Connection.shell`);
          
          this._stream.setEncoding(this.sshObj.streamEncoding);

          this._stream.on('error', (err) => {
            this._systemMsg('debug', `connect: Stream.error`);
            
            this.emit('error', err, 'Stream');
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
      
      this.emit('error', err, 'Connection');
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
        if (!this.hostHash) {
          this.hostHash = this.sshObj.server.hashMethod;
        }
        if (!this.sshObj.server.passphrase) {
          this.sshObj.server.passphrase = this.sshObj.server.passPhrase;
        }
        this.connection.connect(this.sshObj.server);
      } catch (e) {
        this.emit('error', `${e} ${e.stack}`, 'Connection.connect', true);
      }
    } else {
      this.emit(
        'error',
        'Missing connection parameters',
        'Parameters',
        false,
        function (err, type, close) {
          this.emit('msg', this.sshObj.server);
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
SSH2Shell.prototype._sshToNextHost = false;
SSH2Shell.prototype._primaryhostSessionText = '';
SSH2Shell.prototype._allSessions = '';
SSH2Shell.prototype._connections = [];
SSH2Shell.prototype._stream = {};
SSH2Shell.prototype._buffer = '';
SSH2Shell.prototype._boundListeners = [];
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
