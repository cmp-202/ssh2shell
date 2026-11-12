const dotenv = require('dotenv').config();
const { logFile, log } = require('../utils/logging.js');
logFile('lots_of_commands.js');

const SSH2Shell = require('../../src/ssh2shell');
const { readPrivateKey } = require('../utils/private_key.js');

// Queue a long run of sequential commands to exercise the command queue and
// prompt detection. The commands are harmless and do not require sudo.
const commands = ['msg:Starting 60 commands'];
for (let i = 1; i <= 60; i += 1) {
  commands.push(`echo "command ${i}"`);
  if (i % 10 === 0) {
    commands.push(`msg:Completed ${i} commands`);
  }
}

const host = {
  server: {
    host: process.env.HOST,
    port: process.env.PORT,
    userName: process.env.USER_NAME,
    privateKey: readPrivateKey(),
    passPhrase: process.env.KEY_PASSPHRASE,
  },
  commands,
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
