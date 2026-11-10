'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Stream = require('stream');

const {
  installFakeSsh2,
  isBaseline,
  loadSSH2Shell,
  createHost,
} = require('./helpers/harness');

installFakeSsh2();
const SSH2Shell = loadSSH2Shell();

function makeLoaded(overrides = {}) {
  const host = createHost(overrides);
  const ssh = new SSH2Shell(host);
  ssh.sshObj = host;
  ssh._loadDefaults();
  return { ssh, host };
}

describe('public API baseline', () => {
  it('exports a constructible class that extends Stream', () => {
    const ssh = new SSH2Shell(createHost());

    assert.equal(typeof SSH2Shell, 'function');
    assert.ok(ssh instanceof SSH2Shell);
    assert.ok(ssh instanceof Stream);
    assert.equal(typeof ssh.connect, 'function');
    assert.equal(typeof ssh.close, 'function');
    assert.equal(typeof ssh.on, 'function');
    assert.equal(typeof ssh.emit, 'function');
    assert.equal(typeof ssh.pipe, 'function');
    assert.equal(ssh.command, '');
    assert.ok(Array.isArray(ssh._hosts));
  });

  it('accepts a single host or an array of hosts', () => {
    const first = createHost({ server: { host: 'first.test' } });
    const second = createHost({ server: { host: 'second.test' } });

    assert.deepEqual(new SSH2Shell(first)._hosts, [first]);

    const multiple = new SSH2Shell([first, second]);
    assert.equal(multiple._hosts.length, 2);
    assert.equal(multiple._hosts[0], first);
    assert.equal(multiple._hosts[1], second);
  });

  it('characterizes the documented unpipe gap', () => {
    const ssh = new SSH2Shell(createHost());

    // README documents .unpipe(stream); the legacy Stream base class has no unpipe.
    assert.equal(ssh.unpipe, undefined);
  });

  it('keeps per-instance state independent before connect()', () => {
    const first = new SSH2Shell(createHost());
    const second = new SSH2Shell(createHost());

    if (isBaseline()) {
      // The baseline shares class-body objects through the prototype until
      // connect() assigns an own host.
      assert.equal(first.sshObj, second.sshObj);
      assert.equal(first._connections, second._connections);
    } else {
      // L5 assigns host state per instance in the constructor.
      assert.notEqual(first.sshObj, second.sshObj);
      assert.notEqual(first._connections, second._connections);
    }
  });
});

describe('_loadDefaults baseline', () => {
  it('applies the documented defaults', () => {
    const { ssh } = makeLoaded();
    const host = ssh.sshObj;

    assert.equal(host.connectedMessage, 'Connected');
    assert.equal(host.readyMessage, 'Ready');
    assert.equal(host.closedMessage, 'Closed');
    assert.equal(host.showBanner, false);
    assert.equal(host.verbose, false);
    assert.equal(host.debug, false);
    assert.deepEqual(host.hosts, []);
    assert.deepEqual(host.commands, ['echo one']);
    assert.equal(host.standardPrompt, '>$%#');
    assert.equal(host.passwordPrompt, ':');
    assert.equal(host.passphrasePrompt, ':');
    assert.equal(host.passPromptText, 'Password');
    assert.equal(host.enter, '\n');
    assert.equal(host.textColorFilter, '\\x1b\\[[0-9;]*m');
    assert.equal(host.disableColorFilter, false);
    assert.equal(host.asciiFilter, '[^\r\n\x20-\x7e]');
    assert.equal(host.disableASCIIFilter, false);
    assert.deepEqual(host.exitCommands, []);
    assert.equal(host.pwSent, false);
    assert.equal(host.sshAuth, false);
    assert.equal(host.server.hashKey, '');
    assert.equal(host.sessionText, '');
    assert.equal(host.streamEncoding, 'utf8');
    assert.equal(host.window, true);
    assert.equal(host.pty, true);
    assert.equal(ssh.idleTime, 50);
    assert.equal(ssh.dataIdleTime, 5);
    assert.equal(typeof host.onCommandProcessing, 'function');
    assert.equal(typeof host.onCommandComplete, 'function');
    assert.equal(typeof host.onCommandTimeout, 'function');
  });

  it('preserves explicit custom values', () => {
    const hosts = [{ server: { host: 'nested.test' } }];
    const commands = ['a', 'b'];
    const exitCommands = ['exit'];
    const { ssh } = makeLoaded({
      connectedMessage: 'C',
      readyMessage: 'R',
      closedMessage: 'X',
      showBanner: true,
      hosts,
      commands,
      standardPrompt: '>',
      passwordPrompt: 'pass:',
      passphrasePrompt: 'phrase:',
      passPromptText: 'Pass',
      enter: '\r\n',
      textColorFilter: '\\x1b\\[[0-9;]*m',
      asciiFilter: '[^\\x00-\\x1f]',
      disableColorFilter: true,
      disableASCIIFilter: true,
      exitCommands,
      sessionText: 'existing',
      streamEncoding: 'ascii',
      window: {},
      pty: false,
      idleTimeOut: 123,
      dataIdleTime: 45,
    });

    assert.equal(ssh.sshObj.connectedMessage, 'C');
    assert.equal(ssh.sshObj.readyMessage, 'R');
    assert.equal(ssh.sshObj.closedMessage, 'X');
    assert.equal(ssh.sshObj.showBanner, true);
    assert.equal(ssh.sshObj.hosts, hosts);
    assert.equal(ssh.sshObj.commands, commands);
    assert.equal(ssh.sshObj.standardPrompt, '>');
    assert.equal(ssh.sshObj.passwordPrompt, 'pass:');
    assert.equal(ssh.sshObj.passphrasePrompt, 'phrase:');
    assert.equal(ssh.sshObj.passPromptText, 'Pass');
    assert.equal(ssh.sshObj.enter, '\r\n');
    assert.equal(ssh.sshObj.exitCommands, exitCommands);
    assert.equal(ssh.sshObj.sessionText, 'existing');
    assert.equal(ssh.sshObj.streamEncoding, 'ascii');
    assert.deepEqual(ssh.sshObj.window, {});
    assert.equal(ssh.sshObj.disableColorFilter, true);
    assert.equal(ssh.sshObj.disableASCIIFilter, true);
    assert.equal(ssh.idleTime, 123);
    assert.equal(ssh.dataIdleTime, 45);
    assert.ok(ssh.asciiFilter instanceof RegExp);
    assert.ok(ssh.textColorFilter instanceof RegExp);
    assert.equal(ssh.standardPrompt.test('foo>'), true);
    assert.equal(ssh.standardPrompt.test('foo$'), false);
    assert.equal(ssh.passwordPrompt.test('Pass for x pass: '), true);
    assert.equal(ssh.passphrasePrompt.test('Pass phrase: '), true);

    // pty is forced to true on baseline; current keeps an explicit false.
    assert.equal(ssh.sshObj.pty, isBaseline() ? true : false);
  });

  it('honours the legacy passwordPromt/passphrasePromt aliases', () => {
    const { ssh } = makeLoaded({
      passwordPromt: 'legacy:',
      passphrasePromt: 'legacyphrase:',
    });

    assert.equal(ssh.sshObj.passwordPrompt, 'legacy:');
    assert.equal(ssh.sshObj.passphrasePrompt, 'legacyphrase:');
  });

  it('maps dataIdleTimeOut to the internal dataIdleTime timer', () => {
    const { ssh } = makeLoaded({ dataIdleTime: undefined, dataIdleTimeOut: 999 });

    // README documents dataIdleTimeOut; baseline reads only dataIdleTime.
    assert.equal(ssh.dataIdleTime, isBaseline() ? 500 : 999);
  });

  it('prefers dataIdleTimeOut over the legacy dataIdleTime fallback', () => {
    const { ssh } = makeLoaded({ dataIdleTime: 45, dataIdleTimeOut: 999 });

    assert.equal(ssh.dataIdleTime, isBaseline() ? 45 : 999);
  });

  it('keeps explicit window and pty false instead of forcing true', () => {
    const { ssh } = makeLoaded({ window: false, pty: false });

    assert.equal(ssh.sshObj.window, isBaseline() ? true : false);
    assert.equal(ssh.sshObj.pty, isBaseline() ? true : false);
  });

  it('compiles the default prompt regexes', () => {
    const { ssh } = makeLoaded();

    assert.ok(ssh.standardPrompt instanceof RegExp);
    assert.ok(ssh.passwordPrompt instanceof RegExp);
    assert.ok(ssh.passphrasePrompt instanceof RegExp);
    assert.equal(ssh.standardPrompt.test('$ '), true);
    assert.equal(ssh.standardPrompt.test('user@host:~$ '), true);
    assert.equal(ssh.standardPrompt.test('no prompt'), false);
    assert.equal(ssh.passwordPrompt.test('Password: '), true);
    assert.equal(ssh.passwordPrompt.test('Password for user: '), true);
    assert.equal(ssh.passwordPrompt.test('nope'), false);
    assert.equal(ssh.passphrasePrompt.test('Password: '), true);
  });

  it('compiles safe custom filters and falls back on unsafe ones', () => {
    const messages = [];
    const { ssh } = makeLoaded({
      debug: true,
      asciiFilter: '(a+)+',
      textColorFilter: '(.*)',
      msg: (message) => messages.push(String(message)),
    });

    assert.equal(ssh.asciiFilter.source, '[^\\t\\r\\n\\x20-\\x7e]');
    assert.equal(ssh.textColorFilter.source, '\\x1b\\[[0-9;]*m');
    assert.ok(messages.some((m) => m.includes('AsciiFilter: incorrect regular expression')));
    assert.ok(messages.some((m) => m.includes('TextColorFilter: incorrect regular expression')));
  });

  it('compiles safe custom filters', () => {
    const { ssh } = makeLoaded({
      asciiFilter: '[^\\x00-\\x1f]',
      textColorFilter: '\\x1b\\[[0-9;]*m',
    });

    assert.ok(ssh.asciiFilter instanceof RegExp);
    assert.equal(ssh.asciiFilter.source, '[^\\x00-\\x1f]');
    assert.ok(ssh.textColorFilter instanceof RegExp);
    assert.equal(ssh.textColorFilter.source, '\\x1b\\[[0-9;]*m');
  });

  it('does not recompile filters on a second _loadDefaults call', () => {
    const { ssh } = makeLoaded({ asciiFilter: '[^\\x00-\\x1f]' });
    const firstFilter = ssh.asciiFilter;

    ssh._loadDefaults();

    assert.equal(ssh.asciiFilter, firstFilter);
  });

  it('normalises enter and preserves CRLF', () => {
    assert.equal(makeLoaded({ enter: '\r\n' }).ssh.sshObj.enter, '\r\n');
    assert.equal(makeLoaded({ enter: 'x' }).ssh.sshObj.enter, '\n');
    assert.equal(makeLoaded({ enter: undefined }).ssh.sshObj.enter, '\n');
  });
});

describe('_sanitizeResponse baseline', () => {
  it('removes the leading command echo', () => {
    const { ssh } = makeLoaded();
    ssh.command = 'echo one';
    ssh._buffer = 'echo one\none\n$ ';

    assert.equal(ssh._sanitizeResponse(), '\none\n$ ');
  });
});
