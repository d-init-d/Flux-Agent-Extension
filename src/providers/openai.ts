/**
 * OpenAI Provider
 * Integration với OpenAI GPT-4 API
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

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

/** OpenAI message format */
interface OpenAIMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | OpenAIContent[];
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

type OpenAIContent =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } };

/** OpenAI tool call */
interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/** OpenAI tool format */
interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

/** OpenAI API response */
interface OpenAIResponse {
  id: string;
  object: 'chat.completion';
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: 'stop' | 'tool_calls' | 'length' | 'content_filter';
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenAIProvider extends BaseProvider {
  constructor(config: Partial<ProviderConfig> = {}) {
    super({
      type: 'openai',
      model: 'gpt-4o',
      maxTokens: 4096,
      temperature: 0.7,
      ...config,
    });
  }

  getInfo(): ProviderInfo {
    return {
      type: 'openai',
      name: 'OpenAI GPT-4',
      description: 'GPT-4o - OpenAI flagship model with vision',
      models: [
        {
          id: 'gpt-4o',
          name: 'GPT-4o',
          contextLength: 128000,
          supportsVision: true,
          supportsTools: true,
          isDefault: true,
        },
        {
          id: 'gpt-4o-mini',
          name: 'GPT-4o Mini',
          contextLength: 128000,
          supportsVision: true,
          supportsTools: true,
        },
        {
          id: 'gpt-4-turbo',
          name: 'GPT-4 Turbo',
          contextLength: 128000,
          supportsVision: true,
          supportsTools: true,
        },
        {
          id: 'gpt-3.5-turbo',
          name: 'GPT-3.5 Turbo',
          contextLength: 16385,
          supportsVision: false,
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
      throw new Error('OpenAI API key is required');
    }

    this.status = 'loading';

    try {
      // Test API key
      const response = await fetch(OPENAI_API_URL, {
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
      logger.info('OpenAI provider initialized successfully');
    } catch (error) {
      this.status = 'error';
      logger.error('Failed to initialize OpenAI provider:', error);
      throw error;
    }
  }

  async chat(
    messages: ChatMessage[],
    options: ChatOptions = {}
  ): Promise<ChatResponse> {
    if (!this.config.apiKey) {
      throw new Error('OpenAI API key is required');
    }

    const openaiMessages = this.formatMessages(messages, options);
    const tools = options.tools ? this.formatTools(options.tools) : undefined;

    const requestBody: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: options.maxTokens || this.config.maxTokens || 4096,
      messages: openaiMessages,
    };

    if (tools && tools.length > 0) {
      requestBody.tools = tools;
      requestBody.tool_choice = 'auto';
    }

    if (options.temperature !== undefined) {
      requestBody.temperature = options.temperature;
    }

    if (options.stopSequences) {
      requestBody.stop = options.stopSequences;
    }

    try {
      const response = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `API error: ${response.status}`);
      }

      const data: OpenAIResponse = await response.json();
      return this.parseResponse(data);
    } catch (error) {
      logger.error('OpenAI chat error:', error);
      throw error;
    }
  }

  async *streamChat(
    messages: ChatMessage[],
    options: ChatOptions = {}
  ): AsyncIterable<StreamChunk> {
    if (!this.config.apiKey) {
      throw new Error('OpenAI API key is required');
    }

    const openaiMessages = this.formatMessages(messages, options);
    const tools = options.tools ? this.formatTools(options.tools) : undefined;

    const requestBody: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: options.maxTokens || this.config.maxTokens || 4096,
      messages: openaiMessages,
      stream: true,
    };

    if (tools && tools.length > 0) {
      requestBody.tools = tools;
    }

    try {
      const response = await fetch(OPENAI_API_URL, {
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
      logger.error('OpenAI stream error:', error);
      yield { type: 'error', error: String(error) };
    }
  }

  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
    };
  }

  private formatMessages(
    messages: ChatMessage[],
    options: ChatOptions = {}
  ): OpenAIMessage[] {
    const openaiMessages: OpenAIMessage[] = [];

    // Add system prompt
    if (options.systemPrompt) {
      openaiMessages.push({
        role: 'system',
        content: options.systemPrompt,
      });
    }

    // Handle tool results
    if (options.toolResults && options.toolResults.length > 0) {
      for (const tr of options.toolResults) {
        openaiMessages.push({
          role: 'tool',
          tool_call_id: tr.toolCallId,
          content: tr.error || JSON.stringify(tr.result),
        });
      }
    }

    for (const msg of messages) {
      if (msg.role === 'system') {
        openaiMessages.push({
          role: 'system',
          content: msg.content,
        });
        continue;
      }

      // Check if message has images
      if (msg.images && msg.images.length > 0) {
        const content: OpenAIContent[] = [];

        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }

        for (const image of msg.images) {
          content.push({
            type: 'image_url',
            image_url: { url: image, detail: 'auto' },
          });
        }

        openaiMessages.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content,
        });
      } else {
        openaiMessages.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: msg.content,
        });
      }
    }

    return openaiMessages;
  }

  private formatTools(tools: ToolDefinition[]): OpenAITool[] {
    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: tool.parameters.properties,
          required: tool.parameters.required,
        },
      },
    }));
  }

  private parseResponse(response: OpenAIResponse): ChatResponse {
    const choice = response.choices[0];
    const message = choice.message;

    const toolCalls: ToolCall[] = [];
    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        try {
          toolCalls.push({
            id: tc.id,
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments),
          });
        } catch {
          logger.error('Failed to parse tool call arguments');
        }
      }
    }

    return {
      content: message.content || '',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      needsContinuation: choice.finish_reason === 'tool_calls',
      usage: {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      },
      model: response.model,
      finishReason: this.mapFinishReason(choice.finish_reason),
    };
  }

  private parseStreamEvent(event: Record<string, unknown>): StreamChunk | null {
    const choices = event.choices as Array<{
      delta?: { content?: string; tool_calls?: unknown[] };
    }>;

    if (!choices || choices.length === 0) return null;

    const delta = choices[0].delta;
    if (!delta) return null;

    if (delta.content) {
      return { type: 'text', content: delta.content };
    }

    return null;
  }

  private mapFinishReason(
    reason: string
  ): 'stop' | 'tool_use' | 'max_tokens' | 'error' {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'tool_calls':
        return 'tool_use';
      case 'length':
        return 'max_tokens';
      default:
        return 'stop';
    }
  }
}

export default OpenAIProvider;
