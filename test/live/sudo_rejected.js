const dotenv = require('dotenv').config();
const { logFile, log } = require('../utils/logging.js');
logFile('sudo_rejected.js');

const SSH2Shell = require('../../src/ssh2shell');

// Log in with the correct password, then swap in a wrong sudo password as the
// prompt arrives. The default behavior must report the rejection, set
// sudoFailed, and continue with the next command instead of aborting.
const host = {
  server: {
    host: process.env.HOST,
    port: process.env.PORT,
    userName: process.env.USER_NAME,
    password: process.env.PASSWORD,
  },
  commands: [
    'sudo -k',
    'sudo id -u',
    'echo sudo-rejected-continued',
  ],
  onCommandProcessing: (command, response, sshObj) => {
    if (command.includes('sudo id -u') && /password/i.test(response)) {
      sshObj.server.password = 'definitely-not-the-sudo-password';
    }
  },
  onCommandComplete: (command, response, sshObj) => {
    if (command.includes('sudo-rejected-continued')) {
      log(`sudo-failed:${sshObj.sudoFailed}`);
    }
  },
  debug: (process.env.DEBUG === 'true'),
  verbose: (process.env.VERBOSE === 'true'),
};

const SSH = new SSH2Shell(host);

SSH.on('msg', log);

SSH.connect((sessionText) => {
  const text = `-----Callback session text:\n${sessionText}\n-----Callback end`;
  log(text);
  log(`sudo-failed:${SSH.sshObj.sudoFailed}`);
  console.log(text);
  console.log(`sudo-failed:${SSH.sshObj.sudoFailed}`);
});
