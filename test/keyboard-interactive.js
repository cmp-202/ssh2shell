const dotenv = require('dotenv').config();
const { logFile, log } = require('./utils/logging.js');
logFile('keyboard-interactive.js');

const SSH2Shell = require('../src/ssh2shell');

// The keyboard-interactive user has password auth disabled, so the client must
// answer the challenge through the keyboard-interactive handler below.
const kbdUser = process.env.KBD_USER || 'kbduser';
const kbdPassword = process.env.KBD_PASSWORD || process.env.PASSWORD;

const host = {
  server: {
    host: process.env.KBD_HOST || process.env.HOST,
    port: process.env.KBD_PORT || process.env.PORT,
    userName: kbdUser,
    password: kbdPassword,
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
