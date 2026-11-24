const dotenv = require('dotenv').config();
const { logFile, log } = require('../utils/logging.js');
logFile('hop_host_key.js');

const SSH2Shell = require('../utils/module.js');
const { readPrivateKey } = require('../utils/private_key.js');

// Hops are opened with `forwardOut` from the parent connection and authenticate
// with the runner's local key. This test rejects the second host's key with a
// verifier, so it needs no stored fingerprint and works with CI's throwaway
// host keys. A valid sibling hop after the rejected one proves the failure is
// contained.
const privateKey = readPrivateKey();

const primary = {
  server: {
    host: process.env.HOST,
    port: process.env.PORT,
    userName: process.env.USER_NAME,
    privateKey,
    passPhrase: process.env.KEY_PASSPHRASE,
  },
  commands: ['echo pin:primary'],
};

const rejectedHop = {
  server: {
    host: process.env.SERVER2_HOST,
    port: process.env.SERVER2_PORT || process.env.PORT,
    userName: process.env.SERVER2_USER_NAME,
    privateKey,
    passPhrase: process.env.KEY_PASSPHRASE,
    hostHash: 'sha256',
    hostVerifier: () => false,
  },
  commands: ['echo pin:hop-must-not-run'],
};

const siblingHop = {
  server: {
    host: process.env.SERVER3_HOST,
    port: process.env.SERVER3_PORT || process.env.PORT,
    userName: process.env.SERVER3_USER_NAME,
    privateKey,
    passPhrase: process.env.KEY_PASSPHRASE,
  },
  commands: ['echo pin:sibling'],
};

primary.hosts = [rejectedHop, siblingHop];

const expectedOrder = ['primary', 'sibling'];
const rejectionMessage = 'Host denied (verification failed)';

const SSH = new SSH2Shell(primary);

const errors = [];
SSH.on('msg', log);
SSH.debug = process.env.DEBUG === 'true';
SSH.verbose = process.env.VERBOSE === 'true';
SSH.on('error', (err, type) => {
  const message = err && err.message ? err.message : String(err);
  errors.push(`${type || ''}:${message}`);
  log(`pin-error:${type || ''}:${message}`);
});

SSH.connect((sessionText) => {
  // Command echoes repeat each marker, so keep first-seen order only.
  const order = [];
  for (const match of sessionText.matchAll(/pin:(primary|hop-must-not-run|sibling)/g)) {
    if (order[order.length - 1] !== match[1]) {
      order.push(match[1]);
    }
  }
  const rejections = errors.filter((error) => error.includes(rejectionMessage)).length;

  const text = `-----Callback session text:\n${sessionText}\n-----Callback end`;
  log(text);
  log(`pin-order:${order.join(',')}`);
  log(`pin-error-count:${errors.length}`);
  log(`pin-rejections:${rejections}`);
  console.log(text);
  console.log(`pin-order:${order.join(',')}`);
  console.log(`pin-error-count:${errors.length}`);
  console.log(`pin-rejections:${rejections}`);

  const problems = [];
  if (order.join(',') !== expectedOrder.join(',')) {
    problems.push(`expected hop order ${expectedOrder.join(',')} (got ${order.join(',')})`);
  }
  if (errors.length !== 1) {
    problems.push(`expected 1 error event (got ${errors.length})`);
  }
  if (rejections !== 1) {
    problems.push(`expected 1 host-key rejection (got ${rejections})`);
  }

  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(problem);
      log(`pin-expectation:${problem}`);
    }
    process.exitCode = 1;
  }
});
