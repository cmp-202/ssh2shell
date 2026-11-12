const dotenv = require('dotenv').config();
const { logFile, log } = require('../utils/logging.js');
logFile('prompt_response.js');

const SSH2Shell = require('../../src/ssh2shell');
const { readPrivateKey } = require('../utils/private_key.js');

// A local command that prompts, so the test does not need network access.
const promptCommand =
  'printf "Install nano [Y/n]? "; read answer; echo "answer=$answer"';

const host = {
  server: {
    host: process.env.HOST,
    port: process.env.PORT,
    userName: process.env.USER_NAME,
    privateKey: readPrivateKey(),
    passPhrase: process.env.KEY_PASSPHRASE,
  },
  commands: [promptCommand],
  onCommandProcessing: function (command, response, sshObj, stream) {
    if (command === promptCommand
        && response.includes('[Y/n]?')
        && sshObj.answeredNano !== true) {
      sshObj.answeredNano = true;
      stream.write('y\n');
    }
  },
  debug: (process.env.DEBUG === 'true'),
  verbose: (process.env.VERBOSE === 'true'),
};

const SSH = new SSH2Shell(host);

SSH.on('msg', log);

// To apply the same logic to every host, attach it to the instance instead:
// SSH.on('commandProcessing', function (command, response, sshObj, stream) {
//   if (command === 'apt-get install nano'
//       && response.includes('[Y/n]?')
//       && sshObj.answeredNano !== true) {
//     sshObj.answeredNano = true;
//     stream.write('y\n');
//   }
// });

SSH.connect((sessionText) => {
  const text = `-----Callback session text:\n${sessionText}\n-----Callback end`;
  log(text);
  console.log(text);
});
