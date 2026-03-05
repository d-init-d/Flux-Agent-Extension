/**
 * @module ai-client/types
 * @description Internal types for the AI client module.
 *
 * These types are NOT exported from the public API surface — they are
 * implementation details shared between the streaming parser, rate limiter,
 * token counter, and provider base class.
 */

/**
 * Normalized request configuration passed to fetch.
 * Built by each provider's `buildRequestBody()` and consumed by the base class.
 */
export interface ProviderRequestConfig {
  /** Full endpoint URL including path */
  url: string;
  /** HTTP method (almost always POST for chat completions) */
  method: 'GET' | 'POST';
  /** Request headers including auth */
  headers: Record<string, string>;
  /** Serialized JSON body */
  body: string;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}

/**
 * A single parsed SSE event.
 *
 * @see https://html.spec.whatwg.org/multipage/server-sent-events.html
 */
export interface SSEEvent {
  /** Optional event type (e.g. "message", "error", "content_block_delta") */
  event?: string;
  /** The `data:` field value. Multi-line data values are joined with newlines. */
  data: string;
  /** Optional event ID */
  id?: string;
  /** Optional reconnection time hint in milliseconds */
  retry?: number;
}

/**
 * Rate limit state tracked per provider instance.
 */
export interface RateLimitState {
  /** Requests remaining in the current window */
  remaining: number;
  /** Total requests allowed per window */
  total: number;
  /** Unix timestamp (ms) when the current window resets */
  resetAt: number;
  /** Duration of the sliding window in milliseconds */
  windowMs: number;
}

/**
 * Retry configuration for transient failures.
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (0 = no retries) */
  maxRetries: number;
  /** Base delay in ms before the first retry (doubles on each subsequent retry) */
  baseDelay: number;
  /** Maximum delay cap in ms regardless of exponential growth */
  maxDelay: number;
  /** HTTP status codes that are eligible for automatic retry */
  retryableStatuses: ReadonlyArray<number>;
}

/**
 * Default retry configuration suitable for most AI provider APIs.
 */
export const DEFAULT_RETRY_CONFIG: Readonly<RetryConfig> = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30_000,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
} as const;
