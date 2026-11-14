const dotenv = require('dotenv').config();
const { logFile, log } = require('../utils/logging.js');
logFile('timeout.js');

const SSH2Shell = require('../../src/ssh2shell');
const { readPrivateKey } = require('../utils/private_key.js');

// Every data response from the server resets the command timeout timer. A
// command that never returns to a prompt keeps the timer armed; when it fires,
// `commandTimeout` means "no defined prompt was detected in time".
//
// `commandTimeoutRetries` makes the library re-arm the timer for each non-final
// attempt, so the handler only has to react to `details`:
//
//   onCommandTimeout(command, response, stream, connection, details) {
//     if (details.final) return this.close();
//     if (response.includes('(Y,n)')) stream.write('y' + this.sshObj.enter);
//   }
//
// This test answers the first prompt on a non-final attempt, then lets the
// final unhandled prompt reach the final attempt and close the session.

const host = {
  server: {
    host: process.env.HOST,
    port: process.env.PORT,
    userName: process.env.USER_NAME,
    privateKey: readPrivateKey(),
    passPhrase: process.env.KEY_PASSPHRASE,
  },
  commands: [
    'msg:Testing idle time out',
    'read -n 1 -p "First prompt to put valid input (Y,n): " test',
    'read -n 1 -p "Final unhandled time out: " test',
  ],
  // Avoid `#` and `>` because prompt detection can trigger in the wrong place.
  standardPrompt: '$',
  idleTimeOut: 5000,
  commandTimeoutRetries: 1,
  debug: (process.env.DEBUG === 'true'),
  verbose: (process.env.VERBOSE === 'true'),
  onCommandTimeout: function (command, response, stream, connection, details) {
    if (this.sshObj.debug) {
      this.emit(
        'msg',
        `${this.sshObj.server.host}: host.onCommandTimeout attempt ${details.attempt}/${details.maxRetries} final=${details.final}`
      );
    }

    // Answer the first prompt while the library still has retries left.
    if (details.final === false && response.indexOf('(Y,n)') !== -1) {
      if (this.sshObj.debug) {
        this.emit(
          'msg',
          `${this.sshObj.server.host}: First prompt using correct input: Sending 'y' to the \`(y,n):\` prompt`
        );
      }
      this.sshObj.sessionText += response + this.sshObj.enter;
      this._buffer = '';
      stream.write('y' + this.sshObj.enter);
      return;
    }

    // The library re-arms non-final attempts; wait for the final one.
    if (details.final === false) {
      if (this.sshObj.debug) {
        this.emit(
          'msg',
          `${this.sshObj.server.host}: Non-final timeout, waiting for the retry`
        );
      }
      return;
    }

    if (this.sshObj.debug) {
      this.emit(
        'msg',
        `${this.sshObj.server.host}: Final timeout: All attempts completed`
      );
      this.emit(
        'msg',
        `${this.sshObj.server.host}: Timeout details:${this.sshObj.enter}Command: ${command} ${this.sshObj.enter}Response: ${response}`
      );
    }

    // No prompt matched, so record the response and close the connection.
    this.emit(
      'msg',
      `${this.sshObj.server.host}: Command timed out after ${this.idleTime / 1000} seconds`,
      'Command Timeout',
      true
    );
    this.sshObj.sessionText += response + this.sshObj.enter;
    this.close();
  },
  onEnd: function (sessionText, sshObj) {
    if (this.sshObj.debug) {
      this.emit('msg', `${sshObj.server.host}: host.onEnd`);
    }
    this.emit(
      'msg',
      `\nThis is the full session response:\n\n${this.sshObj.sessionText}\n`
    );
  },
};

const SSH = new SSH2Shell(host);

SSH.on('msg', log);

SSH.connect((sessionText) => {
  const text = `-----Callback session text:\n${sessionText}\n-----Callback end`;
  log(text);
  console.log(text);
});
