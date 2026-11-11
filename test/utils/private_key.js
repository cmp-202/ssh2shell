'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Loads the live-test private key. `~` is not expanded by fs, so resolve it
// against the current user's home directory first.
function readPrivateKey() {
  const configured = process.env.PRIVATE_KEY_PATH || '~/.ssh/id_rsa';
  const resolved = path.resolve(
    configured.replace(/^~(?=$|[\\/])/, os.homedir())
  );
  return fs.readFileSync(resolved);
}

module.exports = { readPrivateKey };
