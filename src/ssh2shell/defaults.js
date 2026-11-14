'use strict';

// Applies the baseline host defaults in place. This mutates only the host
// object; instance-level values (command, buffer, timers) stay in the class.
function applyHostDefaults(sshObj) {
  sshObj.sshToNextHost = false;
  if (!sshObj.connectedMessage) {
    sshObj.connectedMessage = 'Connected';
  }
  if (!sshObj.readyMessage) {
    sshObj.readyMessage = 'Ready';
  }
  if (!sshObj.closedMessage) {
    sshObj.closedMessage = 'Closed';
  }
  if (!sshObj.showBanner) {
    sshObj.showBanner = false;
  }
  if (!sshObj.verbose) {
    sshObj.verbose = false;
  }
  if (!sshObj.debug) {
    sshObj.debug = false;
  }
  // Progress is on by default. Only an explicit `false` opts out; the output
  // stays TTY-gated and is suppressed while debug or verbose is enabled.
  sshObj.progress = sshObj.progress !== false;
  if (sshObj.exposeCredentials !== true) {
    sshObj.exposeCredentials = false;
  }
  // The baseline payload is the raw buffer. `handled` is opt-in because it
  // changes the second `commandComplete` argument.
  sshObj.commandResponse =
    sshObj.commandResponse === 'handled' ? 'handled' : 'raw';
  // Opt-in: arm the command idle timer when the command is written. Without
  // this, a command that never produces any output never arms the timer.
  if (sshObj.commandStartTimeout !== true) {
    sshObj.commandStartTimeout = false;
  }
  // Opt-in: merge stderr into the command response and sessionText. The
  // `stderrData` event still fires either way.
  if (sshObj.captureStderr !== true) {
    sshObj.captureStderr = false;
  }
  if (!sshObj.hosts) {
    sshObj.hosts = [];
  }
  if (!sshObj.commands) {
    sshObj.commands = [];
  }
  if (!sshObj.standardPrompt) {
    sshObj.standardPrompt = '>$%#';
  }
  if (!sshObj.passwordPrompt) {
    sshObj.passwordPrompt = ':';
  }
  if (!sshObj.passphrasePrompt) {
    sshObj.passphrasePrompt = ':';
  }
  if (!sshObj.passPromptText) {
    sshObj.passPromptText = 'Password';
  }
  sshObj.enter = /^[\r\n]+$/.test(sshObj.enter || '') ? sshObj.enter : '\n';
  if (!sshObj.textColorFilter) {
    sshObj.textColorFilter = '\\x1b\\[[0-9;]*m';
  }
  if (sshObj.disableColorFilter !== true) {
    sshObj.disableColorFilter = false;
  }
  if (!sshObj.asciiFilter) {
    sshObj.asciiFilter = '[^\r\n\x20-\x7e]';
  }
  if (sshObj.disableASCIIFilter !== true) {
    sshObj.disableASCIIFilter = false;
  }
  if (!sshObj.exitCommands) {
    sshObj.exitCommands = [];
  }
  sshObj.pwSent = false;
  sshObj.sshAuth = false;
  // Retry budget for command idle timeouts. The library owns the attempt count;
  // a handler only reacts to the `details` argument.
  const retries = Number(sshObj.commandTimeoutRetries);
  sshObj.commandTimeoutRetries =
    Number.isInteger(retries) && retries > 0 ? retries : 0;
  sshObj.commandTimeoutAttempt = 0;
  // Sudo failures are visible notifications by default; a host can opt into
  // stopping the run with abortOnSudoFailure: true.
  if (sshObj.abortOnSudoFailure !== true) {
    sshObj.abortOnSudoFailure = false;
  }
  if (typeof sshObj.sudoFailed !== 'boolean') {
    sshObj.sudoFailed = false;
  }
  if (sshObj.server.hashKey == null) {
    sshObj.server.hashKey = '';
  }
  if (!sshObj.sessionText) {
    sshObj.sessionText = '';
  }
  if (sshObj.streamEncoding == null) {
    sshObj.streamEncoding = 'utf8';
  }
  // `window` and `pty` default to true, but an explicit `false` is meaningful
  // (no PTY / no window settings), so only replace null/undefined.
  if (sshObj.window == null) {
    sshObj.window = true;
  }
  if (sshObj.pty == null) {
    sshObj.pty = true;
  }
}

module.exports = { applyHostDefaults };
