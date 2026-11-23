# Code coverage

This file records the current coverage measurement, how to read it, how the
unit and live suites overlap, and how to reproduce the numbers. Coverage is
diagnostic here, not a release gate.

## Current coverage (Node v26.13.0, measured 2026-11-23)

> **Snapshot note (2026-11-24):** these figures are the published `v4.1.0`
> baseline. The later test-only `hop_host_key.js` addition brings the live suite
> to 31 tests; coverage was not remeasured for that change, so the figures and
> miss-overlap table below are intentionally unchanged.

Measured with Node 26's built-in test coverage reporter against the current
build. Unit tests run against `lib/`; live tests run against `src/`. The live
run uses the default environment (`DEBUG` and `VERBOSE` unset), so
debug/verbose-only branches — including credential redaction — are not
exercised there; the unit suite covers them.

| Suite | Target | Lines | Branches | Functions |
| --- | --- | --- | --- | --- |
| Unit | `lib/ssh2shell.js` | 96.98% | 90.45% | 100% |
| Unit | `lib/ssh2shell/defaults.js` | 97.96% | 96.97% | 100% |
| Unit | `lib/ssh2shell/util.js` | 97.91% | 91.18% | 100% |
| Unit | all files | 97.07% | 90.81% | 100% |
| Combined (unit ∪ live) | all files | **98.15%** | — | — |
| Live | `src/ssh2shell.js` | 79.42% | 56.95% | 87.07% |
| Live | `src/ssh2shell/defaults.js` | 97.96% | 50.00% | 100% |
| Live | `src/ssh2shell/util.js` | 45.55% | 36.84% | 66.67% |
| Live | all files | 77.86% | 56.03% | 85.71% |

The `Combined` row is the union of hit lines from the two LCOV reports: 2912 of
2967 executable lines. Branch and function denominators differ between an
instrumented unit run and an instrumented live run, so only the line figure is
meaningful for the union. The current headline residual is **55 lines missed by
both**, unchanged by the release-candidate review fixes.

## How to read these numbers

### Where each suite is strongest

| Concern | Unit | Live |
| --- | --- | --- |
| Speed / determinism | Fast, offline, fake `ssh2` | Slow, needs the VMs |
| State machine and record stack | Strong | Moderate |
| Validation and error branches | Strong | Weak by nature |
| Credential redaction | Strong | Weak with default live environment |
| Real prompt/sudo/hop handshakes | Weak | Strong |
| Real stream timing and idle timeouts | Weak | Strong |
| TTY-gated progress indicator | Strong with a fake TTY sink | Only with an injected sink |

The suites are complementary: neither reaches a high line percentage alone,
and the union is what matters. New tests therefore go to the suite that can
prove the behavior most directly, rather than duplicating a case in both.

### Uncovered lines are ranges, not methods

The reporter lists uncovered **line ranges**, not uncovered methods. A method
can be entered on every test and still show a large uncovered count, because
that count is the number of lines in branches that were not taken. Grouping
those lines by enclosing method is a readability aid only: nested callbacks are
attributed to their enclosing method, and the last method in a file absorbs
everything after its start line. The percentages themselves are computed by the
reporter and are unaffected by this grouping.

## Miss overlap — how the suites relate

The useful comparison is not hit-set symmetry. It is which **missed** lines are
already covered by the other suite, and which remain missed by both. Because
`lib/ssh2shell.js` and `src/ssh2shell.js` are byte-identical builds (checked
with `npm run check:build`), line numbers are directly comparable.

| File | Executable lines | Missed by unit | Missed by live | Missed by both | Live covers unit miss | Unit covers live miss |
| --- | --- | --- | --- | --- | --- | --- |
| `ssh2shell.js` | 2678 | 81 | 551 | 49 | 32 | 502 |
| `defaults.js` | 98 | 2 | 2 | 2 | 0 | 0 |
| `util.js` | 191 | 4 | 104 | 4 | 0 | 100 |
| all files | 2967 | 87 | 657 | 55 | 32 | 602 |

What this means for test placement:

- **32 unit misses are already covered by live**: `close` 1900–1915,
  `_appendPartial` 639–645, `_removeListeners` 1989–1991 and 1998–2000, and
  `_prepareGracefulClose` 1818 and 1829–1830. These are shutdown paths. Adding
  unit copies would not improve combined coverage.
- **602 live misses are already covered by unit**, up from 522 before the
  review fixes. Most of that increase is the 100 redaction lines the default
  live run no longer hits, not newly added unit tests. The other large groups
  are `_openShell` (71), `_loadDefaults` (56), `_connect` (45),
  `_bindConnection` (25), module scope (24), and `_reportMissingParameters`
  (23). Adding live copies would not improve combined coverage.
- **55 lines are missed by both** — the residual-risk headline, unchanged by
  the review fixes and down from 206 before the second pass, 105 before the
  third, and 71 before the final pass. The combined hit-line union is 2912 of
  2967 lines (98.15%); the point of the split is to show where the remaining
  lines sit, not to optimise that percentage.

A few timer-driven unit tests are timing-sensitive, so branch percentages move
between runs. Observed range across runs, including this one: 90.45–90.71% for
`ssh2shell.js` and 90.78–90.91% across all files. Line coverage and every
overlap figure were stable.

### Residual missed-by-both lines (highest test value first)

Earlier passes closed the large defensive blocks in `_openShell`, `_connect`,
`_bindConnection`, `_previousHost`, `_checkCommand`, `_nextHost`, `_popTo`,
`_mergeNestedText`, `stop`, and `_beginStopExit`. The final pass closed
`_failContext`, `_forceClose`, half of `_onData`, and the redaction branches in
`util.js`. The review fixes shifted line numbers but did not change the
residual set. What remains is smaller and mostly defensive; coverage test work
for this round is finished.

Rows are ordered by how worthwhile a test would be, not by line count; the
`util.js` row has four lines but they are low-value defensive branches.

| Method | Lines missed by both | Best place to target |
| --- | --- | --- |
| `_endPrimary`, `_prepareGracefulClose` | 4 each: 602–603, 608–609 and 1808–1809, 1825–1826 | **Unit**, only if a specific behavior is at risk. |
| `_initiate` | 3: 2010–2011, 2016 | **Unit**: terminal-state guard. |
| other guards | 2 each across 18 methods and at module scope, plus `_onData` 890–891 | **Unit**, low priority. |
| `defaults.js` | 2: 43–44 | Low-value defensive branch. |
| `util.js` | 4: 44–45, 61–62 | Low-value defensive branches. |

These are documented as residual risk, not a queued task list. Adding tests for
them alone would assert guards and catch blocks without meaningful confidence.

## Measurement method

The repository has no coverage dependency. Node 26's built-in reporter was used
directly, so no packages or workflow changes are required to reproduce it.
Run `npm run build` before the unit command so `lib/` matches `src/`.

Unit tests (against the built `lib/`):

```sh
$env:SSH2SHELL_TEST_MODULE = (Resolve-Path 'lib/ssh2shell.js').Path
$unitFiles = Get-ChildItem -Recurse 'test/unit' -Filter '*.test.js' |
  ForEach-Object { $_.FullName } | Sort-Object
node --experimental-test-coverage --test `
  --test-reporter=spec --test-reporter-destination=stdout `
  --test-reporter=lcov --test-reporter-destination="$env:TEMP\unit.lcov" `
  $unitFiles
```

Live tests (against `src/`, which is what `scripts/run-live.js` defaults to).
The files must run serially because several use the same hosts/ports:

```sh
$env:SSH2SHELL_LIVE_MODULE = (Resolve-Path 'src/ssh2shell.js').Path
$liveFiles = Get-ChildItem 'test/live' -Filter '*.js' |
  ForEach-Object { $_.FullName } | Sort-Object
node --experimental-test-coverage --test --test-concurrency=1 `
  --test-reporter=spec --test-reporter-destination=stdout `
  --test-reporter=lcov --test-reporter-destination="$env:TEMP\live.lcov" `
  $liveFiles
```

This runs **every** file in `test/live/` — the same live tests run by
`npm run test:live:all` and the CI `Live suite` workflow. The curated batch from
`npm run test:live` is a local development shortcut and is **not** used for
these figures.

The overlap figures come from comparing `DA:` records in the two LCOV files as
per-file line sets. Paths are normalised to logical names (`ssh2shell.js`,
`defaults.js`, `util.js`). A compact parser is included at the end of this file
rather than added under `scripts/`, because the live half still needs the test
hosts.

Do **not** collect live coverage by setting `NODE_V8_COVERAGE` on
`npm run test:live:all`. That path slowed timing-sensitive tests enough to fail
four of them (including `chaining`, `close_from_handler`, and `command_timeout`)
even though the same tests pass under the standard reporter.

## History — baseline and follow-up work

Baseline numbers were measured on 2026-11-22 with Node v26.13.0, before the
follow-up tests. They are retained for comparison only; the current table at
the top of this file supersedes them. The baseline live `util.js` figure comes
from an earlier measurement context and is not directly comparable with the
current default-environment run.

| Suite | Target | Lines | Branches | Functions |
| --- | --- | --- | --- | --- |
| Unit | `lib/ssh2shell.js` | 90.30% | 80.87% | 98.29% |
| Unit | `lib/ssh2shell/defaults.js` | 97.96% | 96.97% | 100% |
| Unit | `lib/ssh2shell/util.js` | 94.77% | 84.48% | 100% |
| Unit | all files | 90.82% | 81.95% | 98.47% |
| Live (28 tests) | `src/ssh2shell.js` | 76.68% | 57.01% | 83.48% |
| Live (28 tests) | `src/ssh2shell/defaults.js` | 97.96% | 50.00% | 100% |
| Live (28 tests) | `src/ssh2shell/util.js` | 83.14% | 68.09% | 100% |
| Live (28 tests) | all files | 77.77% | 57.99% | 85.27% |

Follow-up work added 42 tests in six passes. Line numbers in these historical
descriptions shift with source edits; the current overlap table above is
authoritative.

| Pass | Tests | Targets | Where and why |
| --- | --- | --- | --- |
| First — `test/unit/coverage-gaps.test.js` | 3 | host `stderrData`/`end` binding, `msg` handler replacement, descendant collection | Unit: fake emitter and record stack assert registration directly. |
| First — live | 2: `default_command_timeout.js`, `progress_tty.js` | default command timeout, TTY-gated progress | Live: only real stalled commands and a TTY sink prove those paths. Both are registered in `scripts/run-live.js` and run in CI. |
| Second — `test/unit/coverage-gaps-state.test.js` | 12 | `_openShell`, `_connect`, `_bindConnection`, `_previousHost`, `_checkCommand` | Unit: fake sockets isolate transport and stale-record guards. Skipped against the baseline. |
| Third — `test/unit/coverage-gaps-flow.test.js` | 13 | `_nextHost`, `_popTo`, `_mergeNestedText`, `stop`, `_beginStopExit` | Unit: deterministic state-flow guards. Skipped against the baseline. |
| Final — `test/unit/behavior-hardening.test.js` | 5 | redaction safety, stale data, descendant teardown, forced close | Unit: behavior tests, not just line targets. Skipped against the baseline. |
| Review fixes — `test/unit/behavior-hardening.test.js` | 7 | class-instance redaction, override restore/clear, close-timer transition, cached-value restore, flag type | Unit: lock in the release-candidate findings. Skipped against the baseline. |

The file `behavior-hardening.test.js` now holds 12 tests (5 from the final pass
and 7 from the review fixes). Two candidates from the first review were
**not** added: the keyboard-interactive fallback is already covered by
`l5-behavior.test.js`, and the invalid-regex debug warnings are covered by
`api-baseline.test.js` and `prompt-regex.test.js`.

## Reporting coverage with a pull request

GitHub's native coverage reporting (public preview as of May 2026) wants a
Cobertura XML upload from CI via `actions/upload-code-coverage`. Node's built-in
reporter does not emit Cobertura, so that path needs a converter such as `c8`
with a Cobertura reporter. For this repository that is the wrong trade-off: the
live suite already runs in CI as a required check, but adding coverage
instrumentation to it creates timing risk, and coverage is diagnostic rather
than a gate.

The preferred approach is to generate coverage locally and include the summary
with the PR:

- Keep CI unchanged: unit checks in `ci.yml`, required live suite in `live.yml`,
  and no coverage collection or coverage gate.
- Before **any PR that changes code or tests**, including a release PR, run the
  two local commands above with the LCOV reporters enabled. Use the reporter
  path described here, not `NODE_V8_COVERAGE` on `npm run test:live:all`, which
  makes timing-sensitive tests flaky.
- Derive the miss-overlap table and remaining-target list from the two LCOV
  files. Keep the full table: it shows all four relationships between the
  suites, not just the headline.
- Put the text coverage table, the full miss-overlap table, `missed by both` as
  the residual-risk headline, the Node version, and the exact commands in the PR
  description or a PR comment. `unit covers live miss` is the progress metric
  while unit tests are still being added; once that work is done, `missed by
  both` is the adequate summary number. Raw LCOV files are large and stay out of
  the description unless a reviewer asks for them.
- Label the numbers informational. The real gates remain CI checks, the live
  suite, and release-candidate review.

This keeps live coverage evidence with the PR that proposes the change, avoids
a coverage dependency or Cobertura converter, and does not turn a timing-
sensitive local live run into a required check. The commands in this document
are the reproducible source of truth; no script has been added because the live
half cannot run on a generic CI runner, and no publishing-doc change is needed
because this is PR content, not a release step.

## Appendix: LCOV overlap calculation

```js
'use strict';
// node lcov-overlap.js unit.lcov live.lcov
const fs = require('node:fs');

function read(file) {
  const files = new Map();
  let name;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('SF:')) {
      name = line.slice(3).replace(/\\/g, '/').split('/').pop();
      files.set(name, { all: new Set(), hit: new Set() });
    } else if (line.startsWith('DA:')) {
      const [n, count] = line.slice(3).split(',');
      files.get(name).all.add(Number(n));
      if (Number(count) > 0) files.get(name).hit.add(Number(n));
    } else if (line === 'end_of_record') {
      name = undefined;
    }
  }
  return files;
}

const [unit, live] = process.argv.slice(2).map(read);
for (const name of new Set([...unit.keys(), ...live.keys()])) {
  const all = unit.get(name)?.all || live.get(name).all;
  const uh = unit.get(name)?.hit || new Set();
  const lh = live.get(name)?.hit || new Set();
  const unitMiss = new Set([...all].filter((n) => !uh.has(n)));
  const liveMiss = new Set([...all].filter((n) => !lh.has(n)));
  console.log(name, {
    executable: all.size,
    unitMiss: unitMiss.size,
    liveMiss: liveMiss.size,
    bothMiss: [...unitMiss].filter((n) => liveMiss.has(n)).length,
    liveCoversUnitMiss: [...unitMiss].filter((n) => lh.has(n)).length,
    unitCoversLiveMiss: [...liveMiss].filter((n) => uh.has(n)).length,
  });
}
```
