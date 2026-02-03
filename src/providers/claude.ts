/**
 * Claude (Anthropic) Provider
 * Integration với Claude API
 */

import { BaseProvider } from './base';
import type {
  ProviderConfig,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  StreamChunk,
  ProviderInfo,
  ToolDefinition,
  ToolCall,
} from './types';
import { logger } from '@shared/logger';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_VERSION = '2023-06-01';

/** Claude-specific message format */
interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: ClaudeContent[];
}

type ClaudeContent = 
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

/** Claude tool format */
interface ClaudeTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** Claude API response */
interface ClaudeResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: ClaudeContent[];
  model: string;
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export class ClaudeProvider extends BaseProvider {
  constructor(config: Partial<ProviderConfig> = {}) {
    super({
      type: 'claude',
      model: 'claude-3-5-sonnet-20241022',
      maxTokens: 4096,
      temperature: 0.7,
      ...config,
    });
  }

  getInfo(): ProviderInfo {
    return {
      type: 'claude',
      name: 'Claude (Anthropic)',
      description: 'Claude 3.5 Sonnet - Fast, intelligent, with vision capabilities',
      models: [
        {
          id: 'claude-3-5-sonnet-20241022',
          name: 'Claude 3.5 Sonnet',
          contextLength: 200000,
          supportsVision: true,
          supportsTools: true,
          isDefault: true,
        },
        {
          id: 'claude-3-5-haiku-20241022',
          name: 'Claude 3.5 Haiku',
          contextLength: 200000,
          supportsVision: true,
          supportsTools: true,
        },
        {
          id: 'claude-3-opus-20240229',
          name: 'Claude 3 Opus',
          contextLength: 200000,
          supportsVision: true,
          supportsTools: true,
        },
      ],
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      requiresApiKey: true,
    };
  }

  async initialize(): Promise<void> {
    if (!this.config.apiKey) {
      this.status = 'not_configured';
      throw new Error('Claude API key is required');
    }

    this.status = 'loading';

    try {
      // Test API key với một request nhỏ
      const response = await fetch(CLAUDE_API_URL, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Invalid API key');
      }

      this.status = 'ready';
      logger.info('Claude provider initialized successfully');
    } catch (error) {
      this.status = 'error';
      logger.error('Failed to initialize Claude provider:', error);
      throw error;
    }
  }

  async chat(
    messages: ChatMessage[],
    options: ChatOptions = {}
  ): Promise<ChatResponse> {
    if (!this.config.apiKey) {
      throw new Error('Claude API key is required');
    }

    const claudeMessages = this.formatMessages(messages, options);
    const tools = options.tools ? this.formatTools(options.tools) : undefined;

    const requestBody: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: options.maxTokens || this.config.maxTokens || 4096,
      messages: claudeMessages,
    };

    if (options.systemPrompt) {
      requestBody.system = options.systemPrompt;
    }

    if (tools && tools.length > 0) {
      requestBody.tools = tools;
    }

    if (options.temperature !== undefined) {
      requestBody.temperature = options.temperature;
    }

    if (options.stopSequences) {
      requestBody.stop_sequences = options.stopSequences;
    }

    try {
      const response = await fetch(CLAUDE_API_URL, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `API error: ${response.status}`);
      }

      const data: ClaudeResponse = await response.json();
      return this.parseResponse(data);
    } catch (error) {
      logger.error('Claude chat error:', error);
      throw error;
    }
  }

  async *streamChat(
    messages: ChatMessage[],
    options: ChatOptions = {}
  ): AsyncIterable<StreamChunk> {
    if (!this.config.apiKey) {
      throw new Error('Claude API key is required');
    }

    const claudeMessages = this.formatMessages(messages, options);
    const tools = options.tools ? this.formatTools(options.tools) : undefined;

    const requestBody: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: options.maxTokens || this.config.maxTokens || 4096,
      messages: claudeMessages,
      stream: true,
    };

    if (options.systemPrompt) {
      requestBody.system = options.systemPrompt;
    }

    if (tools && tools.length > 0) {
      requestBody.tools = tools;
    }

    try {
      const response = await fetch(CLAUDE_API_URL, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.json();
        yield { type: 'error', error: error.error?.message || 'API error' };
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        yield { type: 'error', error: 'No response body' };
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              yield { type: 'done' };
              return;
            }

            try {
              const event = JSON.parse(data);
              const chunk = this.parseStreamEvent(event);
              if (chunk) yield chunk;
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }

      yield { type: 'done' };
    } catch (error) {
      logger.error('Claude stream error:', error);
      yield { type: 'error', error: String(error) };
    }
  }

  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey || '',
      'anthropic-version': CLAUDE_VERSION,
    };
  }

  private formatMessages(
    messages: ChatMessage[],
    options: ChatOptions = {}
  ): ClaudeMessage[] {
    const claudeMessages: ClaudeMessage[] = [];

    // Handle tool results if present
    if (options.toolResults && options.toolResults.length > 0) {
      // Add tool results as user message
      const toolResultContent: ClaudeContent[] = options.toolResults.map(tr => ({
        type: 'tool_result' as const,
        tool_use_id: tr.toolCallId,
        content: tr.error || JSON.stringify(tr.result),
      }));

      claudeMessages.push({
        role: 'user',
        content: toolResultContent,
      });
    }

    for (const msg of messages) {
      if (msg.role === 'system') {
        // System messages are handled separately in Claude
        continue;
      }

      const content: ClaudeContent[] = [];

      // Add text content
      if (msg.content) {
        content.push({ type: 'text', text: msg.content });
      }

      // Add images if present
      if (msg.images && msg.images.length > 0) {
        for (const image of msg.images) {
          // Extract base64 data and media type
          const match = image.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            content.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: match[1],
                data: match[2],
              },
            });
          }
        }
      }

      if (content.length > 0) {
        claudeMessages.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content,
        });
      }
    }

    return claudeMessages;
  }

  private formatTools(tools: ToolDefinition[]): ClaudeTool[] {
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object',
        properties: tool.parameters.properties,
        required: tool.parameters.required,
      },
    }));
  }

  private parseResponse(response: ClaudeResponse): ChatResponse {
    let textContent = '';
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input,
        });
      }
    }

    return {
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      needsContinuation: response.stop_reason === 'tool_use',
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      model: response.model,
      finishReason: this.mapStopReason(response.stop_reason),
    };
  }

  private parseStreamEvent(event: Record<string, unknown>): StreamChunk | null {
    const type = event.type as string;

    if (type === 'content_block_delta') {
      const delta = event.delta as Record<string, unknown>;
      if (delta.type === 'text_delta') {
        return { type: 'text', content: delta.text as string };
      }
    }

    if (type === 'message_stop') {
      return { type: 'done' };
    }

    return null;
  }

  private mapStopReason(
    reason: string
  ): 'stop' | 'tool_use' | 'max_tokens' | 'error' {
    switch (reason) {
      case 'end_turn':
      case 'stop_sequence':
        return 'stop';
      case 'tool_use':
        return 'tool_use';
      case 'max_tokens':
        return 'max_tokens';
      default:
        return 'stop';
    }
  }
}

export default ClaudeProvider;
