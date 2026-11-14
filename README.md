# ssh2shell

[![npm version](https://img.shields.io/npm/v/ssh2shell.svg)](https://www.npmjs.com/package/ssh2shell)
[![CI](https://github.com/cmp-202/ssh2shell/actions/workflows/ci.yml/badge.svg)](https://github.com/cmp-202/ssh2shell/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/ssh2shell.svg)](https://www.npmjs.com/package/ssh2shell)
[![license](https://img.shields.io/npm/l/ssh2shell.svg)](./LICENSE)

`ssh2shell` uses [ssh2](https://www.npmjs.com/package/ssh2) to open an SSH shell
session, run a list of commands in order, and process the responses.

It is built for scripted, non-interactive work: deployments, audits, data
collection, and chained or tunnelled connections where you need the output of
one command to decide what to do next.

- Runs commands sequentially in a single shell session.
- Detects the command prompt to know when a command has finished.
- Handles `sudo`, `su`, `keyboard-interactive`, and private-key passphrases.
- Connects to multiple primary hosts or tunnels through intermediate hosts.
- Emits events so you can react to output as it arrives.

## Contents

- [Why ssh2shell](#why-ssh2shell)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Core concepts](#core-concepts)
- [Configuration reference](#configuration-reference)
  - [`server`](#server)
  - [Commands and notifications](#commands-and-notifications)
  - [Prompts and response filters](#prompts-and-response-filters)
  - [Timeouts](#timeouts)
  - [Messages and debug output](#messages-and-debug-output)
  - [Host event handlers](#host-event-handlers)
- [Recipes](#recipes)
  - [Run commands on a host](#run-commands-on-a-host)
  - [React to a command result](#react-to-a-command-result)
  - [Authenticate with a private key](#authenticate-with-a-private-key)
  - [Keyboard-interactive authentication](#keyboard-interactive-authentication)
  - [Verify a host fingerprint](#verify-a-host-fingerprint)
  - [Run sudo and su commands](#run-sudo-and-su-commands)
  - [Respond to a prompt mid-command](#respond-to-a-prompt-mid-command)
  - [Handle a command timeout](#handle-a-command-timeout)
- [Multiple hosts](#multiple-hosts)
  - [Multiple primary hosts](#multiple-primary-hosts)
  - [Tunnelling through a jump host](#tunnelling-through-a-jump-host)
- [Events and the API](#events-and-the-api)
  - [Instance events](#instance-events)
  - [Methods and properties](#methods-and-properties)
  - [Stopping and closing](#stopping-and-closing)
- [Advanced usage](#advanced-usage)
  - [Log to a file](#log-to-a-file)
  - [Run a generated bash script](#run-a-generated-bash-script)
  - [Verbose and debug output](#verbose-and-debug-output)
  - [Progress indicator](#progress-indicator)
  - [Credential handling](#credential-handling)
- [Troubleshooting](#troubleshooting)
- [Security](#security)
- [Development](#development)
- [License](#license)

## Why ssh2shell

`ssh2` gives you a connection and a stream. `ssh2shell` adds the part most
scripts need: a state machine that writes one command at a time, waits for the
prompt, captures the response, and moves on. That makes it a good fit when:

- You have a fixed list of commands to run on one or more hosts.
- You need the full transcript as a string (`sessionText`).
- You need to answer a prompt (`sudo`, `su`, `[y/N]?`) without a human.
- You need to reach a host through a jump host.

It is **not** an interactive terminal library. There is no terminal UI, and
commands are matched by prompt patterns rather than by a full PTY emulator.

## Installation

```bash
npm install ssh2shell
```

Requires Node.js 18 or newer.

## Quick start

```javascript
const fs = require('fs');
const SSH2Shell = require('ssh2shell');

const host = {
  server: {
    host: '192.168.0.10',
    userName: 'deploy',
    privateKey: fs.readFileSync(process.env.PRIVATE_KEY_PATH),
  },
  commands: ['echo $(pwd)', 'ls -l'],
};

const SSH = new SSH2Shell(host);

SSH.connect((sessionText) => {
  console.log(sessionText);
});
```

The function passed to `SSH.connect()` is called when the session finishes. It
receives the complete session text, including the output of every command. To
write that text to a file instead of the console:

```javascript
SSH.connect((sessionText) => {
  fs.writeFileSync('session.log', sessionText);
});
```

See [`test/live/simple.js`](./test/live/simple.js) for a runnable version that
appends messages and session text to a log file.

## Core concepts

**The host object.** A host object has two required parts: `server` (how to
connect) and `commands` (what to run). Everything else is optional.

```javascript
const host = {
  server: { /* connection settings */ },
  commands: ['pwd', 'ls -l'],
};
```

**One shell, many commands.** Commands are written to a single shell session in
order. After each write, `ssh2shell` waits until the output matches
`standardPrompt` (by default a line ending in `>`, `$`, `%`, or `#`) before it
sends the next command.

**`sessionText`.** Each host accumulates its own output in `sshObj.sessionText`.
When all hosts finish, `connect(callback)` passes the combined text.

**Connection modes.** There are three ways to connect:

| Mode | Config | How it connects | Use it when |
| --- | --- | --- | --- |
| Single host | `new SSH2Shell(host)` | One `ssh2` connection | You have one server |
| Multiple primary hosts | `new SSH2Shell([host1, host2])` | A new `ssh2` connection per host, one after another | You have several independent servers |
| Tunnelling | `host1.hosts = [host2]` | An `ssh` command run inside the current session | You must reach a host through a jump host |

**Notifications.** `commands` entries can emit a `msg` or add text to
`sessionText` without sending anything to the host. See
[Commands and notifications](#commands-and-notifications).

## Configuration reference

The defaults below are the values used when a property is omitted. Optional
properties never need to be included just to keep a default.

### `server`

`server` is passed to `ssh2.Client.connect()`, so any option that ssh2 accepts
can be used. The properties below are the ones `ssh2shell` documents or reads
directly.

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `host` | string | — | **Required.** Host name or IP address. |
| `port` | number \| string | `22` | SSH port. |
| `userName` | string | — | **Required.** Login name. `username` is accepted as an alias. |
| `password` | string | — | Password authentication. |
| `privateKey` | Buffer \| string | — | Private key contents, usually from `fs.readFileSync()`. |
| `passPhrase` | string | — | Private-key passphrase. `passphrase` is accepted as an alias. |
| `tryKeyboard` | boolean | `false` | Enable keyboard-interactive authentication. |
| `hostHash` | string | — | Hash algorithm used to verify the server key. Any algorithm from `crypto.getHashes()` works. `sha256` is a good choice. |
| `hostVerifier` | function | — | `(hashedKey, verify) => boolean`. Called with the hashed key when `hostHash` is set. |
| `algorithms` | object | — | ssh2 cipher, compression, hmac, kex, and server host key settings. |

`hashMethod` is accepted as a legacy alias for `hostHash`. It is copied to
`hostHash` before the connection is opened.

`hashKey` is **not** used by `ssh2shell` or `ssh2`. Do not set it.

### Commands and notifications

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `commands` | string[] | `[]` | **Required.** Commands to run, in order. |

Command entries can be regular shell commands or notifications:

```javascript
const host = {
  server: { /* ... */ },
  commands: [
    'msg:Starting deployment',
    '`This line is added to sessionText only`',
    'cd /srv/app',
    './deploy.sh',
  ],
};
```

- `msg:` emits a `msg` event with `${host}: Note: ${text}`. The host prefix is
  omitted for a single-host session. The default `msg` handler writes it to the
  console.
- A backtick-wrapped entry is appended to `sessionText` without being run. This
  avoids the command echo you would get from `echo`.

See [`test/live/notifications.js`](./test/live/notifications.js) for a runnable
example.

### Prompts and response filters

Prompt detection decides when a command is finished. Filters clean the output
before it is matched and stored.

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `standardPrompt` | string | `">$%#"` | Characters that identify a command prompt. Compiled to a regex matching one of these at the end of a line. |
| `standardPromptRegex` | string \| RegExp | — | Opt-in full prompt regex. Replaces `standardPrompt` for prompt detection. Anchored to the end; `g`, `y`, and `m` flags are ignored. |
| `passwordPrompt` | string | `":"` | Text that identifies a password prompt. |
| `passphrasePrompt` | string | `":"` | Text that identifies a passphrase prompt. |
| `passPromptText` | string | `"Password"` | Text that must appear before the password/passphrase prompt. Shared by both prompt types. |
| `commandResponse` | `"raw"` \| `"handled"` | `"raw"` | Shape of the `commandComplete` response. `handled` removes the echoed command and trailing prompt and trims; `details.rawResponse` keeps the raw buffer. `sessionText` stays raw. |
| `asciiFilter` | string | `"[^\r\n\x20-\x7e]"` | Regex that removes non-standard ASCII. Complete terminal escape sequences are removed first. Tabs are preserved by the compiled default. |
| `disableASCIIFilter` | boolean | `false` | Set to `true` to keep non-standard ASCII. |
| `textColorFilter` | string | `"\\x1b\\[[0-9;]*m"` | Regex that removes ANSI colour codes. |
| `disableColorFilter` | boolean | `false` | Set to `true` to keep ANSI colour codes. |

If your host uses a prompt that does not end in `>$%#`, set `standardPrompt` to
the characters it does use. For example, a prompt ending in `>` and a space
still works, but a prompt ending in `:` will not.

If the trailing-character match is too loose, set `standardPromptRegex` to the
full prompt, for example `'tester@host:~\\$\\s?$'`. It is anchored to the end
automatically and used everywhere `standardPrompt` is: normal command
completion, `sudo`, and nested `ssh` prompts. An invalid pattern falls back to
`standardPrompt` and logs a debug message. Treat it as trusted configuration; a
pathological pattern can be expensive to evaluate.

`commandResponse: 'handled'` changes only the second `commandComplete`
argument. Without `standardPromptRegex`, only the final prompt character (plus
optional whitespace) is removed. Set the full prompt regex to remove the whole
prompt.

`passPromptText` is shared by password and passphrase detection. If your host
uses different wording, set it to text common to both prompts.

Filters only affect the text that `ssh2shell` matches and adds to
`sshObj.sessionText`. They do not change the raw output from an `on('data')`
event.

When ASCII filtering is enabled, complete terminal escape sequences (CSI and
OSC, such as bracketed paste and shell-integration markers) are removed before
`asciiFilter` runs. Otherwise the ESC byte would be dropped but its printable
payload would remain in the response. Set `disableASCIIFilter` to keep them.

### Timeouts

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `idleTimeOut` | number | `5000` | Milliseconds of silence before the command is treated as timed out. Every `onData` event resets the timer. |
| `dataIdleTimeOut` | number | `500` | Milliseconds of silence used to decide that a response burst has ended. |
| `commandTimeoutRetries` | number | `0` | Number of times to re-arm `commandTimeout` after a non-final attempt. `0` preserves the single-timeout behavior. |

`idleTimeOut` is an inactivity timeout, not a limit on how long a command may
run. Every `onData` event resets the timer, so a command that keeps producing
output stays alive. When no data has arrived for `idleTimeOut` milliseconds, the
`commandTimeout` event fires with a fifth `details` argument:
`{ attempt, maxRetries, final }`.

The library owns the attempt count. With `commandTimeoutRetries` set, it
re-arms the timer after each non-final attempt; the handler only reacts. The
default handler emits an `error` of type `Command Timeout` and closes the
connection on the final attempt. With the default `0`, the first timeout is
final and behavior is unchanged.

```javascript
onCommandTimeout(command, response, stream, connection, details) {
  if (details.final) {
    this.stop('command-timeout');
    return;
  }
  // Answer the prompt; the library re-arms the timer for the next attempt.
  if (response.includes('(Y,n)')) stream.write('y\n');
}
```

The idle timer is armed by incoming data. A command that produces no output at
all is not covered by `commandTimeout`; use a server keepalive or an external
timeout for that case.

`dataIdleTimeOut` is the response-settling delay. It groups stream chunks into
one response before prompt matching. It is not the command timeout.

`idleTime` is accepted as a legacy alias for `idleTimeOut`. You can also set
`SSH.idleTime` or `SSH.dataIdleTime` on the instance before `connect()`; a host
value overrides the instance value for that host.

### Messages and debug output

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `connectedMessage` | string | `"Connected"` | Emitted as a `msg` when the connection opens. |
| `readyMessage` | string | `"Ready"` | Emitted as a `msg` when the shell is ready. |
| `closedMessage` | string | `"Closed"` | Emitted as a `msg` when the connection closes. |
| `msg` | function \| `{ send }` | `console.log` | Receives every `msg` event. The legacy `{ send: fn }` shape is accepted. |
| `verbose` | boolean | `false` | Emit process details, including the loaded host config and intermediate values useful for troubleshooting. |
| `debug` | boolean | `false` | Emit internal process steps. |
| `progress` | boolean | `true` | Write a stderr liveness indicator while a command is in flight. Set to `false` to disable. TTY-only; never affects `sessionText`. |
| `exposeCredentials` | boolean | `false` | Redact passwords and passphrases in debug and verbose output. Set to `true` to show them. |
| `showBanner` | boolean | `false` | Include the host banner in `sessionText`. |
| `enter` | string | `"\n"` | End-of-line sequence written after each command. |
| `streamEncoding` | string | `"utf8"` | Encoding applied to the shell stream. |
| `window` | boolean | `true` | First argument to `connection.shell()`. An explicit `false` is preserved. |
| `pty` | boolean | `true` | Pseudo-terminal option passed to `connection.shell()`. An explicit `false` is preserved. |

### Host event handlers

Handlers defined on the host object run only for that host. For most events
they replace the class default. `onData` runs in addition to the internal
stream handler, and `onError` runs before the default error handler so it can
observe the error before the connection closes. Handlers added to the instance
with `SSH.on(...)` run for every host, in parallel with any host handler.

| Handler | Arguments | Runs when |
| --- | --- | --- |
| `msg` | `message` | A message is emitted. |
| `onData` | `data` | Raw data arrives from the stream. |
| `onStderrData` | `data` | Data arrives on stderr. |
| `onCommandProcessing` | `command, response, sshObj, stream` | Output arrives before the prompt is detected. |
| `onCommandComplete` | `command, response, sshObj, details` | A command returns to the prompt. Use it to inspect the response, queue follow-up commands, or stop the current host. |
| `onCommandTimeout` | `command, response, stream, connection, details` | No data arrives for `idleTimeOut` milliseconds. |
| `onEnd` | `sessionText, sshObj` | The host session finishes. |
| `onError` | `err, type, close, callback` | An error is raised. |
| `onKeyboardInteractive` | `name, instructions, instructionsLang, prompts, finish` | Keyboard-interactive authentication is requested. |

Inside every handler, `this` is the `SSH2Shell` instance. Use `this.sshObj` to
read the current host configuration and `this.emit('msg', text)` to report
progress.

`onCommandProcessing` and `onCommandTimeout` receive the live `stream`, so you
can answer a prompt with `stream.write('y\n')`. See
[Respond to a prompt mid-command](#respond-to-a-prompt-mid-command).

`onCommandTimeout` receives `details` as `{ attempt, maxRetries, final }`. With
`commandTimeoutRetries` set, the library re-arms the timer for non-final
attempts; the handler does not need to count. Set
`this.sshObj.retryCommandTimeout = false` to stop retrying for the current
command.

To stop a host early, answer a prompt, or close a session from a handler, see
[Stopping and closing](#stopping-and-closing).

## Recipes

### Run commands on a host

```javascript
const fs = require('fs');
const SSH2Shell = require('ssh2shell');

const host = {
  server: {
    host: '192.168.0.10',
    port: 22,
    userName: 'deploy',
    privateKey: fs.readFileSync(process.env.PRIVATE_KEY_PATH),
  },
  commands: [
    'msg:Checking disk usage',
    'df -h',
    'msg:Checking memory',
    'free -m',
  ],
};

const SSH = new SSH2Shell(host);

SSH.on('msg', (message) => console.log(message));

SSH.connect((sessionText) => {
  console.log('--- session ---');
  console.log(sessionText);
});
```

### React to a command result

`onCommandComplete` runs after each command with the raw response, so it can
decide what to run next. The completed command has already been removed from
`sshObj.commands`; `unshift` adds work to the front of the queue.

For example, install a missing package and then retry the check. `2>&1` sends
the error message to stdout so it appears in `response`; stderr is reported
separately and is not part of the command buffer.

```javascript
const checkNano = 'dpkg -s nano 2>&1';

const host = {
  // ...
  commands: [checkNano],
  onCommandComplete: function (command, response, sshObj) {
    if (command === checkNano && response.includes('not installed')) {
      sshObj.commands.unshift(
        'sudo apt-get install -y nano',
        checkNano
      );
    }
  },
};
```

Most interactive handling belongs in `onCommandProcessing` or
`onCommandTimeout`, which run while the command is still in flight and receive
the live stream.

### Authenticate with a private key

```javascript
const fs = require('fs');
const os = require('os');
const path = require('path');

// Resolve PRIVATE_KEY_PATH (or ~/.ssh/id_rsa) against the home directory.
const keyPath = path.resolve(
  (process.env.PRIVATE_KEY_PATH || '~/.ssh/id_rsa')
    .replace(/^~(?=$|[\\/])/, os.homedir())
);

const host = {
  server: {
    host: '192.168.0.10',
    userName: 'deploy',
    privateKey: fs.readFileSync(keyPath),
    passPhrase: process.env.KEY_PASSPHRASE, // omit if the key has no passphrase
  },
  commands: ['whoami'],
};
```

`~` is not expanded by `fs.readFileSync()`. Build the path with `os.homedir()` or
use an absolute path.

If the key has a passphrase and it is wrong, ssh2 reports
`Unable to parse private key while generating public key (expected sequence)`.
Check for typos and for a trailing newline if the value came from a file. Call
`.trim()` on values read from disk.

See [`test/live/private_key.js`](./test/live/private_key.js) for a runnable
example.

### Keyboard-interactive authentication

Set `tryKeyboard` and provide a handler. The handler must call `finish()` with
answers in the same order as `prompts`.

```javascript
const kbdUser = process.env.KBD_USER || 'kbduser';
const kbdPassword = process.env.KBD_PASSWORD;

const host = {
  server: {
    host: process.env.KBD_HOST || process.env.HOST,
    port: process.env.KBD_PORT || process.env.PORT,
    userName: kbdUser,
    password: kbdPassword,
    tryKeyboard: true,
  },
  commands: ['whoami'],
};

const SSH = new SSH2Shell(host);

SSH.on('keyboard-interactive', function (name, instructions, instructionsLang, prompts, finish) {
  // This example assumes only the password is requested.
  finish([this.sshObj.server.password]);
});

SSH.connect();
```

The live test uses `KBD_USER` / `KBD_PASSWORD` because the `kbduser`
account has password authentication disabled and accepts only the
keyboard-interactive challenge.

Or define `onKeyboardInteractive` on the host object:

```javascript
const host = {
  server: { /* ... */ tryKeyboard: true },
  commands: ['whoami'],
  onKeyboardInteractive: function (name, instructions, instructionsLang, prompts, finish) {
    finish([this.sshObj.server.password]);
  },
};
```

Keyboard-interactive is only available on the first (primary) connection. A
nested connection made with the `ssh` command handles authentication through
the shell prompt instead.

See [`test/live/keyboard-interactive.js`](./test/live/keyboard-interactive.js)
for a complete example.

### Verify a host fingerprint

At connection time, ssh2 can hash the server's public key and pass it to
`hostVerifier`. Compare it with a value you recorded earlier to detect a
different server or a man-in-the-middle.

The verifier receives a **hex digest without colons** when `hostHash` is set.
Record the value on the first connection, then pin it:

```javascript
const fs = require('fs');

const host = {
  server: {
    host: '192.168.0.10',
    userName: 'deploy',
    privateKey: fs.readFileSync(process.env.PRIVATE_KEY_PATH),
    hostHash: 'sha256', // any crypto.getHashes() algorithm
    hostVerifier: function (hashedKey) {
      const expectedHash = process.env.EXPECTED_HOST_HASH;

      // With no pin recorded, print the hash and accept the first connection.
      if (!expectedHash) {
        console.log('Server hash:', hashedKey);
        return true;
      }

      return hashedKey.toLowerCase() === expectedHash.toLowerCase();
    },
  },
  commands: ['whoami'],
};
```

To discover the hash, log `hashedKey` and accept the first connection:

```javascript
const host = {
  server: {
    // ...other settings
    hostHash: 'sha256',
    hostVerifier: function (hashedKey) {
      console.log('Server hash:', hashedKey);
      return true;
    },
  },
  commands: ['whoami'],
};
```

Fingerprint validation applies to the **primary** connection only. Nested
connections are made by running `ssh` on the primary host, so their host-key
handling belongs to that host's `known_hosts` configuration and to the
`server.ssh` options. See [Security](#security).

See [`test/live/fingerprint.js`](./test/live/fingerprint.js) for a runnable
example.

### Run sudo and su commands

`sudo` is handled automatically. When output matches `passwordPrompt`,
`ssh2shell` sends `server.password` once and continues. A rejected password
cancels the current command and the session continues. The rejection is emitted
as a normal `msg` and sets `sshObj.sudoFailed = true`. The same password is
reused, so later `sudo` commands will fail too. If that matters, check
`sshObj.sudoFailed` or the response text in `onCommandComplete` and clear
`sshObj.commands` to stop the current host.

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `abortOnSudoFailure` | boolean | `false` | Call `stop('sudo-failed')` when the sudo password is rejected or no password is configured. |
| `sudoFailed` | boolean | `false` | Set by `ssh2shell` when a sudo password is rejected. Starts `false` for each host. |

If the account has a `NOPASSWD` sudoers rule, no password is sent. Use `sudo -n`
to prove that: it fails instead of prompting when a password would be required.
See [`test/live/sudo_no_pass.js`](./test/live/sudo_no_pass.js).

```javascript
const host = {
  server: { /* ... */ },
  commands: [
    'sudo -i',
    'cd /root',
    'ls -la',
    'exit',
  ],
};
```

`su` uses the password of the target user, not the login password, so it is not
automatic. Detect the prompt in `onCommandProcessing` and answer it with the
stream:

```javascript
const secondUser = process.env.SECOND_USER || 'suuser';

const host = {
  server: {
    // ...connection settings
    secondUserPassword: process.env.SECOND_USER_PASSWORD, // your own field
  },
  commands: [
    'sudo -i',
    'cd /root',
    'ls -la',
    'exit',
    `su ${secondUser}`,
    'whoami',
    'exit',
  ],
  onCommandProcessing: function (command, response, sshObj, stream) {
    if (command === `su ${secondUser}`
        && response.includes('Password:')
        && sshObj.suPasswordSent !== true) {
      sshObj.suPasswordSent = true;
      stream.write(`${sshObj.server.secondUserPassword}\n`);
    }
  },
};
```

The difference between `su`, `sudo su`, and `sudo -u user -i` is explained in
[this article](http://johnkpaul.tumblr.com/post/19841381351/su-vs-sudo-su-vs-sudo-u-i).
See [`test/live/sudo_su.js`](./test/live/sudo_su.js) for a working example.

### Respond to a prompt mid-command

Some commands ask a question that is neither a login prompt nor a standard
prompt, such as an installer asking `[Y/n]?`. Use `onCommandProcessing` and
write the answer to the stream. Guard it with a flag so it only answers once.

```javascript
// A local command that prompts, so the example does not need network access.
const promptCommand =
  'printf "Install nano [Y/n]? "; read answer; echo "answer=$answer"';

const host = {
  server: { /* ... */ },
  commands: [promptCommand],
  onCommandProcessing: function (command, response, sshObj, stream) {
    if (command === promptCommand
        && response.includes('[Y/n]?')
        && sshObj.answeredNano !== true) {
      sshObj.answeredNano = true;
      stream.write('y\n');
    }
  },
};
```

A host handler replaces the default handler for that host. To apply the same
logic to every host, attach it to the instance instead:

```javascript
SSH.on('commandProcessing', function (command, response, sshObj, stream) {
  if (command === promptCommand
      && response.includes('[Y/n]?')
      && sshObj.answeredNano !== true) {
    sshObj.answeredNano = true;
    stream.write('y\n');
  }
});
```

Do not define the same handler in both places. It will run twice.

If no prompt is detected and no answer is sent, `commandTimeout` fires after
`idleTimeOut` milliseconds with no data.

See [`test/live/prompt_response.js`](./test/live/prompt_response.js) for a
runnable example.

### Handle a command timeout

The default timeout handler adds the last response to `sessionText` and closes
the shell stream, which ends the connection. Override `onCommandTimeout` if you
want to answer the prompt or keep the session open.

```javascript
// idleTimeOut defaults to 5000 ms. This command is local so the example does
// not need network access.
const promptCommand =
  'printf "Install nodejs [Y/n]? "; read answer; echo "answer=$answer"';

const host = {
  server: { /* ... */ },
  commands: [promptCommand],
  onCommandTimeout: function (command, response, stream, connection) {
    if (command === promptCommand
        && response.includes('[Y/n]?')
        && this.sshObj.answeredNode !== true) {
      this.sshObj.answeredNode = true;
      stream.write('y\n');
      return;
    }

    // Fall back to the default behaviour: record the response and close.
    this.emit(
      'error',
      `${this.sshObj.server.host}: Command timed out after ${this.idleTime / 1000} seconds`,
      'Command Timeout',
      true,
      () => {
        this.sshObj.sessionText += response;
      }
    );
  },
};
```

If you see garbled text before the real response, save the partial response and
clear the buffer before writing:

```javascript
this.sshObj.sessionText += response;
this._buffer = '';
```

To change timeout handling for every host, leave `onCommandTimeout` out of the
host object and listen on the instance:

```javascript
SSH.on('commandTimeout', function (command, response, stream, connection) {
  // ...
});
```

See [`test/live/command_timeout.js`](./test/live/command_timeout.js) for a
runnable example.

## Multiple hosts

### Multiple primary hosts

Pass an array of host objects to the constructor. Each host gets its own ssh2
connection, runs its own commands, and is closed before the next host starts.
The final callback receives the combined session text.

```javascript
const fs = require('fs');

// See "Authenticate with a private key" for resolving a ~ path.
const privateKey = fs.readFileSync(process.env.PRIVATE_KEY_PATH);

const host1 = {
  server: { host: '10.0.0.11', userName: 'deploy', privateKey },
  commands: ['hostname', 'uptime'],
};

const host2 = {
  server: { host: '10.0.0.12', userName: 'deploy', privateKey },
  commands: ['hostname', 'uptime'],
};

const SSH = new SSH2Shell([host1, host2]);

SSH.connect((allSessionText) => {
  console.log(allSessionText);
});
```

Each host is independent. Shared functions can be assigned to multiple host
objects, and shared handlers can be added to the instance instead.

See
[`test/live/multiple_primary_hosts.js`](./test/live/multiple_primary_hosts.js).

### Tunnelling through a jump host

Set `hosts` on a host object to connect to further hosts **through** it. Each
nested connection is an `ssh` command run inside the current session, so it uses
the shell of the host you are already on.

```javascript
const fs = require('fs');

const jump = {
  server: {
    host: '10.0.0.10',
    userName: 'deploy',
    privateKey: fs.readFileSync(process.env.PRIVATE_KEY_PATH),
  },
  commands: ['hostname'],
};

const target = {
  server: {
    host: '192.168.1.20',
    userName: 'deploy',
    ssh: {
      // Key as it exists on the jump host, used by the nested `ssh -i`.
      identityFile: process.env.HOP_KEY_PATH || '/home/deploy/.ssh/id_ed25519',
    },
  },
  commands: ['hostname', 'uptime'],
};

jump.hosts = [target];

const SSH = new SSH2Shell(jump);
SSH.connect((sessionText) => console.log(sessionText));
```

`identityFile` must be an absolute path on the jump host; the value is
single-quoted, so `~` is not expanded. For multi-hop chains, use
`HOP_KEY_PATH` for the first hop and `HOP2_KEY_PATH` for the second (see
[`test/live/chaining.js`](./test/live/chaining.js)).

Nested hosts can be chained to any depth:

```javascript
jump.hosts = [bastion];
bastion.hosts = [target];
target.hosts = [];
```

The process is:

1. Connect to the primary host and run its commands.
2. For each entry in its `hosts` array, save the current host and load the
   nested host.
3. Run `ssh` on the current host to reach the nested host.
4. Run the nested host's commands, then process its own `hosts` array.
5. Restore the previous host and continue with its remaining `hosts` entries.
6. Close all sessions and pass the combined text to the callback.

A nested host object must be defined before it is added to another `hosts`
array.

**`server.ssh` options.** These options apply only to nested `ssh` connections.
The primary connection uses ssh2 directly.

```javascript
const host = {
  server: {
    // ...connection settings
    ssh: {
      forceProtocolVersion: 2,   // 1 or 2; true selects 2
      forceAddressType: 4,       // 4 or 6; true selects 4
      disablePseudoTTY: false,   // true adds -T
      forcePseudoTTY: false,     // true adds -t
      verbose: false,            // true adds -v
      cipherSpec: '',            // -c
      escape: '',                // -e
      logFile: '',               // -E
      configFile: '',            // -F
      identityFile: '',          // -i
      loginName: '',             // -l
      macSpec: '',               // -m
      options: {},               // -o key=value for each entry
    },
  },
  commands: ['hostname'],
};
```

| Property | Maps to | Notes |
| --- | --- | --- |
| `forceProtocolVersion` | `-1` / `-2` | `1`, `2`, or `true` (selects `-2`). Any other value raises a Security Alert error. |
| `forceAddressType` | `-4` / `-6` | `4`, `6`, or `true` (selects `-4`). Any other value raises a Security Alert error. |
| `disablePseudoTTY` | `-T` | Disables pseudo-terminal allocation. |
| `forcePseudoTTY` | `-t` | Forces pseudo-terminal allocation. |
| `verbose` | `-v` | Verbose ssh output. |
| `cipherSpec` | `-c` | Cipher specification. |
| `escape` | `-e` | Escape character. |
| `logFile` | `-E` | Log file path. |
| `configFile` | `-F` | Config file path. |
| `identityFile` | `-i` | Identity file path. |
| `loginName` | `-l` | Login name. |
| `macSpec` | `-m` | MAC specification. |
| `options` | `-o key=value` | Each own enumerable entry. Keys are reduced to `[a-zA-Z0-9]`; values are shell-quoted. |

The nested command is always built as:

```text
ssh -x <flags> -o "StrictHostKeyChecking=no" -p <port> '<userName>'@'<host>'
```

`userName` and `host` are shell-quoted, and `port` is reduced to digits.
`options` keys and values containing shell control characters are rejected with
a `Security Alert` error.

> **Note:** `StrictHostKeyChecking=no` is added to every nested connection. If
> that is not acceptable, enforce host-key policy in the primary host's
> `~/.ssh/config` or `known_hosts`, or avoid tunnelling for those hosts.

Connection-level features such as keyboard-interactive apply to the primary
connection only. Each nested host uses its own `connectedMessage`,
`readyMessage`, and `closedMessage`.

See [`test/live/tunnel.js`](./test/live/tunnel.js) and
[`test/live/chaining.js`](./test/live/chaining.js).

## Events and the API

### Instance events

Add these with `SSH.on(name, handler)`. All handlers run with `this` set to the
`SSH2Shell` instance.

```javascript
SSH.on('msg', (message) => { /* ... */ });
SSH.on('data', (data) => { /* ... */ });
SSH.on('stderrData', (data) => { /* ... */ });

SSH.on('commandProcessing', (command, response, sshObj, stream) => { /* ... */ });
SSH.on('commandComplete', (command, response, sshObj, details) => { /* ... */ });
SSH.on('commandTimeout', (command, response, stream, connection, details) => { /* ... */ });
SSH.on('end', (sessionText, sshObj) => { /* ... */ });
SSH.on('error', (err, type, close = false, callback) => { /* ... */ });
SSH.on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => { /* ... */ });
```

| Event | Arguments | Description |
| --- | --- | --- |
| `msg` | `message` | Status and progress text. Defaults to `console.log`. |
| `data` | `data` | Raw data from the shell stream. |
| `stderrData` | `data` | Data from stderr. Defaults to `console.error`. |
| `commandProcessing` | `command, response, sshObj, stream` | Output received before the prompt is detected. |
| `commandComplete` | `command, response, sshObj, details` | A command returned to the prompt. `response` is raw by default; `commandResponse: 'handled'` removes the echoed command and trailing prompt. `details.rawResponse` is always the raw buffer. The handler can modify `sshObj.commands` to queue follow-up work. |
| `commandTimeout` | `command, response, stream, connection, details` | No data arrived for `idleTimeOut` milliseconds. `details` is `{ attempt, maxRetries, final }`. |
| `end` | `sessionText, sshObj` | A host session finished. On the final host, `sessionText` is the combined text. |
| `error` | `err, type, close, callback` | An error occurred. A dropped transport uses type `Connection close` and passes an `Error` with `level = 'Connection close'` and `hadError`. `close` requests a connection close; `callback(err, type)` runs before closing. |
| `keyboard-interactive` | `name, instructions, instructionsLang, prompts, finish` | The server requested keyboard-interactive authentication. |

`commandComplete` receives the response after the command has been removed from
`sshObj.commands`. The default is the raw buffer. Set
`commandResponse: 'handled'` to receive a response without the echoed command
or trailing prompt; the raw buffer is still available as `details.rawResponse`,
and `sessionText` stays raw. `connect`, `ready`, and `close` are not instance
events; use the `msg` event with `connectedMessage`, `readyMessage`, and
`closedMessage`, or listen for `end`.

`newPrimaryHost` is used internally to move between primary hosts and is not
part of the public API.

### Methods and properties

`SSH2Shell` extends the legacy `stream.Stream` class, so `on`, `once`, `emit`,
`removeListener`, and `pipe` are available.

| Member | Description |
| --- | --- |
| `connect(callback)` | Start the session. `callback(sessionText)` is optional and receives the combined text when all hosts finish. |
| `stop(reason)` | Abort the whole run. Clears every command and host queue, sends Ctrl-C if a command is in flight, runs the library's queued `exitCommands` (bounded by `idleTimeOut`), closes once, and calls the callback once. A no-op before `connect()` or after the run finishes. |
| `close()` | Close the current shell stream. A no-op if the shell has not opened yet. Remaining primary hosts still run; use `stop()` to abandon them. |
| `close({ graceful: true })` | Run queued exit commands and back out of nested shells before closing. Remaining primary hosts still run. |
| `emit(name, ...args)` | Raise an event. Inherited from `EventEmitter`. |
| `sshObj` | The current host object, including runtime state such as `sessionText`, `commands`, `hosts`, `exitCommands`, `pwSent`, `sudoFailed`, `stopReason`, and the `skipCommands` / `skipHosts` / `skipPrimaryHosts` / `abort` flags. |
| `command` | The command currently being processed. |
| `idleTime` | The active command timeout in milliseconds. |
| `dataIdleTime` | The active response-settling delay in milliseconds. |

`connect()` does not return a Promise. Use the callback or the `end` event to
know when the session is complete.

`pipe()` is inherited from the stream base class. It is not part of the host
configuration and `ssh2shell` does not emit `pipe` or `unpipe` events.

### Stopping and closing

There are three levels of stopping: stop the current host, skip the remaining
primary hosts, or abort the whole run. `close()` is a separate connection
operation. Set the flags from `onCommandComplete`; `stop()` and `close()` can be
called from any handler. The completed response is already in `sessionText`, so
stopping does not lose the command that triggered it.

**Common cases**

```javascript
// Stop this host when a command fails. Nested and primary hosts still run.
onCommandComplete(command, response, sshObj) {
  if (/failed/i.test(response)) sshObj.skipCommands = true;
}
```

```javascript
// Stop this host and skip its own nested hosts. Primary hosts still run.
onCommandComplete(command, response, sshObj) {
  if (/failed/i.test(response)) {
    sshObj.skipCommands = true;
    sshObj.skipHosts = true;
  }
}
```

```javascript
// Skip the remaining primary hosts, but finish this host cleanly.
onCommandComplete(command, response, sshObj) {
  if (/failed/i.test(response)) {
    sshObj.skipCommands = true;
    sshObj.skipPrimaryHosts = true;
  }
}
```

```javascript
// Abort the whole run. No remaining commands or hosts are run.
onCommandComplete(command, response, sshObj) {
  if (/failed/i.test(response)) this.stop('command-failed');
}
```

```javascript
// Declarative form for the same whole-run abort.
onCommandComplete(command, response, sshObj) {
  if (/failed/i.test(response)) sshObj.abort = 'command-failed';
}
```

```javascript
// Close now because the shell itself is unusable.
onError(err, type, close) {
  if (close) this.close();
}
```

```javascript
// Leave nested shells cleanly before closing.
onCommandComplete(command, response, sshObj) {
  if (/finished/i.test(response)) this.close({ graceful: true });
}
```

```javascript
// Keep the session but cancel a prompt that cannot be answered.
onCommandProcessing(command, response, sshObj, stream) {
  if (/unexpected prompt/.test(response)) stream.write('\x03');
}
```

**What the flags do**

- `skipCommands` stops the current host after the completed command.
- `skipHosts` also clears the current host's own nested hosts. Pair it with
  `skipCommands` to stop the current host; sibling nested hosts already queued
  on a parent still run.
- `skipPrimaryHosts` skips the remaining primary hosts. Pair it with
  `skipCommands` if the current host should stop now; otherwise its remaining
  commands still run.
- `stop(reason)` clears every queue. If a command is still running it sends
  Ctrl-C first, then runs the library's queued `exitCommands` (bounded by
  `idleTimeOut`), closes once, and calls the callback once. The reason appears
  as `Stop requested: <reason>` and in `sshObj.stopReason`.
- `close()` closes the current connection but still runs the remaining primary
  hosts, matching earlier releases. Use `stop()` to abandon them.
- `close({ graceful: true })` runs the queued exit commands and backs out of
  nested shells before closing.

**Notes**

- Clearing `sshObj.commands` or `sshObj.hosts` directly is equivalent to the
  matching flag.
- Every visited host still gets one `end`, and the callback runs once. The final
  callback and the `end` event receive the same combined text.
- A command timeout uses `onCommandTimeout`; the default reports the error and
  closes the shell, then the connection.
- Prefer clearing the queues while the shell is usable. Close when the prompt is
  not recognised and Ctrl-C does not recover, or the connection is compromised.
- Do not call `this.connection.end()` from a handler. Use `close()` so the final
  session text is preserved.

The full behavior matrix and internal details are in
[`docs/CLOSE-SEMANTICS.md`](./docs/CLOSE-SEMANTICS.md).

## Advanced usage

### Log to a file

Set `msg` on the host to send status messages to a file instead of the console,
and append the final transcript in the callback:

```javascript
const fs = require('fs');
const log = (text) => fs.appendFileSync('ssh2shell.log', `${text}\n`);

const host = {
  // ...
  msg: log,
};

const SSH = new SSH2Shell(host);

SSH.connect((sessionText) => {
  log(sessionText);
});
```

`msg` receives every message emitted by `ssh2shell`, including the connection
messages and any `msg:` notifications. The callback's `sessionText` is the
complete transcript. For live per-command output as the run progresses, enable
`verbose`.

### Run a generated bash script

For multi-line logic, generate a script on the host, run it, and remove it. Keep
the generated content out of `sessionText` if you do not want it echoed.

```javascript
host.commands = [
  "cat > myscript.sh <<'EOF'\n" +
  '#!/bin/bash\n' +
  'current=$(pwd)\n' +
  'cd ..\n' +
  'if [ -f myfile ]; then\n' +
  '  sed \'/^[ \\t]*$/d\' "${current}/myfile" | while read -r line; do\n' +
  '    printf \'Doing some stuff\\n\'\n' +
  '    printf \'%s\\n\' "$line"\n' +
  '  done\n' +
  'fi\n' +
  'EOF',
  'chmod 700 myscript.sh',
  './myscript.sh',
  'rm myscript.sh',
];
```

Using a quoted heredoc (`<<'EOF'`) prevents the outer shell from expanding
`$current` and `$line` while the script is being written. They are expanded
when the script runs.

If the script contains `#` or `>` at the end of a line, it can collide with the
default `standardPrompt` (`">$%#"`). Set a narrower prompt for that host, such as
`standardPrompt: "$%"`, or avoid those characters at line ends.

A more robust approach is to base64-encode the script and decode it on the host.
This avoids quoting problems with `echo` and `printf`:

```bash
echo "<base64>" | base64 -d | bash
echo "<base64>" | base64 -d | bash -s
```

See [`test/live/bash_script.js`](./test/live/bash_script.js) for a runnable
example.

From [issue #103](https://github.com/cmp-202/ssh2shell/issues/103) and
[issue #104](https://github.com/cmp-202/ssh2shell/issues/104).

### Verbose and debug output

- `verbose: true` emits process details and the response text after each
  command, including the loaded host config and intermediate values useful for
  troubleshooting.
- `debug: true` emits internal process steps, including the path through the
  state machine.

Both are emitted as `msg` events. Messages are prefixed with the host only when
the session spans more than one host (multiple primary hosts or nested hosts); a
single-host session omits the prefix. Do not enable them inside
`onCommandProcessing`, which runs for every chunk of output.

Add your own messages with the same flags:

```javascript
onCommandProcessing: function (command, response, sshObj, stream) {
  if (sshObj.verbose) {
    this.emit('msg', `${sshObj.server.host}: response: ${response}`);
  }
},
```

Debug and verbose output redacts the configured password and passphrase by
default. Set `exposeCredentials: true` only while diagnosing an authentication
problem, and never leave it enabled in production or in logs.

### Progress indicator

Progress is on by default. It prints a liveness indicator while a command is in
flight, writes to `process.stderr`, and only runs when stderr is a TTY, so
redirected output, CI logs, and the live-test runner stay clean. It never
changes `sessionText` or the `msg` stream.

A dot is written once per second while the command is outstanding. The line is
finished with a newline when the command completes, times out, errors, or the
host or session closes. When the session spans multiple primary or nested
hosts, the first line for each host starts with `[host]`.

Set `progress: false` on a host to opt out. Progress is also suppressed while
`debug` or `verbose` is enabled, because those already report internal steps.

```javascript
const host = {
  // ...
  progress: false,
  commands: ['apt-get update', 'sleep 30'],
};
```

Progress output is separate from `verbose` and `debug`. When either is enabled,
the heartbeat is suppressed because those modes already report each internal
step. Enable `progress` only when you want a terminal heartbeat for long or
silent commands; it produces nothing when stderr is redirected to a file.

### Credential handling

- `exposeCredentials` defaults to `false`. Debug and verbose strings have the
  configured password and passphrase replaced with `[REDACTED]`, and object
  dumps mask `password` and `passphrase` keys.
- Credentials are only redacted from `ssh2shell`'s own debug and verbose output.
  Your own `msg`, `data`, and `commandComplete` handlers receive raw text and
  must redact it if you log it.
- Prefer environment variables or a secrets manager over hard-coded passwords
  in source files.

## Troubleshooting

**The script hangs after a command.** The output did not match
`standardPrompt`. Check the actual prompt and set `standardPrompt` to the
characters it ends with. Enable `debug: true` to see the state transitions.

**`Unable to parse private key while generating public key (expected sequence)`.**
The passphrase is wrong, or the key is encrypted with an unsupported format.
Recheck the passphrase, try connecting manually with the same value, and
`.trim()` values read from files.

**`Password was incorrect` for `sudo`.** The `sudo` password was rejected. The
command is cancelled and the session continues. The rejection is emitted as a
normal `msg` and sets `sshObj.sudoFailed = true`, so it is visible without
`debug`. Later `sudo` commands reuse the same password, so correct it, check
`sshObj.sudoFailed` in `onCommandComplete`, or set `abortOnSudoFailure: true` to
stop the run.

**A nested host fails to authenticate.** Nested connections use the `ssh`
command on the primary host. Confirm that the primary host can reach the target
and that the supplied `userName`, `password`, `passPhrase`, or `identityFile`
works from that host.

**The output contains escape codes or control characters.** Adjust
`disableColorFilter`, `disableASCIIFilter`, `textColorFilter`, or `asciiFilter`.
See [Prompts and response filters](#prompts-and-response-filters).

**The connection closes without running commands.** Check the `error` event.
Common causes are a wrong host or port, a rejected key, or an invalid
`standardPrompt`.

## Security

Keep `ssh2shell` and its dependencies up to date. The library validates and
quotes values that are interpolated into the nested `ssh` command, but the
application is still responsible for validating untrusted input before it
reaches `server` or `server.ssh`.

- Allow-list `host`, `userName`, and `port` at the application boundary.
- Treat `server.ssh` values (`identityFile`, `cipherSpec`, `escape`, `logFile`,
  `configFile`, `loginName`, `macSpec`, and `options`) as configuration, not
  user input.
- Nested connections add `StrictHostKeyChecking=no`. If that is not acceptable,
  enforce host-key policy on the primary host or avoid tunnelling.
- Keep `exposeCredentials` at its default (`false`) in production.
- Use fingerprint validation on primary connections where host identity matters.

**Advisory:** [GHSA-4j47-m47f-3jp8](https://github.com/cmp-202/ssh2shell/security/advisories/GHSA-4j47-m47f-3jp8)
covers argument injection and shell breakout through unquoted `server.ssh`
parameters and the `host`/`userName`/`port` fields. It is fixed in `2.0.13`,
`2.0.14`, and `3.0.0`. Users of `2.0.12` and earlier should upgrade.

## Development

```bash
git clone https://github.com/cmp-202/ssh2shell.git
cd ssh2shell
npm install
npm test
```

`npm test` checks that `lib/` matches `src/`, runs the offline unit tests, and
runs the level-aware baseline tests. The live tests need real hosts. See
[`test/README.md`](./test/README.md) for the test layout, live runner,
environment variables, keys, and VM provisioning.

## License

[ISC](./LICENSE)
