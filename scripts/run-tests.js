'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const unitDir = path.join(repoRoot, 'test', 'unit');

// Named targets keep the common cases short; anything else is treated as a
// path relative to the repo root so a single file can be tested as well.
const targets = {
  baseline: path.join(repoRoot, 'test', 'fixtures', 'baseline-ssh2shell.js'),
  lib: path.join(repoRoot, 'lib', 'ssh2shell.js'),
  src: path.join(repoRoot, 'src', 'ssh2shell.js'),
};

const requested = process.argv[2] || 'baseline';
const modulePath = targets[requested] || path.resolve(repoRoot, requested);

// Pass explicit files instead of a directory: `node --test <dir>` only became
// reliable in later Node releases, while explicit file lists work on Node 18.
function testFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return testFiles(full);
      }
      return entry.name.endsWith('.test.js') ? [full] : [];
    })
    .sort();
}

const files = testFiles(unitDir);

if (files.length === 0) {
  console.error(`No test files found under ${unitDir}`);
  process.exit(1);
}

const child = spawn(process.execPath, ['--test', ...files], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: Object.assign({}, process.env, {
    SSH2SHELL_TEST_MODULE: modulePath,
  }),
});

child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code === null ? 1 : code;
});
