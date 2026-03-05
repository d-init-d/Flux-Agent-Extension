/**
 * @module ai-client/providers/claude
 * @description Anthropic Claude provider implementation.
 *
 * Uses the Claude Messages API directly via `fetch()` (no SDK).
 * Supports streaming (SSE), vision (multimodal), and function calling (tools).
 *
 * @see https://docs.anthropic.com/en/api/messages
 * @see https://docs.anthropic.com/en/api/messages-streaming
 */

import type {
  AIProviderType,
  AIMessage,
  AIStreamChunk,
  AIRequestOptions,
  AIMessageContent,
} from '@shared/types';
import type { SSEEvent } from '../types';
import { BaseProvider } from '../base';
import { ExtensionError } from '@shared/errors';
import { ErrorCode } from '@shared/errors';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLAUDE_DEFAULT_BASE_URL = 'https://api.anthropic.com';
const CLAUDE_API_VERSION = '2023-06-01';
const CLAUDE_DEFAULT_MAX_TOKENS = 4096;

// ---------------------------------------------------------------------------
// Internal types for stream parsing state
// ---------------------------------------------------------------------------

/** Accumulator for a tool_use content block being streamed */
interface ToolCallAccumulator {
  id: string;
  name: string;
  jsonFragments: string[];
}

// ---------------------------------------------------------------------------
// Claude Provider
// ---------------------------------------------------------------------------

export class ClaudeProvider extends BaseProvider {
  readonly name: AIProviderType = 'claude';
  readonly supportsVision: boolean = true;
  readonly supportsStreaming: boolean = true;
  readonly supportsFunctionCalling: boolean = true;

  /**
   * Accumulated tool call state across `parseStreamChunk` invocations.
   * Reset each time a new chat() call starts (via `content_block_start`).
   */
  private currentToolCall: ToolCallAccumulator | null = null;

  /** Token usage accumulated during a streaming response. */
  private streamInputTokens: number = 0;
  private streamOutputTokens: number = 0;

  constructor() {
    super();
    this.initLogger();
  }

  // ── Abstract hook implementations ───────────────────────────────────────

  protected buildHeaders(): Record<string, string> {
    return {
      'x-api-key': this.getApiKey(),
      'anthropic-version': CLAUDE_API_VERSION,
      'Content-Type': 'application/json',
    };
  }

  protected getEndpoint(): string {
    const base = this.getBaseUrl(CLAUDE_DEFAULT_BASE_URL);
    return `${base}/v1/messages`;
  }

  protected buildRequestBody(
    messages: AIMessage[],
    options?: AIRequestOptions,
  ): Record<string, unknown> {
    this.assertInitialized();

    // Reset streaming state for each new request
    this.currentToolCall = null;
    this.streamInputTokens = 0;
    this.streamOutputTokens = 0;

    // Extract system messages from the conversation and merge into a single string
    const systemMessages: string[] = [];
    const conversationMessages: Array<{ role: string; content: unknown }> = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        // System messages: content is always a string for system role
        const text =
          typeof msg.content === 'string' ? msg.content : this.extractTextFromContent(msg.content);
        if (text) {
          systemMessages.push(text);
        }
      } else {
        conversationMessages.push({
          role: msg.role,
          content: this.convertMessageContent(msg.content),
        });
      }
    }

    // Prepend the config-level system prompt if present
    if (this.config.systemPrompt) {
      systemMessages.unshift(this.config.systemPrompt);
    }

    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: this.config.maxTokens ?? CLAUDE_DEFAULT_MAX_TOKENS,
      stream: true,
      messages: conversationMessages,
    };

    // System prompt as top-level field (Claude API requirement)
    if (systemMessages.length > 0) {
      body.system = systemMessages.join('\n\n');
    }

    // Temperature
    if (this.config.temperature !== undefined) {
      body.temperature = this.config.temperature;
    }

    // Tools (function calling)
    if (options?.tools && options.tools.length > 0) {
      body.tools = options.tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters,
      }));
    }

    return body;
  }

  protected parseStreamChunk(event: unknown): AIStreamChunk | null {
    const sseEvent = event as SSEEvent;
    const { event: eventType, data } = sseEvent;

    // Ignore pings and empty data
    if (eventType === 'ping' || !data) {
      return null;
    }

    // The SSE spec sends [DONE] for some providers; Claude uses message_stop
    if (data === '[DONE]') {
      return {
        type: 'done',
        usage: {
          inputTokens: this.streamInputTokens,
          outputTokens: this.streamOutputTokens,
        },
      };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(data) as Record<string, unknown>;
    } catch {
      this.logger.warn('Failed to parse SSE data', { data });
      return null;
    }

    switch (eventType) {
      case 'message_start':
        return this.handleMessageStart(parsed);

      case 'content_block_start':
        return this.handleContentBlockStart(parsed);

      case 'content_block_delta':
        return this.handleContentBlockDelta(parsed);

      case 'content_block_stop':
        return this.handleContentBlockStop();

      case 'message_delta':
        return this.handleMessageDelta(parsed);

      case 'message_stop':
        return {
          type: 'done',
          usage: {
            inputTokens: this.streamInputTokens,
            outputTokens: this.streamOutputTokens,
          },
        };

      case 'error':
        return {
          type: 'error',
          error: new Error(
            this.extractNestedString(parsed, 'error', 'message') ?? 'Unknown streaming error',
          ),
        };

      default:
        // Unknown event types are silently ignored
        this.logger.debug('Unknown SSE event type', { eventType });
        return null;
    }
  }

  protected mapErrorResponse(status: number, body: string): ExtensionError {
    // Try to extract a human-readable message from the response JSON
    let errorMessage = `Claude API error (HTTP ${status})`;
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      const nested = parsed.error as Record<string, unknown> | undefined;
      if (nested && typeof nested.message === 'string') {
        errorMessage = nested.message;
      }
    } catch {
      // Body is not JSON — use the raw body (truncated) as context
      if (body.length > 0) {
        errorMessage = `Claude API error (HTTP ${status}): ${body.slice(0, 200)}`;
      }
    }

    switch (status) {
      case 401:
      case 403:
        return new ExtensionError(ErrorCode.AI_INVALID_KEY, errorMessage, false, { status, body });

      case 429:
        return new ExtensionError(ErrorCode.AI_RATE_LIMIT, errorMessage, true, { status, body });

      case 404:
        return new ExtensionError(ErrorCode.AI_MODEL_NOT_FOUND, errorMessage, false, {
          status,
          body,
        });

      case 400:
        return new ExtensionError(ErrorCode.AI_API_ERROR, errorMessage, false, { status, body });

      default:
        // 500+ and anything else
        return new ExtensionError(ErrorCode.AI_API_ERROR, errorMessage, status >= 500, {
          status,
          body,
        });
    }
  }

  // ── Public: validateApiKey ──────────────────────────────────────────────

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const response = await fetch(`${CLAUDE_DEFAULT_BASE_URL}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': CLAUDE_API_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      });

      // Any non-auth error means the key itself is valid
      if (response.ok) {
        return true;
      }

      // 401/403 means bad key; anything else (429, 500, etc.) means key is fine
      return response.status !== 401 && response.status !== 403;
    } catch {
      // Network errors don't tell us about key validity — assume valid
      // so we don't block the user due to transient connectivity issues
      return true;
    }
  }

  // ── Private: message content conversion ─────────────────────────────────

  /**
   * Convert AIMessage content into Claude's expected format.
   *
   * - String content → returned as-is (Claude accepts plain strings)
   * - AIMessageContent[] → converted to Claude content blocks:
   *   - text blocks stay as { type: "text", text }
   *   - image blocks: data URLs are converted to Claude's base64 source format
   */
  private convertMessageContent(
    content: string | AIMessageContent[],
  ): string | Array<Record<string, unknown>> {
    if (typeof content === 'string') {
      return content;
    }

    const blocks: Array<Record<string, unknown>> = [];

    for (const part of content) {
      if (part.type === 'text' && part.text) {
        blocks.push({ type: 'text', text: part.text });
      } else if (part.type === 'image' && part.image_url?.url) {
        const imageBlock = this.convertImageToClaudeFormat(part.image_url.url);
        if (imageBlock) {
          blocks.push(imageBlock);
        }
      }
    }

    // If we ended up with a single text block, simplify to string
    if (blocks.length === 1 && blocks[0].type === 'text') {
      return blocks[0].text as string;
    }

    return blocks;
  }

  /**
   * Convert a data URL (e.g. `data:image/png;base64,iVBOR...`) to Claude's
   * image source format: `{ type: "image", source: { type: "base64", media_type, data } }`.
   *
   * For HTTPS URLs, Claude also supports `{ type: "image", source: { type: "url", url } }`,
   * but the Messages API currently only accepts base64 — so we only handle data URLs.
   */
  private convertImageToClaudeFormat(url: string): Record<string, unknown> | null {
    const dataUrlMatch = url.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
    if (dataUrlMatch) {
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: dataUrlMatch[1],
          data: dataUrlMatch[2],
        },
      };
    }

    // HTTPS URL — wrap in URL source (Claude supports this as of newer versions)
    if (url.startsWith('https://')) {
      return {
        type: 'image',
        source: {
          type: 'url',
          url,
        },
      };
    }

    this.logger.warn('Unsupported image URL format, skipping', { url: url.slice(0, 80) });
    return null;
  }

  /**
   * Extract plain text from an AIMessageContent array.
   * Used for system messages which should be plain strings.
   */
  private extractTextFromContent(content: AIMessageContent[]): string {
    return content
      .filter((part) => part.type === 'text' && part.text)
      .map((part) => part.text!)
      .join('\n');
  }

  // ── Private: SSE event handlers ─────────────────────────────────────────

  private handleMessageStart(parsed: Record<string, unknown>): AIStreamChunk | null {
    // Extract input token usage from the message_start event
    const message = parsed.message as Record<string, unknown> | undefined;
    if (message) {
      const usage = message.usage as Record<string, unknown> | undefined;
      if (usage && typeof usage.input_tokens === 'number') {
        this.streamInputTokens = usage.input_tokens;
      }
    }
    // No chunk to yield for message_start
    return null;
  }

  private handleContentBlockStart(parsed: Record<string, unknown>): AIStreamChunk | null {
    const contentBlock = parsed.content_block as Record<string, unknown> | undefined;
    if (!contentBlock) {
      return null;
    }

    if (contentBlock.type === 'tool_use') {
      // Start accumulating a tool call
      this.currentToolCall = {
        id: (contentBlock.id as string) ?? '',
        name: (contentBlock.name as string) ?? '',
        jsonFragments: [],
      };
    }

    // No chunk to yield yet — content arrives in deltas
    return null;
  }

  private handleContentBlockDelta(parsed: Record<string, unknown>): AIStreamChunk | null {
    const delta = parsed.delta as Record<string, unknown> | undefined;
    if (!delta) {
      return null;
    }

    if (delta.type === 'text_delta' && typeof delta.text === 'string') {
      return {
        type: 'text',
        content: delta.text,
      };
    }

    if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
      // Accumulate tool call argument fragments
      if (this.currentToolCall) {
        this.currentToolCall.jsonFragments.push(delta.partial_json);
      }
      // Don't yield partial tool call data — wait for content_block_stop
      return null;
    }

    return null;
  }

  private handleContentBlockStop(): AIStreamChunk | null {
    // If we were accumulating a tool call, emit the complete tool_call chunk
    if (this.currentToolCall) {
      const toolCall = this.currentToolCall;
      this.currentToolCall = null;

      return {
        type: 'tool_call',
        toolCall: {
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.jsonFragments.join(''),
        },
      };
    }

    return null;
  }

  private handleMessageDelta(parsed: Record<string, unknown>): AIStreamChunk | null {
    // Extract output token usage
    const usage = parsed.usage as Record<string, unknown> | undefined;
    if (usage && typeof usage.output_tokens === 'number') {
      this.streamOutputTokens = usage.output_tokens;
    }

    // No chunk to yield — usage is captured and emitted with message_stop
    return null;
  }

  // ── Private: utilities ──────────────────────────────────────────────────

  /**
   * Safely extract a nested string property: `obj[key1][key2]`.
   */
  private extractNestedString(
    obj: Record<string, unknown>,
    key1: string,
    key2: string,
  ): string | null {
    const nested = obj[key1] as Record<string, unknown> | undefined;
    if (nested && typeof nested[key2] === 'string') {
      return nested[key2] as string;
    }
    return null;
  }
}
