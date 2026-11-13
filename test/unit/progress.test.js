'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  installFakeSsh2,
  isBaseline,
  loadSSH2Shell,
  createHost,
  delay,
} = require('./helpers/harness');
const { FakeStream } = require('./helpers/fake-ssh2');

installFakeSsh2();
const SSH2Shell = loadSSH2Shell();

function fakeProgressStream(isTTY = true) {
  return {
    isTTY,
    output: '',
    write(chunk) {
      this.output += chunk;
      return true;
    },
  };
}

function make(overrides = {}) {
  const host = createHost(overrides);
  const ssh = new SSH2Shell(host);
  ssh.sshObj = host;
  ssh._loadDefaults();
  ssh._stream = new FakeStream();
  ssh._progressStream = fakeProgressStream();
  ssh._progressInterval = 5;
  return { ssh, host };
}

describe('progress indicator', () => {
  it('defaults to on', () => {
    if (isBaseline()) return;

    const { ssh, host } = make();
    assert.equal(host.progress, true);
    assert.equal(ssh.progress, true);

    ssh.command = 'echo one';
    ssh._checkCommand();
    ssh._progressTick();
    ssh._progressEnd();

    assert.equal(ssh._progressStream.output, '.\n');
  });

  it('stays silent when explicitly disabled', () => {
    if (isBaseline()) return;

    const { ssh, host } = make({ progress: false });
    assert.equal(host.progress, false);
    assert.equal(ssh.progress, false);

    ssh.command = 'echo one';
    ssh._checkCommand();
    ssh._progressTick();
    ssh._progressEnd();

    assert.equal(ssh._progressStream.output, '');
  });

  it('stays silent when the progress stream is not a TTY', () => {
    if (isBaseline()) return;

    const { ssh } = make({ progress: true });
    ssh._progressStream = fakeProgressStream(false);

    ssh.command = 'echo one';
    ssh._checkCommand();
    ssh._progressTick();
    ssh._progressEnd();

    assert.equal(ssh._progressStream.output, '');
  });

  it('writes heartbeat dots and ends the line on command completion', () => {
    if (isBaseline()) return;

    const { ssh } = make({ progress: true });
    ssh.sshObj.commands = [];

    ssh.command = 'echo one';
    ssh._checkCommand();
    ssh._progressTick();
    ssh._progressTick();
    ssh._commandComplete();

    assert.equal(ssh._progressStream.output, '..\n');
  });

  it('ticks on the interval while a command is in flight', async () => {
    if (isBaseline()) return;

    const { ssh } = make({ progress: true });
    ssh._progressStart();
    await delay(25);
    ssh._progressEnd();

    assert.ok(ssh._progressStream.output.length >= 2);
    assert.ok(ssh._progressStream.output.endsWith('\n'));
  });

  it('does not start progress for direct credential writes', () => {
    if (isBaseline()) return;

    const { ssh } = make({ progress: true });
    ssh._runCommand('secret');

    assert.equal(ssh._progressTimer, null);
    assert.equal(ssh._progressStream.output, '');
  });

  it('labels the host only when the session spans multiple hosts', () => {
    if (isBaseline()) return;

    const first = createHost({
      server: { host: 'first.test' },
      progress: true,
      commands: [],
    });
    const second = createHost({
      server: { host: 'second.test' },
      progress: true,
      commands: [],
    });
    const ssh = new SSH2Shell([first, second]);
    ssh.sshObj = first;
    ssh._loadDefaults();
    ssh._stream = new FakeStream();
    ssh._progressStream = fakeProgressStream();

    ssh.command = 'echo one';
    ssh._checkCommand();
    ssh._progressTick();
    ssh._commandComplete();

    ssh.sshObj = second;
    ssh.host = second.server.host;
    // This test drives two primary hosts without going through
    // _nextPrimaryHost, which is what normally resets the close flag.
    ssh._closing = false;
    ssh._loadDefaults();
    ssh._stream = new FakeStream();
    ssh.command = 'echo two';
    ssh._checkCommand();
    ssh._progressTick();
    ssh._progressEnd();

    assert.equal(
      ssh._progressStream.output,
      '[first.test] .\n[second.test] .\n'
    );
  });

  it('stays silent when debug is enabled', () => {
    if (isBaseline()) return;

    const { ssh } = make({ progress: true, debug: true });

    ssh.command = 'echo one';
    ssh._checkCommand();
    ssh._progressTick();
    ssh._progressEnd();

    assert.equal(ssh._progressStream.output, '');
  });

  it('stays silent when verbose is enabled', () => {
    if (isBaseline()) return;

    const { ssh } = make({ progress: true, verbose: true });

    ssh.command = 'echo one';
    ssh._checkCommand();
    ssh._progressTick();
    ssh._progressEnd();

    assert.equal(ssh._progressStream.output, '');
  });

  it('breaks the line before a user msg and resumes the heartbeat', () => {
    if (isBaseline()) return;

    const messages = [];
    const { ssh } = make({
      progress: true,
      msg: (message) => messages.push(String(message)),
    });

    ssh.command = 'echo one';
    ssh._checkCommand();
    messages.length = 0;

    ssh._progressTick();
    ssh.emit('msg', 'user message');
    ssh._progressTick();
    ssh._progressEnd();

    assert.equal(ssh._progressStream.output, '.\n.\n');
    assert.deepEqual(messages, ['user message']);
  });

  it('stops the heartbeat when the default error handler runs', () => {
    if (isBaseline()) return;

    const { ssh } = make({ progress: true });
    ssh._progressStart();
    ssh._progressTick();
    ssh.emit('error', new Error('boom'), 'Test');

    assert.equal(ssh._progressTimer, null);
    assert.equal(ssh._progressRunning, false);
    assert.equal(ssh._progressStream.output, '.\n');
  });

  it('stops the heartbeat on close', () => {
    if (isBaseline()) return;

    const { ssh } = make({ progress: true });
    ssh._progressStart();
    ssh._progressTick();
    ssh.close();

    assert.equal(ssh._progressTimer, null);
    assert.equal(ssh._progressRunning, false);
    assert.equal(ssh._progressStream.output, '.\n');
  });

  it('stops the heartbeat when a command times out', async () => {
    if (isBaseline()) return;

    const { ssh } = make({ progress: true });
    ssh.idleTime = 5;
    ssh._progressInterval = 1000;
    ssh._progressStart();
    ssh._progressTick();
    ssh._scheduleIdleTimeout('');

    await delay(25);

    assert.equal(ssh._progressTimer, null);
    assert.equal(ssh._progressRunning, false);
    assert.equal(ssh._progressStream.output, '.\n');
  });

  it('never writes progress into sessionText', () => {
    if (isBaseline()) return;

    const { ssh, host } = make({ progress: true });
    ssh.sshObj.commands = [];

    ssh.command = 'echo one';
    ssh._checkCommand();
    ssh._progressTick();
    ssh._commandComplete();

    assert.equal(host.sessionText, '');
  });
});
