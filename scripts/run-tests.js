'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const baselineModule = path.join(
  repoRoot,
  'test',
  'fixtures',
  'baseline-ssh2shell.js'
);

const child = spawn(process.execPath, ['--test', 'test/unit'], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: Object.assign({}, process.env, {
    SSH2SHELL_TEST_MODULE: baselineModule,
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
