import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  KeyRound,
  LaptopMinimal,
  RotateCw,
  ServerCog,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { ClaudeProvider, GeminiProvider, OllamaProvider, OpenAIProvider, OpenRouterProvider } from '@core/ai-client';
import type { AIModelConfig, AIProviderType, ExtensionSettings, ProviderConfig } from '@shared/types';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Select, Switch } from '@ui/components';
import type { BadgeVariant } from '@ui/components';

type SaveState = 'idle' | 'success' | 'error';
type ValidationState = 'idle' | 'success' | 'error';

interface ProviderDefinition {
  type: AIProviderType;
  label: string;
  tagline: string;
  defaultModel: string;
  requiresApiKey: boolean;
  supportsEndpoint: boolean;
  endpointLabel: string;
  endpointPlaceholder: string;
  accent: string;
}

interface ApiKeyMetadata {
  maskedValue: string;
  updatedAt: number;
}

type PermissionSettingKey =
  | 'includeScreenshotsInContext'
  | 'screenshotOnError'
  | 'allowCustomScripts'
  | 'showFloatingBar'
  | 'highlightElements'
  | 'soundNotifications';

interface PermissionDefinition {
  key: PermissionSettingKey;
  title: string;
  description: string;
  badge: string;
  tone: BadgeVariant;
}

type ProviderConfigMap = Record<AIProviderType, ProviderConfig>;
type ProviderMetadataMap = Partial<Record<AIProviderType, ApiKeyMetadata>>;

const PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  {
    type: 'claude',
    label: 'Claude',
    tagline: 'Anthropic models for reasoning-heavy tasks.',
    defaultModel: 'claude-3-5-sonnet-20241022',
    requiresApiKey: true,
    supportsEndpoint: false,
    endpointLabel: 'Endpoint',
    endpointPlaceholder: '',
    accent: 'from-orange-500/20 via-amber-400/10 to-transparent',
  },
  {
    type: 'openai',
    label: 'OpenAI',
    tagline: 'GPT models with optional compatible endpoint override.',
    defaultModel: 'gpt-4o-mini',
    requiresApiKey: true,
    supportsEndpoint: true,
    endpointLabel: 'Base URL override',
    endpointPlaceholder: 'https://api.openai.com',
    accent: 'from-emerald-500/20 via-cyan-400/10 to-transparent',
  },
  {
    type: 'gemini',
    label: 'Gemini',
    tagline: 'Google Gemini models for long-context workflows.',
    defaultModel: 'gemini-2.5-flash',
    requiresApiKey: true,
    supportsEndpoint: false,
    endpointLabel: 'Endpoint',
    endpointPlaceholder: '',
    accent: 'from-sky-500/20 via-indigo-400/10 to-transparent',
  },
  {
    type: 'openrouter',
    label: 'OpenRouter',
    tagline: 'Unified gateway across Anthropic, OpenAI, Google, and more.',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    requiresApiKey: true,
    supportsEndpoint: false,
    endpointLabel: 'Endpoint',
    endpointPlaceholder: '',
    accent: 'from-fuchsia-500/20 via-pink-400/10 to-transparent',
  },
  {
    type: 'ollama',
    label: 'Ollama',
    tagline: 'Local model runtime with loopback-only endpoint support.',
    defaultModel: 'llama3.2',
    requiresApiKey: false,
    supportsEndpoint: true,
    endpointLabel: 'Ollama server URL',
    endpointPlaceholder: 'http://localhost:11434',
    accent: 'from-slate-500/20 via-slate-300/10 to-transparent',
  },
  {
    type: 'custom',
    label: 'Custom',
    tagline: 'Manual endpoint setup for bespoke HTTPS APIs.',
    defaultModel: 'custom-model',
    requiresApiKey: false,
    supportsEndpoint: true,
    endpointLabel: 'Provider endpoint',
    endpointPlaceholder: 'https://your-provider.example.com/v1',
    accent: 'from-violet-500/20 via-indigo-400/10 to-transparent',
  },
];

const PROVIDER_LOOKUP = PROVIDER_DEFINITIONS.reduce(
  (accumulator, provider) => {
    accumulator[provider.type] = provider;
    return accumulator;
  },
  {} as Record<AIProviderType, ProviderDefinition>,
);

const STORAGE_KEYS = {
  activeProvider: 'activeProvider',
  providerConfigs: 'providers',
  settings: 'settings',
  apiKeyMetadata: 'providerKeyMetadata',
  legacySessionApiKeys: 'providerSessionApiKeys',
} as const;

const DEFAULT_PROVIDER: AIProviderType = 'openai';
const GENERIC_MASK = '••••••••••••';

const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  {
    key: 'includeScreenshotsInContext',
    title: 'Share screenshots with AI',
    description: 'Attach page captures as additional context when the model needs visual detail.',
    badge: 'Context',
    tone: 'warning',
  },
  {
    key: 'screenshotOnError',
    title: 'Capture screenshots on failures',
    description: 'Save visual clues after broken runs so troubleshooting stays faster.',
    badge: 'Recovery',
    tone: 'info',
  },
  {
    key: 'allowCustomScripts',
    title: 'Allow custom scripts',
    description: 'Unlock advanced script execution. Keep this off unless the workflow source is trusted.',
    badge: 'High risk',
    tone: 'error',
  },
  {
    key: 'showFloatingBar',
    title: 'Show floating bar',
    description: 'Keep a quick-launch surface visible on supported pages for faster access.',
    badge: 'Surface',
    tone: 'default',
  },
  {
    key: 'highlightElements',
    title: 'Highlight page targets',
    description: 'Reveal the element Flux is about to act on so automation stays legible.',
    badge: 'Guidance',
    tone: 'success',
  },
  {
    key: 'soundNotifications',
    title: 'Play sound notifications',
    description: 'Alert you when runs complete or need attention without watching the panel.',
    badge: 'Alerts',
    tone: 'default',
  },
];

function createDefaultProviderConfigs(): ProviderConfigMap {
  return PROVIDER_DEFINITIONS.reduce(
    (accumulator, provider) => {
      accumulator[provider.type] = {
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
      };
      return accumulator;
    },
    {} as ProviderConfigMap,
  );
}

function createDefaultSettings(): ExtensionSettings {
  return {
    language: 'auto',
    theme: 'system',
    defaultProvider: DEFAULT_PROVIDER,
    streamResponses: true,
    includeScreenshotsInContext: false,
    maxContextLength: 128_000,
    defaultTimeout: 30_000,
    autoRetryOnFailure: true,
    maxRetries: 3,
    screenshotOnError: true,
    allowCustomScripts: false,
    allowedDomains: [],
    blockedDomains: [],
    showFloatingBar: true,
    highlightElements: true,
    soundNotifications: false,
    debugMode: false,
    logNetworkRequests: false,
  };
}

function isProviderType(value: unknown): value is AIProviderType {
  return typeof value === 'string' && value in PROVIDER_LOOKUP;
}

function normalizeProviderConfigs(value: unknown): ProviderConfigMap {
  const defaults = createDefaultProviderConfigs();

  if (!value || typeof value !== 'object') {
    return defaults;
  }

  const partialConfigs = value as Partial<Record<AIProviderType, Partial<ProviderConfig>>>;

  for (const provider of PROVIDER_DEFINITIONS) {
    const existingConfig = partialConfigs[provider.type];
    if (!existingConfig) {
      continue;
    }

    defaults[provider.type] = {
      ...defaults[provider.type],
      ...existingConfig,
      model:
        typeof existingConfig.model === 'string' && existingConfig.model.trim().length > 0
          ? existingConfig.model
          : defaults[provider.type].model,
      maxTokens:
        typeof existingConfig.maxTokens === 'number' ? existingConfig.maxTokens : defaults[provider.type].maxTokens,
      temperature:
        typeof existingConfig.temperature === 'number'
          ? existingConfig.temperature
          : defaults[provider.type].temperature,
      customEndpoint:
        typeof existingConfig.customEndpoint === 'string'
          ? existingConfig.customEndpoint
          : defaults[provider.type].customEndpoint,
    };
  }

  return defaults;
}

function normalizeMetadata(value: unknown): ProviderMetadataMap {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const metadata: ProviderMetadataMap = {};

  for (const [key, rawMetadata] of Object.entries(value)) {
    if (!isProviderType(key) || !rawMetadata || typeof rawMetadata !== 'object') {
      continue;
    }

    const candidate = rawMetadata as Partial<ApiKeyMetadata>;
    if (typeof candidate.maskedValue !== 'string' || typeof candidate.updatedAt !== 'number') {
      continue;
    }

    metadata[key] = {
      maskedValue: candidate.maskedValue,
      updatedAt: candidate.updatedAt,
    };
  }

  return metadata;
}

function normalizeSettings(value: unknown): ExtensionSettings {
  const defaults = createDefaultSettings();

  if (!value || typeof value !== 'object') {
    return defaults;
  }

  const candidate = value as Partial<ExtensionSettings>;

  return {
    ...defaults,
    ...candidate,
    language:
      candidate.language === 'en' || candidate.language === 'vi' || candidate.language === 'auto'
        ? candidate.language
        : defaults.language,
    theme:
      candidate.theme === 'light' || candidate.theme === 'dark' || candidate.theme === 'system'
        ? candidate.theme
        : defaults.theme,
    defaultProvider: isProviderType(candidate.defaultProvider)
      ? candidate.defaultProvider
      : defaults.defaultProvider,
    allowedDomains: Array.isArray(candidate.allowedDomains)
      ? candidate.allowedDomains.filter((value): value is string => typeof value === 'string')
      : defaults.allowedDomains,
    blockedDomains: Array.isArray(candidate.blockedDomains)
      ? candidate.blockedDomains.filter((value): value is string => typeof value === 'string')
      : defaults.blockedDomains,
  };
}

function formatUpdatedAt(timestamp: number): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp);
}

function isLoopbackUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function isAllowedEndpoint(providerType: AIProviderType, endpoint: string): boolean {
  if (!endpoint) {
    return false;
  }

  try {
    const parsed = new URL(endpoint);

    if (providerType === 'ollama') {
      return parsed.protocol === 'http:' && isLoopbackUrl(endpoint);
    }

    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function buildValidationConfig(
  providerType: AIProviderType,
  providerConfig: ProviderConfig,
  apiKey: string,
): AIModelConfig {
  return {
    provider: providerType,
    model: providerConfig.model,
    apiKey: apiKey || undefined,
    baseUrl: providerConfig.customEndpoint?.trim() || undefined,
    maxTokens: providerConfig.maxTokens,
    temperature: providerConfig.temperature,
  };
}

async function validateProviderConnection(
  providerType: AIProviderType,
  providerConfig: ProviderConfig,
  apiKey: string,
): Promise<boolean> {
  if (providerType === 'custom') {
    return isAllowedEndpoint(providerType, providerConfig.customEndpoint?.trim() ?? '');
  }

  const config = buildValidationConfig(providerType, providerConfig, apiKey);

  switch (providerType) {
    case 'claude': {
      const provider = new ClaudeProvider();
      await provider.initialize(config);
      return provider.validateApiKey(apiKey);
    }
    case 'openai': {
      const provider = new OpenAIProvider();
      await provider.initialize(config);
      return provider.validateApiKey(apiKey);
    }
    case 'gemini': {
      const provider = new GeminiProvider();
      await provider.initialize(config);
      return provider.validateApiKey(apiKey);
    }
    case 'ollama': {
      const provider = new OllamaProvider();
      await provider.initialize(config);
      return provider.validateApiKey(apiKey);
    }
    case 'openrouter': {
      const provider = new OpenRouterProvider();
      await provider.initialize(config);
      return provider.validateApiKey(apiKey);
    }
    default:
      return false;
  }
}

export function App() {
  const [isReady, setIsReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingPermissions, setIsSavingPermissions] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<AIProviderType>(DEFAULT_PROVIDER);
  const [providerConfigs, setProviderConfigs] = useState<ProviderConfigMap>(() =>
    createDefaultProviderConfigs(),
  );
  const [settings, setSettings] = useState<ExtensionSettings>(() => createDefaultSettings());
  const [savedSettings, setSavedSettings] = useState<ExtensionSettings>(() => createDefaultSettings());
  const [apiKeyMetadata, setApiKeyMetadata] = useState<ProviderMetadataMap>({});
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveMessage, setSaveMessage] = useState('');
  const [permissionSaveState, setPermissionSaveState] = useState<SaveState>('idle');
  const [permissionMessage, setPermissionMessage] = useState('');
  const [validationState, setValidationState] = useState<ValidationState>('idle');
  const [validationMessage, setValidationMessage] = useState('');
  const [customScriptsConfirmed, setCustomScriptsConfirmed] = useState(false);
  const apiKeyInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadState(): Promise<void> {
      const localState = await chrome.storage.local.get([
        STORAGE_KEYS.activeProvider,
        STORAGE_KEYS.providerConfigs,
        STORAGE_KEYS.settings,
        STORAGE_KEYS.apiKeyMetadata,
      ]);
      await chrome.storage.session.remove(STORAGE_KEYS.legacySessionApiKeys);

      if (cancelled) {
        return;
      }

      const settings =
        localState[STORAGE_KEYS.settings] && typeof localState[STORAGE_KEYS.settings] === 'object'
          ? (localState[STORAGE_KEYS.settings] as Partial<ExtensionSettings>)
          : undefined;

      const activeProvider = isProviderType(localState[STORAGE_KEYS.activeProvider])
        ? localState[STORAGE_KEYS.activeProvider]
        : isProviderType(settings?.defaultProvider)
          ? settings.defaultProvider
          : DEFAULT_PROVIDER;

      const normalizedSettings = normalizeSettings(localState[STORAGE_KEYS.settings]);

      setSelectedProvider(activeProvider);
      setProviderConfigs(normalizeProviderConfigs(localState[STORAGE_KEYS.providerConfigs]));
      setSettings(normalizedSettings);
      setSavedSettings(normalizedSettings);
      setCustomScriptsConfirmed(normalizedSettings.allowCustomScripts);
      setApiKeyMetadata(normalizeMetadata(localState[STORAGE_KEYS.apiKeyMetadata]));
      setIsReady(true);
    }

    void loadState().catch(() => {
      if (!cancelled) {
        setSaveState('error');
        setSaveMessage('Could not load stored provider settings.');
        setIsReady(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedDefinition = PROVIDER_LOOKUP[selectedProvider];
  const selectedConfig = providerConfigs[selectedProvider];
  const savedMetadata = apiKeyMetadata[selectedProvider];

  function updateProviderConfig(patch: Partial<ProviderConfig>): void {
    setProviderConfigs((current) => ({
      ...current,
      [selectedProvider]: {
        ...current[selectedProvider],
        ...patch,
      },
    }));
    setSaveState('idle');
    setValidationState('idle');
  }

  function handleProviderChange(event: React.ChangeEvent<HTMLSelectElement>): void {
    const nextProvider = event.target.value;
    if (!isProviderType(nextProvider)) {
      return;
    }

    setSelectedProvider(nextProvider);
    setSaveState('idle');
    setPermissionSaveState('idle');
    setValidationState('idle');

    if (apiKeyInputRef.current) {
      apiKeyInputRef.current.value = '';
    }
  }

  async function handleSave(): Promise<void> {
    setIsSaving(true);
    setSaveState('idle');
    setValidationState('idle');

    try {
      if (selectedDefinition.supportsEndpoint) {
        const endpoint = selectedConfig.customEndpoint?.trim() ?? '';
        if (!isAllowedEndpoint(selectedProvider, endpoint)) {
          setSaveState('error');
          setSaveMessage(
            selectedProvider === 'ollama'
              ? 'Save blocked: use an http://localhost or http://127.0.0.1 Ollama endpoint.'
              : 'Save blocked: remote provider endpoints must use HTTPS.',
          );
          return;
        }
      }

      const nextSettings: ExtensionSettings = {
        ...savedSettings,
        defaultProvider: selectedProvider,
      };

      const rawApiKey = apiKeyInputRef.current?.value.trim() ?? '';
      const nextMetadata: ProviderMetadataMap = { ...apiKeyMetadata };

      if (rawApiKey) {
        nextMetadata[selectedProvider] = {
          maskedValue: GENERIC_MASK,
          updatedAt: Date.now(),
        };
      }

      await chrome.storage.local.set({
        [STORAGE_KEYS.activeProvider]: selectedProvider,
        [STORAGE_KEYS.providerConfigs]: providerConfigs,
        [STORAGE_KEYS.settings]: nextSettings,
        [STORAGE_KEYS.apiKeyMetadata]: nextMetadata,
      });
      await chrome.storage.session.remove(STORAGE_KEYS.legacySessionApiKeys);

      setApiKeyMetadata(nextMetadata);
      setSavedSettings(nextSettings);
      setSettings((current) => ({
        ...current,
        defaultProvider: selectedProvider,
      }));
      setSaveState('success');
      setSaveMessage(
        rawApiKey
          ? 'Provider settings saved. The key field was cleared and only masked metadata was retained.'
          : 'Provider settings saved. Re-enter a key later when encrypted persistence is wired.',
      );

      if (apiKeyInputRef.current) {
        apiKeyInputRef.current.value = '';
      }
    } catch {
      setSaveState('error');
      setSaveMessage('Failed to save provider settings.');
    } finally {
      setIsSaving(false);
    }
  }

  function pickPermissionSettings(source: ExtensionSettings): Pick<
    ExtensionSettings,
    PermissionSettingKey
  > {
    return {
      includeScreenshotsInContext: source.includeScreenshotsInContext,
      screenshotOnError: source.screenshotOnError,
      allowCustomScripts: source.allowCustomScripts,
      showFloatingBar: source.showFloatingBar,
      highlightElements: source.highlightElements,
      soundNotifications: source.soundNotifications,
    };
  }

  function handlePermissionToggle(key: PermissionSettingKey, checked: boolean): void {
    setSettings((current) => ({
      ...current,
      [key]: checked,
    }));

    if (key === 'allowCustomScripts') {
      setCustomScriptsConfirmed(!checked);
    }

    setPermissionSaveState('idle');
  }

  async function handleSavePermissions(): Promise<void> {
    setIsSavingPermissions(true);
    setPermissionSaveState('idle');

    try {
      if (settings.allowCustomScripts && !customScriptsConfirmed) {
        setPermissionSaveState('error');
        setPermissionMessage('Acknowledge the custom script warning before saving this permission profile.');
        return;
      }

      const permissionSettings = pickPermissionSettings(settings);
      const nextSettings: ExtensionSettings = {
        ...savedSettings,
        ...permissionSettings,
      };

      await chrome.storage.local.set({
        [STORAGE_KEYS.settings]: nextSettings,
      });

      setSavedSettings(nextSettings);
      setSettings((current) => ({
        ...current,
        ...permissionSettings,
      }));
      setPermissionSaveState('success');
      setPermissionMessage('Permission toggles saved. Flux will use these capability boundaries on the next run.');
    } catch {
      setPermissionSaveState('error');
      setPermissionMessage('Failed to save permission toggles.');
    } finally {
      setIsSavingPermissions(false);
    }
  }

  async function handleTestConnection(): Promise<void> {
    const rawApiKey = apiKeyInputRef.current?.value.trim() ?? '';

    if (selectedDefinition.requiresApiKey && !rawApiKey) {
      setValidationState('error');
      setValidationMessage('Enter an API key before testing this provider.');
      return;
    }

    if (selectedDefinition.supportsEndpoint) {
      const endpoint = selectedConfig.customEndpoint?.trim() ?? '';
      if (!isAllowedEndpoint(selectedProvider, endpoint)) {
        setValidationState('error');
        setValidationMessage(
          selectedProvider === 'ollama'
            ? 'Use an http://localhost or http://127.0.0.1 Ollama endpoint.'
            : 'Use a valid https:// endpoint before testing this provider.',
        );
        return;
      }
    }

    setIsTesting(true);
    setValidationState('idle');

    try {
      const isValid = await validateProviderConnection(selectedProvider, selectedConfig, rawApiKey);
      setValidationState(isValid ? 'success' : 'error');
      setValidationMessage(
        isValid
          ? `${selectedDefinition.label} responded successfully.`
          : `${selectedDefinition.label} could not be validated with the current settings.`,
      );
    } catch {
      setValidationState('error');
      setValidationMessage('Connection test failed unexpectedly.');
    } finally {
      setIsTesting(false);
      if (apiKeyInputRef.current) {
        apiKeyInputRef.current.value = '';
      }
    }
  }

  const statusTone =
    validationState === 'success'
      ? 'border-success-500/30 bg-success-50 text-success-700'
      : validationState === 'error' || saveState === 'error'
        ? 'border-error-500/30 bg-error-50 text-error-700'
        : saveState === 'success'
          ? 'border-primary-500/30 bg-primary-50 text-primary-700'
          : 'border-border bg-surface-primary text-content-secondary';

  const permissionTone =
    permissionSaveState === 'success'
      ? 'border-success-500/30 bg-success-50 text-success-700'
      : permissionSaveState === 'error'
        ? 'border-error-500/30 bg-error-50 text-error-700'
        : 'border-border bg-surface-primary text-content-secondary';

  const enabledPermissionCount = PERMISSION_DEFINITIONS.filter((permission) => settings[permission.key]).length;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgb(var(--color-primary-500)/0.14),_transparent_28%),linear-gradient(180deg,_rgb(var(--color-bg-secondary)),_rgb(var(--color-bg-primary))_26%)] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="relative overflow-hidden rounded-[28px] border border-border bg-surface-elevated shadow-xl shadow-slate-950/5">
          <div className="absolute inset-y-0 right-0 hidden w-1/2 bg-[radial-gradient(circle_at_top_right,_rgb(var(--color-primary-500)/0.18),_transparent_48%)] lg:block" />
          <div className="relative flex flex-col gap-6 px-6 py-7 sm:px-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary-500/20 bg-primary-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-primary-700">
                <Sparkles className="h-3.5 w-3.5" />
                Options - Control surface
              </div>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-content-primary">
                  Configure providers and capability boundaries in one place.
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-content-secondary sm:text-base">
                  The options workspace now covers provider setup and the first pass of runtime permission toggles without falling back to placeholder settings.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:w-[26rem]">
              <div className="rounded-2xl border border-border bg-surface-primary px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-content-tertiary">
                  Active provider
                </p>
                <p className="mt-2 text-sm font-semibold text-content-primary">
                  {selectedDefinition.label}
                </p>
              </div>
              <div className="rounded-2xl border border-border bg-surface-primary px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-content-tertiary">
                  Key status
                </p>
                <p className="mt-2 text-sm font-semibold text-content-primary">
                  {savedMetadata
                    ? 'Masked metadata saved'
                    : selectedDefinition.requiresApiKey
                      ? 'Needs entry'
                      : 'Not required'}
                </p>
              </div>
              <div className="rounded-2xl border border-border bg-surface-primary px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-content-tertiary">
                  Enabled capabilities
                </p>
                <p className="mt-2 text-sm font-semibold text-content-primary">{enabledPermissionCount}/{PERMISSION_DEFINITIONS.length}</p>
              </div>
            </div>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.4fr_0.9fr]">
          <div className="space-y-6">
            <Card className="overflow-hidden border border-border bg-surface-elevated shadow-lg shadow-slate-950/5">
              <CardHeader className="border-b border-border/80 bg-[linear-gradient(180deg,_rgb(var(--color-bg-secondary)),_transparent)]">
                <CardTitle as="h2">Provider settings</CardTitle>
                <CardDescription>
                  Provider dropdown, model config, masked API-key capture, and connection testing.
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-6 pt-6">
                <section className="grid gap-6 lg:grid-cols-[1.05fr_1fr]">
                  <div className="space-y-4 rounded-[24px] border border-border bg-surface-primary p-5">
                    <div>
                      <Select
                        id="provider-select"
                        label="Provider"
                        value={selectedProvider}
                        onChange={handleProviderChange}
                        options={PROVIDER_DEFINITIONS.map((provider) => ({
                          value: provider.type,
                          label: provider.label,
                        }))}
                        helperText={selectedDefinition.tagline}
                        className="bg-surface-elevated"
                      />
                    </div>

                    <div className={`rounded-2xl border bg-gradient-to-br ${selectedDefinition.accent} border-border px-4 py-4`}>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-content-tertiary">
                        Recommended default
                      </p>
                      <p className="mt-2 text-lg font-semibold tracking-tight text-content-primary">
                        {selectedDefinition.defaultModel}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-content-secondary">
                        Keep this as the starting point unless your account requires a different model id.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4 rounded-[24px] border border-border bg-surface-primary p-5">
                    <Input
                      label="Model"
                      value={selectedConfig.model}
                      onChange={(event) => updateProviderConfig({ model: event.target.value })}
                      placeholder={selectedDefinition.defaultModel}
                      helperText="Use the exact model id your provider expects."
                    />

                    {selectedDefinition.supportsEndpoint ? (
                      <Input
                        label={selectedDefinition.endpointLabel}
                        value={selectedConfig.customEndpoint ?? ''}
                        onChange={(event) => updateProviderConfig({ customEndpoint: event.target.value })}
                        placeholder={selectedDefinition.endpointPlaceholder}
                        helperText={
                          selectedProvider === 'ollama'
                            ? 'Only loopback URLs are allowed for local runtime testing.'
                            : 'Remote custom endpoints must use HTTPS.'
                        }
                      />
                    ) : null}

                    {selectedDefinition.requiresApiKey ? (
                      <div className="space-y-3">
                        <Input
                          ref={apiKeyInputRef}
                          label="API key"
                          type="password"
                          placeholder="Paste a provider key when needed"
                          helperText="This field is not persisted. Save stores only masked metadata, and test clears the field after validation."
                          autoComplete="off"
                          spellCheck={false}
                          onCopy={(event) => event.preventDefault()}
                        />

                        {savedMetadata ? (
                          <div className="rounded-2xl border border-border bg-surface-elevated px-4 py-3">
                            <div className="flex items-center gap-2 text-sm font-medium text-content-primary">
                              <KeyRound className="h-4 w-4 text-primary-600" />
                              Saved key metadata
                            </div>
                            <p className="mt-2 text-sm text-content-secondary">
                              {savedMetadata.maskedValue} - updated {formatUpdatedAt(savedMetadata.updatedAt)}
                            </p>
                            <p className="mt-1 text-xs text-content-tertiary">
                              Re-enter the raw key whenever you want to test until encrypted key persistence is wired.
                            </p>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-border bg-surface-elevated px-4 py-4 text-sm leading-6 text-content-secondary">
                        {selectedProvider === 'ollama'
                          ? 'Ollama skips API keys. Use the test button to verify the loopback runtime is reachable.'
                          : 'Custom provider baseline currently validates the endpoint only. Secret persistence stays disabled until secure encryption flow is connected.'}
                      </div>
                    )}

                    <div className={`rounded-2xl border px-4 py-3 text-sm ${statusTone}`}>
                      {validationMessage || saveMessage || 'Save changes, then test the selected provider configuration.'}
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <Button
                        type="button"
                        variant="secondary"
                        loading={isTesting}
                        onClick={() => {
                          void handleTestConnection();
                        }}
                        iconLeft={<RotateCw />}
                        disabled={!isReady}
                      >
                        Test connection
                      </Button>
                      <Button
                        type="button"
                        loading={isSaving}
                        onClick={() => {
                          void handleSave();
                        }}
                        iconLeft={<ShieldCheck />}
                        disabled={!isReady}
                      >
                        Save provider
                      </Button>
                    </div>
                  </div>
                </section>
              </CardContent>
            </Card>

            <Card className="overflow-hidden border border-border bg-surface-elevated shadow-lg shadow-slate-950/5">
              <CardHeader className="border-b border-border/80 bg-[linear-gradient(180deg,_rgb(var(--color-bg-secondary)),_transparent)]">
                <CardTitle as="h2">Permission toggles</CardTitle>
                <CardDescription>
                  Choose which runtime capabilities the extension is allowed to use before an automation flow starts.
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-6 pt-6">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <div className="rounded-2xl border border-border bg-surface-primary px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-content-tertiary">
                      Capability budget
                    </p>
                    <p className="mt-2 text-lg font-semibold text-content-primary">
                      {enabledPermissionCount}/{PERMISSION_DEFINITIONS.length}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border bg-surface-primary px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-content-tertiary">
                      Sensitive toggles
                    </p>
                    <p className="mt-2 text-lg font-semibold text-content-primary">
                      {settings.allowCustomScripts ? '1 enabled' : '0 enabled'}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border bg-surface-primary px-4 py-3 sm:col-span-2 xl:col-span-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-content-tertiary">
                      Default behavior
                    </p>
                    <p className="mt-2 text-sm font-semibold text-content-primary">
                      Visual guidance stays on, high-risk scripting stays off.
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  {PERMISSION_DEFINITIONS.map((permission) => (
                    <div
                      key={permission.key}
                      className="flex min-h-11 items-start justify-between gap-4 rounded-[22px] border border-border bg-surface-primary px-4 py-4 transition-colors duration-fast hover:border-primary-300 hover:bg-primary-50/40"
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 flex-col items-start space-y-2 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2"
                        onClick={() => handlePermissionToggle(permission.key, !settings[permission.key])}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-content-primary">{permission.title}</p>
                          <Badge variant={permission.tone}>{permission.badge}</Badge>
                        </div>
                        <p className="text-sm leading-6 text-content-secondary">{permission.description}</p>
                      </button>

                      <Switch
                        checked={settings[permission.key]}
                        onCheckedChange={(checked) => handlePermissionToggle(permission.key, checked)}
                        aria-label={permission.title}
                      />
                    </div>
                  ))}
                </div>

                {settings.allowCustomScripts ? (
                  <div className="rounded-[22px] border border-error-500/20 bg-error-50 px-4 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="error">High-risk capability</Badge>
                      <p className="text-sm font-semibold text-error-700">Custom scripts can execute arbitrary page logic.</p>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-error-700">
                      Leave this off unless you trust the workflow source and understand that scripts can interact with live page state beyond standard guarded actions.
                    </p>
                    <label className="mt-3 flex items-start gap-3 text-sm text-error-700">
                      <input
                        type="checkbox"
                        checked={customScriptsConfirmed}
                        onChange={(event) => setCustomScriptsConfirmed(event.target.checked)}
                        className="mt-1 h-4 w-4 rounded border-error-500/40 text-error-600 focus:ring-error-500"
                      />
                      <span>I understand the risk and want to allow custom scripts for trusted workflows only.</span>
                    </label>
                  </div>
                ) : null}

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className={`rounded-2xl border px-4 py-3 text-sm ${permissionTone}`}>
                    {permissionMessage || 'Toggle the capabilities you want to allow, then save the permission profile.'}
                  </div>

                  <Button
                    type="button"
                    loading={isSavingPermissions}
                    onClick={() => {
                      void handleSavePermissions();
                    }}
                    iconLeft={<CheckCircle2 />}
                    disabled={!isReady}
                  >
                    Save permissions
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="border border-border bg-surface-elevated shadow-lg shadow-slate-950/5">
              <CardHeader>
                <CardTitle as="h2">What is ready now</CardTitle>
                <CardDescription>Immediate capabilities available from the current options baseline.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-content-secondary">
                <div className="flex items-start gap-3 rounded-2xl border border-border bg-surface-primary px-4 py-3">
                  <ServerCog className="mt-0.5 h-4 w-4 text-primary-600" />
                  <p>Provider selection persists through `chrome.storage.local` with a real dropdown control.</p>
                </div>
                <div className="flex items-start gap-3 rounded-2xl border border-border bg-surface-primary px-4 py-3">
                  <KeyRound className="mt-0.5 h-4 w-4 text-primary-600" />
                  <p>Raw API keys are not written to extension storage; only masked metadata remains after save.</p>
                </div>
                <div className="flex items-start gap-3 rounded-2xl border border-border bg-surface-primary px-4 py-3">
                  <RotateCw className="mt-0.5 h-4 w-4 text-primary-600" />
                  <p>The test action validates the selected provider and clears the key field after the check completes.</p>
                </div>
                <div className="flex items-start gap-3 rounded-2xl border border-border bg-surface-primary px-4 py-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary-600" />
                  <p>Permission toggles now persist capability boundaries like screenshots, highlights, floating UI, and custom scripts.</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border border-border bg-surface-elevated shadow-lg shadow-slate-950/5">
              <CardHeader>
                <CardTitle as="h2">Next in the queue</CardTitle>
                <CardDescription>Upcoming work already mapped in the tracker.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-content-secondary">
                <div className="rounded-2xl border border-border bg-surface-primary px-4 py-3">
                  <div className="flex items-center gap-2 font-medium text-content-primary">
                    <Sparkles className="h-4 w-4 text-primary-600" />
                    U-09 appearance settings
                  </div>
                  <p className="mt-1">Theme and language controls can hook into the same settings state without another storage rewrite.</p>
                </div>
                <div className="rounded-2xl border border-border bg-surface-primary px-4 py-3">
                  <div className="flex items-center gap-2 font-medium text-content-primary">
                    <LaptopMinimal className="h-4 w-4 text-primary-600" />
                    U-10 onboarding flow
                  </div>
                  <p className="mt-1">The onboarding screens can now reuse provider setup and permission copy from this page.</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
