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

function timeoutHost(overrides = {}) {
  return createHost(
    Object.assign(
      {
        commands: ['sleep 1'],
        idleTimeOut: 15,
        dataIdleTime: 5,
      },
      overrides
    )
  );
}

async function startTimeoutRun(host) {
  const ssh = new SSH2Shell(host);
  ssh.connect();
  await waitForStream(ssh);

  ssh._stream.onWrite = (data, stream) => {
    if (data === 'sleep 1\n') {
      setTimeout(() => stream.receive('partial output'), 1);
    }
  };
  ssh._stream.receive('$ ');
  return ssh;
}

function make(overrides = {}) {
  const host = createHost(overrides);
  const ssh = new SSH2Shell(host);
  ssh.sshObj = host;
  ssh._loadDefaults();
  ssh._stream = new FakeStream();
  return { ssh, host };
}

describe('command timeout retries', () => {
  it('keeps the single-timeout behavior when retries are not configured', async () => {
    if (isBaseline()) return;

    const timeouts = [];
    const host = timeoutHost({
      onCommandTimeout: (command, response, stream, connection, details) => {
        timeouts.push({ command, response, details });
      },
    });

    const ssh = await startTimeoutRun(host);
    await waitFor(() => timeouts.length === 1, { label: 'timeout' });

    assert.equal(timeouts[0].command, 'sleep 1');
    assert.ok(timeouts[0].response.includes('partial output'));
    assert.deepEqual(timeouts[0].details, {
      attempt: 1,
      maxRetries: 0,
      final: true,
      noOutput: false,
    });

    await delay(40);
    assert.equal(timeouts.length, 1);

    ssh._removeListeners();
    ssh.close();
  });

  it('re-arms until the configured retry count is exhausted', async () => {
    if (isBaseline()) return;

    const timeouts = [];
    const host = timeoutHost({
      commandTimeoutRetries: 2,
      onCommandTimeout: (command, response, stream, connection, details) => {
        timeouts.push(details);
      },
    });

    const ssh = await startTimeoutRun(host);
    await waitFor(() => timeouts.length === 3, { label: 'retries' });

    assert.deepEqual(
      timeouts.map((details) => details.attempt),
      [1, 2, 3]
    );
    assert.deepEqual(
      timeouts.map((details) => details.final),
      [false, false, true]
    );

    await delay(40);
    assert.equal(timeouts.length, 3);

    ssh._removeListeners();
    ssh.close();
  });

  it('lets a handler answer and then completes normally', async () => {
    if (isBaseline()) return;

    const timeouts = [];
    const completed = [];
    const host = createHost({
      commands: ['read answer', 'echo done'],
      idleTimeOut: 40,
      dataIdleTime: 5,
      commandTimeoutRetries: 1,
      onCommandTimeout: (command, response, stream, connection, details) => {
        timeouts.push({ command, details });
        if (
          command === 'read answer' &&
          response.includes('(Y,n)') &&
          details.final === false
        ) {
          stream.write('y\n');
        }
      },
      onCommandComplete: (command) => completed.push(command),
    });

    const ssh = new SSH2Shell(host);
    ssh.connect();
    await waitForStream(ssh);

    ssh._stream.onWrite = (data, stream) => {
      if (data === 'read answer\n') {
        setTimeout(() => stream.receive('(Y,n) '), 1);
      } else if (data === 'y\n') {
        setTimeout(() => stream.receive('$ '), 1);
      } else if (data === 'echo done\n') {
        setTimeout(() => stream.receive(`${data}done\n$ `), 1);
      }
    };
    ssh._stream.receive('$ ');

    await waitFor(() => completed.length === 2, { label: 'commands' });

    assert.deepEqual(completed, ['read answer', 'echo done']);
    assert.equal(timeouts.length, 1);
    assert.equal(timeouts[0].details.attempt, 1);
    assert.equal(timeouts[0].details.final, false);

    ssh._removeListeners();
    ssh.close();
  });

  it('does not re-arm after the handler stops the run', async () => {
    if (isBaseline()) return;

    const timeouts = [];
    const host = timeoutHost({
      commandTimeoutRetries: 3,
      onCommandTimeout: function (command, response, stream, connection, details) {
        timeouts.push(details.attempt);
        this.stop('handler-stop');
      },
    });

    const ssh = new SSH2Shell(host);
    let callbackText;
    ssh.connect((text) => {
      callbackText = text;
    });
    await waitForStream(ssh);

    ssh._stream.onWrite = (data, stream) => {
      if (data === 'sleep 1\n') {
        setTimeout(() => stream.receive('partial output'), 1);
      }
    };
    ssh._stream.receive('$ ');

    await waitFor(() => callbackText !== undefined, { label: 'callback' });
    assert.deepEqual(timeouts, [1]);

    await delay(40);
    assert.deepEqual(timeouts, [1]);
  });

  it('stops retrying when the handler clears retryCommandTimeout', async () => {
    if (isBaseline()) return;

    const timeouts = [];
    const host = timeoutHost({
      commandTimeoutRetries: 3,
      onCommandTimeout: function (command, response, stream, connection, details) {
        timeouts.push(details.attempt);
        this.sshObj.retryCommandTimeout = false;
      },
    });

    const ssh = await startTimeoutRun(host);
    await waitFor(() => timeouts.length === 1, { label: 'timeout' });

    await delay(40);
    assert.deepEqual(timeouts, [1]);

    ssh._removeListeners();
    ssh.close();
  });

  it('closes only on the final attempt with the default handler', async () => {
    if (isBaseline()) return;

    const host = timeoutHost({ commandTimeoutRetries: 2 });
    const ssh = new SSH2Shell(host);
    const errors = [];
    let callbackText;

    ssh.on('error', (...args) => errors.push(args));
    ssh.connect((text) => {
      callbackText = text;
    });
    await waitForStream(ssh);

    ssh._stream.onWrite = (data, stream) => {
      if (data === 'sleep 1\n') {
        setTimeout(() => stream.receive('partial output'), 1);
      }
    };
    ssh._stream.receive('$ ');

    await waitFor(() => callbackText !== undefined, { label: 'callback' });

    assert.equal(errors.length, 1);
    assert.ok(String(errors[0][0]).includes('Command timed out'));
    assert.equal(errors[0][1], 'Command Timeout');
  });

  it('resets the attempt count when a new command is written', () => {
    if (isBaseline()) return;

    const { ssh } = make();
    ssh.command = 'one';
    ssh.sshObj.commandTimeoutAttempt = 3;
    ssh.sshObj.retryCommandTimeout = false;

    ssh._runCommand('one');

    assert.equal(ssh.sshObj.commandTimeoutAttempt, 0);
    assert.equal(ssh.sshObj.retryCommandTimeout, undefined);
  });

  it('does not reset the attempt count for an internal password write', () => {
    if (isBaseline()) return;

    const { ssh } = make({ server: { password: 'secret' } });
    ssh.command = 'sudo ls';
    ssh.sshObj.commandTimeoutAttempt = 2;

    ssh._runCommand('secret');

    assert.equal(ssh.sshObj.commandTimeoutAttempt, 2);
  });

  it('resets the attempt count when a command completes', () => {
    if (isBaseline()) return;

    const { ssh } = make();
    ssh.command = 'one';
    ssh._buffer = 'one\noutput\n$ ';
    ssh.sshObj.commandTimeoutAttempt = 2;
    ssh._nextCommand = () => {};

    ssh._commandComplete();

    assert.equal(ssh.sshObj.commandTimeoutAttempt, 0);
  });
});
