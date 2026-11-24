import SSH2Shell = require('ssh2shell');

type HostConfig = import('ssh2shell').HostConfig;

const host: HostConfig = {
  server: { host: 'example.test', userName: 'user' },
  commands: ['whoami'],
  onCommandProcessing(command, response) {
    void response.includes('working');
  },
  onCommandComplete(command, response) {
    const missing = response.includes('not installed');
    this.stop(missing ? 'missing' : 'present');
  },
  onCommandTimeout(command, response) {
    void response.includes('prompt');
  },
  onData(data) {
    if (typeof data !== 'string') {
      void data.byteLength;
    }
  },
};

const ssh = new SSH2Shell(host);
const chained: SSH2Shell = ssh.stop('typecheck');
void chained;

ssh.on('commandComplete', (command, response) => {
  void response.includes('prompt');
});
