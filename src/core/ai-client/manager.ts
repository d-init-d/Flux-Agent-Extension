/**
 * @module ai-client/manager
 * @description AI Client Manager — orchestrates multiple AI providers with
 * automatic fallback, health tracking, and provider switching.
 *
 * Implements the IAIClientManager interface from `interfaces.ts`.
 *
 * Design decisions:
 *  - Maintains a registry of ProviderEntry objects tracking readiness, failures
 *  - Supports 3 fallback strategies: 'ordered', 'round-robin', 'least-errors'
 *  - maxConsecutiveFailures = 3 before marking provider unhealthy
 *  - unhealthyCooldownMs = 60_000 before retrying unhealthy provider
 *  - chat() wraps active provider with automatic fallback to next provider on failure
 */

import type {
  AIProviderType,
  AIModelConfig,
  AIMessage,
  AIStreamChunk,
  AIRequestOptions,
} from '@shared/types';
import type { IAIProvider, IAIClientManager } from './interfaces';
import { ExtensionError } from '@shared/errors';
import { ErrorCode } from '@shared/errors';
import { Logger } from '@shared/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Fallback strategy when the active provider fails. */
export type FallbackStrategy = 'ordered' | 'round-robin' | 'least-errors';

/** Health state of a registered provider. */
export interface ProviderEntry {
  /** The provider instance. */
  provider: IAIProvider;
  /** Config used to initialize the provider (null if not yet initialized). */
  config: AIModelConfig | null;
  /** Whether initialize() has been called successfully. */
  ready: boolean;
  /** Number of consecutive failures since last success. */
  consecutiveFailures: number;
  /** Total failure count (never resets — for analytics). */
  totalFailures: number;
  /** Total success count (never resets — for analytics). */
  totalSuccesses: number;
  /** Timestamp (ms) of the last successful chat() call. */
  lastSuccessAt: number;
  /** Timestamp (ms) when the provider was marked unhealthy. */
  markedUnhealthyAt: number | null;
}

/** Manager configuration. */
export interface AIClientManagerConfig {
  /** Fallback strategy when active provider fails. Default: 'ordered'. */
  fallbackStrategy: FallbackStrategy;
  /** Max consecutive failures before marking unhealthy. Default: 3. */
  maxConsecutiveFailures: number;
  /** Cooldown in ms before retrying unhealthy provider. Default: 60_000. */
  unhealthyCooldownMs: number;
  /** Whether to auto-fallback on failure. Default: true. */
  autoFallback: boolean;
}

/** Default manager configuration. */
const DEFAULT_CONFIG: AIClientManagerConfig = {
  fallbackStrategy: 'ordered',
  maxConsecutiveFailures: 3,
  unhealthyCooldownMs: 60_000,
  autoFallback: true,
};

// ---------------------------------------------------------------------------
// AIClientManager
// ---------------------------------------------------------------------------

export class AIClientManager implements IAIClientManager {
  private readonly registry = new Map<AIProviderType, ProviderEntry>();
  private activeType: AIProviderType | null = null;
  private readonly config: AIClientManagerConfig;
  private readonly logger = new Logger('ai:manager');

  /** Ordered list tracking registration order (for 'ordered' strategy). */
  private readonly registrationOrder: AIProviderType[] = [];

  /** Round-robin index (for 'round-robin' strategy). */
  private roundRobinIndex = 0;

  constructor(config?: Partial<AIClientManagerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // -----------------------------------------------------------------------
  // IAIClientManager: registerProvider
  // -----------------------------------------------------------------------

  registerProvider(provider: IAIProvider): void {
    const type = provider.name;

    if (this.registry.has(type)) {
      this.logger.warn('Provider already registered, replacing', { type });
      // Remove from registration order to re-add at end
      const idx = this.registrationOrder.indexOf(type);
      if (idx !== -1) {
        this.registrationOrder.splice(idx, 1);
      }
    }

    this.registry.set(type, {
      provider,
      config: null,
      ready: false,
      consecutiveFailures: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      lastSuccessAt: 0,
      markedUnhealthyAt: null,
    });

    this.registrationOrder.push(type);

    this.logger.debug('Provider registered', {
      type,
      totalRegistered: this.registry.size,
    });
  }

  // -----------------------------------------------------------------------
  // IAIClientManager: getActiveProvider
  // -----------------------------------------------------------------------

  getActiveProvider(): IAIProvider {
    if (!this.activeType) {
      throw new ExtensionError(
        ErrorCode.AI_API_ERROR,
        'No active AI provider — call switchProvider() first',
      );
    }

    const entry = this.registry.get(this.activeType);
    if (!entry) {
      throw new ExtensionError(
        ErrorCode.AI_API_ERROR,
        `Active provider "${this.activeType}" not found in registry`,
      );
    }

    return entry.provider;
  }

  // -----------------------------------------------------------------------
  // IAIClientManager: switchProvider
  // -----------------------------------------------------------------------

  async switchProvider(type: AIProviderType, config: AIModelConfig): Promise<void> {
    const entry = this.registry.get(type);
    if (!entry) {
      throw new ExtensionError(
        ErrorCode.AI_API_ERROR,
        `Provider "${type}" is not registered — call registerProvider() first`,
      );
    }

    // Initialize if not ready, or if config has changed
    if (!entry.ready || !this.configsEqual(entry.config, config)) {
      this.logger.debug('Initializing provider', { type, model: config.model });

      try {
        await entry.provider.initialize(config);
        entry.config = config;
        entry.ready = true;
        entry.consecutiveFailures = 0;
        entry.markedUnhealthyAt = null;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new ExtensionError(
          ErrorCode.AI_API_ERROR,
          `Failed to initialize provider "${type}": ${msg}`,
          true,
          { provider: type, originalError: msg },
        );
      }
    }

    this.activeType = type;
    this.logger.debug('Active provider switched', { type, model: config.model });
  }

  // -----------------------------------------------------------------------
  // IAIClientManager: chat (with automatic fallback)
  // -----------------------------------------------------------------------

  async *chat(
    messages: AIMessage[],
    options?: AIRequestOptions,
  ): AsyncGenerator<AIStreamChunk, void, unknown> {
    if (!this.activeType) {
      throw new ExtensionError(
        ErrorCode.AI_API_ERROR,
        'No active AI provider — call switchProvider() first',
      );
    }

    // Build the ordered list of providers to try
    const candidates = this.config.autoFallback
      ? this.buildFallbackOrder(this.activeType)
      : [this.activeType];

    let lastError: ExtensionError | null = null;

    for (const candidateType of candidates) {
      const entry = this.registry.get(candidateType);
      if (!entry || !entry.ready) {
        continue;
      }

      // Skip unhealthy providers that haven't cooled down
      if (this.isUnhealthy(entry) && !this.hasCooledDown(entry)) {
        this.logger.debug('Skipping unhealthy provider', {
          type: candidateType,
          markedUnhealthyAt: entry.markedUnhealthyAt,
        });
        continue;
      }

      try {
        this.logger.debug('Attempting chat with provider', { type: candidateType });

        // Yield chunks from the provider's chat generator
        const generator = entry.provider.chat(messages, options);
        let hasYielded = false;

        for await (const chunk of generator) {
          hasYielded = true;
          yield chunk;

          // If we receive an error chunk, record it but don't throw
          // (the provider already decided to yield it rather than throw)
          if (chunk.type === 'error') {
            this.logger.warn('Provider yielded error chunk', {
              type: candidateType,
              error: chunk.error?.message,
            });
          }
        }

        // Success — record it and return
        this.recordSuccess(entry);

        if (candidateType !== this.activeType) {
          this.logger.info('Chat succeeded via fallback provider', {
            primary: this.activeType,
            fallback: candidateType,
          });
        }

        return;
      } catch (error) {
        const extensionError = this.wrapError(error, candidateType);
        this.recordFailure(entry, candidateType);
        lastError = extensionError;

        // If this is a non-retryable error, don't try fallback
        if (!this.isFallbackEligible(extensionError)) {
          throw extensionError;
        }

        this.logger.warn('Provider failed, trying fallback', {
          failedProvider: candidateType,
          error: extensionError.message,
          remainingCandidates: candidates.length - candidates.indexOf(candidateType) - 1,
        });
      }
    }

    // All candidates exhausted
    throw (
      lastError ??
      new ExtensionError(
        ErrorCode.AI_API_ERROR,
        'All AI providers failed — no healthy providers available',
      )
    );
  }

  // -----------------------------------------------------------------------
  // Public utility methods (not in IAIClientManager but useful)
  // -----------------------------------------------------------------------

  /**
   * Get health info for all registered providers.
   */
  getProviderHealth(): Map<
    AIProviderType,
    {
      ready: boolean;
      healthy: boolean;
      consecutiveFailures: number;
      totalFailures: number;
      totalSuccesses: number;
      lastSuccessAt: number;
    }
  > {
    const result = new Map<
      AIProviderType,
      {
        ready: boolean;
        healthy: boolean;
        consecutiveFailures: number;
        totalFailures: number;
        totalSuccesses: number;
        lastSuccessAt: number;
      }
    >();

    for (const [type, entry] of this.registry) {
      result.set(type, {
        ready: entry.ready,
        healthy: !this.isUnhealthy(entry),
        consecutiveFailures: entry.consecutiveFailures,
        totalFailures: entry.totalFailures,
        totalSuccesses: entry.totalSuccesses,
        lastSuccessAt: entry.lastSuccessAt,
      });
    }

    return result;
  }

  /**
   * Get list of registered provider types.
   */
  getRegisteredProviders(): AIProviderType[] {
    return [...this.registrationOrder];
  }

  /**
   * Get the active provider type, or null if none.
   */
  getActiveProviderType(): AIProviderType | null {
    return this.activeType;
  }

  /**
   * Reset health state for a specific provider.
   */
  resetProviderHealth(type: AIProviderType): void {
    const entry = this.registry.get(type);
    if (entry) {
      entry.consecutiveFailures = 0;
      entry.markedUnhealthyAt = null;
      this.logger.debug('Provider health reset', { type });
    }
  }

  /**
   * Reset health state for all providers.
   */
  resetAllHealth(): void {
    for (const [type, entry] of this.registry) {
      entry.consecutiveFailures = 0;
      entry.markedUnhealthyAt = null;
    }
    this.logger.debug('All provider health reset');
  }

  /**
   * Abort the current active provider's request.
   */
  abort(): void {
    if (this.activeType) {
      const entry = this.registry.get(this.activeType);
      if (entry) {
        entry.provider.abort();
        this.logger.debug('Aborted active provider', { type: this.activeType });
      }
    }
  }

  /**
   * Validate an API key for a specific provider without switching to it.
   */
  async validateApiKey(type: AIProviderType, apiKey: string): Promise<boolean> {
    const entry = this.registry.get(type);
    if (!entry) {
      throw new ExtensionError(ErrorCode.AI_API_ERROR, `Provider "${type}" is not registered`);
    }
    return entry.provider.validateApiKey(apiKey);
  }

  // -----------------------------------------------------------------------
  // Private: Fallback ordering
  // -----------------------------------------------------------------------

  /**
   * Build the ordered list of providers to attempt, starting with the
   * preferred provider and then adding fallback candidates based on strategy.
   */
  private buildFallbackOrder(preferred: AIProviderType): AIProviderType[] {
    const candidates: AIProviderType[] = [preferred];

    // Get remaining ready providers (excluding preferred)
    const remaining = this.registrationOrder.filter(
      (type) => type !== preferred && this.registry.get(type)?.ready,
    );

    switch (this.config.fallbackStrategy) {
      case 'ordered':
        // Use registration order
        candidates.push(...remaining);
        break;

      case 'round-robin': {
        // Rotate through remaining providers starting from roundRobinIndex
        const rotated: AIProviderType[] = [];
        for (let i = 0; i < remaining.length; i++) {
          const idx = (this.roundRobinIndex + i) % remaining.length;
          rotated.push(remaining[idx]);
        }
        candidates.push(...rotated);
        this.roundRobinIndex = (this.roundRobinIndex + 1) % Math.max(1, remaining.length);
        break;
      }

      case 'least-errors':
        // Sort remaining by fewest consecutive failures, then by most recent success
        remaining.sort((a, b) => {
          const ea = this.registry.get(a)!;
          const eb = this.registry.get(b)!;

          // Fewer failures first
          const failureDiff = ea.consecutiveFailures - eb.consecutiveFailures;
          if (failureDiff !== 0) return failureDiff;

          // More recent success first
          return eb.lastSuccessAt - ea.lastSuccessAt;
        });
        candidates.push(...remaining);
        break;
    }

    return candidates;
  }

  // -----------------------------------------------------------------------
  // Private: Health tracking
  // -----------------------------------------------------------------------

  private recordSuccess(entry: ProviderEntry): void {
    entry.consecutiveFailures = 0;
    entry.totalSuccesses += 1;
    entry.lastSuccessAt = Date.now();
    entry.markedUnhealthyAt = null;
  }

  private recordFailure(entry: ProviderEntry, type: AIProviderType): void {
    entry.consecutiveFailures += 1;
    entry.totalFailures += 1;

    if (entry.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      entry.markedUnhealthyAt = Date.now();
      this.logger.warn('Provider marked unhealthy', {
        type,
        consecutiveFailures: entry.consecutiveFailures,
        cooldownMs: this.config.unhealthyCooldownMs,
      });
    }
  }

  private isUnhealthy(entry: ProviderEntry): boolean {
    return entry.markedUnhealthyAt !== null;
  }

  private hasCooledDown(entry: ProviderEntry): boolean {
    if (entry.markedUnhealthyAt === null) return true;
    return Date.now() - entry.markedUnhealthyAt >= this.config.unhealthyCooldownMs;
  }

  // -----------------------------------------------------------------------
  // Private: Error handling
  // -----------------------------------------------------------------------

  /**
   * Wrap any error into an ExtensionError for consistent handling.
   */
  private wrapError(error: unknown, providerType: AIProviderType): ExtensionError {
    if (error instanceof ExtensionError) {
      return error;
    }

    const msg = error instanceof Error ? error.message : String(error);
    return new ExtensionError(
      ErrorCode.AI_API_ERROR,
      `Provider "${providerType}" failed: ${msg}`,
      true,
      { provider: providerType, originalError: msg },
    );
  }

  /**
   * Determine if an error should trigger fallback to the next provider.
   *
   * We do NOT fall back on:
   *  - ABORTED (user cancelled — intentional)
   *  - AI_INVALID_KEY (key is wrong — won't work on another provider)
   *  - SENSITIVE_DATA_DETECTED (security block — shouldn't retry)
   */
  private isFallbackEligible(error: ExtensionError): boolean {
    const nonFallbackCodes: ErrorCode[] = [
      ErrorCode.ABORTED,
      ErrorCode.AI_INVALID_KEY,
      ErrorCode.SENSITIVE_DATA_DETECTED,
    ];

    return !nonFallbackCodes.includes(error.code);
  }

  // -----------------------------------------------------------------------
  // Private: Utilities
  // -----------------------------------------------------------------------

  /**
   * Shallow compare two AIModelConfig objects.
   * Returns true if they are effectively the same configuration.
   */
  private configsEqual(a: AIModelConfig | null, b: AIModelConfig): boolean {
    if (a === null) return false;
    return (
      a.provider === b.provider &&
      a.model === b.model &&
      a.apiKey === b.apiKey &&
      a.baseUrl === b.baseUrl &&
      a.maxTokens === b.maxTokens &&
      a.temperature === b.temperature
    );
  }
}
