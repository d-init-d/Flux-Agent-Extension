/**
 * Provider Settings Store
 * Zustand store để quản lý provider settings trong UI
 */

import { create } from 'zustand';
import type { ProviderType, ProviderInfo } from '../../providers/types';

interface ProviderSettingsState {
  /** Provider đang active */
  currentProvider: ProviderType | null;
  /** Danh sách providers có sẵn */
  availableProviders: ProviderInfo[];
  /** API keys (masked) */
  apiKeys: Record<ProviderType, string>;
  /** Provider status */
  providerStatus: Record<ProviderType, { configured: boolean; ready: boolean }>;
  /** Loading state */
  isLoading: boolean;
  /** Error message */
  error: string | null;
  /** Settings modal open */
  isSettingsOpen: boolean;
}

interface ProviderSettingsActions {
  /** Open settings modal */
  openSettings: () => void;
  /** Close settings modal */
  closeSettings: () => void;
  /** Set current provider */
  setCurrentProvider: (provider: ProviderType) => Promise<void>;
  /** Update API key */
  updateApiKey: (provider: ProviderType, apiKey: string) => Promise<void>;
  /** Load settings from background */
  loadSettings: () => Promise<void>;
  /** Clear error */
  clearError: () => void;
}

type ProviderSettingsStore = ProviderSettingsState & ProviderSettingsActions;

export const useProviderSettings = create<ProviderSettingsStore>((set, get) => ({
  // Initial state
  currentProvider: null,
  availableProviders: [],
  apiKeys: {
    claude: '',
    openai: '',
    gemini: '',
    ollama: '',
  },
  providerStatus: {
    claude: { configured: false, ready: false },
    openai: { configured: false, ready: false },
    gemini: { configured: false, ready: false },
    ollama: { configured: false, ready: false },
  },
  isLoading: false,
  error: null,
  isSettingsOpen: false,

  // Actions
  openSettings: () => set({ isSettingsOpen: true }),
  closeSettings: () => set({ isSettingsOpen: false }),
  clearError: () => set({ error: null }),

  loadSettings: async () => {
    set({ isLoading: true, error: null });

    try {
      // Get settings from background
      const response = await chrome.runtime.sendMessage({
        type: 'GET_PROVIDER_SETTINGS',
      });

      if (response.success) {
        set({
          currentProvider: response.data.currentProvider,
          availableProviders: response.data.availableProviders,
          providerStatus: response.data.providerStatus,
          apiKeys: response.data.apiKeys || get().apiKeys,
          isLoading: false,
        });
      } else {
        set({ error: response.error, isLoading: false });
      }
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },

  setCurrentProvider: async (provider: ProviderType) => {
    set({ isLoading: true, error: null });

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SET_PROVIDER',
        payload: { provider },
      });

      if (response.success) {
        set({ currentProvider: provider, isLoading: false });
      } else {
        set({ error: response.error, isLoading: false });
      }
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },

  updateApiKey: async (provider: ProviderType, apiKey: string) => {
    set({ isLoading: true, error: null });

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SET_API_KEY',
        payload: { provider, apiKey },
      });

      if (response.success) {
        // Update local state with masked key
        const maskedKey = apiKey ? `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}` : '';
        set(state => ({
          apiKeys: { ...state.apiKeys, [provider]: maskedKey },
          providerStatus: {
            ...state.providerStatus,
            [provider]: { configured: !!apiKey, ready: response.data?.ready || false },
          },
          isLoading: false,
        }));

        // Reload settings to get updated status
        await get().loadSettings();
      } else {
        set({ error: response.error, isLoading: false });
      }
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },
}));

export default useProviderSettings;
