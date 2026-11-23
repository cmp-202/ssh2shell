# Contributing

## Before you start

- Use Node.js 18 or newer.
- For a bug, open an issue with the version, Node version, and a minimal
  reproduction. For a security problem, follow [SECURITY.md](./SECURITY.md)
  instead of opening a public issue.

## Set up

```bash
npm ci
npm test
```

`npm test` runs the build check, the unit suite, and the frozen baseline. The
live suite needs reachable SSH hosts; [test/README.md](./test/README.md)
documents the environment and the curated batch.

## Pull requests

- Branch from `master`. `master` requires a pull request, the CI matrix, and the
  live suite, so direct pushes are rejected.
- Keep the change focused, and update `README.md`, `docs/`, and `CHANGELOG.md`
  when behavior changes.
- Use `npm run test:live` for connection, command-flow, and hop changes. Run
  `npm run test:live:all` before a release.
- The release process is in [docs/PUBLISHING.md](./docs/PUBLISHING.md).

## AI-assisted work

Reusable prompts and the boundaries that apply to AI assistants are in
[docs/AI-ASSISTED-WORKFLOWS.md](./docs/AI-ASSISTED-WORKFLOWS.md). The approval
and release rules in that document apply to human contributors too.
