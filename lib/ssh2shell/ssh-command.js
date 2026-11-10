'use strict';

const { shellControlChars, shellQuote } = require('./util');

// Maps a boolean-or-value SSH option to an allow-listed command-line flag.
// `true` selects the documented default; `false`/null/undefined disable it.
function mapSshFlag(value, allowed, defaultValue, name) {
  const selected = value === true ? defaultValue : String(value);
  if (!allowed.includes(selected)) {
    return { error: `Invalid ${name}: ${value}` };
  }
  return { flag: ` -${selected}` };
}

// Appends one `-<flag> <value>` option after checking for shell control
// characters. Returns an error object instead of throwing so the caller can
// emit a Security Alert without interrupting the connection flow.
function appendSshOption(parts, flag, value, label) {
  if (!value) {
    return null;
  }
  if (shellControlChars.test(value)) {
    return { error: `Malicious characters detected in SSH ${label}.` };
  }
  parts.push(` -${flag} ${shellQuote(value)}`);
  return null;
}

// Builds the `ssh ...` command used to connect to a secondary/nested host.
// Returns `{ error }` for an injection guard, or `{ command }` on success.
function buildSshCommand(sshObj) {
  // Add ssh commandline options from host.server.ssh.
  let sshFlags = '-x';
  const sshOptions = [];

  if (sshObj.server.ssh) {
    // Map protocol/address options to valid ssh flags. `true` keeps the old
    // boolean intent by selecting the modern default (IPv4 / protocol 2).
    if (sshObj.server.ssh.forceProtocolVersion) {
      const protocol = mapSshFlag(
        sshObj.server.ssh.forceProtocolVersion,
        ['1', '2'],
        '2',
        'forceProtocolVersion'
      );
      if (protocol.error) {
        return protocol;
      }
      sshFlags += protocol.flag;
    }
    if (sshObj.server.ssh.forceAddressType) {
      const address = mapSshFlag(
        sshObj.server.ssh.forceAddressType,
        ['4', '6'],
        '4',
        'forceAddressType'
      );
      if (address.error) {
        return address;
      }
      sshFlags += address.flag;
    }
    if (sshObj.server.ssh.disablePseudoTTY) {
      sshFlags += 'T';
    }
    if (sshObj.server.ssh.forcePseudoTTY) {
      sshFlags += 't';
    }
    if (sshObj.server.ssh.verbose) {
      sshFlags += 'v';
    }

    // Intercept and safely escape single-parameter properties. The label is
    // used verbatim in the Security Alert message.
    const optionSpecs = [
      ['c', 'cipherSpec', 'cipherSpec'],
      ['e', 'escape', 'escape sequence'],
      ['E', 'logFile', 'logFile path'],
      ['F', 'configFile', 'configFile path'],
      ['i', 'identityFile', 'identityFile path'],
      ['l', 'loginName', 'loginName'],
      ['m', 'macSpec', 'macSpec'],
    ];
    for (const [flag, key, label] of optionSpecs) {
      const failure = appendSshOption(
        sshOptions,
        flag,
        sshObj.server.ssh[key],
        label
      );
      if (failure) {
        return failure;
      }
    }

    // Validate custom option blocks safely. Only own enumerable properties are
    // included, so inherited values cannot leak into the command line.
    const options = sshObj.server.ssh.options || {};
    for (const [option, value] of Object.entries(options)) {
      if (shellControlChars.test(option) || shellControlChars.test(value)) {
        return { error: 'Malicious characters detected in SSH options.' };
      }
      const safeOption = String(option).replace(/[^a-zA-Z0-9]/g, '');
      const safeValue = shellQuote(value);
      sshOptions.push(` -o ${safeOption}=${safeValue}`);
    }
  }

  // Wrap target dynamic properties to ensure security boundaries hold up.
  sshOptions.push(' -o "StrictHostKeyChecking=no"');

  // Sanitize user context fields going straight into the string command.
  const safePort = String(sshObj.server.port || 22).replace(/[^0-9]/g, '');
  sshOptions.push(` -p ${safePort}`);

  const safeUser = shellQuote(sshObj.server.userName);
  const safeHost = shellQuote(sshObj.server.host);

  return {
    command: `ssh ${sshFlags} ${sshOptions.join('')} ${safeUser}@${safeHost}`,
  };
}

module.exports = { buildSshCommand };
