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

function make(overrides = {}) {
  const host = createHost(overrides);
  const ssh = new SSH2Shell(host);
  ssh.sshObj = host;
  ssh._loadDefaults();
  ssh._stream = new FakeStream();
  return { ssh, host };
}

describe('host lifecycle', () => {
  it('_previousHost restores the previous connection and emits end', () => {
    if (isBaseline()) return;

    const { ssh } = make();
    const primaryRecord = ssh._activeContext();
    const previous = ssh.sshObj;
    const current = createHost({ server: { host: 'current.test' } });
    current.sessionText = 'done';

    // A hop makes the child active and puts the primary on the stack.
    ssh._pushContext(current, primaryRecord);
    ssh._stream = new FakeStream();

    let exited = false;
    ssh._runExit = () => {
      exited = true;
    };
    const ends = [];
    ssh.on('end', (...args) => ends.push(args));

    ssh._previousHost();

    assert.equal(ssh.sshObj, previous);
    assert.equal(ssh._connections.length, 0);
    assert.equal(exited, true);
    assert.equal(ends.length, 1);
    assert.ok(String(ends[0][0]).includes('current.test'));
    assert.ok(String(ends[0][0]).includes('done'));
  });

  it('_nextHost initiates a hop to the next nested host', () => {
    if (isBaseline()) return;

    const { ssh } = make();
    const parent = ssh._activeContext();
    const next = createHost({ server: { host: 'next.test' } });
    ssh.sshObj.hosts = [next];
    let initiated = null;
    ssh._initiate = (action) => {
      initiated = action;
    };

    ssh._nextHost();

    assert.equal(ssh.sshObj, next);
    assert.equal(initiated, ssh._connectHop);
    // The parent is pushed by _connect(), not by _nextHost().
    assert.equal(ssh._connections.length, 0);
    assert.equal(ssh._activeContext(), parent);
  });

  it('_nextPrimaryHost emits end for the current primary host and loads the next', () => {
    const { ssh } = make();
    const first = createHost({ server: { host: 'first.test' } });
    const second = createHost({ server: { host: 'second.test' } });
    ssh.sshObj = first;
    ssh._hosts = [second];
    ssh._primaryhostSessionText = 'first: ';
    let removed = false;
    let initiated = null;
    ssh._removeListeners = () => {
      removed = true;
    };
    ssh._initiate = (action) => {
      initiated = action;
    };
    const ends = [];
    ssh.on('end', (...args) => ends.push(args));

    ssh._nextPrimaryHost('ACTION');

    assert.equal(removed, true);
    assert.equal(ends.length, 1);
    if (isBaseline()) {
      assert.equal(ends[0][0], 'first: ');
    } else {
      // R5 finalizes the host here, appending its (empty) sessionText.
      assert.equal(ends[0][0], 'first: \n');
    }
    assert.equal(ssh.sshObj, second);
    assert.equal(ssh._primaryhostSessionText, 'second.test: ');
    assert.equal(initiated, 'ACTION');
  });

  it('_nextPrimaryHost starts nothing when the primary queue is empty', () => {
    const { ssh } = make();
    ssh._hosts = [];
    let initiated = false;
    ssh._initiate = () => {
      initiated = true;
    };

    const result = ssh._nextPrimaryHost('ACTION');

    // `_nextPrimaryHost` only iterates primary hosts. Backing out of secondary
    // hosts is `_runExit`'s job, so an empty primary queue starts nothing.
    //
    // The original CoffeeScript artifact implicitly returned the `_runExit`
    // function here (its `else` branch ended with `@_runExit`). The record-stack
    // implementation terminates through the final callback instead.
    if (isBaseline()) {
      assert.equal(typeof result, 'function');
      assert.equal(result, ssh._runExit);
    } else {
      assert.equal(result, ssh._allSessions);
    }
    assert.equal(initiated, false);
  });
});

describe('primary and secondary host chains', () => {
  function chainHost(name, hosts = []) {
    const host = createHost({ server: { host: name } });
    host.hosts = hosts;
    host.commands = [];
    host.sessionText = name + ' session';
    return host;
  }

  function chainSetup(primary) {
    const ssh = new SSH2Shell(primary);
    // The default `msg` listener prints to the console. These tests only assert
    // on the collected events, so drop it to keep the test output readable.
    ssh.removeAllListeners('msg');
    ssh.sshObj = primary;
    ssh._hosts = [];
    ssh._loadDefaults();
    ssh._stream = new FakeStream();
    ssh.command = '';
    const events = [];
    const initiated = [];
    ssh.on('end', (text) => events.push(['end', text]));
    ssh._initiate = () => {
      // Simulate the transport: the host _nextHost selected becomes the active
      // record and the previous record joins the ancestor stack.
      ssh._pushContext(ssh.sshObj, ssh._activeContext());
      initiated.push(ssh.sshObj.server.host);
    };
    ssh._runCommand = (command) => events.push(['run', command]);
    ssh.close = () => events.push(['close']);
    return { ssh, events, initiated };
  }

  function hostsOnStack(ssh) {
    return ssh._connections.map((record) => record.host);
  }

  it('backs out of a multi-level nested chain one host at a time', () => {
    if (isBaseline()) return;

    const c = chainHost('c.test');
    const b = chainHost('b.test', [c]);
    const a = chainHost('a.test', [b]);
    const { ssh, events, initiated } = chainSetup(a);

    ssh._runExit(); // a -> b
    assert.equal(ssh.sshObj, b);
    assert.deepEqual(hostsOnStack(ssh), [a]);

    ssh._runExit(); // b -> c
    assert.equal(ssh.sshObj, c);
    assert.deepEqual(hostsOnStack(ssh), [a, b]);

    ssh._runExit(); // c -> b -> a -> close
    assert.equal(ssh.sshObj, a);
    assert.deepEqual(ssh._connections, []);
    assert.deepEqual(initiated, ['b.test', 'c.test']);

    const ends = events.filter((event) => event[0] === 'end').map((event) => event[1]);
    assert.equal(ends.length, 2);
    assert.ok(ends[0].includes('c.test'));
    assert.ok(ends[1].includes('b.test'));
    assert.deepEqual(events[events.length - 1], ['close']);
  });

  it('resumes the remaining hosts in a previous host array when backing out', () => {
    if (isBaseline()) return;

    const b = chainHost('b.test');
    const d = chainHost('d.test');
    const a = chainHost('a.test', [b, d]);
    const { ssh, events, initiated } = chainSetup(a);

    ssh._runExit(); // a -> b
    assert.equal(ssh.sshObj, b);
    assert.deepEqual(hostsOnStack(ssh), [a]);

    ssh._runExit(); // b -> back to a, which still has d -> d
    assert.equal(ssh.sshObj, d);
    assert.deepEqual(hostsOnStack(ssh), [a]);
    assert.deepEqual(initiated, ['b.test', 'd.test']);

    const ends = events.filter((event) => event[0] === 'end').map((event) => event[1]);
    assert.equal(ends.length, 1);
    assert.ok(ends[0].includes('b.test'));

    ssh._runExit(); // d -> back to a -> close
    assert.equal(ssh.sshObj, a);
    assert.deepEqual(ssh._connections, []);
    assert.deepEqual(events[events.length - 1], ['close']);
  });

  it('restores the primary commandComplete handler after backing out', () => {
    if (isBaseline()) return;

    const primary = chainHost('primary.test');
    const secondary = chainHost('secondary.test');
    primary.hosts = [secondary];

    const ssh = new SSH2Shell(primary);
    ssh.removeAllListeners('msg');
    ssh.sshObj = primary;
    ssh._hosts = [];
    ssh._loadDefaults();
    const primaryRecord = ssh._activeContext();
    ssh._stream = new FakeStream();
    ssh.command = '';

    const fired = [];
    primary.onCommandComplete = (command, response, sshObj) => {
      fired.push({ handler: 'primary', host: sshObj.server.host, response });
    };
    secondary.onCommandComplete = (command, response, sshObj) => {
      fired.push({ handler: 'secondary', host: sshObj.server.host, response });
    };

    // Rebind the primary handler into its record, then bind the child's.
    ssh._loadDefaults(primaryRecord);
    ssh._pushContext(secondary, primaryRecord);
    ssh._stream = new FakeStream();
    ssh._loadDefaults();
    ssh._runExit = () => {};

    ssh._previousHost();

    assert.equal(ssh.sshObj, primary);

    ssh.emit('commandComplete', 'cmd', 'response', ssh.sshObj);

    assert.equal(ssh.listenerCount('commandComplete'), 1);
    assert.deepEqual(fired, [
      { handler: 'primary', host: 'primary.test', response: 'response' },
    ]);
  });
});

describe('_runExit ordering', () => {
  function setup() {
    const { ssh } = make();
    const calls = [];
    ssh.command = '';
    ssh.sshObj.hosts = [];
    ssh._runCommand = (command) => calls.push(['runCommand', command]);
    ssh._nextHost = () => calls.push(['nextHost']);
    ssh._previousHost = () => calls.push(['previousHost']);
    ssh.close = () => calls.push(['close']);
    return { ssh, calls };
  }

  it('moves to the next nested host when there are no exit commands', () => {
    if (isBaseline()) return;

    const { ssh, calls } = setup();
    ssh.sshObj.hosts = [createHost()];

    ssh._runExit();

    assert.deepEqual(calls, [['nextHost']]);
  });

  it('returns to the previous host when there are no nested hosts', () => {
    if (isBaseline()) return;

    const { ssh, calls } = setup();
    const parent = ssh._activeContext();
    ssh._pushContext(createHost(), parent);

    ssh._runExit();

    assert.deepEqual(calls, [['previousHost']]);
  });

  it('sends a manual exit command when the current command is exit', () => {
    if (isBaseline()) return;

    const { ssh, calls } = setup();
    ssh.command = 'exit';

    ssh._runExit();

    assert.deepEqual(calls, [['runCommand', 'exit']]);
  });

  it('closes the stream when nothing remains', () => {
    if (isBaseline()) return;

    const { ssh, calls } = setup();

    ssh._runExit();

    assert.deepEqual(calls, [['close']]);
  });
});
