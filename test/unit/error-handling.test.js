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

  it('reports pre-shell connection errors without throwing or closing', () => {
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

    assert.doesNotThrow(() => ssh.connection.emit('error', new Error('boom')));
    assert.equal(errors.length, 1);
    assert.equal(errors[0][1], 'Connection');

    if (isBaseline()) {
      assert.equal(errors[0][2], undefined);
    } else {
      // F1/F2: no live shell stream exists yet, so this is a notification and
      // the guarded default listener must not throw.
      assert.equal(errors[0][2], false);
    }
    assert.equal(ssh._stream.closed, undefined);

    ssh.connection.removeAllListeners();
  });

  it('reports a synchronous connect throw before the shell opens', () => {
    class ThrowConnect extends FakeClient {
      connect() {
        throw new Error('connect boom');
      }
    }

    const ssh = new SSH2Shell(createHost());
    ssh.ssh2Client = ThrowConnect;
    const errors = [];
    ssh.on('error', (...args) => errors.push(args));

    if (isBaseline()) {
      // F3 baseline: the default listener throws on the prototype placeholder
      // before the user listener runs.
      assert.throws(() => ssh.connect(), /_stream\.close is not a function/);
      assert.equal(errors.length, 0);
    } else {
      // F3 current: guarded close, so the error is reported as a notification.
      assert.doesNotThrow(() => ssh.connect());
      assert.equal(errors.length, 1);
      assert.equal(errors[0][1], 'Connection.connect');
      assert.equal(errors[0][2], false);
    }

    ssh.connection.removeAllListeners();
  });

  it('reports missing parameters without closing and runs the callback', async () => {
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
    if (isBaseline()) {
      // F4 baseline: the callback that prints server/commands is never called.
      assert.equal(
        messages.some((message) => message && typeof message === 'object'),
        false
      );
    } else {
      // F4 current: the callback runs with the shell as `this`.
      assert.ok(
        messages.some(
          (message) => Array.isArray(message) && message[0] === 'echo one'
        )
      );
    }
    assert.equal(ssh._stream.closed, undefined);

    ssh.connection.removeAllListeners();
  });

  it('command timeout runs its callback before closing the stream', async () => {
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

    if (isBaseline()) {
      // F4 baseline: the default listener ignores the callback, so the timeout
      // text is not appended to sessionText and the buffer is not cleared.
      assert.equal(ssh._buffer, 'partial output');
      assert.equal(ssh.sshObj.sessionText, 'base');
    } else {
      // F4 current: the callback saves the partial buffer before the close.
      assert.equal(ssh._buffer, '');
      assert.equal(ssh.sshObj.sessionText, 'basepartial output');
    }
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

    // F6: the default listener is tracked separately, so a later host without
    // onError never installs a duplicate.
    assert.equal(ssh.listenerCount('error'), 1);
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

  it('runs the host onError before the default listener closes (F5)', async () => {
    const observed = [];
    let ssh;
    const host = createHost({
      onError: (err, type) => {
        observed.push({ type, closed: ssh._stream.closed });
      },
    });
    ssh = new SSH2Shell(host);
    ssh.connect();
    await waitFor(
      () =>
        ssh._stream &&
        typeof ssh._stream.receive === 'function' &&
        ssh.connection,
      { label: 'stream' }
    );

    // Emit a terminator directly so the test isolates listener order rather
    // than the close flag of a particular source.
    ssh.emit('error', new Error('order boom'), 'Test', true);

    assert.equal(observed.length, 1);
    assert.equal(observed[0].type, 'Test');

    if (isBaseline()) {
      // Baseline: the default listener closes before the host handler runs.
      assert.equal(observed[0].closed, true);
    } else {
      // Current: the host handler observes the live stream before the close.
      assert.equal(observed[0].closed, false);
      assert.equal(ssh._stream.closed, true);
    }
  });

  it('resets the stream reference for each primary host (F10)', () => {
    const first = createHost({ server: { host: 'first.test' } });
    const second = createHost({ server: { host: 'second.test' } });
    const ssh = new SSH2Shell([first, second]);
    const stale = new FakeStream();
    ssh._stream = stale;
    ssh._initiate = () => ssh._stream;

    const result = ssh._nextPrimaryHost(() => {});

    if (isBaseline()) {
      // Baseline keeps the previous host's stream reference.
      assert.equal(result, stale);
    } else {
      assert.notEqual(result, stale);
      assert.equal(typeof result.close, 'undefined');
    }
  });

  it('passes the live connection to the sudo timeout handler (F11)', async () => {
    const host = createHost({
      server: { password: 'secret' },
      onCommandTimeout: () => {},
    });
    const ssh = new SSH2Shell(host);
    ssh.sshObj = host;
    ssh._loadDefaults();
    ssh._stream = new FakeStream();
    ssh.connection = { marker: 'live' };
    ssh.idleTime = 0;
    ssh.command = 'sudo ls';
    ssh._buffer = 'random output';

    const timeouts = [];
    ssh.on('commandTimeout', (...args) => timeouts.push(args));
    processSudo(ssh);
    await delay(10);

    assert.equal(timeouts.length, 1);
    if (isBaseline()) {
      // Baseline passes the never-assigned `this._connection`.
      assert.equal(timeouts[0][3], undefined);
    } else {
      assert.equal(timeouts[0][3], ssh.connection);
    }
    clearTimeout(ssh.idleTimer);
  });
});
