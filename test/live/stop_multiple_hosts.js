const dotenv = require('dotenv').config();
const { logFile, log } = require('../utils/logging.js');
logFile('stop_multiple_hosts.js');

const SSH2Shell = require('../../src/ssh2shell');
const { readPrivateKey } = require('../utils/private_key.js');

// stop() is a whole-run abort: it clears the primary-host queue, so the second
// host must never be contacted after the first host's handler stops the run.
const host1 = {
  server: {
    host: process.env.SERVER1_HOST || process.env.HOST,
    port: process.env.SERVER1_PORT || process.env.PORT,
    userName: process.env.SERVER1_USER_NAME || process.env.USER_NAME,
    privateKey: readPrivateKey(),
    passPhrase: process.env.KEY_PASSPHRASE,
  },
  commands: ['echo stop-host-one', 'echo stop-host-one-second'],
  onCommandComplete: (command) => {
    if (command.includes('stop-host-one')) {
      SSH.stop('command-failed');
    }
  },
  debug: (process.env.DEBUG === 'true'),
  verbose: (process.env.VERBOSE === 'true'),
};

const host2 = {
  server: {
    host: process.env.SERVER2_HOST,
    port: process.env.SERVER2_PORT || process.env.PORT,
    userName: process.env.SERVER2_USER_NAME,
    privateKey: readPrivateKey(),
    passPhrase: process.env.KEY_PASSPHRASE,
  },
  commands: ['echo stop-host-two-marker'],
  debug: (process.env.DEBUG === 'true'),
  verbose: (process.env.VERBOSE === 'true'),
};

const SSH = new SSH2Shell([host1, host2]);

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
