const dotenv = require('dotenv').config();
const { logFile, log } = require('./utils/logging.js');
logFile('simple.js');

const SSH2Shell = require('../src/ssh2shell');

const host = {
  server: {
    host: process.env.HOST,
    port: process.env.PORT,
    userName: process.env.USER_NAME,
    password: process.env.PASSWORD,
  },
  commands: [
    'msg:Checking disk usage',
    'df -h',
    'msg:Checking memory',
    'free -m',
  ],
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
