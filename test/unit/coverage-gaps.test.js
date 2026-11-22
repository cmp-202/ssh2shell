'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  installFakeSsh2,
  isBaseline,
  loadSSH2Shell,
  createHost,
} = require('./helpers/harness');
const { FakeStream } = require('./helpers/fake-ssh2');

installFakeSsh2();
const SSH2Shell = loadSSH2Shell();

// These tests target internals of the current record-stack implementation. The
// frozen baseline has no equivalent record shape, so skip it there.
const newOnly = isBaseline() ? it.skip : it;

function make(overrides = {}) {
  const host = createHost(overrides);
  const ssh = new SSH2Shell(host);
  ssh.sshObj = host;
  ssh._loadDefaults();
  ssh._stream = new FakeStream();
  return { ssh, host };
}

describe('coverage gaps', () => {
  newOnly('binds host stderrData and end handlers', () => {
    const seen = { stderrData: [], end: [] };
    const { ssh, host } = make({
      onStderrData: function (data) {
        seen.stderrData.push([this, data]);
      },
      onEnd: function (sessionText, sshObj) {
        seen.end.push([this, sessionText, sshObj]);
      },
    });

    assert.ok(ssh.listeners('stderrData').includes(host.onStderrData));
    assert.ok(ssh.listeners('end').includes(host.onEnd));

    ssh.emit('stderrData', 'warning');
    ssh.emit('end', 'session text', host);

    assert.deepEqual(seen.stderrData, [[ssh, 'warning']]);
    assert.deepEqual(seen.end, [[ssh, 'session text', host]]);
  });

  newOnly('replaces a previous host msg handler when defaults reload', () => {
    const firstMessages = [];
    const secondMessages = [];
    const first = (message) => firstMessages.push(message);
    const second = (message) => secondMessages.push(message);

    const { ssh, host } = make({ onMsg: first });
    assert.ok(ssh.listeners('msg').includes(first));

    // Reloading defaults for the same record must detach the handler bound by
    // the previous host config before installing the replacement.
    host.onMsg = second;
    ssh._loadDefaults();

    const msgListeners = ssh.listeners('msg');
    assert.ok(!msgListeners.includes(first));
    assert.ok(msgListeners.includes(second));

    ssh.emit('msg', 'hello');
    assert.deepEqual(firstMessages, []);
    assert.deepEqual(secondMessages, ['hello']);
  });

  newOnly('collects active and nested descendants, excluding closed records', () => {
    const { ssh } = make();
    const root = { host: createHost(), closed: false };
    const middle = { host: createHost(), closed: false };
    const closed = { host: createHost(), closed: true };
    const deepest = { host: createHost(), closed: false };

    assert.deepEqual(ssh._descendantsOf(null), []);

    // The active record is not on the ancestors stack: it is the deepest
    // record, with its ancestors (including a closed one) behind it.
    ssh._connections = [root, middle, closed];
    ssh._active = deepest;
    assert.deepEqual(ssh._descendantsOf(root), [deepest, middle]);

    deepest.closed = true;
    assert.deepEqual(ssh._descendantsOf(root), [middle]);
    deepest.closed = false;

    // The active record is also excluded when it is the context itself.
    ssh._active = root;
    assert.deepEqual(ssh._descendantsOf(root), [middle]);
  });
});
