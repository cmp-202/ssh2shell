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

installFakeSsh2();
const SSH2Shell = loadSSH2Shell();

const FULL_PROMPT = 'tester@host:~\\$\\s?$';

async function runCommand(hostOverrides, responseFor) {
  const completed = [];
  const host = createHost(
    Object.assign(
      {
        commands: ['echo one'],
        onCommandComplete: (command, response, sshObj, details) => {
          completed.push({ command, response, sshObj, details });
        },
      },
      hostOverrides
    )
  );

  const ssh = new SSH2Shell(host);
  ssh.connect();
  await waitForStream(ssh);

  ssh._stream.onWrite = (data, stream) => {
    setTimeout(() => stream.receive(responseFor(data)), 1);
  };
  ssh._stream.receive(
    host.standardPromptRegex ? 'tester@host:~$ ' : '$ '
  );

  await waitFor(() => completed.length === 1, { label: 'commandComplete' });
  return { ssh, host, completed };
}

describe('handled command responses', () => {
  it('keeps the raw buffer as the default payload', async () => {
    const { ssh, completed } = await runCommand({}, (data) => `${data}output\n$ `);

    assert.equal(completed[0].response, 'echo one\noutput\n$ ');
    if (!isBaseline()) {
      assert.equal(completed[0].details.rawResponse, completed[0].response);
    }

    ssh._removeListeners();
    ssh.close();
  });

  it('removes the echoed command and the full trailing prompt', async () => {
    if (isBaseline()) return;

    const { ssh, host, completed } = await runCommand(
      {
        commandResponse: 'handled',
        standardPromptRegex: FULL_PROMPT,
      },
      (data) => `${data}output\ntester@host:~$ `
    );

    assert.equal(completed[0].response, 'output');
    assert.ok(completed[0].details.rawResponse.includes('echo one'));
    assert.ok(completed[0].details.rawResponse.includes('tester@host:~$ '));
    // sessionText remains raw in this release.
    assert.ok(host.sessionText.includes('echo one'));
    assert.ok(host.sessionText.includes('tester@host:~$'));

    ssh._removeListeners();
    ssh.close();
  });

  it('removes a command echo that the PTY wrapped across lines', async () => {
    if (isBaseline()) return;

    const { ssh, completed } = await runCommand(
      {
        commandResponse: 'handled',
        standardPromptRegex: FULL_PROMPT,
      },
      () => 'echo o\r\nne\r\noutput\r\ntester@host:~$ '
    );

    assert.equal(completed[0].response, 'output');

    ssh._removeListeners();
    ssh.close();
  });

  it('only removes the final prompt character without a prompt regex', async () => {
    if (isBaseline()) return;

    const { ssh, completed } = await runCommand(
      { commandResponse: 'handled' },
      (data) => `${data}output\ntester@host:~$ `
    );

    // The default character-class prompt match cannot remove the host text.
    assert.equal(completed[0].response, 'output\ntester@host:~');

    ssh._removeListeners();
    ssh.close();
  });

  it('removes the prompt when the echoed command is absent', () => {
    if (isBaseline()) return;

    const host = createHost({
      commandResponse: 'handled',
      standardPromptRegex: FULL_PROMPT,
    });
    const ssh = new SSH2Shell(host);
    ssh.sshObj = host;
    ssh._loadDefaults();
    ssh.command = 'echo one';

    assert.equal(
      ssh._handleCommandResponse('output\ntester@host:~$ '),
      'output'
    );
  });
});
