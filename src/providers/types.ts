/**
 * AI Provider Types
 * Định nghĩa các types chung cho tất cả AI providers
 */

/** Các provider được hỗ trợ */
export type ProviderType = 'claude' | 'openai' | 'gemini' | 'ollama';

/** Trạng thái của provider */
export type ProviderStatus = 'ready' | 'error' | 'loading' | 'not_configured';

/** Thông tin cấu hình provider */
export interface ProviderConfig {
  type: ProviderType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

/** Message trong conversation */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** Image data (base64) nếu có */
  images?: string[];
  /** Timestamp */
  timestamp?: number;
}

/** Tool/Function definition cho AI */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
      items?: { type: string };
    }>;
    required?: string[];
  };
}

/** Tool call từ AI */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Kết quả từ tool execution */
export interface ToolResult {
  toolCallId: string;
  result: unknown;
  error?: string;
}

/** Options cho chat request */
export interface ChatOptions {
  /** System prompt */
  systemPrompt?: string;
  /** Tools available */
  tools?: ToolDefinition[];
  /** Max tokens for response */
  maxTokens?: number;
  /** Temperature (0-1) */
  temperature?: number;
  /** Stop sequences */
  stopSequences?: string[];
  /** Stream response */
  stream?: boolean;
  /** Tool results từ lần gọi trước */
  toolResults?: ToolResult[];
}

/** Response từ AI */
export interface ChatResponse {
  /** Text content */
  content: string;
  /** Tool calls nếu có */
  toolCalls?: ToolCall[];
  /** Có cần tiếp tục không (tool use) */
  needsContinuation?: boolean;
  /** Token usage */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** Model used */
  model?: string;
  /** Finish reason */
  finishReason?: 'stop' | 'tool_use' | 'max_tokens' | 'error';
}

/** Stream chunk */
export interface StreamChunk {
  type: 'text' | 'tool_call' | 'error' | 'done';
  content?: string;
  toolCall?: ToolCall;
  error?: string;
}

/** Provider info */
export interface ProviderInfo {
  type: ProviderType;
  name: string;
  description: string;
  models: ModelInfo[];
  supportsVision: boolean;
  supportsTools: boolean;
  supportsStreaming: boolean;
  requiresApiKey: boolean;
}

/** Model info */
export interface ModelInfo {
  id: string;
  name: string;
  contextLength: number;
  supportsVision: boolean;
  supportsTools: boolean;
  isDefault?: boolean;
}

/** Storage key cho API keys */
export const STORAGE_KEYS = {
  CLAUDE_API_KEY: 'claude_api_key',
  OPENAI_API_KEY: 'openai_api_key',
  GEMINI_API_KEY: 'gemini_api_key',
  OLLAMA_BASE_URL: 'ollama_base_url',
  SELECTED_PROVIDER: 'selected_provider',
  SELECTED_MODEL: 'selected_model',
} as const;
