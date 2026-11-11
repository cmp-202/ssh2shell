const dotenv = require('dotenv').config();
const { logFile, log } = require('./utils/logging.js');
logFile('sudo_no_pass.js');

const SSH2Shell = require('../src/ssh2shell');

/*
 * Add `[username] ALL=(ALL) NOPASSWD: ALL` with `sudo visudo` on the second
 * test server. This checks that sudo commands run without a password prompt and
 * that the normal prompt is still detected so the next command runs.
 */
const host = {
  server: {
    host: process.env.SERVER2_HOST,
    port: process.env.SERVER2_PORT || process.env.PORT,
    userName: process.env.SERVER2_USER_NAME,
    password: process.env.SERVER2_PASSWORD,
  },
  commands: [
    'sudo apt-get update',
    'sudo apt-get upgrade',
    'sudo apt autoremove',
  ],
  userPromptSent: false,
  debug: (process.env.DEBUG === 'true'),
  verbose: (process.env.VERBOSE === 'true'),
  onCommandProcessing: function (command, response, sshObj, stream) {
    // Answer the `[Y/n]` prompt once, then let the command finish.
    if (response.indexOf('[Y/n]') !== -1 && !sshObj.userPromptSent) {
      sshObj.userPromptSent = true;
      stream.write('n\n');
    }
  },
  onCommandComplete: function (command, response, sshObj) {
    if (response.indexOf('[Y/n]') !== -1 && sshObj.userPromptSent) {
      sshObj.userPromptSent = false;
    }
  },
};

const SSH = new SSH2Shell(host);

SSH.on('msg', log);

SSH.connect((sessionText) => {
  const text = `-----Callback session text:\n${sessionText}\n-----Callback end`;
  log(text);
  console.log(text);
});
