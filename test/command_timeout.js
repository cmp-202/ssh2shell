const dotenv = require('dotenv').config();
const { logFile, log } = require('./utils/logging.js');
logFile('command_timeout.js');

const SSH2Shell = require('../src/ssh2shell');
const { readPrivateKey } = require('./utils/private_key.js');

// idleTimeOut defaults to 5000 ms. This example answers one prompt and then
// falls back to the default timeout behaviour. The command is local so the
// test does not need network access.
const promptCommand =
  'printf "Install nodejs [Y/n]? "; read answer; echo "answer=$answer"';

const host = {
  server: {
    host: process.env.HOST,
    port: process.env.PORT,
    userName: process.env.USER_NAME,
    privateKey: readPrivateKey(),
    passPhrase: process.env.KEY_PASSPHRASE,
  },
  commands: [promptCommand],
  onCommandTimeout: function (command, response, stream, connection) {
    if (command === promptCommand
        && response.includes('[Y/n]?')
        && this.sshObj.answeredNode !== true) {
      this.sshObj.answeredNode = true;
      stream.write('y\n');
      return;
    }

    // If the response is garbled before the real response, save it and clear
    // the buffer before writing:
    // this.sshObj.sessionText += response;
    // this._buffer = '';

    // Fall back to the default behaviour: record the response and close.
    this.emit(
      'error',
      `${this.sshObj.server.host}: Command timed out after ${this.idleTime / 1000} seconds`,
      'Command Timeout',
      true,
      () => {
        this.sshObj.sessionText += response;
      }
    );
  },
  debug: (process.env.DEBUG === 'true'),
  verbose: (process.env.VERBOSE === 'true'),
};

const SSH = new SSH2Shell(host);

SSH.on('msg', log);
SSH.on('error', (err, type) => log(`${type}: ${err}`));

// To change timeout handling for every host, leave onCommandTimeout out of the
// host object and listen on the instance instead:
// SSH.on('commandTimeout', function (command, response, stream, connection) {
//   // ...
// });

SSH.connect((sessionText) => {
  const text = `-----Callback session text:\n${sessionText}\n-----Callback end`;
  log(text);
  console.log(text);
});
