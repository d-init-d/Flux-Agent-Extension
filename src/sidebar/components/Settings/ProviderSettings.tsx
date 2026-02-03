/**
 * Provider Settings Component
 * UI để configure AI providers
 */

import React, { useEffect, useState } from 'react';
import { Settings, Key, Check, X, ChevronDown, Loader2, AlertCircle } from 'lucide-react';
import { useProviderSettings } from '../stores/providerStore';
import type { ProviderType } from '../../providers/types';

const PROVIDER_ICONS: Record<ProviderType, string> = {
  claude: '🟣',
  openai: '🟢',
  gemini: '🔵',
  ollama: '🦙',
};

const PROVIDER_NAMES: Record<ProviderType, string> = {
  claude: 'Claude (Anthropic)',
  openai: 'OpenAI GPT-4',
  gemini: 'Google Gemini',
  ollama: 'Ollama (Local)',
};

export const ProviderSettings: React.FC = () => {
  const {
    currentProvider,
    providerStatus,
    isLoading,
    error,
    isSettingsOpen,
    openSettings,
    closeSettings,
    loadSettings,
    setCurrentProvider,
    updateApiKey,
    clearError,
  } = useProviderSettings();

  const [editingProvider, setEditingProvider] = useState<ProviderType | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const handleSaveApiKey = async () => {
    if (!editingProvider) return;
    await updateApiKey(editingProvider, apiKeyInput);
    setEditingProvider(null);
    setApiKeyInput('');
  };

  const handleSelectProvider = async (provider: ProviderType) => {
    if (providerStatus[provider]?.configured) {
      await setCurrentProvider(provider);
      setShowDropdown(false);
    }
  };

  const configuredProviders = Object.entries(providerStatus)
    .filter(([_, status]) => status.configured)
    .map(([type]) => type as ProviderType);

  return (
    <>
      {/* Provider Selector Button */}
      <div className="relative">
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
        >
          {currentProvider ? (
            <>
              <span>{PROVIDER_ICONS[currentProvider]}</span>
              <span className="hidden sm:inline">{PROVIDER_NAMES[currentProvider]}</span>
            </>
          ) : (
            <span className="text-gray-500">Select Provider</span>
          )}
          <ChevronDown className="w-4 h-4" />
        </button>

        {/* Dropdown */}
        {showDropdown && (
          <div className="absolute top-full right-0 mt-1 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50">
            {configuredProviders.length > 0 ? (
              <>
                {configuredProviders.map(provider => (
                  <button
                    key={provider}
                    onClick={() => handleSelectProvider(provider)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 first:rounded-t-lg ${
                      currentProvider === provider ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                    }`}
                  >
                    <span>{PROVIDER_ICONS[provider]}</span>
                    <span className="flex-1">{PROVIDER_NAMES[provider]}</span>
                    {currentProvider === provider && (
                      <Check className="w-4 h-4 text-blue-500" />
                    )}
                  </button>
                ))}
                <hr className="border-gray-200 dark:border-gray-700" />
              </>
            ) : (
              <div className="px-3 py-2 text-sm text-gray-500">
                No providers configured
              </div>
            )}
            <button
              onClick={() => {
                openSettings();
                setShowDropdown(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 rounded-b-lg"
            >
              <Settings className="w-4 h-4" />
              <span>Settings</span>
            </button>
          </div>
        )}
      </div>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md max-h-[80vh] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold">AI Provider Settings</h2>
              <button
                onClick={closeSettings}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-4 overflow-y-auto max-h-[60vh]">
              {error && (
                <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-2 text-red-700 dark:text-red-300">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-sm">{error}</span>
                  <button onClick={clearError} className="ml-auto">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              <div className="space-y-4">
                {(['claude', 'openai', 'gemini'] as ProviderType[]).map(provider => (
                  <div
                    key={provider}
                    className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg"
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-2xl">{PROVIDER_ICONS[provider]}</span>
                      <div className="flex-1">
                        <h3 className="font-medium">{PROVIDER_NAMES[provider]}</h3>
                        <span
                          className={`text-xs ${
                            providerStatus[provider]?.configured
                              ? 'text-green-600 dark:text-green-400'
                              : 'text-gray-500'
                          }`}
                        >
                          {providerStatus[provider]?.configured ? 'Configured' : 'Not configured'}
                        </span>
                      </div>
                      {providerStatus[provider]?.configured && currentProvider !== provider && (
                        <button
                          onClick={() => setCurrentProvider(provider)}
                          className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
                          disabled={isLoading}
                        >
                          Use
                        </button>
                      )}
                      {currentProvider === provider && (
                        <span className="px-3 py-1 text-sm bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded">
                          Active
                        </span>
                      )}
                    </div>

                    {editingProvider === provider ? (
                      <div className="flex gap-2">
                        <input
                          type="password"
                          value={apiKeyInput}
                          onChange={e => setApiKeyInput(e.target.value)}
                          placeholder="Enter API key..."
                          className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500 outline-none"
                          autoFocus
                        />
                        <button
                          onClick={handleSaveApiKey}
                          disabled={isLoading || !apiKeyInput}
                          className="px-3 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50"
                        >
                          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => {
                            setEditingProvider(null);
                            setApiKeyInput('');
                          }}
                          className="px-3 py-2 bg-gray-200 dark:bg-gray-600 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setEditingProvider(provider)}
                        className="flex items-center gap-2 text-sm text-blue-500 hover:text-blue-600"
                      >
                        <Key className="w-4 h-4" />
                        {providerStatus[provider]?.configured ? 'Update API Key' : 'Add API Key'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500">
              API keys are stored locally and never sent to third parties.
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ProviderSettings;
