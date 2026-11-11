const dotenv = require('dotenv').config();
const { logFile, log } = require('./utils/logging.js');
logFile('ssh_user_command.js');

const SSH2Shell = require('../src/ssh2shell');
const { readPrivateKey } = require('./utils/private_key.js');

// A user command that starts with `ssh` must run normally and must not be
// mistaken for the library's own nested-host connection command.
const host = {
  server: {
    host: process.env.HOST,
    port: process.env.PORT,
    userName: process.env.USER_NAME,
    privateKey: readPrivateKey(),
    passPhrase: process.env.KEY_PASSPHRASE,
  },
  commands: ['echo ssh', 'ssh -V', 'echo ssh middle'],
  debug: (process.env.DEBUG === 'true'),
  verbose: (process.env.VERBOSE === 'true'),
};

const SSH = new SSH2Shell(host);

SSH.on('msg', log);
SSH.on('commandComplete', (command, response, sshObj) => {
  log(`${sshObj.server.host} $ ${command}`);
  log(response.trim());
});

SSH.connect((sessionText) => {
  const text = `-----Callback session text:\n${sessionText}\n-----Callback end`;
  log(text);
  console.log(text);
});
