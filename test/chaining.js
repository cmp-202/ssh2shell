const dotenv = require('dotenv').config();
const { logFile, log } = require('./utils/logging.js');
logFile('chaining.js');

const SSH2Shell = require('../src/ssh2shell');
const { readPrivateKey } = require('./utils/private_key.js');

// Paths to the private key as they exist on each jump host. Override these
// when the key is installed under a different name or location.
const hopKeyPath =
  process.env.HOP_KEY_PATH || `/home/${process.env.USER_NAME}/.ssh/id_ed25519`;
const hop2KeyPath =
  process.env.HOP2_KEY_PATH ||
  `/home/${process.env.SERVER2_USER_NAME}/.ssh/id_ed25519`;

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
  commands: ['hostname'],
  debug: (process.env.DEBUG === 'true'),
  verbose: (process.env.VERBOSE === 'true'),
};

const target = {
  server: {
    host: process.env.SERVER3_HOST,
    port: process.env.SERVER3_PORT || process.env.PORT,
    userName: process.env.SERVER3_USER_NAME,
    // This hop runs on the bastion, so the key path belongs to its login user.
    ssh: {
      identityFile: hop2KeyPath,
    },
  },
  commands: ['hostname', 'uptime'],
  debug: (process.env.DEBUG === 'true'),
  verbose: (process.env.VERBOSE === 'true'),
};

jump.hosts = [bastion];
bastion.hosts = [target];
target.hosts = [];

const SSH = new SSH2Shell(jump);

SSH.on('msg', log);

SSH.connect((sessionText) => {
  const text = `-----Callback session text:\n${sessionText}\n-----Callback end`;
  log(text);
  console.log(text);
});
