'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  installFakeSsh2,
  isBaseline,
  loadSSH2Shell,
  createHost,
} = require('./helpers/harness');
const { redactCredentials } = require('../../lib/ssh2shell/util.js');

installFakeSsh2();
const SSH2Shell = loadSSH2Shell();

// These tests cover current-only safety behaviour. The frozen baseline has
// neither the record helpers nor the redaction utility.
const newOnly = isBaseline() ? it.skip : it;

function make(overrides = {}) {
  const host = createHost(overrides);
  const ssh = new SSH2Shell(host);
  ssh.sshObj = host;
  ssh._loadDefaults();
  return { ssh, host };
}

describe('behaviour hardening', () => {
  newOnly('marks circular references in redacted config dumps', () => {
    const host = createHost({
      verbose: true,
      server: { host: 'circle.test', password: 'secret' },
    });
    host.server.self = host;

    const copy = redactCredentials(host);

    assert.equal(copy.server.self, '[Circular]');
    assert.equal(copy.server.password, '[REDACTED]');
    assert.equal(copy.server.host, 'circle.test');
  });

  newOnly('preserves non-plain objects in redacted config dumps', () => {
    const socket = new EventEmitter();
    const config = {
      server: { host: 'objects.test', password: 'secret' },
      socket,
      data: Buffer.from('raw'),
      nested: { value: 1 },
    };

    const copy = redactCredentials(config);

    assert.equal(copy.socket, socket);
    assert.equal(copy.data, config.data);
    assert.notEqual(copy.nested, config.nested);
    assert.deepEqual(copy.nested, { value: 1 });
    assert.equal(copy.server.password, '[REDACTED]');
  });

  newOnly('ignores data received after close or after the active host changes', () => {
    const originalSetTimeout = global.setTimeout;
    const timers = [];
    global.setTimeout = (callback) => {
      timers.push(callback);
      return { unref() {} };
    };

    try {
      const { ssh } = make();
      const first = ssh._pushContext(
        createHost({ server: { host: 'first.test' } }),
        null
      );
      ssh.command = '';
      ssh._onData('first data');
      assert.equal(timers.length, 1);

      first.closed = true;
      let processed = 0;
      ssh._scheduleIdleTimeout = () => {
        processed += 1;
      };
      timers[0]();
      assert.equal(processed, 0);
      assert.equal(ssh._buffer, 'first data');

      const { ssh: secondSsh } = make();
      const second = secondSsh._pushContext(
        createHost({ server: { host: 'second.test' } }),
        null
      );
      const secondTimers = [];
      const savedSetTimeout = global.setTimeout;
      global.setTimeout = (callback) => {
        secondTimers.push(callback);
        return { unref() {} };
      };
      secondSsh.command = '';
      secondSsh._onData('second data');
      global.setTimeout = savedSetTimeout;
      secondSsh._pushContext(
        createHost({ server: { host: 'other.test' } }),
        null
      );
      let secondProcessed = 0;
      secondSsh._scheduleIdleTimeout = () => {
        secondProcessed += 1;
      };
      secondTimers[0]();
      assert.equal(secondProcessed, 0);
      assert.equal(secondSsh._buffer, 'second data');
      assert.ok(second);
    } finally {
      global.setTimeout = originalSetTimeout;
    }
  });

  newOnly('closes descendants before a failed record', () => {
    const { ssh, host } = make();
    const context = ssh._pushContext(host, null);
    const middle = ssh._pushContext(
      createHost({ server: { host: 'middle.test' } }),
      context
    );
    const deepest = ssh._pushContext(
      createHost({ server: { host: 'deepest.test' } }),
      middle
    );
    ssh._connections = [context, middle];
    ssh._active = deepest;
    context.isPrimary = false;

    const closed = [];
    ssh._closeContext = (record, reason) => {
      closed.push([record.host.server.host, reason]);
    };
    ssh._popTo = () => 'popped';
    ssh._runExit = () => 'exit';

    assert.equal(ssh._failContext(context, new Error('boom'), 'failure'), 'exit');
    assert.equal(context.failing, true);
    assert.deepEqual(closed, [
      ['deepest.test', 'ancestor-failed'],
      ['middle.test', 'ancestor-failed'],
      ['example.test', 'failure'],
    ]);

    closed.length = 0;
    ssh._failContext(context, new Error('again'), 'duplicate');
    assert.deepEqual(closed, []);
  });

  newOnly('forces a close when the close timer fires', () => {
    const { ssh } = make();
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    let timerCallback = null;

    global.setTimeout = (callback) => {
      timerCallback = callback;
      return { unref() {} };
    };
    global.clearTimeout = () => {};

    try {
      ssh.idleTime = 100;
      ssh._armCloseTimer();
      assert.equal(typeof timerCallback, 'function');

      let closes = 0;
      ssh._closeStreamNow = () => {
        closes += 1;
        return 'closed';
      };

      timerCallback();

      assert.equal(closes, 1);
      assert.equal(ssh._closeTimer, null);
      assert.equal(ssh._forceClose(), 'closed');
      assert.equal(closes, 2);
    } finally {
      global.setTimeout = originalSetTimeout;
      global.clearTimeout = originalClearTimeout;
    }
  });
});
