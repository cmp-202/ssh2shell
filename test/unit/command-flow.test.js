'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  installFakeSsh2,
  loadSSH2Shell,
  createHost,
  waitFor,
  waitForStream,
} = require('./helpers/harness');

installFakeSsh2();
const SSH2Shell = loadSSH2Shell();

async function start(host) {
  const ssh = new SSH2Shell(host);
  let callbackText;
  let endText;

  ssh.on('end', (text) => {
    endText = text;
  });

  ssh.connect((text) => {
    callbackText = text;
  });

  await waitForStream(ssh);
  return {
    ssh,
    get callbackText() {
      return callbackText;
    },
    get endText() {
      return endText;
    },
  };
}

function echoPrompt(data, stream) {
  setTimeout(() => stream.receive(data + 'output\n$ '), 1);
}

describe('single-host command flow', () => {
  it('runs commands sequentially and completes the session', async () => {
    const completed = [];
    const host = createHost({
      commands: ['echo one', 'echo two'],
      onCommandComplete: (command) => completed.push(command),
    });

    const session = await start(host);
    session.ssh._stream.onWrite = echoPrompt;
    session.ssh._stream.receive('$ ');

    await waitFor(() => session.callbackText !== undefined, {
      label: 'callback',
    });

    assert.deepEqual(session.ssh._stream.writes, ['echo one\n', 'echo two\n']);
    assert.deepEqual(completed, ['echo one', 'echo two']);
    assert.equal((host.sessionText.match(/output/g) || []).length, 2);
    assert.equal(session.callbackText, session.endText);
    assert.ok(session.callbackText.includes('example.test:'));
    assert.equal(session.ssh._stream.closed, true);
    assert.equal(session.ssh.connection.ended, true);
    assert.equal(session.ssh._hosts.length, 0);
  });

  it('handles session notes and msg notifications without writing them', async () => {
    const messages = [];
    const host = createHost({
      commands: ['`Note one`', 'msg:hello', 'echo three'],
      msg: (message) => messages.push(String(message)),
    });

    const session = await start(host);
    session.ssh._stream.onWrite = echoPrompt;
    session.ssh._stream.receive('$ ');

    await waitFor(() => session.callbackText !== undefined, {
      label: 'callback',
    });

    assert.deepEqual(session.ssh._stream.writes, ['echo three\n']);
    assert.ok(host.sessionText.includes('Note: Note one'));
    assert.ok(messages.some((message) => message.includes('hello')));
  });

  it('includes the banner in sessionText when showBanner is true', async () => {
    const host = createHost({
      commands: ['echo x'],
      showBanner: true,
    });

    const session = await start(host);
    session.ssh._stream.onWrite = echoPrompt;
    session.ssh._stream.receive('BANNER\n$ ');

    await waitFor(() => session.callbackText !== undefined, {
      label: 'callback',
    });

    assert.ok(host.sessionText.startsWith('BANNER\n$ '));
    assert.ok(session.callbackText.includes('BANNER'));
  });

  it('raises commandTimeout when data arrives but no prompt follows', async () => {
    const timeouts = [];
    const processing = [];
    const host = createHost({
      commands: ['sleep 1'],
      idleTimeOut: 20,
      dataIdleTime: 5,
      onCommandProcessing: (command, response) => {
        processing.push({ command, response });
      },
      onCommandTimeout: (command, response) => {
        timeouts.push({ command, response });
      },
    });

    const ssh = new SSH2Shell(host);
    ssh.connect();

    await waitForStream(ssh);

    ssh._stream.onWrite = (data, stream) => {
      if (data === 'sleep 1\n') {
        setTimeout(() => stream.receive('partial output'), 1);
      }
    };
    ssh._stream.receive('$ ');

    await waitFor(() => timeouts.length === 1, {
      label: 'commandTimeout',
    });

    assert.equal(timeouts[0].command, 'sleep 1');
    assert.ok(timeouts[0].response.includes('partial output'));
    assert.ok(processing.some((entry) => entry.command === 'sleep 1'));

    ssh._removeListeners();
    ssh.close();
  });
});
