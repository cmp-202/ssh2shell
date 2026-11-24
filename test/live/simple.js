const dotenv = require('dotenv').config();
const { logFile, log } = require('../utils/logging.js');
logFile('simple.js');

/** @type {typeof import('../../index')} */
const SSH2Shell = require('../utils/module.js');
const { readPrivateKey } = require('../utils/private_key.js');

/** @type {import('../../index').HostConfig} */
const host = {
  server: {
    host: process.env.HOST,
    port: process.env.PORT,
    userName: process.env.USER_NAME,
    privateKey: readPrivateKey(),
    passPhrase: process.env.KEY_PASSPHRASE,
  },
  commands: [
    'msg:Checking disk usage',
    'df -h',
    'msg:Checking memory',
    'free -m',
  ]
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
