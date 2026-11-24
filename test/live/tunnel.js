require('dotenv').config();
const { logFile, log } = require('../utils/logging.js');
logFile('tunnel.js');

/** @type {typeof import('../../index')} */
const SSH2Shell = require('../utils/module.js');
const { readPrivateKey } = require('../utils/private_key.js');

// Hops are opened with `forwardOut` from the parent connection, so every host
// authenticates with the runner's local key.
const privateKey = readPrivateKey();

/** @type {import('../../index').HostConfig} */
const jump = {
  server: {
    host: process.env.HOST,
    port: process.env.PORT,
    userName: process.env.USER_NAME,
    privateKey,
    passPhrase: process.env.KEY_PASSPHRASE,
  },
  commands: ['hostname']
};

/** @type {import('../../index').HostConfig} */
const target = {
  server: {
    host: process.env.SERVER2_HOST,
    port: process.env.SERVER2_PORT || process.env.PORT,
    userName: process.env.SERVER2_USER_NAME,
    privateKey,
    passPhrase: process.env.KEY_PASSPHRASE,
  },
  commands: ['hostname', 'uptime']
};

// Chain the hosts: jump -> target. Each hop closes its own connection after the
// target's commands finish, and the session backs out to the jump host.

jump.hosts = [target];

const SSH = new SSH2Shell(jump);

SSH.on('msg', log);
SSH.debug = (process.env.DEBUG === 'true');
SSH.verbose = (process.env.VERBOSE === 'true');

SSH.connect((sessionText) => {
  const text = `-----Callback session text:\n${sessionText}\n-----Callback end`;
  log(text);
  console.log(text);
});
