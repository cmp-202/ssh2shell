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

async function runWithStderr(t, hostOverrides, script, initialPrompt = '$ ') {
  t.mock.method(console, 'error', () => {});

  const completed = [];
  const stderrEvents = [];
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
  const expected = host.commands.length;
  ssh.on('stderrData', (data) => stderrEvents.push(data));
  ssh.connect();
  await waitForStream(ssh);

  ssh._stream.onWrite = (data, stream) => {
    setTimeout(() => script(data, stream), 1);
  };
  ssh._stream.receive(initialPrompt);

  await waitFor(() => completed.length === expected, {
    label: 'commands',
  });

  return { ssh, host, completed, stderrEvents };
}

describe('stderr capture', () => {
  it('does not merge stderr by default', async (t) => {
    const { ssh, host, completed, stderrEvents } = await runWithStderr(
      t,
      {},
      (data, stream) => {
        stream.stderrData('warning: one\n');
        stream.receive(`${data}output\n$ `);
      }
    );

    assert.equal(completed[0].response, 'echo one\noutput\n$ ');
    assert.ok(!completed[0].response.includes('warning: one'));
    assert.ok(!host.sessionText.includes('warning: one'));
    assert.deepEqual(stderrEvents, ['warning: one\n']);
    if (!isBaseline()) {
      assert.equal(completed[0].details.stderr, undefined);
    }

    ssh._removeListeners();
    ssh.close();
  });

  it('merges captured stderr into the raw response and sessionText', async (t) => {
    if (isBaseline()) return;

    const { ssh, host, completed, stderrEvents } = await runWithStderr(
      t,
      { captureStderr: true },
      (data, stream) => {
        stream.stderrData('warning: one\n');
        stream.receive(`${data}output\n$ `);
      }
    );

    assert.equal(completed[0].response, 'echo one\noutput\n$ \nwarning: one');
    assert.equal(completed[0].details.stderr, 'warning: one');
    assert.equal(completed[0].details.rawResponse, 'echo one\noutput\n$ ');
    assert.ok(host.sessionText.includes('warning: one'));
    assert.deepEqual(stderrEvents, ['warning: one\n']);

    ssh._removeListeners();
    ssh.close();
  });

  it('appends stderr after a handled response has removed the prompt', async (t) => {
    if (isBaseline()) return;

    const { ssh, completed } = await runWithStderr(
      t,
      {
        captureStderr: true,
        commandResponse: 'handled',
        standardPromptRegex: FULL_PROMPT,
      },
      (data, stream) => {
        stream.stderrData('warning: one\n');
        stream.receive(`${data}output\ntester@host:~$ `);
      },
      'tester@host:~$ '
    );

    assert.equal(completed[0].response, 'output\nwarning: one');
    assert.equal(completed[0].details.stderr, 'warning: one');
    assert.ok(completed[0].details.rawResponse.includes('tester@host:~$ '));

    ssh._removeListeners();
    ssh.close();
  });

  it('filters terminal escapes from captured stderr', async (t) => {
    if (isBaseline()) return;

    const { ssh, completed } = await runWithStderr(
      t,
      { captureStderr: true },
      (data, stream) => {
        stream.stderrData('\x1b[31mwarning\x1b[0m\n');
        stream.receive(`${data}output\n$ `);
      }
    );

    assert.equal(completed[0].details.stderr, 'warning');
    assert.ok(completed[0].response.endsWith('warning'));

    ssh._removeListeners();
    ssh.close();
  });

  it('resets the capture between commands', async (t) => {
    if (isBaseline()) return;

    const { ssh, completed } = await runWithStderr(
      t,
      { captureStderr: true, commands: ['echo one', 'echo two'] },
      (data, stream) => {
        if (data === 'echo one\n') {
          stream.stderrData('warning: one\n');
          stream.receive('echo one\noutput one\n$ ');
        } else if (data === 'echo two\n') {
          stream.receive('echo two\noutput two\n$ ');
        }
      }
    );

    assert.equal(completed[0].details.stderr, 'warning: one');
    assert.ok(completed[0].response.includes('warning: one'));
    assert.equal(completed[1].details.stderr, '');
    assert.ok(!completed[1].response.includes('warning: one'));

    ssh._removeListeners();
    ssh.close();
  });
});
