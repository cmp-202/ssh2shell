const path = require('node:path');
const fs = require('node:fs');
const dotenv = require('dotenv').config();
const { logFile, log } = require('./utils/logging.js');
logFile('pipe.js');

const SSH2Shell = require('../src/ssh2shell');
const { readPrivateKey } = require('./utils/private_key.js');

const host = {
  server: {
    host: process.env.HOST,
    port: process.env.PORT,
    userName: process.env.USER_NAME,
    privateKey: readPrivateKey(),
    passPhrase: process.env.KEY_PASSPHRASE,
  },
  commands: ['echo host pipe'],
  debug: (process.env.DEBUG === 'true'),
  verbose: (process.env.VERBOSE === 'true'),
};

const SSH = new SSH2Shell(host);

// `pipe` is the inherited stream method. Each chunk of session output is copied
// to every attached writable stream, so this writes the same run twice.
const logDir = path.join(__dirname, 'logs');
const firstLog = fs.createWriteStream(path.join(logDir, 'pipe-first.log'));
const secondLog = fs.createWriteStream(path.join(logDir, 'pipe-second.log'));

SSH.on('msg', log);
SSH.pipe(firstLog);
SSH.pipe(secondLog);

SSH.connect((sessionText) => {
  const text = `-----Callback session text:\n${sessionText}\n-----Callback end`;
  log(text);
  console.log(text);
});
