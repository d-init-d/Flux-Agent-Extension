/**
 * Shared constants used across the extension
 */

export const EXTENSION_NAME = 'Flux Agent';

export const MESSAGE_TIMEOUT = 30000; // 30 seconds

export const STORAGE_KEYS = {
  SETTINGS: 'flux_settings',
  PROVIDERS: 'flux_providers',
  CHAT_HISTORY: 'flux_chat_history',
  GOOGLE_TOKENS: 'flux_google_tokens',
} as const;

export const DEFAULT_SETTINGS = {
  theme: 'dark' as const,
  defaultProvider: 'claude',
  autoScreenshot: false,
  confirmActions: true,
  language: 'en',
};

export const PROVIDERS = {
  CLAUDE: 'claude',
  OPENAI: 'openai',
  GEMINI: 'gemini',
  OLLAMA: 'ollama',
  GOOGLE_ACCOUNT: 'google-account',
} as const;
