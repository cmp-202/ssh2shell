const dotenv = require('dotenv').config();
const { logFile, log } = require('../utils/logging.js');
logFile('stop_on_failure.js');

const SSH2Shell = require('../../src/ssh2shell');
const { readPrivateKey } = require('../utils/private_key.js');

// A commandComplete handler can fail the run fast by setting `sshObj.abort`.
// The remaining commands must not be written to the shell.
const host = {
  server: {
    host: process.env.HOST,
    port: process.env.PORT,
    userName: process.env.USER_NAME,
    privateKey: readPrivateKey(),
    passPhrase: process.env.KEY_PASSPHRASE,
  },
  commands: [
    'msg:Running the first command',
    'echo stop-test-first',
    'msg:This message must not run',
    'echo stop-test-second',
  ],
  onCommandComplete: (command, response, sshObj) => {
    if (command.includes('stop-test-first')) {
      sshObj.abort = 'command-failed';
    }
  },
  debug: (process.env.DEBUG === 'true'),
  verbose: (process.env.VERBOSE === 'true'),
};

const SSH = new SSH2Shell(host);

const ends = [];
SSH.on('msg', log);
SSH.on('end', () => {
  ends.push(Date.now());
});

SSH.connect((sessionText) => {
  const text = `-----Callback session text:\n${sessionText}\n-----Callback end`;
  log(text);
  log(`end-events:${ends.length}`);
  console.log(text);
  console.log(`end-events:${ends.length}`);
});
