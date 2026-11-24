require('dotenv').config();
const { logFile, log } = require('../utils/logging.js');
logFile('hop_keyboard_interactive.js');

const SSH2Shell = require('../utils/module.js');
const { readPrivateKey } = require('../utils/private_key.js');

// Prove the README claim that keyboard-interactive works on nested hosts.
// The parent authenticates with the throwaway key over server2. The child is
// opened with forwardOut to server1's kbduser, whose password auth is disabled,
// so only the child's keyboard-interactive handler can complete the login.
const privateKey = readPrivateKey();
const kbdUser = process.env.KBD_USER || 'kbduser';
const kbdPassword = process.env.KBD_PASSWORD;

if (!kbdPassword) {
  console.error('Set KBD_PASSWORD in .env for the keyboard-interactive user.');
  process.exit(1);
}

const parent = {
  server: {
    host: process.env.SERVER2_HOST,
    port: process.env.SERVER2_PORT || process.env.PORT,
    userName: process.env.SERVER2_USER_NAME,
    privateKey,
    passPhrase: process.env.KEY_PASSPHRASE,
  },
  commands: ['hostname']
};

const child = {
  server: {
    host: process.env.KBD_HOST || process.env.HOST,
    port: process.env.KBD_PORT || process.env.PORT,
    userName: kbdUser,
    password: kbdPassword,
    tryKeyboard: true,
  },
  commands: ['whoami', 'echo hop-keyboard-interactive-marker'],
  // Host handlers are record-scoped. This one must be used for the child's
  // challenge, not the parent's (the parent uses key authentication).
  onKeyboardInteractive: function (name, instructions, instructionsLang, prompts, finish) {
    log(`hop-keyboard-interactive-handler:${this.sshObj.server.userName}`);
    finish([kbdPassword]);
  }
};

parent.hosts = [child];
child.hosts = [];

const SSH = new SSH2Shell(parent);

SSH.on('msg', log);
SSH.debug = (process.env.DEBUG === 'true');
SSH.verbose = (process.env.VERBOSE === 'true');

SSH.connect((sessionText) => {
  const text = `-----Callback session text:\n${sessionText}\n-----Callback end`;
  log(text);
  console.log(text);
});
