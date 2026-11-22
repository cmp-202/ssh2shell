const dotenv = require('dotenv').config();
const { logFile, log } = require('../utils/logging.js');
logFile('progress_tty.js');

const SSH2Shell = require('../utils/module.js');
const { readPrivateKey } = require('../utils/private_key.js');

// The normal runner pipes stderr, so progress is silently disabled by its TTY
// gate. Inject a TTY-like sink before connect() so the real heartbeat code runs
// without polluting the runner's captured output. Two primary hosts exercise
// the host-label branch of the indicator.
const makeHost = (host, user, marker) => ({
  server: {
    host,
    port: process.env.PORT || process.env.SERVER1_PORT,
    userName: user,
    privateKey: readPrivateKey(),
    passPhrase: process.env.KEY_PASSPHRASE,
  },
  commands: ['sleep 2', `echo ${marker}`],
  // Debug and verbose suppress progress, so keep them off for this test.
  debug: false,
  verbose: false,
});

const host1 = makeHost(
  process.env.SERVER1_HOST || process.env.HOST,
  process.env.SERVER1_USER_NAME || process.env.USER_NAME,
  'progress-tty-first'
);
const host2 = makeHost(
  process.env.SERVER2_HOST,
  process.env.SERVER2_USER_NAME,
  'progress-tty-second'
);

const SSH = new SSH2Shell([host1, host2]);

SSH.debug = false;
SSH.verbose = false;

const progressSink = {
  isTTY: true,
  output: '',
  write(chunk) {
    this.output += chunk;
    return true;
  },
};
SSH._progressStream = progressSink;

SSH.on('msg', log);
SSH.on('error', (err, type) => log(`${type}: ${err}`));

SSH.connect((allSessionText) => {
  const dots = (progressSink.output.match(/\./g) || []).length;
  log(`progress-tty-output:${JSON.stringify(progressSink.output)}`);
  log(`progress-tty-ticks:${dots > 0 ? 'ok' : 'missing'}`);
  log(`progress-tty-labels:${progressSink.output.includes('[') ? 'ok' : 'missing'}`);
  console.log(`progress-tty-ticks:${dots > 0 ? 'ok' : 'missing'}`);

  const text = `-----Callback session text:\n${allSessionText}\n-----Callback end`;
  log(text);
  console.log(text);
});
