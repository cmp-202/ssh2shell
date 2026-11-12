const dotenv = require('dotenv').config();
const { logFile, log } = require('../utils/logging.js');
logFile('multiple_primary_hosts.js');

const SSH2Shell = require('../../src/ssh2shell');
const { readPrivateKey } = require('../utils/private_key.js');

const host1 = {
  server: {
    host: process.env.SERVER1_HOST || process.env.HOST,
    port: process.env.SERVER1_PORT || process.env.PORT,
    userName: process.env.SERVER1_USER_NAME || process.env.USER_NAME,
    privateKey: readPrivateKey(),
    passPhrase: process.env.KEY_PASSPHRASE,
  },
  commands: ['hostname', 'uptime'],
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
  commands: ['hostname', 'uptime'],
  debug: (process.env.DEBUG === 'true'),
  verbose: (process.env.VERBOSE === 'true'),
};

const SSH = new SSH2Shell([host1, host2]);

SSH.on('msg', log);

SSH.connect((allSessionText) => {
  const text = `-----Callback session text:\n${allSessionText}\n-----Callback end`;
  log(text);
  console.log(text);
});
