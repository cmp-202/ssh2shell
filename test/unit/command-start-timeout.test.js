'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  installFakeSsh2,
  isBaseline,
  loadSSH2Shell,
  createHost,
  delay,
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

describe('command start timeout', () => {
  it('does not arm a timeout for a silent command by default', async () => {
    const timeouts = [];
    const host = createHost({
      commands: ['sleep 60'],
      idleTimeOut: 20,
      dataIdleTime: 5,
      onCommandTimeout: (...args) => timeouts.push(args),
    });

    const ssh = new SSH2Shell(host);
    ssh.connect();
    await waitForStream(ssh);
    ssh._stream.onWrite = () => {};
    ssh._stream.receive('$ ');

    await delay(80);
    assert.equal(timeouts.length, 0);

    ssh._removeListeners();
    ssh.close();
  });

  it('arms the idle timer when commandStartTimeout is set', async () => {
    if (isBaseline()) return;

    const timeouts = [];
    const host = createHost({
      commands: ['sleep 60'],
      idleTimeOut: 20,
      dataIdleTime: 5,
      commandStartTimeout: true,
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
      noOutput: true,
    });

    ssh._removeListeners();
    ssh.close();
  });

  it('reports noOutput false when the command produced data', async () => {
    if (isBaseline()) return;

    const timeouts = [];
    const host = createHost({
      commands: ['sleep 60'],
      idleTimeOut: 20,
      dataIdleTime: 5,
      commandStartTimeout: true,
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

    assert.equal(timeouts[0].details.noOutput, false);
    assert.ok(timeouts[0].response.includes('partial output'));

    ssh._removeListeners();
    ssh.close();
  });

  it('resets the no-output state when a new command is written', () => {
    if (isBaseline()) return;

    const { ssh } = make({ commandStartTimeout: true });
    ssh.command = 'one';
    ssh._commandSawData = true;

    ssh._runCommand('one');

    assert.equal(ssh._commandSawData, false);
    if (ssh.idleTimer) clearTimeout(ssh.idleTimer);
  });

  it('marks data as seen only while a command is in flight', () => {
    if (isBaseline()) return;

    const { ssh } = make();
    ssh.command = '';
    ssh._onData('banner');
    assert.equal(ssh._commandSawData, false);

    ssh.command = 'one';
    ssh._onData('output');
    assert.equal(ssh._commandSawData, true);

    if (ssh.idleTimer) clearTimeout(ssh.idleTimer);
    if (ssh.dataReceivedTimer) clearTimeout(ssh.dataReceivedTimer);
    ssh._removeListeners();
    ssh.close();
  });
});
