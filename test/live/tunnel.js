const dotenv = require('dotenv').config();
const { logFile, log } = require('../utils/logging.js');
logFile('tunnel.js');

const SSH2Shell = require('../../src/ssh2shell');
const { readPrivateKey } = require('../utils/private_key.js');

// Path to the private key as it exists on the jump host. Override this when
// the key is installed under a different name or location.
const hopKeyPath =
  process.env.HOP_KEY_PATH || `/home/${process.env.USER_NAME}/.ssh/id_ed25519`;

const jump = {
  server: {
    host: process.env.HOST,
    port: process.env.PORT,
    userName: process.env.USER_NAME,
    privateKey: readPrivateKey(),
    passPhrase: process.env.KEY_PASSPHRASE,
  },
  commands: ['hostname'],
  debug: (process.env.DEBUG === 'true'),
  verbose: (process.env.VERBOSE === 'true'),
};

const bastion = {
  server: {
    host: process.env.SERVER2_HOST,
    port: process.env.SERVER2_PORT || process.env.PORT,
    userName: process.env.SERVER2_USER_NAME,
    // Hop authentication uses the test key installed on the jump host for the
    // login user, so the nested connection does not need a password.
    ssh: {
      identityFile: hopKeyPath,
    },
  },
  commands: ['hostname', 'uptime'],
  debug: (process.env.DEBUG === 'true'),
  verbose: (process.env.VERBOSE === 'true'),
};

const target = {
  server: {
    host: process.env.SERVER3_HOST,
    port: process.env.SERVER3_PORT || process.env.PORT,
    userName: process.env.SERVER3_USER_NAME,
    // Hop authentication uses the test key installed on the jump host for the
    // login user, so the nested connection does not need a password.
    ssh: {
      identityFile: hopKeyPath,
    },
  },
  commands: ['hostname', 'uptime'],
  debug: (process.env.DEBUG === 'true'),
  verbose: (process.env.VERBOSE === 'true'),
};
// Chain the hosts: jump -> bastion -> target. The session backs out through
// each nested connection after the target's commands finish.
bastion.hosts = [target];
jump.hosts = [bastion];

const SSH = new SSH2Shell(jump);

SSH.on('msg', log);

SSH.connect((sessionText) => {
  const text = `-----Callback session text:\n${sessionText}\n-----Callback end`;
  log(text);
  console.log(text);
});
