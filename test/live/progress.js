const dotenv = require('dotenv').config();
const { logFile, log } = require('../utils/logging.js');
logFile('progress.js');

const SSH2Shell = require('../../src/ssh2shell');
const { readPrivateKey } = require('../utils/private_key.js');

// Progress is on by default, writes to stderr, and only runs when stderr is a
// TTY. Run this file directly in an interactive terminal to see the heartbeat:
//
//   node test/live/progress.js
//
// `node scripts/run-live.js progress` captures stderr, so the heartbeat is
// intentionally silent there; the runner only checks that the session works.
// Two primary hosts are used so the host labels also appear. Set
// `progress: false` on a host to opt out.
const makeHost = (host, user) => ({
  server: {
    host,
    port: process.env.PORT,
    userName: user,
    privateKey: readPrivateKey(),
    passPhrase: process.env.KEY_PASSPHRASE,
  },
  // A slow command gives the one-second heartbeat time to appear. Progress is
  // on by default, so this test does not set the flag.
  commands: ['sleep 3', `echo progress-demo-${host}`],
  // Progress is suppressed while either of these is enabled.
  debug: false,
  verbose: false,
});

const host1 = makeHost(
  process.env.SERVER1_HOST || process.env.HOST,
  process.env.SERVER1_USER_NAME || process.env.USER_NAME
);
const host2 = makeHost(
  process.env.SERVER2_HOST,
  process.env.SERVER2_USER_NAME
);

const SSH = new SSH2Shell([host1, host2]);

SSH.on('msg', log);

if (!process.stderr.isTTY) {
  console.log(
    'stderr is not a TTY, so the progress heartbeat is suppressed.\n' +
      'Run this file directly in an interactive terminal to see it.'
  );
}

SSH.connect((allSessionText) => {
  const text = `-----Callback session text:\n${allSessionText}\n-----Callback end`;
  log(text);
  console.log(text);
});
