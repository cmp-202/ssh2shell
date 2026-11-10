'use strict';

// Fail when lib/ no longer matches src/. The unit suite loads lib/ssh2shell.js,
// so a stale build would silently test the previous source.

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'src');
const libDir = path.join(root, 'lib');

function filesUnder(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory()
      ? filesUnder(full, base)
      : [path.relative(base, full)];
  });
}

const srcFiles = filesUnder(srcDir).sort();
const libFiles = filesUnder(libDir).sort();
const problems = [];

for (const file of srcFiles) {
  const src = path.join(srcDir, file);
  const lib = path.join(libDir, file);

  if (!fs.existsSync(lib)) {
    problems.push(`${file}: missing from lib/`);
    continue;
  }
  if (!fs.readFileSync(src).equals(fs.readFileSync(lib))) {
    problems.push(`${file}: out of sync`);
  }
}

for (const file of libFiles) {
  if (!srcFiles.includes(file)) {
    problems.push(`${file}: not present in src/`);
  }
}

if (problems.length > 0) {
  console.error('lib/ is out of sync with src/:');
  for (const problem of problems) {
    console.error(`  ${problem}`);
  }
  console.error('Run `npm run build` and commit the result.');
  process.exitCode = 1;
} else {
  console.log('lib/ is in sync with src/');
}
