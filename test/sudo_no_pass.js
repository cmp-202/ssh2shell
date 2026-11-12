const dotenv = require('dotenv').config();
const { logFile, log } = require('./utils/logging.js');
logFile('sudo_no_pass.js');

const SSH2Shell = require('../src/ssh2shell');
const { readPrivateKey } = require('./utils/private_key.js');

/*
 * `nopasswd` has `ALL=(ALL) NOPASSWD: ALL` on server2 only. `SERVER2_HOST` and
 * `NOPASSWD_USER` come from .env. `sudo -n` fails immediately if a password
 * would be required, so these commands prove that sudo runs without a prompt
 * and that the normal prompt is still detected so the next command runs.
 */
const host = {
  server: {
    host: process.env.SERVER2_HOST,
    port: process.env.SERVER2_PORT || process.env.PORT,
    userName: process.env.NOPASSWD_USER || 'nopasswd',
    privateKey: readPrivateKey(),
    passPhrase: process.env.KEY_PASSPHRASE,
  },
  commands: [
    'sudo -n id -u',
    'sudo -n hostname',
    'sudo -n ls /root',
  ],
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
