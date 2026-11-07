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
- The class extends `Stream` and supports `connect(callback)`, `pipe`, `unpipe`.
- Public instance properties: `.sshObj`, `.command`.
- All documented events: `msg`, `data`, `stderrData`, `error`, `end`,
  `commandProcessing`, `commandComplete`, `commandTimeout`,
  `keyboard-interactive`.
- All documented host/config keys in `README.md`.
- Default prompts, filters, timeouts, and session-text behavior.

Internals (private `_methods`, file layout, helper functions) may change freely
as long as the contract above holds.

> Note: a bug fix that changes observable behavior conflicts with "strict"
> compatibility. Such fixes need explicit sign-off and must be recorded in the
> ledger as behavior changes, not silent cleanups.

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
| L2 | Port `src/ssh2shell.coffee` to JavaScript 1:1, same structure and logic | None |
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

## Open items

These are sensible defaults until confirmed:

- **Node target:** `>=18` (current `engines` says `>=4.5.0`).
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
- Tests: 19 live integration scripts in `test/`; no runner or CI
- Tooling: Node 26.13.0, npm 12.2.2, CoffeeScript 1.12.7
