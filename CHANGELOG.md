# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

Releases before `4.0.0` are recorded as git tags and GitHub Releases.

## [Unreleased]

## [4.1.0] - 2026-11-23

### Added

- `debug` and `verbose` can be set once on the `SSH2Shell` instance to override
  host values for the whole run, including `false` suppressing a host that
  enables the flag. Reading the instance property reports the effective value.
- `systemMsg(type, message, object)` is now a public helper for emitting debug
  and verbose messages from handlers. It gates on the effective flag and applies
  the standard host prefix and credential redaction. The internal `_systemMsg`
  name is replaced; the frozen baseline keeps it for comparison tests.

### Development

- Added live coverage for keyboard-interactive authentication on a nested hop
  and for `abortOnSudoFailure`, plus deterministic tests that feed one PTY
  transcript through `onData` at every chunk boundary.
- Added `npm run check:changelog` to CI and `prepublishOnly`, and documented the
  release-cadence, release-candidate review, changelog, and registry-propagation
  procedures in `docs/PUBLISHING.md`.
- Live workflow runs with the same ref now queue instead of cancelling each
  other, so a parallel publish or push cannot remove a PR's required
  `Live suite` check.
- Added a second round of unit tests for transport and state guards, host
  traversal, shutdown flows, and behaviour hardening, plus two live tests for
  the default command timeout and the TTY progress indicator. `test/coverage.md`
  records the local coverage review and full miss-overlap analysis (98.12%
  combined line coverage).

## [4.0.4] - 2026-11-18

### Fixed

- A primary host with no `server`, or a server with neither `host` nor
  `hostname`, now reports `Parameters`, finalizes that host, and continues to
  the next primary instead of leaving the run unfinished. It no longer silently
  targets `localhost:22`.
- Host labels, nested session text, and hop forwarding now use `hostname` when
  `host` is absent.
- `privateKey` is included in string redaction as well as object dumps, so
  verbose and debug messages cannot echo key material.
- `abortOnSudoFailure` sends a single Ctrl-C instead of two.
- A `workflow_dispatch` ref such as `refs/tags/vX.Y.Z` now passes the publish
  version check.

### Development

- Documented that fork pull requests skip the `Live suite` job and that GitHub
  treats the skipped required check as satisfied.

## [4.0.3] - 2026-11-18

### Fixed

- A host object without `server` now reports an `error` of type `Parameters`
  (primary) or `Hop` (nested) instead of throwing a `TypeError` before the
  connection starts.
- `verbose: true` now redacts `privateKey` in the config dump, alongside
  `password` and `passphrase`. `exposeCredentials: true` still shows it.
- `pty: false` now disables the pseudo-terminal. It was previously ignored
  because `ssh2` takes the PTY request from the first `shell()` argument.
- `stop()` and `close({ graceful: true })` no longer empty the caller's nested
  `hosts` arrays; the run's own queue is cleared instead, so the nested `hosts`
  array can be reused.
- `stop()` is now a no-op after a run that ended on a failure, and
  `abortOnSudoFailure` finishes as soon as the interrupted shell returns to a
  prompt instead of waiting out the idle timeout.
- A second `connect()` now throws instead of calling back with an empty string.
  Each `SSH2Shell` instance runs once; construct a new one to run again.

## [4.0.2] - 2026-11-16

### Development

- Added [`docs/MIGRATING-4.md`](./docs/MIGRATING-4.md), a symptom-to-fix guide
  for upgrades from 3.x, linked from the README and the 4.0.0 changelog entry.

## [4.0.1] - 2026-11-15

### Development

- Retired the redundant `tunnel_3_hop` and `ssh_user_command` live tests. The
  3-hop chain is covered by `chaining`, and the removed `ssh` command path made
  `ssh_user_command`'s premise obsolete.
- Corrected stale hop and timeout comments in `tunnel`, `graceful_close`, and
  `timeout` so they describe the `forwardOut` transport and the always-on idle
  timer.
- Added importable repository rulesets in `.github/rulesets/` for `master`
  (pull request, CI matrix, live suite, no force pushes or deletion) and `v*`
  release tags (owner-only creation, updates, and deletion). The release steps
  in `docs/PUBLISHING.md` now go through a pull request.
- Pointed the `package.json` `homepage` at the repository README instead of the
  outdated wiki.
- Added `SECURITY.md`, `CONTRIBUTING.md`, Dependabot configuration, and issue
  and pull request templates.

## [4.0.0] - 2026-11-15

### Breaking changes

See [docs/MIGRATING-4.md](./docs/MIGRATING-4.md) for the symptom-to-fix guide.

- **Host hops use `ssh2` `forwardOut` channels.** The nested `ssh` command path
  is gone, so a jump host no longer needs an `ssh` client, a shell, or a copy of
  your key. `server.ssh` and its options are removed: use `ssh2` connection
  options instead (`algorithms` replaces `cipherSpec` / `macSpec`, and
  `forceIPv4` / `forceIPv6` replace `forceAddressType`). `exitCommands` is
  removed with the command path.
- **`host.msg` is renamed to `host.onMsg`.** The Hubot-era `msg: { send: fn }`
  shape is no longer mapped.
- **`server.hashMethod` is removed.** Use `hostHash` or `hostVerifier`.
- **`sshObj.stop` is removed.** Use `abort`.
- **Host `idleTime` and `dataIdleTime` are removed.** Use `idleTimeOut` and
  `dataIdleTimeOut`. The instance-level `SSH.idleTime` and `SSH.dataIdleTime`
  remain.
- **`commandStartTimeout` and `details.noOutput` are removed.** The command idle
  timer is always armed when a command is written, so a silent command times
  out. A command that returns to a prompt without output is a normal
  completion.
- **`passphrasePrompt` is removed.** Only `passwordPrompt` remains.
- **An empty host list throws.** `new SSH2Shell([])`, `null`, and `undefined`
  throw a `TypeError` instead of starting a run with no hosts.
- **Host objects are mutated during a run.** `commands` is consumed,
  `sessionText` accumulates, and flags such as `pwSent` and `sudoFailed` are
  updated. Create a fresh object, or clone it, before reusing it with another
  instance.

### Added

- Depth-first hop traversal with sibling hosts. Each hop is a real `ssh2`
  connection opened through the parent's `forwardOut` channel, and it is
  verified with the same `hostHash` / `hostVerifier` contract as a primary.
- Contained hop failures. A failed hop emits `error` with type `Hop`, skips its
  commands and unstarted descendants, and the parent continues with its
  remaining hosts. A failed primary is finalized and the next primary runs.
- Per-hop `connectedMessage`, `readyMessage`, and `closedMessage`.
- Provisioning `--print-config` and environment-source logging (development
  tooling).

### Changed

- The command idle timer is armed when a command is written, not after the
  first output, so a command that never produces output still times out.
- Responses are sliced after the last echoed command, which removes earlier
  session noise and the garbled-buffer workaround.
- `command` and `_buffer` are record-scoped and restored when backing out of a
  hop, so the parent resumes its own command state.
- Host config no longer receives library state: default handlers are resolved
  per record instead of being written into the host object, and
  `applyHostDefaults` no longer writes `server.hashKey`.

### Development

- Added `test/live/host_traversal.js` and `test/live/host_faults.js` as the
  acceptance tests for hop traversal and fault containment.
- Added `SSH2SHELL_MODULE` (`src`, `lib`, `baseline`, or a repository-relative
  path) to select the build under test for live tests and provisioning.
- Rewrote the provisioning script around the current host API and a documented
  `PROVISION_*` environment contract. Re-provisioning removes the 3.x
  `~/.ssh/id_ed25519` copies that were only needed by nested `ssh -i` hops.
- `ssh2Client` is now `_ssh2Client` and is documented as an internal test seam.

[Unreleased]: https://github.com/cmp-202/ssh2shell/compare/v4.1.0...HEAD
[4.1.0]: https://github.com/cmp-202/ssh2shell/compare/v4.0.4...v4.1.0
[4.0.4]: https://github.com/cmp-202/ssh2shell/compare/v4.0.3...v4.0.4
[4.0.3]: https://github.com/cmp-202/ssh2shell/compare/v4.0.2...v4.0.3
[4.0.2]: https://github.com/cmp-202/ssh2shell/compare/v4.0.1...v4.0.2
[4.0.1]: https://github.com/cmp-202/ssh2shell/compare/v4.0.0...v4.0.1
[4.0.0]: https://github.com/cmp-202/ssh2shell/compare/v3.3.0...v4.0.0
