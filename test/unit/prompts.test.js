'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  installFakeSsh2,
  isBaseline,
  loadSSH2Shell,
  createHost,
  delay,
  processSudo,
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

describe('sudo prompt handling', () => {
  it('sends the sudo password once when a password prompt is detected', () => {
    const { ssh } = make({ server: { password: 'secret' }, debug: true });
    const writes = [];
    ssh._runCommand = (command) => writes.push(command);
    ssh.command = 'sudo ls';
    ssh._buffer = 'Password: ';

    processSudo(ssh);

    assert.deepEqual(writes, ['secret']);
    assert.equal(ssh.sshObj.pwSent, true);
  });

  it('resets and reports the sudo password rejection', () => {
    const { ssh } = make({ server: { password: 'secret' }, debug: true });
    const errors = [];
    const messages = [];
    ssh.on('error', (...args) => errors.push(args));
    ssh.on('msg', (message) => messages.push(message));
    ssh.command = 'sudo ls';
    ssh._buffer = 'Password: ';
    ssh.sshObj.pwSent = true;

    processSudo(ssh);

    assert.equal(ssh.sshObj.pwSent, false);
    assert.equal(ssh.command, '');
    assert.equal(ssh._buffer, '');
    assert.ok(ssh.sshObj.sessionText.includes('Password: '));
    assert.deepEqual(ssh._stream.writes, ['\x03']);

    if (isBaseline()) {
      assert.ok(errors.length >= 1);
    } else {
      // A rejected sudo password is a notification, not a terminator.
      assert.equal(errors.length, 0);
      assert.ok(
        messages.some((message) =>
          String(message).includes('Password was incorrect for tester')
        )
      );
    }
  });

  it('cancels the command when sudo needs a password but none is configured', () => {
    const { ssh } = make({ server: { password: undefined }, debug: true });
    ssh.command = 'sudo ls';
    ssh._buffer = 'Password: ';

    processSudo(ssh);

    assert.equal(ssh.sshObj.pwSent, false);
    assert.equal(ssh.command, '');
    assert.deepEqual(ssh._stream.writes, ['\x03']);
  });

  it('completes the command when a standard prompt follows sudo', () => {
    const { ssh } = make({ server: { password: 'secret' } });
    let completed = false;
    ssh._commandComplete = () => {
      completed = true;
    };
    ssh.command = 'sudo ls';
    ssh._buffer = '$ ';
    ssh.sshObj.pwSent = true;

    processSudo(ssh);

    assert.equal(completed, true);
    assert.equal(ssh.sshObj.pwSent, false);
  });
});

describe('nested SSH prompt handling', () => {
  it('sends the nested-host password on the first SSH password prompt', () => {
    const { ssh } = make({ server: { password: 'secret' } });
    const writes = [];
    ssh._runCommand = (command) => writes.push(command);
    ssh.command = 'ssh user@host';
    ssh._buffer = 'Password: ';
    ssh.sshObj.sshAuth = false;

    ssh._processSSHPrompt();

    assert.deepEqual(writes, ['secret']);
    assert.equal(ssh.sshObj.sshAuth, true);
    assert.equal(ssh._buffer, '');
  });

  it('sends the nested-host passphrase when a passphrase is configured', () => {
    const { ssh } = make({ server: { passPhrase: 'phrase' } });
    const writes = [];
    ssh._runCommand = (command) => writes.push(command);
    ssh.command = 'ssh user@host';
    ssh._buffer = 'Password: ';
    ssh.sshObj.sshAuth = false;

    ssh._processSSHPrompt();

    assert.deepEqual(writes, ['phrase']);
    assert.equal(ssh.sshObj.sshAuth, true);
  });

  it('queues an exit and continues when the nested SSH prompt appears', () => {
    const { ssh } = make();
    let next = false;
    ssh._nextCommand = () => {
      next = true;
    };
    ssh.command = 'ssh user@host';
    ssh._buffer = '$ ';
    ssh.sshObj.sshAuth = true;

    ssh._processSSHPrompt();

    assert.ok(ssh.sshObj.exitCommands.includes('exit'));
    assert.equal(ssh.sshObj.sshToNextHost, false);
    assert.equal(next, true);
  });

  it('reports nested SSH auth failure and exits when no previous host exists', () => {
    const { ssh } = make();
    let exited = false;
    ssh._runExit = () => {
      exited = true;
    };
    const errors = [];
    ssh.on('error', (...args) => errors.push(args));
    ssh.command = 'ssh user@host';
    ssh._buffer = 'Password: ';
    ssh.sshObj.sshAuth = true;

    ssh._processSSHPrompt();

    assert.equal(ssh.sshObj.sshAuth, false);
    assert.equal(exited, true);
    assert.ok(errors.length >= 1);
  });

  it('drops back to the previous host when nested SSH auth fails', () => {
    const { ssh } = make();
    let previous = false;
    ssh._previousHost = () => {
      previous = true;
    };
    ssh.command = 'ssh user@host';
    ssh._buffer = 'Password: ';
    ssh.sshObj.sshAuth = true;
    ssh._connections = [createHost({ server: { host: 'primary.test' } })];

    ssh._processSSHPrompt();

    assert.equal(previous, true);
  });

  it('re-arms the idle timeout when post-auth output has no prompt', async () => {
    const { ssh } = make();
    ssh.command = 'ssh user@host';
    ssh._buffer = 'banner text';
    ssh.sshObj.sshAuth = true;
    ssh.idleTime = 0;

    const timeouts = [];
    ssh.on('commandTimeout', (...args) => timeouts.push(args));
    ssh.removeAllListeners('msg');

    ssh._processSSHPrompt();

    if (isBaseline()) {
      // Baseline returns without scheduling a timer, so a silent nested shell
      // hangs until more data arrives.
      assert.equal(ssh.idleTimer, undefined);
    } else {
      await delay(10);
      assert.equal(timeouts.length, 1);
      assert.equal(timeouts[0][1], 'banner text');
    }
  });
});

describe('notification commands', () => {
  it('turns backtick commands into session notes', () => {
    const { ssh } = make();
    let next = false;
    ssh._nextCommand = () => {
      next = true;
    };
    ssh.command = '`hello`';

    ssh._processNotifications();

    assert.ok(ssh.sshObj.sessionText.includes('Note: hello\n'));
    assert.equal(next, true);
  });

  it('emits msg: notifications', () => {
    const messages = [];
    const { ssh } = make({ msg: (message) => messages.push(String(message)) });
    let next = false;
    ssh._nextCommand = () => {
      next = true;
    };
    ssh.command = 'msg:hello';

    ssh._processNotifications();

    assert.ok(messages.some((message) => message.includes('hello')));
    assert.equal(next, true);
  });

  it('runs normal commands through _checkCommand', () => {
    const { ssh } = make();
    let checked = false;
    ssh._checkCommand = () => {
      checked = true;
    };
    ssh.command = 'ls';

    ssh._processNotifications();

    assert.equal(checked, true);
  });

  it('skips an empty command and continues with the queue', () => {
    const { ssh } = make();
    let next = 0;
    ssh._nextCommand = () => {
      next += 1;
    };
    ssh.command = '';

    ssh._processNotifications();

    if (isBaseline()) {
      // Baseline does nothing for a falsy command, so the queue stalls.
      assert.equal(next, 0);
    } else {
      assert.equal(next, 1);
    }
  });
});
