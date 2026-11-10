'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  installFakeSsh2,
  loadSSH2Shell,
  createHost,
  isBaseline,
  waitFor,
  delay,
} = require('./helpers/harness');
const { FakeClient, FakeStream } = require('./helpers/fake-ssh2');

installFakeSsh2();
const SSH2Shell = loadSSH2Shell();

async function connected(overrides = {}, callback) {
  const host = createHost(overrides);
  const ssh = new SSH2Shell(host);
  ssh.connect(callback);
  await waitFor(
    () =>
      ssh._stream &&
      typeof ssh._stream.receive === 'function' &&
      ssh.connection,
    { label: 'stream' }
  );
  return { ssh, host };
}

function processSudo(ssh) {
  if (typeof ssh._processSudoPrompt === 'function') {
    return ssh._processSudoPrompt();
  }
  return ssh._processPasswordPrompt();
}

function sudoFailure(debug) {
  const host = createHost({ debug });
  const ssh = new SSH2Shell(host);
  ssh.sshObj = host;
  ssh._loadDefaults();
  ssh._stream = new FakeStream();

  const errors = [];
  const messages = [];
  ssh.on('error', (...args) => errors.push(args));
  ssh.on('msg', (message) => messages.push(message));

  ssh.command = 'sudo ls';
  ssh._buffer = 'Password: ';
  ssh.sshObj.pwSent = true;

  processSudo(ssh);

  return { ssh, errors, messages };
}

describe('error handling and connection termination', () => {
  it('closes the stream for connection errors only on current L5', async () => {
    const { ssh } = await connected();
    const errors = [];
    ssh.on('error', (...args) => errors.push(args));

    ssh.connection.emit('error', new Error('conn boom'));

    const args = errors.find(
      (entry) => entry[0] instanceof Error && entry[0].message === 'conn boom'
    );
    assert.ok(args);
    assert.equal(args[1], 'Connection');

    if (isBaseline()) {
      // Baseline only reports the error; the stream and connection stay open.
      assert.equal(args[2], undefined);
      assert.equal(ssh._stream.closed, false);
      ssh._removeListeners();
      ssh.close();
    } else {
      // L5 passes close=true, so the stream is closed and connection.end() runs.
      assert.equal(args[2], true);
      assert.equal(ssh._stream.closed, true);
    }
  });

  it('closes the stream for stream errors only on current L5', async () => {
    const { ssh } = await connected();
    const errors = [];
    ssh.on('error', (...args) => errors.push(args));

    ssh._stream.emit('error', new Error('stream boom'));

    const args = errors.find(
      (entry) =>
        entry[0] instanceof Error && entry[0].message === 'stream boom'
    );
    assert.ok(args);
    assert.equal(args[1], 'Stream');

    if (isBaseline()) {
      assert.equal(args[2], undefined);
      assert.equal(ssh._stream.closed, false);
      ssh._removeListeners();
      ssh.close();
    } else {
      assert.equal(args[2], true);
      assert.equal(ssh._stream.closed, true);
    }
  });

  it('pre-shell connection errors throw on current L5 but not on baseline', () => {
    class NoReady extends FakeClient {
      constructor() {
        super();
        this.autoReady = false;
      }
    }

    const ssh = new SSH2Shell(createHost());
    ssh.ssh2Client = NoReady;
    const errors = [];
    ssh.on('error', (...args) => errors.push(args));
    ssh.connect();

    if (isBaseline()) {
      assert.doesNotThrow(() => ssh.connection.emit('error', new Error('boom')));
      assert.equal(errors.length, 1);
      assert.equal(errors[0][1], 'Connection');
    } else {
      // F1: close=true reaches the prototype `{}` placeholder, which has no
      // close method. The default listener throws before the user listener runs.
      assert.throws(
        () => ssh.connection.emit('error', new Error('boom')),
        /this\._stream\.close is not a function/
      );
      assert.equal(errors.length, 0);
    }

    ssh.connection.removeAllListeners();
  });

  it('cannot report a synchronous connect throw before the shell opens', () => {
    class ThrowConnect extends FakeClient {
      connect() {
        throw new Error('connect boom');
      }
    }

    const ssh = new SSH2Shell(createHost());
    ssh.ssh2Client = ThrowConnect;
    const errors = [];
    ssh.on('error', (...args) => errors.push(args));

    // F3: shared by baseline and current. The default listener throws on the
    // prototype placeholder before the user listener runs.
    assert.throws(
      () => ssh.connect(),
      /_stream\.close is not a function/
    );
    assert.equal(errors.length, 0);

    ssh.connection.removeAllListeners();
  });

  it('reports missing parameters without closing or running the callback', async () => {
    const ssh = new SSH2Shell(createHost());
    // `_loadDefaults` supplies defaults, so exercise `_connect` directly with
    // no server object to reach the missing-parameters branch.
    ssh.sshObj = { commands: ['echo one'] };
    ssh.removeAllListeners('msg');

    const errors = [];
    const messages = [];
    ssh.on('error', (...args) => errors.push(args));
    ssh.on('msg', (message) => messages.push(message));

    ssh._connect();
    await delay(10);

    const args = errors.find(
      (entry) => entry[0] === 'Missing connection parameters'
    );
    assert.ok(args);
    assert.equal(args[1], 'Parameters');
    assert.equal(args[2], false);
    assert.equal(typeof args[3], 'function');
    assert.ok(messages.includes('Parameters error: Missing connection parameters'));
    // F4: the callback that would print server/commands is never called.
    assert.equal(messages.some((message) => message && typeof message === 'object'), false);
    assert.equal(ssh._stream.closed, undefined);

    ssh.connection.removeAllListeners();
  });

  it('command timeout closes the stream but drops its callback', async () => {
    const { ssh } = await connected();
    ssh._buffer = 'partial output';
    ssh.sshObj.sessionText = 'base';

    const errors = [];
    ssh.on('error', (...args) => errors.push(args));

    ssh.sshObj.onCommandTimeout(
      'echo one',
      'echo onepartial output',
      ssh._stream,
      ssh.connection
    );
    await delay(10);

    const args = errors.find(
      (entry) => entry[1] === 'Command Timeout' || entry[1] === 'Timeout'
    );
    assert.ok(args);
    assert.equal(args[2], true);
    assert.equal(typeof args[3], 'function');
    // F4: the default listener ignores the callback, so the timeout text is
    // not appended to sessionText and the buffer is not cleared.
    assert.equal(ssh._buffer, 'partial output');
    assert.equal(ssh.sshObj.sessionText, 'base');
    assert.equal(ssh._stream.closed, true);
  });

  it('reports a connection close error but still finishes the session', async () => {
    let callbackValue;
    const { ssh } = await connected({}, (value) => {
      callbackValue = value;
    });

    const errors = [];
    ssh.on('error', (...args) => errors.push(args));

    ssh.connection.emit('close', true);

    await waitFor(() => callbackValue !== undefined, { label: 'callback' });

    const args = errors.find((entry) => entry[1] === 'Connection close');
    assert.ok(args);
    assert.equal(args[0], true);
    assert.equal(args[2], undefined);
    assert.equal(callbackValue, '');
  });

  it('reports sudo authentication failures as a notification', () => {
    const quiet = sudoFailure(false);
    assert.equal(quiet.errors.length, 0);
    assert.equal(quiet.ssh._stream.closed, false);
    assert.deepEqual(quiet.ssh._stream.writes, ['\x03']);

    const loud = sudoFailure(true);
    assert.equal(loud.ssh._stream.closed, false);

    if (isBaseline()) {
      assert.ok(loud.errors.length >= 1);
    } else {
      // Current: a rejected sudo password is a debug notification, not an error.
      assert.equal(loud.errors.length, 0);
      assert.ok(
        loud.messages.some((message) =>
          String(message).includes('Password was incorrect for tester')
        )
      );
    }
  });

  it('tracks default error listeners across hosts (F6)', () => {
    const withError = createHost({ onError: () => {} });
    const ssh = new SSH2Shell(withError);
    ssh.sshObj = withError;

    assert.equal(ssh.listenerCount('error'), 1);
    ssh._loadDefaults();
    assert.equal(ssh.listenerCount('error'), 2);

    ssh._removeListeners();
    assert.equal(ssh.listenerCount('error'), 1);

    ssh.sshObj = createHost();
    ssh._loadDefaults();

    if (isBaseline()) {
      assert.equal(ssh.listenerCount('error'), 1);
    } else {
      // F6: the cache entry was cleared when the host handler was removed, so
      // the next host without onError installs another default listener.
      assert.equal(ssh.listenerCount('error'), 2);
    }
  });

  it('shell errors close the stream when ssh2 supplies one', async () => {
    class ShellError extends FakeClient {
      shell(window, options, callback) {
        const stream = new FakeStream();
        this.stream = stream;
        process.nextTick(() => callback(new Error('shell boom'), stream));
        return stream;
      }

      connect(config) {
        this.config = config;
        process.nextTick(() => {
          this.emit('connect');
          this.emit('ready');
        });
      }
    }

    const ssh = new SSH2Shell(createHost());
    ssh.ssh2Client = ShellError;
    const errors = [];
    ssh.on('error', (...args) => errors.push(args));
    ssh.connect();

    await waitFor(() => errors.some((entry) => entry[1] === 'Shell'), {
      label: 'shell error',
    });

    assert.equal(ssh._stream.closed, true);
  });
});
