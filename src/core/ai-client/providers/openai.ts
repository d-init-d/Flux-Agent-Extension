/**
 * @module ai-client/providers/openai
 * @description OpenAI Chat Completions API provider.
 *
 * Implements the BaseProvider template-method hooks for OpenAI's streaming API
 * using raw `fetch()` — no SDK dependency.
 *
 * Supports:
 *  - GPT-4o / GPT-4 Turbo / GPT-3.5 Turbo models
 *  - Vision (multimodal image_url content blocks)
 *  - Streaming via SSE with `stream_options.include_usage`
 *  - Function calling / tool use with streamed tool-call deltas
 *  - Custom base URL override (Azure OpenAI, proxies, etc.)
 */

import type {
  AIProviderType,
  AIMessage,
  AIStreamChunk,
  AIRequestOptions,
  AIMessageContent,
  AITool,
} from '@shared/types';
import type { SSEEvent } from '../types';
import { BaseProvider } from '../base';
import { ExtensionError } from '@shared/errors';
import { ErrorCode } from '@shared/errors';

// ---------------------------------------------------------------------------
// Internal types for OpenAI API shapes
// ---------------------------------------------------------------------------

/** OpenAI message format (request body) */
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | OpenAIContentPart[];
}

/** Multimodal content part in OpenAI format */
type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' } };

/** OpenAI tool format */
interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Accumulated tool call being built from streaming deltas */
interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** Shape of a streamed choice delta from OpenAI */
interface OpenAIDelta {
  role?: string;
  content?: string | null;
  tool_calls?: OpenAIToolCallDelta[];
}

/** A single tool_call delta in the stream */
interface OpenAIToolCallDelta {
  index: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

/** Shape of a streamed usage object */
interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens?: number;
}

/** Shape of each choice in a streamed chunk */
interface OpenAIStreamChoice {
  index: number;
  delta: OpenAIDelta;
  finish_reason: string | null;
}

/** The top-level JSON object for a stream chunk */
interface OpenAIStreamChunk {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices: OpenAIStreamChoice[];
  usage?: OpenAIUsage | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = 'https://api.openai.com';
const CHAT_COMPLETIONS_PATH = '/v1/chat/completions';
const MODELS_PATH = '/v1/models';

// ---------------------------------------------------------------------------
// OpenAI Provider
// ---------------------------------------------------------------------------

export class OpenAIProvider extends BaseProvider {
  readonly name: AIProviderType = 'openai';
  readonly supportsVision: boolean = true;
  readonly supportsStreaming: boolean = true;
  readonly supportsFunctionCalling: boolean = true;

  /**
   * Accumulated tool calls from streaming deltas.
   * Keyed by tool-call `index` (0, 1, 2, ...) as streamed by OpenAI.
   * Reset at the start of each `parseStreamChunk` cycle via `chat()`.
   */
  private toolCallAccumulator = new Map<number, AccumulatedToolCall>();

  /**
   * Cached usage from a stream chunk that includes `usage` (sent with
   * `stream_options.include_usage`). Stored here so it can be attached
   * to the final "done" chunk.
   */
  private pendingUsage: { inputTokens: number; outputTokens: number } | null = null;

  constructor() {
    super();
    this.initLogger();
  }

  // ── Template-method hooks ───────────────────────────────────────────────

  protected buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.getApiKey()}`,
      'Content-Type': 'application/json',
    };
  }

  protected getEndpoint(): string {
    const base = this.getBaseUrl(DEFAULT_BASE_URL);
    return `${base}${CHAT_COMPLETIONS_PATH}`;
  }

  protected buildRequestBody(
    messages: AIMessage[],
    options?: AIRequestOptions,
  ): Record<string, unknown> {
    this.assertInitialized();

    // Reset per-request streaming state
    this.toolCallAccumulator.clear();
    this.pendingUsage = null;

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: this.formatMessages(messages),
      stream: true,
      stream_options: { include_usage: true },
    };

    // Temperature — use config value, fall back to 0.7
    body.temperature = this.config.temperature ?? 0.7;

    // Max tokens — use config value, fall back to 4096
    if (this.config.maxTokens) {
      body.max_tokens = this.config.maxTokens;
    } else {
      body.max_tokens = 4096;
    }

    // Tools (function calling)
    if (options?.tools && options.tools.length > 0) {
      body.tools = this.formatTools(options.tools);
    }

    return body;
  }

  protected parseStreamChunk(event: unknown): AIStreamChunk | null {
    const sseEvent = event as SSEEvent;
    const rawData = sseEvent.data;

    // The base class SSE parser already handles "[DONE]", but guard anyway
    if (!rawData || rawData === '[DONE]') {
      return null;
    }

    let parsed: OpenAIStreamChunk;
    try {
      parsed = JSON.parse(rawData) as OpenAIStreamChunk;
    } catch {
      this.logger.warn('Failed to parse OpenAI stream chunk', { raw: rawData });
      return null;
    }

    // Capture usage if present (OpenAI sends it on the final chunk when
    // stream_options.include_usage is true — the chunk may have empty choices)
    if (parsed.usage) {
      this.pendingUsage = {
        inputTokens: parsed.usage.prompt_tokens,
        outputTokens: parsed.usage.completion_tokens,
      };
    }

    // No choices → nothing to emit (could be a usage-only chunk)
    if (!parsed.choices || parsed.choices.length === 0) {
      return null;
    }

    const choice = parsed.choices[0];
    const delta = choice.delta;

    // ── Text content delta ───────────────────────────────────────────────
    if (delta.content) {
      return { type: 'text', content: delta.content };
    }

    // ── Tool call deltas ─────────────────────────────────────────────────
    if (delta.tool_calls && delta.tool_calls.length > 0) {
      for (const tcDelta of delta.tool_calls) {
        this.accumulateToolCallDelta(tcDelta);
      }
    }

    // ── Finish reasons ───────────────────────────────────────────────────
    if (choice.finish_reason === 'tool_calls') {
      // Emit all accumulated tool calls, then clear
      const chunks = this.flushToolCalls();
      // We can only return one chunk at a time from parseStreamChunk.
      // Return the first tool call; the rest will be lost if there are
      // multiple simultaneous calls. However, the base class calls us per
      // event, so we emit them as separate yields via a combined approach:
      // store extras and return them on subsequent null-data events.
      // For simplicity, and because OpenAI typically finishes one call per
      // finish_reason event, return the first and queue the rest.
      if (chunks.length > 0) {
        // Store extras in the accumulator slot for later retrieval
        if (chunks.length > 1) {
          this.pendingToolCallChunks = chunks.slice(1);
        }
        return chunks[0];
      }
    }

    if (choice.finish_reason === 'stop') {
      return {
        type: 'done',
        usage: this.pendingUsage ?? undefined,
      };
    }

    // Check for queued tool call chunks from multi-tool responses
    if (this.pendingToolCallChunks && this.pendingToolCallChunks.length > 0) {
      const nextToolCallChunk = this.pendingToolCallChunks.shift();
      if (nextToolCallChunk) {
        return nextToolCallChunk;
      }
    }

    return null;
  }

  protected mapErrorResponse(status: number, body: string): ExtensionError {
    let message = `OpenAI API error (${status})`;

    // Try to extract the error message from the response
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string; type?: string } };
      if (parsed.error?.message) {
        message = parsed.error.message;
      }
    } catch {
      // Use the raw body as a fallback message
      if (body) {
        message = `OpenAI API error (${status}): ${body.slice(0, 200)}`;
      }
    }

    switch (status) {
      case 401:
        return new ExtensionError(ErrorCode.AI_INVALID_KEY, message, false, { status, body });
      case 429:
        return new ExtensionError(ErrorCode.AI_RATE_LIMIT, message, true, { status, body });
      case 404:
        return new ExtensionError(ErrorCode.AI_MODEL_NOT_FOUND, message, false, { status, body });
      default:
        return new ExtensionError(
          ErrorCode.AI_API_ERROR,
          message,
          status >= 500, // Server errors are recoverable (retryable)
          { status, body },
        );
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const base = this.config ? this.getBaseUrl(DEFAULT_BASE_URL) : DEFAULT_BASE_URL;

      const response = await fetch(`${base}${MODELS_PATH}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      return response.status === 200;
    } catch {
      // Network errors → treat as invalid (can't validate)
      return false;
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * Queue for tool call chunks when OpenAI finishes multiple tool calls
   * in one finish_reason event. Drained on subsequent parseStreamChunk calls.
   */
  private pendingToolCallChunks: AIStreamChunk[] = [];

  /**
   * Convert AIMessage[] to OpenAI message format.
   *
   * OpenAI accepts system messages directly in the array (unlike Claude
   * which requires them as a separate parameter). Multimodal content
   * arrays are translated to OpenAI's `image_url` format.
   */
  private formatMessages(messages: AIMessage[]): OpenAIMessage[] {
    return messages.map((msg): OpenAIMessage => {
      // String content — pass through directly
      if (typeof msg.content === 'string') {
        return {
          role: msg.role,
          content: msg.content,
        };
      }

      // Content array — convert to OpenAI content parts
      const parts = this.formatContentParts(msg.content);

      // If only a single text part, simplify to string
      if (parts.length === 1 && parts[0].type === 'text') {
        return {
          role: msg.role,
          content: parts[0].text,
        };
      }

      return {
        role: msg.role,
        content: parts,
      };
    });
  }

  /**
   * Convert AIMessageContent[] to OpenAI content parts.
   *
   * OpenAI uses `image_url.url` directly (supports both HTTPS URLs and
   * data URIs), so we pass them through with minimal transformation.
   */
  private formatContentParts(contents: AIMessageContent[]): OpenAIContentPart[] {
    const parts: OpenAIContentPart[] = [];

    for (const content of contents) {
      if (content.type === 'text' && content.text) {
        parts.push({ type: 'text', text: content.text });
      } else if (content.type === 'image' && content.image_url) {
        parts.push({
          type: 'image_url',
          image_url: {
            url: content.image_url.url,
            detail: content.image_url.detail ?? 'low',
          },
        });
      }
    }

    return parts;
  }

  /**
   * Convert AITool[] to OpenAI tool format.
   *
   * The shapes are nearly identical — AITool already matches OpenAI's
   * expected `{ type: "function", function: { name, description, parameters } }`.
   */
  private formatTools(tools: AITool[]): OpenAITool[] {
    return tools.map(
      (tool): OpenAITool => ({
        type: 'function',
        function: {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        },
      }),
    );
  }

  /**
   * Accumulate a single tool-call delta into the running map.
   *
   * OpenAI streams tool calls incrementally:
   * - First delta for an index: contains `id` and `function.name`
   * - Subsequent deltas: contain `function.arguments` fragments
   *
   * We build up each tool call by index and emit them all when
   * `finish_reason === "tool_calls"` arrives.
   */
  private accumulateToolCallDelta(delta: OpenAIToolCallDelta): void {
    const existing = this.toolCallAccumulator.get(delta.index);

    if (existing) {
      // Append argument fragment
      if (delta.function?.arguments) {
        existing.arguments += delta.function.arguments;
      }
      // Name can also arrive in later deltas in rare cases
      if (delta.function?.name) {
        existing.name += delta.function.name;
      }
    } else {
      // First delta for this index — initialize
      this.toolCallAccumulator.set(delta.index, {
        id: delta.id ?? '',
        name: delta.function?.name ?? '',
        arguments: delta.function?.arguments ?? '',
      });
    }
  }

  /**
   * Flush all accumulated tool calls into AIStreamChunk[] and clear state.
   */
  private flushToolCalls(): AIStreamChunk[] {
    const chunks: AIStreamChunk[] = [];

    // Sort by index to maintain deterministic order
    const sorted = [...this.toolCallAccumulator.entries()].sort(([a], [b]) => a - b);

    for (const [, toolCall] of sorted) {
      chunks.push({
        type: 'tool_call',
        toolCall: {
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments,
        },
      });
    }

    this.toolCallAccumulator.clear();
    return chunks;
  }
}
