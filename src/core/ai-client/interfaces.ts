import type {
  AIProviderType,
  AIModelConfig,
  AIMessage,
  AIStreamChunk,
  AIRequestOptions,
} from '@shared/types';

/**
 * Abstract interface for all AI providers.
 * Each provider (Claude, GPT, Gemini, etc.) implements this contract.
 */
export interface IAIProvider {
  readonly name: AIProviderType;
  readonly supportsVision: boolean;
  readonly supportsStreaming: boolean;
  readonly supportsFunctionCalling: boolean;

  /** Initialize provider with configuration */
  initialize(config: AIModelConfig): Promise<void>;

  /** Send messages and get streaming response */
  chat(
    messages: AIMessage[],
    options?: AIRequestOptions,
  ): AsyncGenerator<AIStreamChunk, void, unknown>;

  /** Validate API key without making a real request */
  validateApiKey(apiKey: string): Promise<boolean>;

  /** Get remaining quota/credits if available */
  getUsage?(): Promise<{ remaining: number; total: number } | null>;

  /** Abort current request */
  abort(): void;
}

/**
 * AI Client Manager — orchestrates multiple providers.
 */
export interface IAIClientManager {
  /** Register a provider implementation */
  registerProvider(provider: IAIProvider): void;

  /** Get active provider */
  getActiveProvider(): IAIProvider;

  /** Switch to a different provider */
  switchProvider(type: AIProviderType, config: AIModelConfig): Promise<void>;

  /** Send a chat request with automatic retry and fallback */
  chat(
    messages: AIMessage[],
    options?: AIRequestOptions,
  ): AsyncGenerator<AIStreamChunk, void, unknown>;
}
