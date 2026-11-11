const dotenv = require('dotenv').config();
const { logFile, log } = require('./utils/logging.js');
logFile('timeout.js');

const SSH2Shell = require('../src/ssh2shell');

// Every data response from the server resets the command timeout timer. If
// onCommandTimeout writes to the stream and the server responds, the timer is
// reset and normal processing resumes. If the server never responds, the script
// hangs because there is no way to reset the timer from the host handler. An
// instance-level commandTimeout listener can re-arm it instead:
//
// self.sshObj.idleTimer = setTimeout(function () {
//   self.emit('commandTimeout', command, response, stream, connection);
// }, self._idleTime);
//
// commandTimeout means "no defined prompt was detected in time".

const host = {
  server: {
    host: process.env.HOST,
    port: process.env.PORT,
    userName: process.env.USER_NAME,
    password: process.env.PASSWORD,
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
