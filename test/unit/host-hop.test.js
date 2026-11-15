'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  installFakeSsh2,
  isBaseline,
  loadSSH2Shell,
  createHost,
  injectSsh2Client,
  waitFor,
  waitForStream,
} = require('./helpers/harness');
const { FakeClient } = require('./helpers/fake-ssh2');

installFakeSsh2();
const SSH2Shell = loadSSH2Shell();

// These tests cover internals that only exist in the forwardOut implementation.
const newOnly = isBaseline() ? it.skip : it;

async function connected(host) {
  const ssh = new SSH2Shell(host);
  ssh.connect();
  await waitForStream(ssh);
  return ssh;
}

function hopHost(overrides = {}) {
  return createHost(
    Object.assign(
      {
        server: { host: 'hop.test', port: 2222 },
        commands: [],
      },
      overrides
    )
  );
}

describe('host hop transport', () => {
  newOnly('opens a hop with forwardOut and passes the channel as sock', async () => {
    const hop = hopHost();
    const primary = createHost({
      server: { host: 'primary.test' },
      commands: [],
      hosts: [hop],
    });
    const ssh = await connected(primary);
    const parentConnection = ssh.connection;
    const parentRecord = ssh._activeContext();
    const primaryStream = ssh._stream;

    ssh._nextHost();

    await waitFor(
      () =>
        ssh._activeContext() &&
        ssh._activeContext().host === hop &&
        ssh._stream !== primaryStream &&
        typeof ssh._stream.receive === 'function',
      { label: 'hop stream' }
    );

    assert.equal(parentConnection.forwardOutCalls.length, 1);
    assert.deepEqual(parentConnection.forwardOutCalls[0], {
      srcIP: '127.0.0.1',
      srcPort: 0,
      dstIP: 'hop.test',
      dstPort: 2222,
    });

    const hopConnection = ssh.connection;
    assert.notEqual(hopConnection, parentConnection);
    assert.equal(hopConnection.config.sock, parentConnection.channel);
    assert.equal(hopConnection.config.host, 'hop.test');
    assert.equal(hopConnection.config.port, 2222);
    assert.equal(ssh._connections.length, 1);
    assert.equal(ssh._connections[0], parentRecord);

    ssh.close();
  });

  newOnly('contains a forwardOut failure to the hop and restores the parent', async () => {
    const hop = hopHost();
    const primary = createHost({
      server: { host: 'primary.test' },
      commands: [],
      hosts: [hop],
    });
    const ssh = await connected(primary);
    const parentConnection = ssh.connection;
    const parentRecord = ssh._activeContext();
    parentConnection.forwardOutError = new Error('forward denied');

    const errors = [];
    ssh.on('error', (...args) => errors.push(args));
    let resumed = false;
    ssh._runExit = () => {
      resumed = true;
    };

    ssh._nextHost();

    await waitFor(() => errors.length > 0, { label: 'hop error' });

    assert.equal(errors[0][1], 'Hop');
    assert.ok(String(errors[0][0]).includes('forward denied'));
    assert.equal(ssh._activeContext(), parentRecord);
    assert.equal(ssh.sshObj, primary);
    assert.deepEqual(ssh._connections, []);
    assert.equal(resumed, true);

    ssh.close();
  });

  newOnly('ignores data from an inactive ancestor stream', async () => {
    const hop = hopHost();
    const primary = createHost({
      server: { host: 'primary.test' },
      commands: [],
      hosts: [hop],
    });
    const ssh = await connected(primary);
    const primaryStream = ssh._stream;

    ssh._nextHost();
    await waitFor(() => ssh._activeContext().host === hop, {
      label: 'hop stream',
    });

    ssh._buffer = 'child buffer';
    primaryStream.receive('ancestor data\n');

    assert.equal(ssh._buffer, 'child buffer');
    assert.equal(ssh._activeContext().host, hop);

    ssh.close();
  });

  newOnly('terminates when _connectHop has no parent record', () => {
    const ssh = new SSH2Shell(createHost());
    let called = false;
    ssh._callback = () => {
      called = true;
    };
    const errors = [];
    ssh.on('error', (...args) => errors.push(args));

    ssh._connectHop();

    assert.equal(errors.length, 1);
    assert.equal(errors[0][1], 'Hop');
    assert.equal(called, true);
  });
});

describe('primary failure navigation', () => {
  newOnly('advances to the next primary after a connection close', async () => {
    const first = createHost({
      server: { host: 'first.test' },
      commands: [],
    });
    const second = createHost({
      server: { host: 'second.test' },
      commands: [],
    });

    const ssh = new SSH2Shell([first, second]);
    const errors = [];
    ssh.on('error', (...args) => errors.push(args));
    ssh.connect();
    await waitForStream(ssh);

    const firstConnection = ssh.connection;
    const firstStream = ssh._stream;
    firstConnection.emit('close', true);

    await waitFor(
      () =>
        ssh.host === 'second.test' &&
        ssh._stream !== firstStream &&
        typeof ssh._stream.receive === 'function',
      { label: 'second primary' }
    );

    assert.ok(errors.some((args) => args[1] === 'Connection close'));
    assert.equal(ssh._activeContext().host, second);

    ssh.close();
  });

  newOnly('advances when a primary connect throws synchronously', async () => {
    let connects = 0;
    class ThrowFirst extends FakeClient {
      connect(config) {
        connects += 1;
        if (connects === 1) {
          throw new Error('connect boom');
        }
        return super.connect(config);
      }
    }

    const first = createHost({
      server: { host: 'first.test' },
      commands: [],
    });
    const second = createHost({
      server: { host: 'second.test' },
      commands: [],
    });

    const ssh = new SSH2Shell([first, second]);
    injectSsh2Client(ssh, ThrowFirst);
    const errors = [];
    ssh.on('error', (...args) => errors.push(args));
    ssh.connect();

    await waitFor(() => ssh.host === 'second.test' && ssh.connection, {
      label: 'second primary',
    });
    await waitForStream(ssh);

    assert.ok(errors.some((args) => args[1] === 'Connection.connect'));
    assert.equal(ssh._activeContext().host, second);

    ssh.close();
  });
});

describe('host list validation', () => {
  newOnly('rejects empty and invalid host lists at construction', () => {
    assert.throws(() => new SSH2Shell(), TypeError);
    assert.throws(() => new SSH2Shell([]), TypeError);
    assert.throws(() => new SSH2Shell([null]), TypeError);
    assert.throws(() => new SSH2Shell([undefined]), TypeError);
    assert.throws(() => new SSH2Shell(['host']), TypeError);
  });

  newOnly('copies the host list so a run cannot drain the caller array', () => {
    const first = createHost({ server: { host: 'first.test' } });
    const second = createHost({ server: { host: 'second.test' } });
    const hosts = [first, second];
    const ssh = new SSH2Shell(hosts);

    assert.notEqual(ssh._hosts, hosts);
    assert.deepEqual(ssh._hosts, hosts);
  });
});
