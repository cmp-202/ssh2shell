const dotenv = require('dotenv').config();
const { logFile, log } = require('./utils/logging.js');
logFile('keyboard-interactive.js');

const SSH2Shell = require('../src/ssh2shell');

const host = {
  server: {
    host: process.env.HOST,
    port: process.env.PORT,
    userName: process.env.USER_NAME,
    password: process.env.PASSWORD,
    tryKeyboard: true,
  },
  commands: ['whoami'],
  debug: (process.env.DEBUG === 'true'),
  verbose: (process.env.VERBOSE === 'true'),
};

const SSH = new SSH2Shell(host);

SSH.on('msg', log);

SSH.on('keyboard-interactive', function (name, instructions, instructionsLang, prompts, finish) {
  // This example assumes only the password is requested.
  finish([this.sshObj.server.password]);
});

// Alternatively, define the same handler on the host object:
// onKeyboardInteractive: function (name, instructions, instructionsLang, prompts, finish) {
//   finish([this.sshObj.server.password]);
// },

SSH.connect((sessionText) => {
  const text = `-----Callback session text:\n${sessionText}\n-----Callback end`;
  log(text);
  console.log(text);
});
