# Publishing ssh2shell

## Release cadence

Merge work to `master` continuously through pull requests and let a batch of
changes settle. A green merge is **not** a release event; it is fine for `master`
to be ahead of npm `latest`.

Release only on a trigger:

- a security or critical fix,
- a user-facing bug fix,
- a new feature,
- or a milestone explicitly called by the maintainer.

Test-only, docs-only, and CI-only changes do not trigger a release on their own.
They ride along with the next triggered release. Do not publish a version solely
to deliver internal work.

Before tagging, run the external/free review against the **release candidate**
(the release branch or the merge commit on `master`), not against an already
published tag. Fix its actionable findings in the same release. Avoid a
same-day follow-up release unless the issue is critical.

## One-off interactive publish

`npm publish` requires a one-time password when 2FA is enabled:

```bash
npm login
npm whoami
npm publish --otp=<6-digit-code>
```

If npm prints a browser URL, open it, authenticate, and retry.

## Recommended: trusted publishing from GitHub Actions

Trusted publishing uses GitHub OIDC, so there is no long-lived npm token and no
OTP prompt.

### 1. Configure the trusted publisher

On npmjs.com:

1. Open the `ssh2shell` package.
2. Go to **Settings → Trusted Publishers → Add a publisher**.
3. Choose **GitHub Actions**.
4. Owner: `cmp-202`
5. Repository: `ssh2shell`
6. Workflow filename: `publish.yml`
7. Allowed action: select **npm publish**. Select **npm stage publish** instead
   if you want a maintainer to approve each release.
8. Save.

Or from the CLI, run interactively with 2FA:

```bash
npm trust github ssh2shell \
  --file publish.yml \
  --repo cmp-202/ssh2shell \
  --allow-publish \
  -y
```

### 2. Publish a release

For a new version:

```bash
npm version <major|minor|patch> --no-git-tag-version
git switch -c release/X.Y.Z
```

Update the changelog in a fixed order:

1. Insert `## [X.Y.Z] - YYYY-MM-DD` above the existing `## [Unreleased]`
   section. Move the release's `###` groups and bullets under it, remove empty
   groups, and leave `[Unreleased]` in place for future work.
2. Add `[X.Y.Z]: https://github.com/cmp-202/ssh2shell/compare/vPREVIOUS...vX.Y.Z`
   to the link definitions at the bottom.
3. Point the existing `[Unreleased]` link at `compare/vX.Y.Z...HEAD`.
4. Run `npm run check:changelog`. It fails if the version, date, bullets, or
   compare links are missing. `prepublishOnly` runs it again alongside
   `npm run typecheck` and `npm test`.

Then update `REFACTORING.md` and any other affected docs, and push the branch:

```bash
git add package.json package-lock.json REFACTORING.md CHANGELOG.md docs
git commit -m "chore: release X.Y.Z"
git push -u origin release/X.Y.Z
```

Open a pull request and merge it once CI and the live suite pass. `master` is
protected by `.github/rulesets/branch-master.json`, so the release commit cannot
be pushed directly. Then tag the merge commit:

```bash
git switch master
git pull --ff-only
git tag -a vX.Y.Z -m "X.Y.Z"
git push origin vX.Y.Z
```

The tag push triggers `.github/workflows/publish.yml`, which runs the live suite
(`live.yml`), the offline suite, and publishes with provenance. The publish job
does not start unless the live suite passes. Tags are protected by
`.github/rulesets/tag-release.json`; the owner bypass in that ruleset is what
allows the tag to be pushed.

To publish an existing tag manually, open **Actions → Publish to npm → Run
workflow**, choose `master`, and enter the tag (for example `vX.Y.Z`).

### 3. Verify

```bash
npm view ssh2shell version
npm view ssh2shell@X.Y.Z dist.tarball
```

The registry can take a minute or two (sometimes longer) to show the new
`latest` after the workflow succeeds. If the first check still shows the old
version, retry for a few minutes before treating it as a failed publish. Confirm
the published `gitHead` matches the release commit:

```bash
npm view ssh2shell@X.Y.Z gitHead
git rev-parse HEAD
```

### 4. Release checklist

Run this list for every release so the steps that are easy to forget are not
left to memory.

- [ ] Confirm a release trigger exists (security/critical fix, user-facing fix,
      feature, or an explicitly called milestone). Do not release test/docs/CI
      work on its own.
- [ ] Decide the semver level from the commits since the last tag.
- [ ] Run the external/free review on the release candidate and resolve its
      actionable findings in the same release.
- [ ] `npm version <major|minor|patch> --no-git-tag-version`.
- [ ] Move `[Unreleased]` entries under a dated version heading, add its compare
      link, and update the `[Unreleased]` link.
- [ ] Update `REFACTORING.md` and any docs affected by the release.
- [ ] `npm run check:changelog` passes.
- [ ] `npm run typecheck` passes (sources, annotated live tests, and strict
      consumer fixtures under node16 and nodenext).
- [ ] `npm test` passes (`check:build`, unit, baseline).
- [ ] Run the live suite locally when the change touches connection or command
      flow: `npm run test:live:all`.
- [ ] Commit `chore: release X.Y.Z` on a `release/X.Y.Z` branch and open a pull
      request.
- [ ] The **CI** and **Live tests** workflows pass on the pull request.
- [ ] Merge the pull request, then tag the merge commit `vX.Y.Z` and push the
      tag.
- [ ] The **Publish to npm** workflow succeeds.
- [ ] `npm view ssh2shell version` and the `gitHead` check above pass.
- [ ] Create a GitHub Release for `vX.Y.Z` with notes for the new features and
      fixes.
- [ ] Check the workflow actions for deprecated runtimes (for example
      `actions/checkout` and `actions/setup-node` on Node 20) and bump them.

## Stopgap: granular access token with bypass 2FA

If trusted publishing is not available, create a granular access token with:

- Read and write (publish and stage)
- Bypass 2FA enabled
- Access limited to the `ssh2shell` package
- A short expiry

Store it as the `NPM_TOKEN` secret in GitHub Actions and set
`NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` on the publish step. This is a
stopgap: direct publishing with bypass-2FA tokens is being removed in January 2027.

## Do not

- Do not commit `.npmrc` with a token.
- Do not store the TOTP secret in the repository or CI.
- Do not switch account 2FA to auth-only just to avoid the publish prompt; that
  weakens account security.
