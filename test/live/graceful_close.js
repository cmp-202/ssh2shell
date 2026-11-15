const dotenv = require('dotenv').config();
const { logFile, log } = require('../utils/logging.js');
logFile('graceful_close.js');

const SSH2Shell = require('../utils/module.js');
const { readPrivateKey } = require('../utils/private_key.js');

// A nested shell queues an `exit` command when it opens. Closing gracefully
// must run that exit, back out to the jump host, and still finalize both hosts.
// Hops are opened with `forwardOut` from the parent connection, so every host
// authenticates with the runner's local key.
const privateKey = readPrivateKey();

const jump = {
  server: {
    host: process.env.HOST,
    port: process.env.PORT,
    userName: process.env.USER_NAME,
    privateKey,
    passPhrase: process.env.KEY_PASSPHRASE,
  },
  commands: ['echo jump-graceful-before'],
  debug: (process.env.DEBUG === 'true'),
  verbose: (process.env.VERBOSE === 'true'),
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
  },
  debug: (process.env.DEBUG === 'true'),
  verbose: (process.env.VERBOSE === 'true'),
};

jump.hosts = [nested];
nested.hosts = [];

const SSH = new SSH2Shell(jump);

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
