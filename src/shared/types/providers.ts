/**
 * AI Provider types
 */

export interface AIProvider {
  id: string;
  name: string;
  
  // Configuration
  configure(config: ProviderConfig): Promise<void>;
  isConfigured(): boolean;
  
  // Chat
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
  chatStream?(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<ChatChunk>;
  
  // Tool calling
  supportsTools(): boolean;
  callWithTools?(
    messages: ChatMessage[], 
    tools: Tool[],
    options?: ChatOptions
  ): Promise<ToolCallResponse>;
  
  // Vision
  supportsVision(): boolean;
  chatWithImage?(
    messages: ChatMessage[],
    images: ImageData[],
    options?: ChatOptions
  ): Promise<ChatResponse>;
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface ChatResponse {
  content: string;
  toolCalls?: ToolCall[];
  finishReason?: string;
}

export interface ChatChunk {
  content: string;
  done: boolean;
}

export interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallResponse extends ChatResponse {
  toolCalls: ToolCall[];
}

export interface ImageData {
  data: string; // base64
  mimeType: string;
}

// JSON Schema for tool parameters
export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: string[];
  description?: string;
  [key: string]: unknown;
}
