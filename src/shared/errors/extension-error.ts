import { ErrorCode } from './codes';

/**
 * Custom error class for the extension.
 * Carries a structured error code, recoverability flag, and optional details.
 */
export class ExtensionError extends Error {
  public override readonly name = 'ExtensionError';

  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly recoverable: boolean = false,
    public readonly details?: unknown,
  ) {
    super(message);

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Type-guard to check if an unknown value is an ExtensionError.
   */
  static isExtensionError(error: unknown): error is ExtensionError {
    return error instanceof ExtensionError;
  }

  /**
   * Serialize the error to a plain JSON object (safe for message passing).
   */
  toJSON(): {
    code: ErrorCode;
    message: string;
    recoverable: boolean;
    details?: unknown;
  } {
    return {
      code: this.code,
      message: this.message,
      recoverable: this.recoverable,
      details: this.details,
    };
  }
}
