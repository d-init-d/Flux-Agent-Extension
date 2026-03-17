import type { AIProviderFamily, AIProviderType } from '../types/ai';
import type { ProviderAuthFamily, ProviderConfig } from '../types/storage';

export type ProviderTier = 'core' | 'compat';
export type ProviderAuthMethod = 'api-key' | 'oauth-github' | 'account-import' | 'none';

export interface ProviderDefinition {
  type: AIProviderType;
  family: AIProviderFamily;
  tier: ProviderTier;
  label: string;
  tagline: string;
  defaultModel: string;
  requiresCredential: boolean;
  supportsEndpoint: boolean;
  endpointLabel: string;
  endpointPlaceholder: string;
  authFamily: ProviderAuthFamily;
  authMethod: ProviderAuthMethod;
  experimental?: boolean;
  accent: string;
}

export const PROVIDER_REGISTRY: readonly ProviderDefinition[] = [
  {
    type: 'claude',
    family: 'default',
    tier: 'core',
    label: 'Claude',
    tagline: 'Anthropic models for reasoning-heavy tasks.',
    defaultModel: 'claude-3-5-sonnet-20241022',
    requiresCredential: true,
    supportsEndpoint: false,
    endpointLabel: 'Endpoint',
    endpointPlaceholder: '',
    authFamily: 'api-key',
    authMethod: 'api-key',
    accent: 'from-orange-500/20 via-amber-400/10 to-transparent',
  },
  {
    type: 'openai',
    family: 'default',
    tier: 'core',
    label: 'OpenAI',
    tagline: 'GPT models with optional compatible endpoint override.',
    defaultModel: 'gpt-4o-mini',
    requiresCredential: true,
    supportsEndpoint: true,
    endpointLabel: 'Base URL override',
    endpointPlaceholder: 'https://api.openai.com',
    authFamily: 'api-key',
    authMethod: 'api-key',
    accent: 'from-emerald-500/20 via-cyan-400/10 to-transparent',
  },
  {
    type: 'gemini',
    family: 'default',
    tier: 'core',
    label: 'Gemini',
    tagline: 'Google Gemini models for long-context workflows.',
    defaultModel: 'gemini-2.5-flash',
    requiresCredential: true,
    supportsEndpoint: false,
    endpointLabel: 'Endpoint',
    endpointPlaceholder: '',
    authFamily: 'api-key',
    authMethod: 'api-key',
    accent: 'from-sky-500/20 via-indigo-400/10 to-transparent',
  },
  {
    type: 'openrouter',
    family: 'default',
    tier: 'core',
    label: 'OpenRouter',
    tagline: 'Unified gateway across Anthropic, OpenAI, Google, and more.',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    requiresCredential: true,
    supportsEndpoint: false,
    endpointLabel: 'Endpoint',
    endpointPlaceholder: '',
    authFamily: 'api-key',
    authMethod: 'api-key',
    accent: 'from-fuchsia-500/20 via-pink-400/10 to-transparent',
  },
  {
    type: 'ollama',
    family: 'default',
    tier: 'core',
    label: 'Ollama',
    tagline: 'Local model runtime with loopback-only endpoint support.',
    defaultModel: 'llama3.2',
    requiresCredential: false,
    supportsEndpoint: true,
    endpointLabel: 'Ollama server URL',
    endpointPlaceholder: 'http://localhost:11434',
    authFamily: 'none',
    authMethod: 'none',
    accent: 'from-slate-500/20 via-slate-300/10 to-transparent',
  },
  {
    type: 'groq',
    family: 'default',
    tier: 'compat',
    label: 'Groq',
    tagline: 'Ultra-fast inference with LPU hardware. Free tier available.',
    defaultModel: 'llama-3.3-70b-versatile',
    requiresCredential: true,
    supportsEndpoint: false,
    endpointLabel: 'Endpoint',
    endpointPlaceholder: '',
    authFamily: 'api-key',
    authMethod: 'api-key',
    accent: 'from-orange-600/20 via-yellow-400/10 to-transparent',
  },
  {
    type: 'deepseek',
    family: 'default',
    tier: 'compat',
    label: 'DeepSeek',
    tagline: 'High-quality reasoning models at competitive pricing.',
    defaultModel: 'deepseek-chat',
    requiresCredential: true,
    supportsEndpoint: false,
    endpointLabel: 'Endpoint',
    endpointPlaceholder: '',
    authFamily: 'api-key',
    authMethod: 'api-key',
    accent: 'from-blue-600/20 via-blue-300/10 to-transparent',
  },
  {
    type: 'xai',
    family: 'default',
    tier: 'compat',
    label: 'xAI (Grok)',
    tagline: 'Grok models from xAI with real-time knowledge.',
    defaultModel: 'grok-2',
    requiresCredential: true,
    supportsEndpoint: false,
    endpointLabel: 'Endpoint',
    endpointPlaceholder: '',
    authFamily: 'api-key',
    authMethod: 'api-key',
    accent: 'from-neutral-700/20 via-neutral-400/10 to-transparent',
  },
  {
    type: 'together',
    family: 'default',
    tier: 'compat',
    label: 'Together AI',
    tagline: 'Open-source model hosting with competitive inference.',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    requiresCredential: true,
    supportsEndpoint: false,
    endpointLabel: 'Endpoint',
    endpointPlaceholder: '',
    authFamily: 'api-key',
    authMethod: 'api-key',
    accent: 'from-indigo-500/20 via-purple-400/10 to-transparent',
  },
  {
    type: 'fireworks',
    family: 'default',
    tier: 'compat',
    label: 'Fireworks AI',
    tagline: 'Fast serverless inference for popular open models.',
    defaultModel: 'accounts/fireworks/models/llama-v3p1-70b-instruct',
    requiresCredential: true,
    supportsEndpoint: false,
    endpointLabel: 'Endpoint',
    endpointPlaceholder: '',
    authFamily: 'api-key',
    authMethod: 'api-key',
    accent: 'from-red-500/20 via-orange-400/10 to-transparent',
  },
  {
    type: 'deepinfra',
    family: 'default',
    tier: 'compat',
    label: 'Deep Infra',
    tagline: 'Low-latency, pay-per-token open model inference.',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
    requiresCredential: true,
    supportsEndpoint: false,
    endpointLabel: 'Endpoint',
    endpointPlaceholder: '',
    authFamily: 'api-key',
    authMethod: 'api-key',
    accent: 'from-teal-500/20 via-emerald-400/10 to-transparent',
  },
  {
    type: 'cerebras',
    family: 'default',
    tier: 'compat',
    label: 'Cerebras',
    tagline: 'Record-breaking fast inference. Free developer tier.',
    defaultModel: 'llama3.3-70b',
    requiresCredential: true,
    supportsEndpoint: false,
    endpointLabel: 'Endpoint',
    endpointPlaceholder: '',
    authFamily: 'api-key',
    authMethod: 'api-key',
    accent: 'from-lime-500/20 via-green-400/10 to-transparent',
  },
  {
    type: 'mistral',
    family: 'default',
    tier: 'compat',
    label: 'Mistral',
    tagline: 'European AI lab with strong multilingual models.',
    defaultModel: 'mistral-large-latest',
    requiresCredential: true,
    supportsEndpoint: false,
    endpointLabel: 'Endpoint',
    endpointPlaceholder: '',
    authFamily: 'api-key',
    authMethod: 'api-key',
    accent: 'from-amber-500/20 via-orange-300/10 to-transparent',
  },
  {
    type: 'perplexity',
    family: 'default',
    tier: 'compat',
    label: 'Perplexity',
    tagline: 'Search-augmented AI with real-time web grounding.',
    defaultModel: 'sonar-pro',
    requiresCredential: true,
    supportsEndpoint: false,
    endpointLabel: 'Endpoint',
    endpointPlaceholder: '',
    authFamily: 'api-key',
    authMethod: 'api-key',
    accent: 'from-cyan-500/20 via-sky-400/10 to-transparent',
  },
  {
    type: 'copilot',
    family: 'default',
    tier: 'core',
    label: 'GitHub Copilot',
    tagline: 'Use your existing GitHub Copilot subscription via OAuth.',
    defaultModel: 'gpt-4o',
    requiresCredential: true,
    supportsEndpoint: false,
    endpointLabel: 'Endpoint',
    endpointPlaceholder: '',
    authFamily: 'oauth-token',
    authMethod: 'oauth-github',
    accent: 'from-gray-800/20 via-gray-500/10 to-transparent',
  },
  {
    type: 'codex',
    family: 'chatgpt-account',
    tier: 'core',
    label: 'ChatGPT Plus / Codex (Experimental)',
    tagline: 'Account-backed Codex access via imported official auth artifacts.',
    defaultModel: 'codex-mini-latest',
    requiresCredential: true,
    supportsEndpoint: false,
    endpointLabel: 'Endpoint',
    endpointPlaceholder: '',
    authFamily: 'account-backed',
    authMethod: 'account-import',
    experimental: true,
    accent: 'from-emerald-600/20 via-teal-400/10 to-transparent',
  },
  {
    type: 'custom',
    family: 'default',
    tier: 'compat',
    label: 'Custom',
    tagline: 'Manual endpoint setup for bespoke HTTPS APIs.',
    defaultModel: 'custom-model',
    requiresCredential: false,
    supportsEndpoint: true,
    endpointLabel: 'Provider endpoint',
    endpointPlaceholder: 'https://your-provider.example.com/v1',
    authFamily: 'none',
    authMethod: 'none',
    accent: 'from-violet-500/20 via-indigo-400/10 to-transparent',
  },
] as const;

export const PROVIDER_LOOKUP = Object.fromEntries(
  PROVIDER_REGISTRY.map((provider) => [provider.type, provider]),
) as Record<AIProviderType, ProviderDefinition>;

export const CORE_PROVIDER_TYPES = PROVIDER_REGISTRY.filter(
  (provider) => provider.tier === 'core',
).map((provider) => provider.type) as readonly AIProviderType[];

export const COMPAT_PROVIDER_TYPES = PROVIDER_REGISTRY.filter(
  (provider) => provider.tier === 'compat',
).map((provider) => provider.type) as readonly AIProviderType[];

export const DEFAULT_PROVIDER_MODELS = Object.fromEntries(
  PROVIDER_REGISTRY.map((provider) => [provider.type, provider.defaultModel]),
) as Record<AIProviderType, string>;

export function createDefaultProviderConfigs(): Record<AIProviderType, ProviderConfig> {
  return Object.fromEntries(
    PROVIDER_REGISTRY.map((provider) => [
      provider.type,
      {
        enabled: provider.type !== 'custom',
        model: provider.defaultModel,
        maxTokens: 4096,
        temperature: 0.3,
        customEndpoint:
          provider.type === 'ollama'
            ? 'http://localhost:11434'
            : provider.type === 'openai'
              ? 'https://api.openai.com'
              : undefined,
      } satisfies ProviderConfig,
    ]),
  ) as Record<AIProviderType, ProviderConfig>;
}
