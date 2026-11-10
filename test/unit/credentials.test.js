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

function messagesFrom(overrides = {}) {
  const messages = [];
  const host = createHost(
    Object.assign(
      {
        msg: (message) => messages.push(message),
      },
      overrides
    )
  );
  const ssh = new SSH2Shell(host);
  ssh.sshObj = host;
  ssh._loadDefaults();
  ssh._stream = new FakeStream();

  return { ssh, host, messages };
}

function textOf(messages) {
  return messages
    .map((message) =>
      typeof message === 'string' ? message : JSON.stringify(message)
    )
    .join('\n');
}

describe('credential logging', () => {
  it('redacts the password in the verbose config dump by default', () => {
    const { messages } = messagesFrom({ verbose: true });
    const text = textOf(messages);

    if (isBaseline()) {
      // Baseline emits the whole sshObj and exposes the password.
      assert.ok(text.includes('secret'));
    } else {
      assert.ok(text.includes('[REDACTED]'));
      assert.ok(!text.includes('secret'));
    }
  });

  it('redacts nested host credentials in the config dump', () => {
    const nested = createHost({
      server: { host: 'nested.test', password: 'nested-secret' },
    });
    const { messages } = messagesFrom({ verbose: true, hosts: [nested] });
    const text = textOf(messages);

    if (isBaseline()) {
      assert.ok(text.includes('nested-secret'));
    } else {
      assert.ok(text.includes('[REDACTED]'));
      assert.ok(!text.includes('nested-secret'));
    }
  });

  it('redacts a credential command in verbose output by default', () => {
    const { ssh, host, messages } = messagesFrom({ verbose: true });
    messages.length = 0;

    ssh._runCommand(host.server.password);

    const text = textOf(messages);
    if (isBaseline()) {
      // Baseline logs "sending: <password>".
      assert.ok(text.includes('secret'));
    } else {
      assert.ok(text.includes('[REDACTED]'));
      assert.ok(!text.includes('secret'));
    }
  });

  it('exposes the password when exposeCredentials is true', () => {
    const { ssh, host, messages } = messagesFrom({
      verbose: true,
      exposeCredentials: true,
    });
    messages.length = 0;

    ssh._runCommand(host.server.password);

    const text = textOf(messages);
    assert.ok(text.includes('secret'));
    assert.ok(!text.includes('[REDACTED]'));
  });

  it('redacts the sudo password in verbose output by default', () => {
    const { ssh, messages } = messagesFrom({
      debug: true,
      verbose: true,
      server: { password: 'secret' },
    });
    ssh.command = 'sudo ls';
    ssh._buffer = 'Password: ';
    messages.length = 0;

    processSudo(ssh);

    const text = textOf(messages);
    if (isBaseline()) {
      assert.ok(text.includes('secret'));
    } else {
      assert.ok(text.includes('[REDACTED]'));
      assert.ok(!text.includes('secret'));
    }
  });

  it('defaults exposeCredentials to false and preserves true', () => {
    if (isBaseline()) {
      // The flag is new; the baseline has no equivalent.
      return;
    }

    const { host } = messagesFrom();
    assert.equal(host.exposeCredentials, false);

    const { host: exposed } = messagesFrom({ exposeCredentials: true });
    assert.equal(exposed.exposeCredentials, true);
  });
});
