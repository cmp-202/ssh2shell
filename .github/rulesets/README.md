# Repository rulesets

GitHub rulesets are defined by the JSON files in this directory. The files are
the source of truth for branch and tag protection; the GitHub UI is only where
they are applied.

| File | Target | Purpose |
| --- | --- | --- |
| `branch-master.json` | the default branch (`master`) | Require a pull request, the CI matrix, and the live suite before merge; block force pushes and deletion. |
| `tag-release.json` | tags matching `v*` | Only the repository owner can create, move, or delete release tags. |

## Importing

### GitHub UI

1. Go to **Settings → Rules → Rulesets**.
2. Click **New ruleset → Import a ruleset**.
3. Select one of the JSON files in this directory, review the rules, and click
   **Create**.

Repeat for the other file. Ruleset names must be unique in the repository.

### `gh` CLI

```bash
gh api --method POST repos/cmp-202/ssh2shell/rulesets \
  --input .github/rulesets/branch-master.json

gh api --method POST repos/cmp-202/ssh2shell/rulesets \
  --input .github/rulesets/tag-release.json
```

## What the rules assume

- Required checks use the workflow **job** names, not the workflow names:
  `Node 18.x`, `Node 20.x`, `Node 22.x`, and `Node 24.x` come from
  `.github/workflows/ci.yml`; `Live suite` comes from
  `.github/workflows/live.yml`. Renaming a job means updating
  `branch-master.json` as well.
- Fork pull requests skip the `Live suite` job because its setup and stop
  scripts run as root. GitHub reports a condition-skipped required check as
  satisfied, so a fork PR can merge without live coverage; same-repo PRs,
  pushes, schedules, and `workflow_call` still run it.
- `branch-master.json` has an empty bypass list, so direct pushes to `master`
  are blocked for everyone, including the owner. Changes go through a pull
  request. No approvals are required, but the checks must pass and review
  threads must be resolved.
- `tag-release.json` lets the owner (`cmp-202`, user id `8508800`) bypass the
  tag rules so a release tag can still be pushed. The bypass is tied to that
  user id, so check it if the repository changes hands.
- Tag protection uses `creation`, `non_fast_forward`, and `deletion`. For tags,
  blocking non-fast-forward updates is what prevents a tag from being moved.
  The `update` rule is branch-oriented and carries an
  `update_allows_fetch_and_merge` parameter that does not apply to tags.

## Updating

Applying a ruleset from a file does not link the two. After editing a file,
update the existing ruleset rather than creating a second one:

```bash
id=$(gh api repos/cmp-202/ssh2shell/rulesets \
  --jq '.[] | select(.name == "Protect master") | .id')

gh api --method PUT repos/cmp-202/ssh2shell/rulesets/$id \
  --input .github/rulesets/branch-master.json
```

## Related repository settings

These are not expressible as rulesets and are set in the repository UI:

- **About**: description, the website URL, and topics (`ssh`, `ssh2`, `nodejs`,
  `tunnelling`, `ssh-client`, `remote-execution`, `automation`, `npm-package`).
- **Features**: wiki off; discussions and projects optional.
- **Advanced Security**: CodeQL default setup, Dependabot alerts and security
  updates, secret scanning with push protection, and private vulnerability
  reporting.
- **Actions**: default workflow permissions read-only, approval required for
  fork pull requests, and Actions not allowed to create or approve pull requests.
