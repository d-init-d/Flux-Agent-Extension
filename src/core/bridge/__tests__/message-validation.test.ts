/**
 * @module message-validation.test
 * @description Tests for message validation and NonceTracker.
 *
 * Covers: structural validation, timestamp bounds, payload presence,
 * nonce deduplication, automatic cleanup, and destroy lifecycle.
 */

import { validateMessage, NonceTracker } from '../message-validation';

// ============================================================================
// validateMessage
// ============================================================================

describe('validateMessage', () => {
  /**
   * Helper: build a valid BridgeMessage-shaped object.
   */
  function validMessage(overrides: Record<string, unknown> = {}) {
    return {
      id: 'test-id-123',
      type: 'PING',
      timestamp: Date.now(),
      payload: null,
      ...overrides,
    };
  }

  // --------------------------------------------------------------------------
  // Happy path
  // --------------------------------------------------------------------------

  describe('valid messages', () => {
    it('should accept a well-formed PING message', () => {
      const result = validateMessage(validMessage());
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should accept every known MessageType', () => {
      const types = [
        'EXECUTE_ACTION',
        'GET_PAGE_CONTEXT',
        'HIGHLIGHT_ELEMENT',
        'CLEAR_HIGHLIGHTS',
        'SET_RECORDING_STATE',
        'PING',
        'ACTION_RESULT',
        'PAGE_CONTEXT',
        'ERROR',
        'PONG',
        'PAGE_LOADED',
        'PAGE_UNLOAD',
        'DOM_MUTATION',
        'RECORDED_CLICK',
        'RECORDED_INPUT',
        'RECORDED_NAVIGATION',
        'NETWORK_REQUEST',
        'CONSOLE_LOG',
      ];

      for (const type of types) {
        const result = validateMessage(validMessage({ type }));
        expect(result.valid).toBe(true);
      }
    });

    it('should accept payload with complex objects', () => {
      const result = validateMessage(
        validMessage({ payload: { action: 'click', selector: '#btn' } }),
      );
      expect(result.valid).toBe(true);
    });

    it('should accept null payload', () => {
      const result = validateMessage(validMessage({ payload: null }));
      expect(result.valid).toBe(true);
    });

    it('should accept timestamp slightly in the future (within tolerance)', () => {
      // 3 seconds in the future — within the 5s tolerance
      const result = validateMessage(
        validMessage({ timestamp: Date.now() + 3_000 }),
      );
      expect(result.valid).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Non-object values
  // --------------------------------------------------------------------------

  describe('non-object values', () => {
    it('should reject null', () => {
      const result = validateMessage(null);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/non-null object/i);
    });

    it('should reject undefined', () => {
      const result = validateMessage(undefined);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/non-null object/i);
    });

    it('should reject a string', () => {
      const result = validateMessage('hello');
      expect(result.valid).toBe(false);
    });

    it('should reject a number', () => {
      const result = validateMessage(42);
      expect(result.valid).toBe(false);
    });

    it('should reject a boolean', () => {
      const result = validateMessage(true);
      expect(result.valid).toBe(false);
    });

    it('should reject an array', () => {
      const result = validateMessage([1, 2, 3]);
      expect(result.valid).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // id validation
  // --------------------------------------------------------------------------

  describe('id field', () => {
    it('should reject missing id', () => {
      const msg = validMessage();
      delete (msg as Record<string, unknown>)['id'];
      const result = validateMessage(msg);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/id/i);
    });

    it('should reject empty string id', () => {
      const result = validateMessage(validMessage({ id: '' }));
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/id/i);
    });

    it('should reject numeric id', () => {
      const result = validateMessage(validMessage({ id: 123 }));
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/id/i);
    });

    it('should reject null id', () => {
      const result = validateMessage(validMessage({ id: null }));
      expect(result.valid).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // type validation
  // --------------------------------------------------------------------------

  describe('type field', () => {
    it('should reject unknown type', () => {
      const result = validateMessage(validMessage({ type: 'UNKNOWN_TYPE' }));
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/invalid message type/i);
    });

    it('should reject missing type', () => {
      const msg = validMessage();
      delete (msg as Record<string, unknown>)['type'];
      const result = validateMessage(msg);
      expect(result.valid).toBe(false);
    });

    it('should reject numeric type', () => {
      const result = validateMessage(validMessage({ type: 1 }));
      expect(result.valid).toBe(false);
    });

    it('should reject empty string type', () => {
      const result = validateMessage(validMessage({ type: '' }));
      expect(result.valid).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // timestamp validation
  // --------------------------------------------------------------------------

  describe('timestamp field', () => {
    it('should reject missing timestamp', () => {
      const msg = validMessage();
      delete (msg as Record<string, unknown>)['timestamp'];
      const result = validateMessage(msg);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/timestamp/i);
    });

    it('should reject string timestamp', () => {
      const result = validateMessage(validMessage({ timestamp: '12345' }));
      expect(result.valid).toBe(false);
    });

    it('should reject NaN timestamp', () => {
      const result = validateMessage(validMessage({ timestamp: NaN }));
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/finite number/i);
    });

    it('should reject Infinity timestamp', () => {
      const result = validateMessage(validMessage({ timestamp: Infinity }));
      expect(result.valid).toBe(false);
    });

    it('should reject timestamp too far in the future (> 5s)', () => {
      const result = validateMessage(
        validMessage({ timestamp: Date.now() + 10_000 }),
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/future/i);
    });

    it('should reject timestamp that is too old (> 60s)', () => {
      const result = validateMessage(
        validMessage({ timestamp: Date.now() - 120_000 }),
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/old|expired/i);
    });
  });

  // --------------------------------------------------------------------------
  // payload validation
  // --------------------------------------------------------------------------

  describe('payload field', () => {
    it('should reject undefined payload', () => {
      const msg = validMessage();
      delete (msg as Record<string, unknown>)['payload'];
      const result = validateMessage(msg);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/payload/i);
    });

    it('should accept false as payload', () => {
      const result = validateMessage(validMessage({ payload: false }));
      expect(result.valid).toBe(true);
    });

    it('should accept 0 as payload', () => {
      const result = validateMessage(validMessage({ payload: 0 }));
      expect(result.valid).toBe(true);
    });

    it('should accept empty string as payload', () => {
      const result = validateMessage(validMessage({ payload: '' }));
      expect(result.valid).toBe(true);
    });

    it('should accept empty object as payload', () => {
      const result = validateMessage(validMessage({ payload: {} }));
      expect(result.valid).toBe(true);
    });
  });
});

// ============================================================================
// NonceTracker
// ============================================================================

describe('NonceTracker', () => {
  let tracker: NonceTracker;

  beforeEach(() => {
    vi.useFakeTimers();
    tracker = new NonceTracker();
  });

  afterEach(() => {
    tracker.destroy();
    vi.useRealTimers();
  });

  // --------------------------------------------------------------------------
  // Basic nonce checking
  // --------------------------------------------------------------------------

  describe('check()', () => {
    it('should return true for a fresh nonce', () => {
      expect(tracker.check('nonce-1')).toBe(true);
    });

    it('should return false for a duplicate nonce', () => {
      tracker.check('nonce-1');
      expect(tracker.check('nonce-1')).toBe(false);
    });

    it('should track multiple distinct nonces independently', () => {
      expect(tracker.check('a')).toBe(true);
      expect(tracker.check('b')).toBe(true);
      expect(tracker.check('c')).toBe(true);

      expect(tracker.check('a')).toBe(false);
      expect(tracker.check('b')).toBe(false);
      expect(tracker.check('c')).toBe(false);
    });

    it('should handle empty string nonce', () => {
      expect(tracker.check('')).toBe(true);
      expect(tracker.check('')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Automatic cleanup
  // --------------------------------------------------------------------------

  describe('automatic cleanup', () => {
    it('should remove expired nonces after cleanup interval', () => {
      tracker.check('old-nonce');

      // Advance 60s (MAX_MESSAGE_AGE_MS) + 30s (CLEANUP_INTERVAL_MS)
      vi.advanceTimersByTime(90_000);

      // After cleanup, the old nonce should have been evicted — so it's fresh again
      expect(tracker.check('old-nonce')).toBe(true);
    });

    it('should keep recent nonces after cleanup', () => {
      tracker.check('recent-nonce');

      // Advance only 30s — nonce is still within the 60s age window
      vi.advanceTimersByTime(30_000);

      // Should still be tracked as duplicate
      expect(tracker.check('recent-nonce')).toBe(false);
    });

    it('should force cleanup when cache exceeds max size', () => {
      // Insert MAX_NONCE_CACHE_SIZE nonces so the next one triggers cleanup
      for (let i = 0; i < 1000; i++) {
        tracker.check(`nonce-${i}`);
      }

      // All 1000 are recent so cleanup won't evict them.
      // The 1001st triggers cleanup (but won't free much since all are recent).
      expect(tracker.check('trigger-cleanup')).toBe(true);

      // Originals are still tracked
      expect(tracker.check('nonce-0')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // destroy()
  // --------------------------------------------------------------------------

  describe('destroy()', () => {
    it('should clear all tracked nonces', () => {
      tracker.check('nonce-1');
      tracker.check('nonce-2');
      tracker.destroy();

      // After destroy, create a new tracker to verify old nonces don't leak
      tracker = new NonceTracker();
      expect(tracker.check('nonce-1')).toBe(true);
      expect(tracker.check('nonce-2')).toBe(true);
    });

    it('should stop the cleanup interval', () => {
      tracker.destroy();

      // Advance past several cleanup intervals — should not throw
      vi.advanceTimersByTime(120_000);
    });

    it('should be safe to call destroy multiple times', () => {
      tracker.destroy();
      expect(() => tracker.destroy()).not.toThrow();
    });
  });
});
