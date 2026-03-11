/**
 * @module message-validation
 * @description Validates BridgeMessage structures and provides nonce-based
 * replay protection. Used by both ServiceWorkerBridge and ContentScriptBridge
 * to ensure message integrity and prevent duplicate processing.
 */

import type { BridgeMessage, MessageType } from '@shared/types';

// ============================================================================
// Constants
// ============================================================================

/** All valid MessageType values for structural validation. */
const VALID_MESSAGE_TYPES: ReadonlySet<string> = new Set<string>([
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
]);

/** Maximum age of a message before it is considered stale (60 seconds). */
const MAX_MESSAGE_AGE_MS = 60_000;

/** Maximum number of nonces to cache before forcing a cleanup. */
const MAX_NONCE_CACHE_SIZE = 1000;

/** Tolerance for clock skew: messages up to 5 seconds in the future are accepted. */
const FUTURE_TOLERANCE_MS = 5_000;

/** Interval between automatic nonce cache cleanups (30 seconds). */
const CLEANUP_INTERVAL_MS = 30_000;

// ============================================================================
// Types
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

// ============================================================================
// validateMessage
// ============================================================================

/**
 * Validate a BridgeMessage structure.
 *
 * Checks performed:
 * 1. `msg` is a non-null object.
 * 2. `id` is a non-empty string.
 * 3. `type` is one of the known MessageType values.
 * 4. `timestamp` is a number, not in the future (beyond tolerance), and
 *    not older than MAX_MESSAGE_AGE_MS.
 * 5. `payload` is present (not `undefined`).
 */
export function validateMessage(msg: unknown): ValidationResult {
  // Step 1: Must be a non-null object
  if (msg === null || msg === undefined || typeof msg !== 'object') {
    return { valid: false, reason: 'Message must be a non-null object' };
  }

  const record = msg as Record<string, unknown>;

  // Step 2: id must be a non-empty string
  if (typeof record['id'] !== 'string' || record['id'].length === 0) {
    return { valid: false, reason: 'Message id must be a non-empty string' };
  }

  // Step 3: type must be a valid MessageType
  if (typeof record['type'] !== 'string' || !VALID_MESSAGE_TYPES.has(record['type'])) {
    return {
      valid: false,
      reason: `Invalid message type: ${String(record['type'])}`,
    };
  }

  // Step 4: timestamp must be a reasonable number
  if (typeof record['timestamp'] !== 'number' || !Number.isFinite(record['timestamp'])) {
    return { valid: false, reason: 'Message timestamp must be a finite number' };
  }

  const now = Date.now();
  const timestamp = record['timestamp'] as number;

  if (timestamp > now + FUTURE_TOLERANCE_MS) {
    return { valid: false, reason: 'Message timestamp is too far in the future' };
  }

  if (timestamp < now - MAX_MESSAGE_AGE_MS) {
    return { valid: false, reason: 'Message timestamp is too old (expired)' };
  }

  // Step 5: payload must not be undefined
  if (record['payload'] === undefined) {
    return { valid: false, reason: 'Message payload must not be undefined' };
  }

  return { valid: true };
}

// ============================================================================
// NonceTracker
// ============================================================================

/**
 * Tracks recently seen message IDs to prevent replay attacks.
 *
 * Each nonce is stored alongside its timestamp. Periodic cleanup removes
 * entries older than MAX_MESSAGE_AGE_MS. If the cache exceeds
 * MAX_NONCE_CACHE_SIZE, a forced cleanup runs immediately.
 */
export class NonceTracker {
  private seen: Map<string, number>; // messageId -> timestamp
  private cleanupInterval: ReturnType<typeof setInterval> | null;

  constructor() {
    this.seen = new Map();
    this.cleanupInterval = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
  }

  /**
   * Check whether a message ID is fresh (not previously seen).
   *
   * @param messageId - The unique message ID to check.
   * @returns `true` if the nonce has NOT been seen before (message is fresh),
   *          `false` if it is a duplicate (replay).
   */
  check(messageId: string): boolean {
    if (this.seen.has(messageId)) {
      return false;
    }

    this.seen.set(messageId, Date.now());

    // If we hit the size cap, run an immediate cleanup to free memory
    if (this.seen.size > MAX_NONCE_CACHE_SIZE) {
      this.cleanup();
    }

    return true;
  }

  /**
   * Remove entries older than MAX_MESSAGE_AGE_MS.
   */
  private cleanup(): void {
    const cutoff = Date.now() - MAX_MESSAGE_AGE_MS;

    for (const [id, timestamp] of this.seen) {
      if (timestamp < cutoff) {
        this.seen.delete(id);
      }
    }
  }

  /**
   * Destroy the tracker: clear the interval and release all stored nonces.
   */
  destroy(): void {
    if (this.cleanupInterval !== null) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.seen.clear();
  }
}
