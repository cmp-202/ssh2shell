# AI-assisted workflows

This file holds reusable prompts for common ssh2shell tasks. They are written
for an AI assistant with repository access. Each prompt points to the canonical
documents for detail and repeats only the boundaries that must hold while the
assistant is working.

Copy a prompt into a new session, fill the placeholders, and keep the assistant
read-only until you approve an action. Point-in-time state notes belong outside
the repository; only stable prompts that are useful to any contributor belong
here.

## Guardrails for every task

Apply these whether or not a prompt repeats them:

- Follow the session modes below. Local commits are allowed in agreed review
  cycles; no push, PR, tag, or publish without explicit user approval.
- Docs live in git. `README.md` stays concise; detail belongs in `docs/`.
- Line coverage is diagnostic, not a release gate. No coverage dependency and
  no CI line-coverage gate. `npm run typecheck` is a separate static-contract
  gate; it is not line coverage and produces no coverage percentage.
- Live tests count in CI. `publish` must not run unless the live suite passes.
- An external/free review of the release candidate is a release step; resolve
  its actionable findings before tagging, with user sign-off on every change.
  LongCat specifically is informational and quota-dependent, not a gate.
- Never dismiss a real CodeQL alert; fix the code.
- Merge continuously; no same-day follow-up release unless the fix is critical.
- Release only for a security/critical fix, user-facing bug fix, new feature,
  or explicit milestone. Docs/test/CI-only changes do not trigger a release.
- Before a task that depends on remote services, live hosts, or free models,
  run the environmental assessment below first.

## Session modes

Use the narrowest mode that matches the request. A stop for exploration ends
when the user explicitly asks to create or use a branch and implement changes.

1. **Read-only exploration** — inspect, review, compare, and report findings.
   Do not edit files, create commits, or change branches. This is the default
   when the user says “let’s look at this” or asks for a stop on repo activity.
2. **Branch implementation** — begins when the user asks to create or use a
   branch and make changes. Normal development applies: edit files, add new
   files, stage, commit locally in agreed review cycles, run checks, fix
   findings, and expand the implementation. Push, PR, tag, publish, and release
   remain blocked.
3. **Release and remote actions** — push, PR, tag, publish, or release only with
   explicit user approval. Same-day follow-up releases still follow the critical
   fix rule unless the user explicitly overrides it.

A read-only limit is not a permanent repository freeze. It protects the
exploration phase; once implementation on a branch is requested, do not keep
asking for permission for ordinary local development steps.

## Start or recover a session

```text
You are working in the ssh2shell repository. Start read-only.

1. Read README.md, CONTRIBUTING.md, docs/PUBLISHING.md, test/coverage.md, and
   docs/AI-ASSISTED-WORKFLOWS.md.
2. Report git status --short, the current branch, and the latest commit.
3. Summarise which document is the source of truth for the requested task.
4. Stay read-only until asked to create or use a branch and implement. Do not
   push, tag, or publish. Commit only in agreed review cycles, and ask before
   any action that changes remote state or release metadata.
```

## Set up the environment

```text
You are preparing to work on ssh2shell. Start read-only.

- Confirm Node.js 18 or newer is available.
- Run npm ci, then npm test.
- Live tests need reachable SSH hosts and a local .env. Copy .env-example to
  .env and follow test/README.md for host and key setup.
- Provisioning uses its own test/provision/.env (PROVISION_* variables); see
  test/provision/README.md. Check VM availability before either workflow.
- Report the Node version, the test result, and whether live tests can run here.
  Do not change .env, change VM power state, or provision hosts without
  approval.
```

## Assess environmental limitations

```text
Run this before any other prompt that depends on remote services, live hosts,
or free models. Start read-only. Do not change .env, install packages, provision
hosts, alter CI or configuration, or take any remote action without approval.

Check and record evidence for:

1. Toolchain: node, npm, git, and gh versions. Compare them with the versions
   the repository expects (CONTRIBUTING.md and .github/workflows/).
2. GitHub access: gh auth status and its token scopes, plus SSH auth to the git
   remote. Note any missing scope that would block PRs, releases, or workflow
   file edits via the API.
3. npm access: npm whoami and whether an auth token is configured. Publishing
   uses GitHub OIDC trusted publishing, so a local token is not required. If
   the trusted-publisher configuration on npmjs.com cannot be verified from
   here, say so explicitly rather than assuming it works.
4. Live configuration: whether the root .env has the expected host/key
   variables for live tests, and whether test/provision/.env has the
   PROVISION_* variables for the role being rebuilt. List names only, never
   values.
5. VM accessibility: probe SSH to the configured hosts (read-only) and, if a
   hypervisor CLI such as VirtualBox VBoxManage is available, list VMs and
   running VMs. Report which VMs are up and whether this machine can control
   them. Starting, stopping, or provisioning a VM needs explicit approval. If
   no control tooling exists, say VM availability is user-dependent and ask
   the user to confirm the VMs are running. CI starts its own sshd hosts and
   skips the live workflow for fork PRs.
6. Models: which free models are currently available and whether quotas are
   exhausted. LongCat is informational only and may be unavailable.
7. Local resources: temp directory, free disk, timezone, and anything else the
   planned commands need.

Report a table with columns: capability, evidence, affected prompt(s), impact,
mitigation. Finish by stating which prompts are safe to run here and which need
a decision first. Ask before substituting a model, changing configuration, or
taking a remote action.
```

## Verify before a pull request

```text
Run the full pre-PR verification for ssh2shell and report results only.

1. npm test (build check, unit, and baseline)
2. npm run test:live:all, or npm run test:live if told the change is local-only;
   say which set ran
3. npm run check:changelog
4. git diff --check
5. If code or tests changed, prepare the coverage summary from test/coverage.md:
   the text table, full miss-overlap table, missed by both headline, Node
   version, and commands. Keep raw LCOV files local.

Commit only in agreed review cycles; do not push or open the PR without
explicit approval.
```

## Add a live test

```text
I am adding a live test <name> for <behavior>. Follow test/README.md.

- Put the file in test/live/.
- Add per-test success checks in scripts/run-live.js where needed.
- Add the name to defaultTests only if it belongs in the curated batch;
  acceptance tests for a specific change can stay out.
- Verify with node scripts/run-live.js --list, then run the new test by name,
  then npm run test:live:all.
- Report whether it was added to the curated batch and why.
```

## Respond to a CodeQL or security alert

```text
A CodeQL/security alert was reported for ssh2shell. Do not dismiss it.

- Read the alert and locate the exact source line.
- Fix the code, not the alert configuration or a suppression.
- Add or update a test that would fail without the fix where practical.
- Re-run the relevant checks and report the result.
- Ask before changing CI or dependency configuration.
```

## Document a behavior change

```text
A change to <behavior> is ready. Keep README.md concise and put detail in docs/.

- Identify what changed for users.
- Update the relevant docs/ page and add a CHANGELOG entry under the correct
  version heading.
- If the release procedure is affected, update docs/PUBLISHING.md too.
- Run npm run check:changelog and report what changed.
```

## Add or update TypeScript declarations and JSDoc

```text
You are adding editor/type support to ssh2shell. Start read-only.

- Treat index.d.ts as a hand-maintained public contract derived from runtime
  code and documentation, not a generated artifact.
- Read README.md, docs/API-BASELINE.md, index.d.ts, package.json,
  src/ssh2shell.js, src/ssh2shell/defaults.js, src/ssh2shell/util.js, and the
  README-linked live tests before changing anything.
- Keep package.json `types` pointing at ./index.d.ts and keep index.d.ts in
  `files`. Do not add a TypeScript runtime dependency or build step. The
  dev-only TypeScript toolchain is checked by the `typecheck` script in CI and
  `prepublishOnly`.
- Add JSDoc typedef aliases and `// @ts-check` in src/ where they improve the
  public contract. Keep lib/ in sync with src/ through the repository's normal
  build/check process.
- Use import('ssh2shell') in consumer-facing docs. Inside README-linked live
  tests, use import('../../index') for module and HostConfig annotations so they
  resolve locally.
- Keep JSDoc @type tags immediately above the declaration they describe.
- Verify with `npm run typecheck`, npm test, git diff --check, and
  npm pack --dry-run when package metadata changed.
- Report the declared fields/signatures, docs that changed, and verification
  results. Commit only in agreed review cycles; do not push, open a PR, tag,
  publish, or release without explicit approval. Docs/test-only editor support
  does not trigger a release.
```

## Decide whether a fix needs a release

```text
Assess whether <change> requires a release now. Follow docs/PUBLISHING.md.

A release is triggered only by a security/critical fix, a user-facing bug fix,
a new feature, or an explicit milestone. Docs/test/CI-only changes do not
trigger one.

- Classify the change and state the reason.
- If a release is due, state the target version and bump type.
- If not, say it can wait for the next release.
- Apply the cadence rule: no same-day follow-up release unless the fix is
  critical.
- Do not bump versions, tag, or publish. Report the recommendation only.
```

## Prepare a release

```text
We are preparing release <version> of ssh2shell. Follow docs/PUBLISHING.md.

- Confirm the bump has an allowed reason: security/critical fix, user-facing
  bug fix, new feature, or explicit milestone. Docs/test/CI-only changes do not
  trigger a release.
- Run npm test, npm run test:live:all, npm run check:changelog, and
  git diff --check.
- Open a release PR from release/<version> to master. Include the coverage
  summary from test/coverage.md: the text table, the full miss-overlap table,
  missed by both as the residual headline, the Node version, and the commands.
  Leave raw LCOV files local.
- Stop after the PR is opened. Report the URL and check status. Do not tag or
  publish without a separate explicit approval.
```

## Review a release candidate

```text
Review the release candidate read-only. Do not modify files, commit, push,
tag, or publish.

- Candidate: <commit or PR>. Base: <commit>.
- Diff: git diff <base> <candidate> -- src lib test docs README.md CHANGELOG.md
- Focus on src/ssh2shell.js and src/ssh2shell/util.js; tests and docs are
  secondary.
- Report findings by severity with file:line and a concrete failure scenario.
  State "No findings" explicitly if there are none. Skip style nits.
- Return only the report. Any fix needs explicit user sign-off first.
```

Use a free model from the currently available model list. This is the RC review
required by docs/PUBLISHING.md: report actionable findings and wait for user
sign-off before changing code. A LongCat pass, when available, is informational
only; account-wide free quotas can make it unavailable.

## Refresh coverage evidence

```text
Refresh the coverage evidence for ssh2shell using test/coverage.md as the method.

- Run the unit and live commands from "Measurement method" with the LCOV
  reporters enabled. The live command runs every file in test/live/, matching
  npm run test:live:all and CI. Do not use NODE_V8_COVERAGE on the live suite.
- Recompute the miss-overlap table with the appendix parser in test/coverage.md.
  Keep the full table and use missed by both as the residual-risk headline.
- Update test/coverage.md and include the summary in the PR description or a
  PR comment. Raw LCOV files stay local.
- Never add a line-coverage dependency or a CI line-coverage gate. Line
  coverage is informational; the gates are CI checks, the live suite, typecheck,
  and RC review. `npm run typecheck` validates static contracts, not executed
  lines.
```

## Hand off a session

```text
Produce a handoff note for a replacement AI session. Keep it factual and
time-stamped, and do not store it in git.

Include:
- branch, base, and uncommitted changes;
- open PR number and check status;
- what was approved, what is paused, and the next gate;
- which docs and commands are authoritative;
- anything a new session would otherwise have to rediscover.
```
