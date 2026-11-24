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
      return /** @type {any} */ ({ unref() {} });
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
        return /** @type {any} */ ({ unref() {} });
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
      return /** @type {any} */ ({ unref() {} });
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

  newOnly('redacts credential fields on class instances', () => {
    class SecureConfig {
      constructor() {
        this.host = 'secure.test';
        this.password = 'hunter2';
        this.nested = { value: 1 };
      }
    }

    const copy = redactCredentials(new SecureConfig());

    assert.notEqual(copy.host, undefined);
    assert.equal(copy.host, 'secure.test');
    assert.equal(copy.password, '[REDACTED]');
    assert.deepEqual(copy.nested, { value: 1 });
  });

  newOnly('reapplies the override when restoring an ancestor', () => {
    const parentHost = createHost({
      server: { host: 'parent.test' },
      debug: true,
    });
    const { ssh } = make();
    const parent = ssh._pushContext(parentHost, null);
    parent.debug = true;
    ssh._pushContext(createHost({ server: { host: 'child.test' } }), parent);

    ssh.debug = false;
    assert.equal(ssh.debug, false);
    ssh._restoreContext(parent);
    assert.equal(ssh.debug, false);

    ssh.debug = undefined;
    ssh._restoreContext(parent);
    assert.equal(ssh.debug, true);
  });

  newOnly('restores the active host value when clearing an override', () => {
    const { ssh } = make({ debug: true, verbose: true });

    ssh.debug = false;
    ssh.verbose = false;
    assert.equal(ssh.debug, false);
    assert.equal(ssh.verbose, false);

    ssh.debug = undefined;
    ssh.verbose = undefined;
    assert.equal(ssh.debug, true);
    assert.equal(ssh.verbose, true);
  });

  newOnly('clears the close timer when moving to the next primary', () => {
    const { ssh, host } = make();
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = /** @type {any} */ (() => ({ unref() {} }));

    try {
      ssh._armCloseTimer();
      assert.ok(ssh._closeTimer);

      ssh._hosts = [host];
      ssh._closeAllContexts = () => {};
      ssh._progressEnd = () => {};
      const connect = () => 'connected';

      assert.equal(ssh._nextPrimaryHost(connect), 'connected');
      assert.equal(ssh._closeTimer, null);
    } finally {
      global.setTimeout = originalSetTimeout;
    }
  });

  newOnly('redacts nested credentials and cycles on class instances', () => {
    class SecureConfig {
      constructor() {
        this.host = 'secure.test';
        this.password = 'hunter2';
        this.nested = { password: 'inner-secret' };
      }
    }

    const config = new SecureConfig();
    config.self = config;
    config.stream = new EventEmitter();
    config.data = Buffer.from('raw');

    const copy = redactCredentials(config);

    assert.equal(copy.password, '[REDACTED]');
    assert.equal(copy.nested.password, '[REDACTED]');
    assert.equal(copy.self, '[Circular]');
    assert.equal(copy.stream, config.stream);
    assert.equal(copy.data, config.data);
  });

  newOnly('uses host config when restoring after an override is cleared', () => {
    const parentHost = createHost({
      server: { host: 'parent.test' },
      debug: true,
    });
    const childHost = createHost({
      server: { host: 'child.test' },
      debug: false,
    });
    const ssh = new SSH2Shell(parentHost);
    ssh.sshObj = parentHost;
    ssh.debug = false;
    ssh._loadDefaults();
    const parent = ssh._activeContext();

    ssh._pushContext(childHost, parent);
    ssh.debug = undefined;
    assert.equal(ssh.debug, false);

    ssh._restoreContext(parent);
    assert.equal(ssh.debug, true);
    assert.equal(ssh.verbose, false);
  });

  newOnly('keeps the configured flag type when an override is cleared', () => {
    const { ssh } = make({ debug: 'yes', verbose: 'yes' });
    assert.equal(ssh.debug, 'yes');
    assert.equal(ssh.verbose, 'yes');

    ssh.debug = undefined;
    ssh.verbose = undefined;
    assert.equal(ssh.debug, 'yes');
    assert.equal(ssh.verbose, 'yes');
  });
});
