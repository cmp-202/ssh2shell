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
const { FakeClient, FakeStream } = require('./helpers/fake-ssh2');

installFakeSsh2();
const SSH2Shell = loadSSH2Shell();

function echoPrompt(data, stream) {
  setTimeout(() => stream.receive(`${data}output\n$ `), 1);
}

describe('whole-run stop', () => {
  it('stop() aborts the queue and closes once with the completed response', async () => {
    if (isBaseline()) return;

    const completed = [];
    const messages = [];
    let ssh;
    const host = createHost({
      commands: ['echo one', 'echo two'],
      onCommandComplete: (command) => {
        completed.push(command);
        if (command === 'echo one') {
          ssh.stop('command-failed');
        }
      },
    });

    ssh = new SSH2Shell(host);
    ssh.on('msg', (message) => messages.push(String(message)));
    let callbackText;
    const ends = [];
    ssh.on('end', (text) => ends.push(text));
    ssh.connect((text) => {
      callbackText = text;
    });
    await waitForStream(ssh);
    // Teardown clears the `_stream` alias, so keep the stream the run used.
    const stream = ssh._stream;

    stream.onWrite = echoPrompt;
    stream.receive('$ ');

    await waitFor(() => callbackText !== undefined, { label: 'callback' });

    assert.deepEqual(stream.writes, ['echo one\n']);
    assert.deepEqual(completed, ['echo one']);
    assert.equal(ends.length, 1);
    assert.ok(callbackText.includes('example.test:'));
    assert.ok(callbackText.includes('output'));
    assert.ok(
      messages.some((message) =>
        message.includes('Stop requested: command-failed')
      )
    );
    assert.equal(ssh._stopping, true);
    assert.equal(stream.closed, true);
  });

  it("stop() leaves the caller's nested hosts array intact", async () => {
    if (isBaseline()) return;

    const nested = createHost({
      server: { host: 'nested.test' },
      commands: ['echo nested'],
    });
    const hosts = [nested];
    let ssh;
    const host = createHost({
      commands: ['echo one'],
      hosts,
      onCommandComplete: () => {
        ssh.stop('command-failed');
      },
    });

    ssh = new SSH2Shell(host);
    let callbackText;
    ssh.connect((text) => {
      callbackText = text;
    });
    await waitForStream(ssh);
    const stream = ssh._stream;

    stream.onWrite = echoPrompt;
    stream.receive('$ ');

    await waitFor(() => callbackText !== undefined, { label: 'callback' });

    // The run's queue is cleared through the record, not the caller's config.
    assert.deepEqual(hosts, [nested]);
  });

  it('sshObj.abort stops the run after the handler returns', async () => {
    if (isBaseline()) return;

    const messages = [];
    const host = createHost({
      commands: ['echo one', 'echo two'],
      onCommandComplete: (command, response, sshObj) => {
        if (command === 'echo one') {
          sshObj.abort = 'handler-abort';
        }
      },
    });

    const ssh = new SSH2Shell(host);
    ssh.on('msg', (message) => messages.push(String(message)));
    let callbackText;
    ssh.connect((text) => {
      callbackText = text;
    });
    await waitForStream(ssh);
    const stream = ssh._stream;

    stream.onWrite = echoPrompt;
    stream.receive('$ ');

    await waitFor(() => callbackText !== undefined, { label: 'callback' });

    assert.deepEqual(stream.writes, ['echo one\n']);
    assert.ok(
      messages.some((message) => message.includes('Stop requested: handler-abort'))
    );
  });

  it('sshObj.stop is no longer an abort alias', async () => {
    if (isBaseline()) return;

    const completed = [];
    const messages = [];
    const host = createHost({
      commands: ['echo one', 'echo two'],
      onCommandComplete: (command, response, sshObj) => {
        completed.push(command);
        if (command === 'echo one') {
          sshObj.stop = 'legacy-stop';
        }
      },
    });

    const ssh = new SSH2Shell(host);
    ssh.on('msg', (message) => messages.push(String(message)));
    let callbackText;
    ssh.connect((text) => {
      callbackText = text;
    });
    await waitForStream(ssh);
    const stream = ssh._stream;

    stream.onWrite = echoPrompt;
    stream.receive('$ ');

    await waitFor(() => callbackText !== undefined, { label: 'callback' });

    assert.deepEqual(completed, ['echo one', 'echo two']);
    assert.equal(
      messages.some((message) => message.includes('Stop requested')),
      false
    );
  });

  it('stop() is a no-op before connect()', () => {
    if (isBaseline()) return;

    const ssh = new SSH2Shell(createHost());
    ssh.stop('user');

    assert.equal(ssh._started, false);
    assert.equal(ssh._stopping, false);
  });

  it('stop() is a no-op after the run ended on a primary failure', async () => {
    if (isBaseline()) return;

    class ShellError extends FakeClient {
      shell(window, options, callback) {
        if (typeof options === 'function') {
          callback = options;
        }
        const stream = new FakeStream();
        this.stream = stream;
        process.nextTick(() => callback(new Error('shell boom'), stream));
        return stream;
      }
    }

    const ssh = new SSH2Shell(createHost({ commands: ['echo one'] }));
    injectSsh2Client(ssh, ShellError);
    const messages = [];
    ssh.on('msg', (message) => messages.push(String(message)));
    let callbackText;
    ssh.connect((text) => {
      callbackText = text;
    });

    await waitFor(() => callbackText !== undefined, { label: 'callback' });

    // The callback ends the run even when the last host failed rather than
    // closed cleanly.
    assert.equal(ssh._runComplete, true);

    const before = messages.length;
    ssh.stop('user');

    assert.equal(ssh._stopping, false);
    assert.equal(ssh._stopReason, null);
    assert.equal(messages.length, before);
    assert.equal(
      messages.some((message) => message.includes('Stop requested')),
      false
    );
  });
});

describe('safe close', () => {
  it('close() from commandComplete stops the queue and keeps the response', async () => {
    if (isBaseline()) return;

    let ssh;
    const host = createHost({
      commands: ['echo one', 'echo two'],
      onCommandComplete: (command) => {
        if (command === 'echo one') {
          ssh.close();
        }
      },
    });

    ssh = new SSH2Shell(host);
    let callbackText;
    const ends = [];
    ssh.on('end', (text) => ends.push(text));
    ssh.connect((text) => {
      callbackText = text;
    });
    await waitForStream(ssh);
    const stream = ssh._stream;

    stream.onWrite = echoPrompt;
    stream.receive('$ ');

    await waitFor(() => callbackText !== undefined, { label: 'callback' });

    assert.deepEqual(stream.writes, ['echo one\n']);
    assert.equal(ends.length, 1);
    assert.ok(callbackText.includes('output'));
    assert.equal(stream.closed, true);
  });

  it("_prepareGracefulClose leaves the caller's nested hosts array intact", () => {
    if (isBaseline()) return;

    const nested = createHost({ server: { host: 'nested.test' } });
    const hosts = [nested];
    const host = createHost({ hosts });

    const ssh = new SSH2Shell(host);
    ssh.sshObj = host;
    ssh._loadDefaults();

    ssh._prepareGracefulClose();

    assert.deepEqual(hosts, [nested]);
    assert.deepEqual(ssh._activeContext().pendingHosts, []);
  });

  it('close() continues with the remaining primary hosts', async () => {
    if (isBaseline()) return;

    let ssh;
    const first = createHost({
      server: { host: 'first.test' },
      commands: ['echo one'],
      onCommandComplete: () => {
        ssh.close();
      },
    });
    const second = createHost({
      server: { host: 'second.test' },
      commands: ['echo two'],
    });

    ssh = new SSH2Shell([first, second]);
    let callbackText;
    const ends = [];
    ssh.on('end', (text) => ends.push(text));
    ssh.connect((text) => {
      callbackText = text;
    });
    await waitForStream(ssh);

    const firstStream = ssh._stream;
    firstStream.onWrite = echoPrompt;
    firstStream.receive('$ ');

    await waitFor(
      () =>
        ssh.host === 'second.test' &&
        ssh._stream &&
        ssh._stream !== firstStream &&
        typeof ssh._stream.receive === 'function',
      { label: 'second host stream' }
    );

    ssh._stream.onWrite = echoPrompt;
    ssh._stream.receive('$ ');

    await waitFor(() => callbackText !== undefined, { label: 'callback' });

    assert.ok(callbackText.includes('first.test:'));
    assert.ok(callbackText.includes('second.test:'));
    assert.equal(ends.length, 2);
    assert.equal(ssh._hosts.length, 0);
  });
});

describe('host finalization', () => {
  it('merges nested text and emits end once per host', () => {
    if (isBaseline()) return;

    const primary = createHost({ server: { host: 'primary.test' } });
    primary.sessionText = 'primary output';
    const nested = createHost({ server: { host: 'nested.test' } });
    nested.sessionText = 'nested output';

    const ssh = new SSH2Shell(primary);
    ssh.sshObj = nested;
    ssh.host = 'nested.test';
    ssh._connections = [primary];
    ssh._primaryhostSessionText = 'primary.test: ';

    const ends = [];
    ssh.on('end', (...args) => ends.push(args));

    ssh._finalizeRun('connection-close');

    assert.equal(ends.length, 2);
    assert.ok(String(ends[0][0]).includes('nested output'));
    assert.ok(ssh._allSessions.includes('primary output'));
    assert.ok(ssh._allSessions.includes('nested output'));

    // Finalization is idempotent: a second pass emits nothing.
    ssh._finalizeRun('again');
    assert.equal(ends.length, 2);
  });
});

describe('handler stop flags', () => {
  it('applies skipCommands, skipHosts, and skipPrimaryHosts', () => {
    if (isBaseline()) return;

    const host = createHost();
    host.commands = ['a', 'b'];
    host.hosts = [createHost()];
    host.skipCommands = true;
    host.skipHosts = true;
    host.skipPrimaryHosts = true;

    const ssh = new SSH2Shell(host);
    ssh.sshObj = host;
    ssh._hosts = [createHost(), createHost()];

    ssh._applyHandlerFlags();

    assert.equal(host.commands.length, 0);
    assert.equal(host.hosts.length, 0);
    assert.equal(ssh._hosts.length, 0);
    assert.equal(host.skipCommands, false);
    assert.equal(host.skipHosts, false);
    assert.equal(host.skipPrimaryHosts, false);
  });

  it('skipHosts leaves sibling nested hosts on a parent queued (by design)', () => {
    if (isBaseline()) return;

    const parent = createHost({ server: { host: 'parent.test' } });
    const sibling = createHost({ server: { host: 'sibling.test' } });
    parent.hosts = [sibling];
    const current = createHost({ server: { host: 'current.test' } });
    current.hosts = [createHost({ server: { host: 'child.test' } })];

    const ssh = new SSH2Shell(parent);
    ssh.sshObj = current;
    ssh._connections = [parent];
    current.skipHosts = true;

    ssh._applyHandlerFlags();

    assert.equal(current.hosts.length, 0);
    assert.equal(parent.hosts.length, 1);
    assert.equal(parent.hosts[0], sibling);
  });
});

describe('instance reuse', () => {
  it('connect() throws instead of rerunning a finished instance', async () => {
    if (isBaseline()) return;

    const host = createHost({ commands: [] });
    const ssh = new SSH2Shell(host);
    let callbackText;
    ssh.connect((text) => {
      callbackText = text;
    });
    await waitForStream(ssh);
    ssh._stream.receive('$ ');
    await waitFor(() => callbackText !== undefined, { label: 'callback' });

    assert.throws(
      () => ssh.connect(() => {}),
      /instances run once/i
    );
  });
});

describe('sudo failure visibility', () => {
  it('emits a normal msg and can abort the run', () => {
    if (isBaseline()) return;

    const host = createHost({ abortOnSudoFailure: true });
    const ssh = new SSH2Shell(host);
    ssh.sshObj = host;
    ssh._loadDefaults();
    ssh._stream = new FakeStream();
    ssh._started = true;

    const messages = [];
    ssh.on('msg', (message) => messages.push(String(message)));

    ssh.command = 'sudo ls';
    ssh._buffer = '[sudo] password for tester: ';
    ssh.sshObj.pwSent = true;

    ssh._processSudoPrompt();

    assert.equal(host.sudoFailed, true);
    assert.equal(ssh._stopping, true);
    assert.equal(ssh._stopReason, 'sudo-failed');
    assert.ok(
      messages.some((message) =>
        message.includes('Sudo authentication failed for tester')
      )
    );
    assert.ok(ssh._stream.writes.includes('\x03'));

    // Do not leave the stop timer armed in the test process.
    ssh._forceStop();
  });

  it('abortOnSudoFailure finishes as soon as the prompt returns', async () => {
    if (isBaseline()) return;

    const host = createHost({
      commands: ['sudo ls'],
      abortOnSudoFailure: true,
      // Long enough that waiting for the stop timer is unmistakable.
      idleTimeOut: 1000,
    });
    const ssh = new SSH2Shell(host);
    let callbackText;
    ssh.connect((text) => {
      callbackText = text;
    });
    await waitForStream(ssh);
    const stream = ssh._stream;

    stream.onWrite = (data, target) => {
      if (data === 'sudo ls\n') {
        setTimeout(() => target.receive('[sudo] password for tester: '), 1);
      } else if (data === 'secret\n') {
        setTimeout(() => target.receive('[sudo] password for tester: '), 1);
      } else if (data === '\x03') {
        setTimeout(() => target.receive('$ '), 1);
      }
    };
    stream.receive('$ ');

    // The Ctrl-C prompt arrives almost immediately; the 1000ms stop timer
    // must not be what ends the run.
    await waitFor(() => callbackText !== undefined, {
      label: 'callback after prompt',
      timeout: 500,
    });

    assert.equal(ssh._stopReason, 'sudo-failed');
    assert.equal(ssh._stopping, true);
  });
});
