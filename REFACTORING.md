# ssh2shell refactor ledger

This document tracks each level of improvement to `ssh2shell` as an atomic,
tagged, independently revertible step on the `Refactoring` branch.

The goal is simple: at any point we can identify exactly what changed at a given
level, verify it, and roll back to it without guessing.

## Decisions

| Topic | Decision |
| --- | --- |
| End state | Modern JavaScript (CoffeeScript toolchain removed) |
| Compatibility | Strict: same public API, events, config keys, and observable behavior |
| Verification | Offline unit harness with a mocked `ssh2`; the same suite also runs against the frozen baseline artifact (live hosts not required) |
| Rollback tracking | One annotated tag per level plus this ledger |

## Compatibility contract

The following must remain identical throughout the refactor:

- `require('ssh2shell')` returns the same constructible class.
- The class extends `Stream` and supports `connect(callback)` and the inherited
  `pipe`. (`unpipe` is documented but absent at baseline; adding it would be a
  behavior change, so it is not part of the strict contract.)
- Public instance properties: `.sshObj`, `.command`.
- All events the code actually emits: `msg`, `data`, `stderrData`, `error`,
  `end`, `commandProcessing`, `commandComplete`, `commandTimeout`,
  `keyboard-interactive`, `newPrimaryHost`.
- All host/config keys the code actually reads (see `docs/API-BASELINE.md`).
  README claims that the code ignores are recorded as discrepancies, not
  silently adopted.
- Default prompts, filters, timeouts, and session-text behavior.

Internals (private `_methods`, file layout, helper functions) may change freely
as long as the contract above holds.

> Note: a bug fix that changes observable behavior conflicts with "strict"
> compatibility. Such fixes need explicit sign-off and must be recorded in the
> ledger as behavior changes, not silent cleanups.

## Host model

Two host layers exist and must stay distinct:

- **Primary hosts** live in `_hosts` and are opened with a new `ssh2.Client`
  connection. `_nextPrimaryHost` iterates this array.
- **Secondary (nested) hosts** live in the current host's `hosts` array and are
  opened by typing an `ssh ...` command into the current shell (`_sshConnect`).
  `_nextHost` iterates this array. Several secondary hosts may be chained.

`_runExit` is the "finish this host" routine. It runs queued exit commands, then
opens the next secondary host if one remains, otherwise backs out through
`_connections` via `_previousHost`, and finally closes. Backing out to a previous
host re-runs `_runExit`, so that host's remaining `hosts` entries are resumed
rather than discarded. See `docs/API-BASELINE.md` for the exact order.

## Branch and tag policy

- `Refactoring` is the integration branch for all levels.
- `master` stays untouched until the refactor is accepted.
- `refactor/L0-baseline` marks the pristine pre-refactor state.
- Each level gets one annotated tag: `refactor/L1`, `refactor/L2`, ...
- Each level is one atomic commit (or a small, clearly-scoped commit series).
- Tags are the source of truth for rollback; commit SHAs are informational.

## Rollback recipes

```bash
# Inspect a level
git show refactor/L2
git diff refactor/L2..HEAD

# Safe undo of everything after L2 (creates a revert commit)
git revert --no-commit refactor/L2..HEAD
git commit -m "revert to refactor/L2"

# Hard reset (local only, destructive)
git reset --hard refactor/L2

# Restore a single file from a level
git checkout refactor/L2 -- path/to/file
```

## Level completion checklist

Every level must satisfy all of these before it is tagged:

1. Scope is limited to the level's stated goal.
2. Characterization/unit tests pass against the current build.
3. New tests also run against the frozen baseline artifact, so they describe
   real original behavior rather than the refactored implementation.
4. `lib/ssh2shell.js` is rebuilt and `npm run check:build` passes (until L7
   changes the publish flow).
5. Public API/event smoke checks pass.
6. `REFACTORING.md` ledger row is updated.
7. Commit created and annotated tag `refactor/LN` applied.
8. `git status` is clean.

## Baseline dual-run

`test/fixtures/baseline-ssh2shell.js` is the frozen L0 compiled artifact.
`npm run test:baseline` sets `SSH2SHELL_TEST_MODULE` so the same unit suite loads
that artifact instead of `lib/`. This checks that every characterization still
describes the original behavior and separates real regressions from intentional
differences.

When adding a test:

1. Run it against the current build (`npm run test:unit`).
2. Run it against the baseline (`npm run test:baseline`).
3. Passes on both: it characterizes shared behavior.
4. Fails on baseline, passes on current: it covers an intentional change. Make
   the expectation level-aware and record why.
5. Fails on both: it characterizes a bug. Keep the current (buggy) expectation
   and mark it as a known defect until a signed-off fix changes it.

## Level ladder (proposed, adjustable)

| Level | Goal | Behavior change |
| --- | --- | --- |
| L0 | Baseline: tag pristine `v2.0.14`, add this ledger | None |
| L1 | Offline safety net: mocked-`ssh2` harness and characterization tests | None |
| L2 | Port `src/ssh2shell.coffee` to JavaScript 1:1, same structure and logic; remove the CoffeeScript source and toolchain | None |
| L3 | Split into focused modules behind the existing class facade | None |
| L4 | Modernize syntax and clean up dead code, typos, duplication | None |
| L5 | Fix defects and security issues, each covered by a test | Only with sign-off |
| L6 | Signed-off post-L5 backlog, per-host prompt/filter, and error-handling fixes | Only with sign-off |
| L6.1 | Approved optimisation and robustness follow-ups (readability, timer/option de-duplication, SSH prompt timeout, guarded close, empty command, own-property options, build-sync guard) | Only with sign-off |
| L7 | Tooling, docs, CI, and publish pipeline | None |

The ladder can be reordered or split as we learn more; any change to the plan
must be recorded here.

## Ledger

| Level | Tag | Commit | Status | Goal | Verification | Rollback |
| --- | --- | --- | --- | --- | --- | --- |
| L0 | `refactor/L0-baseline` | `43ab187` | Done | Tag pristine `v2.0.14` and add this ledger | Baseline tag points at the unmodified release commit | `git reset --hard refactor/L0-baseline` |
| L1 | `refactor/L1` | - | Done | Offline `ssh2` mock and 57 characterization tests | `npm run test:unit` passes; `npm run build` leaves `lib/` in sync | `git reset --hard refactor/L1` |
| L2 | `refactor/L2` | — | Done | 1:1 JavaScript port; CoffeeScript source and toolchain removed | 61 tests pass against the port (57 baseline characterizations plus 4 port-semantics tests); baseline-vs-port comparison matches defaults, prototype surface, SSH command construction, return values, and event payloads; `npm run build` leaves `lib/` in sync | `git reset --hard refactor/L2` |
| L3 | `refactor/L3` | — | Done | Split pure helpers into focused modules behind the existing class facade | 61 tests pass unchanged; baseline-vs-port comparison still matches; `npm run build` copies the module tree and leaves `lib/` in sync | `git reset --hard refactor/L3` |
| L4 | `refactor/L4` | — | Done | Modernize syntax and remove dead code, duplication, and obsolete compatibility shims | 62 tests pass; the same 62 pass against the frozen baseline artifact, with only the `_nextPrimaryHost` empty-queue assertion level-aware; baseline-vs-port comparison still matches; `npm run build` leaves `lib/` in sync | `git reset --hard refactor/L4` |
| L5 | `refactor/L5` | — | Done | Debug/verbose message gating, per-host listener lifecycle, and the signed-off multi-host/payload fixes | 72 tests pass; the same 72 pass against the frozen baseline artifact with L5 expectations level-aware; `npm run build` leaves `lib/` in sync; backing out of a nested host no longer fires stale handlers or duplicates session text | `git reset --hard refactor/L5` |
| L6 | `refactor/L6` | — | Done | Signed-off post-L5 fixes: backlog config/flags, per-host prompt/filter compilation, and error-handling termination | 88 tests pass; the same 88 pass against the frozen baseline artifact with L6 expectations level-aware; `npm run build` leaves `lib/` in sync; pre-shell errors no longer throw, host `onError` observes the error before close, and each host recompiles its own prompts/filters | `git reset --hard refactor/L6` |
| L6.1 | `refactor/L6.1` | — | Done | Approved optimisation and robustness follow-ups: comment accuracy, `_systemMsg` and timer de-duplication, `buildSshCommand` option table, test helpers, build-sync guard, and four signed-off fixes (post-auth SSH timeout, guarded `close()`, empty-command skip, own-property SSH options) | 92 tests pass; the same 92 pass against the frozen baseline artifact with L6.1 expectations level-aware; `npm run check:build` and `npm run build` leave `lib/` in sync | `git reset --hard refactor/L6.1` |
| L7 | `refactor/L7` | — | Done | Tooling, docs, CI, and publish pipeline | 112 tests pass on the current build and the frozen baseline; `npm run check:build` passes; `npm pack --dry-run` contains only `lib/`, the README, and `package.json`; CI runs the suite on Node 18, 20, 22, and 24 | `git reset --hard refactor/L7` |
| L7.1 | `refactor/L7.1` | — | Done | Post-L7 fixes: drop the misspelled prompt aliases, document the `stream.Stream` base, and finish README reconciliation | 112 tests pass on the current build and the frozen baseline; the README discrepancy table is fully resolved; `npm pack --dry-run` still contains only `lib/`, the README, and `package.json` | `git reset --hard refactor/L7.1` |
| L7.2 | `refactor/L7.2` | — | Done | Pre-publish hardening: ISC `LICENSE`, Node requirement, complete `.env-example`, README example fixes, and the current `ssh2` lockfile | 112 tests pass on the current build and the frozen baseline; `npm pack --dry-run` contains `README.md`, `LICENSE`, `lib/`, and `package.json`; `npm audit` reports no vulnerabilities | `git reset --hard refactor/L7.2` |
| L7.3 | `refactor/L7.3` | — | Done | Trusted publishing workflow and maintainer guide | `publish.yml` uses GitHub OIDC (`id-token: write`) with no long-lived token; `docs/PUBLISHING.md` covers the npm trusted-publisher setup and the OTP fallback | `git reset --hard refactor/L7.3` |

Commit SHAs are deliberately omitted from this table: a commit cannot contain
its own hash. The annotated tags are the stable rollback references; use
`git rev-parse refactor/LN^{commit}` when a commit SHA is needed.

### L1 deliverables

- `test/unit/helpers/fake-ssh2.js` — deterministic fake `ssh2.Client` and shell
  stream; no network access.
- `test/unit/helpers/harness.js` — require-cache injection, host factory, wait
  helpers.
- `test/unit/*.test.js` — 57 tests covering the public surface, defaults,
  prompt/filter compilation, command flow, notifications, timeouts, sudo and
  nested-SSH prompts, host lifecycle, primary/secondary host chains, `_runExit`
  ordering, and SSH command construction/injection guards.
- `docs/API-BASELINE.md` — code-derived API inventory, host model, truthiness
  audit, `forceProtocolVersion` analysis, and every README mismatch found.
- `package.json` - `build`, `test`, and `test:unit` scripts.

### L2 deliverables

- `src/ssh2shell.js` — 1:1 port of the baseline CoffeeScript. Control flow,
  method binding order, messages, defaults, return values, and known quirks are
  preserved. The only structural difference is that it is a native ES class
  instead of CoffeeScript's prototype helper, so prototype methods are
  non-enumerable (internals, not public surface).
- `src/ssh2shell.coffee` — removed.
- `scripts/build.js` and `package.json` — `build` now copies
  `src/ssh2shell.js` to `lib/ssh2shell.js`.
- `package.json` / `package-lock.json` — removed the `coffee-script`
  devDependency; `engines.node` raised to `>=18.0.0`.
- `lib/ssh2shell.js` — rebuilt from the new source.
- `test/unit/port-semantics.test.js` — 4 tests that lock in the port's return
  values and the `newPrimaryHost` payload.
- `docs/API-BASELINE.md` — updated source-of-truth, `newPrimaryHost` payload,
  and build-command references.

### L3 deliverables

- `src/ssh2shell/util.js` — pure helpers: `typeIsArray`, `escapeRegex`,
  `shellQuote`, `shellControlChars`, `compileAsciiFilter`,
  `compileTextColorFilter`, and `compilePrompts`.
- `src/ssh2shell/defaults.js` — `applyHostDefaults`, the in-place host default
  application extracted from `_loadDefaults`.
- `src/ssh2shell/ssh-command.js` — `buildSshCommand`, the nested-host `ssh ...`
  command builder extracted from `_sshConnect`.
- `src/ssh2shell.js` — class facade now delegates to the modules. No control
  flow, message, default, return-value, or event changes.
- `scripts/build.js` — copies `src/ssh2shell.js` and the `src/ssh2shell/`
  module tree into `lib/`.
- `lib/ssh2shell.js` and `lib/ssh2shell/*` — rebuilt from source.

### L4 deliverables

- `src/ssh2shell.js` — consolidated module requires, `node:` core import,
  `??` instead of `!= null` ternaries, `slice` instead of the deprecated
  `substr`, and merged consecutive `debug` guards without changing message
  order.
- Dead code removed: the constructor's misspelled `newPrimmaryHost` listener
  (nothing emits that event), the duplicate `stderrData` removal in
  `_removeListeners`, the redundant `_previousHost` branch, and the unreachable
  `_runExit` reference at the end of `_nextPrimaryHost`.
- `src/ssh2shell/util.js` — `typeIsArray` now aliases the built-in
  `Array.isArray`; the legacy fallback is gone.
- `test/unit/hosts.test.js` — locks in that an empty primary queue leaves
  `_nextPrimaryHost` returning `undefined`; the same assertion accepts the
  baseline's implicit `_runExit` return when run in baseline mode. Also adds a
  characterization test for the known stale-secondary-handler bug.
- `test/fixtures/baseline-ssh2shell.js` — frozen L0 compiled artifact used as
  the dual-run target.
- `test/unit/helpers/harness.js` — `SSH2SHELL_TEST_MODULE` support and
  `isBaseline()`.
- `scripts/run-tests.js` and `package.json` — `test:src`, `test:lib`, and
  `test:baseline`; `test` now runs the build check, the lib suite, and the
  baseline suite.
- `lib/ssh2shell.js` and `lib/ssh2shell/*` — rebuilt from source.

### L5 deliverables

- `src/ssh2shell.js` — centralized `_systemMsg(type, message, object)` gate so
  `debug` and `verbose` messages are emitted only when their host flags are
  enabled, while normal messages are unaffected.
- `_loadDefaultListeners`, `_boundListener`, and `_detachListener` — default
  listeners are installed once, host listeners replace defaults, and both the
  cached handler and the current host handler are removed when a host is left.
  Reloading defaults no longer attaches duplicate handlers.
- Listener lifecycle across host changes — `_nextHost`, `_nextPrimaryHost`, and
  `_previousHost` detach the outgoing host's handlers. Backing out of a nested
  host no longer leaves a stale `commandComplete` (or similar) handler that
  fires against the new current host and duplicates `sessionText`.
- `this.host` is kept in sync when moving to the next nested host and the next
  primary host, so callback/session text starts with the correct host name.
- `keyboard-interactive` is registered and dispatched under the dashed event
  name, host handlers are honored, and the default handler calls
  `finish([''])` instead of stalling the handshake.
- Restored baseline payloads/defaults that the branch had changed accidentally:
  `commandComplete` emits the raw `_buffer`, `hostHash` is written to
  `sshObj.server.hostHash`, the legacy `msg: { send }` shape is mapped to
  `msg`, and the default keyboard response is an empty string.
- `test/unit/l5-behavior.test.js` — 10 tests covering debug/verbose gating,
  listener detach/reload behavior, `keyboard-interactive` dispatch and cleanup,
  raw `commandComplete`, `msg.send`, and `server.hostHash`.
- `test/unit/hosts.test.js` — the former known-bug characterization now asserts
  the signed-off result: the baseline leaves the stale handler attached, while
  L5 removes it.
- `test/unit/api-baseline.test.js` and `test/unit/prompts.test.js` — level-aware
  expectations for per-instance state, the renamed `_processSudoPrompt`, and
  baseline-only behavior.
- `lib/ssh2shell.js` and `lib/ssh2shell/*` — rebuilt from source.

### L6 deliverables (post-L5 signed-off fixes)

L6 collects the fixes signed off after the L5 tag. It changes observable
behavior only where the user explicitly approved it. The review that drove the
error-handling work is kept below for context.

#### Error-handling review

- `docs/ERROR-HANDLING.md` — maps every `error` emit site to its payload,
  `close` flag, follow-up flow, and connection/process outcome. It also records
  the default listener contract and findings F1-F11 (pre-shell close crash,
  L5 close-flag changes, ignored callbacks, listener accumulation, stale
  `_stream`, and related quirks).
- `test/unit/error-handling.test.js` — characterization tests that pass against
  both the current build and the frozen baseline, with level-aware expectations
  where the current behavior intentionally differs (close flags, callbacks,
  listener order and counts, stream reset).
- The review itself did not change source behavior. Its recommended fixes were
  signed off and are part of L6 (below).

#### Error-handling fixes

Signed-off-by: user review of `docs/ERROR-HANDLING.md`.

- `src/ssh2shell.js` — the default `error` listener only closes a live shell
  stream (`_hasLiveStream()`), so pre-shell errors cannot throw on the prototype
  `{}` placeholder (F1/F3).
- `src/ssh2shell.js` — Shell/Connection/Connection.connect errors classify by
  stream state: pre-shell they report with `close=false`; once a shell exists
  they terminate (F2).
- `src/ssh2shell.js` — the default listener invokes the optional callback before
  closing, with the shell as `this`, restoring timeout bookkeeping and
  missing-parameter diagnostics (F4).
- `src/ssh2shell.js` — the host `onError` is prepended so it runs before the
  default close (F5).
- `src/ssh2shell.js` — the default `error` listener is tracked separately and
  installed exactly once (F6).
- `src/ssh2shell.js` — `_nextPrimaryHost` resets `_stream` before each new
  primary host (F10).
- `src/ssh2shell.js` — the sudo timeout passes `this.connection`, not the
  never-assigned `this._connection` (F11).
- `test/unit/error-handling.test.js` — level-aware coverage for all of the above,
  including the new F5/F10/F11 tests.

#### Backlog fixes

Signed-off-by: user review of the backlog, before further error-handling work.

- `src/ssh2shell/defaults.js` — `window` and `pty` use nullish checks so an
  explicit `false` is preserved.
- `src/ssh2shell.js` — `_loadDefaults` maps `dataIdleTimeOut` to the internal
  `dataIdleTime`, with `dataIdleTime` as a fallback.
- `src/ssh2shell.js` — sudo password rejection is a debug `msg` notification,
  not an `error` event. The command is still cancelled with `Ctrl-C`.
- `src/ssh2shell/ssh-command.js` — `forceProtocolVersion` and
  `forceAddressType` map to allow-listed `ssh` flags. `true` selects `-2` / `-4`;
  invalid truthy values return a `Security Alert` error.
- `src/ssh2shell.js` — `_loadDefaults` recompiles prompt/filter regexes from the
  current `sshObj` on every call, so multi-host chains honour per-host config.
- `README.md` — removed `onPipe`/`onUnpipe` host handlers and the `.pipe` /
  `.unpipe` method/event documentation. `pipe` is a stream-level operation on
  the instance, not host config.
- `test/unit/api-baseline.test.js`, `test/unit/ssh-connect.test.js`,
  `test/unit/prompts.test.js`, and `test/unit/error-handling.test.js` — updated
  with level-aware expectations for the baseline and the fixed behavior.
- `docs/API-BASELINE.md` — records the fixes and the resolved per-host
  prompt/filter compilation requirement.

### L6.1 deliverables (approved optimisation and robustness follow-ups)

Signed-off-by: user selection of the optimisation review's "safe set + approved
behaviour fixes" option.

#### Behaviour-neutral cleanups

- `src/ssh2shell.js` — top-of-file and `_systemMsg` comments now describe the
  current build instead of the L1 baseline; removed the orphaned numbered
  "CRITICAL" comment and the stale "listeners defaults" comment.
- `src/ssh2shell.js` — `_systemMsg` merges its identical `debug` and `verbose`
  branches into one guarded block. Emitted messages are unchanged.
- `src/ssh2shell.js` — `_scheduleIdleTimeout(response)` replaces the three
  duplicated `commandTimeout` timer blocks in `_onData` and
  `_processSudoPrompt`.
- `src/ssh2shell/ssh-command.js` — `appendSshOption` plus an option-spec table
  replaces the seven repeated control-character guards. Error strings, order,
  and command output are unchanged.
- `test/unit/helpers/harness.js` — shared `processSudo` shim and
  `waitForStream` helper; the duplicated copies in the test files are removed.
- `test/unit/hosts.test.js` — the chain tests drop the default `msg` listener so
  expected host output no longer floods the test log.
- `scripts/check-build.js` and `package.json` — `check:build` verifies that
  `lib/` matches `src/`; `npm test` runs it before the suites, so a stale build
  cannot silently pass.

#### Behaviour fixes (signed off)

- `src/ssh2shell.js` — post-auth `_processSSHPrompt` output that matches no
  prompt now re-arms the idle timer instead of returning with no timer. A silent
  nested shell therefore times out rather than hanging.
- `src/ssh2shell.js` — `close()` is a no-op before a live shell stream exists,
  so calling it early no longer throws on the prototype `{}` placeholder.
- `src/ssh2shell.js` — `_processNotifications` skips an empty command and
  advances the queue instead of leaving the state machine idle.
- `src/ssh2shell/ssh-command.js` — custom `server.ssh.options` use own
  enumerable properties only, so inherited values cannot reach the command line.
- `test/unit/prompts.test.js`, `test/unit/errors.test.js`, and
  `test/unit/ssh-connect.test.js` — level-aware coverage for the four fixes.

#### Verification

- `npm test` — 92 tests pass on the current build and 92 on the frozen baseline
  artifact, with `check:build` confirming `lib/` is in sync first.
- `npm run build` — rebuilds `lib/` from `src/`.

### L7 deliverables (tooling, docs, CI, and publish)

No runtime behavior changes. The public API, events, and config remain as they
were after L6.1.

- `.github/workflows/ci.yml` — runs `npm ci`, `npm test`, and
  `npm pack --dry-run` on Node 18, 20, 22, and 24 for pushes to `master` /
  `Refactoring` and for pull requests.
- `scripts/run-tests.js` — discovers `*.test.js` files under `test/unit` and
  passes them explicitly to `node --test`, so the same runner works on Node 18
  as well as newer releases. `test:unit` now delegates to it as well.
- `package.json` — `files: ["lib"]` limits the published tarball to the runtime
  artifact (the README and `package.json` are always included), and
  `prepublishOnly` runs `npm test` so a stale build or failing baseline cannot
  be published.
- `docs/API-BASELINE.md` — verification commands include `npm pack --dry-run`;
  the README discrepancy table is fully resolved.
- `REFACTORING.md` — this L7 section and ledger row.
- The README itself is corrected by the project owner. The L7 README pass
  aligned the `stream.Stream` base, both `asciiFilter` examples, the `onError`
  close guidance, and the `emit` signature, so the discrepancy table is now
  fully resolved. The misspelled `passwordPromt` / `passphrasePromt` aliases
  were removed rather than documented (see the post-L7 entry in the backlog).

#### Verification

- `npm test` — 112 tests pass on the current build and 112 on the frozen
  baseline artifact, with `check:build` confirming `lib/` is in sync first.
- `npm pack --dry-run` — the tarball contains `README.md`, `lib/ssh2shell.js`,
  the three `lib/ssh2shell/*` helpers, and `package.json`.
- CI runs the same commands on Node 18, 20, 22, and 24.

### L7.1 deliverables (post-L7 fixes)

- `src/ssh2shell/defaults.js` — removed the misspelled `passwordPromt` /
  `passphrasePromt` fallbacks; only `passwordPrompt` and `passphrasePrompt`
  are read. The frozen baseline still honours the aliases, so
  `test/unit/api-baseline.test.js` is level-aware.
- `README.md` — documents the `stream.Stream` base and uses the tab-preserving
  `asciiFilter` default in both examples.
- `docs/API-BASELINE.md` — the README discrepancy table is fully resolved.

#### Verification

- `npm test` — 112 tests pass on the current build and 112 on the frozen
  baseline artifact, with `check:build` confirming `lib/` is in sync first.
- `npm pack --dry-run` — still only `README.md`, `lib/`, and `package.json`.

### L7.2 deliverables (pre-publish hardening)

- `LICENSE` — added the ISC license text declared by `package.json`; npm includes
  it automatically in the published tarball.
- `README.md` — states the Node.js 18 requirement, uses the current `idleTime`
  property in the timeout examples, and fixes the `apt-get` and prose typos.
- `.env-example` — lists every variable used by the live tests and the README
  examples, including the secondary user and nested hosts.
- `package-lock.json` — updated `ssh2` to `1.17.0` (still within the declared
  `^1.4.0` range) so CI exercises the same version users receive.
- `test/devtest.js` — targets `src/` like the other live scripts and throws a
  real error on timeout instead of calling an undefined `reject`.

#### Verification

- `npm test` — 112 tests pass on the current build and 112 on the frozen
  baseline artifact, with `check:build` confirming `lib/` is in sync first.
- `npm pack --dry-run` — `README.md`, `LICENSE`, `lib/ssh2shell.js`, the three
  `lib/ssh2shell/*` helpers, and `package.json`.
- `npm audit` — no vulnerabilities.

### L7.3 deliverables (trusted publishing)

- `.github/workflows/publish.yml` — publishes on `v*` tags, or manually for a
  specified tag, using GitHub OIDC (`id-token: write`) and no long-lived npm
  token. It runs `npm test` and `npm pack --dry-run` before `npm publish`.
- `docs/PUBLISHING.md` — npm trusted-publisher setup, the one-off `--otp`
  fallback, and the bypass-2FA stopgap.

## Backlog and future work

Items explicitly deferred until after the mechanical refactor. Each one changes
observable behavior or security posture and needs its own level and sign-off.

- **Audit the legacy live test scripts.** `test/*.js` still includes older
  example and development scripts such as `devtest.js`,
  `Config-poperties-test.js`, and `issue_69.js`. Review each one, keep and
  modernize the scenarios that still matter, and delete the rest. Decide which
  scenarios should become automated offline tests instead of manual live-host
  scripts.
- **Replace the nested-host `ssh ...` command string with chained `ssh2`
  connections.** Today `_sshConnect` builds a shell command (`ssh -x ...`) and
  types it into the current shell. Chaining `ssh2.Client` objects would avoid
  shell quoting, remove the dependency on a remote `ssh` binary, and make
  authentication/fingerprint handling consistent for nested hosts. This is the
  largest planned behavioral change and should be its own level with dedicated
  tests.
- **Done post-L5 (signed off):** map the documented `dataIdleTimeOut` to the
  internal `dataIdleTime` timer (default 500 ms). `dataIdleTimeOut` wins; the
  undocumented `dataIdleTime` remains as a fallback.
- **Done post-L5 (signed off):** audit truthiness-based defaults. `window` and
  `pty` now use nullish checks, so an explicit `false` survives.
- **Done post-L5 (signed off):** remove the documented `pipe`/`unpipe` surface
  from the README. They are stream-level operations on the instance, not host
  config or host events; the inherited `pipe` remains available.
- **Done post-L5 (signed off):** map `forceProtocolVersion` / `forceAddressType`
  to valid `ssh` flags (`-1` / `-2`, `-4` / `-6`). `true` selects `-2` / `-4`;
  invalid values return a `Security Alert` error.
- **Done at L4:** removed `_nextPrimaryHost`'s bare `@_runExit` reference as
  dead code; the normal back-out path is `_runExit` via `_previousHost`.
- **Done post-L5 (signed off):** sudo password rejection is a debug notification,
  not an `error` event. The command is cancelled and the session continues.
- **Done post-L5 (signed off):** resolve the error-handling findings in
  `docs/ERROR-HANDLING.md`. The default listener guards `_stream.close()`
  (F1/F3), Connection/Shell/Connection.connect errors classify by live stream
  state (F2), the optional callback runs before the close (F4), the host
  `onError` is prepended (F5), the default `error` listener is installed once
  (F6), `_stream` is reset per primary host (F10), and the sudo timeout passes
  `this.connection` (F11). F8 and F9 remain informational by design.
- **Done post-L5 (signed off):** compile prompts/filters per host, not once per
  instance. `_loadDefaults` rebuilds the compiled regexes from the current
  `sshObj` on every call. See
  [Per-host prompt/filter compilation](docs/API-BASELINE.md#per-host-promptfilter-compilation-resolved-post-l5).
- **Done post-L6.1 (signed off):** remove the L5-added verbose log in
  `_sanitizeResponse`. It re-printed the command-echo prefix on every prompt
  check, so verbose tunnel runs repeated bare command lines (`echo ...`, `exit`,
  `ssh ...`) and showed a stray `ss` prefix. The method now returns the
  sanitized response without logging, matching the baseline. Test:
  `test/unit/api-baseline.test.js` — "does not emit the command echo as a
  verbose message".
- **Done post-L6.1 (signed off):** hide credentials in debug/verbose output by
  default and add the per-host `exposeCredentials` opt-in. `_systemMsg` scrubs
  the configured password/passphrase from strings and masks credential keys in
  object dumps, so the sudo/nested-SSH password messages, the verbose
  `runCommand` echo, and the config dump show `[REDACTED]`. The frozen baseline
  still leaks the raw values; `test/unit/credentials.test.js` is level-aware.
  A live verbose tunnel run confirmed no plaintext password in the log and
  `[REDACTED]` in its place.
- **Done post-L6.1 (signed off):** let timer values be set on the instance
  (`SSH.idleTime` / `SSH.dataIdleTime`) without `_loadDefaults` replacing them
  with the hard-coded 5000 / 500 defaults. The first load captures the instance
  base; a host `idleTimeOut` / `dataIdleTimeOut` overrides it, and
  `_removeListeners` restores the base when leaving the host so a host-specific
  value does not leak into the next. `idleTime` is accepted as a legacy host
  alias. Non-positive/non-numeric values are treated as unset. Test:
  `test/unit/timers.test.js`.
- **Done post-L6.1 (signed off):** keep the default `msg` listener attached
  while hosts are swapped so `_systemMsg` output is not lost between
  `_removeListeners` and the next `_loadDefaults`. `_loadDefaults` now falls
  back to the stored default handler when a host has no `msg`. The live test
  scripts share `test/utils/logging.js` and run against `src/` so they can be
  used before a build. Tests: `test/unit/l5-behavior.test.js` — message-sink,
  duplicate-listener, and default-handler restoration cases.
- **Done post-L7 (signed off):** remove the misspelled `passwordPromt` and
  `passphrasePromt` fallbacks. Only `passwordPrompt` and `passphrasePrompt` are
  read now; the frozen baseline still honours the aliases.
  `test/unit/api-baseline.test.js` is level-aware for the difference.
- **Done at L5:** `_connections` and `sshObj` are assigned per instance in the
  constructor, so instances no longer share prototype state before `connect()`.
- **Done at L5:** the default `keyboard-interactive` handler now calls
  `finish([''])` (baseline default response) so the handshake cannot stall.
- **Done at L5:** multi-host `sessionText` duplication. `_previousHost` now
  removes the outgoing host's handlers, so no stale `commandComplete` (or
  similar) handler fires against the new current host.
  - Test: `test/unit/hosts.test.js` — "drops the secondary host
    commandComplete handler after backing out". The baseline branch still
    characterizes the old leak; the current branch asserts no stale handler.
  - Sign-off: remove stale handlers; each host's text appears once.

## Open items

These are sensible defaults until confirmed:

- **README reconciliation:** completed at L7.1/L7.2. The README is
  documentation, not a source of truth; it is corrected to match the code. The
  discrepancy table in
  [docs/API-BASELINE.md](docs/API-BASELINE.md#readme-vs-code-discrepancies) is
  fully resolved.
- **Node target:** `>=18` (applied at L2: `engines.node` is now `>=18.0.0`). CI
  exercises Node 18, 20, 22, and 24.
- **`lib/` artifact:** `lib/ssh2shell.js` stays committed and in sync; the
  published package contains only `lib/` (plus the README, `LICENSE`, and
  `package.json`), and `prepublishOnly` runs the full suite. There is no
  separate build-only publish flow.
- **Push policy:** keep levels local until you approve pushing to `origin`.
- **Live hosts:** not used; verification is offline per the decision above.
- **Behavior-changing fixes:** require explicit sign-off. L5 and L6 changes were
  approved; any remaining defect fixes still need their own sign-off.

## Environment snapshot (at baseline)

- Branch: `Refactoring` (identical to `master` at baseline)
- Version: `2.0.14`
- Source: `src/ssh2shell.coffee` (739 lines)
- Compiled: `lib/ssh2shell.js` (~1044 lines, in sync modulo line endings)
- Tests: 19 live integration scripts in `test/`, plus 57 offline unit tests in
  `test/unit/`; no CI yet
- Tooling: Node 26.13.0, npm 12.2.2, CoffeeScript 1.12.7
