/**
 * Supported AI providers
 */
export type AIProviderType =
  | 'claude' // Anthropic Claude
  | 'openai' // OpenAI GPT
  | 'gemini' // Google Gemini
  | 'ollama' // Local Ollama
  | 'openrouter' // OpenRouter (multi-provider)
  | 'groq' // Groq (fast inference)
  | 'deepseek' // DeepSeek
  | 'xai' // xAI (Grok)
  | 'together' // Together AI
  | 'fireworks' // Fireworks AI
  | 'deepinfra' // Deep Infra
  | 'cerebras' // Cerebras (fast inference)
  | 'mistral' // Mistral AI
  | 'perplexity' // Perplexity AI
  | 'copilot' // GitHub Copilot (OAuth)
  | 'custom'; // Custom API endpoint

/**
 * AI model configuration
 */
export interface AIModelConfig {
  provider: AIProviderType;
  model: string; // e.g., 'claude-3-5-sonnet-20241022'
  apiKey?: string; // Required for cloud providers
  baseUrl?: string; // For custom/ollama providers
  maxTokens?: number; // Max response tokens
  temperature?: number; // 0-1 creativity scale
  systemPrompt?: string; // Override default system prompt
}

/**
 * Message format for AI conversation
 */
export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | AIMessageContent[];
  timestamp?: number;
}

/**
 * Content block within an AI message (for multimodal)
 */
export interface AIMessageContent {
  type: 'text' | 'image';
  text?: string;
  image_url?: {
    url: string; // Base64 data URL or HTTPS URL
    detail?: 'low' | 'high'; // Image quality for vision
  };
}

/**
 * Streaming chunk from AI
 */
export interface AIStreamChunk {
  type: 'text' | 'tool_call' | 'error' | 'done';
  content?: string;
  toolCall?: {
    id: string;
    name: string;
    arguments: string;
  };
  error?: Error;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * AI request options
 */
export interface AIRequestOptions {
  signal?: AbortSignal;
  onChunk?: (chunk: AIStreamChunk) => void;
  tools?: AITool[];
  maxRetries?: number;
  timeout?: number;
}

/**
 * Tool definition for function calling
 */
export interface AITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
}
