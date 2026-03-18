/**
 * @module ai-client/providers/openai-compat
 * @description Factory for OpenAI-compatible API providers.
 *
 * Most third-party LLM providers expose an OpenAI-compatible chat completions
 * endpoint. This module generates lightweight provider classes that extend
 * {@link OpenAIProvider} with the correct base URL, model path, and error
 * label for each provider.
 */

import type { AIProviderType } from '@shared/types';
import { OpenAIProvider } from './openai';
import { ExtensionError, ErrorCode } from '@shared/errors';

// ---------------------------------------------------------------------------
// Preset configuration
// ---------------------------------------------------------------------------

interface OpenAICompatPreset {
  type: AIProviderType;
  displayName: string;
  defaultBaseUrl: string;
  chatPath: string;
  modelsPath: string | null;
  allowVersionedBasePath?: boolean;
  supportsVision: boolean;
  supportsFunctionCalling: boolean;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function buildCompatUrl(
  baseUrl: string,
  path: string,
  allowVersionedBasePath: boolean,
): string {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

  if (allowVersionedBasePath && /\/v1$/i.test(normalizedBaseUrl) && path.startsWith('/v1/')) {
    return `${normalizedBaseUrl}${path.slice(3)}`;
  }

  return `${normalizedBaseUrl}${path}`;
}

const PRESETS: Record<string, OpenAICompatPreset> = {
  groq: {
    type: 'groq',
    displayName: 'Groq',
    defaultBaseUrl: 'https://api.groq.com/openai',
    chatPath: '/v1/chat/completions',
    modelsPath: '/openai/v1/models',
    supportsVision: true,
    supportsFunctionCalling: true,
  },
  cliproxyapi: {
    type: 'cliproxyapi',
    displayName: 'CLIProxyAPI',
    defaultBaseUrl: 'http://127.0.0.1:8317',
    chatPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
    allowVersionedBasePath: true,
    supportsVision: true,
    supportsFunctionCalling: true,
  },
  deepseek: {
    type: 'deepseek',
    displayName: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com',
    chatPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
    supportsVision: false,
    supportsFunctionCalling: true,
  },
  xai: {
    type: 'xai',
    displayName: 'xAI',
    defaultBaseUrl: 'https://api.x.ai',
    chatPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
    supportsVision: true,
    supportsFunctionCalling: true,
  },
  together: {
    type: 'together',
    displayName: 'Together AI',
    defaultBaseUrl: 'https://api.together.xyz',
    chatPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
    supportsVision: false,
    supportsFunctionCalling: true,
  },
  fireworks: {
    type: 'fireworks',
    displayName: 'Fireworks AI',
    defaultBaseUrl: 'https://api.fireworks.ai/inference',
    chatPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
    supportsVision: false,
    supportsFunctionCalling: true,
  },
  deepinfra: {
    type: 'deepinfra',
    displayName: 'Deep Infra',
    defaultBaseUrl: 'https://api.deepinfra.com/v1/openai',
    chatPath: '/chat/completions',
    modelsPath: '/models',
    supportsVision: false,
    supportsFunctionCalling: true,
  },
  cerebras: {
    type: 'cerebras',
    displayName: 'Cerebras',
    defaultBaseUrl: 'https://api.cerebras.ai',
    chatPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
    supportsVision: false,
    supportsFunctionCalling: false,
  },
  mistral: {
    type: 'mistral',
    displayName: 'Mistral',
    defaultBaseUrl: 'https://api.mistral.ai',
    chatPath: '/v1/chat/completions',
    modelsPath: '/v1/models',
    supportsVision: true,
    supportsFunctionCalling: true,
  },
  perplexity: {
    type: 'perplexity',
    displayName: 'Perplexity',
    defaultBaseUrl: 'https://api.perplexity.ai',
    chatPath: '/chat/completions',
    modelsPath: null,
    supportsVision: false,
    supportsFunctionCalling: false,
  },
};

// ---------------------------------------------------------------------------
// Class factory
// ---------------------------------------------------------------------------

function createOpenAICompatClass(preset: OpenAICompatPreset) {
  const {
    type,
    displayName,
    defaultBaseUrl,
    chatPath,
    modelsPath,
    allowVersionedBasePath = false,
  } = preset;

  return class OpenAICompatProvider extends OpenAIProvider {
    override readonly name: AIProviderType = type;
    override readonly supportsVision: boolean = preset.supportsVision;
    override readonly supportsFunctionCalling: boolean = preset.supportsFunctionCalling;

    protected override getEndpoint(): string {
      const base = this.getBaseUrl(defaultBaseUrl);
      return buildCompatUrl(base, chatPath, allowVersionedBasePath);
    }

    override async validateApiKey(apiKey: string): Promise<boolean> {
      if (!modelsPath) {
        try {
          const response = await fetch(`${defaultBaseUrl}${chatPath}`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'test',
              messages: [{ role: 'user', content: 'hi' }],
              max_tokens: 1,
            }),
          });
          return response.status !== 401 && response.status !== 403;
        } catch {
          return false;
        }
      }

      try {
        const base =
          this.config ? this.getBaseUrl(defaultBaseUrl) : defaultBaseUrl;
        const response = await fetch(buildCompatUrl(base, modelsPath, allowVersionedBasePath), {
          method: 'GET',
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return response.status === 200;
      } catch {
        return false;
      }
    }

    protected override mapErrorResponse(
      status: number,
      body: string,
    ): ExtensionError {
      let message = `${displayName} API error (${status})`;

      try {
        const parsed = JSON.parse(body) as {
          error?: { message?: string; type?: string };
        };
        if (parsed.error?.message) {
          message = parsed.error.message;
        }
      } catch {
        if (body) {
          message = `${displayName} API error (${status}): ${body.slice(0, 200)}`;
        }
      }

      switch (status) {
        case 401:
          return new ExtensionError(ErrorCode.AI_INVALID_KEY, message, false, {
            status,
            body,
          });
        case 429:
          return new ExtensionError(ErrorCode.AI_RATE_LIMIT, message, true, {
            status,
            body,
          });
        case 404:
          return new ExtensionError(
            ErrorCode.AI_MODEL_NOT_FOUND,
            message,
            false,
            { status, body },
          );
        default:
          return new ExtensionError(
            ErrorCode.AI_API_ERROR,
            message,
            status >= 500,
            { status, body },
          );
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Exported provider classes
// ---------------------------------------------------------------------------

export const GroqProvider = createOpenAICompatClass(PRESETS.groq);
export const CLIProxyAPIProvider = createOpenAICompatClass(PRESETS.cliproxyapi);
export const DeepSeekProvider = createOpenAICompatClass(PRESETS.deepseek);
export const XAIProvider = createOpenAICompatClass(PRESETS.xai);
export const TogetherProvider = createOpenAICompatClass(PRESETS.together);
export const FireworksProvider = createOpenAICompatClass(PRESETS.fireworks);
export const DeepInfraProvider = createOpenAICompatClass(PRESETS.deepinfra);
export const CerebrasProvider = createOpenAICompatClass(PRESETS.cerebras);
export const MistralProvider = createOpenAICompatClass(PRESETS.mistral);
export const PerplexityProvider = createOpenAICompatClass(PRESETS.perplexity);

// ---------------------------------------------------------------------------
// Dynamic lookup (used by provider-loader)
// ---------------------------------------------------------------------------

type OpenAICompatType = keyof typeof PRESETS;

const PROVIDER_CLASSES: Record<
  OpenAICompatType,
  ReturnType<typeof createOpenAICompatClass>
> = {
  groq: GroqProvider,
  cliproxyapi: CLIProxyAPIProvider,
  deepseek: DeepSeekProvider,
  xai: XAIProvider,
  together: TogetherProvider,
  fireworks: FireworksProvider,
  deepinfra: DeepInfraProvider,
  cerebras: CerebrasProvider,
  mistral: MistralProvider,
  perplexity: PerplexityProvider,
};

export function isOpenAICompatType(type: string): type is OpenAICompatType {
  return type in PROVIDER_CLASSES;
}

export function createOpenAICompatProvider(type: string): InstanceType<ReturnType<typeof createOpenAICompatClass>> {
  const ProviderClass = PROVIDER_CLASSES[type as OpenAICompatType];
  if (!ProviderClass) {
    throw new Error(`Unknown OpenAI-compatible provider: ${type}`);
  }
  return new ProviderClass();
}
