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
    
    if (typeIsArray(hosts) && hosts.length > 0) {
      this._hosts = hosts;
    } else {
      this._hosts = [hosts];
    }

    this.ssh2Client = require('ssh2').Client;

    // Defined here to support msg events before the host is loaded.
    this.on('msg', (message) => {
      console.log(message);
    });

    this.on('data', (data) => {
      this._onData(data);
    });

    this.on('stderrData', (data) => {
      console.error(data);
    });

    this.on('error', (err, type, close = false, callback) => {
      if (this.sshObj.debug) {
        this.emit('msg', `Class.error: ${err}, ${type}`);
      }
      if (err instanceof Error) {
        this.emit('msg', `Error: ${err.message}, Level: ${err.level}`);
      } else {
        this.emit('msg', `${type} error: ${err}`);
      }

      if (close) {
        this._stream.close();
      }
    });

    if (this._hosts[0].server.tryKeyboard) {
      this.on(
        'keyboard-interactive',
        (name, instructions, instructionsLang, prompts, finish) => {
          if (this.sshObj.debug) {
            this.emit(
              'msg',
              `${this.sshObj.server.host}: Class.keyboard-interactive`
            );
          }
          if (this.sshObj.verbose) {
            this.emit('msg', `name: ${name}`);
            this.emit('msg', `instructions: ${instructions}`);
            const str = JSON.stringify(prompts, null, 4);
            this.emit('msg', `Prompts object: ${str}`);
          }
        }
      );
    }

    this._allSessions = '';
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
          if (this.sshObj.debug) {
            this.emit('msg', `${this.sshObj.server.host}: onData: Sudo command data`);
          }
          return this._processSudoPrompt();
        // Check if ssh authentication needs to be handled.
        case this.sshObj.sshToNextHost &&
          this.command.length > 0 &&
          this.command.indexOf('ssh ') === 0:
          if (this.sshObj.debug) {
            this.emit('msg', `${this.sshObj.server.host}: onData: SSH command data`);
          }
          return this._processSSHPrompt();
        // Check for standard prompt from a command.
        case this.command.length > 0 &&
          this.standardPrompt.test(this._sanitizeResponse()):
          if (this.sshObj.debug) {
            this.emit(
              'msg',
              `${this.sshObj.server.host}: onData: Normal prompt detected`
            );
          }
          this.sshObj.pwSent = false;
          return this._commandComplete();
        // Check for no command but first prompt detected.
        case this.command.length < 1 && this.standardPrompt.test(this._buffer):
          if (this.sshObj.debug) {
            this.emit(
              'msg',
              `${this.sshObj.server.host}: onData: First prompt detected`
            );
          }
          if (this.sshObj.showBanner) {
            this.sshObj.sessionText += this._buffer;
          }
          return this._nextCommand();
        default:
          if (this.sshObj.debug) {
            this.emit('msg', `${this.sshObj.server.host}: onData: Reset timeout`);
          }
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
    if (this.sshObj.debug) {
      this.emit(
        'msg',
        `${this.sshObj.server.host}: processSudoPrompt: Password handling`
      );
    }
    if (this.sshObj.verbose) {
      this.emit(
        'msg',
        `${this.sshObj.server.host}: processSudoPrompt: Password prompt: ${passwordPrompt}, Standard prompt: ${standardPrompt}, Password previously sent: ${this.sshObj.pwSent}`
      );
    }

    // Prompt detection.
    switch (true) {
      // No password.
      case passwordPrompt && !this.sshObj.server.password:
        if (this.sshObj.debug) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: processSudoPrompt: No password set`
          );
        }
        return this._resetFromSudoError();
      case passwordPrompt && !this.sshObj.pwSent:
        if (this.sshObj.debug) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: processSudoPrompt: Send password`
          );
        }               
        if (this.sshObj.verbose) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: processSudoPrompt: Password: ${this.sshObj.server.password}`
          );
        }
        // Send password.
        this.sshObj.pwSent = true;
        return this._runCommand(`${this.sshObj.server.password}`);
      case passwordPrompt && this.sshObj.pwSent:
        if (this.sshObj.debug) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: processSudoPrompt: Failed login`
          );
        }
        if (this.sshObj.debug) {
          this.emit(
            'error',
            `${this.sshObj.server.host}: Password was incorrect for ${this.sshObj.server.userName}`, 
            'Sudo authentication failed'
          );
        }
        if (this.sshObj.verbose) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: processSudoPrompt: Failed login: Response: ${response}`
          );
        }        
        
        this.sshObj.pwSent = false;
        // Add buffer to sessionText so the sudo response can be seen.
        return this._resetFromSudoError();
      case standardPrompt:
        if (this.sshObj.debug) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: processSudoPrompt: Password accepted`
          );
        }
        this.sshObj.pwSent = false;
        if (this.sshObj.verbose) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: processSudoPrompt: Successful response: ${response}`
          );
        }
        return this._commandComplete();
      default:
        if (this.sshObj.debug) {
            this.emit('msg', `${this.sshObj.server.host}: processSudoPrompt: Reset timeout`);
        }
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
    if (this.sshObj.debug) {
      this.emit('msg', `${this.sshObj.server.host}: SSH command: connect`);
    }
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
    
    if (this.sshObj.debug) {
      this.emit(
        'msg',
        `${this.sshObj.server.host}: processSSHPrompt: SSH password handling`
      );
    }
    if (this.sshObj.verbose) {
      this.emit(
        'msg',
        `${this.sshObj.server.host}: processSSHPrompt: Password prompt: ${passwordPrompt}, Passphase prompt: ${passphrasePrompt}, Standard prompt: ${standardPrompt}, Password previously sent: ${this.sshObj.sshAuth}`
      );
    }

    if (!this.sshObj.sshAuth) {
      if (this.sshObj.debug) {
        this.emit(
          'msg',
          `${this.sshObj.server.host}: processSSHPrompt: First prompt detection`
        );
      }

      // Provide password.
      if (passwordPrompt) {
        if (this.sshObj.debug) {
          this.emit('msg', `${this.sshObj.server.host}: processSSHPrompt: send password`);
        }
        this.sshObj.sshAuth = true;
        this._buffer = '';

        return this._runCommand(`${this.sshObj.server.password}`);
      } else if (passphrasePrompt) {
        if (this.sshObj.debug) {
          this.emit('msg', `${this.sshObj.server.host}: processSSHPrompt: send passphrase`);
        }
        this.sshObj.sshAuth = true;
        this._buffer = '';
        return this._runCommand(`${this.sshObj.server.passPhrase}`);
      } else if (standardPrompt) {
        if (this.sshObj.debug) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: processSSHPrompt: standard prompt: connection failed`
          );
        }
        if (this.sshObj.verbose) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: processSSHPrompt: SSH failed: Response: ${response}`
          );
        }
        this.sshObj.sessionText += `${this.sshObj.server.host}: SSH failed: Response: ${response}`;
        return this._runExit();
      } else {
        if (this.sshObj.debug) {
          this.emit('msg', `${this.sshObj.server.host}: processSSHPrompt: No prompt detected`);
        }
        if (this.sshObj.verbose) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: processSSHPrompt: Response: ${response}`
          );
        }
        if (this.sshObj.verbose){
          if (!this.sshObj.server.hasOwnProperty('password')) 
          {
            this.emit(
              'msg',
              `${this.sshObj.server.host}: processSSHPrompt: SSH password prompt: ${this.sshObj.passwordPrompt}`
            );
          }
          if (this.sshObj.server.hasOwnProperty('passPhrase')) 
          {
            this.emit(
              'msg',
              `${this.sshObj.server.host}: processSSHPrompt: SSH passphrase prompt: ${this.sshObj.passphrasePrompt}`
            );
          }
          this.emit(
            'msg',
            `${this.sshObj.server.host}: processSSHPrompt: SSH standard prompt: ${this.sshObj.standardPrompt}`
          );
        }

        return this._runExit();
      }
    } else {
      if (this.sshObj.debug) {
        this.emit(
          'msg',
          `${this.sshObj.server.host}: processSSHPrompt: Post authentication prompt detection`
        );
      }
    
      if (standardPrompt) {
        if (this.sshObj.debug) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: processSSHPrompt: SSH complete: normal prompt`
          );
        }
        if (this.sshObj.showBanner) {
          this.sshObj.sessionText += `\n ${response}`;
        }
        this.sshObj.exitCommands.push('exit');
        this.emit('msg', `${this.sshObj.connectedMessage}`);
        this.emit('msg', `${this.sshObj.readyMessage}`);
        if (this.sshObj.debug) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: processSSHPrompt: next command`
          );
        }
        this.sshObj.sshToNextHost = false;
        return this._nextCommand();
      } else if (passwordPrompt || passphrasePrompt) {
        // Password or passphrase detected a second time after authentication
        // indicates failure.
        this.emit(
          'msg',
          `${this.sshObj.server.host}: SSH authentication failed`
        );
        if (this.sshObj.debug) {
          this.emit('msg', `${this.sshObj.server.host}: processSSHPrompt: Authentication failed`);
        }
        if (this.sshObj.verbose) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: processSSHPrompt: failed response: ${response}`
          );
        }
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
          `${this.sshObj.server.host}: SSH authentication failed for ${this.sshObj.server.userName}@${this.sshObj.server.host}`,
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
        if (this.sshObj.debug) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: processNotifications: sessionText output`
          );
        }
        if (this._connections.length > 0) {
          this.sshObj.sessionText += `${this.sshObj.server.host}: Note: ${sessionNote[1]}${this.sshObj.enter}`;
        } else {
          this.sshObj.sessionText += `Note: ${sessionNote[1]}${this.sshObj.enter}`;
        }
        if (this.sshObj.verbose) {
          this.emit('msg', sessionNote[1]);
        }
        return this._nextCommand();
      }

      // This is a message to output in process.
      const msgNote = this.command.match(/^msg:(.*)$/);
      if (msgNote) {
        if (this.sshObj.debug) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: processNotifications: msg to output`
          );
        }
        this.emit('msg', `${this.sshObj.server.host}: Note: ${msgNote[1]}`);
        return this._nextCommand();
      }

      if (this.sshObj.debug) {
        this.emit(
          'msg',
          `${this.sshObj.server.host}: processNotifications: Normal Command to run`
        );
      }
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
      if (this.sshObj.debug) {
        this.emit(
          'msg',
          `${this.sshObj.server.host}: commandComplete: Raising commandComplete event`
        );
      }      
      if (this.sshObj.verbose) {
        this.emit(
          'msg',
          `${this.sshObj.server.host}: commandComplete:\nCommand:\n ${this.command}\nResponse: ${response}`
        );
      }
      this.sshObj.sessionText += response;
      
      this.emit('commandComplete', this.command, this._buffer, this.sshObj);
    }
    return this._nextCommand();
  }

  _nextCommand() {
    this._buffer = '';
    // Process the next command if there are any.
    if (this.sshObj.commands.length > 0) {
      if (this.sshObj.debug) {
        this.emit('msg', `${this.sshObj.server.host}: nextCommand: Setting next command`);
      }
      
      if (this.sshObj.verbose) {
        this.emit(
          'msg',
          `${this.sshObj.server.host}: nextCommand: Host commands: ${this.sshObj.commands}`
        );
      }
      
      this.command = this.sshObj.commands.shift();
      if (this.sshObj.verbose) {
        this.emit(
          'msg',
          `${this.sshObj.server.host}: nextCommand: Next command: ${this.command}`
        );
      }
      return this._processNotifications();
    }

    if (this.sshObj.debug) {
      this.emit('msg', `${this.sshObj.server.host}: nextCommand: No commands so exit`);
    }
    // No more commands so exit.
    return this._runExit();
  }

  _checkCommand() {
    // If there is still a command to run then run it or exit.
    if (this.command !== '') {
      return this._runCommand(this.command);
    }

    // No more commands so exit.
    if (this.sshObj.debug) {
      this.emit('msg', `${this.sshObj.server.host}: checkCommand: No command so exit`);
    }
    return this._runExit();
  }

  _runCommand(command) {
    if (this.sshObj.debug) {
      this.emit('msg', `${this.sshObj.server.host}: runCommand:`);
    }
    if (this.sshObj.verbose) {
      this.emit('msg', `${this.sshObj.server.host}: runCommand: Command: ${command}`);
    }
    
    return this._stream.write(`${command}${this.sshObj.enter}`);
  }

  _previousHost() {
    if (this.sshObj.debug) {
      this.emit('msg', `${this.sshObj.server.host}: previousHost: raise end event on current connection: ${this.sshObj.server.host}`);
    }
    this.emit(
      'end',
      `${this.sshObj.server.host}: \n${this.sshObj.sessionText}`,
      this.sshObj
    );
    if (this.sshObj.debug) {
      this.emit(
        'msg',
        `${this.sshObj.server.host}: previousHost: Check for previous connections and reload its configuration if one exists`
      );
    }

    if (this._connections.length > 0) {
      this.sshObj = this._connections.pop();
      if (this.sshObj.debug) {
        this.emit('msg', `${this.sshObj.server.host}: previousHost: previous host loaded: ${this.sshObj.server.host} `);
      }
    }

    return this._runExit();
  }

  _nextHost() {
    const nextHost = this.sshObj.hosts.shift();
    if (this.sshObj.debug) {
      this.emit(
        'msg',
        `${this.sshObj.server.host}: nextHost: load ${nextHost.server.host} config, prepare and start SSH connection`
      );
    }
    this._removeListeners();

    this._connections.push(this.sshObj);

    this.sshObj = nextHost;

    return this._initiate(this._sshConnect);
  }

  _nextPrimaryHost(connect) {
    if (this._hosts.length > 0) {
      if (this.sshObj.debug) {
          this.emit('msg', `${this.sshObj.server.host}: nextPrimaryHost: load next host for ssh2 connection`);
      }
      // Check this is not loading the first primary host before removing
      // listeners.
      if (this.sshObj.server) {
        if (this.sshObj.debug) {
          this.emit('msg', `${this.sshObj.server.host}: nextPrimaryHost: end current host ${this.sshObj.server.host}`);
        }
        this.emit('end', this._primaryhostSessionText, this.sshObj);
        this._removeListeners();
      }
      
      if (this.sshObj.debug) {
        this.emit('msg', `${this.sshObj.server.host}: nextPrimaryHost: Load next primary host: ${this.sshObj.server.host}`);
      }
      this.sshObj = this._hosts.shift();
      this._primaryhostSessionText = `${this.sshObj.server.host}: `;

      return this._initiate(connect);
    }
  }

  _runExit() {
    if (this.sshObj.debug) {
      this.emit('msg', `${this.sshObj.server.host}: runExit: Process an exit`);
    }
    // Run the exit commands loaded by ssh and sudo su commands.
    if (this.sshObj.exitCommands && this.sshObj.exitCommands.length > 0) {
      if (this.sshObj.verbose) {
        this.emit(
          'msg',
          `${this.sshObj.server.host}: runExit: Queued exit commands: ${this.sshObj.exitCommands.length}`
        );
      }
      this.command = this.sshObj.exitCommands.pop();
      if (this._connections && this._connections.length > 0) {
        if (this.sshObj.verbose) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: runExit: Primary host: ${this._connections[0].server.host}`
          );
        }
        this._connections[0].sessionText += `\n${this.sshObj.server.host}: ${this.sshObj.sessionText}`;
      }
      return this._runCommand(this.command);
    } else if (this.sshObj.hosts && this.sshObj.hosts.length > 0) {
      // More hosts to connect to so process the next one.
      if (this.sshObj.debug) {
        this.emit('msg', `${this.sshObj.server.host}: runExit: Load next host`);
      }
      return this._nextHost();
    } else if (this._connections && this._connections.length > 0) {
      // Leaving last host so load previous host.
      if (this.sshObj.debug) {
        this.emit('msg', `${this.sshObj.server.host}: runExit: load previous host`);
      }
      this.emit('msg', `${this.sshObj.server.host}: ${this.sshObj.closedMessage}`);
      return this._previousHost();
    } else if (this.command === 'exit') {
      if (this.sshObj.debug) {
        this.emit('msg', `${this.sshObj.server.host}: runExit: run exit command`);
      }
      return this._runCommand('exit');
      // Nothing more to do so end the stream with last exit.
    } else {
      return this.close();
    }
  }

  close() {
    if (this.sshObj.debug) {
      this.emit('msg', `${this.sshObj.server.host}: Stream: close`);
    }
    return this._stream.close();
  }

  _removeListeners() {
    if (this.sshObj.debug) {
        this.emit('msg', `${this.sshObj.server.host}: removeListeners: removing event listeners linked to a host`);
      }
    // Initialize tracking object if it doesn't exist yet
    this._boundListeners = this._boundListeners || {};

    // Helper to safely detach listeners using cached references
    const detach = (eventName, currentKey) => {
      const targetHandler = this._boundListeners[eventName] || this.sshObj[currentKey];
      if (typeof targetHandler === 'function') {
        this.removeListener(eventName, targetHandler);
        delete this._boundListeners[eventName]; // clear cache
      }
    };
    // Remove host-defined listeners instead of all listeners.
    detach('keyboard-interactive', 'onKeyboardInteractive');
    detach('stderrData', 'onStderrData');
    detach('data', 'onData');
    detach('error', 'onError');
    detach('end', 'onEnd');
    detach('commandProcessing', 'onCommandProcessing');
    detach('commandComplete', 'onCommandComplete');
    detach('commandTimeout', 'onCommandTimeout');
    detach('msg', 'msg');
    
    
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    if (this.dataReceivedTimer) {
      return clearTimeout(this.dataReceivedTimer);
    }
  }

  _initiate(action) {
    if (this.sshObj.debug) {
      this.emit('msg', `${this.sshObj.server.host}: initiate`);
    }

    this._loadDefaults();
    // Event handlers.

    if (typeof action === 'function') {
      return action();
    }
  }

  _loadDefaults() {
    this.command = '';
    this._buffer = '';
    this._boundListeners = {};

    if (typeof this.sshObj.msg === 'function') {
      this._boundListeners['msg'] = this.sshObj.msg;
      this.on('msg', this._boundListeners['msg']);
    }
    
    if (this.sshObj.debug) {
      this.emit('msg', `${this.sshObj.server.host}: Load Defaults`);
    }
    
    applyHostDefaults(this.sshObj);

    this.idleTime = this.sshObj.idleTimeOut ?? 5000;
    this.dataIdleTime = this.sshObj.dataIdleTime ?? 500;

    // Compile ASCII Filter with Safe Fallback.
    if (!this.asciiFilter) {
      const ascii = compileAsciiFilter(this.sshObj.asciiFilter);
      this.asciiFilter = ascii.filter;
      if (ascii.usedFallback && this.sshObj.debug) {
        this.emit(
          'msg',
          `${this.sshObj.server.host}: loadDefaults: AsciiFilter: incorrect regular expression reverting to default: ${this.sshObj.asciiFilter}`
        );
      }
    }

    // Compile Text Color Filter with Safe Fallback.
    if (!this.textColorFilter) {
      const color = compileTextColorFilter(this.sshObj.textColorFilter);
      this.textColorFilter = color.filter;
      if (color.usedFallback && this.sshObj.debug) {
        this.emit(
          'msg',
          `${this.sshObj.server.host}: loadDefaults: TextColorFilter: incorrect regular expression reverting to default: ${this.sshObj.textColorFilter}`
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

    this.sshObj.onCommandProcessing =
      this.sshObj.onCommandProcessing ??
      ((command, response, sshObj, stream) => {});
    
    this.sshObj.onCommandComplete =
      this.sshObj.onCommandComplete ??
      ((command, response, sshObj) => {
        if (this.sshObj.debug) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: onCommandComplete:`
          );
        }
      });

    this.sshObj.onCommandTimeout =
      this.sshObj.onCommandTimeout ??
      ((command, response, stream, connection) => {
        response = response.replace(this.command, '');
        if (this.sshObj.debug) {
          this.emit('msg', `${this.sshObj.server.host}: loadDefaults: Class.commandTimeout`);
        }
        if (this.sshObj.verbose) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: loadDefaults: Timeout command: ${command} response: ${response}`
          );
        }

        this.emit(
          'error',
          `${this.sshObj.server.host}: Command timed out after ${this.idleTime / 1000} seconds`,
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
      this._boundListeners['keyboard-interactive'] = this.sshObj.onKeyboardInteractive;
      this.on('keyboard-interactive', this._boundListeners['keyboard-interactive']);
    }
    if (typeof this.sshObj.onError === 'function') {
      this._boundListeners['error'] = this.sshObj.onError;
      this.on('error', this._boundListeners['error']);
    }
    if (typeof this.sshObj.onData === 'function') {
      this._boundListeners['data'] = this.sshObj.onData;
      this.on('data', this._boundListeners['data']);
    }
    if (typeof this.sshObj.onStderrData === 'function') {
      this._boundListeners['stderrData'] = this.sshObj.onStderrData;
      this.on('stderrData', this._boundListeners['stderrData']);
    }

    this._boundListeners['commandProcessing'] = this.sshObj.onCommandProcessing;
    this.on('commandProcessing', this._boundListeners['commandProcessing']);

    this._boundListeners['commandComplete'] = this.sshObj.onCommandComplete;
    this.on('commandComplete', this._boundListeners['commandComplete']);

    this._boundListeners['commandTimeout'] = this.sshObj.onCommandTimeout;
    this.on('commandTimeout', this._boundListeners['commandTimeout']);

    if (typeof this.sshObj.onEnd === 'function') {
      this._boundListeners['end'] = this.sshObj.onEnd;
      this.on('end', this._boundListeners['end']);
    }

    if (this.sshObj.debug) {
      this.emit('msg', `${this.sshObj.server.host}: loadDefaults: Host loaded`);
    }
    if (this.sshObj.verbose) {
      return this.emit('msg', this.sshObj);
    }
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
        if (this.sshObj.debug) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: Connection.keyboard-interactive`
          );
        }
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
      if (this.sshObj.debug) {
        this.emit('msg', `${this.sshObj.server.host}: connect: Connection.connect`);
      }
      this.emit('msg', this.sshObj.connectedMessage);
    });

    this.connection.on('ready', () => {
      if (this.sshObj.debug) {
        this.emit('msg', `${this.sshObj.server.host}: connect: Connection.ready`);
      }
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
          if (this.sshObj.debug) {
            this.emit('msg', `${this.sshObj.server.host}: connect: Connection.shell`);
          }
          this._stream.setEncoding(this.sshObj.streamEncoding);

          this._stream.on('error', (err) => {
            if (this.sshObj.debug) {
              this.emit('msg', `${this.sshObj.server.host}: connect: Stream.error`);
            }
            this.emit('error', err, 'Stream');
          });

          this._stream.stderr.on('data', (data) => {
            if (this.sshObj.debug) {
              this.emit(
                'msg',
                `${this.sshObj.server.host}: connect: Stream.stderr.data`
              );
            }
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
            if (this.sshObj.debug) {
              this.emit('msg', `${this.sshObj.server.host}: connect: Stream.finish`);
            }

            this._primaryhostSessionText += `${this.sshObj.sessionText}\n`;
            this._allSessions += this._primaryhostSessionText;
            if (this._hosts.length === 0) {
              this.emit('end', this._allSessions, this.sshObj);
            }
          });

          this._stream.on('close', (code, signal) => {
            if (this.sshObj.debug) {
              this.emit('msg', `${this.sshObj.server.host}: connect: Stream.close`);
            }
            this.connection.end();
          });
        }
      );
    });

    this.connection.on('error', (err) => {
      if (this.sshObj.debug) {
        this.emit('msg', `${this.sshObj.server.host}: connect: Connection.error`);
      }
      this.emit('error', err, 'Connection');
    });

    this.connection.on('close', (had_error) => {
      if (this.sshObj.debug) {
        this.emit('msg', `${this.sshObj.server.host}: connect: Connection.close`);
      }
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
