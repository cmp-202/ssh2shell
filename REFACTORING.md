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
| Verification | Offline unit harness with a mocked `ssh2` (live hosts not required) |
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
2. Characterization/unit tests pass.
3. `lib/ssh2shell.js` is rebuilt and in sync (until L6 changes the publish flow).
4. Public API/event smoke checks pass.
5. `REFACTORING.md` ledger row is updated.
6. Commit created and annotated tag `refactor/LN` applied.
7. `git status` is clean.

## Level ladder (proposed, adjustable)

| Level | Goal | Behavior change |
| --- | --- | --- |
| L0 | Baseline: tag pristine `v2.0.14`, add this ledger | None |
| L1 | Offline safety net: mocked-`ssh2` harness and characterization tests | None |
| L2 | Port `src/ssh2shell.coffee` to JavaScript 1:1, same structure and logic; remove the CoffeeScript source and toolchain | None |
| L3 | Split into focused modules behind the existing class facade | None |
| L4 | Modernize syntax and clean up dead code, typos, duplication | None |
| L5 | Fix defects and security issues, each covered by a test | Only with sign-off |
| L6 | Tooling, docs, CI, and publish pipeline | None |

The ladder can be reordered or split as we learn more; any change to the plan
must be recorded here.

## Ledger

| Level | Tag | Commit | Status | Goal | Verification | Rollback |
| --- | --- | --- | --- | --- | --- | --- |
| L0 | `refactor/L0-baseline` | `43ab187` | Done | Tag pristine `v2.0.14` and add this ledger | Baseline tag points at the unmodified release commit | `git reset --hard refactor/L0-baseline` |
| L1 | `refactor/L1` | - | Done | Offline `ssh2` mock and 57 characterization tests | `npm run test:unit` passes; `npm run build` leaves `lib/` in sync | `git reset --hard refactor/L1` |
| L2 | `refactor/L2` | — | Done | 1:1 JavaScript port; CoffeeScript source and toolchain removed | 61 tests pass against the port (57 baseline characterizations plus 4 port-semantics tests); baseline-vs-port comparison matches defaults, prototype surface, SSH command construction, return values, and event payloads; `npm run build` leaves `lib/` in sync | `git reset --hard refactor/L2` |
| L3 | `refactor/L3` | — | Done | Split pure helpers into focused modules behind the existing class facade | 61 tests pass unchanged; baseline-vs-port comparison still matches; `npm run build` copies the module tree and leaves `lib/` in sync | `git reset --hard refactor/L3` |
| L4 | `refactor/L4` | — | Done | Modernize syntax and remove dead code, duplication, and obsolete compatibility shims | 61 tests pass unchanged; baseline-vs-port comparison still matches; `npm run build` leaves `lib/` in sync | `git reset --hard refactor/L4` |

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
  `_nextPrimaryHost` returning `undefined`.
- `lib/ssh2shell.js` and `lib/ssh2shell/*` — rebuilt from source.

## Backlog and future work

Items explicitly deferred until after the mechanical refactor. Each one changes
observable behavior or security posture and needs its own level and sign-off.

- **Replace the nested-host `ssh ...` command string with chained `ssh2`
  connections.** Today `_sshConnect` builds a shell command (`ssh -x ...`) and
  types it into the current shell. Chaining `ssh2.Client` objects would avoid
  shell quoting, remove the dependency on a remote `ssh` binary, and make
  authentication/fingerprint handling consistent for nested hosts. This is the
  largest planned behavioral change and should be its own level with dedicated
  tests.
- **Map the documented `dataIdleTimeOut` to the internal `dataIdleTime` timer**
  (default 500 ms). The internal variable keeps its name; the public key should
  be `dataIdleTimeOut`, optionally accepting the undocumented `dataIdleTime` as
  a fallback.
- **Audit truthiness-based defaults.** `window` and `pty` currently force an
  explicit `false` back to `true`; use nullish/undefined checks so `false`
  survives. Keep this audit for any new boolean host property.
- **Add or remove the documented `unpipe` surface** so docs and code agree.
  README reconciliation is deferred to L6; the refactor levels stay code-only.
- **Correct `forceProtocolVersion` / `forceAddressType`** so values map to valid
  `ssh` flags (`-1` / `-2`, `-4` / `-6`) instead of being appended literally.
- **Done at L4:** removed `_nextPrimaryHost`'s bare `@_runExit` reference as
  dead code; the normal back-out path is `_runExit` via `_previousHost`.
- **Remove prototype-shared `_connections` / `sshObj` state.**
- **Emit sudo authentication errors regardless of `debug`.**
- **Compile prompts/filters per host, not once per instance.**
- **Make `keyboard-interactive` call `finish(prompts)` when no host handler is
  supplied.**
- **Known multi-host `sessionText` duplication.** When a connection moves to
  another host, an event handler that appends `sessionText` to the final output
  is not removed, so the final session text can repeat earlier host text and
  grow with each host change. This has not been reported as an issue. It needs
  a characterization test against the original code first, then a fix with
  explicit sign-off on the expected final text.

## Open items

These are sensible defaults until confirmed:

- **README reconciliation:** deferred to L6. The README is documentation, not a
  source of truth; it is corrected to match the code as a separate tidy-up, not
  used to drive code changes.
- **Node target:** `>=18` (applied at L2: `engines.node` is now `>=18.0.0`).
- **`lib/` artifact:** keep `lib/ssh2shell.js` committed and in sync during the
  refactor; decide whether it becomes build-only at L6.
- **Push policy:** keep levels local until you approve pushing to `origin`.
- **Live hosts:** not used; verification is offline per the decision above.
- **Behavior-changing fixes:** require explicit sign-off before L5.

## Environment snapshot (at baseline)

- Branch: `Refactoring` (identical to `master` at baseline)
- Version: `2.0.14`
- Source: `src/ssh2shell.coffee` (739 lines)
- Compiled: `lib/ssh2shell.js` (~1044 lines, in sync modulo line endings)
- Tests: 19 live integration scripts in `test/`, plus 57 offline unit tests in
  `test/unit/`; no CI yet
- Tooling: Node 26.13.0, npm 12.2.2, CoffeeScript 1.12.7
