/**
 * @module ai-client/rate-limiter
 * @description Per-provider sliding-window rate limiter.
 *
 * Tracks both request count and token throughput using a sliding window
 * algorithm. Provides non-blocking capacity checks and async wait-for-capacity
 * for callers who want to queue rather than fail.
 *
 * Also extracts rate-limit state from standard HTTP response headers
 * (X-RateLimit-Remaining, X-RateLimit-Limit, X-RateLimit-Reset, Retry-After).
 */

import type { AIProviderType } from '@shared/types';
import type { RateLimitState } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default sliding window duration: 60 seconds. */
const DEFAULT_WINDOW_MS = 60_000;

/** Polling interval for waitForCapacity() — 500ms. */
const WAIT_POLL_INTERVAL_MS = 500;

/** Maximum time waitForCapacity() will wait before rejecting (2 minutes). */
const WAIT_MAX_DURATION_MS = 120_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single recorded request with its timestamp and token cost. */
interface RequestRecord {
  timestamp: number;
  tokens: number;
}

/** Configuration for the rate limiter. */
export interface RateLimiterConfig {
  maxRequestsPerMinute: number;
  maxTokensPerMinute: number;
}

// ---------------------------------------------------------------------------
// Default Rate Limits per Provider
// ---------------------------------------------------------------------------

/**
 * Get sensible default rate limits for a provider.
 *
 * These are conservative estimates based on publicly documented limits.
 * Actual limits depend on the user's API tier/plan — the limiter will
 * self-correct when it receives real headers via `updateFromHeaders()`.
 */
export function getDefaultRateLimits(provider: AIProviderType): RateLimiterConfig {
  switch (provider) {
    case 'claude':
      // Anthropic Tier 1: 50 RPM, 40K tokens/min
      return { maxRequestsPerMinute: 50, maxTokensPerMinute: 40_000 };

    case 'openai':
      // OpenAI Tier 1: 60 RPM, 60K tokens/min
      return { maxRequestsPerMinute: 60, maxTokensPerMinute: 60_000 };

    case 'gemini':
      // Gemini free tier: 15 RPM; paid tier: 360 RPM
      return { maxRequestsPerMinute: 15, maxTokensPerMinute: 1_000_000 };

    case 'ollama':
      // Local model — effectively unlimited, but we cap at something sane
      return { maxRequestsPerMinute: 120, maxTokensPerMinute: 500_000 };

    case 'openrouter':
      // OpenRouter varies by model; conservative default
      return { maxRequestsPerMinute: 60, maxTokensPerMinute: 100_000 };

    case 'groq':
      // Groq free: 30 RPM, paid: 100 RPM
      return { maxRequestsPerMinute: 30, maxTokensPerMinute: 60_000 };

    case 'deepseek':
      return { maxRequestsPerMinute: 60, maxTokensPerMinute: 1_000_000 };

    case 'xai':
      return { maxRequestsPerMinute: 60, maxTokensPerMinute: 100_000 };

    case 'together':
      return { maxRequestsPerMinute: 60, maxTokensPerMinute: 100_000 };

    case 'fireworks':
      return { maxRequestsPerMinute: 60, maxTokensPerMinute: 100_000 };

    case 'deepinfra':
      return { maxRequestsPerMinute: 60, maxTokensPerMinute: 100_000 };

    case 'cerebras':
      // Cerebras free tier: 30 RPM
      return { maxRequestsPerMinute: 30, maxTokensPerMinute: 60_000 };

    case 'mistral':
      return { maxRequestsPerMinute: 60, maxTokensPerMinute: 100_000 };

    case 'perplexity':
      return { maxRequestsPerMinute: 20, maxTokensPerMinute: 50_000 };

    case 'copilot':
      // GitHub Copilot rate limits are dynamic; conservative default
      return { maxRequestsPerMinute: 30, maxTokensPerMinute: 60_000 };

    case 'custom':
      // Unknown provider — very conservative
      return { maxRequestsPerMinute: 30, maxTokensPerMinute: 30_000 };
  }
}

// ---------------------------------------------------------------------------
// RateLimiter
// ---------------------------------------------------------------------------

/**
 * Sliding-window rate limiter that tracks both request count and token usage.
 *
 * The sliding window is implemented by keeping a log of recent requests and
 * pruning entries older than `windowMs` on every check. This is more accurate
 * than fixed-window counting and resilient to clock skew (we use monotonic
 * `Date.now()` comparisons, not wall-clock alignment).
 */
export class RateLimiter {
  private maxRequests: number;
  private maxTokens: number;
  private readonly windowMs: number;
  private readonly requestLog: RequestRecord[] = [];

  /** Externally-reported state from response headers (takes priority). */
  private headerState: RateLimitState | null = null;

  constructor(config: RateLimiterConfig, windowMs: number = DEFAULT_WINDOW_MS) {
    this.maxRequests = config.maxRequestsPerMinute;
    this.maxTokens = config.maxTokensPerMinute;
    this.windowMs = windowMs;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Check if a request can be made right now without exceeding limits.
   *
   * This is a non-blocking, side-effect-free check.
   */
  canMakeRequest(): boolean {
    // If we have header-reported state and it says we're at zero, respect that
    if (this.headerState !== null) {
      if (this.headerState.remaining <= 0 && Date.now() < this.headerState.resetAt) {
        return false;
      }
    }

    this.pruneExpiredRecords();

    const { requests, tokens } = this.getWindowUsage();

    return requests < this.maxRequests && tokens < this.maxTokens;
  }

  /**
   * Record a completed request and its estimated token cost.
   *
   * Call this AFTER the request succeeds (or fails with a non-rate-limit error).
   * For streaming responses, call with the final token count once known.
   *
   * @param tokens - Estimated or actual token count consumed by this request
   */
  recordRequest(tokens: number): void {
    this.requestLog.push({
      timestamp: Date.now(),
      tokens: Math.max(0, tokens),
    });

    // Eagerly prune if the log gets too large (> 2x max requests)
    if (this.requestLog.length > this.maxRequests * 2) {
      this.pruneExpiredRecords();
    }
  }

  /**
   * Wait until there is capacity to make a request.
   *
   * Returns immediately if capacity is available, otherwise polls every 500ms
   * until capacity frees up or 2 minutes elapse (then rejects).
   *
   * @throws Error if the maximum wait duration is exceeded
   */
  async waitForCapacity(): Promise<void> {
    if (this.canMakeRequest()) {
      return;
    }

    const deadline = Date.now() + WAIT_MAX_DURATION_MS;

    return new Promise<void>((resolve, reject) => {
      const check = (): void => {
        if (this.canMakeRequest()) {
          resolve();
          return;
        }

        if (Date.now() >= deadline) {
          reject(
            new Error(`Rate limiter: capacity not available after ${WAIT_MAX_DURATION_MS}ms wait`),
          );
          return;
        }

        setTimeout(check, WAIT_POLL_INTERVAL_MS);
      };

      // Start first check after a short delay
      setTimeout(check, WAIT_POLL_INTERVAL_MS);
    });
  }

  /**
   * Get current remaining capacity in the sliding window.
   */
  getRemainingCapacity(): { requests: number; tokens: number } {
    this.pruneExpiredRecords();
    const usage = this.getWindowUsage();

    return {
      requests: Math.max(0, this.maxRequests - usage.requests),
      tokens: Math.max(0, this.maxTokens - usage.tokens),
    };
  }

  /**
   * Update rate limit state from HTTP response headers.
   *
   * Supports standard headers used by most AI providers:
   * - `x-ratelimit-remaining-requests` / `x-ratelimit-remaining`
   * - `x-ratelimit-limit-requests` / `x-ratelimit-limit`
   * - `x-ratelimit-reset-requests` / `x-ratelimit-reset`
   * - `retry-after` (seconds or HTTP-date)
   *
   * Also dynamically adjusts internal limits if the headers report
   * higher limits than our defaults (e.g., user has a higher tier).
   */
  updateFromHeaders(headers: Headers): void {
    const remaining = parseHeaderInt(headers, [
      'x-ratelimit-remaining-requests',
      'x-ratelimit-remaining',
      'ratelimit-remaining',
    ]);

    const total = parseHeaderInt(headers, [
      'x-ratelimit-limit-requests',
      'x-ratelimit-limit',
      'ratelimit-limit',
    ]);

    const resetSeconds = parseHeaderFloat(headers, [
      'x-ratelimit-reset-requests',
      'x-ratelimit-reset',
      'ratelimit-reset',
    ]);

    const retryAfter = parseRetryAfter(headers);

    // Build header state if we have enough info
    if (remaining !== null) {
      const resetAt =
        resetSeconds !== null
          ? Date.now() + resetSeconds * 1000
          : retryAfter !== null
            ? Date.now() + retryAfter * 1000
            : Date.now() + this.windowMs;

      this.headerState = {
        remaining,
        total: total ?? this.maxRequests,
        resetAt,
        windowMs: this.windowMs,
      };

      // Dynamically adjust max if provider reports higher limits
      if (total !== null && total > this.maxRequests) {
        this.maxRequests = total;
      }
    }

    // Update token limits from headers if available
    const tokenLimit = parseHeaderInt(headers, ['x-ratelimit-limit-tokens']);
    if (tokenLimit !== null && tokenLimit > this.maxTokens) {
      this.maxTokens = tokenLimit;
    }

    const tokenRemaining = parseHeaderInt(headers, ['x-ratelimit-remaining-tokens']);
    if (tokenRemaining !== null && this.headerState) {
      // Store for informational purposes — already factored into canMakeRequest
      // via the remaining field
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Remove request records older than the sliding window.
   */
  private pruneExpiredRecords(): void {
    const cutoff = Date.now() - this.windowMs;

    // Records are appended chronologically, so we can binary-search or
    // simply shift from the front. Linear scan is fine for typical volumes.
    while (this.requestLog.length > 0 && this.requestLog[0].timestamp < cutoff) {
      this.requestLog.shift();
    }
  }

  /**
   * Sum requests and tokens in the current window.
   */
  private getWindowUsage(): { requests: number; tokens: number } {
    let requests = 0;
    let tokens = 0;

    for (const record of this.requestLog) {
      requests += 1;
      tokens += record.tokens;
    }

    return { requests, tokens };
  }
}

// ---------------------------------------------------------------------------
// Header Parsing Helpers
// ---------------------------------------------------------------------------

/**
 * Parse an integer value from the first matching header name.
 */
function parseHeaderInt(headers: Headers, names: string[]): number | null {
  for (const name of names) {
    const value = headers.get(name);
    if (value !== null) {
      const parsed = parseInt(value, 10);
      if (!Number.isNaN(parsed) && parsed >= 0) {
        return parsed;
      }
    }
  }
  return null;
}

/**
 * Parse a float value from the first matching header name.
 * Used for reset times which may include fractional seconds (e.g. "23.5s").
 */
function parseHeaderFloat(headers: Headers, names: string[]): number | null {
  for (const name of names) {
    const value = headers.get(name);
    if (value !== null) {
      // Some providers send "23s" or "23.5s" — strip the 's' suffix
      const cleaned = value.replace(/s$/i, '');
      const parsed = parseFloat(cleaned);
      if (!Number.isNaN(parsed) && parsed >= 0) {
        return parsed;
      }
    }
  }
  return null;
}

/**
 * Parse the standard `Retry-After` header.
 * Can be either a number of seconds or an HTTP-date.
 *
 * @returns Number of seconds to wait, or null if not present/parseable.
 */
function parseRetryAfter(headers: Headers): number | null {
  const value = headers.get('retry-after');
  if (value === null) {
    return null;
  }

  // Try as integer (seconds)
  const seconds = parseInt(value, 10);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return seconds;
  }

  // Try as HTTP-date
  const date = Date.parse(value);
  if (!Number.isNaN(date)) {
    const diffMs = date - Date.now();
    return Math.max(0, Math.ceil(diffMs / 1000));
  }

  return null;
}
