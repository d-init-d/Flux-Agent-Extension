/**
 * @module ai-client/base
 * @description Abstract base class for all AI providers.
 *
 * Uses the Template Method pattern: the `chat()` flow is defined here once,
 * while subclasses implement the provider-specific hooks:
 *
 *   buildHeaders()          → Provider-specific HTTP headers (auth, version)
 *   getEndpoint()           → API endpoint URL
 *   buildRequestBody()      → Provider-specific request body shape
 *   parseStreamChunk()      → Convert raw SSE/NDJSON event to AIStreamChunk
 *   mapErrorResponse()      → Convert provider error to ExtensionError
 *
 * The base class handles:
 *   - Retry with exponential backoff + jitter
 *   - AbortSignal propagation
 *   - Rate limiter integration
 *   - Streaming (SSE) or NDJSON parsing dispatch
 *   - Consistent error handling and logging
 */

import type {
  AIProviderType,
  AIModelConfig,
  AIMessage,
  AIStreamChunk,
  AIRequestOptions,
} from '@shared/types';
import type { IAIProvider } from './interfaces';
import type { ProviderRequestConfig, RetryConfig } from './types';
import { DEFAULT_RETRY_CONFIG } from './types';
import { parseSSEStream, parseJSONStream } from './streaming';
import { estimateMessageTokens } from './token-counter';
import { RateLimiter, getDefaultRateLimits } from './rate-limiter';
import { ExtensionError } from '@shared/errors';
import { ErrorCode } from '@shared/errors';
import { Logger } from '@shared/utils';

// ---------------------------------------------------------------------------
// Abstract Base Provider
// ---------------------------------------------------------------------------

export abstract class BaseProvider implements IAIProvider {
  // ── IAIProvider readonly properties ────────────────────────────────────
  abstract readonly name: AIProviderType;
  abstract readonly supportsVision: boolean;
  abstract readonly supportsStreaming: boolean;
  abstract readonly supportsFunctionCalling: boolean;

  // ── Internal state ─────────────────────────────────────────────────────
  protected config: AIModelConfig | null = null;
  protected rateLimiter: RateLimiter | null = null;
  protected abortController: AbortController | null = null;
  protected logger!: Logger;

  /** Stream format used by this provider. Override in subclass if not SSE. */
  protected readonly streamFormat: 'sse' | 'ndjson' = 'sse';

  /** Retry configuration. Subclasses can override in constructor. */
  protected retryConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG };

  /**
   * Subclasses MUST call `this.initLogger()` at the end of their constructor.
   * This avoids the TS2715 error from accessing abstract `name` in the base constructor.
   */
  protected initLogger(): void {
    this.logger = new Logger(`ai:${this.name}`);
  }

  // ── IAIProvider: initialize ────────────────────────────────────────────

  async initialize(config: AIModelConfig): Promise<void> {
    this.config = config;
    this.rateLimiter = new RateLimiter(getDefaultRateLimits(this.name));
    this.logger.debug('Provider initialized', { model: config.model });
  }

  // ── IAIProvider: chat (Template Method) ────────────────────────────────

  async *chat(
    messages: AIMessage[],
    options?: AIRequestOptions,
  ): AsyncGenerator<AIStreamChunk, void, unknown> {
    this.assertInitialized();

    // Create a new AbortController that combines with the caller's signal
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Forward external abort signal
    if (options?.signal) {
      if (options.signal.aborted) {
        this.abortController.abort();
      } else {
        options.signal.addEventListener('abort', () => this.abortController?.abort(), {
          once: true,
        });
      }
    }

    const maxRetries = options?.maxRetries ?? this.retryConfig.maxRetries;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (signal.aborted) {
        throw new ExtensionError(ErrorCode.ABORTED, 'Request aborted', false, { attempt });
      }

      try {
        // Wait for rate limiter capacity
        if (this.rateLimiter) {
          await this.rateLimiter.waitForCapacity();
        }

        // Build request
        const requestConfig = this.buildRequest(messages, options, signal);

        // Execute fetch
        const response = await this.executeFetch(requestConfig);

        // Update rate limiter from response headers
        if (this.rateLimiter) {
          this.rateLimiter.updateFromHeaders(response.headers);
        }

        // Handle non-OK responses
        if (!response.ok) {
          const errorBody = await this.safeReadBody(response);
          const error = this.mapErrorResponse(response.status, errorBody);

          // Check if retryable
          if (
            attempt < maxRetries &&
            this.retryConfig.retryableStatuses.includes(response.status)
          ) {
            lastError = error;
            const delay = this.calculateRetryDelay(attempt);
            this.logger.warn('Retrying after error', {
              status: response.status,
              attempt: attempt + 1,
              delayMs: delay,
            });
            await this.sleep(delay, signal);
            continue;
          }

          throw error;
        }

        // Parse streaming response
        if (!response.body) {
          throw new ExtensionError(
            ErrorCode.AI_API_ERROR,
            'Response body is null — streaming not supported by environment',
          );
        }

        const reader = response.body.getReader();
        const estimatedInputTokens = estimateMessageTokens(messages);
        let outputTokens = 0;

        try {
          if (this.streamFormat === 'ndjson') {
            // NDJSON stream (Ollama)
            for await (const json of parseJSONStream(reader, signal)) {
              if (signal.aborted) return;

              const chunk = this.parseStreamChunk(json);
              if (chunk) {
                if (chunk.type === 'text' && chunk.content) {
                  outputTokens += Math.ceil(chunk.content.length / 4);
                }
                yield chunk;
                if (chunk.type === 'done') break;
              }
            }
          } else {
            // SSE stream (Claude, OpenAI, Gemini, OpenRouter)
            for await (const event of parseSSEStream(reader, signal)) {
              if (signal.aborted) return;

              const chunk = this.parseStreamChunk(event);
              if (chunk) {
                if (chunk.type === 'text' && chunk.content) {
                  outputTokens += Math.ceil(chunk.content.length / 4);
                }
                yield chunk;
                if (chunk.type === 'done') break;
              }
            }
          }
        } finally {
          // Record token usage for rate limiting
          if (this.rateLimiter) {
            this.rateLimiter.recordRequest(estimatedInputTokens + outputTokens);
          }
        }

        // Success — exit retry loop
        return;
      } catch (error) {
        if (signal.aborted) {
          throw new ExtensionError(ErrorCode.ABORTED, 'Request aborted', false, { attempt });
        }

        if (error instanceof ExtensionError) {
          // If it's a non-retryable ExtensionError, throw immediately
          if (attempt >= maxRetries || !this.isRetryableError(error)) {
            throw error;
          }
          lastError = error;
        } else {
          // Network error or unexpected error
          const msg = error instanceof Error ? error.message : String(error);
          const wrapped = new ExtensionError(
            ErrorCode.AI_API_ERROR,
            `Network error: ${msg}`,
            true,
            { originalError: msg },
          );
          if (attempt >= maxRetries) {
            throw wrapped;
          }
          lastError = wrapped;
        }

        const delay = this.calculateRetryDelay(attempt);
        this.logger.warn('Retrying after exception', {
          attempt: attempt + 1,
          delayMs: delay,
          error: lastError.message,
        });
        await this.sleep(delay, signal);
      }
    }

    // All retries exhausted
    throw lastError ?? new ExtensionError(ErrorCode.AI_API_ERROR, 'All retry attempts exhausted');
  }

  // ── IAIProvider: validateApiKey ─────────────────────────────────────────

  abstract validateApiKey(apiKey: string): Promise<boolean>;

  // ── IAIProvider: abort ─────────────────────────────────────────────────

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  // ── Abstract hooks (subclasses implement these) ────────────────────────

  /**
   * Build the HTTP headers for this provider (auth, content-type, etc.).
   * Called once per request attempt.
   */
  protected abstract buildHeaders(): Record<string, string>;

  /**
   * Get the API endpoint URL for chat/completions.
   */
  protected abstract getEndpoint(): string;

  /**
   * Build the provider-specific request body.
   *
   * @param messages - Conversation messages (already in AIMessage format)
   * @param options  - Request options (tools, streaming, etc.)
   * @returns JSON-serializable request body
   */
  protected abstract buildRequestBody(
    messages: AIMessage[],
    options?: AIRequestOptions,
  ): Record<string, unknown>;

  /**
   * Parse a single streaming event (SSE event or NDJSON object) into
   * an AIStreamChunk that the caller can consume.
   *
   * @param event - Raw SSE event (if streamFormat === 'sse') or parsed JSON object (if 'ndjson')
   * @returns Parsed chunk, or null to skip this event
   */
  protected abstract parseStreamChunk(event: unknown): AIStreamChunk | null;

  /**
   * Map a non-OK HTTP response into an ExtensionError.
   *
   * @param status    - HTTP status code
   * @param body      - Response body (already read as string)
   * @returns An ExtensionError with the appropriate ErrorCode
   */
  protected abstract mapErrorResponse(status: number, body: string): ExtensionError;

  // ── Protected helpers (available to subclasses) ────────────────────────

  /**
   * Assert that the provider has been initialized with a config.
   */
  protected assertInitialized(): asserts this is this & { config: AIModelConfig } {
    if (!this.config) {
      throw new ExtensionError(
        ErrorCode.AI_API_ERROR,
        `Provider ${this.name} not initialized — call initialize() first`,
      );
    }
  }

  /**
   * Get the configured model string.
   */
  protected getModel(): string {
    this.assertInitialized();
    return this.config.model;
  }

  /**
   * Get the configured API key, throwing if not set.
   */
  protected getApiKey(): string {
    this.assertInitialized();
    if (!this.config.apiKey) {
      throw new ExtensionError(ErrorCode.AI_INVALID_KEY, `API key not configured for ${this.name}`);
    }
    return this.config.apiKey;
  }

  /**
   * Get the base URL, falling back to the provider's default.
   */
  protected getBaseUrl(defaultUrl: string): string {
    this.assertInitialized();
    return this.config.baseUrl ?? defaultUrl;
  }

  // ── Private helpers ────────────────────────────────────────────────────

  /**
   * Build the complete ProviderRequestConfig from abstract hooks.
   */
  private buildRequest(
    messages: AIMessage[],
    options: AIRequestOptions | undefined,
    signal: AbortSignal,
  ): ProviderRequestConfig {
    const body = this.buildRequestBody(messages, options);

    return {
      url: this.getEndpoint(),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.buildHeaders(),
      },
      body: JSON.stringify(body),
      signal,
    };
  }

  /**
   * Execute the actual fetch. Extracted for testability.
   */
  private async executeFetch(config: ProviderRequestConfig): Promise<Response> {
    const timeout = this.config?.maxTokens
      ? Math.max(60_000, (this.config.maxTokens / 100) * 1000) // Scale timeout with max tokens
      : 60_000;

    // Create a timeout race
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Merge signals: request abort + timeout
    if (config.signal?.aborted) {
      controller.abort();
    } else {
      config.signal?.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
      return await fetch(config.url, {
        method: config.method,
        headers: config.headers,
        body: config.body,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted && !config.signal?.aborted) {
        // Timeout, not user abort
        throw new ExtensionError(ErrorCode.TIMEOUT, `Request timed out after ${timeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Safely read the response body as text, with a size cap.
   */
  private async safeReadBody(response: Response): Promise<string> {
    try {
      const text = await response.text();
      // Cap at 4KB to prevent memory issues with huge error responses
      return text.length > 4096 ? text.slice(0, 4096) + '...' : text;
    } catch {
      return '';
    }
  }

  /**
   * Calculate retry delay with exponential backoff + jitter.
   */
  private calculateRetryDelay(attempt: number): number {
    const baseDelay = this.retryConfig.baseDelay * Math.pow(2, attempt);
    const capped = Math.min(baseDelay, this.retryConfig.maxDelay);

    // Add jitter: ±10% of the capped delay
    const jitter = capped * 0.1 * (Math.random() * 2 - 1);
    return Math.max(0, Math.round(capped + jitter));
  }

  /**
   * Check if an error is retryable.
   */
  private isRetryableError(error: ExtensionError): boolean {
    return (
      error.code === ErrorCode.AI_RATE_LIMIT ||
      error.code === ErrorCode.TIMEOUT ||
      error.code === ErrorCode.AI_API_ERROR
    );
  }

  /**
   * Sleep for a duration, respecting an abort signal.
   */
  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new ExtensionError(ErrorCode.ABORTED, 'Request aborted during retry wait'));
        return;
      }

      const timer = setTimeout(resolve, ms);

      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new ExtensionError(ErrorCode.ABORTED, 'Request aborted during retry wait'));
        },
        { once: true },
      );
    });
  }
}
