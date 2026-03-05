/**
 * Log severity levels (ascending).
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Numeric weight for each level — higher means more severe. */
const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Lightweight structured logger.
 *
 * - Supports namespacing (e.g. `new Logger('AIClient')` → "[AIClient] …")
 * - Respects a minimum log level so production builds stay quiet.
 * - NEVER logs sensitive data (API keys, passwords, tokens).
 */
export class Logger {
  private readonly prefix: string;

  constructor(
    private readonly namespace: string,
    private level: LogLevel = 'info',
  ) {
    this.prefix = `[${namespace}]`;
  }

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
    return new Logger(`${this.namespace}:${childNamespace}`, this.level);
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private log(level: LogLevel, message: string, data?: unknown): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.level]) {
      return;
    }

    const timestamp = new Date().toISOString();
    const formatted = `${timestamp} ${this.prefix} ${message}`;

    switch (level) {
      case 'debug':
        data !== undefined ? console.debug(formatted, data) : console.debug(formatted);
        break;
      case 'info':
        data !== undefined ? console.info(formatted, data) : console.info(formatted);
        break;
      case 'warn':
        data !== undefined ? console.warn(formatted, data) : console.warn(formatted);
        break;
      case 'error':
        data !== undefined ? console.error(formatted, data) : console.error(formatted);
        break;
    }
  }
}
