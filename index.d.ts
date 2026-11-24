// Public TypeScript declarations for ssh2shell 4.x.
// The runtime package is plain CommonJS JavaScript; this file describes the
// public surface without adding a build step or runtime dependency.

declare class SSH2Shell {
  /**
   * Create a runner for one host or for several independent primary hosts.
   * Each host needs a `server` object and a `commands` array.
   */
  constructor(
    hosts: SSH2Shell.HostConfig | ReadonlyArray<SSH2Shell.HostConfig>
  );

  /** The active host object, including runtime state added during a run. */
  sshObj: SSH2Shell.HostConfig;
  /** The command currently being processed. */
  command: string;
  /** Active command timeout in milliseconds. Default: 5000. */
  idleTime: number;
  /** Active response-settling delay in milliseconds. Default: 500. */
  dataIdleTime: number;
  /** Effective debug flag; assigning sets a run-wide override. */
  debug: boolean;
  /** Effective verbose flag; assigning sets a run-wide override. */
  verbose: boolean;

  /** Connect and optionally receive the combined session text at the end. */
  connect(callback?: (sessionText: string) => void): boolean;
  /** Stop the run early with an optional reason label. */
  stop(reason?: string): unknown;
  /** Close the active connection; `graceful` backs out of nested shells. */
  close(options?: SSH2Shell.CloseOptions): unknown;
  /** Emit a structured message on the `msg` or `debug`/`verbose` channel. */
  systemMsg(type: string, message: string, object?: unknown): void;

  on<E extends keyof SSH2Shell.EventMap>(
    event: E,
    listener: (this: SSH2Shell, ...args: SSH2Shell.EventMap[E]) => void
  ): this;
  on(event: string, listener: (...args: any[]) => void): this;

  addListener<E extends keyof SSH2Shell.EventMap>(
    event: E,
    listener: (this: SSH2Shell, ...args: SSH2Shell.EventMap[E]) => void
  ): this;
  addListener(event: string, listener: (...args: any[]) => void): this;

  once<E extends keyof SSH2Shell.EventMap>(
    event: E,
    listener: (this: SSH2Shell, ...args: SSH2Shell.EventMap[E]) => void
  ): this;
  once(event: string, listener: (...args: any[]) => void): this;

  removeListener<E extends keyof SSH2Shell.EventMap>(
    event: E,
    listener: (this: SSH2Shell, ...args: SSH2Shell.EventMap[E]) => void
  ): this;
  removeListener(event: string, listener: (...args: any[]) => void): this;

  removeAllListeners(event?: keyof SSH2Shell.EventMap | string): this;
  emit(event: keyof SSH2Shell.EventMap | string, ...args: any[]): boolean;
  pipe<T>(destination: T, options?: unknown): T;
}

declare namespace SSH2Shell {
  /**
   * Connection options passed to `ssh2.Client.connect()`.
   *
   * `ssh2shell` validates only that `server` exists and contains `host` or
   * `hostname`. Other values are passed through to `ssh2`, which reports
   * invalid options through the shell's error handlers.
   *
   * @see https://github.com/cmp-202/ssh2shell#server
   */
  interface ServerConfig {
    /** Host name or IP address. Required unless `hostname` is supplied. */
    host?: string;
    /** ssh2's alternative spelling of `host`. */
    hostname?: string;
    /** SSH port. Default: `22`. */
    port?: number | string;
    /** Login name. Required for authentication. */
    userName?: string;
    /** ssh2's native spelling of `userName`. */
    username?: string;
    /** Password authentication. */
    password?: string;
    /** Private key contents, usually from `fs.readFileSync()`. */
    privateKey?: string | Uint8Array;
    /** Passphrase for `privateKey`. ssh2's native `passphrase` also works. */
    passPhrase?: string;
    /** ssh2's native spelling of `passPhrase`. */
    passphrase?: string;
    /** Enable keyboard-interactive authentication. Default: `false`. */
    tryKeyboard?: boolean;
    /** Hash algorithm used to verify the server key, for example `sha256`. */
    hostHash?: string;
    /** Receives the hashed key when `hostHash` is set; use it to pin hosts. */
    hostVerifier?: HostVerifier;
    /** ssh2 cipher, compression, hmac, kex, and server host key overrides. */
    algorithms?: Record<string, unknown>;
    /** Any other option accepted by `ssh2.Client.connect()`. */
    [option: string]: unknown;
  }

  /** Callback used to accept or reject a server host key. */
  interface HostVerifier {
    /**
     * @param hashedKey The hashed key produced with `hostHash`.
     * @param verify Call with `false` to reject, `true` to accept.
     * @returns Returning `false` also rejects the key.
     */
    (
      hashedKey: string,
      verify: (permitted: boolean) => void
    ): boolean | void;
  }

  /** The live shell stream passed to command handlers. */
  interface ShellStream {
    write(data: string | Uint8Array, encoding?: string): boolean;
    close(): void;
    on(event: string, listener: (...args: any[]) => void): this;
    [property: string]: unknown;
  }

  /** The ssh2 connection, used for `forwardOut` hops and diagnostics. */
  interface SSHConnection {
    connect(options: Record<string, unknown>): void;
    /**
     * Open a forwarded TCP channel for a nested host. The private key stays
     * in this process; the jump host only forwards bytes.
     */
    forwardOut(
      sourceIP: string,
      sourcePort: number,
      destinationIP: string,
      destinationPort: number,
      callback: (error: Error | null, stream?: ShellStream) => void
    ): void;
    on(event: string, listener: (...args: any[]) => void): this;
    [property: string]: unknown;
  }

  /** Extra values supplied with the `commandComplete` event. */
  interface CommandCompleteDetails {
    /** Always the unprocessed response buffer. */
    rawResponse: string | Uint8Array;
    /** Captured stderr when `captureStderr` is enabled. */
    stderr?: string;
    [property: string]: unknown;
  }

  /** Timeout bookkeeping supplied with the `commandTimeout` event. */
  interface TimeoutDetails {
    /** Current attempt, starting at 1. */
    attempt: number;
    /** `commandTimeoutRetries`, or 0 for a single attempt. */
    maxRetries: number;
    /** True on the final attempt, when the default handler closes. */
    final: boolean;
  }

  /** One prompt from a keyboard-interactive authentication request. */
  interface KeyboardInteractivePrompt {
    prompt: string;
    echo: boolean;
  }

  /** Finish a keyboard-interactive exchange with one response per prompt. */
  type KeyboardInteractiveFinish = (responses: string[]) => void;
  /**
   * Called before the default error handling closes the connection. `close`
   * reports whether that planned close is about to happen.
   */
  type ErrorCallback = (
    this: SSH2Shell,
    error: unknown,
    type: string,
    close?: boolean | null
  ) => void;

  /** Handles per-host `msg` notifications. */
  type MessageHandler = (this: SSH2Shell, message: unknown) => void;
  /** Handles raw shell or stderr data for a host. */
  type DataHandler = (
    this: SSH2Shell,
    data: string | Uint8Array
  ) => void;
  /** Runs while output arrives, before prompt detection completes a command. */
  type CommandProcessingHandler = (
    this: SSH2Shell,
    command: string,
    response: string | Uint8Array,
    host: HostConfig,
    stream: ShellStream
  ) => void;
  /** Runs when a command returns to the prompt. */
  type CommandCompleteHandler = (
    this: SSH2Shell,
    command: string,
    response: string | Uint8Array,
    host: HostConfig,
    details: CommandCompleteDetails
  ) => void;
  /** Runs when no prompt is detected before `idleTimeOut`. */
  type CommandTimeoutHandler = (
    this: SSH2Shell,
    command: string,
    response: string | Uint8Array,
    stream: ShellStream,
    connection: SSHConnection,
    details: TimeoutDetails
  ) => void;
  /** Runs when a host session finishes. */
  type EndHandler = (
    this: SSH2Shell,
    sessionText: string,
    host: HostConfig
  ) => void;
  /** Runs before the default error handler; `close` reports planned closure. */
  type ErrorHandler = (
    this: SSH2Shell,
    error: unknown,
    type: string,
    close?: boolean | null,
    callback?: ErrorCallback,
    context?: unknown
  ) => void;
  /** Answers a keyboard-interactive authentication challenge. */
  type KeyboardInteractiveHandler = (
    this: SSH2Shell,
    name: string,
    instructions: string,
    instructionsLanguage: string,
    prompts: KeyboardInteractivePrompt[],
    finish: KeyboardInteractiveFinish
  ) => void;

  /** Instance event names mapped to their listener argument tuples. */
  interface EventMap {
    msg: [unknown];
    data: [string | Uint8Array];
    stderrData: [string | Uint8Array];
    commandProcessing: [string, string | Uint8Array, HostConfig, ShellStream];
    commandComplete: [
      string,
      string | Uint8Array,
      HostConfig,
      CommandCompleteDetails
    ];
    commandTimeout: [
      string,
      string | Uint8Array,
      ShellStream,
      SSHConnection,
      TimeoutDetails
    ];
    end: [string, HostConfig];
    error: [
      unknown,
      string,
      (boolean | null)?,
      ErrorCallback?,
      unknown?
    ];
    'keyboard-interactive': [
      string,
      string,
      string,
      KeyboardInteractivePrompt[],
      KeyboardInteractiveFinish
    ];
  }

  /** Options for `close()`. */
  interface CloseOptions {
    /** Back out of nested shells before closing. */
    graceful?: boolean;
  }

  /**
   * A host authored by a script.
   *
   * Only `server` and `commands` are required. `ssh2shell` fills defaults into
   * this object and mutates it during a run, so use a fresh object, or clone
   * one, before reusing it with another instance.
   *
   * @see https://github.com/cmp-202/ssh2shell#configuration-reference
   */
  interface HostConfig {
    /** How ssh2shell connects. Passed through to `ssh2.Client.connect()`. */
    server: ServerConfig;

    /**
     * Commands to run in order on this host.
     *
     * `msg:text` emits a status message. Backtick-wrapped text is appended to
     * `sessionText` without sending a command.
     */
    commands: string[];

    /** Nested hosts reached through this connection using `forwardOut`. */
    hosts?: HostConfig[];

    /** Message emitted when the connection opens. Default: `"Connected"`. */
    connectedMessage?: string;
    /** Message emitted when the shell is ready. Default: `"Ready"`. */
    readyMessage?: string;
    /** Message emitted when the connection closes. Default: `"Closed"`. */
    closedMessage?: string;
    /** Emit process details and the loaded host config. Default: `false`. */
    verbose?: boolean;
    /** Emit internal processing steps. Default: `false`. */
    debug?: boolean;
    /** Show a stderr liveness indicator while a command runs. Default: `true`; TTY only. */
    progress?: boolean;
    /** Redact credentials in debug/verbose output. Set `true` to show them; default: `false`. */
    exposeCredentials?: boolean;
    /** Include the host banner in `sessionText`. Default: `false`. */
    showBanner?: boolean;
    /** End-of-line sequence written after each command. Default: `"\n"`. */
    enter?: string;
    /** Encoding applied to the shell stream. Default: `"utf8"`. */
    streamEncoding?: string;
    /** First argument to `connection.shell()`. Default: `true`; an object sets terminal size. */
    window?: boolean | Record<string, unknown>;
    /** Request a pseudo-terminal. Default: `true`; `false` also disables `window`. */
    pty?: boolean;

    /** Characters that identify a prompt. Default: `">$%#"` (end of line). */
    standardPrompt?: string;
    /** Full prompt regex; replaces `standardPrompt`. Anchored to the end; `g`, `y`, and `m` flags ignored. */
    standardPromptRegex?: string | RegExp;
    /** Text that identifies a password prompt. Default: `":"`. */
    passwordPrompt?: string;
    /** Text required before a password prompt. Default: `"Password"`. */
    passPromptText?: string;
    /** Call `stop('sudo-failed')` when sudo authentication is rejected or unavailable. Default: `false`. */
    abortOnSudoFailure?: boolean;
    /** Response shape for `commandComplete`. Default: `"raw"`. */
    commandResponse?: 'raw' | 'handled';
    /** Merge captured stderr into the response and `sessionText`. Default: `false`. */
    captureStderr?: boolean;
    /** Regex removing non-standard ASCII. Default: `"[^\\r\\n\\x20-\\x7e]"`. Complete terminal escape sequences are removed first. */
    asciiFilter?: string;
    /** Keep non-standard ASCII instead of filtering. Default: `false`. */
    disableASCIIFilter?: boolean;
    /** Regex removing ANSI colour codes. Default: `"\\x1b\\[[0-9;]*m"`. */
    textColorFilter?: string;
    /** Keep ANSI colour codes instead of filtering. Default: `false`. */
    disableColorFilter?: boolean;

    /** Milliseconds of silence before `commandTimeout` fires. Default: `5000`. */
    idleTimeOut?: number;
    /** Milliseconds of silence that ends a response burst. Default: `500`; keep below `idleTimeOut`. */
    dataIdleTimeOut?: number;
    /** Number of times to re-arm `commandTimeout` after a non-final attempt. Default: `0`. */
    commandTimeoutRetries?: number;
    /** Set `false` from `onCommandTimeout` to stop retrying the current command. */
    retryCommandTimeout?: boolean;

    /** Per-host `msg` handler; replaces the default console sink. */
    onMsg?: MessageHandler;
    /** Handles raw data from the shell stream, in addition to internal processing. */
    onData?: DataHandler;
    /** Handles stderr data for this host. */
    onStderrData?: DataHandler;
    /** Runs on each output chunk before the command prompt is detected. */
    onCommandProcessing?: CommandProcessingHandler;
    /** Runs when a command returns to the prompt. */
    onCommandComplete?: CommandCompleteHandler;
    /** Runs when a command produces no prompt before `idleTimeOut`. */
    onCommandTimeout?: CommandTimeoutHandler;
    /** Runs when this host's session finishes. */
    onEnd?: EndHandler;
    /** Runs before the default error handler for errors on this host. */
    onError?: ErrorHandler;
    /** Answers keyboard-interactive authentication for this connection. */
    onKeyboardInteractive?: KeyboardInteractiveHandler;

    /** Accumulated raw output for this host. */
    sessionText?: string;
    /** Runtime flag set once a password has been sent for this host. */
    pwSent?: boolean;
    /** Runtime flag set when a sudo password is rejected. Starts `false` for each host. */
    sudoFailed?: boolean;
    /** Reason passed to `stop()` when the run was stopped early. */
    stopReason?: string;
    /** Set from a handler to stop after the completed command. */
    skipCommands?: boolean;
    /** Set from a handler to skip this host's own nested hosts. */
    skipHosts?: boolean;
    /** Set from a handler to skip the remaining primary hosts. */
    skipPrimaryHosts?: boolean;
    /** Set from a handler to abort the whole run; a string becomes the stop reason. */
    abort?: string | boolean;

    /** Runtime state and forward-compatible host keys. */
    [property: string]: unknown;
  }
}

export = SSH2Shell;
