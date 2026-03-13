/**
 * @module ai-client/providers/ollama
 * @description Ollama provider implementation for local LLM inference.
 *
 * Ollama runs locally and uses a newline-delimited JSON (NDJSON) streaming
 * format instead of Server-Sent Events. No API key is required; the provider
 * validates connectivity by pinging the local server.
 *
 * API reference: https://github.com/ollama/ollama/blob/main/docs/api.md
 */

import type {
  AIProviderType,
  AIModelConfig,
  AIMessage,
  AIStreamChunk,
  AIRequestOptions,
  AIMessageContent,
} from '@shared/types';
import { BaseProvider } from '../base';
import { ExtensionError } from '@shared/errors';
import { ErrorCode } from '@shared/errors';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';

// ---------------------------------------------------------------------------
// Types for Ollama NDJSON streaming responses
// ---------------------------------------------------------------------------

interface OllamaChatChunk {
  message?: {
    role: string;
    content: string;
  };
  done: boolean;
  eval_count?: number;
  prompt_eval_count?: number;
}

interface OllamaParseError {
  __parseError: true;
  raw: string;
}

// ---------------------------------------------------------------------------
// Ollama Provider
// ---------------------------------------------------------------------------

export class OllamaProvider extends BaseProvider {
  readonly name: AIProviderType = 'ollama';
  readonly supportsVision: boolean = true;
  readonly supportsStreaming: boolean = true;
  readonly supportsFunctionCalling: boolean = false;

  /** Ollama uses newline-delimited JSON, not SSE. */
  protected override readonly streamFormat = 'ndjson' as const;

  constructor() {
    super();
    this.initLogger();
  }

  // ── Abstract hook implementations ───────────────────────────────────────

  protected buildHeaders(): Record<string, string> {
    // Ollama is local-only; no auth headers needed.
    return {
      'Content-Type': 'application/json',
    };
  }

  protected getEndpoint(): string {
    const baseUrl = this.getBaseUrl(DEFAULT_OLLAMA_BASE_URL);
    return `${baseUrl}/api/chat`;
  }

  protected buildRequestBody(
    messages: AIMessage[],
    _options?: AIRequestOptions,
  ): Record<string, unknown> {
    this.assertInitialized();

    const ollamaMessages = messages.map((msg) => this.convertMessage(msg));

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: ollamaMessages,
      stream: true,
      options: {
        temperature: this.config.temperature ?? 0.7,
        num_predict: this.config.maxTokens ?? 4096,
      },
    };

    return body;
  }

  protected parseStreamChunk(event: unknown): AIStreamChunk | null {
    // NDJSON mode: `event` is the raw parsed JSON object from parseJSONStream
    // (NOT an SSEEvent).

    // Handle parse errors from parseJSONSafe
    if (this.isParseError(event)) {
      return {
        type: 'error',
        error: new ExtensionError(
          ErrorCode.AI_PARSE_ERROR,
          `Failed to parse Ollama stream chunk: ${event.raw}`,
          true,
          { raw: event.raw },
        ),
      };
    }

    const chunk = event as OllamaChatChunk;

    // Streaming token: done === false with message content
    if (!chunk.done && chunk.message?.content) {
      return {
        type: 'text',
        content: chunk.message.content,
      };
    }

    // Final chunk: done === true with optional usage stats
    if (chunk.done) {
      return {
        type: 'done',
        usage: {
          inputTokens: chunk.prompt_eval_count ?? 0,
          outputTokens: chunk.eval_count ?? 0,
        },
      };
    }

    // Skip chunks that don't match either pattern (e.g. empty partial chunks)
    return null;
  }

  protected mapErrorResponse(status: number, body: string): ExtensionError {
    let message = `Ollama API error (HTTP ${status})`;

    // Attempt to extract a more specific message from the response body
    try {
      const parsed = JSON.parse(body) as { error?: string };
      if (parsed.error) {
        message = `Ollama error: ${parsed.error}`;
      }
    } catch {
      // Body is not valid JSON; use the raw text if available
      if (body.length > 0) {
        message = `Ollama error (HTTP ${status}): ${body}`;
      }
    }

    // Ollama doesn't have auth, so most errors are generic API errors
    if (status === 404) {
      return new ExtensionError(ErrorCode.AI_MODEL_NOT_FOUND, message, false, { status, body });
    }

    if (status === 429) {
      return new ExtensionError(ErrorCode.AI_RATE_LIMIT, message, true, { status, body });
    }

    return new ExtensionError(
      ErrorCode.AI_API_ERROR,
      message,
      status >= 500, // Server errors are potentially recoverable
      { status, body },
    );
  }

  // ── IAIProvider: validateApiKey ─────────────────────────────────────────

  async validateApiKey(_apiKey: string): Promise<boolean> {
    // Ollama is local — no API key required.
    // Instead, check if the Ollama server is reachable.
    const baseUrl = this.config?.baseUrl ?? DEFAULT_OLLAMA_BASE_URL;

    try {
      const response = await fetch(`${baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch (error) {
      // Connection refused or timeout — server is not running
      this.logger.warn('Ollama server not reachable', {
        baseUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // ── IAIProvider: initialize (override to handle missing apiKey) ────────

  override async initialize(config: AIModelConfig): Promise<void> {
    // Ollama doesn't require an API key, so we allow initialization
    // even when apiKey is undefined.
    await super.initialize(config);
  }

  // ── Private helpers ────────────────────────────────────────────────────

  /**
   * Convert an AIMessage into Ollama's message format.
   *
   * Ollama expects multimodal messages as:
   *   { role: "user", content: "describe this", images: ["base64data..."] }
   *
   * System messages are passed directly in the messages array.
   */
  private convertMessage(msg: AIMessage): Record<string, unknown> {
    // Simple text message
    if (typeof msg.content === 'string') {
      return {
        role: msg.role,
        content: msg.content,
      };
    }

    // Multimodal message (content is AIMessageContent[])
    const contentParts = msg.content as AIMessageContent[];
    const textParts: string[] = [];
    const images: string[] = [];

    for (const part of contentParts) {
      if (part.type === 'text' && part.text) {
        textParts.push(part.text);
      } else if (part.type === 'image' && part.image_url?.url) {
        const base64Data = this.extractBase64FromDataUrl(part.image_url.url);
        if (base64Data) {
          images.push(base64Data);
        }
      }
    }

    const message: Record<string, unknown> = {
      role: msg.role,
      content: textParts.join('\n'),
    };

    if (images.length > 0) {
      message.images = images;
    }

    return message;
  }

  /**
   * Extract raw base64 data from a data URL.
   *
   * Input:  "data:image/png;base64,iVBORw0KGgoAAAANS..."
   * Output: "iVBORw0KGgoAAAANS..."
   *
   * If the URL is not a data URL, returns the original string
   * (Ollama may handle raw base64 directly).
   */
  private extractBase64FromDataUrl(url: string): string {
    if (url.startsWith('data:')) {
      const commaIndex = url.indexOf(',');
      if (commaIndex !== -1) {
        return url.slice(commaIndex + 1);
      }
    }
    // Not a data URL — return as-is (may already be raw base64)
    return url;
  }

  /**
   * Type guard for NDJSON parse errors emitted by parseJSONSafe.
   */
  private isParseError(event: unknown): event is OllamaParseError {
    return (
      typeof event === 'object' &&
      event !== null &&
      (event as OllamaParseError).__parseError === true
    );
  }
}
