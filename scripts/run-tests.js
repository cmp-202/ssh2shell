'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');

// Named targets keep the common cases short; anything else is treated as a
// path relative to the repo root so a single file can be tested as well.
const targets = {
  baseline: path.join(repoRoot, 'test', 'fixtures', 'baseline-ssh2shell.js'),
  lib: path.join(repoRoot, 'lib', 'ssh2shell.js'),
  src: path.join(repoRoot, 'src', 'ssh2shell.js'),
};

const requested = process.argv[2] || 'baseline';
const modulePath = targets[requested] || path.resolve(repoRoot, requested);

const child = spawn(process.execPath, ['--test', 'test/unit'], {
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
