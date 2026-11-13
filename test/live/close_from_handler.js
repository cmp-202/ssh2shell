const dotenv = require('dotenv').config();
const { logFile, log } = require('../utils/logging.js');
logFile('close_from_handler.js');

const SSH2Shell = require('../../src/ssh2shell');
const { readPrivateKey } = require('../utils/private_key.js');

// close() from a handler stops the queue and closes the shell. The completed
// response is kept in the callback text and the next command is not run.
const host = {
  server: {
    host: process.env.HOST,
    port: process.env.PORT,
    userName: process.env.USER_NAME,
    privateKey: readPrivateKey(),
    passPhrase: process.env.KEY_PASSPHRASE,
  },
  commands: ['echo close-test-first', 'echo close-test-second'],
  onCommandComplete: (command) => {
    if (command.includes('close-test-first')) {
      SSH.close();
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
