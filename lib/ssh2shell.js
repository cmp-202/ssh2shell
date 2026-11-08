// ssh2shell
// A wrapper class for ssh2 to run multiple sequential commands in an SSH shell
// session, handle command responses, and tunnel through to other hosts using
// nested host objects.
//
// The class is the public facade. Pure default application, prompt/filter
// compilation, and nested-SSH command construction live in ./ssh2shell/*.
// Behavior is intentionally identical to the baseline (refactor/L1).

const Stream = require('stream');

const { typeIsArray } = require('./ssh2shell/util');
const { applyHostDefaults } = require('./ssh2shell/defaults');
const {
  compileAsciiFilter,
  compileTextColorFilter,
  compilePrompts,
} = require('./ssh2shell/util');
const { buildSshCommand } = require('./ssh2shell/ssh-command');

class SSH2Shell extends Stream {
  constructor(hosts) {
    super(hosts);

    // CoffeeScript fat-arrow methods are bound in the constructor. Keep the
    // same list and order so callbacks and event listeners keep their `this`.
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
    this._processPasswordPrompt = this._processPasswordPrompt.bind(this);
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

    // Kept exactly as in the baseline: the listener name is misspelled.
    this.on('newPrimmaryHost', this._nextPrimaryHost);

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
            this.emit('msg', `${this.sshObj.server.host}: Sudo command data`);
          }
          return this._processPasswordPrompt();
        // Check if ssh authentication needs to be handled.
        case this.sshObj.sshToNextHost &&
          this.command.length > 0 &&
          this.command.indexOf('ssh ') === 0:
          if (this.sshObj.debug) {
            this.emit('msg', `${this.sshObj.server.host}: SSH command data`);
          }
          return this._processSSHPrompt();
        // Check for standard prompt from a command.
        case this.command.length > 0 &&
          this.standardPrompt.test(this._sanitizeResponse()):
          if (this.sshObj.debug) {
            this.emit(
              'msg',
              `${this.sshObj.server.host}: Normal prompt detected`
            );
          }
          this.sshObj.pwSent = false;
          return this._commandComplete();
        // Check for no command but first prompt detected.
        case this.command.length < 1 && this.standardPrompt.test(this._buffer):
          if (this.sshObj.debug) {
            this.emit(
              'msg',
              `${this.sshObj.server.host}: First prompt detected`
            );
          }
          if (this.sshObj.showBanner) {
            this.sshObj.sessionText += this._buffer;
          }
          return this._nextCommand();
        default:
          if (this.sshObj.debug) {
            this.emit('msg', 'Data processing: data received timeout');
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
    return this._buffer.replace(this.command.substr(0, this._buffer.length), '');
  }

  _processPasswordPrompt() {
    const response = this._sanitizeResponse().trim();
    const passwordPrompt = this.passwordPrompt.test(response);
    const standardPrompt = this.standardPrompt.test(response);
    if (this.sshObj.debug) {
      this.emit(
        'msg',
        `${this.sshObj.server.host}: Sudo Password prompt detected: ${passwordPrompt}`
      );
    }
    if (this.sshObj.debug) {
      this.emit(
        'msg',
        `${this.sshObj.server.host}: Sudo Password prompt: Password sent: ${this.sshObj.pwSent}`
      );
    }
    if (this.sshObj.debug) {
      this.emit(
        'msg',
        `${this.sshObj.server.host}: Sudo Password: ${this.sshObj.server.password}`
      );
    }
    if (this.sshObj.verbose) {
      this.emit(
        'msg',
        `${this.sshObj.server.host}: Sudo Response: ${response}`
      );
    }

    // Prompt detection.
    switch (true) {
      // No password.
      case passwordPrompt && !this.sshObj.server.password:
        if (this.sshObj.debug) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: Sudo password prompt no password set`
          );
        }
        return this._resetFromSudoError();
      case passwordPrompt && !this.sshObj.pwSent:
        if (this.sshObj.verbose) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: Sudo password prompt: Buffer: ${response}`
          );
        }
        if (this.sshObj.debug) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: Sudo password prompt: Send password `
          );
        }
        if (this.sshObj.verbose) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: Sudo sent password: ${this.sshObj.server.password}`
          );
        }
        // Send password.
        this.sshObj.pwSent = true;
        return this._runCommand(`${this.sshObj.server.password}`);
      case passwordPrompt && this.sshObj.pwSent:
        if (this.sshObj.verbose) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: Sudo password faied: response: ${response}`
          );
        }
        if (this.sshObj.debug) {
          this.emit(
            'error',
            `${this.sshObj.server.host}: Sudo password was incorrect for ${this.sshObj.server.userName}, Sudo authentication`
          );
        }
        if (this.sshObj.debug) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: Sudo failed password prompt: Password: [${this.sshObj.server.password}]`
          );
        }
        this.sshObj.pwSent = false;
        // Add buffer to sessionText so the sudo response can be seen.
        return this._resetFromSudoError();
      case standardPrompt:
        if (this.sshObj.debug) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: Sudo password accepted`
          );
        }
        this.sshObj.pwSent = false;
        if (this.sshObj.verbose) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: Sudo Standard Response: ${response}`
          );
        }
        return this._commandComplete();
      default:
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

    if (this.sshObj.verbose) {
      this.emit(
        'msg',
        `${this.sshObj.server.host}: SSH: Password previously sent: ${this.sshObj.sshAuth}`
      );
    }

    if (!this.sshObj.sshAuth) {
      if (this.sshObj.debug) {
        this.emit(
          'msg',
          `${this.sshObj.server.host}: First SSH prompt detection`
        );
      }

      // Provide password.
      if (passwordPrompt) {
        if (this.sshObj.debug) {
          this.emit('msg', `${this.sshObj.server.host}: SSH send password`);
        }
        this.sshObj.sshAuth = true;
        this._buffer = '';

        return this._runCommand(`${this.sshObj.server.password}`);
      } else if (passphrasePrompt) {
        if (this.sshObj.debug) {
          this.emit('msg', `${this.sshObj.server.host}: SSH send passphrase`);
        }
        this.sshObj.sshAuth = true;
        this._buffer = '';
        return this._runCommand(`${this.sshObj.server.passPhrase}`);
      } else if (standardPrompt) {
        if (this.sshObj.debug) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: SSH standard prompt: connection failed`
          );
        }
        this.emit('msg', `${this.sshObj.server.host}: SSH connection failed`);
        this.emit(
          'msg',
          `${this.sshObj.server.host}: SSH failed response: ${response}`
        );
        this.sshObj.sessionText += `${this.sshObj.server.host}: SSH failed: response: ${response}`;
        return this._runExit();
      } else {
        this.emit('msg', `${this.sshObj.server.host}: SSH no prompt was not detected`);
        if (this.sshObj.verbose) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: SSH response: ${response}`
          );
        }
        if (
          this.sshObj.verbose &&
          !this.sshObj.server.hasOwnProperty('password')
        ) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: SSH password prompt: ${this.sshObj.passwordPrompt}`
          );
        }
        if (
          this.sshObj.verbose &&
          this.sshObj.server.hasOwnProperty('passPhrase')
        ) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: SSH passphrase prompt: ${this.sshObj.passphrasePrompt}`
          );
        }
        if (this.sshObj.verbose) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: SSH standard prompt: ${this.sshObj.standardPrompt}`
          );
        }
        return this._runExit();
      }
    } else {
      if (this.sshObj.debug) {
        this.emit(
          'msg',
          `${this.sshObj.server.host}: SSH post authentication prompt detection`
        );
      }

      if (standardPrompt) {
        if (this.sshObj.debug) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: SSH complete: normal prompt`
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
            `${this.sshObj.server.host}: SSH complete: next command`
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
          this.emit('msg', `${this.sshObj.server.host}: SSH auth failed`);
        }
        if (this.sshObj.verbose) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: SSH: failed response: ${response}`
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
          'Nested host authentication'
        );
        if (this.sshObj.debug) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: SSH auth failed: Using ` + using
          );
        }

        // No connection so drop back to first host settings if there was one.
        if (this.sshObj.verbose) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: SSH response: ${response}`
          );
        }
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
            `${this.sshObj.server.host}: Notifications: sessionText output`
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
            `${this.sshObj.server.host}: Notifications: msg to output`
          );
        }
        this.emit('msg', `${this.sshObj.server.host}: Note: ${msgNote[1]}`);
        return this._nextCommand();
      }

      if (this.sshObj.debug) {
        this.emit(
          'msg',
          `${this.sshObj.server.host}: Notifications: Normal Command to run`
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
      if (this.sshObj.verbose) {
        this.emit(
          'msg',
          `${this.sshObj.server.host}: Command complete:\nCommand:\n ${this.command}\nResponse: ${response}`
        );
      }
      this.sshObj.sessionText += response;
      if (this.sshObj.debug) {
        this.emit(
          'msg',
          `${this.sshObj.server.host}: Raising commandComplete event`
        );
      }
      this.emit('commandComplete', this.command, this._buffer, this.sshObj);
    }
    return this._nextCommand();
  }

  _nextCommand() {
    this._buffer = '';
    // Process the next command if there are any.
    if (this.sshObj.commands.length > 0) {
      if (this.sshObj.verbose) {
        this.emit(
          'msg',
          `${this.sshObj.server.host}: Host.commands: ${this.sshObj.commands}`
        );
      }
      this.command = this.sshObj.commands.shift();
      if (this.sshObj.verbose) {
        this.emit(
          'msg',
          `${this.sshObj.server.host}: Next command from host.commands: ${this.command}`
        );
      }
      return this._processNotifications();
    }

    if (this.sshObj.debug) {
      this.emit('msg', `${this.sshObj.server.host}: No commands so exit`);
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
      this.emit('msg', `${this.sshObj.server.host}: No command so exit`);
    }
    return this._runExit();
  }

  _runCommand(command) {
    if (this.sshObj.verbose) {
      this.emit('msg', `${this.sshObj.server.host}: sending: ${command}`);
    }
    if (this.sshObj.debug) {
      this.emit('msg', `${this.sshObj.server.host}: run command`);
    }
    return this._stream.write(`${command}${this.sshObj.enter}`);
  }

  _previousHost() {
    if (this.sshObj.debug) {
      this.emit('msg', `${this.sshObj.server.host}: Load previous host config`);
    }
    this.emit(
      'end',
      `${this.sshObj.server.host}: \n${this.sshObj.sessionText}`,
      this.sshObj
    );
    if (this.sshObj.debug) {
      this.emit(
        'msg',
        `${this.sshObj.server.host}: Previous hosts: ${this._connections.length}`
      );
    }

    if (this._connections.length > 0) {
      this.sshObj = this._connections.pop();
      if (this.sshObj.debug) {
        this.emit('msg', `${this.sshObj.server.host}: Reload previous host`);
      }
      return this._runExit();
    }

    return this._runExit();
  }

  _nextHost() {
    const nextHost = this.sshObj.hosts.shift();
    if (this.sshObj.debug) {
      this.emit('msg', `${this.sshObj.server.host}: SSH to ${nextHost.server.host}`);
    }
    if (this.sshObj.debug) {
      this.emit(
        'msg',
        `${this.sshObj.server.host}: Clearing previous event handlers`
      );
    }
    if (this.sshObj.debug) {
      this.emit(
        'msg',
        `${this.sshObj.server.host}: Remove previous event handlers`
      );
    }
    this._removeListeners();

    this._connections.push(this.sshObj);

    this.sshObj = nextHost;

    return this._initiate(this._sshConnect);
  }

  _nextPrimaryHost(connect) {
    if (this._hosts.length > 0) {
      // Check this is not loading the first primary host before removing
      // listeners.
      if (this.sshObj.server) {
        if (this.sshObj.debug) {
          this.emit('msg', `${this.sshObj.server.host}: Current primary host`);
        }
        if (this.sshObj.debug) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: Remove previous event handlers`
          );
        }
        this.emit('end', this._primaryhostSessionText, this.sshObj);
        this._removeListeners();
      }
      this.sshObj = this._hosts.shift();
      this._primaryhostSessionText = `${this.sshObj.server.host}: `;

      if (this.sshObj.debug) {
        this.emit('msg', `${this.sshObj.server.host}: Next primary host`);
      }

      return this._initiate(connect);
    }

    if (this.sshObj.debug) {
      this.emit('msg', `${this.sshObj.server.host}: No more primary hosts`);
    }
    // Preserved from the baseline: this is a reference, not a call.
    return this._runExit;
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
  _runExit() {
    if (this.sshObj.debug) {
      this.emit('msg', `${this.sshObj.server.host}: Process an exit`);
    }
    // Run the exit commands loaded by ssh and sudo su commands.
    if (this.sshObj.exitCommands && this.sshObj.exitCommands.length > 0) {
      if (this.sshObj.debug) {
        this.emit(
          'msg',
          `${this.sshObj.server.host}: Queued exit commands: ${this.sshObj.exitCommands.length}`
        );
      }
      this.command = this.sshObj.exitCommands.pop();
      if (this._connections && this._connections.length > 0) {
        if (this.sshObj.verbose) {
          this.emit(
            'msg',
            `${this.sshObj.server.host}: Primary host: ${this._connections[0].server.host}`
          );
        }
        this._connections[0].sessionText += `\n${this.sshObj.server.host}: ${this.sshObj.sessionText}`;
      }
      return this._runCommand(this.command);
    } else if (this.sshObj.hosts && this.sshObj.hosts.length > 0) {
      // More hosts to connect to so process the next one.
      if (this.sshObj.debug) {
        this.emit('msg', `${this.sshObj.server.host}: Next host from this host`);
      }
      return this._nextHost();
    } else if (this._connections && this._connections.length > 0) {
      // Leaving last host so load previous host.
      if (this.sshObj.debug) {
        this.emit('msg', `${this.sshObj.server.host}: load previous host`);
      }
      this.emit('msg', `${this.sshObj.server.host}: ${this.sshObj.closedMessage}`);
      return this._previousHost();
    } else if (this.command === 'exit') {
      if (this.sshObj.debug) {
        this.emit('msg', `${this.sshObj.server.host}: Manual exit command`);
      }
      return this._runCommand('exit');
      // Nothing more to do so end the stream with last exit.
    } else {
      return this.close();
    }
  }

  close() {
    if (this.sshObj.debug) {
      this.emit('msg', `${this.sshObj.server.host}: Exit command: Stream: close`);
    }
    return this._stream.close();
  }

  _removeListeners() {
    // Remove host-defined listeners instead of all listeners.
    if (typeof this.sshObj.onKeyboardInteractive === 'function') {
      this.removeListener(
        'keyboard-interactive',
        this.sshObj.onKeyboardInteractive
      );
    }
    if (typeof this.sshObj.onStderrData === 'function') {
      this.removeListener('stderrData', this.sshObj.onStderrData);
    }
    if (typeof this.sshObj.onData === 'function') {
      this.removeListener('data', this.sshObj.onData);
    }
    if (typeof this.sshObj.onError === 'function') {
      this.removeListener('error', this.sshObj.onError);
    }
    // Preserved from the baseline: stderrData is removed twice.
    if (typeof this.sshObj.onStderrData === 'function') {
      this.removeListener('stderrData', this.sshObj.onStderrData);
    }
    if (typeof this.sshObj.onEnd === 'function') {
      this.removeListener('end', this.sshObj.onEnd);
    }
    if (typeof this.sshObj.onCommandProcessing === 'function') {
      this.removeListener(
        'commandProcessing',
        this.sshObj.onCommandProcessing
      );
    }
    if (typeof this.sshObj.onCommandComplete === 'function') {
      this.removeListener('commandComplete', this.sshObj.onCommandComplete);
    }
    if (typeof this.sshObj.onCommandTimeout === 'function') {
      this.removeListener('commandTimeout', this.sshObj.onCommandTimeout);
    }
    if (typeof this.sshObj.msg === 'function') {
      this.removeListener('msg', this.sshObj.msg);
    }

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
    // Old hubot leftovers.
    if (
      this.sshObj.msg &&
      this.sshObj.msg.send &&
      typeof this.sshObj.msg.send === 'function'
    ) {
      this.sshObj.msg = this.sshObj.msg.send;
    }

    if (this.listenerCount('msg') > 0) {
      this.removeAllListeners('msg');
    }

    if (typeof this.sshObj.msg === 'function') {
      this.on('msg', this.sshObj.msg);
    } else {
      this.on('msg', (message) => {
        console.log(message);
      });
    }

    if (this.sshObj.debug) {
      this.emit('msg', `${this.sshObj.server.host}: Load Defaults`);
    }
    this.command = '';
    this._buffer = '';
    applyHostDefaults(this.sshObj);

    this.idleTime =
      this.sshObj.idleTimeOut != null ? this.sshObj.idleTimeOut : 5000;
    this.dataIdleTime =
      this.sshObj.dataIdleTime != null ? this.sshObj.dataIdleTime : 500;

    // Compile ASCII Filter with Safe Fallback.
    if (!this.asciiFilter) {
      const ascii = compileAsciiFilter(this.sshObj.asciiFilter);
      this.asciiFilter = ascii.filter;
      if (ascii.usedFallback && this.sshObj.debug) {
        this.emit(
          'msg',
          `${this.sshObj.server.host}: AsciiFilter: incorrect regular expression reverting to default: ${this.sshObj.asciiFilter}`
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
          `${this.sshObj.server.host}: TextColorFilter: incorrect regular expression reverting to default: ${this.sshObj.textColorFilter}`
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
      this.sshObj.onCommandProcessing != null
        ? this.sshObj.onCommandProcessing
        : (command, response, sshObj, stream) => {};

    this.sshObj.onCommandComplete =
      this.sshObj.onCommandComplete != null
        ? this.sshObj.onCommandComplete
        : (command, response, sshObj) => {
            if (this.sshObj.debug) {
              this.emit(
                'msg',
                `${this.sshObj.server.host}: Class.commandComplete`
              );
            }
          };

    this.sshObj.onCommandTimeout =
      this.sshObj.onCommandTimeout != null
        ? this.sshObj.onCommandTimeout
        : (command, response, stream, connection) => {
            response = response.replace(this.command, '');
            if (this.sshObj.debug) {
              this.emit(
                'msg',
                `${this.sshObj.server.host}: Class.commandTimeout`
              );
            }
            if (this.sshObj.verbose) {
              this.emit(
                'msg',
                `${this.sshObj.server.host}: Timeout command: ${command} response: ${response}`
              );
            }

            this.emit(
              'error',
              `${this.sshObj.server.host}: Command timed out after ${this.idleTime / 1000} seconds`,
              'Timeout',
              true,
              (err, type) => {
                this.sshObj.sessionText += this._buffer;
                this._buffer = '';
              }
            );
          };

    if (typeof this.sshObj.onKeyboardInteractive === 'function') {
      this.on('keyboard-interactive', this.sshObj.onKeyboardInteractive);
    }
    if (typeof this.sshObj.onError === 'function') {
      this.on('error', this.sshObj.onError);
    }
    if (typeof this.sshObj.onData === 'function') {
      this.on('data', this.sshObj.onData);
    }
    if (typeof this.sshObj.onStderrData === 'function') {
      this.on('stderrData', this.sshObj.onStderrData);
    }
    this.on('commandProcessing', this.sshObj.onCommandProcessing);
    this.on('commandComplete', this.sshObj.onCommandComplete);
    this.on('commandTimeout', this.sshObj.onCommandTimeout);
    if (typeof this.sshObj.onEnd === 'function') {
      this.on('end', this.sshObj.onEnd);
    }

    if (this.sshObj.debug) {
      this.emit('msg', `${this.sshObj.server.host}: Host loaded`);
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
        this.emit('msg', `${this.sshObj.server.host}: Connection.connect`);
      }
      this.emit('msg', this.sshObj.connectedMessage);
    });

    this.connection.on('ready', () => {
      if (this.sshObj.debug) {
        this.emit('msg', `${this.sshObj.server.host}: Connection.ready`);
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
            this.emit('msg', `${this.sshObj.server.host}: Connection.shell`);
          }
          this._stream.setEncoding(this.sshObj.streamEncoding);

          this._stream.on('error', (err) => {
            if (this.sshObj.debug) {
              this.emit('msg', `${this.sshObj.server.host}: Stream.error`);
            }
            this.emit('error', err, 'Stream');
          });

          this._stream.stderr.on('data', (data) => {
            if (this.sshObj.debug) {
              this.emit(
                'msg',
                `${this.sshObj.server.host}: Stream.stderr.data`
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
              this.emit('error', err, 'Stream.read', true);
            }
          });

          this._stream.on('finish', () => {
            if (this.sshObj.debug) {
              this.emit('msg', `${this.sshObj.server.host}: Stream.finish`);
            }

            this._primaryhostSessionText += `${this.sshObj.sessionText}\n`;
            this._allSessions += this._primaryhostSessionText;
            if (this._hosts.length === 0) {
              this.emit('end', this._allSessions, this.sshObj);
            }
          });

          this._stream.on('close', (code, signal) => {
            if (this.sshObj.debug) {
              this.emit('msg', `${this.sshObj.server.host}: Stream.close`);
            }
            this.connection.end();
          });
        }
      );
    });

    this.connection.on('error', (err) => {
      if (this.sshObj.debug) {
        this.emit('msg', `${this.sshObj.server.host}: Connection.error`);
      }
      this.emit('error', err, 'Connection');
    });

    this.connection.on('close', (had_error) => {
      if (this.sshObj.debug) {
        this.emit('msg', `${this.sshObj.server.host}: Connection.close`);
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
          this._removeListeners();
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
