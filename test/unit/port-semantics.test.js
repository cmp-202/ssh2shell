'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { installFakeSsh2, loadSSH2Shell, createHost } = require('./helpers/harness');
const { FakeStream } = require('./helpers/fake-ssh2');

installFakeSsh2();
const SSH2Shell = loadSSH2Shell();

function makeLoaded(overrides = {}) {
  const host = createHost(overrides);
  const ssh = new SSH2Shell(host);
  ssh.sshObj = host;
  ssh._loadDefaults();
  return { ssh, host };
}

describe('L2 port semantics', () => {
  it('_initiate returns the action result', () => {
    const { ssh } = makeLoaded();

    assert.equal(ssh._initiate(() => 'ACTION_RESULT'), 'ACTION_RESULT');
    assert.equal(ssh._initiate(() => {}), undefined);
  });

  it('connect() emits newPrimaryHost with the current stream placeholder', () => {
    const { ssh } = makeLoaded();
    const payloads = [];
    ssh.on('newPrimaryHost', (value) => payloads.push(value));

    ssh.connect();

    assert.equal(payloads.length, 1);
    assert.equal(payloads[0], ssh._stream);
  });

  it('_sshConnect returns the write result', () => {
    const { ssh } = makeLoaded();
    ssh._stream = new FakeStream();
    ssh._stream.write = () => 'WRITE_RESULT';

    assert.equal(ssh._sshConnect(), 'WRITE_RESULT');
  });

  it('_runExit returns the close result when there is nothing left to do', () => {
    const { ssh } = makeLoaded();
    ssh.sshObj.exitCommands = [];
    ssh.sshObj.hosts = [];
    ssh._connections = [];
    ssh.command = '';
    ssh.close = () => 'CLOSE_RESULT';

    assert.equal(ssh._runExit(), 'CLOSE_RESULT');
  });
});
