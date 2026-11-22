const dotenv = require('dotenv').config();
const { logFile, log } = require('../utils/logging.js');
logFile('sudo_abort.js');

const SSH2Shell = require('../utils/module.js');

// Same rejection path as sudo_rejected.js, but the host opts into aborting.
// The run must stop at the failed prompt, send one Ctrl-C, and never start the
// follow-up command.
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
    'echo sudo-abort-must-not-run',
  ],
  abortOnSudoFailure: true,
  onCommandProcessing: (command, response, sshObj) => {
    if (command.includes('sudo id -u') && /password/i.test(response)) {
      sshObj.server.password = 'definitely-not-the-sudo-password';
    }
  },
  onCommandComplete: (command) => {
    if (command.includes('sudo-abort-must-not-run')) {
      log('sudo-abort-follow-up-ran');
    }
  }
};

const SSH = new SSH2Shell(host);

SSH.on('msg', log);
SSH.debug = (process.env.DEBUG === 'true');
SSH.verbose = (process.env.VERBOSE === 'true');

SSH.connect((sessionText) => {
  const text = `-----Callback session text:\n${sessionText}\n-----Callback end`;
  log(text);
  log(`sudo-failed:${SSH.sshObj.sudoFailed}`);
  console.log(text);
  console.log(`sudo-failed:${SSH.sshObj.sudoFailed}`);
});
