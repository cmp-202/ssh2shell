# Code coverage

This file records the coverage review, how it was measured, what the numbers
mean, the follow-up tests added, and where the unit and live suites overlap in
what they miss. Coverage is a diagnostic here, not a release gate.

## Measurement method

The repository has no coverage dependency. Node 26's built-in reporter was used
directly, so no packages or workflow changes are required to reproduce it.

Unit tests (run against the built `lib/`):

```sh
$env:SSH2SHELL_TEST_MODULE = (Resolve-Path 'lib/ssh2shell.js').Path
$files = Get-ChildItem -Recurse 'test/unit' -Filter '*.test.js' |
  ForEach-Object { $_.FullName } | Sort-Object
node --experimental-test-coverage --test $files
```

Live tests (run against `src/`, which is what `scripts/run-live.js` defaults to).
The files must run serially because several use the same hosts/ports:

```sh
$env:SSH2SHELL_LIVE_MODULE = (Resolve-Path 'src/ssh2shell.js').Path
$files = Get-ChildItem 'test/live' -Filter '*.js' |
  ForEach-Object { $_.FullName } | Sort-Object
node --experimental-test-coverage --test --test-concurrency=1 $files
```

To compare the suites, ask Node for LCOV as well as the text report:

```sh
node --experimental-test-coverage --test `
  --test-reporter=spec --test-reporter-destination=stdout `
  --test-reporter=lcov --test-reporter-destination="$env:TEMP\unit.lcov" `
  $files
```

Repeat for the live command with `$env:TEMP\live.lcov`. The two LCOV files can
be parsed for hit lines and misses to produce the overlap analysis below.
This is deliberately not a script: the live half needs the test hosts, and a
wrapper would only duplicate the commands above. The summary is written into the
PR description by hand, and the raw LCOV files stay local unless a reviewer asks
for them.

Do **not** collect live coverage by setting `NODE_V8_COVERAGE` on
`npm run test:live:all`. That path slowed timing-sensitive tests enough to fail
four of them (`chaining`, `close_from_handler`, `command_timeout`, plus one
other) even though the same tests pass under the standard reporter.

## First review — baseline numbers

Measured on 2026-11-22 with Node v26.13.0, before the follow-up tests below.

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

### How to read "uncovered lines"

The reporter lists uncovered **line ranges**, not uncovered methods. A method
can be entered on every test and still show a large count, because the count is
the number of lines in branches that were not taken. Examples from the first
review:

- Live `_loadDefaults`: 56 uncovered lines out of roughly 187 in the method.
  The method runs on every test; the misses are conditional branches — the
  direct-call context fallback, `msg` listener rebinding, invalid-regex debug
  warnings, host `onError` / `onData` / `onStderrData` binding, and the default
  keyboard-interactive handler.
- Unit `_openShell`: 29 uncovered lines, almost all transport error handling.
- Unit `_connect`: 23 uncovered lines, mostly the `forwardOut` cancellation
  path.
- Unit `_reportMissingParameters`: fully covered by unit tests; the 23 live
  uncovered lines belong to a branch the live suite never exercises.

Grouping uncovered lines by enclosing method is a readability aid only. Nested
callbacks are attributed to their enclosing method, and the last method in the
file absorbs everything after its start line. The percentages themselves are
computed correctly by the reporter and are not affected by this.

## Where each suite is strongest

| Concern | Unit | Live |
| --- | --- | --- |
| Speed / determinism | Fast, offline, fake `ssh2` | Slow, needs the VMs |
| State machine and record stack | Strong | Moderate |
| Validation and error branches | Strong | Weak by nature |
| Credential redaction | Strong | Weak |
| Real prompt/sudo/hop handshakes | Weak | Strong |
| Real stream timing and idle timeouts | Weak | Strong |
| TTY-gated progress indicator | Strong with a fake TTY sink | Only with an injected sink |

The suites are complementary: neither reaches a high line percentage alone, and
the union is what matters. New tests therefore go to the suite that can prove
the behaviour most directly, rather than duplicating a case in both.

## Follow-up tests (implemented)

The follow-up work was done in four passes. The first pass added the unit and
live tests below. The second and third passes added deterministic unit tests
for the largest blocks still missed by both suites after each preceding pass.
The final pass added five behaviour-focused tests for genuine failure modes.
Lower-priority defensive branches are deliberately left alone.

Two candidates from the first review were **not** added: the keyboard-interactive
fallback is already covered by `l5-behavior.test.js`, and the invalid-regex
debug warnings are covered by `api-baseline.test.js` and `prompt-regex.test.js`.
Duplicating them would not improve the overlap.

### First pass — unit: `test/unit/coverage-gaps.test.js`

| Test | Gap addressed | Why unit |
| --- | --- | --- |
| binds host `stderrData` and `end` handlers | `_loadDefaults` lines 2206–2207 and 2209–2210 in `src/ssh2shell.js` | The fake emitter can assert listener registration and invocation directly. |
| replaces a previous host `msg` handler when defaults reload | `_loadDefaults` lines 2107–2109 | Reloading defaults on the same record is deterministic and needs no connection. |
| collects active and nested descendants, excluding closed records | `_descendantsOf` lines 488–489, 494–495, 499–505 | The record stack is directly constructible; live hops cannot isolate these branches. |

### First pass — live

| Test | Gap addressed | Why live |
| --- | --- | --- |
| `default_command_timeout.js` — no host `onCommandTimeout`, real idle timeout | `_defaultOnCommandTimeout`, 29 uncovered lines in the first live review (`src/ssh2shell.js` lines 2034–2063) | Only a real stalled command proves the default error/close path end to end. |
| `progress_tty.js` — injected TTY-like sink and slow commands on two primary hosts | `_progressStart`, `_progressTick`, `_progressLabel`, `_progressNewline`, `_progressEnd` (`src/ssh2shell.js` lines 695–780) | Progress is TTY-gated and timer-driven; the normal piped runner cannot exercise it. |

Both live tests are registered in `scripts/run-live.js` checks and in the
curated default batch, so they run under `npm run test:live`,
`npm run test:live:all`, and CI.

### Second pass — unit: `test/unit/coverage-gaps-state.test.js`

These 12 tests target the five largest blocks that remained missed by both
suites after the first pass. Each test is skipped against the frozen baseline
because the record/transport guards do not exist there.

| Coverage area | Lines targeted | Tests |
| --- | --- | --- |
| `_openShell` (29 lines) | 2535–2543, 2581–2582, 2589, 2594–2595, 2611–2625 | Stale-context stream close, ignored stale stream error, hop stream error, stale stderr guard, throwing `data` listener on a primary and on a hop. |
| `_connect` (23 lines) | 2280–2281, 2316–2318, 2331–2332, 2342–2357 | Stopped-run guard, hop without a parent connection, stale `forwardOut` channel close, stop during `forwardOut`. |
| `_bindConnection` (21 lines) | 2419–2420, 2436–2437, 2444–2445, 2453–2454, 2471–2473, 2507–2509, 2511–2517 | Closed-context keyboard-interactive/connect/ready/error guards, inactive active-context guard, and hop failure containment. |
| `_previousHost` (16 lines) | 1499–1500, 1514–1527 | Stopped-run guard and manual parent-stack restore. |
| `_checkCommand` (9 lines) | 1323–1324, 1327–1328, 1335–1339 | Closing, stopping, and no-command exit paths. |

### Third pass — unit: `test/unit/coverage-gaps-flow.test.js`

These 13 tests target the next five rows in the missed-by-both table. Like the
second pass, they are skipped against the frozen baseline.

| Coverage area | Lines targeted | Tests |
| --- | --- | --- |
| `_nextHost` (8 lines) | 1534–1535, 1542–1545, 1551–1552 | Stopping/complete guards, no active record, and no pending hosts. |
| `_popTo` (7 lines) | 467–468, 472–474, 480–481 | No record, dropping a failed record with descendants, and no parent to restore. |
| `_mergeNestedText` (7 lines) | 1395–1396, 1398–1399, 1413, 1424–1425 | Missing stack/server, duplicate merge, stacked-host parent lookup, and no distinct parent. |
| `stop` (7 lines) | 1673–1674, 1683, 1690–1691, 1694–1695 | Clearing active/ancestor queues and the configured host when no record is active. |
| `_beginStopExit` (5 lines) | 1725–1726, 1731–1733 | Already-complete guard and deferred exit for an in-flight command. |

### Final pass — unit: `test/unit/behavior-hardening.test.js`

These five tests are behaviour tests, not coverage tests: they lock in failure
modes that matter even if the lines happen to be hit elsewhere. They are skipped
against the frozen baseline.

| Test | Lines targeted | Why it matters |
| --- | --- | --- |
| marks circular references in redacted config dumps | `util.js` 138–139 | A cyclic host config must not crash a verbose dump. |
| preserves non-plain objects in redacted config dumps | `util.js` 132, 134–135 | Streams and buffers must survive redaction by identity. |
| ignores data received after close or after the active host changes | 875–876, 931–932 | Late data and stale idle timers must not process a command. |
| closes descendants before a failed record | 561–563 | An ancestor failure must not leave live descendants behind. |
| forces a close when the close timer fires | 1826, 1834–1837 | Shutdown fallback when a stream close stalls. |

## Coverage after the follow-up tests

Measured with the same Node and commands as the first review. Counts are shown
for the unit and live text reports respectively. The `Combined` row is the union
of hit lines from both LCOV reports (2874 of 2929 executable lines). Branch and
function denominators differ between an instrumented unit run and an
instrumented live run, so only a line figure is meaningful for the union.

The live numbers are unchanged from the first pass; the second, third, and
final passes added only unit tests.

| Suite | Target | Lines | Branches | Functions |
| --- | --- | --- | --- | --- |
| Unit (222 tests) | `lib/ssh2shell.js` | 96.95% | 90.71% | 100% |
| Unit (222 tests) | `lib/ssh2shell/defaults.js` | 97.96% | 96.97% | 100% |
| Unit (222 tests) | `lib/ssh2shell/util.js` | 97.67% | 89.66% | 100% |
| Unit (222 tests) | all files | 97.03% | 90.91% | 100% |
| Combined (unit ∪ live) | all files | **98.12%** | — | — |
| Live (30 tests) | `src/ssh2shell.js` | 79.47% | 58.64% | 87.07% |
| Live (30 tests) | `src/ssh2shell/defaults.js` | 97.96% | 50.00% | 100% |
| Live (30 tests) | `src/ssh2shell/util.js` | 83.14% | 68.09% | 100% |
| Live (30 tests) | all files | 80.30% | 59.43% | 88.46% |

The targeted gaps closed:

- First-pass unit tests hit lines 2107–2109, 2206–2207, 2209–2210, 488–489,
  494–495, and 499–505. Line coverage rose from 90.30% to 91.05% and branch
  coverage from 80.87% to 82.30%.
- First-pass live tests hit the default timeout and TTY progress paths. Line
  coverage rose from 76.68% to 79.47%, branch coverage from 57.01% to 58.64%,
  and function coverage from 83.48% to 87.07%.
- Second-pass unit tests closed the five largest missed-by-both blocks:
  `_openShell` (29 lines), `_connect` (23), `_bindConnection` (21),
  `_previousHost` (16), and `_checkCommand` (9). Unit `ssh2shell.js` line
  coverage rose from 91.05% to 94.85% and branch coverage from 82.30% to
  86.33%.
- Third-pass unit tests closed the next five rows: `_nextHost` (8 lines),
  `_popTo` (7), `_mergeNestedText` (7), `stop` (7), and `_beginStopExit` (5).
  Unit `ssh2shell.js` line coverage rose from 94.85% to about 96.1% and branch
  coverage from 86.33% to about 90%.
- Final-pass unit tests covered the redaction safety branches and the stale
  data, descendant-teardown, and forced-close paths. Unit `ssh2shell.js` line
  coverage rose to 96.95%, `util.js` to 97.67%, and function coverage reached
  100% across all files. Branch figures vary slightly between runs; see the
  variance note below.

## Miss overlap — how the suites relate

The useful comparison is not hit-set symmetry. It is which **missed** lines are
already covered by the other suite, and which lines remain missed by both.
Because `lib/ssh2shell.js` and `src/ssh2shell.js` are byte-identical builds,
line numbers are directly comparable.

| File | Executable lines | Missed by unit | Missed by live | Missed by both | Live covers unit miss | Unit covers live miss |
| --- | --- | --- | --- | --- | --- | --- |
| `ssh2shell.js` | 2659 | 81 | 546 | 49 | 32 | 497 |
| `defaults.js` | 98 | 2 | 2 | 2 | 0 | 0 |
| `util.js` | 172 | 4 | 29 | 4 | 0 | 25 |
| all files | 2929 | 87 | 577 | 55 | 32 | 522 |

What this means for test placement:

- **32 unit misses are already covered by live**: `close` 1881–1896,
  `_appendPartial` 624–630, `_removeListeners` 1970–1972 and 1979–1981, and
  `_prepareGracefulClose` 1799 and 1810–1811. These are shutdown paths. Adding
  unit copies would not improve combined coverage.
- **522 live misses are already covered by unit**, up from 371 before the
  second pass, 472 before the third, and 506 before the final pass. The largest
  groups are `_openShell` (73), `_loadDefaults` (56), `_connect` (45),
  `_bindConnection` (25), module scope (24), and `_reportMissingParameters`
  (23). Adding live copies of these branches would not improve combined
  coverage.
- **55 lines are missed by both** — the headline residual figure, down from 206
  before the second pass, 105 before the third, and 71 before the final pass.
  That is the residual target set, listed below. The combined hit-line union is
  2874 of 2929 lines (98.12%); the point of the split is to show where the
  remaining lines sit, not to optimise that percentage.

A note on variance: a few timer-driven unit tests are timing-sensitive, so
branch percentages move between runs. Across four repeated runs, line coverage
and every overlap figure were identical; only branch percentage varied
(90.56–90.71% for `ssh2shell.js`, 90.78–90.91% across all files). The numbers
above come from one representative run.

### Missed-by-both lines, highest value first

Line ranges are from `src/ssh2shell.js` and apply to the identical `lib/` build.
Method attribution is the same rough enclosing-method grouping described
earlier: nested callbacks are attributed to their enclosing method.

The large blocks from the second and third passes are now closed, and the final
pass closed `_failContext`, `_forceClose`, half of `_onData`, and the redaction
branches in `util.js`. What remains is smaller and mostly defensive. Coverage
test work for this round is finished; no further tests are planned.

| Method | Lines missed by both | Best place to target |
| --- | --- | --- |
| `_endPrimary`, `_prepareGracefulClose` | 4 each | **Unit**, only if a specific behaviour is at risk. |
| `_initiate` | 3: 1991–1992, 1997 | **Unit**: terminal-state guard. |
| other guards | 2 each across 18 methods and at module scope, plus `_onData` 875–876 | **Unit**, low priority. |
| `defaults.js` | 2: 43–44 | Low-value defensive branch. |
| `util.js` | 4: 44–45, 61–62 | Low-value defensive branches. |

These are documented as residual risk, not as a queued task list. Adding tests
for them alone would assert guards and catch blocks without meaningful
confidence.

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
- Before a release PR, run the two local commands above (unit against `lib/`,
  live against `src/`) with the LCOV reporters enabled. Use the reporter path
  described here, not `NODE_V8_COVERAGE` on `npm run test:live:all`, which makes
  timing-sensitive tests flaky.
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
