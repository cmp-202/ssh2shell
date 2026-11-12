'use strict';

// Runs the live tests in test/live/ against real hosts.
//
// The default batch covers the key use cases and is meant as a retest after a
// change. `--all` runs every live test; positional names run only those tests.
//
// Live tests only call `connect(callback)`, and a failed connection still
// reaches that callback with empty session text. The preloaded instrumentation
// in scripts/live-instrument.js records callback and error state so a test
// cannot pass on exit code alone.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const testDir = path.join(repoRoot, 'test', 'live');
const logDir = path.join(repoRoot, 'test', 'logs');
const instrumentPath = path.join(__dirname, 'live-instrument.js');
const modulePath = path.join(repoRoot, 'src', 'ssh2shell.js');
const resultPath = path.join(logDir, '.live-result.json');

// Load .env so the runner can build the same expectations the tests see.
try {
  require('dotenv').config({ path: path.join(repoRoot, '.env') });
} catch (error) {
  // .env is optional; tests that need it report their own missing values.
}

const env = process.env;
const user = env.USER_NAME || 'tester';
const secondUser = env.SECOND_USER || 'suuser';
const kbdUser = env.KBD_USER || 'kbduser';
const server1 = env.SERVER1_HOST || env.HOST;
const server2 = env.SERVER2_HOST;
const server3 = env.SERVER3_HOST;

// One representative test per key use case. `--all` and explicit names cover
// the rest without making the default run long.
const defaultTests = [
  'simple',
  'keyboard-interactive',
  'sudo_su',
  'sudo_no_pass',
  'prompt_response',
  'command_timeout',
  'multiple_primary_hosts',
  'tunnel',
  'chaining',
  'notifications',
  'lots_of_commands',
  'bash_script',
];

const allTests = fs
  .readdirSync(testDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
  .map((entry) => entry.name.slice(0, -3))
  .sort();

// Connection-level failures that should never appear in a passing run.
// Command timeouts are handled by the per-test allowErrors list instead.
const fatalLogMarkers = [
  'Timed out while waiting for handshake',
  'All configured authentication methods failed',
  'Cannot parse privateKey',
  'getaddrinfo ENOTFOUND',
  'ECONNREFUSED',
  'Security Alert',
  'SSH authentication failed',
  'SSH failed:',
];

// Per-test success checks. `contains`/`excludes` inspect the callback session
// text; `logContains`/`logExcludes` inspect the test log; `files` inspect the
// extra output files some tests write.
const checks = {
  simple: {
    contains: ['Filesystem', 'Mem:'],
  },
  private_key: {
    contains: [`\n${user}\n`],
  },
  'keyboard-interactive': {
    contains: [`\n${kbdUser}\n`],
  },
  fingerprint: {
    contains: [`\n${user}\n`],
  },
  sudo_su: {
    contains: ['root@', `\n${secondUser}\n`],
  },
  prompt_response: {
    contains: ['answer=y'],
  },
  command_timeout: {
    contains: ['answer=y'],
    allowErrors: ['Command Timeout'],
  },
  multiple_primary_hosts: {
    contains: [server1, server2].filter(Boolean),
  },
  tunnel: {
    contains: [server1, server2].filter(Boolean),
    excludes: ['SSH failed'],
  },
  chaining: {
    contains: [server1, server2, server3].filter(Boolean),
    excludes: ['SSH failed'],
  },
  notifications: {
    contains: ['Note: This line is added to sessionText only', '\n/tmp\n'],
    logContains: ['Note: Starting deployment'],
  },
  bash_script: {
    contains: ['./myscript.sh', 'rm myscript.sh'],
    excludes: ['No such file or directory', 'command not found', 'syntax error'],
  },
  lots_of_commands: {
    contains: ['command 60'],
    logContains: ['Completed 60 commands'],
  },
  ssh_user_command: {
    contains: ['ssh middle', 'OpenSSH'],
  },
  sudo_no_pass: {
    contains: ['\n0\n'],
    excludes: ['a password is required', 'Permission denied'],
  },
  timeout: {
    contains: ['First prompt to put valid input', 'Final unhandled time out'],
    logContains: ['Command timed out after'],
  },
  pipe: {
    files: [
      { name: 'pipe-first.log', contains: ['host pipe'] },
      { name: 'pipe-second.log', contains: ['host pipe'] },
    ],
  },
};

function parseArgs(argv) {
  const options = {
    all: false,
    list: false,
    help: false,
    verbose: false,
    timeoutMs: 180000,
    tests: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--all') {
      options.all = true;
    } else if (arg === '--list') {
      options.list = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--timeout') {
      index += 1;
      options.timeoutMs = parseTimeout(argv[index]);
    } else if (arg.startsWith('--timeout=')) {
      options.timeoutMs = parseTimeout(arg.slice('--timeout='.length));
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      options.tests.push(arg.replace(/\.js$/i, ''));
    }
  }

  return options;
}

function parseTimeout(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`Invalid timeout: ${value}`);
  }
  return seconds * 1000;
}

function usage() {
  return [
    'Usage: node scripts/run-live.js [options] [test ...]',
    '',
    'Runs live tests from test/ against the hosts in .env.',
    '',
    'Options:',
    '  --all             Run every live test instead of the curated batch.',
    '  --list            List the curated batch and all live tests.',
    '  --timeout <sec>   Per-test timeout in seconds (default: 180).',
    '  --verbose, -v     Print each test\'s captured output.',
    '  --help, -h        Show this help.',
    '',
    'Examples:',
    '  node scripts/run-live.js',
    '  node scripts/run-live.js simple tunnel chaining',
    '  node scripts/run-live.js --all',
  ].join('\n');
}

function listTests() {
  console.log(`Curated live batch (${defaultTests.length}):`);
  for (const name of defaultTests) {
    console.log(`  ${name}`);
  }

  console.log('');
  console.log(`All live tests (${allTests.length}):`);
  for (const name of allTests) {
    console.log(`  ${name}`);
  }
}

function normalize(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

function evaluate(name, result, logText) {
  const check = checks[name] || {};
  const sessionText = normalize(result.sessionText);
  const normalizedLog = normalize(logText);
  const failures = [];

  if (!result.callbackFired) {
    failures.push('connect callback did not run');
  }
  if (!result.sessionTextLength) {
    failures.push('callback session text is empty');
  }

  const allowedErrors = new Set(check.allowErrors || []);
  for (const error of result.errors || []) {
    if (!allowedErrors.has(error.type)) {
      failures.push(
        `error event${error.type ? ` (${error.type})` : ''}: ${error.message}`
      );
    }
  }

  for (const marker of fatalLogMarkers) {
    if (normalizedLog.includes(marker)) {
      failures.push(`fatal log marker: ${marker}`);
    }
  }

  for (const text of check.contains || []) {
    if (!sessionText.includes(text)) {
      failures.push(`session text missing: ${JSON.stringify(text)}`);
    }
  }
  for (const text of check.excludes || []) {
    if (sessionText.includes(text)) {
      failures.push(`session text contains: ${JSON.stringify(text)}`);
    }
  }
  for (const text of check.logContains || []) {
    if (!normalizedLog.includes(text)) {
      failures.push(`log missing: ${JSON.stringify(text)}`);
    }
  }
  for (const text of check.logExcludes || []) {
    if (normalizedLog.includes(text)) {
      failures.push(`log contains: ${JSON.stringify(text)}`);
    }
  }
  for (const file of check.files || []) {
    const filePath = path.join(logDir, file.name);
    if (!fs.existsSync(filePath)) {
      failures.push(`missing file: ${file.name}`);
      continue;
    }

    const content = normalize(fs.readFileSync(filePath, 'utf8'));
    for (const text of file.contains || []) {
      if (!content.includes(text)) {
        failures.push(`${file.name} missing: ${JSON.stringify(text)}`);
      }
    }
  }

  return failures;
}

function runTest(name, options) {
  const testFile = path.join(testDir, `${name}.js`);
  const logPath = path.join(logDir, `${name}.js.log`);

  if (!fs.existsSync(testFile)) {
    return Promise.resolve({
      name,
      status: 'FAIL',
      durationMs: 0,
      failures: [`test file not found: ${testFile}`],
      output: '',
      logPath,
    });
  }

  fs.mkdirSync(logDir, { recursive: true });

  // Remove stale artifacts so a crash cannot be mistaken for success.
  for (const file of [logPath, resultPath]) {
    try {
      fs.unlinkSync(file);
    } catch (error) {
      // The file was not there.
    }
  }

  return new Promise((resolve) => {
    const started = Date.now();
    let output = '';
    let timedOut = false;

    const child = spawn(
      process.execPath,
      ['--require', instrumentPath, testFile],
      {
        cwd: repoRoot,
        env: Object.assign({}, process.env, {
          SSH2SHELL_LIVE_MODULE: modulePath,
          SSH2SHELL_LIVE_RESULT: resultPath,
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    const capture = (chunk) => {
      output += chunk.toString();
      // Keep memory bounded for very chatty runs.
      if (output.length > 2000000) {
        output = output.slice(-1000000);
      }
    };

    child.stdout.on('data', capture);
    child.stderr.on('data', capture);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        name,
        status: 'FAIL',
        durationMs: Date.now() - started,
        failures: [error.message],
        output,
        logPath,
      });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);

      const failures = [];
      if (timedOut) {
        failures.push(`timed out after ${options.timeoutMs / 1000}s`);
      }
      if (code !== 0) {
        failures.push(
          `exit code ${code}${signal ? ` (signal ${signal})` : ''}`
        );
      }

      let result = null;
      try {
        result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
      } catch (error) {
        failures.push('instrumentation result missing');
      }

      let logText = '';
      try {
        logText = fs.readFileSync(logPath, 'utf8');
      } catch (error) {
        failures.push('test log missing');
      }

      if (result) {
        failures.push(...evaluate(name, result, logText));
      }

      resolve({
        name,
        status: failures.length === 0 ? 'PASS' : 'FAIL',
        durationMs: Date.now() - started,
        failures,
        output,
        logPath,
      });
    });
  });
}

function printResult(result, options) {
  const seconds = (result.durationMs / 1000).toFixed(1);
  console.log(`${result.status} ${result.name} (${seconds}s)`);

  for (const failure of result.failures) {
    console.log(`  - ${failure}`);
  }

  if (result.status === 'FAIL') {
    console.log(`  log: ${path.relative(repoRoot, result.logPath)}`);
  }

  if (options.verbose && result.output) {
    console.log('  ----- output -----');
    console.log(
      result.output
        .trimEnd()
        .split(/\r?\n/)
        .map((line) => `  ${line}`)
        .join('\n')
    );
    console.log('  ----- end output -----');
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(usage());
    return 0;
  }

  if (options.list) {
    listTests();
    return 0;
  }

  let selected;
  if (options.tests.length > 0) {
    selected = options.tests;
  } else if (options.all) {
    selected = allTests;
  } else {
    selected = defaultTests;
  }

  selected = [...new Set(selected)];

  const unknown = selected.filter((name) => !allTests.includes(name));
  if (unknown.length > 0) {
    console.error(`Unknown live test(s): ${unknown.join(', ')}`);
    console.error('Run with --list to see the available tests.');
    return 1;
  }

  console.log(
    `Running ${selected.length} live test(s), timeout ${options.timeoutMs / 1000}s`
  );
  console.log('');

  const results = [];
  for (const name of selected) {
    const result = await runTest(name, options);
    results.push(result);
    printResult(result, options);
  }

  const passed = results.filter((result) => result.status === 'PASS').length;
  const failed = results.length - passed;

  console.log('');
  console.log(`${passed} passed, ${failed} failed`);

  return failed === 0 ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
