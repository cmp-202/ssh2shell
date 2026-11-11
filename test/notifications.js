const dotenv = require('dotenv').config();
const { logFile, log } = require('./utils/logging.js');
logFile('notifications.js');

const SSH2Shell = require('../src/ssh2shell');

const host = {
  server: {
    host: process.env.HOST,
    port: process.env.PORT,
    userName: process.env.USER_NAME,
    password: process.env.PASSWORD,
  },
  commands: [
    'msg:Starting deployment',
    '`This line is added to sessionText only`',
    // The README uses `cd /srv/app` and `./deploy.sh`; these commands are
    // safe stand-ins for a live host.
    'cd /tmp',
    'pwd',
  ],
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
