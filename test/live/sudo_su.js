require('dotenv').config();
const { logFile, log } = require('../utils/logging.js');
logFile('sudo_su.js');

/** @type {typeof import('../../index')} */
const SSH2Shell = require('../utils/module.js');

// `HOST` is server1, which has the `suuser` account used as the `su` target.
// The login password stays here because the library also uses server.password
// to answer the `sudo` prompt.
const secondUser = process.env.SECOND_USER || 'suuser';

/** @type {import('../../index').HostConfig} */
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
        && /** @type {string} */ (response).includes('Password:')
        && sshObj.suPasswordSent !== true) {
      sshObj.suPasswordSent = true;
      stream.write(`${sshObj.server.secondUserPassword}\n`);
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
  console.log(text);
});
