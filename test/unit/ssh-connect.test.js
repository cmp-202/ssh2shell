'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  installFakeSsh2,
  isBaseline,
  loadSSH2Shell,
  createHost,
} = require('./helpers/harness');
const { FakeStream } = require('./helpers/fake-ssh2');

installFakeSsh2();
const SSH2Shell = loadSSH2Shell();

function build(sshConfig, serverOverrides = {}) {
  const host = createHost({
    server: Object.assign(
      {
        host: 'target.test',
        port: 22,
        userName: 'user',
        password: 'pass',
      },
      serverOverrides,
      { ssh: sshConfig }
    ),
  });
  const ssh = new SSH2Shell(host);
  ssh.sshObj = host;
  ssh._loadDefaults();
  ssh._stream = new FakeStream();

  const writes = [];
  const errors = [];
  ssh._runCommand = (command) => writes.push(command);
  ssh.on('error', (...args) => errors.push(args));

  return { ssh, host, writes, errors };
}

describe('_sshConnect command construction', () => {
  it('builds a quoted ssh command with safe defaults', () => {
    const { ssh, writes } = build();

    ssh._sshConnect();

    assert.equal(writes.length, 1);
    const command = writes[0];
    assert.ok(command.startsWith('ssh -x '));
    assert.ok(command.includes('-o "StrictHostKeyChecking=no"'));
    assert.ok(command.includes('-p 22'));
    assert.ok(command.includes("'user'@'target.test'"));
    assert.equal(ssh.command, command);
    assert.equal(ssh.sshObj.sshAuth, false);
    assert.equal(ssh.sshObj.sshToNextHost, true);
  });

  it('adds tty and verbose flags', () => {
    const { ssh, writes } = build({
      disablePseudoTTY: true,
      forcePseudoTTY: true,
      verbose: true,
    });

    ssh._sshConnect();

    assert.ok(writes[0].includes('-xTtv'));
  });

  it('quotes custom ssh options', () => {
    const { ssh, writes } = build({
      options: { StrictHostKeyChecking: 'yes' },
    });

    ssh._sshConnect();

    assert.ok(writes[0].includes("-o StrictHostKeyChecking='yes'"));
  });

  it('escapes single quotes in paths', () => {
    const { ssh, writes } = build({ identityFile: "/tmp/it's" });

    ssh._sshConnect();

    assert.ok(writes[0].includes("-i '/tmp/it'\\''s'"));
  });

  it('strips non-digits from the port', () => {
    const { ssh, writes } = build(undefined, { port: '22; rm -rf /' });

    ssh._sshConnect();

    assert.ok(writes[0].includes('-p 22'));
    assert.ok(!writes[0].includes('rm -rf'));
  });

  it('rejects control characters in ssh options', () => {
    const { ssh, writes, errors } = build({ cipherSpec: 'aes;rm -rf /' });

    ssh._sshConnect();

    assert.equal(writes.length, 0);
    assert.ok(
      errors.some((args) =>
        String(args[0]).includes('Malicious characters detected in SSH cipherSpec')
      )
    );
  });

  it('rejects control characters in custom ssh options', () => {
    const { ssh, writes, errors } = build({
      options: { UserKnownHostsFile: '/tmp/x;touch /tmp/pwn' },
    });

    ssh._sshConnect();

    assert.equal(writes.length, 0);
    assert.ok(
      errors.some((args) =>
        String(args[0]).includes('Malicious characters detected in SSH options')
      )
    );
  });

  it('maps forceProtocolVersion to a valid ssh flag', () => {
    const boolean = build({ forceProtocolVersion: true });
    boolean.ssh._sshConnect();

    if (isBaseline()) {
      assert.ok(boolean.writes[0].startsWith('ssh -xtrue '));
    } else {
      assert.ok(boolean.writes[0].startsWith('ssh -x -2 '));
    }

    const explicit = build({ forceProtocolVersion: 1 });
    explicit.ssh._sshConnect();

    if (isBaseline()) {
      assert.ok(explicit.writes[0].startsWith('ssh -x1 '));
    } else {
      assert.ok(explicit.writes[0].startsWith('ssh -x -1 '));
    }
  });

  it('maps forceAddressType to a valid ssh flag', () => {
    const boolean = build({ forceAddressType: true });
    boolean.ssh._sshConnect();

    if (isBaseline()) {
      assert.ok(boolean.writes[0].startsWith('ssh -xtrue '));
    } else {
      assert.ok(boolean.writes[0].startsWith('ssh -x -4 '));
    }

    const explicit = build({ forceAddressType: 6 });
    explicit.ssh._sshConnect();

    if (isBaseline()) {
      assert.ok(explicit.writes[0].startsWith('ssh -x6 '));
    } else {
      assert.ok(explicit.writes[0].startsWith('ssh -x -6 '));
    }
  });

  it('rejects invalid force flag values on current', () => {
    const protocol = build({ forceProtocolVersion: 3 });
    protocol.ssh._sshConnect();

    const address = build({ forceAddressType: 5 });
    address.ssh._sshConnect();

    if (isBaseline()) {
      assert.ok(protocol.writes[0].startsWith('ssh -x3 '));
      assert.ok(address.writes[0].startsWith('ssh -x5 '));
    } else {
      assert.equal(protocol.writes.length, 0);
      assert.ok(
        protocol.errors.some((args) =>
          String(args[0]).includes('Invalid forceProtocolVersion: 3')
        )
      );
      assert.equal(protocol.ssh._stream.closed, true);

      assert.equal(address.writes.length, 0);
      assert.ok(
        address.errors.some((args) =>
          String(args[0]).includes('Invalid forceAddressType: 5')
        )
      );
      assert.equal(address.ssh._stream.closed, true);
    }
  });
});
