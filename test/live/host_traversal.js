require('dotenv').config();
const { logFile, log } = require('../utils/logging.js');
logFile('host_traversal.js');

/** @type {typeof import('../../index')} */
const SSH2Shell = require('../utils/module.js');
const { readPrivateKey } = require('../utils/private_key.js');

// This test mirrors the host-array shape used in the connection design:
//
//   host1.hosts = [hosta]        hosta.hosts = [hostaa]    hostaa.hosts = [hostaaa]
//   host2.hosts = [hostb,hostc]  hostb.hosts = [hostbb]    hostc.hosts = [hostcc]
//   host3.hosts = [hostd,hoste,hostf]
//   primary list = [host1, host2, host3]
//
// The three test VMs are reused at different depths because the tree only needs
// a parent-child path, not distinct machines. Every host writes a unique
// `traversal:<label>` marker, so the callback session text records the order the
// hosts actually ran in.
//
// Hops are opened with `forwardOut` from the parent connection, so every host
// authenticates with the runner's local key. No key path on the jump host is
// needed.
const privateKey = readPrivateKey();

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
 * @returns {import('../../index').HostConfig}
 */
function host(label, server) {
  return {
    server,
    commands: [`echo traversal:${label}`]
  };
}

const primary1 = host(
  'host1',
  {
    host: process.env.SERVER1_HOST || process.env.HOST,
    port: process.env.SERVER1_PORT || process.env.PORT,
    userName: process.env.SERVER1_USER_NAME || process.env.USER_NAME,
    privateKey,
    passPhrase: process.env.KEY_PASSPHRASE,
  }
);
const hosta = host(
  'hosta',
  nestedServer(
    process.env.SERVER2_HOST,
    process.env.SERVER2_PORT,
    process.env.SERVER2_USER_NAME
  )
);
const hostaa = host(
  'hostaa',
  nestedServer(
    process.env.SERVER3_HOST,
    process.env.SERVER3_PORT,
    process.env.SERVER3_USER_NAME
  )
);
const hostaaa = host(
  'hostaaa',
  nestedServer(
    process.env.SERVER2_HOST,
    process.env.SERVER2_PORT,
    process.env.SERVER2_USER_NAME
  )
);

const primary2 = host(
  'host2',
  {
    host: process.env.SERVER2_HOST,
    port: process.env.SERVER2_PORT || process.env.PORT,
    userName: process.env.SERVER2_USER_NAME,
    privateKey,
    passPhrase: process.env.KEY_PASSPHRASE,
  }
);
const hostb = host(
  'hostb',
  nestedServer(
    process.env.SERVER3_HOST,
    process.env.SERVER3_PORT,
    process.env.SERVER3_USER_NAME
  )
);
const hostbb = host(
  'hostbb',
  nestedServer(
    process.env.SERVER1_HOST || process.env.HOST,
    process.env.SERVER1_PORT || process.env.PORT,
    process.env.SERVER1_USER_NAME || process.env.USER_NAME
  )
);
const hostc = host(
  'hostc',
  nestedServer(
    process.env.SERVER1_HOST || process.env.HOST,
    process.env.SERVER1_PORT || process.env.PORT,
    process.env.SERVER1_USER_NAME || process.env.USER_NAME
  )
);
const hostcc = host(
  'hostcc',
  nestedServer(
    process.env.SERVER2_HOST,
    process.env.SERVER2_PORT,
    process.env.SERVER2_USER_NAME
  )
);

const primary3 = host(
  'host3',
  {
    host: process.env.SERVER3_HOST,
    port: process.env.SERVER3_PORT || process.env.PORT,
    userName: process.env.SERVER3_USER_NAME,
    privateKey,
    passPhrase: process.env.KEY_PASSPHRASE,
  }
);
const hostd = host(
  'hostd',
  nestedServer(
    process.env.SERVER1_HOST || process.env.HOST,
    process.env.SERVER1_PORT || process.env.PORT,
    process.env.SERVER1_USER_NAME || process.env.USER_NAME
  )
);
const hoste = host(
  'hoste',
  nestedServer(
    process.env.SERVER2_HOST,
    process.env.SERVER2_PORT,
    process.env.SERVER2_USER_NAME
  )
);
const hostf = host(
  'hostf',
  nestedServer(
    process.env.SERVER1_HOST || process.env.HOST,
    process.env.SERVER1_PORT || process.env.PORT,
    process.env.SERVER1_USER_NAME || process.env.USER_NAME
  )
);

primary1.hosts = [hosta];
hosta.hosts = [hostaa];
hostaa.hosts = [hostaaa];

primary2.hosts = [hostb, hostc];
hostb.hosts = [hostbb];
hostc.hosts = [hostcc];

primary3.hosts = [hostd, hoste, hostf];

const expectedOrder = [
  'host1',
  'hosta',
  'hostaa',
  'hostaaa',
  'host2',
  'hostb',
  'hostbb',
  'hostc',
  'hostcc',
  'host3',
  'hostd',
  'hoste',
  'hostf',
];

const SSH = new SSH2Shell([primary1, primary2, primary3]);

const ends = [];

SSH.on('msg', log);
SSH.debug = (process.env.DEBUG === 'true');
SSH.verbose = (process.env.VERBOSE === 'true');

SSH.on('error', (err, type) => {
  const error = /** @type {{message?: string} | null | undefined} */ (err);
  log(
    `error-event:${type || ''}:${error && error.message ? error.message : err}`
  );
});

SSH.on('end', (sessionText, host) => {
  ends.push(host && host.server ? host.server.host : 'unknown');
  log(`end-event:${host && host.server ? host.server.host : 'unknown'}`);
});

SSH.connect((sessionText) => {
  // Preserve first-seen order and ignore the repeated command echo.
  const order = [];
  for (const match of sessionText.matchAll(/traversal:([a-z0-9]+)/g)) {
    if (order[order.length - 1] !== match[1]) {
      order.push(match[1]);
    }
  }

  const text = `-----Callback session text:\n${sessionText}\n-----Callback end`;
  log(text);
  log(`traversal-order:${order.join(',')}`);
  log(`end-order:${ends.join(',')}`);
  console.log(text);
  console.log(`traversal-order:${order.join(',')}`);
  console.log(`end-order:${ends.join(',')}`);

  if (order.join(',') !== expectedOrder.join(',')) {
    console.error(`Expected traversal order: ${expectedOrder.join(',')}`);
    process.exitCode = 1;
  }
});
