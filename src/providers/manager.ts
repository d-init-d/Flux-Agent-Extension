/**
 * Provider Manager
 * Quản lý tất cả AI providers và chuyển đổi giữa chúng
 */

import { BaseProvider } from './base';
import { ClaudeProvider } from './claude';
import { OpenAIProvider } from './openai';
import { GeminiProvider } from './gemini';
import type {
  ProviderType,
  ProviderConfig,
  ProviderInfo,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  StreamChunk,
  STORAGE_KEYS,
} from './types';
import { logger } from '@shared/logger';

/**
 * Provider Manager - Singleton để quản lý providers
 */
export class ProviderManager {
  private static instance: ProviderManager;
  private providers: Map<ProviderType, BaseProvider> = new Map();
  private currentProvider: ProviderType | null = null;

  private constructor() {
    // Initialize all providers with empty config
    this.providers.set('claude', new ClaudeProvider());
    this.providers.set('openai', new OpenAIProvider());
    this.providers.set('gemini', new GeminiProvider());
  }

  /**
   * Get singleton instance
   */
  static getInstance(): ProviderManager {
    if (!ProviderManager.instance) {
      ProviderManager.instance = new ProviderManager();
    }
    return ProviderManager.instance;
  }

  /**
   * Load saved configuration from storage
   */
  async loadFromStorage(): Promise<void> {
    try {
      const result = await chrome.storage.local.get([
        'claude_api_key',
        'openai_api_key',
        'gemini_api_key',
        'ollama_base_url',
        'selected_provider',
        'selected_model',
      ]);

      // Configure Claude
      if (result.claude_api_key) {
        this.configureProvider('claude', { apiKey: result.claude_api_key });
      }

      // Configure OpenAI
      if (result.openai_api_key) {
        this.configureProvider('openai', { apiKey: result.openai_api_key });
      }

      // Configure Gemini
      if (result.gemini_api_key) {
        this.configureProvider('gemini', { apiKey: result.gemini_api_key });
      }

      // Set current provider
      if (result.selected_provider) {
        this.currentProvider = result.selected_provider as ProviderType;
      }

      logger.info('Provider configuration loaded from storage');
    } catch (error) {
      logger.error('Failed to load provider config:', error);
    }
  }

  /**
   * Save configuration to storage
   */
  async saveToStorage(): Promise<void> {
    try {
      const data: Record<string, string | undefined> = {
        selected_provider: this.currentProvider || undefined,
      };

      const claudeProvider = this.providers.get('claude');
      if (claudeProvider) {
        data.claude_api_key = claudeProvider.getConfig().apiKey;
      }

      const openaiProvider = this.providers.get('openai');
      if (openaiProvider) {
        data.openai_api_key = openaiProvider.getConfig().apiKey;
      }

      const geminiProvider = this.providers.get('gemini');
      if (geminiProvider) {
        data.gemini_api_key = geminiProvider.getConfig().apiKey;
      }

      await chrome.storage.local.set(data);
      logger.info('Provider configuration saved to storage');
    } catch (error) {
      logger.error('Failed to save provider config:', error);
    }
  }

  /**
   * Configure a specific provider
   */
  configureProvider(
    type: ProviderType,
    config: Partial<ProviderConfig>
  ): void {
    const provider = this.providers.get(type);
    if (provider) {
      provider.updateConfig(config);
    }
  }

  /**
   * Initialize a provider (validate API key)
   */
  async initializeProvider(type: ProviderType): Promise<void> {
    const provider = this.providers.get(type);
    if (!provider) {
      throw new Error(`Provider ${type} not found`);
    }
    await provider.initialize();
  }

  /**
   * Set current active provider
   */
  async setCurrentProvider(type: ProviderType): Promise<void> {
    const provider = this.providers.get(type);
    if (!provider) {
      throw new Error(`Provider ${type} not found`);
    }

    if (!provider.isReady()) {
      await provider.initialize();
    }

    this.currentProvider = type;
    await this.saveToStorage();
  }

  /**
   * Get current active provider
   */
  getCurrentProvider(): BaseProvider | null {
    if (!this.currentProvider) return null;
    return this.providers.get(this.currentProvider) || null;
  }

  /**
   * Get current provider type
   */
  getCurrentProviderType(): ProviderType | null {
    return this.currentProvider;
  }

  /**
   * Get a specific provider
   */
  getProvider(type: ProviderType): BaseProvider | null {
    return this.providers.get(type) || null;
  }

  /**
   * Get info about all providers
   */
  getAllProvidersInfo(): ProviderInfo[] {
    const infos: ProviderInfo[] = [];
    for (const provider of this.providers.values()) {
      infos.push(provider.getInfo());
    }
    return infos;
  }

  /**
   * Get available (configured) providers
   */
  getAvailableProviders(): ProviderInfo[] {
    const available: ProviderInfo[] = [];
    for (const provider of this.providers.values()) {
      if (provider.getConfig().apiKey) {
        available.push(provider.getInfo());
      }
    }
    return available;
  }

  /**
   * Chat using current provider
   */
  async chat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<ChatResponse> {
    const provider = this.getCurrentProvider();
    if (!provider) {
      throw new Error('No provider configured');
    }
    return provider.chat(messages, options);
  }

  /**
   * Stream chat using current provider
   */
  async *streamChat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncIterable<StreamChunk> {
    const provider = this.getCurrentProvider();
    if (!provider) {
      yield { type: 'error', error: 'No provider configured' };
      return;
    }
    yield* provider.streamChat(messages, options);
  }

  /**
   * Check if any provider is configured
   */
  hasConfiguredProvider(): boolean {
    for (const provider of this.providers.values()) {
      if (provider.getConfig().apiKey) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get status of all providers
   */
  getProvidersStatus(): Record<ProviderType, { configured: boolean; ready: boolean }> {
    const status: Record<string, { configured: boolean; ready: boolean }> = {};
    for (const [type, provider] of this.providers) {
      status[type] = {
        configured: !!provider.getConfig().apiKey,
        ready: provider.isReady(),
      };
    }
    return status as Record<ProviderType, { configured: boolean; ready: boolean }>;
  }
}

// Export singleton instance
export const providerManager = ProviderManager.getInstance();

export default providerManager;
