# Testing ssh2shell

This folder holds the offline test suites and the local environment used for
live tests against real VMs. The main [README](../README.md) covers the library
API; start here when you need to run, rebuild, or extend the tests.

## Layout

| Path | Purpose |
| --- | --- |
| `unit/` | Offline unit tests. They use a fake `ssh2` module and need no hosts. |
| `fixtures/baseline-ssh2shell.js` | Frozen L0 build used as the comparison target for behavior changes. |
| `live/` | Live tests that connect to the VMs in `.env`. |
| `certs/` | Test and admin SSH keys. Only the public keys are committed. |
| `provision/` | Rebuilds a live-test VM from a fresh Ubuntu install. |
| `utils/` | Shared live-test logging and key-loading helpers. |
| `logs/` | Generated test and provisioning logs. Gitignored. |
| `../scripts/run-tests.js` | Runs the offline unit and baseline suites. |
| `../scripts/run-live.js` | Runs the live suite with pass/fail checks. |

## Offline tests

`npm test` checks that `lib/` matches `src/`, runs the unit tests, and runs the
level-aware baseline tests. The baseline tests run the same assertions against
both the current build and the frozen artifact, so a signed-off behavior change
is visible as a deliberate difference rather than a silent regression.

```bash
npm test
npm run test:unit
npm run test:baseline
npm run test:src        # run the unit suite against src/ instead of lib/
```

No hosts or `.env` values are needed for these.

## Live tests

The live suite logs in to the three test VMs and exercises real prompts, sudo,
tunnelling, and long-running commands. Copy the environment file and fill in
the connection details first:

```bash
cp .env-example .env
```

Most tests authenticate with the key at `PRIVATE_KEY_PATH`. Passwords are used
only where the protocol requires them: `sudo`, `su`, and keyboard-interactive.
Nested hops use `HOP_KEY_PATH` and `HOP2_KEY_PATH`, which are paths on the jump
host rather than on your workstation.

Run the curated batch after a change:

```bash
npm run test:live
```

The batch covers basic commands and notifications, keyboard-interactive auth,
password and passwordless sudo, sudo rejection, prompt and timeout handling,
multiple primary hosts, stopping and closing from handlers (including graceful
close, multi-host fail-fast, and transport drops), nested and chained tunnelling,
a long command queue, and multi-line shell scripts. Use the full suite or select
tests explicitly:

```bash
npm run test:live:all
node scripts/run-live.js --list
node scripts/run-live.js simple tunnel chaining
node scripts/run-live.js --all --timeout 300
```

Each test runs in its own process with a 180-second default timeout. The runner
does not trust the exit code: a failed connection still reaches the connect
callback with empty session text and exits zero. It checks the callback, the
session text, `error` events, connection-failure markers in the log, and a
small per-test expectation. A failure prints the reason and the log path.

A single test can still be run directly, for example
`node test/live/simple.js`. Direct runs skip the runner's extra checks and just
write the log and callback output. Set `DEBUG=true` (or `VERBOSE=true`) when
running a stop/close test directly to see the state transitions, including the
`Stop requested` reason and the host-finalization steps.

To see the progress heartbeat (on by default; set `progress: false` to opt
out), run `node test/live/progress.js` directly in an interactive terminal.
Progress only writes when stderr is a TTY, so the runner (which captures stderr
through a pipe) keeps it silent.

## Live environment

The suite expects the hosts and users created by the provisioning script:

| Role | Static IP | Hostname |
| --- | --- | --- |
| `server1` | `192.168.44.10` | `server1` |
| `server2` | `192.168.44.11` | `server2` |
| `server3` | `192.168.44.12` | `server3` |

`tester` is the primary login. `nopasswd` proves passwordless sudo on server2,
`suuser` is the no-sudo account for the `su` test, and `kbduser` is the
keyboard-interactive account on server1. See
[`certs/README.md`](./certs/README.md) for the key pairs, the full user matrix,
and the static addressing.

The main environment variables are:

| Variable(s) | Purpose |
| --- | --- |
| `HOST`, `PORT`, `USER_NAME`, `PRIVATE_KEY_PATH`, `KEY_PASSPHRASE` | Primary login. |
| `SERVER1_*`, `SERVER2_*`, `SERVER3_*` | Additional primary hosts and nested targets. |
| `SECOND_USER`, `SECOND_USER_PASSWORD` | `su` test account. |
| `NOPASSWD_USER`, `NOPASSWD_PASSWORD` | Passwordless sudo test account. |
| `KBD_USER`, `KBD_PASSWORD` | Keyboard-interactive account. |
| `HOP_KEY_PATH`, `HOP2_KEY_PATH` | Test key path on each jump host. |
| `EXPECTED_HOST_HASH` | Pinned host fingerprint for the fingerprint test. |
| `DEBUG`, `VERBOSE` | `ssh2shell` session output. |

[`.env-example`](../.env-example) lists every variable with its default.

## Provisioning

To rebuild a VM from a fresh Ubuntu install, put its current address and
bootstrap login in `test/provision/.env`, then run the matching role:

```bash
npm run provision -- server3
```

The script writes the role's static address last because changing the network
can drop the session. See [`provision/README.md`](./provision/README.md) for the
role matrix, environment variables, adapter setup, and recovery behavior.

## Adding a live test

1. Create `test/live/<name>.js`. Require `../../src/ssh2shell`, use
   `logFile()` / `log()` from `../utils/logging.js`, and load the key with
   `readPrivateKey()` from `../utils/private_key.js`.
2. Add an entry to the `checks` map in `../scripts/run-live.js`. Use
   `contains` / `excludes` for session text, `logContains` for log output, and
   `files` for tests that write separate output files.
3. Add the name to `defaultTests` if it belongs in the curated batch.
4. Run it directly with `node scripts/run-live.js <name>` and check
   `test/logs/<name>.js.log`.

## Logs

Every runner invocation writes `test/logs/<test>.js.log` plus
`test/logs/.live-result.json`. The `pipe` test also writes `pipe-first.log` and
`pipe-second.log`. Provisioning writes `test/logs/provision-<role>.js.log`. The
whole `logs/` directory is gitignored.

## Related documentation

- [`../REFACTORING.md`](../REFACTORING.md) — refactoring history and backlog.
- [`../docs/API-BASELINE.md`](../docs/API-BASELINE.md) — signed-off behavior
  changes.
- [`../docs/ERROR-HANDLING.md`](../docs/ERROR-HANDLING.md) — error paths and
  their tests.
- [`../docs/CLOSE-SEMANTICS.md`](../docs/CLOSE-SEMANTICS.md) — stop, close, and
  host-finalization behavior.
- [`certs/README.md`](./certs/README.md) — keys, users, and host matrix.
- [`provision/README.md`](./provision/README.md) — VM provisioning.
