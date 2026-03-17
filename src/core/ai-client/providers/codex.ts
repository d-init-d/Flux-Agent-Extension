import type { AIMessage, AIMessageContent, AIProviderType, AIRequestOptions, AIStreamChunk } from '@shared/types';
import { BaseProvider } from '../base';
import type { SSEEvent } from '../types';
import { ErrorCode, ExtensionError } from '@shared/errors';

const DEFAULT_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const RESPONSES_PATH = '/responses';

interface CodexCompletedUsage {
  input_tokens?: number;
  output_tokens?: number;
}

interface CodexCompletedResponse {
  id?: string;
  usage?: CodexCompletedUsage;
  error?: {
    code?: string;
    message?: string;
  };
  incomplete_details?: {
    reason?: string;
  };
}

interface CodexStreamEvent {
  type?: string;
  delta?: string;
  response?: CodexCompletedResponse;
}

export class CodexProvider extends BaseProvider {
  readonly name: AIProviderType = 'codex';
  readonly supportsVision = false;
  readonly supportsStreaming = true;
  readonly supportsFunctionCalling = false;

  constructor() {
    super();
    this.initLogger();
  }

  protected buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.getApiKey()}`,
      'Content-Type': 'application/json',
    };
  }

  protected getEndpoint(): string {
    const base = this.getBaseUrl(DEFAULT_BASE_URL);
    return `${base}${RESPONSES_PATH}`;
  }

  protected buildRequestBody(
    messages: AIMessage[],
    _options?: AIRequestOptions,
  ): Record<string, unknown> {
    this.assertInitialized();

    return {
      model: this.config.model,
      stream: true,
      input: messages.map((message) => ({
        role: message.role,
        content: this.serializeMessageContent(message.content),
      })),
      max_output_tokens: this.config.maxTokens ?? 4096,
    };
  }

  protected parseStreamChunk(event: unknown): AIStreamChunk | null {
    const sseEvent = event as SSEEvent;
    const rawData = sseEvent.data;

    if (!rawData || rawData === '[DONE]') {
      return null;
    }

    let parsed: CodexStreamEvent;
    try {
      parsed = JSON.parse(rawData) as CodexStreamEvent;
    } catch {
      this.logger.warn('Failed to parse Codex stream chunk');
      return null;
    }

    switch (parsed.type) {
      case 'response.output_text.delta':
        return parsed.delta ? { type: 'text', content: parsed.delta } : null;
      case 'response.completed':
        return {
          type: 'done',
          usage: parsed.response?.usage
            ? {
                inputTokens: parsed.response.usage.input_tokens ?? 0,
                outputTokens: parsed.response.usage.output_tokens ?? 0,
              }
            : undefined,
        };
      case 'response.failed':
        throw this.mapStreamFailure(parsed.response?.error?.code, parsed.response?.error?.message);
      case 'response.incomplete': {
        const reason = parsed.response?.incomplete_details?.reason ?? 'unknown';
        throw new ExtensionError(
          ErrorCode.AI_API_ERROR,
          `Codex returned an incomplete response (${reason}). Re-auth or retry from the official Codex client may be required.`,
          true,
          { reason },
        );
      }
      default:
        return null;
    }
  }

  protected mapErrorResponse(status: number, body: string): ExtensionError {
    let message = `Codex API error (${status})`;
    let code: string | undefined;

    try {
      const parsed = JSON.parse(body) as {
        error?: { message?: string; code?: string };
      };
      message = parsed.error?.message ?? message;
      code = parsed.error?.code;
    } catch {
      if (body) {
        message = `Codex API error (${status}): ${body.slice(0, 200)}`;
      }
    }

    if (status === 401 || status === 403) {
      return new ExtensionError(
        ErrorCode.AI_INVALID_KEY,
        `${message} Re-import or refresh the official Codex auth artifact.`,
        false,
        { status, code },
      );
    }

    if (status === 404) {
      return new ExtensionError(ErrorCode.AI_MODEL_NOT_FOUND, message, false, { status, code });
    }

    if (code === 'insufficient_quota') {
      return new ExtensionError(ErrorCode.AI_QUOTA_EXCEEDED, message, false, { status, code });
    }

    if (status === 429 || code === 'rate_limit_exceeded') {
      return new ExtensionError(ErrorCode.AI_RATE_LIMIT, message, true, { status, code });
    }

    return new ExtensionError(ErrorCode.AI_API_ERROR, message, status >= 500, { status, code });
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      return false;
    }

    return trimmed.split('.').length === 3;
  }

  private serializeMessageContent(content: string | AIMessageContent[]): string {
    if (typeof content === 'string') {
      return content;
    }

    const text = content
      .map((part) => {
        if (part.type === 'image') {
          throw new ExtensionError(
            ErrorCode.AI_API_ERROR,
            'Codex account-backed adapter currently supports text-only prompts.',
            false,
          );
        }
        return part.text ?? '';
      })
      .filter((part) => part.length > 0)
      .join('\n\n');

    return text;
  }

  private mapStreamFailure(code?: string, message?: string): ExtensionError {
    const safeMessage = message?.trim() || 'Codex stream failed';

    switch (code) {
      case 'rate_limit_exceeded':
        return new ExtensionError(ErrorCode.AI_RATE_LIMIT, safeMessage, true, { code });
      case 'insufficient_quota':
        return new ExtensionError(ErrorCode.AI_QUOTA_EXCEEDED, safeMessage, false, { code });
      case 'context_length_exceeded':
        return new ExtensionError(ErrorCode.AI_API_ERROR, safeMessage, false, { code });
      case 'invalid_api_key':
      case 'invalid_session':
      case 'unauthorized':
        return new ExtensionError(
          ErrorCode.AI_INVALID_KEY,
          `${safeMessage} Re-import or refresh the official Codex auth artifact.`,
          false,
          { code },
        );
      default:
        return new ExtensionError(ErrorCode.AI_API_ERROR, safeMessage, true, { code });
    }
  }
}
