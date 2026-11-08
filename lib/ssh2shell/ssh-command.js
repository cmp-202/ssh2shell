'use strict';

const { shellControlChars, shellQuote } = require('./util');

// Builds the `ssh ...` command used to connect to a secondary/nested host.
// Returns `{ error }` for an injection guard, or `{ command }` on success.
function buildSshCommand(sshObj) {
  // Add ssh commandline options from host.server.ssh.
  let sshFlags = '-x';
  let sshOptions = '';

  if (sshObj.server.ssh) {
    // Safely handle protocol configurations.
    if (sshObj.server.ssh.forceProtocolVersion) {
      sshFlags += sshObj.server.ssh.forceProtocolVersion;
    }
    if (sshObj.server.ssh.forceAddressType) {
      sshFlags += sshObj.server.ssh.forceAddressType;
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

    // Intercept and safely escape single parameter properties.
    if (sshObj.server.ssh.cipherSpec) {
      if (shellControlChars.test(sshObj.server.ssh.cipherSpec)) {
        return { error: 'Malicious characters detected in SSH cipherSpec.' };
      }
      sshOptions += ' -c ' + shellQuote(sshObj.server.ssh.cipherSpec);
    }

    if (sshObj.server.ssh.escape) {
      if (shellControlChars.test(sshObj.server.ssh.escape)) {
        return { error: 'Malicious characters detected in SSH escape sequence.' };
      }
      sshOptions += ' -e ' + shellQuote(sshObj.server.ssh.escape);
    }

    if (sshObj.server.ssh.logFile) {
      if (shellControlChars.test(sshObj.server.ssh.logFile)) {
        return { error: 'Malicious characters detected in SSH logFile path.' };
      }
      sshOptions += ' -E ' + shellQuote(sshObj.server.ssh.logFile);
    }

    if (sshObj.server.ssh.configFile) {
      if (shellControlChars.test(sshObj.server.ssh.configFile)) {
        return { error: 'Malicious characters detected in SSH configFile path.' };
      }
      sshOptions += ' -F ' + shellQuote(sshObj.server.ssh.configFile);
    }

    if (sshObj.server.ssh.identityFile) {
      if (shellControlChars.test(sshObj.server.ssh.identityFile)) {
        return {
          error: 'Malicious characters detected in SSH identityFile path.',
        };
      }
      sshOptions += ' -i ' + shellQuote(sshObj.server.ssh.identityFile);
    }

    if (sshObj.server.ssh.loginName) {
      if (shellControlChars.test(sshObj.server.ssh.loginName)) {
        return { error: 'Malicious characters detected in SSH loginName.' };
      }
      sshOptions += ' -l ' + shellQuote(sshObj.server.ssh.loginName);
    }

    if (sshObj.server.ssh.macSpec) {
      if (shellControlChars.test(sshObj.server.ssh.macSpec)) {
        return { error: 'Malicious characters detected in SSH macSpec.' };
      }
      sshOptions += ' -m ' + shellQuote(sshObj.server.ssh.macSpec);
    }

    // Validate custom option blocks safely.
    const options = sshObj.server.ssh.options || {};
    for (const option in options) {
      const value = options[option];
      if (shellControlChars.test(option) || shellControlChars.test(value)) {
        return { error: 'Malicious characters detected in SSH options.' };
      }
      const safeOption = String(option).replace(/[^a-zA-Z0-9]/g, '');
      const safeValue = shellQuote(value);
      sshOptions += ` -o ${safeOption}=${safeValue}`;
    }
  }

  // Wrap target dynamic properties to ensure security boundaries hold up.
  sshOptions += ' -o "StrictHostKeyChecking=no"';

  // Sanitize user context fields going straight into the string command.
  const safePort = String(sshObj.server.port || 22).replace(/[^0-9]/g, '');
  sshOptions += ` -p ${safePort}`;

  const safeUser = shellQuote(sshObj.server.userName);
  const safeHost = shellQuote(sshObj.server.host);

  return { command: `ssh ${sshFlags} ${sshOptions} ${safeUser}@${safeHost}` };
}

module.exports = { buildSshCommand };
