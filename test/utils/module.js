'use strict';

const { resolveTarget } = require('./module-target');

// Live tests and provisioning load the selected build through this helper.
// `SSH2SHELL_LIVE_MODULE` is an absolute path injected by scripts/run-live.js
// so the runner's instrumentation and the test share one module instance.
// Otherwise `SSH2SHELL_MODULE` chooses src (default), lib, baseline, or a path.
const target = resolveTarget(
  process.env.SSH2SHELL_LIVE_MODULE || process.env.SSH2SHELL_MODULE
);

module.exports = require(target);
