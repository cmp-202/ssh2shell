'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  installFakeSsh2,
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
    const { ssh } = make();
    const previous = createHost({ server: { host: 'previous.test' } });
    const current = createHost({ server: { host: 'current.test' } });
    current.sessionText = 'done';
    ssh.sshObj = current;
    ssh._connections = [previous];
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

  it('_nextHost pushes the current host and initiates the nested host', () => {
    const { ssh } = make();
    const next = createHost({ server: { host: 'next.test' } });
    const current = createHost({ server: { host: 'current.test' } });
    current.hosts = [next];
    ssh.sshObj = current;
    ssh._connections = [];
    let removed = false;
    let initiated = null;
    ssh._removeListeners = () => {
      removed = true;
    };
    ssh._initiate = (action) => {
      initiated = action;
    };

    ssh._nextHost();

    assert.equal(removed, true);
    assert.equal(ssh._connections.length, 1);
    assert.equal(ssh._connections[0], current);
    assert.equal(ssh.sshObj, next);
    assert.equal(initiated, ssh._sshConnect);
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
    assert.equal(ends[0][0], 'first: ');
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
    assert.equal(result, undefined);
    assert.equal(initiated, false);
  });
});

describe('primary and secondary host chains', () => {
  function chainHost(name, hosts = []) {
    const host = createHost({ server: { host: name } });
    host.hosts = hosts;
    host.commands = [];
    host.exitCommands = [];
    host.sessionText = name + ' session';
    return host;
  }

  function chainSetup(primary) {
    const ssh = new SSH2Shell(primary);
    ssh.sshObj = primary;
    ssh._hosts = [];
    ssh._connections = [];
    ssh.command = '';
    const events = [];
    const initiated = [];
    ssh.on('end', (text) => events.push(['end', text]));
    ssh._removeListeners = () => {};
    ssh._initiate = () => {
      initiated.push(ssh.sshObj.server.host);
    };
    ssh._runCommand = (command) => events.push(['run', command]);
    ssh.close = () => events.push(['close']);
    return { ssh, events, initiated };
  }

  it('backs out of a multi-level nested chain one host at a time', () => {
    const c = chainHost('c.test');
    const b = chainHost('b.test', [c]);
    const a = chainHost('a.test', [b]);
    const { ssh, events, initiated } = chainSetup(a);

    ssh._runExit(); // a -> b
    assert.equal(ssh.sshObj, b);
    assert.deepEqual(ssh._connections, [a]);

    ssh._runExit(); // b -> c
    assert.equal(ssh.sshObj, c);
    assert.deepEqual(ssh._connections, [a, b]);

    ssh._runExit(); // c -> back to b -> back to a -> close
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
    const b = chainHost('b.test');
    const d = chainHost('d.test');
    const a = chainHost('a.test', [b, d]);
    const { ssh, events, initiated } = chainSetup(a);

    ssh._runExit(); // a -> b
    assert.equal(ssh.sshObj, b);
    assert.deepEqual(ssh._connections, [a]);

    ssh._runExit(); // b -> back to a, which still has d -> d
    assert.equal(ssh.sshObj, d);
    assert.deepEqual(ssh._connections, [a]);
    assert.deepEqual(initiated, ['b.test', 'd.test']);

    const ends = events.filter((event) => event[0] === 'end').map((event) => event[1]);
    assert.equal(ends.length, 1);
    assert.ok(ends[0].includes('b.test'));

    ssh._runExit(); // d -> back to a -> close
    assert.equal(ssh.sshObj, a);
    assert.deepEqual(ssh._connections, []);
    assert.deepEqual(events[events.length - 1], ['close']);
  });
});

describe('_runExit ordering', () => {
  function setup() {
    const { ssh } = make();
    const calls = [];
    ssh.command = '';
    ssh.sshObj.exitCommands = [];
    ssh.sshObj.hosts = [];
    ssh._connections = [];
    ssh._runCommand = (command) => calls.push(['runCommand', command]);
    ssh._nextHost = () => calls.push(['nextHost']);
    ssh._previousHost = () => calls.push(['previousHost']);
    ssh.close = () => calls.push(['close']);
    return { ssh, calls };
  }

  it('runs queued exit commands first', () => {
    const { ssh, calls } = setup();
    ssh.sshObj.exitCommands = ['exit'];
    ssh.sshObj.sessionText = 'session';
    ssh._connections = [
      { server: { host: 'primary.test' }, sessionText: '' },
    ];

    ssh._runExit();

    assert.deepEqual(calls, [['runCommand', 'exit']]);
    assert.ok(ssh._connections[0].sessionText.includes('session'));
  });

  it('moves to the next nested host when there are no exit commands', () => {
    const { ssh, calls } = setup();
    ssh.sshObj.hosts = [createHost()];

    ssh._runExit();

    assert.deepEqual(calls, [['nextHost']]);
  });

  it('returns to the previous host when there are no nested hosts', () => {
    const { ssh, calls } = setup();
    ssh._connections = [createHost()];

    ssh._runExit();

    assert.deepEqual(calls, [['previousHost']]);
  });

  it('sends a manual exit command when the current command is exit', () => {
    const { ssh, calls } = setup();
    ssh.command = 'exit';

    ssh._runExit();

    assert.deepEqual(calls, [['runCommand', 'exit']]);
  });

  it('closes the stream when nothing remains', () => {
    const { ssh, calls } = setup();

    ssh._runExit();

    assert.deepEqual(calls, [['close']]);
  });
});
