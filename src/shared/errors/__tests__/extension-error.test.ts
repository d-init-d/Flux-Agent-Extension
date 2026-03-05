/**
 * @module extension-error.test
 * @description Tests for ExtensionError class and ErrorCode enum.
 *
 * Covers: construction, instanceof checks, serialization, type-guard,
 * recoverability flag, and interop with the ErrorCode enum.
 */

import { ExtensionError } from '../extension-error';
import { ErrorCode } from '../codes';

// ============================================================================
// Construction
// ============================================================================

describe('ExtensionError', () => {
  describe('construction', () => {
    it('should create an error with code and message', () => {
      const err = new ExtensionError(ErrorCode.UNKNOWN_ERROR, 'something broke');

      expect(err.code).toBe(ErrorCode.UNKNOWN_ERROR);
      expect(err.message).toBe('something broke');
    });

    it('should default recoverable to false', () => {
      const err = new ExtensionError(ErrorCode.TIMEOUT, 'timed out');
      expect(err.recoverable).toBe(false);
    });

    it('should accept recoverable=true', () => {
      const err = new ExtensionError(ErrorCode.AI_RATE_LIMIT, 'rate limited', true);
      expect(err.recoverable).toBe(true);
    });

    it('should accept optional details', () => {
      const details = { retryAfter: 30, endpoint: '/api/chat' };
      const err = new ExtensionError(
        ErrorCode.AI_RATE_LIMIT,
        'rate limited',
        true,
        details,
      );

      expect(err.details).toEqual(details);
    });

    it('should default details to undefined when not provided', () => {
      const err = new ExtensionError(ErrorCode.UNKNOWN_ERROR, 'oops');
      expect(err.details).toBeUndefined();
    });

    it('should extend the native Error class', () => {
      const err = new ExtensionError(ErrorCode.TIMEOUT, 'timeout');
      expect(err).toBeInstanceOf(Error);
    });

    it('should have the name property set to "ExtensionError"', () => {
      const err = new ExtensionError(ErrorCode.TIMEOUT, 'timeout');
      expect(err.name).toBe('ExtensionError');
    });

    it('should include a stack trace', () => {
      const err = new ExtensionError(ErrorCode.TIMEOUT, 'timeout');
      expect(err.stack).toBeDefined();
      expect(err.stack).toContain('ExtensionError');
    });

    it('should maintain prototype chain for instanceof checks', () => {
      const err = new ExtensionError(ErrorCode.ABORTED, 'aborted');
      expect(err instanceof ExtensionError).toBe(true);
      expect(err instanceof Error).toBe(true);
    });
  });

  // ==========================================================================
  // Error codes coverage
  // ==========================================================================

  describe('error codes', () => {
    const codeMessagePairs: Array<[ErrorCode, string]> = [
      [ErrorCode.UNKNOWN_ERROR, 'Unknown error occurred'],
      [ErrorCode.TIMEOUT, 'Operation timed out'],
      [ErrorCode.ABORTED, 'Operation was aborted'],
      [ErrorCode.AI_API_ERROR, 'AI API returned an error'],
      [ErrorCode.AI_RATE_LIMIT, 'AI rate limit hit'],
      [ErrorCode.AI_INVALID_KEY, 'Invalid API key'],
      [ErrorCode.AI_QUOTA_EXCEEDED, 'Quota exceeded'],
      [ErrorCode.AI_MODEL_NOT_FOUND, 'Model not found'],
      [ErrorCode.AI_PARSE_ERROR, 'Failed to parse AI response'],
      [ErrorCode.TAB_NOT_FOUND, 'Tab not found'],
      [ErrorCode.TAB_CLOSED, 'Tab was closed'],
      [ErrorCode.TAB_PERMISSION_DENIED, 'Tab permission denied'],
      [ErrorCode.CONTENT_SCRIPT_NOT_READY, 'Content script not ready'],
      [ErrorCode.CONTENT_SCRIPT_INJECTION_FAILED, 'Injection failed'],
      [ErrorCode.ELEMENT_NOT_FOUND, 'Element not found'],
      [ErrorCode.ELEMENT_NOT_VISIBLE, 'Element not visible'],
      [ErrorCode.ELEMENT_NOT_INTERACTIVE, 'Element not interactive'],
      [ErrorCode.ELEMENT_DETACHED, 'Element detached from DOM'],
      [ErrorCode.MULTIPLE_ELEMENTS_FOUND, 'Multiple elements found'],
      [ErrorCode.ACTION_INVALID, 'Invalid action'],
      [ErrorCode.ACTION_FAILED, 'Action failed'],
      [ErrorCode.ACTION_BLOCKED, 'Action blocked'],
      [ErrorCode.NAVIGATION_FAILED, 'Navigation failed'],
      [ErrorCode.SESSION_NOT_FOUND, 'Session not found'],
      [ErrorCode.SESSION_EXPIRED, 'Session expired'],
      [ErrorCode.SESSION_LIMIT_REACHED, 'Session limit reached'],
      [ErrorCode.STORAGE_QUOTA_EXCEEDED, 'Storage quota exceeded'],
      [ErrorCode.STORAGE_READ_ERROR, 'Storage read error'],
      [ErrorCode.STORAGE_WRITE_ERROR, 'Storage write error'],
      [ErrorCode.DOMAIN_BLOCKED, 'Domain blocked'],
      [ErrorCode.SCRIPT_BLOCKED, 'Script blocked'],
      [ErrorCode.SENSITIVE_DATA_DETECTED, 'Sensitive data detected'],
    ];

    it.each(codeMessagePairs)(
      'should store code %s with the given message',
      (code, message) => {
        const err = new ExtensionError(code, message);
        expect(err.code).toBe(code);
        expect(err.message).toBe(message);
      },
    );

    it('should cover every value in the ErrorCode enum', () => {
      const enumValues = Object.values(ErrorCode);
      const testedCodes = codeMessagePairs.map(([code]) => code);

      for (const value of enumValues) {
        expect(testedCodes).toContain(value);
      }
    });
  });

  // ==========================================================================
  // isExtensionError type-guard
  // ==========================================================================

  describe('isExtensionError (static type-guard)', () => {
    it('should return true for an ExtensionError instance', () => {
      const err = new ExtensionError(ErrorCode.TIMEOUT, 'timeout');
      expect(ExtensionError.isExtensionError(err)).toBe(true);
    });

    it('should return false for a native Error', () => {
      expect(ExtensionError.isExtensionError(new Error('oops'))).toBe(false);
    });

    it('should return false for a plain object with matching shape', () => {
      const fake = {
        code: ErrorCode.TIMEOUT,
        message: 'timeout',
        recoverable: false,
        name: 'ExtensionError',
      };
      expect(ExtensionError.isExtensionError(fake)).toBe(false);
    });

    it('should return false for null', () => {
      expect(ExtensionError.isExtensionError(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(ExtensionError.isExtensionError(undefined)).toBe(false);
    });

    it('should return false for a string', () => {
      expect(ExtensionError.isExtensionError('some error')).toBe(false);
    });

    it('should return false for a number', () => {
      expect(ExtensionError.isExtensionError(42)).toBe(false);
    });
  });

  // ==========================================================================
  // toJSON serialization
  // ==========================================================================

  describe('toJSON', () => {
    it('should serialize to a plain object with code, message, recoverable', () => {
      const err = new ExtensionError(ErrorCode.AI_API_ERROR, 'bad response', true);
      const json = err.toJSON();

      expect(json).toEqual({
        code: ErrorCode.AI_API_ERROR,
        message: 'bad response',
        recoverable: true,
        details: undefined,
      });
    });

    it('should include details when provided', () => {
      const details = { statusCode: 500, body: 'Internal Server Error' };
      const err = new ExtensionError(
        ErrorCode.AI_API_ERROR,
        'server error',
        false,
        details,
      );
      const json = err.toJSON();

      expect(json.details).toEqual(details);
    });

    it('should produce JSON-safe output (serializable via JSON.stringify)', () => {
      const err = new ExtensionError(
        ErrorCode.STORAGE_WRITE_ERROR,
        'quota exceeded',
        false,
        { quotaBytes: 5_242_880 },
      );

      const serialized = JSON.stringify(err.toJSON());
      const parsed = JSON.parse(serialized);

      expect(parsed.code).toBe('STORAGE_WRITE_ERROR');
      expect(parsed.message).toBe('quota exceeded');
      expect(parsed.recoverable).toBe(false);
      expect(parsed.details).toEqual({ quotaBytes: 5_242_880 });
    });

    it('should NOT include stack trace in JSON (safe for message passing)', () => {
      const err = new ExtensionError(ErrorCode.TIMEOUT, 'timeout');
      const json = err.toJSON();

      expect(json).not.toHaveProperty('stack');
      expect(json).not.toHaveProperty('name');
    });
  });

  // ==========================================================================
  // Recoverability
  // ==========================================================================

  describe('recoverability', () => {
    it('should mark recoverable errors correctly', () => {
      const err = new ExtensionError(ErrorCode.AI_RATE_LIMIT, 'rate limited', true);
      expect(err.recoverable).toBe(true);
    });

    it('should mark non-recoverable errors correctly', () => {
      const err = new ExtensionError(ErrorCode.SCRIPT_BLOCKED, 'blocked', false);
      expect(err.recoverable).toBe(false);
    });

    it('should default to non-recoverable', () => {
      const err = new ExtensionError(ErrorCode.UNKNOWN_ERROR, 'unknown');
      expect(err.recoverable).toBe(false);
    });
  });

  // ==========================================================================
  // Edge cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle empty message string', () => {
      const err = new ExtensionError(ErrorCode.UNKNOWN_ERROR, '');
      expect(err.message).toBe('');
    });

    it('should handle very long message', () => {
      const longMsg = 'a'.repeat(10_000);
      const err = new ExtensionError(ErrorCode.UNKNOWN_ERROR, longMsg);
      expect(err.message).toHaveLength(10_000);
    });

    it('should handle complex nested details', () => {
      const details = {
        request: { url: '/api', method: 'POST', body: { nested: [1, 2, 3] } },
        response: { status: 500, headers: { 'x-request-id': 'abc123' } },
      };
      const err = new ExtensionError(
        ErrorCode.AI_API_ERROR,
        'error',
        false,
        details,
      );
      expect(err.details).toEqual(details);
      expect(err.toJSON().details).toEqual(details);
    });

    it('should handle null as details', () => {
      const err = new ExtensionError(ErrorCode.UNKNOWN_ERROR, 'err', false, null);
      expect(err.details).toBeNull();
    });

    it('should be catchable in a try/catch block', () => {
      let caught: unknown;

      try {
        throw new ExtensionError(ErrorCode.TIMEOUT, 'timeout');
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(ExtensionError);
      expect(ExtensionError.isExtensionError(caught)).toBe(true);
    });

    it('should work with Promise.reject', async () => {
      const promise = Promise.reject(
        new ExtensionError(ErrorCode.ABORTED, 'user aborted'),
      );

      await expect(promise).rejects.toBeInstanceOf(ExtensionError);
      await expect(promise).rejects.toThrow('user aborted');
    });
  });
});
