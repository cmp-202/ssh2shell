const dotenv = require('dotenv').config();
const { logFile, log } = require('./utils/logging.js');
logFile('sudo_su.js');

const SSH2Shell = require('../src/ssh2shell');

const secondUser = process.env.SECOND_USER || 'seconduser';

const host = {
  server: {
    host: process.env.HOST,
    port: process.env.PORT,
    userName: process.env.USER_NAME,
    password: process.env.PASSWORD,
    secondUserPassword: process.env.SECOND_USER_PASSWORD,
  },
  commands: [
    'sudo -i',
    'cd /root',
    'ls -la',
    'exit',
    `su ${secondUser}`,
    'whoami',
    'exit',
  ],
  onCommandProcessing: function (command, response, sshObj, stream) {
    if (command === `su ${secondUser}`
        && response.includes('Password:')
        && sshObj.suPasswordSent !== true) {
      sshObj.suPasswordSent = true;
      stream.write(`${sshObj.server.secondUserPassword}\n`);
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
  console.log(text);
});
