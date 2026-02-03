/**
 * Google Gemini Provider
 * Integration với Google Gemini API
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

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Gemini message format */
interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

/** Gemini tool format */
interface GeminiTool {
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  }>;
}

/** Gemini API response */
interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: GeminiPart[];
      role: 'model';
    };
    finishReason: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER';
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

export class GeminiProvider extends BaseProvider {
  constructor(config: Partial<ProviderConfig> = {}) {
    super({
      type: 'gemini',
      model: 'gemini-1.5-pro',
      maxTokens: 8192,
      temperature: 0.7,
      ...config,
    });
  }

  getInfo(): ProviderInfo {
    return {
      type: 'gemini',
      name: 'Google Gemini',
      description: 'Gemini 1.5 Pro - Google multimodal AI',
      models: [
        {
          id: 'gemini-1.5-pro',
          name: 'Gemini 1.5 Pro',
          contextLength: 1000000,
          supportsVision: true,
          supportsTools: true,
          isDefault: true,
        },
        {
          id: 'gemini-1.5-flash',
          name: 'Gemini 1.5 Flash',
          contextLength: 1000000,
          supportsVision: true,
          supportsTools: true,
        },
        {
          id: 'gemini-2.0-flash-exp',
          name: 'Gemini 2.0 Flash (Experimental)',
          contextLength: 1000000,
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
      throw new Error('Gemini API key is required');
    }

    this.status = 'loading';

    try {
      // Test API key
      const response = await fetch(
        `${GEMINI_API_URL}/${this.config.model}:generateContent?key=${this.config.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Hi' }] }],
            generationConfig: { maxOutputTokens: 10 },
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Invalid API key');
      }

      this.status = 'ready';
      logger.info('Gemini provider initialized successfully');
    } catch (error) {
      this.status = 'error';
      logger.error('Failed to initialize Gemini provider:', error);
      throw error;
    }
  }

  async chat(
    messages: ChatMessage[],
    options: ChatOptions = {}
  ): Promise<ChatResponse> {
    if (!this.config.apiKey) {
      throw new Error('Gemini API key is required');
    }

    const contents = this.formatMessages(messages, options);
    const tools = options.tools ? this.formatTools(options.tools) : undefined;

    const requestBody: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: options.maxTokens || this.config.maxTokens || 8192,
        temperature: options.temperature ?? this.config.temperature ?? 0.7,
      },
    };

    if (options.systemPrompt) {
      requestBody.systemInstruction = {
        parts: [{ text: options.systemPrompt }],
      };
    }

    if (tools) {
      requestBody.tools = [tools];
    }

    if (options.stopSequences) {
      (requestBody.generationConfig as Record<string, unknown>).stopSequences = options.stopSequences;
    }

    try {
      const response = await fetch(
        `${GEMINI_API_URL}/${this.config.model}:generateContent?key=${this.config.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `API error: ${response.status}`);
      }

      const data: GeminiResponse = await response.json();
      return this.parseResponse(data);
    } catch (error) {
      logger.error('Gemini chat error:', error);
      throw error;
    }
  }

  async *streamChat(
    messages: ChatMessage[],
    options: ChatOptions = {}
  ): AsyncIterable<StreamChunk> {
    if (!this.config.apiKey) {
      throw new Error('Gemini API key is required');
    }

    const contents = this.formatMessages(messages, options);
    const tools = options.tools ? this.formatTools(options.tools) : undefined;

    const requestBody: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: options.maxTokens || this.config.maxTokens || 8192,
        temperature: options.temperature ?? this.config.temperature ?? 0.7,
      },
    };

    if (options.systemPrompt) {
      requestBody.systemInstruction = {
        parts: [{ text: options.systemPrompt }],
      };
    }

    if (tools) {
      requestBody.tools = [tools];
    }

    try {
      const response = await fetch(
        `${GEMINI_API_URL}/${this.config.model}:streamGenerateContent?key=${this.config.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        }
      );

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

        // Gemini returns newline-delimited JSON
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            // Handle array format from stream
            let data = line.trim();
            if (data.startsWith('[')) data = data.slice(1);
            if (data.startsWith(',')) data = data.slice(1);
            if (data.endsWith(']')) data = data.slice(0, -1);
            if (!data.trim()) continue;

            const event = JSON.parse(data);
            const chunk = this.parseStreamEvent(event);
            if (chunk) yield chunk;
          } catch {
            // Skip invalid JSON
          }
        }
      }

      yield { type: 'done' };
    } catch (error) {
      logger.error('Gemini stream error:', error);
      yield { type: 'error', error: String(error) };
    }
  }

  private formatMessages(
    messages: ChatMessage[],
    options: ChatOptions = {}
  ): GeminiContent[] {
    const contents: GeminiContent[] = [];

    // Handle tool results
    if (options.toolResults && options.toolResults.length > 0) {
      const parts: GeminiPart[] = options.toolResults.map(tr => ({
        functionResponse: {
          name: tr.toolCallId,
          response: { result: tr.error || tr.result },
        },
      }));

      contents.push({
        role: 'user',
        parts,
      });
    }

    for (const msg of messages) {
      if (msg.role === 'system') {
        // System messages handled separately
        continue;
      }

      const parts: GeminiPart[] = [];

      // Add text
      if (msg.content) {
        parts.push({ text: msg.content });
      }

      // Add images
      if (msg.images && msg.images.length > 0) {
        for (const image of msg.images) {
          const match = image.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            parts.push({
              inlineData: {
                mimeType: match[1],
                data: match[2],
              },
            });
          }
        }
      }

      if (parts.length > 0) {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts,
        });
      }
    }

    return contents;
  }

  private formatTools(tools: ToolDefinition[]): GeminiTool {
    return {
      functionDeclarations: tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: tool.parameters.properties,
          required: tool.parameters.required,
        },
      })),
    };
  }

  private parseResponse(response: GeminiResponse): ChatResponse {
    const candidate = response.candidates[0];
    if (!candidate) {
      throw new Error('No response from Gemini');
    }

    let textContent = '';
    const toolCalls: ToolCall[] = [];

    for (const part of candidate.content.parts) {
      if ('text' in part) {
        textContent += part.text;
      } else if ('functionCall' in part) {
        toolCalls.push({
          id: part.functionCall.name,
          name: part.functionCall.name,
          arguments: part.functionCall.args,
        });
      }
    }

    const hasFunctionCalls = toolCalls.length > 0;

    return {
      content: textContent,
      toolCalls: hasFunctionCalls ? toolCalls : undefined,
      needsContinuation: hasFunctionCalls,
      usage: response.usageMetadata
        ? {
            promptTokens: response.usageMetadata.promptTokenCount,
            completionTokens: response.usageMetadata.candidatesTokenCount,
            totalTokens: response.usageMetadata.totalTokenCount,
          }
        : undefined,
      model: this.config.model,
      finishReason: this.mapFinishReason(candidate.finishReason),
    };
  }

  private parseStreamEvent(event: Record<string, unknown>): StreamChunk | null {
    const candidates = event.candidates as Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;

    if (!candidates || candidates.length === 0) return null;

    const parts = candidates[0].content?.parts;
    if (!parts || parts.length === 0) return null;

    for (const part of parts) {
      if (part.text) {
        return { type: 'text', content: part.text };
      }
    }

    return null;
  }

  private mapFinishReason(
    reason: string
  ): 'stop' | 'tool_use' | 'max_tokens' | 'error' {
    switch (reason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'max_tokens';
      case 'SAFETY':
      case 'RECITATION':
      case 'OTHER':
        return 'error';
      default:
        return 'stop';
    }
  }
}

export default GeminiProvider;
