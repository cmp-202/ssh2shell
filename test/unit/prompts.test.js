'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  installFakeSsh2,
  loadSSH2Shell,
  createHost,
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

    ssh._processPasswordPrompt();

    assert.deepEqual(writes, ['secret']);
    assert.equal(ssh.sshObj.pwSent, true);
  });

  it('resets and reports an error when the sudo password is rejected', () => {
    const { ssh } = make({ server: { password: 'secret' }, debug: true });
    const errors = [];
    ssh.on('error', (...args) => errors.push(args));
    ssh.command = 'sudo ls';
    ssh._buffer = 'Password: ';
    ssh.sshObj.pwSent = true;

    ssh._processPasswordPrompt();

    assert.equal(ssh.sshObj.pwSent, false);
    assert.equal(ssh.command, '');
    assert.equal(ssh._buffer, '');
    assert.ok(ssh.sshObj.sessionText.includes('Password: '));
    assert.deepEqual(ssh._stream.writes, ['\x03']);
    assert.ok(errors.length >= 1);
  });

  it('cancels the command when sudo needs a password but none is configured', () => {
    const { ssh } = make({ server: { password: undefined }, debug: true });
    ssh.command = 'sudo ls';
    ssh._buffer = 'Password: ';

    ssh._processPasswordPrompt();

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

    ssh._processPasswordPrompt();

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
});
