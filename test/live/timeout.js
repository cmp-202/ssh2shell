const dotenv = require('dotenv').config();
const { logFile, log } = require('../utils/logging.js');
logFile('timeout.js');

const SSH2Shell = require('../utils/module.js');
const { readPrivateKey } = require('../utils/private_key.js');

// The command idle timer is armed when a command is written and reset by each
// response. `onCommandTimeout` receives the live stream, so answering a prompt
// there resets the timer and normal processing resumes. If the response never
// matches, the handler records it and closes the session.
//
// This is the handler-managed pattern: the test tracks its own state with
// `FirstPass`. `timeout_retries.js` covers the library-managed alternative
// (`commandTimeoutRetries` and `details.final`).

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
  FirstPass: false,
  debug: (process.env.DEBUG === 'true'),
  verbose: (process.env.VERBOSE === 'true'),
  onCommandTimeout: function (command, response, stream, connection) {
    if (this.sshObj.debug) {
      this.emit('msg', `${this.sshObj.server.host}: host.onCommandTimeout`);
    }

    // Answer the first prompt so the run reaches the final unhandled timeout.
    if (response.indexOf('(Y,n)') !== -1 && this.sshObj.FirstPass !== true) {
      if (this.sshObj.debug) {
        this.emit(
          'msg',
          `${this.sshObj.server.host}: First prompt using correct input: Sending 'y' to the \`(y,n):\` prompt`
        );
      }
      this.sshObj.sessionText += response + this.sshObj.enter;
      this._buffer = '';
      this.sshObj.FirstPass = true;
      stream.write('y' + this.sshObj.enter);
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
