'use strict';

const path = require('node:path');

const fakeSsh2 = require('./fake-ssh2');

const repoRoot = path.join(__dirname, '..', '..', '..');
const currentModulePath = path.join(repoRoot, 'lib', 'ssh2shell.js');
const baselineModulePath = path.join(
  repoRoot,
  'test',
  'fixtures',
  'baseline-ssh2shell.js'
);

/**
 * Tests run against the current build by default. Set SSH2SHELL_TEST_MODULE to
 * the frozen baseline fixture to run the same characterizations against the
 * original JavaScript artifact.
 */
function targetModulePath() {
  return process.env.SSH2SHELL_TEST_MODULE || currentModulePath;
}

function isBaseline() {
  return (
    path.resolve(targetModulePath()) === path.resolve(baselineModulePath)
  );
}

/**
 * Replace the real ssh2 module in the require cache. ssh2shell resolves
 * `require('ssh2').Client` in its constructor, so installing this before
 * constructing an instance is enough to keep the tests offline.
 */
function installFakeSsh2(fake = fakeSsh2) {
  const ssh2Path = require.resolve('ssh2');
  const previous = require.cache[ssh2Path];

  require.cache[ssh2Path] = {
    id: ssh2Path,
    filename: ssh2Path,
    loaded: true,
    exports: fake,
  };

  return function restore() {
    if (previous) {
      require.cache[ssh2Path] = previous;
    } else {
      delete require.cache[ssh2Path];
    }
  };
}

function loadSSH2Shell() {
  const modulePath = targetModulePath();
  delete require.cache[modulePath];
  return require(modulePath);
}

function createHost(overrides = {}) {
  const server = Object.assign(
    {
      host: 'example.test',
      port: 22,
      userName: 'tester',
      password: 'secret',
    },
    overrides.server || {}
  );

  return Object.assign(
    {
      server,
      commands: ['echo one'],
      dataIdleTime: 5,
      idleTimeOut: 50,
      msg: function noop() {},
    },
    overrides,
    { server }
  );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitFor(predicate, options = {}) {
  const timeout = options.timeout || 2000;
  const interval = options.interval || 5;
  const label = options.label || 'condition';
  const started = Date.now();

  return new Promise((resolve, reject) => {
    function tick() {
      let value;
      try {
        value = predicate();
      } catch (error) {
        reject(error);
        return;
      }

      if (value) {
        resolve(value);
        return;
      }

      if (Date.now() - started >= timeout) {
        reject(new Error('Timed out waiting for ' + label));
        return;
      }

      setTimeout(tick, interval);
    }

    tick();
  });
}

function waitForStream(ssh, options = {}) {
  return waitFor(
    () =>
      ssh._stream &&
      typeof ssh._stream.receive === 'function' &&
      ssh.connection,
    Object.assign({ label: 'stream' }, options)
  );
}

/**
 * The baseline exposes the sudo handler as _processPasswordPrompt; L5 renamed
 * it to _processSudoPrompt to match its actual purpose.
 */
function processSudo(ssh) {
  if (typeof ssh._processSudoPrompt === 'function') {
    return ssh._processSudoPrompt();
  }
  return ssh._processPasswordPrompt();
}

function once(emitter, event, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.removeListener(event, onEvent);
      reject(new Error('Timed out waiting for event: ' + event));
    }, timeout);

    function onEvent() {
      clearTimeout(timer);
      resolve(Array.from(arguments));
    }

    emitter.once(event, onEvent);
  });
}

module.exports = {
  baselineModulePath,
  createHost,
  currentModulePath,
  delay,
  fakeSsh2,
  installFakeSsh2,
  isBaseline,
  loadSSH2Shell,
  once,
  processSudo,
  waitFor,
  waitForStream,
};
