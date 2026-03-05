/**
 * @module ai-client
 * @description AI Client module barrel export.
 *
 * Re-exports the public API surface for the AI client subsystem:
 *  - Interfaces (IAIProvider, IAIClientManager)
 *  - Manager (AIClientManager, config types)
 *  - Provider implementations (Claude, OpenAI, Gemini, Ollama, OpenRouter)
 *  - Prompts (system prompt, context templates)
 *  - Utilities (streaming, token counter, rate limiter)
 */

// Interfaces
export type { IAIProvider, IAIClientManager } from './interfaces';

// Manager
export { AIClientManager } from './manager';
export type { AIClientManagerConfig, FallbackStrategy, ProviderEntry } from './manager';

// Base (for extending with custom providers)
export { BaseProvider } from './base';

// Providers
export { ClaudeProvider } from './providers/claude';
export { OpenAIProvider } from './providers/openai';
export { GeminiProvider } from './providers/gemini';
export { OllamaProvider } from './providers/ollama';
export { OpenRouterProvider } from './providers/openrouter';

// Prompts
export { getSystemPrompt, getCompactSystemPrompt, SUPPORTED_ACTION_TYPES } from './prompts/system';
export {
  buildPageContextBlock,
  buildSessionContextBlock,
  buildErrorRecoveryBlock,
  buildEnrichedUserMessage,
  buildContinuationPrompt,
  buildConfirmationPrompt,
  formatSelector,
} from './prompts/templates';
export type { PageContext, ActionResult, SessionContext, ErrorContext } from './prompts/templates';

// Streaming utilities
export { parseSSEStream, parseJSONStream } from './streaming';

// Token counter
export { estimateTokens, estimateMessageTokens, getModelMaxTokens } from './token-counter';

// Rate limiter
export { RateLimiter, getDefaultRateLimits } from './rate-limiter';
export type { RateLimiterConfig } from './rate-limiter';

// Internal types (exposed for advanced usage / testing)
export type { ProviderRequestConfig, SSEEvent, RateLimitState, RetryConfig } from './types';
export { DEFAULT_RETRY_CONFIG } from './types';
