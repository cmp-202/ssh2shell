'use strict';

// The published artifact is a plain copy of the source. Keeping `lib/`
// committed and in sync means consumers can require the package without a
// build step, while `src/` stays the single source of truth.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = path.join(root, 'src', 'ssh2shell.js');
const target = path.join(root, 'lib', 'ssh2shell.js');

fs.copyFileSync(source, target);
console.log('Built lib/ssh2shell.js from src/ssh2shell.js');
