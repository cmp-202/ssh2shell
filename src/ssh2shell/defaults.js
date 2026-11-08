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
    sshObj.passwordPrompt = sshObj.passwordPromt;
  }
  if (!sshObj.passphrasePrompt) {
    sshObj.passphrasePrompt = sshObj.passphrasePromt;
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
  if (sshObj.server.hashKey == null) {
    sshObj.server.hashKey = '';
  }
  if (!sshObj.sessionText) {
    sshObj.sessionText = '';
  }
  if (sshObj.streamEncoding == null) {
    sshObj.streamEncoding = 'utf8';
  }
  if (!sshObj.window) {
    sshObj.window = true;
  }
  if (!sshObj.pty) {
    sshObj.pty = true;
  }
}

module.exports = { applyHostDefaults };
