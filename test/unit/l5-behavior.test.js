'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  installFakeSsh2,
  isBaseline,
  loadSSH2Shell,
  createHost,
  injectSsh2Client,
  systemMsg,
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

// The class installs one internal msg listener to break a progress line.
// Count only the host/default message sinks that these tests are about.
function msgListenerCount(ssh) {
  return ssh
    .listeners('msg')
    .filter((listener) => listener !== ssh._progressMsgListener).length;
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
    host.onCommandComplete = () => {};

    ssh._removeListeners();

    if (isBaseline()) {
      // The baseline only removes the current host reference, which no longer
      // matches the handler it attached, so the old default stays behind.
      assert.equal(ssh.listenerCount('commandComplete'), 1);
    } else {
      assert.equal(ssh.listenerCount('commandComplete'), 0);
    }
  });

  it('keeps a message sink between removing and loading host listeners', () => {
    if (isBaseline()) {
      // The baseline removes the host msg handler and leaves no listener
      // behind until the next _loadDefaults call.
      return;
    }

    const messages = [];
    const { ssh } = make({
      msg: (message) => messages.push(`host:${message}`),
    });
    ssh.msg = (message) => messages.push(`default:${message}`);
    ssh.debug = true;

    ssh._removeListeners();
    assert.equal(msgListenerCount(ssh), 1);

    systemMsg(ssh,'debug', 'after remove');
    assert.ok(
      messages.some(
        (message) =>
          message.startsWith('default:') && message.includes('after remove')
      )
    );
  });

  it('does not duplicate the msg listener when switching hosts', () => {
    if (isBaseline()) {
      return;
    }

    const { ssh } = make({ msg: () => {} });
    assert.equal(msgListenerCount(ssh), 1);

    ssh._removeListeners();
    assert.equal(msgListenerCount(ssh), 1);

    ssh.sshObj = createHost();
    ssh._loadDefaults();
    assert.equal(msgListenerCount(ssh), 1);
  });

  it('restores the default msg handler for a host without msg', () => {
    if (isBaseline()) {
      return;
    }

    const messages = [];
    const { ssh } = make({
      msg: (message) => messages.push(`host:${message}`),
    });
    ssh.msg = (message) => messages.push(`default:${message}`);

    ssh._removeListeners();
    ssh.sshObj = createHost({ msg: undefined });
    ssh._loadDefaults();
    ssh.debug = true;
    systemMsg(ssh,'debug', 'next host');

    assert.ok(
      messages.some(
        (message) =>
          message.startsWith('default:') && message.includes('next host')
      )
    );
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

  it('does not add the fallback handler when the caller supplies one', () => {
    const host = createHost({ server: { tryKeyboard: true } });
    const ssh = new SSH2Shell(host);
    ssh.sshObj = host;

    const responses = [];
    ssh.on(
      'keyboard-interactive',
      (name, instructions, instructionsLang, prompts, finish) => {
        finish(['secret']);
      }
    );
    ssh._loadDefaults();

    if (isBaseline()) {
      // The baseline installs its own non-finishing handler at construction.
      assert.ok(ssh.listenerCount('keyboard-interactive') >= 1);
    } else {
      assert.equal(ssh.listenerCount('keyboard-interactive'), 1);
    }

    ssh.emit(
      'keyboard-interactive',
      'auth',
      'instructions',
      'en',
      [{ prompt: 'Password: ' }],
      (values) => responses.push(values)
    );

    assert.deepEqual(responses, [['secret']]);
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

  it('uses onMsg as the host message handler', () => {
    const messages = [];
    const { ssh, host } = make({
      onMsg: (message) => messages.push(String(message)),
    });

    assert.equal(typeof host.onMsg, 'function');
    ssh.emit('msg', 'hello');
    assert.deepEqual(messages, ['hello']);
  });

  it('ignores the legacy msg.send shape', () => {
    if (isBaseline()) {
      // The baseline still accepts the Hubot-era shape.
      return;
    }

    const messages = [];
    const send = (message) => messages.push(String(message));
    const { ssh } = make({ msg: { send } });
    ssh.msg = () => {};

    ssh.emit('msg', 'hello');
    assert.deepEqual(messages, []);
  });

  it('passes hostHash to the ssh2 connection', () => {
    const { ssh } = make();
    ssh.sshObj.server.hostHash = 'sha256';

    class NoReadyClient extends FakeClient {
      constructor() {
        super();
        this.autoReady = false;
      }
    }
    injectSsh2Client(ssh, NoReadyClient);

    ssh._connect();

    assert.equal(ssh.connection.config.hostHash, 'sha256');
  });

  it('no longer maps hashMethod to hostHash', () => {
    if (isBaseline()) {
      // The baseline keeps the legacy alias.
      return;
    }

    const { ssh } = make();
    ssh.sshObj.server.hashMethod = 'sha256';

    class NoReadyClient extends FakeClient {
      constructor() {
        super();
        this.autoReady = false;
      }
    }
    injectSsh2Client(ssh, NoReadyClient);

    ssh._connect();

    assert.equal(ssh.connection.config.hostHash, undefined);
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
    systemMsg(ssh,'debug', 'hidden debug');
    systemMsg(ssh,'verbose', 'hidden verbose');
    assert.deepEqual(messages, []);

    ssh.debug = true;
    systemMsg(ssh,'debug', 'shown debug');
    assert.ok(messages.some((message) => message.includes('shown debug')));

    messages.length = 0;
    ssh.debug = false;
    ssh.verbose = true;
    systemMsg(ssh,'verbose', 'shown verbose');
    assert.ok(messages.some((message) => message.includes('shown verbose')));
  });

  it('uses host flags when the instance has no override', () => {
    if (isBaseline()) return;

    const messages = [];
    const { ssh } = make({
      debug: true,
      verbose: true,
      msg: (message) => messages.push(String(message)),
    });
    messages.length = 0;

    assert.equal(ssh.debug, true);
    assert.equal(ssh.verbose, true);

    systemMsg(ssh,'debug', 'host debug');
    systemMsg(ssh,'verbose', 'host verbose');
    assert.ok(messages.some((message) => message.includes('host debug')));
    assert.ok(messages.some((message) => message.includes('host verbose')));
  });

  it('lets an instance true override host flags that are off', () => {
    if (isBaseline()) return;

    const messages = [];
    const { ssh } = make({
      debug: false,
      verbose: false,
      msg: (message) => messages.push(String(message)),
    });
    messages.length = 0;

    ssh.debug = true;
    ssh.verbose = true;
    // The override must survive a host reload, not just affect the getter.
    ssh._loadDefaults();
    messages.length = 0;

    assert.equal(ssh.debug, true);
    assert.equal(ssh.verbose, true);

    systemMsg(ssh,'debug', 'forced debug');
    systemMsg(ssh,'verbose', 'forced verbose');
    assert.ok(messages.some((message) => message.includes('forced debug')));
    assert.ok(messages.some((message) => message.includes('forced verbose')));
  });

  it('lets an instance false override host flags that are on', () => {
    if (isBaseline()) return;

    const messages = [];
    const { ssh } = make({
      debug: true,
      verbose: true,
      msg: (message) => messages.push(String(message)),
    });
    messages.length = 0;

    ssh.debug = false;
    ssh.verbose = false;
    ssh._loadDefaults();
    messages.length = 0;

    assert.equal(ssh.debug, false);
    assert.equal(ssh.verbose, false);

    systemMsg(ssh,'debug', 'suppressed debug');
    systemMsg(ssh,'verbose', 'suppressed verbose');
    assert.deepEqual(messages, []);
  });

  it('applies an instance change immediately without a host reload', () => {
    if (isBaseline()) return;

    const messages = [];
    const { ssh } = make({
      debug: false,
      msg: (message) => messages.push(String(message)),
    });
    messages.length = 0;

    ssh.debug = true;
    systemMsg(ssh,'debug', 'immediate debug');
    assert.ok(messages.some((message) => message.includes('immediate debug')));
  });
});

describe('host prefix in messages', () => {
  it('omits the host prefix for a single host', () => {
    if (isBaseline()) {
      // The baseline always prefixes messages with the host.
      return;
    }

    const messages = [];
    const { ssh } = make({
      debug: true,
      msg: (message) => messages.push(String(message)),
    });

    messages.length = 0;
    systemMsg(ssh,'debug', 'single host');
    assert.deepEqual(messages, ['single host']);
  });

  it('keeps the host prefix for multiple primary hosts', () => {
    if (isBaseline()) return;

    const messages = [];
    const first = createHost({
      server: { host: 'first.test' },
      debug: true,
      msg: (message) => messages.push(String(message)),
    });
    const second = createHost({ server: { host: 'second.test' } });
    const ssh = new SSH2Shell([first, second]);
    ssh.sshObj = first;
    ssh._loadDefaults();

    messages.length = 0;
    systemMsg(ssh,'debug', 'multiple hosts');
    assert.deepEqual(messages, ['first.test: multiple hosts']);
  });

  it('keeps the host prefix for a single host with nested hosts', () => {
    if (isBaseline()) return;

    const messages = [];
    const nested = createHost({ server: { host: 'nested.test' } });
    const { ssh } = make({
      server: { host: 'primary.test' },
      hosts: [nested],
      debug: true,
      msg: (message) => messages.push(String(message)),
    });

    messages.length = 0;
    systemMsg(ssh,'debug', 'nested hosts');
    assert.deepEqual(messages, ['primary.test: nested hosts']);
  });

  it('applies the same rule to msg: notes', () => {
    if (isBaseline()) return;

    const messages = [];
    const { ssh } = make({
      msg: (message) => messages.push(String(message)),
    });
    ssh._nextCommand = () => {};
    ssh.command = 'msg:hello';

    messages.length = 0;
    ssh._processNotifications();
    assert.deepEqual(messages, ['Note: hello']);
  });
});
