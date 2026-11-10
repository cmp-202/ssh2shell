# Publishing ssh2shell

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
# update REFACTORING.md / docs as needed
git add package.json package-lock.json REFACTORING.md docs
git commit -m "chore: release X.Y.Z"
git tag -a vX.Y.Z -m "X.Y.Z"
git push origin master
git push origin vX.Y.Z
```

The tag push triggers `.github/workflows/publish.yml`, which runs the full suite
and publishes with provenance.

To publish an existing tag manually, open **Actions → Publish to npm → Run
workflow**, choose `master`, and enter the tag (for example `v3.0.0`).

### 3. Verify

```bash
npm view ssh2shell version
npm view ssh2shell@X.Y.Z dist.tarball
```

## Stopgap: granular access token with bypass 2FA

If trusted publishing is not available, create a granular access token with:

- Read and write (publish and stage)
- Bypass 2FA enabled
- Access limited to the `ssh2shell` package
- A short expiry

Store it as the `NPM_TOKEN` secret in GitHub Actions and set
`NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` on the publish step. This is a
stopgap: direct publishing with bypass-2FA tokens is being removed in January
2027.

## Do not

- Do not commit `.npmrc` with a token.
- Do not store the TOTP secret in the repository or CI.
- Do not switch account 2FA to auth-only just to avoid the publish prompt; that
  weakens account security.
