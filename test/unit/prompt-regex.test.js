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

const FULL_PROMPT = 'tester@host:~\\$\\s?$';

function make(overrides = {}) {
  const host = createHost(overrides);
  const ssh = new SSH2Shell(host);
  ssh.sshObj = host;
  ssh._loadDefaults();
  ssh._stream = new FakeStream();
  return { ssh, host };
}

describe('opt-in standard prompt regex', () => {
  it('matches the full prompt instead of the last character', () => {
    if (isBaseline()) return;

    const { ssh } = make({ standardPromptRegex: FULL_PROMPT });

    assert.equal(ssh.standardPrompt.test('tester@host:~$ '), true);
    assert.equal(ssh.standardPrompt.test('price: $ '), false);
    assert.equal(ssh.standardPrompt.test('100% '), false);
  });

  it('accepts a RegExp and strips stateful flags', () => {
    if (isBaseline()) return;

    const { ssh } = make({ standardPromptRegex: /tester@host:~\$ $/g });

    assert.equal(ssh.standardPrompt.flags.includes('g'), false);
    assert.equal(ssh.standardPrompt.test('tester@host:~$ '), true);
    // A stateful regex would alternate here.
    assert.equal(ssh.standardPrompt.test('tester@host:~$ '), true);
  });

  it('falls back to standardPrompt when the regex is invalid', () => {
    if (isBaseline()) return;

    const { ssh } = make({ standardPromptRegex: '([' });

    assert.equal(ssh.standardPrompt.test('$ '), true);
    assert.equal(ssh.standardPrompt.test('plain output'), false);
  });

  it('does not complete a command on output ending with a prompt character', async () => {
    if (isBaseline()) return;

    const completed = [];
    const host = createHost({
      commands: ['echo price'],
      standardPromptRegex: FULL_PROMPT,
      onCommandComplete: (command, response) => completed.push({ command, response }),
    });

    const ssh = new SSH2Shell(host);
    ssh.connect();
    await waitForStream(ssh);

    ssh._stream.onWrite = (data, stream) => {
      // Output ends with `$ `, but it is not the host prompt.
      setTimeout(() => stream.receive(`${data}price: $ `), 1);
    };
    ssh._stream.receive('tester@host:~$ ');

    await delay(30);
    assert.equal(completed.length, 0);

    ssh._stream.receive('tester@host:~$ ');
    await waitFor(() => completed.length === 1, { label: 'commandComplete' });

    assert.equal(completed[0].command, 'echo price');
    assert.ok(completed[0].response.includes('price: $'));

    ssh._removeListeners();
    ssh.close();
  });

  it('uses the full prompt regex when sudo completes', () => {
    if (isBaseline()) return;

    const { ssh } = make({ standardPromptRegex: FULL_PROMPT });
    let completed = false;
    ssh._commandComplete = () => {
      completed = true;
    };
    ssh.command = 'sudo ls';
    ssh._buffer = 'tester@host:~$ ';
    ssh.sshObj.pwSent = true;

    ssh._processSudoPrompt();

    assert.equal(completed, true);
  });

  it('uses the full prompt regex when a nested SSH connection completes', () => {
    if (isBaseline()) return;

    const { ssh } = make({ standardPromptRegex: FULL_PROMPT });
    let next = false;
    ssh._nextCommand = () => {
      next = true;
    };
    ssh.command = 'ssh user@host';
    ssh._buffer = 'tester@host:~$ ';
    ssh.sshObj.sshAuth = true;

    ssh._processSSHPrompt();

    assert.equal(next, true);
  });
});
