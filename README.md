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
  - [Capture output](#capture-output)
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
- [Advanced usage](#advanced-usage)
  - [Run a generated bash script](#run-a-generated-bash-script)
  - [Verbose and debug output](#verbose-and-debug-output)
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
const SSH2Shell = require('ssh2shell');

const host = {
  server: {
    host: '192.168.0.10',
    userName: 'deploy',
    password: 'secret',
  },
  commands: ['echo $(pwd)', 'ls -l'],
};

const SSH = new SSH2Shell(host);

SSH.connect((sessionText) => {
  console.log(sessionText);
});
```

The callback receives the complete session text, including the output of every
command. If you prefer events, listen for `end` instead:

```javascript
SSH.on('end', (sessionText, sshObj) => {
  console.log(`${sshObj.server.host}:\n${sessionText}`);
});

SSH.connect();
```

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
sends the next command. This is why the prompt matters: if the host uses a
different prompt, detection fails and the command times out.

**`sessionText`.** Each host accumulates its own output in `sshObj.sessionText`.
When all hosts finish, `connect(callback)` passes the combined text.

**Primary hosts vs. tunnelling.** These are different features:

| Feature | Config | How it connects | Use it when |
| --- | --- | --- | --- |
| Multiple primary hosts | `new SSH2Shell([host1, host2])` | A new `ssh2` connection per host, one after another | You have several independent servers |
| Tunnelling | `host1.hosts = [host2]` | An `ssh` command run inside the current session | You must reach a host through a jump host |

**Notifications.** Two command entries are handled locally and are not sent to
the host:

- `"msg:Text"` emits a `msg` event.
- `` "`Text`" `` adds `Text` to `sessionText` only.

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
| `hosts` | host[] | `[]` | Nested hosts to tunnel to. See [Tunnelling](#tunnelling-through-a-jump-host). |

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

- `msg:` emits a `msg` event with `${host}: Note: ${text}`. The default `msg`
  handler writes it to the console.
- A backtick-wrapped entry is appended to `sessionText` without being run. This
  avoids the command echo you would get from `echo`.

### Prompts and response filters

Prompt detection decides when a command is finished. Filters clean the output
before it is matched and stored.

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `standardPrompt` | string | `">$%#"` | Characters that identify a command prompt. Compiled to a regex matching one of these at the end of a line. |
| `passwordPrompt` | string | `":"` | Text that identifies a password prompt. |
| `passphrasePrompt` | string | `":"` | Text that identifies a passphrase prompt. |
| `passPromptText` | string | `"Password"` | Text that must appear before the password/passphrase prompt. Shared by both prompt types. |
| `asciiFilter` | string | `"[^\r\n\x20-\x7e]"` | Regex that removes non-standard ASCII. Tabs are preserved by the compiled default. |
| `disableASCIIFilter` | boolean | `false` | Set to `true` to keep non-standard ASCII. |
| `textColorFilter` | string | `"\\x1b\\[[0-9;]*m"` | Regex that removes ANSI colour codes. |
| `disableColorFilter` | boolean | `false` | Set to `true` to keep ANSI colour codes. |

If your host uses a prompt that does not end in `>$%#`, set `standardPrompt` to
the characters it does use. For example, a prompt ending in `>` and a space
still works, but a prompt ending in `:` will not.

`passPromptText` is shared by password and passphrase detection. If your host
uses different wording, set it to text common to both prompts.

Filters only affect the text that `ssh2shell` matches and stores. They do not
change what the host sends.

### Timeouts

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `idleTimeOut` | number | `5000` | Milliseconds to wait for a command to return to a prompt. |
| `dataIdleTimeOut` | number | `500` | Milliseconds of silence used to decide that a response burst has ended. |

`idleTimeOut` is the command timeout. When it expires, the `commandTimeout`
event fires. The default handler emits an `error` of type `Command Timeout` and
closes the connection.

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
| `verbose` | boolean | `false` | Emit the response text after each command. |
| `debug` | boolean | `false` | Emit internal process steps. |
| `exposeCredentials` | boolean | `false` | Do **not** redact passwords/passphrases in debug and verbose output. |
| `showBanner` | boolean | `false` | Include the host banner in `sessionText`. |
| `enter` | string | `"\n"` | End-of-line sequence written after each command. |
| `streamEncoding` | string | `"utf8"` | Encoding applied to the shell stream. |
| `window` | boolean | `true` | First argument to `connection.shell()`. An explicit `false` is preserved. |
| `pty` | boolean | `true` | Pseudo-terminal option passed to `connection.shell()`. An explicit `false` is preserved. |

> **Note:** `connect`, `ready`, and `close` are **not** instance events. Use the
> `msg` event and the three message properties above, or listen for `end`.

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
| `onCommandComplete` | `command, response, sshObj` | A command returns to the prompt. |
| `onCommandTimeout` | `command, response, stream, connection` | No prompt is detected within `idleTimeOut`. |
| `onEnd` | `sessionText, sshObj` | The host session finishes. |
| `onError` | `err, type, close, callback` | An error is raised. |
| `onKeyboardInteractive` | `name, instructions, instructionsLang, prompts, finish` | Keyboard-interactive authentication is requested. |

Inside every handler, `this` is the `SSH2Shell` instance. Use `this.sshObj` to
read the current host configuration and `this.emit('msg', text)` to report
progress.

`onCommandProcessing` and `onCommandTimeout` receive the live `stream`, so you
can answer a prompt with `stream.write('y\n')`. See
[Respond to a prompt mid-command](#respond-to-a-prompt-mid-command).

If an `onError` handler needs to close the connection, call
`this.connection.end()` for the SSH connection or `this.close()` for the shell
stream. The default error handler closes the shell when its `close` argument is
`true`.

## Recipes

### Run commands on a host

```javascript
const SSH2Shell = require('ssh2shell');

const host = {
  server: {
    host: '192.168.0.10',
    port: 22,
    userName: 'deploy',
    password: 'secret',
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

### Capture output

The callback receives the combined text from every host. For per-command
output, use `commandComplete`:

```javascript
SSH.on('commandComplete', (command, response, sshObj) => {
  console.log(`${sshObj.server.host} $ ${command}`);
  console.log(response.trim());
});
```

`response` is the raw buffer for the command. `sshObj.sessionText` contains the
accumulated text for the current host.

### Authenticate with a private key

```javascript
const fs = require('fs');
const os = require('os');
const path = require('path');

const host = {
  server: {
    host: '192.168.0.10',
    userName: 'deploy',
    privateKey: fs.readFileSync(path.join(os.homedir(), '.ssh', 'id_ed25519')),
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

### Keyboard-interactive authentication

Set `tryKeyboard` and provide a handler. The handler must call `finish()` with
answers in the same order as `prompts`.

```javascript
const host = {
  server: {
    host: '192.168.0.10',
    userName: 'deploy',
    password: 'secret',
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

See [`test/keyboard-interactive.js`](./test/keyboard-interactive.js) for a
complete example.

### Verify a host fingerprint

At connection time, ssh2 can hash the server's public key and pass it to
`hostVerifier`. Compare it with a value you recorded earlier to detect a
different server or a man-in-the-middle.

The verifier receives a **hex digest without colons** when `hostHash` is set.
Record the value on the first connection, then pin it:

```javascript
const host = {
  server: {
    host: '192.168.0.10',
    userName: 'deploy',
    password: 'secret',
    hostHash: 'sha256', // any crypto.getHashes() algorithm
    hostVerifier: function (hashedKey) {
      // Replace with the value recorded from the first connection.
      const expectedHash = '3f7a...';
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

### Run sudo and su commands

`sudo` is handled automatically. When output matches `passwordPrompt`,
`ssh2shell` sends `server.password` once and continues. A rejected `sudo`
password is reported as debug output, the command is cancelled, and the session
continues.

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
const host = {
  server: {
    // ...connection settings
    secondUserPassword: process.env.SECOND_USER_PASSWORD, // your own field
  },
  commands: ['su seconduser', 'whoami', 'exit'],
  onCommandProcessing: function (command, response, sshObj, stream) {
    if (command === 'su seconduser'
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
See [`test/sudo_su.js`](./test/sudo_su.js) for a working example.

### Respond to a prompt mid-command

Some commands ask a question that is neither a login prompt nor a standard
prompt, such as `apt-get` asking `[Y/n]?`. Use `onCommandProcessing` and write
the answer to the stream. Guard it with a flag so it only answers once.

```javascript
const host = {
  server: { /* ... */ },
  commands: ['apt-get install nano'],
  onCommandProcessing: function (command, response, sshObj, stream) {
    if (command === 'apt-get install nano'
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
  if (command === 'apt-get install nano'
      && response.includes('[Y/n]?')
      && sshObj.answeredNano !== true) {
    sshObj.answeredNano = true;
    stream.write('y\n');
  }
});
```

Do not define the same handler in both places. It will run twice.

If no prompt is detected and no answer is sent, `commandTimeout` fires after
`idleTimeOut`.

### Handle a command timeout

The default timeout handler adds the last response to `sessionText` and closes
the connection. Override `onCommandTimeout` if you want to answer the prompt or
keep the session open.

```javascript
const host = {
  server: { /* ... */ },
  commands: ['apt-get install nodejs'],
  onCommandTimeout: function (command, response, stream, connection) {
    if (command === 'apt-get install nodejs'
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

## Multiple hosts

### Multiple primary hosts

Pass an array of host objects to the constructor. Each host gets its own ssh2
connection, runs its own commands, and is closed before the next host starts.
The final callback receives the combined session text.

```javascript
const host1 = {
  server: { host: '10.0.0.11', userName: 'deploy', password: 'secret' },
  commands: ['hostname', 'uptime'],
};

const host2 = {
  server: { host: '10.0.0.12', userName: 'deploy', password: 'secret' },
  commands: ['hostname', 'uptime'],
};

const SSH = new SSH2Shell([host1, host2]);

SSH.connect((allSessionText) => {
  console.log(allSessionText);
});
```

Each host is independent. Shared functions can be assigned to multiple host
objects, and shared handlers can be added to the instance instead.

See [`test/multiple_primary_hosts.js`](./test/multiple_primary_hosts.js).

### Tunnelling through a jump host

Set `hosts` on a host object to connect to further hosts **through** it. Each
nested connection is an `ssh` command run inside the current session, so it uses
the shell of the host you are already on.

```javascript
const jump = {
  server: {
    host: '10.0.0.10',
    userName: 'deploy',
    password: 'secret',
  },
  commands: ['hostname'],
};

const target = {
  server: {
    host: '192.168.1.20',
    userName: 'deploy',
    password: 'secret',
  },
  commands: ['hostname', 'uptime'],
};

jump.hosts = [target];

const SSH = new SSH2Shell(jump);
SSH.connect((sessionText) => console.log(sessionText));
```

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

See [`test/tunnel.js`](./test/tunnel.js) and
[`test/chaining.js`](./test/chaining.js).

## Events and the API

### Instance events

Add these with `SSH.on(name, handler)`. All handlers run with `this` set to the
`SSH2Shell` instance.

```javascript
SSH.on('msg', (message) => { /* ... */ });
SSH.on('data', (data) => { /* ... */ });
SSH.on('stderrData', (data) => { /* ... */ });

SSH.on('commandProcessing', (command, response, sshObj, stream) => { /* ... */ });
SSH.on('commandComplete', (command, response, sshObj) => { /* ... */ });
SSH.on('commandTimeout', (command, response, stream, connection) => { /* ... */ });
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
| `commandComplete` | `command, response, sshObj` | A command returned to the prompt. |
| `commandTimeout` | `command, response, stream, connection` | No prompt was detected within `idleTimeOut`. |
| `end` | `sessionText, sshObj` | A host session finished. On the final host, `sessionText` is the combined text. |
| `error` | `err, type, close, callback` | An error occurred. `close` requests a connection close; `callback(err, type)` runs before closing. |
| `keyboard-interactive` | `name, instructions, instructionsLang, prompts, finish` | The server requested keyboard-interactive authentication. |

`newPrimaryHost` is used internally to move between primary hosts and is not
part of the public API.

### Methods and properties

`SSH2Shell` extends the legacy `stream.Stream` class, so `on`, `once`, `emit`,
`removeListener`, and `pipe` are available.

| Member | Description |
| --- | --- |
| `connect(callback)` | Start the session. `callback(sessionText)` is optional and receives the combined text when all hosts finish. |
| `close()` | Close the current shell stream. A no-op if the shell has not opened yet. |
| `emit(name, ...args)` | Raise an event. Inherited from `EventEmitter`. |
| `sshObj` | The current host object, including runtime state such as `sessionText`, `commands`, and `pwSent`. |
| `command` | The command currently being processed. |
| `idleTime` | The active command timeout in milliseconds. |
| `dataIdleTime` | The active response-settling delay in milliseconds. |

`connect()` does not return a Promise. Use the callback or the `end` event to
know when the session is complete.

`pipe()` is inherited from the stream base class. It is not part of the host
configuration and `ssh2shell` does not emit `pipe` or `unpipe` events.

## Advanced usage

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

From [issue #103](https://github.com/cmp-202/ssh2shell/issues/103) and
[issue #104](https://github.com/cmp-202/ssh2shell/issues/104).

### Verbose and debug output

- `verbose: true` emits the response text after each command.
- `debug: true` emits internal process steps, including the path through the
  state machine.

Both are emitted as `msg` events. Do not enable them inside
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
command is cancelled and the session continues; the message is debug output, not
a terminating error.

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
runs the level-aware baseline tests. The other files in `test/` are legacy live
tests that need real hosts and environment variables; see `REFACTORING.md` for
their status.

## License

[ISC](./LICENSE)
