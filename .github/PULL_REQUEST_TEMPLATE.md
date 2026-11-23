## What changed

<!-- One or two sentences. Link the issue if there is one. -->

## Why

<!-- The problem this solves or the behavior it changes. -->

## How it was tested

<!-- Commands you ran and the result, for example `npm test` or
`npm run test:live`. Say which tests you did not run. -->

## Checklist

- [ ] `npm test` passes (build check, unit, and baseline).
- [ ] Live tests run when the change touches connections, command flow, or
      hops (`npm run test:live` or `npm run test:live:all`).
- [ ] `README.md` and `docs/` are updated for user-visible changes.
- [ ] `CHANGELOG.md` has an entry under `Unreleased`.
- [ ] No removed 3.x API is used (`server.ssh`, `exitCommands`,
      `sshToNextHost`).
