const dotenv = require('dotenv').config();
const { logFile, log } = require('../utils/logging.js');
logFile('fingerprint.js');

/** @type {typeof import('../../index')} */
const SSH2Shell = require('../utils/module.js');
const { readPrivateKey } = require('../utils/private_key.js');

/** @type {import('../../index').HostConfig} */
const host = {
  server: {
    host: process.env.HOST,
    port: process.env.PORT,
    userName: process.env.USER_NAME,
    privateKey: readPrivateKey(),
    passPhrase: process.env.KEY_PASSPHRASE,
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
  commands: ['whoami']
};

const SSH = new SSH2Shell(host);

SSH.on('msg', log);
SSH.debug = (process.env.DEBUG === 'true');
SSH.verbose = (process.env.VERBOSE === 'true');

SSH.connect((sessionText) => {
  const text = `-----Callback session text:\n${sessionText}\n-----Callback end`;
  log(text);
  console.log(text);
});
