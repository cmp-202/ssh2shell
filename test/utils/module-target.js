'use strict';

const path = require('node:path');

const repoRoot = path.join(__dirname, '..', '..');

// Short names keep the common choices readable. Anything else is treated as a
// path relative to the repository root, so a one-off build can be tested too.
const targets = {
  src: path.join(repoRoot, 'src', 'ssh2shell.js'),
  lib: path.join(repoRoot, 'lib', 'ssh2shell.js'),
  baseline: path.join(repoRoot, 'test', 'fixtures', 'baseline-ssh2shell.js'),
};

function resolveTarget(value) {
  const requested = String(value || '').trim();
  if (!requested) {
    return targets.src;
  }

  return targets[requested.toLowerCase()] || path.resolve(repoRoot, requested);
}

module.exports = {
  repoRoot,
  resolveTarget,
  targets,
};
