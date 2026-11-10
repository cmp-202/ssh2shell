'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  installFakeSsh2,
  isBaseline,
  loadSSH2Shell,
  createHost,
} = require('./helpers/harness');

installFakeSsh2();
const SSH2Shell = loadSSH2Shell();

function makeSSH(host, instance = {}) {
  const ssh = new SSH2Shell(host);
  ssh.sshObj = host;
  Object.assign(ssh, instance);
  ssh._loadDefaults();
  return ssh;
}

describe('instance timer values', () => {
  it('keeps an instance-level idleTime when the host has no timer config', () => {
    const host = createHost({ idleTimeOut: undefined, dataIdleTime: undefined });
    const ssh = makeSSH(host, { idleTime: 1500 });

    // Baseline always overwrites the instance value with the 5000 default.
    assert.equal(ssh.idleTime, isBaseline() ? 5000 : 1500);
  });

  it('lets a host idleTimeOut override the instance value', () => {
    const host = createHost({ idleTimeOut: 123 });
    const ssh = makeSSH(host, { idleTime: 1500 });

    assert.equal(ssh.idleTime, 123);
  });

  it('supports the legacy host idleTime alias', () => {
    const host = createHost({ idleTimeOut: undefined, idleTime: 222 });
    const ssh = makeSSH(host, { idleTime: 1500 });

    // Baseline only reads idleTimeOut.
    assert.equal(ssh.idleTime, isBaseline() ? 5000 : 222);
  });

  it('restores the instance idleTime after leaving a host', () => {
    const host = createHost({ idleTimeOut: 123 });
    const ssh = makeSSH(host, { idleTime: 1500 });

    assert.equal(ssh.idleTime, 123);
    ssh._removeListeners();

    // Baseline has no base value to restore.
    assert.equal(ssh.idleTime, isBaseline() ? 123 : 1500);
  });

  it('keeps an instance-level dataIdleTime when the host has no timer config', () => {
    const host = createHost({
      dataIdleTime: undefined,
      dataIdleTimeOut: undefined,
    });
    const ssh = makeSSH(host, { dataIdleTime: 750 });

    assert.equal(ssh.dataIdleTime, isBaseline() ? 500 : 750);
  });

  it('still prefers dataIdleTimeOut over the legacy dataIdleTime', () => {
    const host = createHost({ dataIdleTime: 45, dataIdleTimeOut: 999 });
    const ssh = makeSSH(host);

    assert.equal(ssh.dataIdleTime, isBaseline() ? 45 : 999);
  });

  it('does not carry a host override into the next host', () => {
    const first = createHost({ idleTimeOut: 123, dataIdleTime: 45 });
    const ssh = makeSSH(first, { idleTime: 1500, dataIdleTime: 750 });

    assert.equal(ssh.idleTime, 123);
    ssh._removeListeners();

    const second = createHost({
      idleTimeOut: undefined,
      dataIdleTime: undefined,
    });
    ssh.sshObj = second;
    ssh._loadDefaults();

    // Baseline reloads its hard-coded defaults for the second host.
    assert.equal(ssh.idleTime, isBaseline() ? 5000 : 1500);
    assert.equal(ssh.dataIdleTime, isBaseline() ? 500 : 750);
  });

  it('reapplies the previous host timer values after backing out', () => {
    const previous = createHost({ idleTimeOut: 250, dataIdleTime: 25 });
    const current = createHost({ idleTimeOut: 123, dataIdleTime: 45 });
    const ssh = makeSSH(current, { idleTime: 1500, dataIdleTime: 750 });

    ssh._connections = [previous];
    ssh._runExit = () => {};
    ssh._previousHost();

    // Baseline leaves the outgoing host's values in place.
    assert.equal(ssh.idleTime, isBaseline() ? 123 : 250);
    assert.equal(ssh.dataIdleTime, isBaseline() ? 45 : 25);
  });

  it('ignores non-positive host timer values', () => {
    const host = createHost({
      idleTimeOut: -5,
      idleTime: 0,
      dataIdleTimeOut: -1,
      dataIdleTime: 0,
    });
    const ssh = makeSSH(host, { idleTime: 1500, dataIdleTime: 750 });

    // Baseline keeps the literal configured values.
    assert.equal(ssh.idleTime, isBaseline() ? -5 : 1500);
    assert.equal(ssh.dataIdleTime, isBaseline() ? 0 : 750);
  });
});
