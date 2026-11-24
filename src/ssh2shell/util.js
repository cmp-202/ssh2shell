// @ts-check
'use strict';

/**
 * @typedef {import('../../index').HostConfig} HostConfig
 * @typedef {{ filter: RegExp, usedFallback: boolean }} CompiledFilter
 * @typedef {{ regex: RegExp | null, usedFallback: boolean }} CompiledPrompt
 */

const typeIsArray = Array.isArray;

function escapeRegex(str) {
  return String(str).replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
}

// Terminal escape sequences arrive as complete CSI or OSC strings. The ASCII
// filter only removes the ESC byte, which leaves the printable payload (for
// example `[?2004l` and `]3008;...`) in the response. Remove the whole
// sequence while ESC is still present. Covers CSI, OSC (BEL or ST terminated),
// and two-character escapes.
const terminalEscapePattern =
  /\x1b][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-_]/g;

function stripTerminalEscapes(value) {
  return String(value).replace(terminalEscapePattern, '');
}

/**
 * @param {string} configured Configured ASCII filter pattern.
 * @returns {CompiledFilter} Compiled filter and fallback flag.
 */
function compileAsciiFilter(configured) {
  if (configured === '[^\r\n\x20-\x7e]') {
    return { filter: /[^\t\r\n\x20-\x7e]/g, usedFallback: false };
  }

  // Only allow basic structural character classes/ranges; reject dangerous
  // loops (+, *, ?, nested groups).
  // Keep the 4.2.0 character set verbatim; the escapes are intentional.
  // noinspection RegExpDuplicateCharacterInClass,RegExpRedundantEscape
  const safeAsciiPattern = /^\[\^?[a-zA-Z0-9\s\\x00-\\x7f\-\[\]]+\]$/;
  if (safeAsciiPattern.test(configured)) {
    return { filter: new RegExp(configured, 'g'), usedFallback: false };
  }

  return { filter: /[^\t\r\n\x20-\x7e]/g, usedFallback: true };
}

/**
 * @param {string} configured Configured ANSI colour filter pattern.
 * @returns {CompiledFilter} Compiled filter and fallback flag.
 */
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
/**
 * @param {string | RegExp | null | undefined} configured Optional full prompt pattern.
 * @returns {CompiledPrompt} Compiled anchored regex or a fallback marker.
 */
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
    // The group is required when a configured prompt contains alternation.
    // noinspection RegExpUnnecessaryNonCapturingGroup
    return { regex: new RegExp(`(?:${source})$`, flags), usedFallback: false };
  } catch (error) {
    return { regex: null, usedFallback: true };
  }
}

/**
 * @param {HostConfig} sshObj Host config with prompt settings.
 * @returns {{ passwordPrompt: RegExp, standardPrompt: RegExp, standardPromptFallback: boolean }}
 */
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
    standardPrompt:
      custom.regex ||
      new RegExp(
        '[' + escapeRegex(sshObj.standardPrompt || '>$%#') + ']\\s?$'
      ),
    standardPromptFallback: custom.usedFallback,
  };
}

// Keys whose values are secret and must never appear in debug or verbose
// dumps. In 4.x `privateKey` holds key material, so it is redacted like a
// password or passphrase.
const CREDENTIAL_KEY = /^(password|passphrase|privateKey)$/i;

/**
 * @param {HostConfig | null | undefined} sshObj Active host config.
 * @returns {string[]} Credential values to redact from logs.
 */
function credentialSecrets(sshObj) {
  const server = (sshObj && sshObj.server) || {};

  return [
    server.password,
    server.passPhrase,
    server.passphrase,
    server.privateKey,
  ]
    .filter((secret) => secret != null && secret !== '')
    .map((secret) => String(secret));
}

/**
 * @param {unknown} value String to scrub.
 * @param {string[]} secrets Credential values to replace.
 * @returns {unknown} Scrubbed string, or the original non-string value.
 */
function redactString(value, secrets) {
  if (typeof value !== 'string' || secrets.length === 0) {
    return value;
  }

  return secrets.reduce(
    (text, secret) => text.split(secret).join('[REDACTED]'),
    value
  );
}

/**
 * @param {unknown} value Value to copy with credential keys redacted.
 * @param {WeakSet<object>} [seen] Cycle tracker for recursive calls.
 * @returns {unknown} Redacted copy, or the original primitive.
 */
function redactCredentials(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') {
    return value;
  }

  // Preserve functions, Buffers, streams, and other class instances by
  // identity. A class instance that carries credential-named properties is the
  // exception: systemMsg is public, so dumping it verbatim would leak secrets.
  // Its remaining values are redacted recursively, including nested configs.
  const prototype = Object.getPrototypeOf(value);
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  ) {
    const keys = Object.keys(value);
    if (!keys.some((key) => CREDENTIAL_KEY.test(key))) {
      return value;
    }

    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);
    const copy = {};
    for (const key of keys) {
      copy[key] =
        CREDENTIAL_KEY.test(key) && value[key]
          ? '[REDACTED]'
          : redactCredentials(value[key], seen);
    }
    seen.delete(value);
    return copy;
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
  // noinspection JSUnusedGlobalSymbols
  compilePromptRegex,
  compilePrompts,
  compileTextColorFilter,
  credentialSecrets,
  escapeRegex,
  redactCredentials,
  redactString,
  stripTerminalEscapes,
  typeIsArray,
};
