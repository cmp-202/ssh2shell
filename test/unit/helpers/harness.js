'use strict';

const fakeSsh2 = require('./fake-ssh2');

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
  const modulePath = require.resolve('../../../lib/ssh2shell');
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
  createHost,
  delay,
  fakeSsh2,
  installFakeSsh2,
  loadSSH2Shell,
  once,
  waitFor,
};
