const dotenv = require('dotenv').config();
const { logFile, log } = require('../utils/logging.js');
logFile('transport_drop.js');

const SSH2Shell = require('../../src/ssh2shell');
const { readPrivateKey } = require('../utils/private_key.js');

// Kill the remote session process to drop the transport without a clean shell
// exit. The callback must still receive the text from before the drop, and the
// command after the kill must never run.
const host = {
  server: {
    host: process.env.HOST,
    port: process.env.PORT,
    userName: process.env.USER_NAME,
    privateKey: readPrivateKey(),
    passPhrase: process.env.KEY_PASSPHRASE,
  },
  commands: [
    'echo transport-drop-before',
    'kill -9 $PPID',
    'echo transport-drop-after',
  ],
  debug: (process.env.DEBUG === 'true'),
  verbose: (process.env.VERBOSE === 'true'),
};

const SSH = new SSH2Shell(host);

const ends = [];
SSH.on('msg', log);
SSH.on('error', (err, type) => {
  log(`error-event:${type || ''}:${err && err.message ? err.message : err}`);
});
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
