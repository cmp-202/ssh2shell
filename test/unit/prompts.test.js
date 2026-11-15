'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  installFakeSsh2,
  isBaseline,
  loadSSH2Shell,
  createHost,
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
