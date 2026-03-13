/**
 * @module ai-client/providers/copilot
 * @description GitHub Copilot provider.
 *
 * Uses the GitHub Copilot Chat API which is OpenAI-compatible.
 * Authentication is handled via a GitHub OAuth token (obtained through
 * Device Flow in the Options UI), which is then exchanged for a
 * short-lived Copilot session token before each request batch.
 *
 * The Copilot token expires every ~30 minutes, so we cache it and
 * refresh transparently before it expires.
 */

import type {
  AIProviderType,
  AIModelConfig,
  AIMessage,
  AIStreamChunk,
  AIRequestOptions,
} from '@shared/types';
import { OpenAIProvider } from './openai';
import { ExtensionError, ErrorCode } from '@shared/errors';
import { exchangeCopilotToken } from '@core/auth/github-device-flow';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COPILOT_BASE_URL = 'https://api.githubcopilot.com';
const COPILOT_CHAT_PATH = '/chat/completions';
const TOKEN_REFRESH_BUFFER_MS = 60_000;

// ---------------------------------------------------------------------------
// Copilot Provider
// ---------------------------------------------------------------------------

export class CopilotProvider extends OpenAIProvider {
  override readonly name: AIProviderType = 'copilot';
  override readonly supportsVision: boolean = false;
  override readonly supportsStreaming: boolean = true;
  override readonly supportsFunctionCalling: boolean = true;

  private copilotToken: string | null = null;
  private copilotTokenExpiresAt = 0;

  override async initialize(config: AIModelConfig): Promise<void> {
    await super.initialize(config);
  }

  // ── Template-method overrides ─────────────────────────────────────────

  protected override buildHeaders(): Record<string, string> {
    if (!this.copilotToken) {
      throw new ExtensionError(
        ErrorCode.AI_INVALID_KEY,
        'Copilot token not available. Please re-authenticate with GitHub.',
      );
    }

    return {
      Authorization: `Bearer ${this.copilotToken}`,
      'Content-Type': 'application/json',
      'Editor-Version': 'FluxAgent/0.1.0',
      'Copilot-Integration-Id': 'flux-agent',
      'Openai-Intent': 'conversation-panel',
    };
  }

  protected override getEndpoint(): string {
    return `${COPILOT_BASE_URL}${COPILOT_CHAT_PATH}`;
  }

  // ── Chat with auto-refresh ────────────────────────────────────────────

  override async *chat(
    messages: AIMessage[],
    options?: AIRequestOptions,
  ): AsyncGenerator<AIStreamChunk, void, unknown> {
    await this.ensureCopilotToken();
    yield* super.chat(messages, options);
  }

  // ── Validation ────────────────────────────────────────────────────────

  override async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const token = await exchangeCopilotToken(apiKey);
      return !!token.token;
    } catch {
      return false;
    }
  }

  // ── Error mapping ─────────────────────────────────────────────────────

  protected override mapErrorResponse(
    status: number,
    body: string,
  ): ExtensionError {
    let message = `GitHub Copilot API error (${status})`;

    try {
      const parsed = JSON.parse(body) as {
        error?: { message?: string };
      };
      if (parsed.error?.message) {
        message = parsed.error.message;
      }
    } catch {
      if (body) {
        message = `GitHub Copilot API error (${status}): ${body.slice(0, 200)}`;
      }
    }

    if (status === 401) {
      this.copilotToken = null;
      return new ExtensionError(
        ErrorCode.AI_INVALID_KEY,
        'Copilot token expired or invalid. Re-authenticating on next request.',
        true,
        { status, body },
      );
    }

    if (status === 429) {
      return new ExtensionError(ErrorCode.AI_RATE_LIMIT, message, true, {
        status,
        body,
      });
    }

    return new ExtensionError(
      ErrorCode.AI_API_ERROR,
      message,
      status >= 500,
      { status, body },
    );
  }

  // ── Token management ──────────────────────────────────────────────────

  private async ensureCopilotToken(): Promise<void> {
    if (
      this.copilotToken &&
      Date.now() < this.copilotTokenExpiresAt - TOKEN_REFRESH_BUFFER_MS
    ) {
      return;
    }

    const githubToken = this.getApiKey();

    try {
      const result = await exchangeCopilotToken(githubToken);
      this.copilotToken = result.token;
      this.copilotTokenExpiresAt = result.expires_at;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new ExtensionError(
        ErrorCode.AI_INVALID_KEY,
        `Failed to obtain Copilot token: ${msg}`,
        false,
        { originalError: msg },
      );
    }
  }
}
