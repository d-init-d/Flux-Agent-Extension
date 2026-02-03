/**
 * Provider Message Handlers
 * Xử lý các message liên quan đến AI providers
 */

import { messageHub } from './message-hub';
import { providerManager } from '../providers';
import type { ProviderType } from '../providers/types';
import { logger } from '@shared/logger';

/**
 * Initialize provider handlers
 */
export function initProviderHandlers(): void {
  // Get provider settings
  messageHub.on('GET_PROVIDER_SETTINGS', async () => {
    try {
      await providerManager.loadFromStorage();
      
      const currentProvider = providerManager.getCurrentProviderType();
      const availableProviders = providerManager.getAllProvidersInfo();
      const providerStatus = providerManager.getProvidersStatus();

      // Mask API keys
      const apiKeys: Record<ProviderType, string> = {
        claude: '',
        openai: '',
        gemini: '',
        ollama: '',
      };

      for (const type of ['claude', 'openai', 'gemini'] as ProviderType[]) {
        const provider = providerManager.getProvider(type);
        const key = provider?.getConfig().apiKey;
        if (key) {
          apiKeys[type] = `${key.slice(0, 8)}...${key.slice(-4)}`;
        }
      }

      return {
        success: true,
        data: {
          currentProvider,
          availableProviders,
          providerStatus,
          apiKeys,
        },
      };
    } catch (error) {
      logger.error('Failed to get provider settings:', error);
      return { success: false, error: String(error) };
    }
  });

  // Set current provider
  messageHub.on('SET_PROVIDER', async (message) => {
    try {
      const { provider } = message.payload as { provider: ProviderType };
      await providerManager.setCurrentProvider(provider);
      
      return { success: true };
    } catch (error) {
      logger.error('Failed to set provider:', error);
      return { success: false, error: String(error) };
    }
  });

  // Set API key
  messageHub.on('SET_API_KEY', async (message) => {
    try {
      const { provider, apiKey } = message.payload as {
        provider: ProviderType;
        apiKey: string;
      };

      providerManager.configureProvider(provider, { apiKey });
      
      // Try to initialize the provider
      let ready = false;
      try {
        await providerManager.initializeProvider(provider);
        ready = true;
      } catch {
        // Provider configured but not validated
      }

      await providerManager.saveToStorage();

      return { success: true, data: { ready } };
    } catch (error) {
      logger.error('Failed to set API key:', error);
      return { success: false, error: String(error) };
    }
  });

  // Chat with AI
  messageHub.on('CHAT_WITH_AI', async (message) => {
    try {
      const { messages, options } = message.payload as {
        messages: Array<{ role: string; content: string }>;
        options?: Record<string, unknown>;
      };

      const provider = providerManager.getCurrentProvider();
      if (!provider) {
        return { success: false, error: 'No provider configured' };
      }

      const response = await provider.chat(
        messages.map(m => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content,
        })),
        options
      );

      return { success: true, data: response };
    } catch (error) {
      logger.error('Failed to chat with AI:', error);
      return { success: false, error: String(error) };
    }
  });

  logger.info('Provider handlers initialized');
}

export default initProviderHandlers;
