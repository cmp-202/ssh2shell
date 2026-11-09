'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  installFakeSsh2,
  isBaseline,
  loadSSH2Shell,
  createHost,
} = require('./helpers/harness');
const { FakeClient, FakeStream } = require('./helpers/fake-ssh2');

installFakeSsh2();
const SSH2Shell = loadSSH2Shell();

function make(overrides = {}) {
  const host = createHost(overrides);
  const ssh = new SSH2Shell(host);
  ssh.sshObj = host;
  ssh._loadDefaults();
  ssh._stream = new FakeStream();
  return { ssh, host };
}

describe('L5 listener lifecycle', () => {
  it('detaches the host onError handler with the other host listeners', () => {
    let errors = 0;
    const { ssh } = make({
      onError: () => {
        errors += 1;
      },
    });

    // A default error handler is installed at construction, so removing the
    // host handler must leave exactly that one behind.
    const before = ssh.listenerCount('error');
    assert.ok(before >= 1);

    ssh._removeListeners();

    assert.equal(ssh.listenerCount('error'), before - 1);
    ssh.emit('error', 'boom', 'Test');
    assert.equal(errors, 0);
  });

  it('does not attach duplicate listeners when defaults are reloaded', () => {
    const { ssh } = make();

    ssh._loadDefaults();

    if (isBaseline()) {
      // The baseline re-registers the same handlers on every load.
      assert.equal(ssh.listenerCount('commandComplete'), 2);
    } else {
      assert.equal(ssh.listenerCount('commandComplete'), 1);
    }
  });

  it('removes a host handler assigned after the defaults were loaded', () => {
    const { ssh, host } = make();
    const lateHandler = () => {};
    host.onCommandComplete = lateHandler;

    ssh._removeListeners();

    if (isBaseline()) {
      // The baseline only removes the current host reference, which no longer
      // matches the handler it attached, so the old default stays behind.
      assert.equal(ssh.listenerCount('commandComplete'), 1);
    } else {
      assert.equal(ssh.listenerCount('commandComplete'), 0);
    }
  });
});

describe('L5 keyboard-interactive handling', () => {
  it('registers the default handler on the dashed event and finishes with empty responses', () => {
    const { ssh } = make({ server: { tryKeyboard: true } });
    const responses = [];
    const finish = (values) => responses.push(values);

    ssh.emit(
      'keyboard-interactive',
      'auth',
      'instructions',
      'en',
      [{ prompt: 'Password: ' }],
      finish
    );

    if (isBaseline()) {
      // The baseline handler never calls finish(), which stalls the handshake.
      assert.deepEqual(responses, []);
    } else {
      assert.deepEqual(responses, [['']]);
    }
  });

  it('removes the default keyboard-interactive handler with the host', () => {
    const { ssh } = make({ server: { tryKeyboard: true } });
    assert.equal(ssh.listenerCount('keyboard-interactive'), 1);

    ssh._removeListeners();

    if (isBaseline()) {
      // The baseline never detaches its constructor-time default handler.
      assert.equal(ssh.listenerCount('keyboard-interactive'), 1);
    } else {
      assert.equal(ssh.listenerCount('keyboard-interactive'), 0);
    }
  });

  it('dispatches keyboard-interactive to a host-defined handler', () => {
    const calls = [];
    const { ssh } = make({
      onKeyboardInteractive: (...args) => calls.push(args),
    });
    const finish = () => {};

    ssh.emit(
      'keyboard-interactive',
      'auth',
      'instructions',
      'en',
      [{ prompt: 'Password: ' }],
      finish
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'auth');
    assert.equal(calls[0][4], finish);
  });
});

describe('L5 restored baseline payloads', () => {
  it('emits the raw command buffer for commandComplete', () => {
    const { ssh } = make();
    const events = [];
    ssh._nextCommand = () => {};
    ssh.on('commandComplete', (...args) => events.push(args));
    ssh.command = 'echo one';
    ssh._buffer = 'echo one\none\n$ ';

    ssh._commandComplete();

    assert.equal(events.length, 1);
    assert.equal(events[0][1], 'echo one\none\n$ ');
  });

  it('maps the legacy msg.send handler to msg', () => {
    const messages = [];
    const send = (message) => messages.push(String(message));
    const { ssh, host } = make({ msg: { send } });

    assert.equal(host.msg, send);

    ssh.emit('msg', 'hello');
    assert.deepEqual(messages, ['hello']);
  });

  it('stores hashMethod on server.hostHash for the ssh2 connection', () => {
    const { ssh } = make();
    ssh.sshObj.server.hashMethod = 'sha256';

    class NoReadyClient extends FakeClient {
      constructor() {
        super();
        this.autoReady = false;
      }
    }
    ssh.ssh2Client = NoReadyClient;

    ssh._connect();

    // Both the baseline and L5 pass hashMethod through as server.hostHash.
    assert.equal(ssh.connection.config.hostHash, 'sha256');
  });
});

describe('L5 debug and verbose gating', () => {
  it('emits debug and verbose messages only when their flags are enabled', () => {
    if (isBaseline()) {
      // The baseline has no central message gate.
      return;
    }

    const messages = [];
    const { ssh } = make({ msg: (message) => messages.push(String(message)) });

    ssh.debug = false;
    ssh.verbose = false;
    ssh._systemMsg('debug', 'hidden debug');
    ssh._systemMsg('verbose', 'hidden verbose');
    assert.deepEqual(messages, []);

    ssh.debug = true;
    ssh._systemMsg('debug', 'shown debug');
    assert.ok(messages.some((message) => message.includes('shown debug')));

    messages.length = 0;
    ssh.debug = false;
    ssh.verbose = true;
    ssh._systemMsg('verbose', 'shown verbose');
    assert.ok(messages.some((message) => message.includes('shown verbose')));
  });
});
