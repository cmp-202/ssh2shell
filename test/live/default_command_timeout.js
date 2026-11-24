require('dotenv').config();
const { logFile, log } = require('../utils/logging.js');
logFile('default_command_timeout.js');

const SSH2Shell = require('../utils/module.js');
const { readPrivateKey } = require('../utils/private_key.js');

// No host `onCommandTimeout` is supplied here, so the library's default
// handler must emit the `Command Timeout` error and close the run on its own.
// The command waits for input that never arrives; a short idle timeout keeps
// the test quick without depending on prompt detection.
const promptCommand = 'printf "Default timeout prompt: "; read answer';

const host = {
  server: {
    host: process.env.HOST,
    port: process.env.PORT,
    userName: process.env.USER_NAME,
    privateKey: readPrivateKey(),
    passPhrase: process.env.KEY_PASSPHRASE,
  },
  commands: [promptCommand],
  // Avoid `#` and `>` because prompt detection can trigger in the wrong place.
  standardPrompt: '$',
  idleTimeOut: 2000,
};

const SSH = new SSH2Shell(host);

SSH.on('msg', log);
SSH.debug = (process.env.DEBUG === 'true');
SSH.verbose = (process.env.VERBOSE === 'true');
SSH.on('error', (err, type) => log(`${type}: ${err}`));

SSH.connect((sessionText) => {
  const text = `-----Callback session text:\n${sessionText}\n-----Callback end`;
  log(text);
  console.log(text);
});
