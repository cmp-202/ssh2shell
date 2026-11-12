const dotenv = require('dotenv').config();
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { logFile, log } = require('../utils/logging.js');
logFile('private_key.js');

const SSH2Shell = require('../../src/ssh2shell');

// `~` is not expanded by fs.readFileSync(), so resolve it against os.homedir().
const keyPath = path.resolve(
  (process.env.PRIVATE_KEY_PATH || '~/.ssh/id_rsa')
    .replace(/^~(?=$|[\\/])/, os.homedir())
);

const host = {
  server: {
    host: process.env.HOST,
    port: process.env.PORT,
    userName: process.env.USER_NAME,
    privateKey: fs.readFileSync(keyPath),
    passPhrase: process.env.KEY_PASSPHRASE, // omit if the key has no passphrase
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
