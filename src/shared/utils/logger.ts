/**
 * Log severity levels (ascending).
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Structured log entry emitted to transports.
 */
export interface LogEntry {
  level: LogLevel;
  namespace: string;
  message: string;
  timestamp: string; // ISO 8601
  data?: unknown;
  context?: Record<string, unknown>;
}

/**
 * Pluggable log transport — receives structured entries.
 */
export type LogTransport = (entry: LogEntry) => void;

/** Numeric weight for each level — higher means more severe. */
const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** Keys whose values must be redacted from log output. */
const SENSITIVE_KEYS = new Set(['apikey', 'password', 'token', 'secret', 'authorization']);

/** Maximum string length before truncation in serialized data. */
const MAX_STRING_LENGTH = 1000;

// ---------------------------------------------------------------------------
// Safe serialization helpers
// ---------------------------------------------------------------------------

/**
 * Safely serialize a value, handling circular references, large strings,
 * and redacting sensitive keys.
 */
function safeSanitize(value: unknown, seen?: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;

  const type = typeof value;

  if (type === 'string') {
    const str = value as string;
    return str.length > MAX_STRING_LENGTH
      ? str.slice(0, MAX_STRING_LENGTH) + `... [truncated ${str.length - MAX_STRING_LENGTH} chars]`
      : str;
  }

  if (type === 'number' || type === 'boolean') return value;

  if (type === 'bigint' || type === 'symbol' || type === 'function') {
    return String(value);
  }

  // Object / Array — guard circular references
  if (type === 'object') {
    const obj = value as object;
    const seenSet = seen ?? new WeakSet<object>();

    if (seenSet.has(obj)) return '[Circular]';
    seenSet.add(obj);

    // Error instances → plain object with standard fields
    if (obj instanceof Error) {
      return safeSanitize(
        {
          name: obj.name,
          message: obj.message,
          stack: obj.stack,
          ...(Object.keys(obj).length > 0 ? { ...obj } : {}),
        },
        seenSet,
      );
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => safeSanitize(item, seenSet));
    }

    // Plain object
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = safeSanitize((obj as Record<string, unknown>)[key], seenSet);
      }
    }
    return result;
  }

  return String(value);
}

// ---------------------------------------------------------------------------
// Default console transport
// ---------------------------------------------------------------------------

function consoleTransport(entry: LogEntry): void {
  const formatted = `${entry.timestamp} [${entry.namespace}] ${entry.message}`;

  // Build the extra args array to match original behavior:
  // - If data exists, pass it as second arg
  // - If context exists, pass it too
  const extras: unknown[] = [];
  if (entry.data !== undefined) extras.push(entry.data);
  if (entry.context !== undefined && Object.keys(entry.context).length > 0) {
    extras.push(entry.context);
  }

  switch (entry.level) {
    case 'debug':
      if (extras.length > 0) console.debug(formatted, ...extras);
      else console.debug(formatted);
      break;
    case 'info':
      if (extras.length > 0) console.info(formatted, ...extras);
      else console.info(formatted);
      break;
    case 'warn':
      if (extras.length > 0) console.warn(formatted, ...extras);
      else console.warn(formatted);
      break;
    case 'error':
      if (extras.length > 0) console.error(formatted, ...extras);
      else console.error(formatted);
      break;
  }
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

/**
 * Lightweight structured logger.
 *
 * - Supports namespacing (e.g. `new Logger('AIClient')` -> "[AIClient] ...")
 * - Respects a minimum log level so production builds stay quiet.
 * - NEVER logs sensitive data (API keys, passwords, tokens).
 * - Pluggable transport system for custom log sinks.
 * - In-memory buffer for debugging.
 * - Performance timers via `time()` / `timeEnd()`.
 */
export class Logger {
  private readonly prefix: string;
  private readonly ctx: Record<string, unknown> | undefined;

  /** Per-instance performance timers. */
  private readonly timers = new Map<string, number>();

  // -------------------------------------------------------------------------
  // Static state
  // -------------------------------------------------------------------------

  /** Custom transports registered globally. */
  private static customTransports: LogTransport[] = [];

  /** When true, the built-in console transport is active (default). */
  private static consoleEnabled = true;

  /** Global level override — `undefined` means per-instance. */
  private static globalLevel: LogLevel | undefined;

  /** In-memory log buffer (disabled by default). */
  private static buffer: LogEntry[] | undefined;
  private static bufferMaxSize = 0;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  constructor(
    private readonly namespace: string,
    private level: LogLevel = 'info',
    context?: Record<string, unknown>,
  ) {
    this.prefix = `[${namespace}]`;
    this.ctx = context;
  }

  // -------------------------------------------------------------------------
  // Instance methods — original API (fully backward-compatible)
  // -------------------------------------------------------------------------

  /** Change the minimum log level at runtime. */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  debug(message: string, data?: unknown): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: unknown): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log('warn', message, data);
  }

  error(message: string, error?: unknown): void {
    this.log('error', message, error);
  }

  /** Create a child logger with an extended namespace. */
  child(childNamespace: string): Logger {
    return new Logger(
      `${this.namespace}:${childNamespace}`,
      this.level,
      this.ctx ? { ...this.ctx } : undefined,
    );
  }

  // -------------------------------------------------------------------------
  // New instance methods
  // -------------------------------------------------------------------------

  /**
   * Return a new Logger with the same namespace but additional context metadata.
   * Context is merged — child context keys override parent keys.
   */
  withContext(ctx: Record<string, unknown>): Logger {
    const merged = this.ctx ? { ...this.ctx, ...ctx } : { ...ctx };
    return new Logger(this.namespace, this.level, merged);
  }

  /**
   * Start a named performance timer.
   */
  time(label: string): void {
    this.timers.set(label, performance.now());
  }

  /**
   * End a named timer, log the elapsed duration at debug level,
   * and return the elapsed milliseconds.
   * Returns -1 if the label was never started.
   */
  timeEnd(label: string): number {
    const start = this.timers.get(label);
    if (start === undefined) {
      this.warn(`Timer "${label}" does not exist`);
      return -1;
    }
    this.timers.delete(label);
    const elapsed = Math.round((performance.now() - start) * 100) / 100;
    this.debug(`${label}: ${elapsed}ms`);
    return elapsed;
  }

  // -------------------------------------------------------------------------
  // Static methods — Transport management
  // -------------------------------------------------------------------------

  /** Register a custom transport globally. */
  static addTransport(transport: LogTransport): void {
    if (!Logger.customTransports.includes(transport)) {
      Logger.customTransports.push(transport);
    }
  }

  /** Remove a previously-registered custom transport. */
  static removeTransport(transport: LogTransport): void {
    const idx = Logger.customTransports.indexOf(transport);
    if (idx !== -1) Logger.customTransports.splice(idx, 1);
  }

  /**
   * Remove all custom transports.
   * The built-in console transport remains active unless explicitly disabled.
   */
  static clearTransports(): void {
    Logger.customTransports = [];
  }

  /** Disable the built-in console transport. */
  static disableConsole(): void {
    Logger.consoleEnabled = false;
  }

  /** Re-enable the built-in console transport. */
  static enableConsole(): void {
    Logger.consoleEnabled = true;
  }

  // -------------------------------------------------------------------------
  // Static methods — Global level
  // -------------------------------------------------------------------------

  /** Override the log level for ALL Logger instances. */
  static setGlobalLevel(level: LogLevel): void {
    Logger.globalLevel = level;
  }

  /** Revert to per-instance log levels. */
  static clearGlobalLevel(): void {
    Logger.globalLevel = undefined;
  }

  // -------------------------------------------------------------------------
  // Static methods — In-memory buffer
  // -------------------------------------------------------------------------

  /** Enable in-memory buffering of the last `maxSize` log entries. */
  static enableBuffer(maxSize: number): void {
    Logger.bufferMaxSize = maxSize;
    if (!Logger.buffer) {
      Logger.buffer = [];
    }
  }

  /** Return all buffered log entries (read-only snapshot). */
  static getBuffer(): ReadonlyArray<LogEntry> {
    return Logger.buffer ? [...Logger.buffer] : [];
  }

  /** Clear the in-memory buffer. */
  static clearBuffer(): void {
    if (Logger.buffer) Logger.buffer.length = 0;
  }

  /** Disable buffering and discard the buffer. */
  static disableBuffer(): void {
    Logger.buffer = undefined;
    Logger.bufferMaxSize = 0;
  }

  // -------------------------------------------------------------------------
  // Static methods — Reset (useful for tests)
  // -------------------------------------------------------------------------

  /** Reset all static state to defaults. Useful in test teardown. */
  static resetAll(): void {
    Logger.customTransports = [];
    Logger.consoleEnabled = true;
    Logger.globalLevel = undefined;
    Logger.buffer = undefined;
    Logger.bufferMaxSize = 0;
  }

  // -------------------------------------------------------------------------
  // Private — core logging engine
  // -------------------------------------------------------------------------

  private log(level: LogLevel, message: string, data?: unknown): void {
    const effectiveLevel = Logger.globalLevel ?? this.level;
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[effectiveLevel]) {
      return;
    }

    const timestamp = new Date().toISOString();

    // Console transport uses RAW data for best devtools experience
    // (Error stack traces, object inspection, etc.)
    if (Logger.consoleEnabled) {
      const consoleEntry: LogEntry = {
        level,
        namespace: this.namespace,
        message,
        timestamp,
        ...(data !== undefined && { data }),
        ...(this.ctx !== undefined && { context: this.ctx }),
      };
      consoleTransport(consoleEntry);
    }

    // Custom transports and buffer receive SANITIZED data
    // (safe for serialization, redacted, no circular refs)
    const hasExternalConsumers = Logger.customTransports.length > 0 || Logger.buffer !== undefined;

    if (hasExternalConsumers) {
      const sanitizedData = data !== undefined ? safeSanitize(data) : undefined;

      const entry: LogEntry = {
        level,
        namespace: this.namespace,
        message,
        timestamp,
        ...(sanitizedData !== undefined && { data: sanitizedData }),
        ...(this.ctx !== undefined && { context: this.ctx }),
      };

      for (const transport of Logger.customTransports) {
        try {
          transport(entry);
        } catch {
          // Transport errors must never crash the application
        }
      }

      if (Logger.buffer !== undefined) {
        Logger.buffer.push(entry);
        // Evict oldest entries when over capacity
        while (Logger.buffer.length > Logger.bufferMaxSize) {
          Logger.buffer.shift();
        }
      }
    }
  }
}
