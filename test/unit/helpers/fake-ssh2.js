'use strict';

const { EventEmitter } = require('events');

/**
 * Minimal stand-in for the ssh2 shell stream used by ssh2shell.
 * Records writes and lets a test drive incoming data deterministically.
 */
class FakeStream extends EventEmitter {
  constructor() {
    super();
    this.writes = [];
    this.encoding = null;
    this.closed = false;
    this.stderr = new EventEmitter();
    this.onWrite = null;
  }

  setEncoding(encoding) {
    this.encoding = encoding;
    return this;
  }

  write(data) {
    this.writes.push(data);
    if (typeof this.onWrite === 'function') {
      this.onWrite(data, this);
    }
    return true;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.emit('finish');
    this.emit('close', 0, null);
  }

  receive(data) {
    this.emit('data', data);
  }

  stderrData(data) {
    this.stderr.emit('data', data);
  }
}

/**
 * Minimal stand-in for ssh2.Client. Emits connect/ready on the next tick,
 * then hands a FakeStream to the shell callback.
 */
class FakeClient extends EventEmitter {
  constructor() {
    super();
    this.config = null;
    this.shellCalls = [];
    this.ended = false;
    this.autoReady = true;
    this.onShell = null;
    this.stream = null;
  }

  connect(config) {
    this.config = config;
    if (!this.autoReady) return;
    process.nextTick(() => {
      this.emit('connect');
      this.emit('ready');
    });
  }

  shell(window, options, callback) {
    if (typeof window === 'function') {
      callback = window;
      window = undefined;
      options = undefined;
    } else if (typeof options === 'function') {
      callback = options;
      options = undefined;
    }

    this.shellCalls.push({ window, options });
    const stream = new FakeStream();
    this.stream = stream;

    if (typeof this.onShell === 'function') {
      this.onShell(stream, this);
    }

    process.nextTick(() => callback(null, stream));
    return stream;
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    process.nextTick(() => this.emit('close', false));
  }
}

module.exports = {
  Client: FakeClient,
  FakeClient,
  FakeStream,
};
