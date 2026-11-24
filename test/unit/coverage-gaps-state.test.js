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
const { FakeStream } = require('./helpers/fake-ssh2');

installFakeSsh2();
const SSH2Shell = loadSSH2Shell();

// These tests drive record/transport guard branches that only exist in the
// current forwardOut implementation.
const newOnly = isBaseline() ? it.skip : it;

function make(overrides = {}) {
  const host = createHost(overrides);
  const ssh = new SSH2Shell(host);
  ssh.sshObj = host;
  ssh._loadDefaults();
  ssh._stream = new FakeStream();
  return { ssh, host };
}

/** @returns {any} */
function shellConnection(stream) {
  return {
    shell(window, callback) {
      if (typeof window === 'function') callback = window;
      callback(null, stream);
    },
  };
}

describe('coverage gaps: state and transport guards', () => {
  newOnly('closes a shell stream that arrives after its context is closed', () => {
    const { ssh, host } = make();
    const context = ssh._pushContext(host, null);
    context.closed = true;

    const stream = new FakeStream();
    context.connection = shellConnection(stream);
    let closeAttempts = 0;
    const close = stream.close.bind(stream);
    stream.close = () => {
      closeAttempts += 1;
      close();
    };

    ssh._openShell(context);

    assert.equal(closeAttempts, 1);
  });

  newOnly('ignores closed stream errors and contains hop stream errors', () => {
    const { ssh, host } = make();
    const context = ssh._pushContext(host, null);
    context.isPrimary = false;

    const failures = [];
    ssh._hopFailed = (failedContext, error) => failures.push(error.message);

    const stream = new FakeStream();
    context.connection = shellConnection(stream);
    ssh._openShell(context);

    context.closed = true;
    // noinspection JSCheckFunctionSignatures
    stream.emit('error', new Error('stale stream error'));
    assert.deepEqual(failures, []);

    context.closed = false;
    // noinspection JSCheckFunctionSignatures
    stream.emit('error', new Error('hop stream error'));
    assert.deepEqual(failures, ['hop stream error']);
  });

  newOnly('ignores stderr data from a stream that is no longer active', () => {
    const { ssh, host } = make();
    const context = ssh._pushContext(host, null);
    const stream = new FakeStream();
    context.connection = shellConnection(stream);
    ssh._openShell(context);

    const captured = [];
    ssh._captureStderr = (data) => captured.push(data);
    ssh._active = null;

    stream.stderr.emit('data', 'ignored stderr');

    assert.deepEqual(captured, []);
  });

  newOnly('reports a throwing data listener for a primary host', () => {
    const { ssh, host } = make();
    const context = ssh._pushContext(host, null);
    const errors = [];
    ssh.on('error', (...args) => errors.push(args));

    const stream = new FakeStream();
    context.connection = shellConnection(stream);
    ssh._openShell(context);
    ssh.prependListener('data', () => {
      throw new Error('listener boom');
    });

    // noinspection JSCheckFunctionSignatures
    stream.emit('data', 'command output');

    const args = errors.find((entry) => entry[1] === 'Stream.read error');
    assert.ok(args);
    assert.equal(args[0].level, 'Data handling');
  });

  newOnly('contains a throwing data listener on a hop', () => {
    const { ssh, host } = make();
    const context = ssh._pushContext(host, null);
    context.isPrimary = false;

    const failures = [];
    ssh._hopFailed = (failedContext, error) => failures.push(error.message);

    const stream = new FakeStream();
    context.connection = shellConnection(stream);
    ssh._openShell(context);
    ssh.prependListener('data', () => {
      throw new Error('listener boom');
    });

    // noinspection JSCheckFunctionSignatures
    stream.emit('data', 'hop output');

    assert.equal(failures.length, 1);
    assert.match(failures[0], /listener boom/);
  });

  newOnly('returns the placeholder stream when a run is already stopping', () => {
    const { ssh } = make();
    ssh._stopping = true;
    assert.equal(ssh._connect(), ssh._stream);
  });

  newOnly('contains a hop that has no parent connection', () => {
    const { ssh } = make();
    ssh.sshObj = createHost({ server: { host: 'hop.test' } });
    const parent = ssh._pushContext(createHost(), null);
    parent.connection = null;

    const failures = [];
    ssh._hopFailed = (failedContext, error) => failures.push(error.message);

    ssh._connect(parent);

    assert.deepEqual(failures, ['No parent connection for host hop']);
  });

  newOnly('closes a channel safely when a forwardOut context is already closed', () => {
    const { ssh } = make();
    ssh.sshObj = createHost({ server: { host: 'hop.test' } });

    let completeForwardOut;
    const parent = ssh._pushContext(createHost(), null);
    parent.connection = /** @type {any} */ ({
      forwardOut(srcIP, srcPort, dstIP, dstPort, callback) {
        completeForwardOut = callback;
      },
    });

    ssh._connect(parent);
    const child = ssh._activeContext();
    child.closed = true;

    let closeAttempts = 0;
    completeForwardOut(null, {
      close() {
        closeAttempts += 1;
        throw new Error('channel already gone');
      },
    });

    assert.equal(closeAttempts, 1);
  });

  newOnly('fails the child context when stop happens during forwardOut', () => {
    const { ssh } = make();
    ssh.sshObj = createHost({ server: { host: 'hop.test' } });

    let completeForwardOut;
    const parent = ssh._pushContext(createHost(), null);
    parent.connection = /** @type {any} */ ({
      forwardOut(srcIP, srcPort, dstIP, dstPort, callback) {
        completeForwardOut = callback;
      },
    });

    ssh._connect(parent);
    const child = ssh._activeContext();
    ssh._stopping = true;

    let failure = null;
    ssh._failContext = (context, error, reason) => {
      failure = { context, error, reason };
      return 'failed';
    };

    let closeAttempts = 0;
    const result = completeForwardOut(null, {
      close() {
        closeAttempts += 1;
        throw new Error('channel already gone');
      },
    });

    assert.equal(result, 'failed');
    assert.equal(closeAttempts, 1);
    assert.equal(failure.context, child);
    assert.equal(failure.reason, 'cancelled');
  });

  newOnly('ignores stale connection events and contains hop failures', () => {
    const { ssh, host } = make();
    const context = ssh._pushContext(host, null);
    context.isPrimary = false;

    const connection = new EventEmitter();
    context.connection = /** @type {any} */ (connection);
    const failures = [];
    ssh._hopFailed = (failedContext, error) => failures.push(error.message);
    ssh._appendPartial = () => {};
    ssh._bindConnection(context);

    context.closed = true;
    connection.emit('keyboard-interactive', 'sshd', '', 'en', [], () => {});
    connection.emit('connect');
    connection.emit('ready');
    connection.emit('error', new Error('stale connection error'));
    assert.deepEqual(failures, []);

    context.closed = false;
    ssh._active = null;
    connection.emit('keyboard-interactive', 'sshd', '', 'en', [], () => {});
    ssh._active = context;

    connection.emit('error', new Error('hop connection error'));
    ssh._closing = true;
    connection.emit('close', false);
    ssh._closing = false;
    connection.emit('close', false);

    assert.deepEqual(failures, [
      'hop connection error',
      'Connection closed',
    ]);
  });

  newOnly('restores a manually built parent stack in previousHost', () => {
    const { ssh } = make();
    ssh._stopping = true;
    assert.equal(ssh._previousHost(), undefined);
    ssh._stopping = false;

    const parentHost = createHost({ server: { host: 'parent.test' } });
    const parent = ssh._pushContext(parentHost, null);
    parent.command = 'parent command';
    parent.buffer = 'parent buffer';

    ssh._active = null;
    ssh._connections = [parent];
    ssh.sshObj = createHost({ server: { host: 'child.test' } });

    const finalized = [];
    let removed = 0;
    ssh._finalizeHost = (host, reason) => finalized.push([host, reason]);
    ssh._removeListeners = () => {
      removed += 1;
    };
    ssh._runExit = () => 'exit';

    assert.equal(ssh._previousHost(), 'exit');
    assert.equal(ssh._active, parent);
    assert.equal(ssh.sshObj, parentHost);
    assert.equal(finalized.length, 1);
    assert.equal(removed, 1);
  });

  newOnly('exits checkCommand on closing, stopping, and empty command states', () => {
    const { ssh } = make();
    let exits = 0;
    ssh._runExit = () => {
      exits += 1;
      return 'exit';
    };

    ssh._closing = true;
    assert.equal(ssh._checkCommand(), undefined);

    ssh._closing = false;
    ssh._stopping = true;
    assert.equal(ssh._checkCommand(), 'exit');

    ssh._stopping = false;
    ssh.command = '';
    assert.equal(ssh._checkCommand(), 'exit');

    assert.equal(exits, 2);
  });
});
