'use strict';

const typeIsArray = Array.isArray;

function escapeRegex(str) {
  return String(str).replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
}

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

const shellControlChars = /[;&|`$\n\r]/;

// Terminal escape sequences arrive as complete CSI or OSC strings. The ASCII
// filter only removes the ESC byte, which leaves the printable payload (for
// example `[?2004l` and `]3008;...`) in the response. Remove the whole
// sequence while ESC is still present. Covers CSI, OSC (BEL or ST terminated),
// and two-character escapes.
const terminalEscapePattern =
  /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-_]/g;

function stripTerminalEscapes(value) {
  return String(value).replace(terminalEscapePattern, '');
}

function compileAsciiFilter(configured) {
  if (configured === '[^\r\n\x20-\x7e]') {
    return { filter: /[^\t\r\n\x20-\x7e]/g, usedFallback: false };
  }

  // Only allow basic structural character classes/ranges; reject dangerous
  // loops (+, *, ?, nested groups).
  const safeAsciiPattern = /^\[\^?[a-zA-Z0-9\s\\x00-\\x7f\-\[\]]+\]$/;
  if (safeAsciiPattern.test(configured)) {
    return { filter: new RegExp(configured, 'g'), usedFallback: false };
  }

  return { filter: /[^\t\r\n\x20-\x7e]/g, usedFallback: true };
}

function compileTextColorFilter(configured) {
  if (configured === '\\x1b\\[[0-9;]*m') {
    return { filter: /\x1b\[[0-9;]*m/g, usedFallback: false };
  }

  // Match standard ANSI styles safely, rejecting ReDoS structures.
  const safeColorPattern = /^(\\x1b|\\033)?\\?\[[0-9;]*\*?[a-zA-Z]$/;
  if (safeColorPattern.test(configured)) {
    return { filter: new RegExp(configured, 'g'), usedFallback: false };
  }

  return { filter: /\x1b\[[0-9;]*m/g, usedFallback: true };
}

// A caller-supplied standard prompt regex is trusted config. It is anchored to
// the end so it cannot match mid-output. The stateful `g`/`y` flags are
// stripped so repeated `.test()` calls stay stable, and `m` is stripped because
// it would let the end anchor match a line end before the final prompt.
function compilePromptRegex(configured) {
  if (configured == null || configured === '') {
    return { regex: null, usedFallback: false };
  }

  const isRegExp = configured instanceof RegExp;
  if (!isRegExp && typeof configured !== 'string') {
    return { regex: null, usedFallback: true };
  }

  const source = isRegExp ? configured.source : configured;
  const flags = isRegExp ? configured.flags.replace(/[gym]/g, '') : '';

  try {
    return { regex: new RegExp(`(?:${source})$`, flags), usedFallback: false };
  } catch (error) {
    return { regex: null, usedFallback: true };
  }
}

function compilePrompts(sshObj) {
  // Prompts are fully sanitized at runtime via escapeRegex (they are cast as
  // pure literals, so no fallback is required).
  const cleanText = escapeRegex(sshObj.passPromptText || 'Password');
  const custom = compilePromptRegex(sshObj.standardPromptRegex);

  return {
    passwordPrompt: new RegExp(
      `${cleanText}[^\\n]*${escapeRegex(sshObj.passwordPrompt || ':')}\\s?$`,
      'i'
    ),
    passphrasePrompt: new RegExp(
      `${cleanText}[^\\n]*${escapeRegex(sshObj.passphrasePrompt || ':')}\\s?$`,
      'i'
    ),
    standardPrompt:
      custom.regex ||
      new RegExp(`[${escapeRegex(sshObj.standardPrompt || '>$%#')}]\\s?$`),
    standardPromptFallback: custom.usedFallback,
  };
}

const CREDENTIAL_KEY = /^(password|passphrase)$/i;

function credentialSecrets(sshObj) {
  const server = (sshObj && sshObj.server) || {};

  return [server.password, server.passPhrase, server.passphrase]
    .filter((secret) => secret != null && secret !== '')
    .map((secret) => String(secret));
}

function redactString(value, secrets) {
  if (typeof value !== 'string' || secrets.length === 0) {
    return value;
  }

  return secrets.reduce(
    (text, secret) => text.split(secret).join('[REDACTED]'),
    value
  );
}

function redactCredentials(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') {
    return value;
  }

  // Preserve functions, Buffers, streams, and other class instances. Only
  // plain objects and arrays are copied so config dumps stay readable.
  const prototype = Object.getPrototypeOf(value);
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  ) {
    return value;
  }

  if (seen.has(value)) {
    return '[Circular]';
  }

  seen.add(value);

  if (Array.isArray(value)) {
    const copy = value.map((item) => redactCredentials(item, seen));
    seen.delete(value);
    return copy;
  }

  const copy = {};
  for (const [key, item] of Object.entries(value)) {
    copy[key] =
      CREDENTIAL_KEY.test(key) && item
        ? '[REDACTED]'
        : redactCredentials(item, seen);
  }

  seen.delete(value);
  return copy;
}

module.exports = {
  compileAsciiFilter,
  compilePromptRegex,
  compilePrompts,
  compileTextColorFilter,
  credentialSecrets,
  escapeRegex,
  redactCredentials,
  redactString,
  shellControlChars,
  shellQuote,
  stripTerminalEscapes,
  typeIsArray,
};
