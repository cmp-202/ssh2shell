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

// The idle timer is armed when a command is written and reset by every data
// event. A detected prompt cancels it. These tests are new behavior; the frozen
// baseline still uses the data-armed timer and has no always-on start timer.
describe('command idle timeout', () => {
  it('times out a silent command that never returns to a prompt', async () => {
    if (isBaseline()) return;

    const timeouts = [];
    const host = createHost({
      commands: ['sleep 60'],
      idleTimeOut: 20,
      dataIdleTime: 5,
      onCommandTimeout: (command, response, stream, connection, details) => {
        timeouts.push({ command, response, details });
      },
    });

    const ssh = new SSH2Shell(host);
    ssh.connect();
    await waitForStream(ssh);
    ssh._stream.onWrite = () => {};
    ssh._stream.receive('$ ');

    await waitFor(() => timeouts.length === 1, { label: 'start timeout' });

    assert.equal(timeouts[0].command, 'sleep 60');
    assert.equal(timeouts[0].response, '');
    assert.deepEqual(timeouts[0].details, {
      attempt: 1,
      maxRetries: 0,
      final: true,
    });

    ssh._removeListeners();
    ssh.close();
  });

  it('completes a silent command that returns to the prompt', async () => {
    if (isBaseline()) return;

    const timeouts = [];
    const completed = [];
    const host = createHost({
      commands: ['sleep 1'],
      idleTimeOut: 200,
      dataIdleTime: 10,
      onCommandTimeout: (...args) => timeouts.push(args),
      onCommandComplete: (command) => completed.push(command),
    });

    const ssh = new SSH2Shell(host);
    ssh.connect();
    await waitForStream(ssh);
    ssh._stream.onWrite = (data, stream) => {
      if (data === 'sleep 1\n') {
        setTimeout(() => stream.receive('$ '), 1);
      }
    };
    ssh._stream.receive('$ ');

    await waitFor(() => completed.length === 1, { label: 'commandComplete' });

    assert.deepEqual(completed, ['sleep 1']);
    assert.equal(timeouts.length, 0);

    ssh._removeListeners();
    ssh.close();
  });

  it('times out when output arrives but no prompt returns', async () => {
    if (isBaseline()) return;

    const timeouts = [];
    const host = createHost({
      commands: ['sleep 60'],
      idleTimeOut: 20,
      dataIdleTime: 5,
      onCommandTimeout: (command, response, stream, connection, details) => {
        timeouts.push({ response, details });
      },
    });

    const ssh = new SSH2Shell(host);
    ssh.connect();
    await waitForStream(ssh);
    ssh._stream.onWrite = (data, stream) => {
      if (data === 'sleep 60\n') {
        setTimeout(() => stream.receive('partial output'), 1);
      }
    };
    ssh._stream.receive('$ ');

    await waitFor(() => timeouts.length === 1, { label: 'timeout' });

    assert.ok(timeouts[0].response.includes('partial output'));
    assert.deepEqual(timeouts[0].details, {
      attempt: 1,
      maxRetries: 0,
      final: true,
    });

    ssh._removeListeners();
    ssh.close();
  });

  it('cancels the idle timer when a prompt arrives before the settle delay', async () => {
    if (isBaseline()) return;

    const timeouts = [];
    const completed = [];
    const host = createHost({
      commands: ['sleep 1'],
      idleTimeOut: 25,
      dataIdleTime: 60,
      onCommandTimeout: (...args) => timeouts.push(args),
      onCommandComplete: (command) => completed.push(command),
    });

    const ssh = new SSH2Shell(host);
    ssh.connect();
    await waitForStream(ssh);
    ssh._stream.onWrite = (data, stream) => {
      if (data === 'sleep 1\n') {
        setTimeout(() => stream.receive('$ '), 1);
      }
    };
    ssh._stream.receive('$ ');

    await waitFor(() => completed.length === 1, { label: 'commandComplete' });

    assert.deepEqual(completed, ['sleep 1']);
    assert.equal(timeouts.length, 0);

    ssh._removeListeners();
    ssh.close();
  });

  it('does not arm the idle timer for the literal exit command', () => {
    if (isBaseline()) return;

    const { ssh } = make();
    ssh.command = 'exit';
    ssh._runCommand('exit');

    assert.equal(ssh.idleTimer, null);

    ssh._removeListeners();
    ssh.close();
  });

  it('does not arm the idle timer for an internal password write', () => {
    if (isBaseline()) return;

    const { ssh } = make({ server: { password: 'secret' } });
    ssh.command = 'sudo ls';
    ssh._runCommand('secret');

    assert.equal(ssh.idleTimer, null);

    ssh._removeListeners();
    ssh.close();
  });

  it('arms a fresh timer for each command write', () => {
    if (isBaseline()) return;

    const { ssh } = make({ idleTimeOut: 5000 });
    ssh.command = 'one';
    ssh._runCommand('one');
    const first = ssh.idleTimer;
    assert.notEqual(first, null);

    ssh.command = 'two';
    ssh._runCommand('two');

    assert.notEqual(ssh.idleTimer, null);
    assert.notEqual(ssh.idleTimer, first);

    ssh._removeListeners();
    ssh.close();
  });
});
