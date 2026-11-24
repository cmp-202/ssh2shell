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
    // noinspection JSCheckFunctionSignatures
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
 * Minimal stand-in for an ssh2 direct-tcpip channel. A hop hands this to the
 * child client as its `sock`.
 */
class FakeChannel extends EventEmitter {
  constructor() {
    super();
    this.closed = false;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
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
    // `forwardOut` support for hop tests. A test can set `forwardOutError` to
    // fail the channel request or `forwardOutDelay` to keep it pending.
    this.forwardOutCalls = [];
    this.forwardOutError = null;
    this.forwardOutDelay = false;
    this.forwardOutCallback = null;
    this.channel = null;
  }

  connect(config) {
    this.config = config;
    if (!this.autoReady) return;
    process.nextTick(() => {
      this.emit('connect');
      this.emit('ready');
    });
  }

  forwardOut(srcIP, srcPort, dstIP, dstPort, callback) {
    this.forwardOutCalls.push({ srcIP, srcPort, dstIP, dstPort });

    if (this.forwardOutDelay) {
      this.forwardOutCallback = callback;
      return;
    }

    const channel = new FakeChannel();
    this.channel = channel;
    process.nextTick(() => {
      if (this.forwardOutError) {
        callback(this.forwardOutError);
        return;
      }
      callback(null, channel);
    });
  }

  // Completes a pending `forwardOut` request. Used by tests that need to stop
  // or close while the channel request is in flight.
  // noinspection JSUnusedGlobalSymbols
  completeForwardOut(err = null) {
    if (typeof this.forwardOutCallback !== 'function') {
      return null;
    }
    const callback = this.forwardOutCallback;
    this.forwardOutCallback = null;
    const channel = new FakeChannel();
    this.channel = channel;
    callback(err, err ? undefined : channel);
    return channel;
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
    // noinspection JSCheckFunctionSignatures
    process.nextTick(() => this.emit('close', false));
  }
}

module.exports = {
  Client: FakeClient,
  FakeClient,
  FakeChannel,
  FakeStream,
};
