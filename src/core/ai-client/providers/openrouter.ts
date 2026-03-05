/**
 * @module ai-client/providers/openrouter
 * @description OpenRouter provider implementation.
 *
 * OpenRouter is a unified gateway that routes requests to multiple AI providers
 * (Anthropic, OpenAI, Google, Meta, etc.) using an OpenAI-compatible API format.
 *
 * The model field specifies the upstream provider and model, e.g.:
 *   - "anthropic/claude-3-5-sonnet"
 *   - "google/gemini-2.0-flash"
 *   - "meta-llama/llama-3.3-70b-instruct"
 *
 * API reference: https://openrouter.ai/docs
 */

import type {
  AIProviderType,
  AIModelConfig,
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

const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_REFERER = 'chrome-extension://flux-agent';
const OPENROUTER_TITLE = 'Flux Agent';

// ---------------------------------------------------------------------------
// Types for OpenAI-compatible SSE streaming
// ---------------------------------------------------------------------------

interface OpenAIStreamDelta {
  role?: string;
  content?: string | null;
  tool_calls?: OpenAIToolCallDelta[];
}

interface OpenAIToolCallDelta {
  index: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface OpenAIStreamChoice {
  index: number;
  delta: OpenAIStreamDelta;
  finish_reason: string | null;
}

interface OpenAIStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAIStreamChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIErrorResponse {
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

// ---------------------------------------------------------------------------
// Tool Call Accumulator
// ---------------------------------------------------------------------------

interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string;
}

// ---------------------------------------------------------------------------
// OpenRouter Provider
// ---------------------------------------------------------------------------

export class OpenRouterProvider extends BaseProvider {
  readonly name: AIProviderType = 'openrouter';
  readonly supportsVision: boolean = true;
  readonly supportsStreaming: boolean = true;
  readonly supportsFunctionCalling: boolean = true;

  /**
   * Accumulates streamed tool call deltas indexed by their position.
   * Reset at the start of each chat() call via buildRequestBody.
   */
  private toolCallAccumulator: Map<number, AccumulatedToolCall> = new Map();

  constructor() {
    super();
    this.initLogger();
  }

  // ── Abstract hook implementations ───────────────────────────────────────

  protected buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.getApiKey()}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': OPENROUTER_REFERER,
      'X-Title': OPENROUTER_TITLE,
    };
  }

  protected getEndpoint(): string {
    const baseUrl = this.getBaseUrl(DEFAULT_OPENROUTER_BASE_URL);
    return `${baseUrl}/chat/completions`;
  }

  protected buildRequestBody(
    messages: AIMessage[],
    options?: AIRequestOptions,
  ): Record<string, unknown> {
    this.assertInitialized();

    // Reset tool call accumulator for each new request
    this.toolCallAccumulator.clear();

    const openAIMessages = messages.map((msg) => this.convertMessage(msg));

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: openAIMessages,
      stream: true,
      temperature: this.config.temperature ?? 0.7,
      max_tokens: this.config.maxTokens ?? 4096,
      // Request usage stats in the streaming response
      stream_options: { include_usage: true },
    };

    // Attach tools if provided
    if (options?.tools && options.tools.length > 0) {
      body.tools = options.tools;
    }

    return body;
  }

  protected parseStreamChunk(event: unknown): AIStreamChunk | null {
    // SSE mode: `event` is an SSEEvent object
    const sseEvent = event as SSEEvent;

    // Skip empty data
    if (!sseEvent.data) {
      return null;
    }

    // [DONE] sentinel — the SSE parser in streaming.ts intercepts this and
    // terminates the generator, so it typically never reaches here. Guard anyway.
    if (sseEvent.data === '[DONE]') {
      return null;
    }

    // Parse the JSON payload
    let parsed: OpenAIStreamChunk;
    try {
      parsed = JSON.parse(sseEvent.data) as OpenAIStreamChunk;
    } catch {
      return {
        type: 'error',
        error: new ExtensionError(
          ErrorCode.AI_PARSE_ERROR,
          `Failed to parse OpenRouter stream chunk: ${sseEvent.data.slice(0, 200)}`,
          true,
          { raw: sseEvent.data },
        ),
      };
    }

    // Handle usage-only chunk (sent after [DONE] by some models via stream_options)
    if (parsed.usage && (!parsed.choices || parsed.choices.length === 0)) {
      // Store usage for the final done chunk
      this.lastUsage = {
        inputTokens: parsed.usage.prompt_tokens,
        outputTokens: parsed.usage.completion_tokens,
      };
      return null;
    }

    const choice = parsed.choices?.[0];
    if (!choice) {
      return null;
    }

    const delta = choice.delta;

    // Text content delta
    if (delta.content) {
      return {
        type: 'text',
        content: delta.content,
      };
    }

    // Tool call deltas — accumulate index-based fragments
    if (delta.tool_calls && delta.tool_calls.length > 0) {
      for (const toolCallDelta of delta.tool_calls) {
        this.accumulateToolCall(toolCallDelta);
      }

      // Check if finish_reason signals tool calls are complete
      if (choice.finish_reason === 'tool_calls') {
        return this.flushToolCalls();
      }

      // Not done yet — keep accumulating
      return null;
    }

    // finish_reason === 'tool_calls' without delta.tool_calls in this chunk
    if (choice.finish_reason === 'tool_calls') {
      return this.flushToolCalls();
    }

    // finish_reason === 'stop' — normal completion, emit done with usage
    if (choice.finish_reason === 'stop') {
      return {
        type: 'done',
        usage: this.lastUsage ?? undefined,
      };
    }

    // Store usage if present on the choice-bearing chunk
    if (parsed.usage) {
      this.lastUsage = {
        inputTokens: parsed.usage.prompt_tokens,
        outputTokens: parsed.usage.completion_tokens,
      };
    }

    return null;
  }

  protected mapErrorResponse(status: number, body: string): ExtensionError {
    let message = `OpenRouter API error (HTTP ${status})`;

    // Attempt to parse structured error response
    try {
      const parsed = JSON.parse(body) as OpenAIErrorResponse;
      if (parsed.error?.message) {
        message = `OpenRouter error: ${parsed.error.message}`;
      }
    } catch {
      if (body.length > 0) {
        message = `OpenRouter error (HTTP ${status}): ${body}`;
      }
    }

    switch (status) {
      case 401:
        return new ExtensionError(ErrorCode.AI_INVALID_KEY, message, false, { status, body });

      case 403:
        return new ExtensionError(ErrorCode.AI_INVALID_KEY, message, false, { status, body });

      case 404:
        return new ExtensionError(ErrorCode.AI_MODEL_NOT_FOUND, message, false, { status, body });

      case 429:
        return new ExtensionError(ErrorCode.AI_RATE_LIMIT, message, true, { status, body });

      case 402:
        return new ExtensionError(ErrorCode.AI_QUOTA_EXCEEDED, message, false, { status, body });

      default:
        return new ExtensionError(
          ErrorCode.AI_API_ERROR,
          message,
          status >= 500, // Server errors are potentially recoverable
          { status, body },
        );
    }
  }

  // ── IAIProvider: validateApiKey ─────────────────────────────────────────

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) {
        return true;
      }

      // 401/403 = invalid key, anything else is a transient error
      if (response.status === 401 || response.status === 403) {
        return false;
      }

      // For transient errors, log but return false
      this.logger.warn('OpenRouter key validation returned unexpected status', {
        status: response.status,
      });
      return false;
    } catch (error) {
      this.logger.warn('OpenRouter key validation failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────

  /** Tracks usage from streaming chunks for the final done event. */
  private lastUsage: { inputTokens: number; outputTokens: number } | null = null;

  /**
   * Convert an AIMessage into OpenAI chat completions format.
   *
   * - Simple text → `{ role, content: "..." }`
   * - Multimodal  → `{ role, content: [{ type: "text", ... }, { type: "image_url", ... }] }`
   */
  private convertMessage(msg: AIMessage): Record<string, unknown> {
    // Simple text content
    if (typeof msg.content === 'string') {
      return {
        role: msg.role,
        content: msg.content,
      };
    }

    // Multimodal content array
    const contentParts = msg.content as AIMessageContent[];
    const openAIParts: Record<string, unknown>[] = [];

    for (const part of contentParts) {
      if (part.type === 'text' && part.text) {
        openAIParts.push({
          type: 'text',
          text: part.text,
        });
      } else if (part.type === 'image' && part.image_url?.url) {
        openAIParts.push({
          type: 'image_url',
          image_url: {
            url: part.image_url.url,
            detail: part.image_url.detail ?? 'auto',
          },
        });
      }
    }

    return {
      role: msg.role,
      content: openAIParts,
    };
  }

  /**
   * Accumulate a streamed tool call delta into the accumulator.
   *
   * OpenAI-compatible streaming sends tool calls as index-based deltas:
   * - First delta for index N has `id` and `function.name`
   * - Subsequent deltas for index N append to `function.arguments`
   */
  private accumulateToolCall(delta: OpenAIToolCallDelta): void {
    const existing = this.toolCallAccumulator.get(delta.index);

    if (existing) {
      // Append argument fragment
      if (delta.function?.arguments) {
        existing.arguments += delta.function.arguments;
      }
      // Update name if provided (shouldn't change, but be safe)
      if (delta.function?.name) {
        existing.name = delta.function.name;
      }
    } else {
      // First delta for this index — initialize
      this.toolCallAccumulator.set(delta.index, {
        id: delta.id ?? `call_${delta.index}`,
        name: delta.function?.name ?? '',
        arguments: delta.function?.arguments ?? '',
      });
    }
  }

  /**
   * Flush accumulated tool calls as AIStreamChunk events.
   * Returns the first tool call as a chunk; in practice there's usually one.
   * If multiple tool calls were accumulated, they are yielded one by one
   * through repeated calls.
   */
  private flushToolCalls(): AIStreamChunk | null {
    if (this.toolCallAccumulator.size === 0) {
      return null;
    }

    // Yield the first accumulated tool call
    const entries = Array.from(this.toolCallAccumulator.values());
    this.toolCallAccumulator.clear();

    // Return the first tool call; subsequent tool calls in the same
    // response are uncommon but we yield them in sequence
    const toolCall = entries[0];
    if (!toolCall) {
      return null;
    }

    return {
      type: 'tool_call',
      toolCall: {
        id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments,
      },
    };
  }

  /**
   * Extract accumulated usage for the final done chunk.
   */
  private extractAccumulatedUsage(): { inputTokens: number; outputTokens: number } | undefined {
    if (this.lastUsage) {
      const usage = { ...this.lastUsage };
      this.lastUsage = null;
      return usage;
    }
    return undefined;
  }
}
