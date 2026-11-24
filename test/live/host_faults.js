const dotenv = require('dotenv').config();
const { logFile, log } = require('../utils/logging.js');
logFile('host_faults.js');

/** @type {typeof import('../../index')} */
const SSH2Shell = require('../utils/module.js');
const { readPrivateKey } = require('../utils/private_key.js');

// Fault-injection counterpart to host_traversal.js. It puts connection
// failures at three different positions in the same tree:
//
//   fault1 (primary)
//     good-hop
//       bad-deep        <- nested leaf that cannot connect
//         bad-deep-child
//     good-sibling      <- must still run after bad-deep fails
//   bad-primary         <- primary that cannot connect
//   fault2 (primary)    <- must still run after bad-primary fails
//
// Every reachable host writes a `fault:<label>` marker. The test logs the
// marker order, the error events, and the end events so the result shows which
// hosts ran, which were skipped, and whether the run continued.
//
// Expected result for the ssh2 hop transport:
//
//   fault-order:primary1,good-hop,good-sibling,primary2
//   error-count:2
//   end-order:bad-deep,good-hop,good-sibling,primary1,bad-primary,primary2
//
// A failed hop is contained: bad-deep is finalized, the parent's next host
// (good-sibling) runs, and the run backs out normally. A failed primary is
// skipped and the next primary runs. bad-deep-child never starts, so it never
// ends.
//
// Hops are opened with `forwardOut` from the parent connection, so every host
// authenticates with the runner's local key. No key path on the jump host is
// needed.
const privateKey = readPrivateKey();

// Labels are kept off the host config so they never reach the verbose config
// dump or the credential redaction walk.
/** @type {WeakMap<import('../../index').HostConfig, string>} */
const labels = new WeakMap();

/**
 * @param {string | undefined} host
 * @param {number | string | undefined} port
 * @param {string | undefined} userName
 * @returns {import('../../index').ServerConfig}
 */
function nestedServer(host, port, userName) {
  return {
    host,
    port: port || process.env.PORT,
    userName,
    privateKey,
    passPhrase: process.env.KEY_PASSPHRASE,
  };
}

/**
 * @param {string} label
 * @param {import('../../index').ServerConfig} server
 * @param {import('../../index').HostConfig[]} [hosts]
 * @returns {import('../../index').HostConfig}
 */
function host(label, server, hosts) {
  const config = {
    server,
    commands: [`echo fault:${label}`],
    hosts: hosts || [],
    debug: process.env.DEBUG === 'true',
    verbose: process.env.VERBOSE === 'true',
  };
  labels.set(config, label);
  return config;
}

// A reachable address with a closed port fails fast without waiting for a TCP
// timeout, and exercises the same connect-error path as an unreachable host.
const badPort = 1;

const fault1 = host('primary1', {
  host: process.env.SERVER1_HOST || process.env.HOST,
  port: process.env.SERVER1_PORT || process.env.PORT,
  userName: process.env.SERVER1_USER_NAME || process.env.USER_NAME,
  privateKey,
  passPhrase: process.env.KEY_PASSPHRASE,
});
const goodHop = host(
  'good-hop',
  nestedServer(
    process.env.SERVER2_HOST,
    process.env.SERVER2_PORT,
    process.env.SERVER2_USER_NAME
  )
);
const badDeep = host(
  'bad-deep',
  nestedServer(
    process.env.SERVER2_HOST,
    badPort,
    process.env.SERVER2_USER_NAME
  )
);
const badDeepChild = host(
  'bad-deep-child',
  nestedServer(
    process.env.SERVER3_HOST,
    process.env.SERVER3_PORT,
    process.env.SERVER3_USER_NAME
  )
);
const goodSibling = host(
  'good-sibling',
  nestedServer(
    process.env.SERVER3_HOST,
    process.env.SERVER3_PORT,
    process.env.SERVER3_USER_NAME
  )
);

const badPrimary = host('bad-primary', {
  host: process.env.SERVER3_HOST,
  port: badPort,
  userName: process.env.SERVER3_USER_NAME,
  privateKey,
  passPhrase: process.env.KEY_PASSPHRASE,
});

const fault2 = host('primary2', {
  host: process.env.SERVER2_HOST,
  port: process.env.SERVER2_PORT || process.env.PORT,
  userName: process.env.SERVER2_USER_NAME,
  privateKey,
  passPhrase: process.env.KEY_PASSPHRASE,
});

fault1.hosts = [goodHop, goodSibling];
goodHop.hosts = [badDeep];
badDeep.hosts = [badDeepChild];

const expectedOrder = ['primary1', 'good-hop', 'good-sibling', 'primary2'];
const expectedEnds = [
  'bad-deep',
  'good-hop',
  'good-sibling',
  'primary1',
  'bad-primary',
  'primary2',
];
const expectedErrorCount = 2;

const SSH = new SSH2Shell([fault1, badPrimary, fault2]);

const errors = [];
const ends = [];
SSH.on('msg', log);
SSH.debug = (process.env.DEBUG === 'true');
SSH.verbose = (process.env.VERBOSE === 'true');
SSH.on('error', (err, type) => {
  const error = /** @type {{message?: string} | null | undefined} */ (err);
  const message = error && error.message ? error.message : String(err);
  errors.push(`${type || ''}:${message}`);
  log(`error-event:${type || ''}:${message}`);
});
SSH.on('end', (sessionText, hostConfig) => {
  const name = labels.get(hostConfig) || 'unknown';
  ends.push(name);
  log(`end-event:${name}`);
});

SSH.connect((sessionText) => {
  // Preserve first-seen order and ignore the repeated command echo.
  const order = [];
  for (const match of sessionText.matchAll(/fault:([a-z0-9-]+)/g)) {
    if (order[order.length - 1] !== match[1]) {
      order.push(match[1]);
    }
  }

  const text = `-----Callback session text:\n${sessionText}\n-----Callback end`;
  log(text);
  log(`fault-order:${order.join(',')}`);
  log(`error-count:${errors.length}`);
  log(`end-order:${ends.join(',')}`);
  console.log(text);
  console.log(`fault-order:${order.join(',')}`);
  console.log(`error-count:${errors.length}`);
  console.log(`end-order:${ends.join(',')}`);

  const problems = [];
  if (order.join(',') !== expectedOrder.join(',')) {
    problems.push(
      `expected fault order ${expectedOrder.join(',')} (got ${order.join(',')})`
    );
  }
  if (ends.join(',') !== expectedEnds.join(',')) {
    problems.push(
      `expected end order ${expectedEnds.join(',')} (got ${ends.join(',')})`
    );
  }
  if (errors.length !== expectedErrorCount) {
    problems.push(
      `expected ${expectedErrorCount} error events (got ${errors.length})`
    );
  }

  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(problem);
      log(`fault-expectation:${problem}`);
    }
    console.error(
      'Fault containment expectations are for the ssh2 hop transport; the nested-ssh path is expected to fail this test.'
    );
    process.exitCode = 1;
  }
});
