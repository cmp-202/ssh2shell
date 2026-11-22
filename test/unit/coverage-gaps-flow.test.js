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

// These tests drive host-traversal and shutdown guards that only exist in the
// current record-stack implementation.
const newOnly = isBaseline() ? it.skip : it;

function make(overrides = {}) {
  const host = createHost(overrides);
  const ssh = new SSH2Shell(host);
  ssh.sshObj = host;
  ssh._loadDefaults();
  ssh._stream = new FakeStream();
  return { ssh, host };
}

describe('coverage gaps: host traversal and shutdown', () => {
  newOnly('returns early from _nextHost when stopping or complete', () => {
    const { ssh } = make();
    let finals = 0;
    let exits = 0;
    ssh._callFinalCallback = () => {
      finals += 1;
      return 'final';
    };
    ssh._runExit = () => {
      exits += 1;
      return 'exit';
    };

    ssh._stopping = true;
    assert.equal(ssh._nextHost(), undefined);

    ssh._stopping = false;
    ssh._runComplete = true;
    assert.equal(ssh._nextHost(), undefined);

    assert.equal(finals, 0);
    assert.equal(exits, 0);
  });

  newOnly('finalizes directly when _nextHost has no active record', () => {
    const { ssh } = make();
    ssh._active = null;
    ssh._callFinalCallback = () => 'final';

    assert.equal(ssh._nextHost(), 'final');
  });

  newOnly('exits _nextHost when there are no pending hosts', () => {
    const { ssh, host } = make();
    const record = ssh._pushContext(host, null);
    record.pendingHosts = [];
    ssh._runExit = () => 'exit';

    assert.equal(ssh._nextHost(), 'exit');
  });

  newOnly('returns null from _popTo when no record is supplied', () => {
    const { ssh } = make();
    assert.equal(ssh._popTo(null), null);
  });

  newOnly('drops a failed record and its descendants from the stack', () => {
    const { ssh } = make();
    const root = ssh._pushContext(
      createHost({ server: { host: 'root.test' } }),
      null
    );
    const middle = ssh._pushContext(
      createHost({ server: { host: 'middle.test' } }),
      root
    );
    const failed = ssh._pushContext(
      createHost({ server: { host: 'failed.test' } }),
      middle
    );
    ssh._pushContext(createHost({ server: { host: 'child.test' } }), failed);

    assert.equal(ssh._popTo(failed), middle);
    assert.deepEqual(ssh._connections, [root]);
    assert.equal(ssh._active, middle);
    assert.equal(ssh.sshObj, middle.host);
  });

  newOnly('clears the active record when _popTo has no parent', () => {
    const { ssh, host } = make();
    const record = ssh._pushContext(host, null);
    ssh._connections = [];

    assert.equal(ssh._popTo(record), null);
    assert.equal(ssh._active, null);
  });

  newOnly('rejects a nested merge without a stack or server', () => {
    const { ssh, host } = make();
    ssh._connections = [];

    assert.equal(ssh._mergeNestedText(host), false);
    assert.equal(ssh._mergeNestedText({ commands: [] }), false);
  });

  newOnly('merges a stacked host into its parent exactly once', () => {
    const { ssh } = make();
    const parentHost = createHost({ server: { host: 'parent.test' } });
    parentHost.sessionText = '';
    const childHost = createHost({
      server: { host: 'child.test' },
      sessionText: 'child output',
    });

    const parent = ssh._pushContext(parentHost, null);
    const child = ssh._pushContext(childHost, parent);
    ssh._connections.push(child);
    ssh._active = null;

    assert.equal(ssh._mergeNestedText(childHost), true);
    assert.equal(parentHost.sessionText, '\nchild.test: child output');
    assert.equal(ssh._mergeNestedText(childHost), false);
  });

  newOnly('rejects a nested merge when there is no distinct parent', () => {
    const { ssh, host } = make();
    const record = ssh._pushContext(host, null);
    ssh._connections = [record];
    ssh._active = null;

    assert.equal(ssh._mergeNestedText(host), false);
  });

  newOnly('clears active and ancestor queues when stopping', () => {
    const { ssh } = make();
    const activeHost = createHost({
      server: { host: 'active.test' },
      commands: ['echo active'],
    });
    const ancestorHost = createHost({
      server: { host: 'ancestor.test' },
      commands: ['echo ancestor'],
    });

    const active = ssh._pushContext(activeHost, null);
    active.stream = new FakeStream();
    ssh._stream = active.stream;
    active.pendingHosts = [createHost({ server: { host: 'next.test' } })];

    const ancestor = {
      host: ancestorHost,
      pendingHosts: ['queued'],
    };
    ssh._connections = [ancestor];

    let exits = 0;
    ssh._beginStopExit = () => {
      exits += 1;
    };

    assert.equal(ssh.stop('test'), ssh);
    assert.deepEqual(activeHost.commands, []);
    assert.deepEqual(active.pendingHosts, []);
    assert.deepEqual(ancestorHost.commands, []);
    assert.deepEqual(ancestor.pendingHosts, []);
    assert.equal(ssh._hosts.length, 0);
    assert.equal(exits, 1);
  });

  newOnly('clears the configured host when stop has no active record', () => {
    const { ssh, host } = make();
    ssh._active = null;
    ssh._connections = [];

    let exits = 0;
    ssh._beginStopExit = () => {
      exits += 1;
    };

    assert.equal(ssh.stop('test'), ssh);
    assert.deepEqual(host.commands, []);
    assert.equal(exits, 1);
  });

  newOnly('does not finish stop when the run is already complete', () => {
    const { ssh } = make();
    ssh._runComplete = true;

    let finishes = 0;
    ssh._finishStop = () => {
      finishes += 1;
    };

    ssh._beginStopExit();
    assert.equal(finishes, 0);
  });

  newOnly('defers finish stop while a command is in flight', () => {
    const { ssh } = make();
    ssh._stream = new FakeStream();
    ssh._commandInFlight = true;

    let arms = 0;
    let finishes = 0;
    ssh._armStopTimer = () => {
      arms += 1;
    };
    ssh._finishStop = () => {
      finishes += 1;
    };

    ssh._beginStopExit();
    assert.equal(arms, 1);
    assert.equal(finishes, 0);

    ssh._stream = {};
    ssh._beginStopExit();
    assert.equal(finishes, 1);
  });
});
