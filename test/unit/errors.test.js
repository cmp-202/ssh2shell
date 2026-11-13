'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  installFakeSsh2,
  isBaseline,
  loadSSH2Shell,
  createHost,
  waitFor,
  waitForStream,
  delay,
} = require('./helpers/harness');

installFakeSsh2();
const SSH2Shell = loadSSH2Shell();

async function connected(overrides = {}) {
  const host = createHost(overrides);
  const ssh = new SSH2Shell(host);
  ssh.connect();
  await waitForStream(ssh);
  return { ssh, host };
}

describe('error and stream lifecycle', () => {
  it('re-emits connection errors', async () => {
    const { ssh } = await connected();
    const errors = [];
    ssh.on('error', (...args) => errors.push(args));

    ssh.connection.emit('error', new Error('boom'));

    assert.ok(
      errors.some(
        (args) =>
          args[0] instanceof Error &&
          args[0].message === 'boom' &&
          args[1] === 'Connection'
      )
    );

    ssh._removeListeners();
    ssh.close();
  });

  it('re-emits stream errors', async () => {
    const { ssh } = await connected();
    const errors = [];
    ssh.on('error', (...args) => errors.push(args));

    ssh._stream.emit('error', new Error('stream boom'));

    assert.ok(
      errors.some(
        (args) =>
          args[0] instanceof Error &&
          args[0].message === 'stream boom' &&
          args[1] === 'Stream'
      )
    );

    ssh._removeListeners();
    ssh.close();
  });

  it('re-emits stderr data', async (t) => {
    t.mock.method(console, 'error', () => {});
    const { ssh } = await connected();
    const chunks = [];
    ssh.on('stderrData', (data) => chunks.push(data));

    ssh._stream.stderrData('oops');

    assert.deepEqual(chunks, ['oops']);

    ssh._removeListeners();
    ssh.close();
  });

  it('calls the connect callback when the connection closes', async () => {
    const host = createHost();
    const ssh = new SSH2Shell(host);
    let text;
    ssh.connect((value) => {
      text = value;
    });

    await waitForStream(ssh);
    ssh.connection.emit('close', false);

    await waitFor(() => text !== undefined, { label: 'callback' });
    if (isBaseline()) {
      assert.equal(text, '');
    } else {
      // R5 finalizes the host on a connection close, so the callback receives
      // the host-prefixed session text instead of an empty string.
      assert.equal(text, 'example.test: \n');
    }
  });

  it('close() closes the shell stream', async () => {
    const { ssh } = await connected();

    ssh.close();

    assert.equal(ssh._stream.closed, true);
  });

  it('close() is safe before the shell opens', () => {
    const ssh = new SSH2Shell(createHost());

    if (isBaseline()) {
      // Baseline calls close() on the prototype `{}` placeholder.
      assert.throws(() => ssh.close(), /close is not a function/);
    } else {
      // L6.1 treats it as a no-op because there is no live stream yet.
      assert.doesNotThrow(() => ssh.close());
    }
  });

  it('_removeListeners removes host listeners and clears timers', async () => {
    const { ssh, host } = await connected();
    const onData = () => {};
    host.onData = onData;
    ssh.on('data', onData);

    assert.equal(ssh.listeners('data').includes(onData), true);

    let fired = false;
    ssh.idleTimer = setTimeout(() => {
      fired = true;
    }, 10);

    ssh._removeListeners();
    await delay(25);

    assert.equal(ssh.listeners('data').includes(onData), false);
    assert.equal(fired, false);

    ssh.close();
  });
});
