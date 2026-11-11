const dotenv = require('dotenv').config();
const { logFile, log } = require('./utils/logging.js');
logFile('fingerprint.js');

const SSH2Shell = require('../src/ssh2shell');

const host = {
  server: {
    host: process.env.HOST,
    port: process.env.PORT,
    userName: process.env.USER_NAME,
    password: process.env.PASSWORD,
    hostHash: 'sha256', // any crypto.getHashes() algorithm
    hostVerifier: function (hashedKey) {
      const expectedHash = process.env.EXPECTED_HOST_HASH;

      // With no pin recorded, print the hash and accept the first connection.
      if (!expectedHash) {
        const message = `Server hash: ${hashedKey}`;
        log(message);
        console.log(message);
        return true;
      }

      return hashedKey.toLowerCase() === expectedHash.toLowerCase();
    },
  },
  commands: ['whoami'],
  debug: (process.env.DEBUG === 'true'),
  verbose: (process.env.VERBOSE === 'true'),
};

const SSH = new SSH2Shell(host);

SSH.on('msg', log);

SSH.connect((sessionText) => {
  const text = `-----Callback session text:\n${sessionText}\n-----Callback end`;
  log(text);
  console.log(text);
});
