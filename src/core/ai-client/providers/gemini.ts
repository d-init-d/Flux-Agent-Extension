/**
 * @module ai-client/providers/gemini
 * @description Google Gemini provider implementation using raw fetch() — no SDK.
 *
 * Connects to the Gemini `streamGenerateContent` endpoint with `alt=sse`
 * for server-sent event streaming. API key is sent via `x-goog-api-key`
 * header to avoid leaking secrets into URLs.
 *
 * Supports:
 *   - Multi-turn conversation (user / model roles)
 *   - System instructions (extracted from system messages)
 *   - Vision / multimodal (inline base64 images)
 *   - Function calling (tool declarations)
 *   - SSE streaming with usage metadata
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
import { generateId } from '@shared/utils';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';
const GEMINI_API_VERSION = 'v1beta';

// ---------------------------------------------------------------------------
// Internal Gemini-specific types (not exported)
// ---------------------------------------------------------------------------

/** A single Gemini content part. */
interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

/** A Gemini content message. */
interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

/** Gemini generation config. */
interface GeminiGenerationConfig {
  temperature?: number;
  maxOutputTokens?: number;
  candidateCount?: number;
}

/** Gemini function declaration (mirrors the JSON Schema shape). */
interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Streaming response candidate shape. */
interface GeminiCandidate {
  content?: {
    parts?: GeminiPart[];
    role?: string;
  };
  finishReason?: string;
}

/** Streaming response usage metadata. */
interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

/** Parsed SSE data payload from Gemini. */
interface GeminiStreamPayload {
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
  error?: { code: number; message: string; status: string };
}

// ---------------------------------------------------------------------------
// Provider Implementation
// ---------------------------------------------------------------------------

export class GeminiProvider extends BaseProvider {
  // ── IAIProvider readonly properties ──────────────────────────────────────
  readonly name: AIProviderType = 'gemini';
  readonly supportsVision = true;
  readonly supportsStreaming = true;
  readonly supportsFunctionCalling = true;

  constructor() {
    super();
    this.initLogger();
  }

  // ── Abstract hook: buildHeaders ─────────────────────────────────────────
  protected buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-goog-api-key': this.getApiKey(),
    };
  }

  // ── Abstract hook: getEndpoint ──────────────────────────────────────────

  protected getEndpoint(): string {
    const baseUrl = this.getBaseUrl(GEMINI_BASE_URL);
    const model = this.getModel();
    return `${baseUrl}/${GEMINI_API_VERSION}/models/${model}:streamGenerateContent?alt=sse`;
  }

  // ── Abstract hook: buildRequestBody ─────────────────────────────────────

  protected buildRequestBody(
    messages: AIMessage[],
    options?: AIRequestOptions,
  ): Record<string, unknown> {
    this.assertInitialized();

    // Separate system messages from conversation messages
    const systemParts: GeminiPart[] = [];
    const contents: GeminiContent[] = [];

    for (const message of messages) {
      if (message.role === 'system') {
        // System messages go into systemInstruction
        const text = this.extractTextFromContent(message.content);
        if (text) {
          systemParts.push({ text });
        }
        continue;
      }

      const role = this.mapRole(message.role);
      const parts = this.convertContentToParts(message.content);

      if (parts.length > 0) {
        contents.push({ role, parts });
      }
    }

    // Build the request body
    const body: Record<string, unknown> = {
      contents,
    };

    // Add system instruction if any system messages exist
    if (systemParts.length > 0) {
      body.systemInstruction = {
        parts: systemParts,
      };
    }

    // Generation config
    const generationConfig: GeminiGenerationConfig = {
      candidateCount: 1,
    };

    if (this.config.temperature !== undefined) {
      generationConfig.temperature = this.config.temperature;
    }

    if (this.config.maxTokens !== undefined) {
      generationConfig.maxOutputTokens = this.config.maxTokens;
    }

    body.generationConfig = generationConfig;

    // Function calling / tools
    if (options?.tools && options.tools.length > 0) {
      const functionDeclarations: GeminiFunctionDeclaration[] = options.tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
      }));

      body.tools = [{ functionDeclarations }];
    }

    return body;
  }

  // ── Abstract hook: parseStreamChunk ─────────────────────────────────────

  protected parseStreamChunk(event: unknown): AIStreamChunk | null {
    const sseEvent = event as SSEEvent;

    // Skip events with no data
    if (!sseEvent.data) {
      return null;
    }

    let payload: GeminiStreamPayload;
    try {
      payload = JSON.parse(sseEvent.data) as GeminiStreamPayload;
    } catch {
      this.logger.warn('Failed to parse Gemini SSE data', { raw: sseEvent.data });
      return null;
    }

    // Check for API-level errors inside the stream
    if (payload.error) {
      return {
        type: 'error',
        error: new Error(`Gemini API error: ${payload.error.message}`),
      };
    }

    const candidate = payload.candidates?.[0];
    if (!candidate) {
      // Some events carry only usageMetadata without candidates
      return null;
    }

    const finishReason = candidate.finishReason;
    const parts = candidate.content?.parts;

    // Check for safety / recitation blocks
    if (finishReason === 'SAFETY' || finishReason === 'RECITATION') {
      return {
        type: 'error',
        error: new Error('Content filtered by Gemini safety settings'),
      };
    }

    // Check for function call parts
    if (parts && parts.length > 0) {
      const firstPart = parts[0];

      if (firstPart.functionCall) {
        return {
          type: 'tool_call',
          toolCall: {
            id: generateId(),
            name: firstPart.functionCall.name,
            arguments: JSON.stringify(firstPart.functionCall.args),
          },
        };
      }

      if (firstPart.text !== undefined && firstPart.text !== '') {
        // If this chunk also signals STOP, emit text first — the next
        // iteration (or the finishReason check below) will handle done.
        // But since we process one chunk at a time, just emit text.
        return {
          type: 'text',
          content: firstPart.text,
        };
      }
    }

    // Stream completed normally
    if (finishReason === 'STOP') {
      const usage = payload.usageMetadata;
      return {
        type: 'done',
        usage: {
          inputTokens: usage?.promptTokenCount ?? 0,
          outputTokens: usage?.candidatesTokenCount ?? 0,
        },
      };
    }

    // Unrecognized event shape — skip
    return null;
  }

  // ── Abstract hook: mapErrorResponse ─────────────────────────────────────

  protected mapErrorResponse(status: number, body: string): ExtensionError {
    let message = `Gemini API error (HTTP ${status})`;
    let parsedBody: { error?: { message?: string; status?: string } } | undefined;

    try {
      parsedBody = JSON.parse(body) as typeof parsedBody;
      if (parsedBody?.error?.message) {
        message = parsedBody.error.message;
      }
    } catch {
      // Use raw body as message if parsing fails
      if (body) {
        message = body;
      }
    }

    // 400 with API_KEY_INVALID
    if (status === 400 && body.includes('API_KEY_INVALID')) {
      return new ExtensionError(
        ErrorCode.AI_INVALID_KEY,
        `Invalid Gemini API key: ${message}`,
        false,
        { status, body },
      );
    }

    // 429 — rate limit
    if (status === 429) {
      return new ExtensionError(
        ErrorCode.AI_RATE_LIMIT,
        `Gemini rate limit exceeded: ${message}`,
        true,
        { status, body },
      );
    }

    // 404 — model not found
    if (status === 404) {
      return new ExtensionError(
        ErrorCode.AI_MODEL_NOT_FOUND,
        `Gemini model not found: ${message}`,
        false,
        { status, body },
      );
    }

    // 403 — could be invalid key or quota
    if (status === 403) {
      return new ExtensionError(
        ErrorCode.AI_INVALID_KEY,
        `Gemini access denied: ${message}`,
        false,
        { status, body },
      );
    }

    // Everything else
    return new ExtensionError(
      ErrorCode.AI_API_ERROR,
      `Gemini API error: ${message}`,
      status >= 500, // Server errors are potentially recoverable
      { status, body },
    );
  }

  // ── IAIProvider: validateApiKey ─────────────────────────────────────────

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const url = `${GEMINI_BASE_URL}/${GEMINI_API_VERSION}/models`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
      });
      return response.ok;
    } catch {
      // Network error — treat as invalid
      return false;
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * Map AIMessage role to Gemini's role format.
   * Gemini only uses 'user' and 'model' — no 'system' or 'assistant'.
   */
  private mapRole(role: 'user' | 'assistant'): 'user' | 'model' {
    return role === 'assistant' ? 'model' : 'user';
  }

  /**
   * Extract plain text from an AIMessage content field.
   * Used for system messages where we only need the text.
   */
  private extractTextFromContent(content: string | AIMessageContent[]): string {
    if (typeof content === 'string') {
      return content;
    }

    // Concatenate all text blocks
    return content
      .filter((block): block is AIMessageContent & { type: 'text' } => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('\n');
  }

  /**
   * Convert AIMessage content to Gemini parts format.
   * Handles both plain text strings and multimodal content arrays.
   */
  private convertContentToParts(content: string | AIMessageContent[]): GeminiPart[] {
    if (typeof content === 'string') {
      return content ? [{ text: content }] : [];
    }

    const parts: GeminiPart[] = [];

    for (const block of content) {
      switch (block.type) {
        case 'text': {
          if (block.text) {
            parts.push({ text: block.text });
          }
          break;
        }

        case 'image': {
          if (block.image_url?.url) {
            const imageData = this.parseDataUrl(block.image_url.url);
            if (imageData) {
              parts.push({
                inlineData: {
                  mimeType: imageData.mimeType,
                  data: imageData.base64,
                },
              });
            } else {
              // If it's a regular URL (not data URL), log a warning.
              // Gemini's inline data requires base64 — external URLs aren't
              // directly supported through inlineData.
              this.logger.warn('Non-data-URL image skipped for Gemini (base64 required)', {
                url: block.image_url.url.slice(0, 50),
              });
            }
          }
          break;
        }
      }
    }

    return parts;
  }

  /**
   * Parse a data URL into its mime type and base64 payload.
   * Returns null if the URL is not a valid data URL.
   *
   * Format: `data:<mimeType>;base64,<data>`
   */
  private parseDataUrl(url: string): { mimeType: string; base64: string } | null {
    const match = /^data:([^;]+);base64,(.+)$/.exec(url);
    if (!match) {
      return null;
    }

    return {
      mimeType: match[1],
      base64: match[2],
    };
  }
}
