'use strict';

const typeIsArray = Array.isArray;

function escapeRegex(str) {
  return String(str).replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
}

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

const shellControlChars = /[;&|`$\n\r]/;

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

function compilePrompts(sshObj) {
  // Prompts are fully sanitized at runtime via escapeRegex (they are cast as
  // pure literals, so no fallback is required).
  const cleanText = escapeRegex(sshObj.passPromptText || 'Password');

  return {
    passwordPrompt: new RegExp(
      `${cleanText}[^\\n]*${escapeRegex(sshObj.passwordPrompt || ':')}\\s?$`,
      'i'
    ),
    passphrasePrompt: new RegExp(
      `${cleanText}[^\\n]*${escapeRegex(sshObj.passphrasePrompt || ':')}\\s?$`,
      'i'
    ),
    standardPrompt: new RegExp(
      `[${escapeRegex(sshObj.standardPrompt || '>$%#')}]\\s?$`
    ),
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
  compilePrompts,
  compileTextColorFilter,
  credentialSecrets,
  escapeRegex,
  redactCredentials,
  redactString,
  shellControlChars,
  shellQuote,
  typeIsArray,
};
