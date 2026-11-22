const dotenv = require('dotenv').config();
const { logFile, log } = require('../utils/logging.js');
logFile('graceful_close.js');

const SSH2Shell = require('../utils/module.js');
const { readPrivateKey } = require('../utils/private_key.js');

// Each hop is its own `ssh2` connection opened with `forwardOut`, so closing
// gracefully tears down the hop channel, returns to the parent host, and still
// finalizes both hosts. Hops authenticate from the runner, so every host uses
// the local key.
const privateKey = readPrivateKey();

const jump = {
  server: {
    host: process.env.HOST,
    port: process.env.PORT,
    userName: process.env.USER_NAME,
    privateKey,
    passPhrase: process.env.KEY_PASSPHRASE,
  },
  commands: ['echo jump-graceful-before']
};

const nested = {
  server: {
    host: process.env.SERVER2_HOST,
    port: process.env.SERVER2_PORT || process.env.PORT,
    userName: process.env.SERVER2_USER_NAME,
    privateKey,
    passPhrase: process.env.KEY_PASSPHRASE,
  },
  commands: [
    'echo nested-graceful-before',
    'echo nested-graceful-after',
  ],
  onCommandComplete: (command) => {
    if (command.includes('nested-graceful-before')) {
      SSH.close({ graceful: true });
    }
  }
};

jump.hosts = [nested];
nested.hosts = [];

const SSH = new SSH2Shell(jump);

const ends = [];
SSH.on('msg', log);
SSH.debug = (process.env.DEBUG === 'true');
SSH.verbose = (process.env.VERBOSE === 'true');
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
