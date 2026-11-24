// Public TypeScript declarations for ssh2shell 4.x.
// The runtime package is plain CommonJS JavaScript; this file describes the
// public surface without adding a build step or runtime dependency.

declare class SSH2Shell {
  constructor(
    hosts: SSH2Shell.HostConfig | ReadonlyArray<SSH2Shell.HostConfig>
  );

  /** The active host object, including runtime state added during a run. */
  sshObj: SSH2Shell.HostConfig;
  /** The command currently being processed. */
  command: string;
  /** Active command timeout in milliseconds. */
  idleTime: number;
  /** Active response-settling delay in milliseconds. */
  dataIdleTime: number;
  /** Effective debug flag; assigning sets a run-wide override. */
  debug: boolean;
  /** Effective verbose flag; assigning sets a run-wide override. */
  verbose: boolean;

  connect(callback?: (sessionText: string) => void): boolean;
  stop(reason?: string): unknown;
  close(options?: SSH2Shell.CloseOptions): unknown;
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
  interface ServerConfig {
    host?: string;
    hostname?: string;
    port?: number | string;
    userName?: string;
    username?: string;
    password?: string;
    privateKey?: string | Uint8Array;
    passPhrase?: string;
    passphrase?: string;
    tryKeyboard?: boolean;
    hostHash?: string;
    hostVerifier?: HostVerifier;
    algorithms?: Record<string, unknown>;
    [option: string]: unknown;
  }

  interface HostVerifier {
    (
      hashedKey: string,
      verify: (permitted: boolean) => void
    ): boolean | void;
  }

  interface ShellStream {
    write(data: string | Uint8Array, encoding?: string): boolean;
    close(): void;
    on(event: string, listener: (...args: any[]) => void): this;
    [property: string]: unknown;
  }

  interface SSHConnection {
    connect(options: Record<string, unknown>): void;
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

  interface CommandCompleteDetails {
    rawResponse: string | Uint8Array;
    stderr?: string;
    [property: string]: unknown;
  }

  interface TimeoutDetails {
    attempt: number;
    maxRetries: number;
    final: boolean;
  }

  interface KeyboardInteractivePrompt {
    prompt: string;
    echo: boolean;
  }

  type KeyboardInteractiveFinish = (responses: string[]) => void;
  type ErrorCallback = (this: SSH2Shell, error: unknown, type: string) => void;

  type MessageHandler = (this: SSH2Shell, message: unknown) => void;
  type DataHandler = (
    this: SSH2Shell,
    data: string | Uint8Array
  ) => void;
  type CommandProcessingHandler = (
    this: SSH2Shell,
    command: string,
    response: string | Uint8Array,
    host: HostConfig,
    stream: ShellStream
  ) => void;
  type CommandCompleteHandler = (
    this: SSH2Shell,
    command: string,
    response: string | Uint8Array,
    host: HostConfig,
    details: CommandCompleteDetails
  ) => void;
  type CommandTimeoutHandler = (
    this: SSH2Shell,
    command: string,
    response: string | Uint8Array,
    stream: ShellStream,
    connection: SSHConnection,
    details: TimeoutDetails
  ) => void;
  type EndHandler = (
    this: SSH2Shell,
    sessionText: string,
    host: HostConfig
  ) => void;
  type ErrorHandler = (
    this: SSH2Shell,
    error: unknown,
    type: string,
    close?: boolean | null,
    callback?: ErrorCallback,
    context?: unknown
  ) => void;
  type KeyboardInteractiveHandler = (
    this: SSH2Shell,
    name: string,
    instructions: string,
    instructionsLanguage: string,
    prompts: KeyboardInteractivePrompt[],
    finish: KeyboardInteractiveFinish
  ) => void;

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

  interface CloseOptions {
    graceful?: boolean;
  }

  interface HostConfig {
    server: ServerConfig;
    commands: string[];
    hosts?: HostConfig[];

    connectedMessage?: string;
    readyMessage?: string;
    closedMessage?: string;
    verbose?: boolean;
    debug?: boolean;
    progress?: boolean;
    exposeCredentials?: boolean;
    showBanner?: boolean;
    enter?: string;
    streamEncoding?: string;
    window?: boolean | Record<string, unknown>;
    pty?: boolean;

    standardPrompt?: string;
    standardPromptRegex?: string | RegExp;
    passwordPrompt?: string;
    passPromptText?: string;
    commandResponse?: 'raw' | 'handled';
    captureStderr?: boolean;
    asciiFilter?: string;
    disableASCIIFilter?: boolean;
    textColorFilter?: string;
    disableColorFilter?: boolean;

    idleTimeOut?: number;
    dataIdleTimeOut?: number;
    commandTimeoutRetries?: number;

    onMsg?: MessageHandler;
    onData?: DataHandler;
    onStderrData?: DataHandler;
    onCommandProcessing?: CommandProcessingHandler;
    onCommandComplete?: CommandCompleteHandler;
    onCommandTimeout?: CommandTimeoutHandler;
    onEnd?: EndHandler;
    onError?: ErrorHandler;
    onKeyboardInteractive?: KeyboardInteractiveHandler;

    [property: string]: unknown;
  }
}

export = SSH2Shell;
