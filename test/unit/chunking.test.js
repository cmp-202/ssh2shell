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

// One PTY transcript containing a wrapped command echo, ANSI control sequences,
// CRLF line endings, and a final prompt. The shell can deliver this in any
// chunking; command completion must not depend on where the bytes are split.
const COMMAND = 'echo chunk-boundary-output';
const transcript = [
  COMMAND.slice(0, 12),
  '\r\n',
  COMMAND.slice(12),
  '\r\n',
  '\x1b[?2004l',
  '\x1b]3008;start=abc;type=command;cwd=/home/tester\x1b\\',
  '\r\n',
  'chunk-boundary-output',
  '\r\n',
  '\x1b[?2004h',
  'tester@host:~$ ',
].join('');

async function run(chunks) {
  const completed = [];
  const host = createHost({
    commands: [COMMAND],
    onCommandComplete: (command, response) => {
      completed.push({ command, response });
    },
  });

  const ssh = new SSH2Shell(host);
  let callbackText;
  ssh.connect((text) => {
    callbackText = text;
  });

  await waitForStream(ssh);
  const stream = ssh._stream;
  stream.onWrite = (data, target) => {
    setTimeout(() => {
      for (const chunk of chunks) {
        target.receive(chunk);
      }
    }, 1);
  };
  stream.receive('$ ');

  await waitFor(() => callbackText !== undefined, {
    label: 'callback',
    timeout: 2000,
  });

  assert.deepEqual(stream.writes, [`${COMMAND}\n`]);
  assert.equal(completed.length, 1);
  assert.equal(completed[0].command, COMMAND);
  assert.ok(completed[0].response.includes('chunk-boundary-output'));
  assert.ok(!completed[0].response.includes('3008;'));
  assert.ok(!completed[0].response.includes('[?2004'));
  assert.equal(stream.closed, true);

  return { response: completed[0].response, sessionText: callbackText };
}

function splitAt(index) {
  return [transcript.slice(0, index), transcript.slice(index)];
}

describe('onData chunk boundaries', () => {
  it('produces the same result for every two-chunk split', async () => {
    if (isBaseline()) return;

    const expected = await run([transcript]);
    for (let index = 1; index < transcript.length; index += 1) {
      const actual = await run(splitAt(index));
      assert.deepEqual(actual, expected, `split at byte ${index}`);
    }
  });

  it('produces the same result for byte-at-a-time delivery', async () => {
    if (isBaseline()) return;

    const expected = await run([transcript]);
    const actual = await run(Array.from(transcript, (byte) => byte));
    assert.deepEqual(actual, expected);
  });
});
