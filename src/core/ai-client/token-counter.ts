/**
 * @module ai-client/token-counter
 * @description Approximate token counter for UI display and rate-limit estimation.
 *
 * This is NOT a precise tokenizer (that would require tiktoken/sentencepiece WASM).
 * It uses heuristics tuned to produce estimates within ~10-20% of real counts for
 * typical English + code content, and handles CJK text reasonably.
 *
 * Accuracy is sufficient for:
 * - Showing "~1,234 tokens" in the UI
 * - Gating requests against rate-limit budgets
 * - Triggering context-window warnings
 *
 * NOT sufficient for:
 * - Billing or cost calculation
 * - Exact context-window packing
 */

import type { AIProviderType, AIMessage, AIMessageContent } from '@shared/types';

// ---------------------------------------------------------------------------
// CJK Unicode Range Detection
// ---------------------------------------------------------------------------

/**
 * Regex matching CJK Unified Ideographs and common CJK ranges.
 * Each CJK character typically maps to 1-2 tokens in most tokenizers.
 */
const CJK_REGEX =
  /[\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uF900-\uFAFF\uFF01-\uFF60\uFFE0-\uFFE6]/g;

/**
 * Regex matching sequences of whitespace (2+ spaces, tabs, newlines).
 */
const WHITESPACE_RUNS = /\s{2,}/g;

/**
 * Regex matching common code punctuation that increases token count.
 * Brackets, operators, semicolons, etc. tend to be individual tokens.
 */
const CODE_SPECIAL_CHARS = /[{}()[\];:=<>!&|+\-*/^%~@#$\\`"']/g;

// ---------------------------------------------------------------------------
// Token Estimation
// ---------------------------------------------------------------------------

/**
 * Estimate the number of tokens in a text string.
 *
 * Heuristic approach:
 * 1. Count CJK characters (each ≈ 1.5 tokens on average)
 * 2. Remove CJK chars from the text
 * 3. Compress whitespace runs (they tokenize efficiently)
 * 4. For remaining text: ~4 characters per token for English prose
 * 5. Add bonus tokens for code-heavy special characters
 *
 * @param text - The input text to estimate tokens for
 * @returns Estimated token count (always >= 1 for non-empty text)
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) {
    return 0;
  }

  // Step 1: Count CJK characters
  const cjkMatches = text.match(CJK_REGEX);
  const cjkCharCount = cjkMatches ? cjkMatches.length : 0;

  // CJK characters average ~1.5 tokens each
  const cjkTokens = Math.ceil(cjkCharCount * 1.5);

  // Step 2: Remove CJK characters from the text for English estimation
  const nonCjkText = text.replace(CJK_REGEX, ' ');

  // Step 3: Compress whitespace runs — tokenizers are efficient with whitespace
  const compressedText = nonCjkText.replace(WHITESPACE_RUNS, ' ').trim();

  if (compressedText.length === 0) {
    return Math.max(cjkTokens, 1);
  }

  // Step 4: Base estimation — ~4 characters per token for English
  const baseTokens = Math.ceil(compressedText.length / 4);

  // Step 5: Code adjustment — special chars often tokenize individually
  const specialMatches = compressedText.match(CODE_SPECIAL_CHARS);
  const specialCharCount = specialMatches ? specialMatches.length : 0;

  // Each cluster of special chars adds roughly 0.3 extra tokens
  // (many special chars ARE their own token, but they were already counted
  // in the baseTokens division, so we add a smaller bonus)
  const codeBonus = Math.ceil(specialCharCount * 0.3);

  return Math.max(cjkTokens + baseTokens + codeBonus, 1);
}

/**
 * Estimate the total token count for an array of AI messages.
 *
 * Each message has overhead for role markers, structural formatting, etc.
 * OpenAI documents this as ~4 tokens per message plus ~2 tokens for the
 * assistant priming. We use a flat 4-token overhead per message for simplicity.
 *
 * @param messages - Array of AI messages to estimate
 * @returns Total estimated token count
 */
export function estimateMessageTokens(messages: AIMessage[]): number {
  if (messages.length === 0) {
    return 0;
  }

  const PER_MESSAGE_OVERHEAD = 4;
  // Base overhead for the conversation format (roles, delimiters)
  const CONVERSATION_OVERHEAD = 3;

  let total = CONVERSATION_OVERHEAD;

  for (const message of messages) {
    total += PER_MESSAGE_OVERHEAD;
    total += estimateContentTokens(message.content);
  }

  return total;
}

/**
 * Extract token estimate from message content, handling both string
 * and multimodal content arrays.
 */
function estimateContentTokens(content: string | AIMessageContent[]): number {
  if (typeof content === 'string') {
    return estimateTokens(content);
  }

  let tokens = 0;
  for (const block of content) {
    if (block.type === 'text' && block.text) {
      tokens += estimateTokens(block.text);
    } else if (block.type === 'image') {
      // Vision tokens vary by detail level:
      // - low detail: ~85 tokens (fixed)
      // - high detail: ~170-765 tokens depending on resolution
      // We use conservative estimates for budgeting
      const detail = block.image_url?.detail ?? 'low';
      tokens += detail === 'high' ? 765 : 85;
    }
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Model Token Limits
// ---------------------------------------------------------------------------

/**
 * Known model context window sizes.
 *
 * These are maximum INPUT + OUTPUT tokens combined (context window).
 * Kept as a flat map for easy lookup; defaults to a conservative 4096
 * for unknown models.
 */
const MODEL_MAX_TOKENS: Record<string, number> = {
  // Claude (Anthropic)
  'claude-3-5-sonnet-20241022': 200_000,
  'claude-3-5-haiku-20241022': 200_000,
  'claude-3-opus-20240229': 200_000,
  'claude-3-sonnet-20240229': 200_000,
  'claude-3-haiku-20240307': 200_000,
  'claude-4-sonnet-20250514': 200_000,
  'claude-4-opus-20250514': 200_000,

  // OpenAI GPT
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4-turbo': 128_000,
  'gpt-4': 8_192,
  'gpt-3.5-turbo': 16_385,
  'o1-preview': 128_000,
  'o1-mini': 128_000,
  'o3-mini': 200_000,
  'codex-mini-latest': 200_000,

  // Google Gemini
  'gemini-1.5-pro': 2_000_000,
  'gemini-1.5-flash': 1_000_000,
  'gemini-2.0-flash': 1_000_000,
  'gemini-2.5-pro': 1_000_000,
  'gemini-2.5-flash': 1_000_000,
  'gemini-pro': 32_768,
};

/**
 * Default context window sizes per provider for unknown models.
 */
const PROVIDER_DEFAULTS: Record<AIProviderType, number> = {
  claude: 200_000,
  openai: 128_000,
  gemini: 1_000_000,
  ollama: 8_192,
  openrouter: 128_000,
  groq: 128_000,
  deepseek: 128_000,
  xai: 131_072,
  together: 128_000,
  fireworks: 128_000,
  deepinfra: 128_000,
  cerebras: 128_000,
  mistral: 128_000,
  perplexity: 128_000,
  copilot: 128_000,
  codex: 200_000,
  custom: 4_096,
};

/**
 * Get the maximum token limit (context window) for a specific model.
 *
 * Attempts an exact match first, then falls back to provider defaults.
 *
 * @param provider - The AI provider type
 * @param model    - The model identifier string
 * @returns Maximum token count for the model's context window
 */
export function getModelMaxTokens(provider: AIProviderType, model: string): number {
  // Exact match
  if (MODEL_MAX_TOKENS[model] !== undefined) {
    return MODEL_MAX_TOKENS[model];
  }

  // Partial match: check if the model string starts with a known key
  // This handles cases like "gpt-4o-2024-08-06" matching "gpt-4o"
  for (const [key, value] of Object.entries(MODEL_MAX_TOKENS)) {
    if (model.startsWith(key)) {
      return value;
    }
  }

  // Fall back to provider default
  return PROVIDER_DEFAULTS[provider] ?? 4_096;
}
