var assert = require('assert');
var SSH2Shell = require('../lib/ssh2shell');

var config = {
  server: {
    host: 'example.invalid',
    userName: 'tester',
    port: 22,
    ssh: {
      options: {
        StrictHostKeyChecking: 'yes',
        UserKnownHostsFile: "/tmp/known hosts'quoted;touch /tmp/should-not-run"
      }
    }
  },
  commands: [],
  debug: false,
  verbose: false
};

var shell = new SSH2Shell(config);
shell.sshObj = config;
shell.sshObj.enter = '\n';

var captured = '';
shell._stream = {
  write: function (command) {
    captured = command;
  }
};

shell._sshConnect();

assert.notStrictEqual(
  captured.indexOf("-o 'StrictHostKeyChecking=yes'"),
  -1,
  'Documented ssh.options must appear in the generated SSH command'
);

assert.notStrictEqual(
  captured.indexOf("-o 'UserKnownHostsFile=/tmp/known hosts'\\''quoted;touch /tmp/should-not-run'"),
  -1,
  'SSH option values containing shell syntax must be safely single-quoted'
);

console.log('PASS: ssh.options is included');
