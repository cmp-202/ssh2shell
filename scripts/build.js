'use strict';

// The published artifact is a plain copy of the source. Keeping `lib/`
// committed and in sync means consumers can require the package without a
// build step, while `src/` stays the single source of truth.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'src');
const libDir = path.join(root, 'lib');

fs.copyFileSync(
  path.join(srcDir, 'ssh2shell.js'),
  path.join(libDir, 'ssh2shell.js')
);

const helpersSource = path.join(srcDir, 'ssh2shell');
const helpersTarget = path.join(libDir, 'ssh2shell');
if (fs.existsSync(helpersSource)) {
  fs.rmSync(helpersTarget, { recursive: true, force: true });
  fs.cpSync(helpersSource, helpersTarget, { recursive: true });
}

console.log('Built lib/ from src/');
