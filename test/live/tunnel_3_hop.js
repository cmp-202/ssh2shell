const dotenv = require('dotenv').config();
const { logFile, log } = require('../utils/logging.js');
logFile('tunnel_3_hop.js');

const SSH2Shell = require('../utils/module.js');
const { readPrivateKey } = require('../utils/private_key.js');

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
  commands: ['hostname'],
  debug: (process.env.DEBUG === 'true'),
  verbose: (process.env.VERBOSE === 'true'),
};

const bastion = {
  server: {
    host: process.env.SERVER2_HOST,
    port: process.env.SERVER2_PORT || process.env.PORT,
    userName: process.env.SERVER2_USER_NAME,
    privateKey,
    passPhrase: process.env.KEY_PASSPHRASE,
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
    privateKey,
    passPhrase: process.env.KEY_PASSPHRASE,
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
