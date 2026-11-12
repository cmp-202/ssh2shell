'use strict';

// Preloaded by scripts/run-live.js before each live test.
//
// Live tests only call `connect(callback)` and most of them never attach an
// `error` listener. A failed connection still reaches the callback with empty
// session text, so the process exit code alone cannot tell pass from fail.
// This module wraps `connect` on the library instance and records whether the
// callback ran, how much session text it received, and any `error` events.
// The runner reads the JSON result after the child exits.

const fs = require('node:fs');

const modulePath = process.env.SSH2SHELL_LIVE_MODULE;
const resultPath = process.env.SSH2SHELL_LIVE_RESULT;

const result = {
  callbackFired: false,
  sessionText: '',
  sessionTextLength: 0,
  errors: [],
};

if (modulePath && resultPath) {
  const SSH2Shell = require(modulePath);
  const originalConnect = SSH2Shell.prototype.connect;

  SSH2Shell.prototype.connect = function connect(callback) {
    this.on('error', (err, type) => {
      result.errors.push({
        type: type ? String(type) : '',
        message: err instanceof Error ? err.message : String(err),
      });
    });

    const wrapped =
      typeof callback === 'function'
        ? (sessionText) => {
            const text = String(sessionText || '');
            result.callbackFired = true;
            // Cap the copy so a very chatty test cannot produce a huge result
            // file. The length is kept separately for the empty check.
            result.sessionText = text.slice(0, 500000);
            result.sessionTextLength = text.length;
            return callback(sessionText);
          }
        : callback;

    return originalConnect.call(this, wrapped);
  };
}

function writeResult() {
  if (!resultPath) {
    return;
  }

  try {
    fs.writeFileSync(resultPath, JSON.stringify(result), 'utf8');
  } catch (error) {
    // The runner reports a missing result file as a failure.
  }
}

process.on('exit', writeResult);
