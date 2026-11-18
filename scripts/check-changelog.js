'use strict';

// Fails when a version is about to ship without a matching CHANGELOG entry.
// Run in CI on every pull request and again from `prepublishOnly`, so a release
// branch cannot bump package.json without documenting the release.

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const packagePath = path.join(repoRoot, 'package.json');
const changelogPath = path.join(repoRoot, 'CHANGELOG.md');

const version = JSON.parse(fs.readFileSync(packagePath, 'utf8')).version;
const changelog = fs.readFileSync(changelogPath, 'utf8').replace(/\r\n?/g, '\n');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const errors = [];

if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) {
  errors.push(`package.json has an unsupported version: ${version}`);
}

if (!/^## \[Unreleased\]\s*$/m.test(changelog)) {
  errors.push('CHANGELOG.md is missing a "## [Unreleased]" section');
}

const heading = new RegExp(
  `^## \\[${escapeRegExp(version)}\\] - (\\d{4}-\\d{2}-\\d{2})\\s*$`,
  'm'
);
const match = changelog.match(heading);

if (!match) {
  errors.push(
    `CHANGELOG.md is missing a dated "## [${version}] - YYYY-MM-DD" heading`
  );
} else {
  const start = match.index + match[0].length;
  const next = changelog.indexOf('\n## [', start);
  const section = changelog.slice(start, next === -1 ? undefined : next);

  if (!/^\s*[-*] \S/m.test(section)) {
    errors.push(`the ${version} changelog section has no bullet entries`);
  }
}

const versionLink = new RegExp(
  `^\\[${escapeRegExp(version)}\\]: https://github\\.com/cmp-202/ssh2shell/compare/\\S+`,
  'm'
);
if (!versionLink.test(changelog)) {
  errors.push(`CHANGELOG.md is missing a compare link for [${version}]`);
}

const unreleasedLink = new RegExp(
  `^\\[Unreleased\\]: https://github\\.com/cmp-202/ssh2shell/compare/v${escapeRegExp(
    version
  )}\\.\\.\\.HEAD\\s*$`,
  'm'
);
if (!unreleasedLink.test(changelog)) {
  errors.push(
    `[Unreleased] must compare from v${version} to HEAD (update it when you bump the version)`
  );
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`changelog check failed: ${error}`);
  }
  process.exit(1);
}

console.log(`changelog OK for ${version}`);
