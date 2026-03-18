import { MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Github,
  KeyRound,
  Loader2,
  PlugZap,
  RotateCw,
  ServerCog,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  createDefaultProviderConfigs as createRegistryDefaultProviderConfigs,
  getProviderAuthChoiceById,
  getProviderAuthChoices,
  PROVIDER_LOOKUP,
  PROVIDER_REGISTRY,
  providerRequiresConnectionValidation,
} from '@shared/config';
import type { ProviderDefinition } from '@shared/config';
import {
  evaluateProviderEndpointPolicy,
  getProviderEndpointHelperText,
  normalizeProviderEndpointConfig,
} from '@shared/provider-endpoints';
import { runDeviceFlow } from '@core/auth/github-device-flow';
import { sendExtensionRequest } from '@shared/extension-client';
import {
  createDefaultOnboardingState,
  normalizeOnboardingState,
  ONBOARDING_STORAGE_KEY,
} from '@shared/storage/onboarding';
import type {
  AccountAuthArtifactImportPayload,
  AccountAuthStatusGetResponse,
  AccountQuotaStatusGetResponse,
  AIProviderType,
  ExtensionSettings,
  OnboardingState,
  ProviderAccountRecord,
  ProviderConfig,
  ProviderQuotaState,
  ProviderSessionStatus,
  SettingsGetResponse,
  VaultState,
} from '@shared/types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Select,
  Switch,
} from '@ui/components';
import type { BadgeVariant } from '@ui/components';
import { ThemeToggle, useTheme } from '@ui/theme';
import { OnboardingFlow } from './onboarding';

type SaveState = 'idle' | 'success' | 'error';
type ValidationState = 'idle' | 'success' | 'error';
type OpenAIAuthChoiceId = 'api-key' | 'browser-account';

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

const PROVIDER_DEFINITIONS: ProviderDefinition[] = [...PROVIDER_REGISTRY];

const STORAGE_KEYS = {
  activeProvider: 'activeProvider',
  providerConfigs: 'providers',
  settings: 'settings',
  apiKeyMetadata: 'providerKeyMetadata',
  onboarding: ONBOARDING_STORAGE_KEY,
  legacySessionApiKeys: 'providerSessionApiKeys',
} as const;

const DEFAULT_PROVIDER: AIProviderType = 'openai';
const DEFAULT_OPENAI_AUTH_CHOICE_ID: OpenAIAuthChoiceId = 'api-key';
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
    description:
      'Unlock advanced script execution. Keep this off unless the workflow source is trusted.',
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
  return createRegistryDefaultProviderConfigs();
}

function resolveProviderAuthChoice(
  provider: AIProviderType,
  config: Pick<ProviderConfig, 'authChoiceId'>,
) {
  return getProviderAuthChoiceById(provider, config.authChoiceId);
}

function usesProviderApiKeyLane(
  provider: AIProviderType,
  config: Pick<ProviderConfig, 'authChoiceId'>,
): boolean {
  return resolveProviderAuthChoice(provider, config).authMethod === 'api-key';
}

function usesProviderBrowserAccountLane(
  provider: AIProviderType,
  config: Pick<ProviderConfig, 'authChoiceId'>,
): boolean {
  return resolveProviderAuthChoice(provider, config).authMethod === 'browser-login';
}

function usesProviderAccountImportLane(
  provider: AIProviderType,
  config: Pick<ProviderConfig, 'authChoiceId'>,
): boolean {
  return resolveProviderAuthChoice(provider, config).authMethod === 'account-import';
}

function usesProviderAccountSurface(
  provider: AIProviderType,
  config: Pick<ProviderConfig, 'authChoiceId'>,
): boolean {
  return resolveProviderAuthChoice(provider, config).authFamily === 'account-backed';
}

function normalizeOpenAIAuthChoiceId(value: unknown): OpenAIAuthChoiceId {
  return value === 'browser-account' ? 'browser-account' : DEFAULT_OPENAI_AUTH_CHOICE_ID;
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
        typeof existingConfig.maxTokens === 'number'
          ? existingConfig.maxTokens
          : defaults[provider.type].maxTokens,
      temperature:
        typeof existingConfig.temperature === 'number'
          ? existingConfig.temperature
          : defaults[provider.type].temperature,
      authChoiceId:
        provider.type === 'openai'
          ? normalizeOpenAIAuthChoiceId(existingConfig.authChoiceId)
          : defaults[provider.type].authChoiceId,
      customEndpoint:
        typeof existingConfig.customEndpoint === 'string'
          ? normalizeProviderEndpointConfig(provider.type, {
              ...defaults[provider.type],
              ...existingConfig,
            }).customEndpoint
          : defaults[provider.type].customEndpoint,
    };
  }

  return defaults;
}

function normalizeSettings(value: unknown): ExtensionSettings {
  const defaults = createDefaultSettings();

  if (!value || typeof value !== 'object') {
    return defaults;
  }

  const candidate = value as Partial<ExtensionSettings>;

  const debugMode = candidate.debugMode === true;

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
    allowCustomScripts: debugMode && candidate.allowCustomScripts === true,
    debugMode,
    allowedDomains: Array.isArray(candidate.allowedDomains)
      ? candidate.allowedDomains.filter((value): value is string => typeof value === 'string')
      : defaults.allowedDomains,
    blockedDomains: Array.isArray(candidate.blockedDomains)
      ? candidate.blockedDomains.filter((value): value is string => typeof value === 'string')
      : defaults.blockedDomains,
  };
}

function createDefaultVaultState(): VaultState {
  return {
    version: 1,
    initialized: false,
    lockState: 'uninitialized',
    hasLegacySecrets: false,
    credentials: {},
    accounts: {},
    activeAccounts: {},
    browserLogins: {},
  };
}

function mapVaultToMetadata(vault: VaultState): ProviderMetadataMap {
  const metadata: ProviderMetadataMap = {};

  for (const [provider, record] of Object.entries(vault.credentials)) {
    if (!isProviderType(provider) || !record) {
      continue;
    }

    metadata[provider] = {
      maskedValue: record.maskedValue,
      updatedAt: record.updatedAt,
    };
  }

  return metadata;
}
function formatUpdatedAt(timestamp: number): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp);
}

function formatObservedAt(timestamp: number | undefined): string | null {
  if (!timestamp) {
    return null;
  }

  return formatUpdatedAt(timestamp);
}

function inferArtifactFormat(value: string): AccountAuthArtifactImportPayload['format'] {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'unknown';
  }

  return trimmed.startsWith('{') ? 'json' : 'text';
}

function getPreferredAccountId(
  accounts: ProviderAccountRecord[],
  activeAccountId: string | undefined,
): string | undefined {
  return (
    activeAccountId ?? accounts.find((account) => account.isActive)?.accountId ?? accounts[0]?.accountId
  );
}

function formatQuotaSummary(quota: ProviderQuotaState | undefined): string {
  if (!quota) {
    return 'Quota telemetry has not been observed yet.';
  }

  const periodLabel = quota.period === 'unknown' ? 'window' : quota.period;
  const unitLabel = quota.unit === 'unknown' ? 'credits' : quota.unit;

  if (typeof quota.remaining === 'number' && typeof quota.limit === 'number') {
    return `${quota.remaining}/${quota.limit} ${unitLabel} remaining this ${periodLabel}.`;
  }

  if (typeof quota.used === 'number' && typeof quota.limit === 'number') {
    return `${quota.used}/${quota.limit} ${unitLabel} used this ${periodLabel}.`;
  }

  return `Quota snapshot observed for this ${periodLabel}.`;
}

function getAccountSessionStatus(account: ProviderAccountRecord | undefined): ProviderSessionStatus | undefined {
  return account?.metadata?.session?.status;
}

function getAccountBadgeVariant(account: ProviderAccountRecord): BadgeVariant {
  const sessionStatus = getAccountSessionStatus(account);

  if (account.status === 'revoked' || sessionStatus === 'revoked') {
    return 'error';
  }

  if (
    account.stale ||
    account.status === 'needs-auth' ||
    sessionStatus === 'refresh-required' ||
    sessionStatus === 'expired'
  ) {
    return 'warning';
  }

  if (account.validatedAt || account.status === 'active') {
    return 'success';
  }

  return 'default';
}

function getAccountBadgeLabel(account: ProviderAccountRecord): string {
  const sessionStatus = getAccountSessionStatus(account);

  if (account.status === 'revoked' || sessionStatus === 'revoked') {
    return 'Revoked';
  }

  if (sessionStatus === 'refresh-required') {
    return 'Refresh required';
  }

  if (sessionStatus === 'expired') {
    return 'Session expired';
  }

  if (account.status === 'needs-auth') {
    return 'Needs auth';
  }

  if (account.stale) {
    return 'Stale';
  }

  if (account.validatedAt) {
    return 'Validated';
  }

  if (account.status === 'active') {
    return 'Active';
  }

  return 'Imported';
}

function getAccountStatusDetail(account: ProviderAccountRecord, vaultLocked: boolean): string {
  const sessionStatus = getAccountSessionStatus(account);
  const lastChecked = formatObservedAt(account.validatedAt ?? account.updatedAt);

  if (account.status === 'revoked' || sessionStatus === 'revoked') {
    return 'This imported account has been revoked. Remove it or import a fresh official artifact before using Codex again.';
  }

  if (sessionStatus === 'refresh-required') {
    return 'The imported account needs a newer official artifact before Codex runtime sessions can resume safely.';
  }

  if (sessionStatus === 'expired') {
    return 'The recorded runtime session looks expired. Re-import the official artifact, then validate again.';
  }

  if (account.status === 'needs-auth') {
    return 'This account is stored, but it still needs a fresh official auth artifact before it can be trusted.';
  }

  if (account.stale) {
    return 'The imported account changed after the last validation. Re-run validation before relying on it.';
  }

  if (vaultLocked) {
    return 'Unlock the vault to validate, activate, or refresh quota for this imported account.';
  }

  if (account.validatedAt && lastChecked) {
    return `Validated against the background runtime on ${lastChecked}.`;
  }

  return 'Imported and stored in the encrypted vault. Run validation before treating it as ready.';
}

function getBrowserLoginBadgeVariant(
  status: AccountAuthStatusGetResponse['browserLogin'] extends infer T
    ? T extends { status: infer U }
      ? U
      : never
    : never,
): BadgeVariant {
  switch (status) {
    case 'success':
      return 'success';
    case 'pending':
    case 'helper-missing':
    case 'timeout':
    case 'stale':
    case 'mismatch':
      return 'warning';
    case 'cancel':
    case 'error':
      return 'error';
    default:
      return 'default';
  }
}

function getBrowserLoginStatusLabel(status: AccountAuthStatusGetResponse['browserLogin']): string {
  switch (status?.status) {
    case 'success':
      return 'Trusted account available';
    case 'pending':
      return 'Browser login pending';
    case 'helper-missing':
      return 'Helper unavailable';
    case 'timeout':
      return 'Browser login timed out';
    case 'cancel':
      return 'Browser login cancelled';
    case 'stale':
      return 'Browser login stale';
    case 'mismatch':
      return 'Browser login mismatch';
    case 'error':
      return 'Browser login error';
    default:
      return 'Not connected';
  }
}

function getOpenAIBrowserLoginHelperText(
  status: AccountAuthStatusGetResponse | null,
  activeAccount: ProviderAccountRecord | undefined,
  vaultLocked: boolean,
): string {
  if (vaultLocked) {
    return 'Unlock the vault before validating or using OpenAI browser-account artifacts.';
  }

  if (activeAccount?.validatedAt) {
    return `Trusted browser-account artifacts already exist for ${activeAccount.label}. Test connection re-validates the stored state without exposing raw helper data.`;
  }

  switch (status?.browserLogin?.status) {
    case 'helper-missing':
      return 'The browser helper is not available in this build. Flux reports the missing-helper state explicitly and will not pretend browser login succeeded.';
    case 'pending':
      return 'A browser-account request is already pending in the background. Wait for the trusted status to change before testing again.';
    case 'success':
      return 'Trusted browser-account artifacts were detected. Run Test connection to validate the active account-backed state.';
    case 'cancel':
      return 'The last browser-account attempt was cancelled. Start a new connect attempt once the helper is available.';
    case 'timeout':
      return 'The last browser-account attempt timed out. Retry only after the helper is available and ready.';
    case 'stale':
    case 'mismatch':
    case 'error':
      return 'The saved browser-account state is not currently trusted. Reconnect with the helper or validate a previously trusted artifact.';
    default:
      return 'Use Connect browser account to ask the background for trusted OpenAI browser-account status. If the helper is unavailable, Flux will surface helper-missing instead of faking success.';
  }
}

const SECRET_ERROR_PATTERNS = [
  /(?:^|\b)sk-[A-Za-z0-9_-]{8,}/,
  /(?:^|\b)ghu_[A-Za-z0-9_]{8,}/,
  /(?:^|\b)gho_[A-Za-z0-9_]{8,}/,
  /(?:^|\b)github_pat_[A-Za-z0-9_]{12,}/,
  /(?:^|\b)AIza[0-9A-Za-z\-_]{12,}/,
];

function containsSensitiveToken(value: string): boolean {
  return SECRET_ERROR_PATTERNS.some((pattern) => pattern.test(value));
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const message = error.message.trim();
  if (!message || containsSensitiveToken(message)) {
    return fallback;
  }

  return message;
}

function isAdvancedModeEnabled(settings: Pick<ExtensionSettings, 'debugMode'>): boolean {
  return settings.debugMode;
}

function isCustomScriptingEnabled(
  settings: Pick<ExtensionSettings, 'debugMode' | 'allowCustomScripts'>,
): boolean {
  return settings.debugMode && settings.allowCustomScripts;
}

function getProviderAccounts(
  vault: Pick<VaultState, 'accounts'>,
  provider: AIProviderType,
): ProviderAccountRecord[] {
  return vault.accounts[provider] ?? [];
}

function getActiveProviderAccount(
  vault: Pick<VaultState, 'accounts' | 'activeAccounts'>,
  provider: AIProviderType,
): ProviderAccountRecord | undefined {
  const accounts = getProviderAccounts(vault, provider);
  const activeAccountId = vault.activeAccounts[provider];

  return accounts.find((account) => account.accountId === activeAccountId) ?? accounts[0];
}

export function App() {
  const { setMode } = useTheme();
  const [isReady, setIsReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingPermissions, setIsSavingPermissions] = useState(false);
  const [isSavingAppearance, setIsSavingAppearance] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isVaultBusy, setIsVaultBusy] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<AIProviderType>(DEFAULT_PROVIDER);
  const [providerConfigs, setProviderConfigs] = useState<ProviderConfigMap>(() =>
    createDefaultProviderConfigs(),
  );
  const [onboardingState, setOnboardingState] = useState<OnboardingState>(() =>
    createDefaultOnboardingState(),
  );
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [isCompletingOnboarding, setIsCompletingOnboarding] = useState(false);
  const [settings, setSettings] = useState<ExtensionSettings>(() => createDefaultSettings());
  const [vaultState, setVaultState] = useState<VaultState>(() => createDefaultVaultState());
  const [apiKeyMetadata, setApiKeyMetadata] = useState<ProviderMetadataMap>({});
  const [vaultPassphrase, setVaultPassphrase] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveMessage, setSaveMessage] = useState('');
  const [vaultNoticeState, setVaultNoticeState] = useState<SaveState>('idle');
  const [vaultNotice, setVaultNotice] = useState('');
  const [permissionSaveState, setPermissionSaveState] = useState<SaveState>('idle');
  const [permissionMessage, setPermissionMessage] = useState('');
  const [appearanceSaveState, setAppearanceSaveState] = useState<SaveState>('idle');
  const [appearanceMessage, setAppearanceMessage] = useState('');
  const [validationState, setValidationState] = useState<ValidationState>('idle');
  const [validationMessage, setValidationMessage] = useState('');
  const [customScriptsConfirmed, setCustomScriptsConfirmed] = useState(false);
  const [oauthState, setOauthState] = useState<
    'idle' | 'requesting' | 'waiting' | 'success' | 'error'
  >('idle');
  const [oauthUserCode, setOauthUserCode] = useState('');
  const [oauthVerifyUrl, setOauthVerifyUrl] = useState('');
  const [oauthError, setOauthError] = useState('');
  const [accountAuthStatus, setAccountAuthStatus] = useState<AccountAuthStatusGetResponse | null>(
    null,
  );
  const [accountQuotaStatus, setAccountQuotaStatus] = useState<AccountQuotaStatusGetResponse | null>(
    null,
  );
  const [accountArtifactValue, setAccountArtifactValue] = useState('');
  const [accountImportLabel, setAccountImportLabel] = useState('');
  const [accountMessageState, setAccountMessageState] = useState<SaveState>('idle');
  const [accountMessage, setAccountMessage] = useState('');
  const [accountActionKey, setAccountActionKey] = useState<string | null>(null);
  const oauthAbortRef = useRef<AbortController | null>(null);
  const apiKeyInputRef = useRef<HTMLInputElement | null>(null);
  const onboardingStateRef = useRef<OnboardingState>(createDefaultOnboardingState());
  const suppressOnboardingAutoOpenRef = useRef(false);

  const clearApiKeyInputValue = useCallback((): void => {
    if (apiKeyInputRef.current) {
      apiKeyInputRef.current.value = '';
    }
  }, []);

  const syncVaultState = useCallback((nextVault: VaultState): void => {
    setVaultState(nextVault);
    setApiKeyMetadata(mapVaultToMetadata(nextVault));
  }, []);

  const resetAccountMessage = useCallback((): void => {
    setAccountMessageState('idle');
    setAccountMessage('');
  }, []);

  const loadAccountSurface = useCallback(
    async (provider: AIProviderType): Promise<AccountAuthStatusGetResponse> => {
      const authStatus = await sendExtensionRequest(
        'ACCOUNT_AUTH_STATUS_GET',
        { provider },
        'options',
      );
      const accountList = await sendExtensionRequest('ACCOUNT_LIST', { provider }, 'options');
      const mergedStatus: AccountAuthStatusGetResponse = {
        ...authStatus,
        accounts: accountList.accounts,
        activeAccountId: accountList.activeAccountId ?? authStatus.activeAccountId,
      };

      syncVaultState(mergedStatus.vault);
      setAccountAuthStatus(mergedStatus);

      const preferredAccountId = getPreferredAccountId(
        mergedStatus.accounts,
        mergedStatus.activeAccountId,
      );

      if (mergedStatus.status === 'ready' && preferredAccountId) {
        const quota = await sendExtensionRequest(
          'ACCOUNT_QUOTA_STATUS_GET',
          { provider, accountId: preferredAccountId },
          'options',
        );
        setAccountQuotaStatus(quota);
      } else {
        setAccountQuotaStatus(null);
      }

      return mergedStatus;
    },
    [syncVaultState],
  );

  const applyRuntimeSnapshot = useCallback(
    (snapshot: SettingsGetResponse, preserveDismissedOnboarding: boolean): void => {
      const normalizedSettings = normalizeSettings(snapshot.settings);
      const normalizedOnboarding = normalizeOnboardingState(snapshot.onboarding);
      const nextVault = snapshot.vault ?? createDefaultVaultState();

      setSelectedProvider(snapshot.activeProvider);
      setProviderConfigs(normalizeProviderConfigs(snapshot.providers));
      onboardingStateRef.current = normalizedOnboarding;
      setOnboardingState(normalizedOnboarding);
      setOnboardingStep(normalizedOnboarding.lastStep);
      setShowOnboarding((currentShow) =>
        normalizedOnboarding.completed ? false : preserveDismissedOnboarding ? currentShow : true,
      );
      setSettings(normalizedSettings);
      setCustomScriptsConfirmed(isCustomScriptingEnabled(normalizedSettings));
      setMode(normalizedSettings.theme, { persist: false });
      syncVaultState(nextVault);
      setIsReady(true);
    },
    [setMode, syncVaultState],
  );

  const reloadState = useCallback(
    async (preserveDismissedOnboarding = true): Promise<SettingsGetResponse> => {
      const snapshot = await sendExtensionRequest('SETTINGS_GET', undefined, 'options');
      applyRuntimeSnapshot(snapshot, preserveDismissedOnboarding);
      return snapshot;
    },
    [applyRuntimeSnapshot],
  );

  useEffect(() => {
    onboardingStateRef.current = onboardingState;
  }, [onboardingState]);

  useEffect(() => {
    const handlePageHide = () => {
      clearApiKeyInputValue();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        clearApiKeyInputValue();
      }
    };

    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearApiKeyInputValue();
    };
  }, [clearApiKeyInputValue]);

  useEffect(() => {
    let cancelled = false;

    async function loadState(): Promise<void> {
      const snapshot = await sendExtensionRequest('SETTINGS_GET', undefined, 'options');
      if (cancelled) {
        return;
      }

      applyRuntimeSnapshot(snapshot, false);
    }

    void loadState().catch((error) => {
      if (!cancelled) {
        setSaveState('error');
        setSaveMessage(getErrorMessage(error, 'Could not load stored provider settings.'));
        setIsReady(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [applyRuntimeSnapshot]);

  useEffect(() => {
    function handleStorageChange(
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ): void {
      if (areaName !== 'local' || !(STORAGE_KEYS.onboarding in changes)) {
        return;
      }

      const nextState = normalizeOnboardingState(changes[STORAGE_KEYS.onboarding]?.newValue);
      onboardingStateRef.current = nextState;
      setOnboardingState(nextState);
      setOnboardingStep(nextState.lastStep);
      if (suppressOnboardingAutoOpenRef.current) {
        suppressOnboardingAutoOpenRef.current = false;
        setShowOnboarding(false);
        return;
      }

      setShowOnboarding(!nextState.completed);
    }

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  useEffect(() => {
    if (!isReady || !usesProviderAccountSurface(selectedProvider, providerConfigs[selectedProvider])) {
      setAccountAuthStatus(null);
      setAccountQuotaStatus(null);
      return;
    }

    let cancelled = false;

    void loadAccountSurface(selectedProvider).catch((error) => {
      if (!cancelled) {
        setAccountMessageState('error');
        setAccountMessage(getErrorMessage(error, 'Failed to load imported account status.'));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isReady, loadAccountSurface, providerConfigs, selectedProvider]);

  async function persistOnboardingState(nextState: OnboardingState): Promise<void> {
    onboardingStateRef.current = nextState;
    await chrome.storage.local.set({
      [STORAGE_KEYS.onboarding]: nextState,
    });
    setOnboardingState(nextState);
  }

  function handleOnboardingStepChange(step: number): void {
    const nextStep = Math.max(0, step);
    setOnboardingStep(nextStep);

    const currentOnboarding = onboardingStateRef.current;

    if (currentOnboarding.completed) {
      return;
    }

    void persistOnboardingState({
      ...currentOnboarding,
      lastStep: nextStep,
    });
  }

  function handleOnboardingSkip(): void {
    setShowOnboarding(false);
  }

  function isProviderReadyForOnboarding(): boolean {
    const selectedDefinition = PROVIDER_LOOKUP[selectedProvider];
    const selectedConfig = providerConfigs[selectedProvider];
    const selectedAuthChoice = resolveProviderAuthChoice(selectedProvider, selectedConfig);

    if (selectedAuthChoice.authMethod === 'browser-login') {
      const browserLoginState = vaultState.browserLogins?.[selectedProvider];
      const activeAccountId = vaultState.activeAccounts[selectedProvider];
      const activeAccount = getProviderAccounts(vaultState, selectedProvider).find(
        (account) => account.accountId === activeAccountId,
      );

      return (
        onboardingState.configuredProvider === selectedProvider &&
        onboardingState.validatedProvider === selectedProvider &&
        browserLoginState?.status === 'success' &&
        Boolean(activeAccountId) &&
        Boolean(activeAccount?.validatedAt)
      );
    }

    if (providerRequiresConnectionValidation(selectedDefinition)) {
      return (
        onboardingState.configuredProvider === selectedProvider &&
        onboardingState.validatedProvider === selectedProvider
      );
    }

    if (selectedDefinition.supportsEndpoint) {
      const endpointPolicy = evaluateProviderEndpointPolicy(
        selectedProvider,
        selectedConfig.customEndpoint,
      );
      return (
        onboardingState.configuredProvider === selectedProvider &&
        endpointPolicy.valid
      );
    }

    return onboardingState.configuredProvider === selectedProvider;
  }

  async function handleOnboardingComplete(): Promise<void> {
    setIsCompletingOnboarding(true);

    try {
      if (!isProviderReadyForOnboarding()) {
        setOnboardingStep(1);
        setSaveState('error');
        setSaveMessage(
          'Complete the provider setup step before finishing onboarding. Save the provider and validate the connection first.',
        );
        return;
      }

      const nextState: OnboardingState = {
        ...onboardingState,
        completed: true,
        lastStep: 3,
        providerReady: true,
        completedAt: Date.now(),
        resumeRequestedAt: undefined,
      };

      await persistOnboardingState(nextState);
      setOnboardingStep(3);
      setShowOnboarding(false);
    } finally {
      setIsCompletingOnboarding(false);
    }
  }

  function handleOpenOnboarding(): void {
    if (onboardingState.completed) {
      const nextState = createDefaultOnboardingState();
      setOnboardingStep(0);
      setShowOnboarding(true);
      void persistOnboardingState(nextState);
      return;
    }

    setOnboardingStep(onboardingState.lastStep);
    setShowOnboarding(true);
    void persistOnboardingState({
      ...onboardingState,
      resumeRequestedAt: Date.now(),
    });
  }

  function updateProviderConfig(patch: Partial<ProviderConfig>): void {
    const currentOnboarding = onboardingStateRef.current;
    if (
      currentOnboarding.configuredProvider === selectedProvider ||
      currentOnboarding.validatedProvider === selectedProvider ||
      currentOnboarding.providerReady
    ) {
      const nextOnboarding: OnboardingState = {
        ...currentOnboarding,
        completed: false,
        completedAt: undefined,
        lastStep: 1,
        providerReady: false,
        configuredProvider:
          currentOnboarding.configuredProvider === selectedProvider
            ? undefined
            : currentOnboarding.configuredProvider,
        validatedProvider:
          currentOnboarding.validatedProvider === selectedProvider
            ? undefined
            : currentOnboarding.validatedProvider,
      };
      onboardingStateRef.current = nextOnboarding;
      setOnboardingState(nextOnboarding);
      if (!showOnboarding) {
        suppressOnboardingAutoOpenRef.current = true;
      }
      void chrome.storage.local.set({
        [STORAGE_KEYS.onboarding]: nextOnboarding,
      });
    }

    setProviderConfigs((current) => ({
      ...current,
      [selectedProvider]: {
        ...current[selectedProvider],
        ...patch,
      },
    }));
    setSaveState('idle');
    setSaveMessage('');
    setValidationState('idle');
    setValidationMessage('');
  }

  function handleProviderChange(event: React.ChangeEvent<HTMLSelectElement>): void {
    const nextProvider = event.target.value;
    if (!isProviderType(nextProvider)) {
      return;
    }

    setSelectedProvider(nextProvider);
    setSaveState('idle');
    setSaveMessage('');
    setPermissionSaveState('idle');
    setPermissionMessage('');
    setValidationState('idle');
    setValidationMessage('');
    setVaultNoticeState('idle');
    setVaultNotice('');
    setOauthState('idle');
    setOauthError('');
    setOauthUserCode('');
    setOauthVerifyUrl('');
    setAccountArtifactValue('');
    setAccountImportLabel('');
    setAccountActionKey(null);
    resetAccountMessage();
    clearApiKeyInputValue();
  }

  async function runVaultAction(action: 'init' | 'unlock' | 'lock'): Promise<void> {
    if (action !== 'lock' && !vaultPassphrase.trim()) {
      setVaultNoticeState('error');
      setVaultNotice('Enter a vault passphrase before continuing.');
      return;
    }

    setIsVaultBusy(true);
    setVaultNoticeState('idle');
    setVaultNotice('');

    try {
      const response =
        action === 'init'
          ? await sendExtensionRequest('VAULT_INIT', { passphrase: vaultPassphrase }, 'options')
          : action === 'unlock'
            ? await sendExtensionRequest('VAULT_UNLOCK', { passphrase: vaultPassphrase }, 'options')
            : await sendExtensionRequest('VAULT_LOCK', undefined, 'options');

      syncVaultState(response.vault);
      await reloadState(true);
      setVaultPassphrase('');
      setVaultNoticeState('success');
      setVaultNotice(
        action === 'init'
          ? 'Vault initialized and unlocked for this browser session.'
          : action === 'unlock'
            ? 'Vault unlocked for this browser session.'
            : 'Vault locked. Credentials are no longer available until you unlock again.',
      );
    } catch (error) {
      setVaultNoticeState('error');
      setVaultNotice(
        getErrorMessage(
          error,
          action === 'init'
            ? 'Failed to initialize the vault.'
            : action === 'unlock'
              ? 'Failed to unlock the vault.'
              : 'Failed to lock the vault.',
        ),
      );
    } finally {
      setIsVaultBusy(false);
    }
  }

  async function handleDeleteCredential(): Promise<void> {
    if (vaultState.lockState !== 'unlocked') {
      setVaultNoticeState('error');
      setVaultNotice('Unlock the vault before removing a credential.');
      return;
    }

    setIsVaultBusy(true);
    setVaultNoticeState('idle');
    setVaultNotice('');

    try {
      const response = await sendExtensionRequest(
        'API_KEY_DELETE',
        { provider: selectedProvider },
        'options',
      );
      syncVaultState(response.vault);
      await reloadState(true);
      setVaultNoticeState('success');
      setVaultNotice(
        `${PROVIDER_LOOKUP[selectedProvider].label} credential removed from the vault.`,
      );
    } catch (error) {
      setVaultNoticeState('error');
      setVaultNotice(getErrorMessage(error, 'Failed to remove the stored credential.'));
    } finally {
      setIsVaultBusy(false);
      clearApiKeyInputValue();
    }
  }

  async function handleGitHubOAuth(): Promise<void> {
    if (vaultState.lockState !== 'unlocked') {
      setOauthState('error');
      setOauthError('Unlock the vault before connecting GitHub Copilot.');
      return;
    }

    oauthAbortRef.current?.abort();
    const controller = new AbortController();
    oauthAbortRef.current = controller;

    setOauthState('requesting');
    setOauthError('');
    setOauthUserCode('');
    setOauthVerifyUrl('');

    try {
      const token = await runDeviceFlow({
        onUserCode: (userCode, verificationUri) => {
          setOauthUserCode(userCode);
          setOauthVerifyUrl(verificationUri);
          setOauthState('waiting');
        },
        signal: controller.signal,
      });

      const response = await sendExtensionRequest(
        'API_KEY_SET',
        {
          provider: 'copilot',
          apiKey: token,
          authKind: 'oauth-token',
          validate: true,
        },
        'options',
      );
      syncVaultState(response.vault);

      if (selectedProvider === 'copilot') {
        const currentOnboarding = onboardingStateRef.current;
        await persistOnboardingState({
          ...currentOnboarding,
          providerReady: true,
          validatedProvider: 'copilot',
        });
      }

      await reloadState(true);
      setOauthState('success');
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      setOauthState('error');
      setOauthError(getErrorMessage(error, 'OAuth flow failed'));
    } finally {
      oauthAbortRef.current = null;
    }
  }

  function ensureUnlockedVaultForAccounts(message: string): boolean {
    if (vaultState.lockState === 'unlocked') {
      return true;
    }

    setAccountMessageState('error');
    setAccountMessage(message);
    return false;
  }

  async function handleAccountImportConnect(): Promise<void> {
    const artifactValue = accountArtifactValue.trim();

    if (!artifactValue) {
      setAccountMessageState('error');
      setAccountMessage('Paste an official Codex auth artifact before importing.');
      return;
    }

    if (
      !ensureUnlockedVaultForAccounts(
        'Unlock the vault before importing an official auth artifact for Codex.',
      )
    ) {
      return;
    }

    setAccountActionKey('connect');
    resetAccountMessage();

    try {
      const response = await sendExtensionRequest(
        'ACCOUNT_AUTH_CONNECT_START',
        {
          provider: selectedProvider,
          transport: 'artifact-import',
          artifact: {
            format: inferArtifactFormat(artifactValue),
            value: artifactValue,
          },
          label: accountImportLabel.trim() || undefined,
        },
        'options',
      );

      setAccountArtifactValue('');
      setAccountImportLabel('');
      await loadAccountSurface(selectedProvider);
      setAccountMessageState('success');
      setAccountMessage(
        `${response.message} The artifact body was cleared from the form immediately after import.`,
      );
    } catch (error) {
      setAccountMessageState('error');
      setAccountMessage(getErrorMessage(error, 'Failed to import the official auth artifact.'));
    } finally {
      setAccountActionKey(null);
    }
  }

  async function handleOpenAIBrowserConnect(): Promise<void> {
    if (
      !ensureUnlockedVaultForAccounts(
        'Unlock the vault before starting OpenAI browser-account status checks.',
      )
    ) {
      return;
    }

    setAccountActionKey('connect');
    resetAccountMessage();

    try {
      const response = await sendExtensionRequest(
        'ACCOUNT_AUTH_CONNECT_START',
        {
          provider: 'openai',
          transport: 'browser-helper',
          browserLogin: { uiContext: showOnboarding ? 'onboarding' : 'options' },
        },
        'options',
      );

      await loadAccountSurface('openai');
      setAccountMessageState(response.accepted ? 'success' : 'error');
      setAccountMessage(response.message);
    } catch (error) {
      setAccountMessageState('error');
      setAccountMessage(getErrorMessage(error, 'Failed to start the OpenAI browser-account flow.'));
    } finally {
      setAccountActionKey(null);
    }
  }

  async function handleAccountValidate(accountId: string): Promise<void> {
    if (
      !ensureUnlockedVaultForAccounts(
        'Unlock the vault before validating an imported Codex account.',
      )
    ) {
      return;
    }

    setAccountActionKey(`validate:${accountId}`);
    resetAccountMessage();

    try {
      const accountSnapshot = await sendExtensionRequest(
        'ACCOUNT_GET',
        { provider: selectedProvider, accountId },
        'options',
      );

      if (!accountSnapshot.account) {
        setAccountMessageState('error');
        setAccountMessage('That imported account is no longer available. Refresh the list and try again.');
        return;
      }

      const response = await sendExtensionRequest(
        'ACCOUNT_AUTH_VALIDATE',
        { provider: selectedProvider, accountId },
        'options',
      );

      syncVaultState(response.vault);
      await loadAccountSurface(selectedProvider);
      setAccountMessageState(response.valid ? 'success' : 'error');
      setAccountMessage(
        response.valid
          ? (response.message ?? `Validated ${accountSnapshot.account.label}.`)
          : `${accountSnapshot.account.label} could not be validated.`,
      );
    } catch (error) {
      setAccountMessageState('error');
      setAccountMessage(getErrorMessage(error, 'Failed to validate the imported account.'));
    } finally {
      setAccountActionKey(null);
    }
  }

  async function handleAccountActivate(accountId: string): Promise<void> {
    if (
      !ensureUnlockedVaultForAccounts('Unlock the vault before activating an imported Codex account.')
    ) {
      return;
    }

    setAccountActionKey(`activate:${accountId}`);
    resetAccountMessage();

    try {
      const response = await sendExtensionRequest(
        'ACCOUNT_ACTIVATE',
        { provider: selectedProvider, accountId },
        'options',
      );
      await loadAccountSurface(selectedProvider);
      setAccountMessageState('success');
      setAccountMessage(`Active Codex account switched to ${response.accountId}.`);
    } catch (error) {
      setAccountMessageState('error');
      setAccountMessage(getErrorMessage(error, 'Failed to activate the selected account.'));
    } finally {
      setAccountActionKey(null);
    }
  }

  async function handleAccountRevoke(accountId: string): Promise<void> {
    if (
      !ensureUnlockedVaultForAccounts('Unlock the vault before revoking an imported Codex account.')
    ) {
      return;
    }

    setAccountActionKey(`revoke:${accountId}`);
    resetAccountMessage();

    try {
      const response = await sendExtensionRequest(
        'ACCOUNT_REVOKE',
        { provider: selectedProvider, accountId, revokeCredential: true },
        'options',
      );
      await loadAccountSurface(selectedProvider);
      setAccountMessageState(response.revoked ? 'success' : 'error');
      setAccountMessage(
        response.revoked
          ? 'Imported account revoked. Keep it for audit or remove it entirely below.'
          : 'The imported account could not be revoked.',
      );
    } catch (error) {
      setAccountMessageState('error');
      setAccountMessage(getErrorMessage(error, 'Failed to revoke the imported account.'));
    } finally {
      setAccountActionKey(null);
    }
  }

  async function handleAccountRemove(accountId: string): Promise<void> {
    if (
      !ensureUnlockedVaultForAccounts('Unlock the vault before removing an imported Codex account.')
    ) {
      return;
    }

    setAccountActionKey(`remove:${accountId}`);
    resetAccountMessage();

    try {
      const response = await sendExtensionRequest(
        'ACCOUNT_REMOVE',
        { provider: selectedProvider, accountId },
        'options',
      );
      await loadAccountSurface(selectedProvider);
      setAccountMessageState(response.removed ? 'success' : 'error');
      setAccountMessage(
        response.removed
          ? 'Imported account removed from the local vault-backed store.'
          : 'That imported account was already missing.',
      );
    } catch (error) {
      setAccountMessageState('error');
      setAccountMessage(getErrorMessage(error, 'Failed to remove the imported account.'));
    } finally {
      setAccountActionKey(null);
    }
  }

  async function handleAccountQuotaRefresh(accountId: string): Promise<void> {
    if (
      !ensureUnlockedVaultForAccounts('Unlock the vault before refreshing Codex account quota.')
    ) {
      return;
    }

    setAccountActionKey(`quota:${accountId}`);
    resetAccountMessage();

    try {
      const response = await sendExtensionRequest(
        'ACCOUNT_QUOTA_REFRESH',
        { provider: selectedProvider, accountId },
        'options',
      );
      setAccountQuotaStatus({
        provider: response.provider,
        accountId: response.accountId,
        quota: response.quota,
      });
      await loadAccountSurface(selectedProvider);
      setAccountMessageState('success');
      setAccountMessage(
        response.quota
          ? `Quota refreshed. ${formatQuotaSummary(response.quota)}`
          : 'Quota refresh completed, but no quota snapshot is available yet.',
      );
    } catch (error) {
      setAccountMessageState('error');
      setAccountMessage(getErrorMessage(error, 'Failed to refresh account quota.'));
    } finally {
      setAccountActionKey(null);
    }
  }

  async function handleSave(): Promise<void> {
    const selectedDefinition = PROVIDER_LOOKUP[selectedProvider];
    const selectedConfig = providerConfigs[selectedProvider];
    const selectedAuthChoice = resolveProviderAuthChoice(selectedProvider, selectedConfig);
    const usesApiKeyLane = selectedAuthChoice.authMethod === 'api-key';
    const usesBrowserAccountLane = selectedAuthChoice.authMethod === 'browser-login';
    const usesAccountImportLane = selectedAuthChoice.authMethod === 'account-import';
    const usesOAuthLane = selectedAuthChoice.authMethod === 'oauth-github';
    const rawApiKey = apiKeyInputRef.current?.value.trim() ?? '';

    setIsSaving(true);
    setSaveState('idle');
    setSaveMessage('');
    setValidationState('idle');
    setValidationMessage('');

    try {
      let nextConfig = selectedConfig;
      if (selectedDefinition.supportsEndpoint) {
        const endpointPolicy = evaluateProviderEndpointPolicy(
          selectedProvider,
          selectedConfig.customEndpoint,
        );
        if (!endpointPolicy.valid) {
          setSaveState('error');
          setSaveMessage(`Save blocked: ${endpointPolicy.errorMessage}`);
          return;
        }

        nextConfig = normalizeProviderEndpointConfig(selectedProvider, selectedConfig);
        if (nextConfig.customEndpoint !== selectedConfig.customEndpoint) {
          setProviderConfigs((current) => ({
            ...current,
            [selectedProvider]: nextConfig,
          }));
        }
      }

      if (usesApiKeyLane && rawApiKey && vaultState.lockState !== 'unlocked') {
        setSaveState('error');
        setSaveMessage('Unlock the vault before saving a new provider credential.');
        return;
      }

      await sendExtensionRequest(
        'PROVIDER_SET',
        {
          provider: selectedProvider,
          config: nextConfig,
          makeDefault: true,
        },
        'options',
      );

      if (usesApiKeyLane && rawApiKey) {
        const credentialResponse = await sendExtensionRequest(
          'API_KEY_SET',
          {
            provider: selectedProvider,
            apiKey: rawApiKey,
            authKind: 'api-key',
            maskedValue: GENERIC_MASK,
          },
          'options',
        );
        syncVaultState(credentialResponse.vault);
      }

      const snapshot = await reloadState(true);
      const savedRecord = snapshot.vault.credentials[selectedProvider];
      const importedAccounts = getProviderAccounts(snapshot.vault, selectedProvider);
      const activeImportedAccount = getActiveProviderAccount(snapshot.vault, selectedProvider);
      setSaveState('success');
      setSaveMessage(
        selectedProvider === 'cliproxyapi' && rawApiKey
          ? 'CLIProxyAPI endpoint saved and the API key was stored in the vault. Run Test connection to mark this provider ready.'
          : selectedProvider === 'cliproxyapi' && !savedRecord
            ? 'CLIProxyAPI endpoint saved. Add a vault-backed API key, then run Test connection before using popup or sidepanel workflows.'
            : usesApiKeyLane && rawApiKey
              ? 'Provider settings saved and the credential was stored in the vault.'
              : usesApiKeyLane && !savedRecord
                ? 'Provider settings saved. Add a vault credential before using this provider.'
              : usesOAuthLane && !savedRecord
                ? 'Provider settings saved. Connect GitHub Copilot in the vault before using this provider.'
                : usesBrowserAccountLane && importedAccounts.length === 0
                  ? 'OpenAI browser login method saved. Use Connect browser account to ask the background for trusted status. If the helper is unavailable, Flux will show helper-missing instead of faking a login.'
                  : usesBrowserAccountLane && activeImportedAccount
                    ? `OpenAI browser login method saved. ${activeImportedAccount.label} is available for validation through the trusted background lane.`
                    : usesBrowserAccountLane
                      ? 'OpenAI browser login method saved. Validate the active trusted browser-account state before relying on it.'
                : usesAccountImportLane && importedAccounts.length === 0
                  ? 'Provider settings saved. No imported account is available yet. Use the account import flow before testing or using this provider.'
                  : usesAccountImportLane && activeImportedAccount
                    ? `Provider settings saved. ${activeImportedAccount.label} is ready for account-backed validation.`
                    : usesAccountImportLane
                      ? 'Provider settings saved. Validate an imported account before using this provider.'
                      : 'Provider settings saved.',
      );
    } catch (error) {
      setSaveState('error');
      setSaveMessage(getErrorMessage(error, 'Failed to save provider settings.'));
    } finally {
      clearApiKeyInputValue();
      setIsSaving(false);
    }
  }

  function pickPermissionSettings(
    source: ExtensionSettings,
  ): Pick<ExtensionSettings, PermissionSettingKey> {
    return {
      includeScreenshotsInContext: source.includeScreenshotsInContext,
      screenshotOnError: source.screenshotOnError,
      allowCustomScripts: source.allowCustomScripts,
      showFloatingBar: source.showFloatingBar,
      highlightElements: source.highlightElements,
      soundNotifications: source.soundNotifications,
    };
  }

  function handleAdvancedModeToggle(checked: boolean): void {
    setSettings((current) => ({
      ...current,
      debugMode: checked,
      allowCustomScripts: checked ? current.allowCustomScripts : false,
    }));

    if (!checked) {
      setCustomScriptsConfirmed(false);
      setPermissionMessage('Advanced mode is off. High-risk scripting controls stay disabled.');
    } else {
      setPermissionMessage(
        'Advanced mode enabled. You can now review high-risk scripting controls.',
      );
    }

    setPermissionSaveState('idle');
  }

  function handlePermissionToggle(key: PermissionSettingKey, checked: boolean): void {
    if (key === 'allowCustomScripts' && checked && !settings.debugMode) {
      setPermissionSaveState('error');
      setPermissionMessage('Enable Advanced mode before allowing custom scripts.');
      return;
    }

    setSettings((current) => ({
      ...current,
      [key]: checked,
    }));

    if (key === 'allowCustomScripts') {
      setCustomScriptsConfirmed(!checked);
    }

    setPermissionSaveState('idle');
    setPermissionMessage('');
  }

  function handlePermissionCardClick(
    event: MouseEvent<HTMLDivElement>,
    key: PermissionSettingKey,
  ): void {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('[role="switch"]')) {
      return;
    }

    handlePermissionToggle(key, !settings[key]);
  }

  function handleThemeChange(theme: ExtensionSettings['theme']): void {
    setSettings((current) => ({
      ...current,
      theme,
    }));
    setMode(theme, { persist: false });
    setAppearanceSaveState('idle');
    setAppearanceMessage('');
  }

  function handleLanguageChange(event: React.ChangeEvent<HTMLSelectElement>): void {
    const nextLanguage = event.target.value;
    if (nextLanguage !== 'en' && nextLanguage !== 'vi' && nextLanguage !== 'auto') {
      return;
    }

    setSettings((current) => ({
      ...current,
      language: nextLanguage,
    }));
    setAppearanceSaveState('idle');
    setAppearanceMessage('');
  }

  async function handleSavePermissions(): Promise<void> {
    setIsSavingPermissions(true);
    setPermissionSaveState('idle');
    setPermissionMessage('');

    try {
      if (settings.allowCustomScripts && !settings.debugMode) {
        setPermissionSaveState('error');
        setPermissionMessage('Enable Advanced mode before saving custom scripting permissions.');
        return;
      }

      if (settings.allowCustomScripts && !customScriptsConfirmed) {
        setPermissionSaveState('error');
        setPermissionMessage(
          'Acknowledge the custom script warning before saving this permission profile.',
        );
        return;
      }

      const permissionSettings = {
        ...pickPermissionSettings(settings),
        allowCustomScripts: isCustomScriptingEnabled(settings),
        debugMode: isAdvancedModeEnabled(settings),
      };
      await sendExtensionRequest('SETTINGS_UPDATE', { settings: permissionSettings }, 'options');

      setMode(settings.theme);
      try {
        localStorage.setItem('flux-agent-theme', settings.theme);
      } catch {
        // Ignore storage errors in restricted contexts.
      }
      await reloadState(true);
      setPermissionSaveState('success');
      setPermissionMessage(
        'Permission toggles saved. Flux will use these capability boundaries on the next run.',
      );
    } catch (error) {
      setPermissionSaveState('error');
      setPermissionMessage(getErrorMessage(error, 'Failed to save permission toggles.'));
    } finally {
      setIsSavingPermissions(false);
    }
  }

  async function handleSaveAppearance(): Promise<void> {
    setIsSavingAppearance(true);
    setAppearanceSaveState('idle');
    setAppearanceMessage('');

    try {
      await sendExtensionRequest(
        'SETTINGS_UPDATE',
        {
          settings: {
            theme: settings.theme,
            language: settings.language,
          },
        },
        'options',
      );

      setMode(settings.theme);
      try {
        localStorage.setItem('flux-agent-theme', settings.theme);
      } catch {
        // Ignore storage errors in restricted contexts.
      }
      await reloadState(true);
      setAppearanceSaveState('success');
      setAppearanceMessage(
        'Appearance settings saved. Theme and language will stay consistent across Flux surfaces.',
      );
    } catch (error) {
      setAppearanceSaveState('error');
      setAppearanceMessage(getErrorMessage(error, 'Failed to save appearance settings.'));
    } finally {
      setIsSavingAppearance(false);
    }
  }

  async function handleTestConnection(): Promise<void> {
    const selectedDefinition = PROVIDER_LOOKUP[selectedProvider];
    const selectedConfig = providerConfigs[selectedProvider];
    const selectedAuthChoice = resolveProviderAuthChoice(selectedProvider, selectedConfig);
    const usesApiKeyLane = selectedAuthChoice.authMethod === 'api-key';
    const usesBrowserAccountLane = selectedAuthChoice.authMethod === 'browser-login';
    const usesAccountBackedLane = selectedAuthChoice.authFamily === 'account-backed';
    const rawApiKey = apiKeyInputRef.current?.value.trim() ?? '';
    const savedMetadata = apiKeyMetadata[selectedProvider];

    if (usesAccountBackedLane) {
      setIsTesting(true);
      setValidationState('idle');
      setValidationMessage('');

      try {
        const authStatus = await sendExtensionRequest(
          'ACCOUNT_AUTH_STATUS_GET',
          { provider: selectedProvider },
          'options',
        );

        syncVaultState(authStatus.vault);

        if (authStatus.status === 'vault-locked') {
          setValidationState('error');
          setValidationMessage(
            usesBrowserAccountLane
              ? 'Unlock the vault before validating OpenAI browser-account state.'
              : 'Unlock the vault before validating an imported account-backed provider.',
          );
          return;
        }

        const targetAccount =
          authStatus.accounts.find((account) => account.accountId === authStatus.activeAccountId) ??
          authStatus.accounts[0];

        if (!targetAccount) {
          setValidationState('error');
          setValidationMessage(
            usesBrowserAccountLane
              ? getOpenAIBrowserLoginHelperText(authStatus, undefined, false)
              : 'No imported account is available yet. Import an official auth artifact before testing this provider.',
          );
          return;
        }

        const response = await sendExtensionRequest(
          'ACCOUNT_AUTH_VALIDATE',
          {
            provider: selectedProvider,
            accountId: targetAccount.accountId,
          },
          'options',
        );

        syncVaultState(response.vault);
        setValidationState(response.valid ? 'success' : 'error');
        setValidationMessage(
          response.valid
            ? (response.message ??
                `${selectedDefinition.label} account ${targetAccount.label} validated successfully.`)
            : usesBrowserAccountLane
              ? `${selectedDefinition.label} browser-account state is not ready yet.`
              : `${selectedDefinition.label} could not validate the imported account.`,
        );

        if (response.valid) {
          const currentOnboarding = onboardingStateRef.current;
          await persistOnboardingState({
            ...currentOnboarding,
            providerReady: true,
            validatedProvider: selectedProvider,
          });
        }
      } catch (error) {
        setValidationState('error');
        setValidationMessage(getErrorMessage(error, 'Connection test failed unexpectedly.'));
      } finally {
        setIsTesting(false);
        clearApiKeyInputValue();
      }

      return;
    }

    if (usesApiKeyLane && !rawApiKey && !savedMetadata) {
      setValidationState('error');
      setValidationMessage(
        'Enter an API key or unlock a stored vault credential before testing this provider.',
      );
      clearApiKeyInputValue();
      return;
    }

    if (selectedAuthChoice.authMethod === 'oauth-github' && !savedMetadata) {
      setValidationState('error');
      setValidationMessage('Connect GitHub Copilot before testing this provider.');
      clearApiKeyInputValue();
      return;
    }

    if (
      (usesApiKeyLane || selectedAuthChoice.authMethod === 'oauth-github') &&
      !rawApiKey &&
      vaultState.lockState !== 'unlocked'
    ) {
      setValidationState('error');
      setValidationMessage(
        'Unlock the vault or enter a fresh credential before testing this provider.',
      );
      clearApiKeyInputValue();
      return;
    }

    try {
      let nextConfig = selectedConfig;
      if (selectedDefinition.supportsEndpoint) {
        const endpointPolicy = evaluateProviderEndpointPolicy(
          selectedProvider,
          selectedConfig.customEndpoint,
        );
        if (!endpointPolicy.valid) {
          setValidationState('error');
          setValidationMessage(endpointPolicy.errorMessage ?? 'Connection test failed unexpectedly.');
          return;
        }

        nextConfig = normalizeProviderEndpointConfig(selectedProvider, selectedConfig);
        if (nextConfig.customEndpoint !== selectedConfig.customEndpoint) {
          setProviderConfigs((current) => ({
            ...current,
            [selectedProvider]: nextConfig,
          }));
        }
      }

      setIsTesting(true);
      setValidationState('idle');
      setValidationMessage('');

      const response = await sendExtensionRequest(
        'API_KEY_VALIDATE',
        {
            provider: selectedProvider,
            apiKey: rawApiKey || undefined,
            authKind: selectedAuthChoice.authMethod === 'oauth-github'
              ? 'oauth-token'
              : usesApiKeyLane
                ? 'api-key'
                : undefined,
           config: nextConfig,
         },
         'options',
       );

      syncVaultState(response.vault);
      setValidationState(response.valid ? 'success' : 'error');
      setValidationMessage(
        response.valid
          ? `${selectedDefinition.label} responded successfully.`
          : `${selectedDefinition.label} could not be validated with the current settings.`,
      );

      if (response.valid) {
        const currentOnboarding = onboardingStateRef.current;
        await persistOnboardingState({
          ...currentOnboarding,
          providerReady: true,
          validatedProvider: selectedProvider,
        });
      }
    } catch (error) {
      setValidationState('error');
      setValidationMessage(getErrorMessage(error, 'Connection test failed unexpectedly.'));
    } finally {
      setIsTesting(false);
      clearApiKeyInputValue();
    }
  }

  const selectedDefinition = PROVIDER_LOOKUP[selectedProvider];
  const selectedConfig = providerConfigs[selectedProvider];
  const selectedAuthChoice = resolveProviderAuthChoice(selectedProvider, selectedConfig);
  const selectedUsesApiKeyLane = selectedAuthChoice.authMethod === 'api-key';
  const selectedUsesOAuthLane = selectedAuthChoice.authMethod === 'oauth-github';
  const selectedUsesAccountImportLane = selectedAuthChoice.authMethod === 'account-import';
  const selectedUsesBrowserAccountLane = selectedAuthChoice.authMethod === 'browser-login';
  const selectedUsesAccountSurface = selectedAuthChoice.authFamily === 'account-backed';
  const providerAccounts = getProviderAccounts(vaultState, selectedProvider);
  const activeProviderAccount = getActiveProviderAccount(vaultState, selectedProvider);
  const selectedCredentialRecord = vaultState.credentials[selectedProvider];
  const surfacedProviderAccounts = accountAuthStatus?.accounts ?? providerAccounts;
  const surfacedActiveAccountId =
    accountAuthStatus?.activeAccountId ??
    getPreferredAccountId(providerAccounts, vaultState.activeAccounts[selectedProvider]);
  const surfacedActiveProviderAccount =
    surfacedProviderAccounts.find((account) => account.accountId === surfacedActiveAccountId) ??
    activeProviderAccount;
  const activeProviderSessionStatus = getAccountSessionStatus(surfacedActiveProviderAccount);
  const activeProviderQuota =
    accountQuotaStatus?.accountId && accountQuotaStatus.accountId === surfacedActiveProviderAccount?.accountId
      ? accountQuotaStatus.quota
      : surfacedActiveProviderAccount?.metadata?.quota;
  const advancedModeEnabled = isAdvancedModeEnabled(settings);
  const customScriptingEnabled = isCustomScriptingEnabled(settings);
  const visiblePermissionDefinitions = advancedModeEnabled
    ? PERMISSION_DEFINITIONS
    : PERMISSION_DEFINITIONS.filter((permission) => permission.key !== 'allowCustomScripts');
  const savedMetadata = apiKeyMetadata[selectedProvider];
  const shouldShowOnboarding = isReady && showOnboarding;
  const vaultStatusLabel =
    vaultState.lockState === 'uninitialized'
      ? 'Not initialized'
      : vaultState.lockState === 'locked'
        ? 'Locked'
        : 'Unlocked';
  const vaultStatusDescription =
    vaultState.lockState === 'uninitialized'
      ? 'Create a passphrase to encrypt provider credentials locally.'
      : vaultState.lockState === 'locked'
        ? 'Unlock once per browser session before saving, validating, or using credentials.'
        : 'Credentials are available for this browser session only.';
  const openAIBrowserHelperMessage = getOpenAIBrowserLoginHelperText(
    accountAuthStatus,
    surfacedActiveProviderAccount,
    vaultState.lockState !== 'unlocked',
  );
  const credentialStatusLabel = selectedUsesBrowserAccountLane
    ? vaultState.lockState === 'uninitialized'
      ? 'Vault not initialized'
      : vaultState.lockState === 'locked'
        ? surfacedActiveProviderAccount || accountAuthStatus?.browserLogin
          ? 'Vault locked'
          : 'Browser account missing'
        : surfacedActiveProviderAccount?.status === 'revoked' ||
            activeProviderSessionStatus === 'revoked'
          ? 'Account revoked'
          : activeProviderSessionStatus === 'refresh-required'
            ? 'Refresh required'
            : activeProviderSessionStatus === 'expired'
              ? 'Session expired'
              : surfacedActiveProviderAccount?.status === 'needs-auth'
                ? 'Needs auth'
                : surfacedActiveProviderAccount?.stale
                  ? 'Account stale'
                  : surfacedActiveProviderAccount?.validatedAt
                    ? 'Account validated'
                    : accountAuthStatus?.browserLogin
                      ? getBrowserLoginStatusLabel(accountAuthStatus.browserLogin)
                      : 'Browser account missing'
    : !selectedDefinition.requiresCredential
    ? 'Not required'
    : selectedUsesAccountImportLane
      ? vaultState.lockState === 'uninitialized'
        ? 'Vault not initialized'
        : vaultState.lockState === 'locked'
          ? surfacedProviderAccounts.length > 0
            ? 'Vault locked'
            : 'Account missing'
          : !surfacedActiveProviderAccount
            ? surfacedProviderAccounts.length > 0
              ? 'Account available'
              : 'Account missing'
            : surfacedActiveProviderAccount.status === 'revoked' ||
                activeProviderSessionStatus === 'revoked'
              ? 'Account revoked'
              : activeProviderSessionStatus === 'refresh-required'
                ? 'Refresh required'
                : activeProviderSessionStatus === 'expired'
                  ? 'Session expired'
                  : surfacedActiveProviderAccount.status === 'needs-auth'
                    ? 'Needs auth'
                    : surfacedActiveProviderAccount.stale
                ? 'Account stale'
                : surfacedActiveProviderAccount.validatedAt
                  ? 'Account validated'
                  : surfacedActiveProviderAccount.status === 'active'
                    ? 'Account imported'
                    : 'Account available'
      : vaultState.lockState === 'uninitialized'
        ? 'Vault not initialized'
        : vaultState.lockState === 'locked'
          ? savedMetadata
            ? 'Vault locked'
            : selectedUsesOAuthLane
              ? 'OAuth required'
              : 'Credential missing'
          : !savedMetadata
            ? selectedUsesOAuthLane
              ? 'OAuth required'
              : 'Credential missing'
            : selectedCredentialRecord?.stale
              ? 'Credential stale'
              : selectedCredentialRecord?.validatedAt
                ? selectedUsesOAuthLane
                  ? 'OAuth connected'
                  : 'Validated'
                : selectedUsesOAuthLane
                  ? 'OAuth connected'
                  : 'Credential saved';
  const credentialHelperMessage = selectedUsesBrowserAccountLane
    ? openAIBrowserHelperMessage
    : selectedUsesAccountImportLane
    ? surfacedProviderAccounts.length === 0
      ? 'No imported account is available yet. Use the account import flow before testing or using this provider.'
      : surfacedActiveProviderAccount?.status === 'revoked' ||
          activeProviderSessionStatus === 'revoked'
        ? 'The active imported account was revoked. Re-import or activate another account before using this provider.'
        : activeProviderSessionStatus === 'refresh-required'
          ? 'The active imported account needs a fresh official auth artifact before runtime sessions can continue.'
          : activeProviderSessionStatus === 'expired'
            ? 'The active imported account looks expired. Re-import a fresh official auth artifact, then validate again.'
            : surfacedActiveProviderAccount?.status === 'needs-auth'
              ? 'The active imported account still needs an official auth artifact refresh before Codex can rely on it.'
              : surfacedActiveProviderAccount?.stale
          ? 'The imported account changed after the last validation. Re-test before relying on this provider.'
          : vaultState.lockState === 'locked'
            ? 'Unlock the vault to validate or inspect the imported account state.'
            : surfacedActiveProviderAccount?.validatedAt
              ? `Imported account ${surfacedActiveProviderAccount.label} validated against the current runtime.`
              : surfacedActiveProviderAccount
                ? `Imported account ${surfacedActiveProviderAccount.label} is stored. Run a connection test to confirm the current account session.`
                : 'Select and validate an imported account before using this provider.'
    : !savedMetadata
      ? selectedUsesOAuthLane
        ? 'Connect GitHub Copilot and store the token in the vault before running this provider.'
        : selectedProvider === 'cliproxyapi'
          ? 'CLIProxyAPI needs both a saved endpoint and a vault-backed API key. Save first, then run Test connection before relying on it.'
          : selectedDefinition.requiresCredential
            ? 'Save a vault-backed credential or enter a fresh one when testing.'
            : 'No credential is required for this provider.'
      : selectedCredentialRecord?.stale
        ? selectedProvider === 'cliproxyapi'
          ? 'The CLIProxyAPI endpoint or API key changed after the last validation. Re-test before relying on this provider.'
          : 'The provider configuration changed after the last validation. Re-test before relying on this credential.'
        : vaultState.lockState === 'locked'
          ? selectedProvider === 'cliproxyapi'
            ? 'Unlock the vault to validate, rotate, or remove the saved CLIProxyAPI API key.'
            : 'Unlock the vault to validate, rotate, or remove this credential.'
          : selectedCredentialRecord?.validatedAt
              ? selectedProvider === 'cliproxyapi'
                ? 'CLIProxyAPI endpoint and API key validated against the current provider settings.'
                : 'Credential validated against the current provider settings.'
              : selectedProvider === 'cliproxyapi'
                ? 'CLIProxyAPI settings are saved in the vault. Run Test connection to confirm the endpoint and API key together.'
                : 'Credential is stored in the vault. Run a connection test to validate it.';
  const onboardingProviderStatusLabel = selectedUsesBrowserAccountLane
    ? credentialStatusLabel
    : selectedUsesAccountImportLane
    ? credentialStatusLabel
    : selectedUsesOAuthLane
      ? savedMetadata
        ? 'OAuth connected'
        : 'Connect GitHub'
      : selectedDefinition.requiresCredential
        ? credentialStatusLabel
        : 'Ready';
  const onboardingProviderSetupHint = selectedUsesBrowserAccountLane
    ? surfacedActiveProviderAccount
      ? `${credentialHelperMessage} The browser-account lane stays background-owned and never exposes raw helper payloads or account artifacts in Options.`
      : 'OpenAI browser-account reuses the live provider setup controls. Save the login method, unlock the vault, use Connect browser account, then run Test connection once trusted artifacts exist. If the helper is unavailable, Flux will show helper-missing instead of pretending success.'
    : selectedUsesAccountImportLane
    ? surfacedProviderAccounts.length === 0
      ? 'Codex stays locked until an official auth artifact is imported into the vault and validated against the runtime.'
      : `${credentialHelperMessage} Popup quick actions and sidepanel sends stay locked until the active Codex account is validated and healthy.`
    : selectedUsesOAuthLane
      ? savedMetadata
        ? 'The Copilot token is already in the vault. Run connection validation before you finish onboarding.'
        : 'Connect GitHub Copilot, keep the token in the unlocked vault, then validate the provider connection.'
      : selectedProvider === 'cliproxyapi'
        ? 'CLIProxyAPI requires an explicit endpoint. Save the endpoint first, keep the API key in the vault, then run Test connection before popup quick actions or sidepanel chat unlock.'
      : selectedDefinition.requiresCredential
        ? 'Save the provider settings first, then validate the current credential before finishing onboarding.'
        : 'Save the provider settings so the active model and endpoint are carried into the workspace.';
  const onboardingProviderReadyHint = selectedUsesBrowserAccountLane
    ? isProviderReadyForOnboarding()
      ? `OpenAI browser-account is ready because ${surfacedActiveProviderAccount?.label ?? 'the active trusted account'} is validated and the helper state is background-approved.`
      : `OpenAI browser-account is not ready yet. Current state: ${credentialStatusLabel.toLowerCase()}. ${credentialHelperMessage}`
    : selectedUsesAccountImportLane
    ? isProviderReadyForOnboarding()
      ? `Codex is ready because ${surfacedActiveProviderAccount?.label ?? 'the active imported account'} is validated and the runtime does not currently require a refresh.`
      : `Codex is not ready yet. Current state: ${credentialStatusLabel.toLowerCase()}. ${credentialHelperMessage}`
    : selectedUsesOAuthLane
      ? isProviderReadyForOnboarding()
        ? 'Copilot is connected and validated, so the side panel and popup can reuse it immediately.'
        : 'Copilot still needs a connected vault token plus a successful validation before onboarding can finish.'
      : selectedProvider === 'cliproxyapi'
        ? isProviderReadyForOnboarding()
          ? 'CLIProxyAPI is ready because the endpoint is saved, the API key is in the vault, and the latest connection test passed.'
          : `CLIProxyAPI is not ready yet. Current state: ${credentialStatusLabel.toLowerCase()}. Save endpoint -> save key -> Test connection -> ready.`
      : selectedDefinition.requiresCredential
        ? isProviderReadyForOnboarding()
          ? 'This provider passed validation, so Flux can carry the saved credential into live workflows.'
          : 'This provider still needs a saved credential and a passing connection test before onboarding can finish.'
        : 'No credential gate remains for this provider.';
  const vaultTone =
    vaultNoticeState === 'success'
      ? 'border-success-500/30 bg-success-50 text-success-700'
      : vaultNoticeState === 'error'
        ? 'border-error-500/30 bg-error-50 text-error-700'
        : 'border-border bg-surface-elevated text-content-secondary';

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

  const enabledPermissionCount = PERMISSION_DEFINITIONS.filter(
    (permission) => settings[permission.key],
  ).length;

  const appearanceTone =
    appearanceSaveState === 'success'
      ? 'border-success-500/30 bg-success-50 text-success-700'
      : appearanceSaveState === 'error'
        ? 'border-error-500/30 bg-error-50 text-error-700'
        : 'border-border bg-surface-primary text-content-secondary';

  const accountTone =
    accountMessageState === 'success'
      ? 'border-success-500/30 bg-success-50 text-success-700'
      : accountMessageState === 'error'
        ? 'border-error-500/30 bg-error-50 text-error-700'
        : 'border-border bg-surface-primary text-content-secondary';

  const providerStatusSummary =
    validationMessage ||
    saveMessage ||
    (selectedUsesBrowserAccountLane
      ? 'OpenAI browser-account readiness comes from the background runtime. Connect browser account surfaces trusted helper status, and Test connection validates only stored trusted artifacts.'
      :
    (selectedProvider === 'cliproxyapi'
      ? 'CLIProxyAPI requires an endpoint. Save the endpoint and API key first, then run Test connection to mark it ready.'
      : 'Save changes, then test the selected provider configuration.'));

  const providerSetupPanel = (
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

        <div
          className={`rounded-2xl border bg-gradient-to-br ${selectedDefinition.accent} border-border px-4 py-4`}
        >
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
          {selectedProvider === 'openai' ? (
            <Select
              id="openai-login-method"
              label="Login method"
              value={normalizeOpenAIAuthChoiceId(selectedConfig.authChoiceId)}
              onChange={(event) =>
                updateProviderConfig({ authChoiceId: normalizeOpenAIAuthChoiceId(event.target.value) })
              }
              options={getProviderAuthChoices('openai').map((choice) => ({
                value: choice.id,
                label: choice.label,
              }))}
              helperText="OpenAI exposes exactly 2 login methods here. Readiness still comes from the background runtime, not from this form."
            />
          ) : null}

          <Input
            label="Model"
            value={selectedConfig.model}
            onChange={(event) => updateProviderConfig({ model: event.target.value })}
            placeholder={selectedDefinition.defaultModel}
            helperText="Use the exact model id your provider expects."
          />

          {selectedDefinition.supportsEndpoint && !selectedUsesBrowserAccountLane ? (
            <Input
              label={selectedDefinition.endpointLabel}
              value={selectedConfig.customEndpoint ?? ''}
            onChange={(event) => updateProviderConfig({ customEndpoint: event.target.value })}
            placeholder={selectedDefinition.endpointPlaceholder}
            helperText={getProviderEndpointHelperText(selectedProvider)}
          />
        ) : null}

        <div className="space-y-3 rounded-2xl border border-border bg-surface-elevated px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-content-primary">Credential vault</p>
              <p className="mt-1 text-xs leading-5 text-content-secondary">
                {vaultStatusDescription}
              </p>
            </div>
            <Badge
              variant={
                vaultState.lockState === 'unlocked'
                  ? 'success'
                  : vaultState.lockState === 'locked'
                    ? 'warning'
                    : 'default'
              }
            >
              {vaultStatusLabel}
            </Badge>
          </div>

          {vaultState.lockState !== 'unlocked' ? (
            <Input
              label={
                vaultState.lockState === 'uninitialized' ? 'Vault passphrase' : 'Unlock passphrase'
              }
              type="password"
              value={vaultPassphrase}
              onChange={(event) => setVaultPassphrase(event.target.value)}
              placeholder={
                vaultState.lockState === 'uninitialized'
                  ? 'Create a passphrase for local encryption'
                  : 'Enter the vault passphrase'
              }
              helperText={
                vaultState.lockState === 'uninitialized'
                  ? 'You will enter this passphrase once per browser session to unlock saved credentials.'
                  : 'Credentials stay unavailable until the correct passphrase unlocks this session.'
              }
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          ) : (
            <div className="rounded-2xl border border-success-500/20 bg-success-50 px-4 py-3 text-sm text-success-700">
              Credentials are unlocked in memory for this browser session.
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            {vaultState.lockState === 'uninitialized' ? (
              <Button
                type="button"
                variant="secondary"
                loading={isVaultBusy}
                onClick={() => {
                  void runVaultAction('init');
                }}
                disabled={!isReady}
              >
                Initialize vault
              </Button>
            ) : vaultState.lockState === 'locked' ? (
              <Button
                type="button"
                variant="secondary"
                loading={isVaultBusy}
                onClick={() => {
                  void runVaultAction('unlock');
                }}
                disabled={!isReady}
              >
                Unlock vault
              </Button>
            ) : (
              <Button
                type="button"
                variant="secondary"
                loading={isVaultBusy}
                onClick={() => {
                  void runVaultAction('lock');
                }}
                disabled={!isReady}
              >
                Lock vault
              </Button>
            )}

            {selectedDefinition.requiresCredential &&
            savedMetadata &&
            !selectedUsesAccountSurface ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  void handleDeleteCredential();
                }}
                iconLeft={<Trash2 className="h-4 w-4" />}
                disabled={!isReady || isVaultBusy || vaultState.lockState !== 'unlocked'}
              >
                Remove credential
              </Button>
            ) : null}
          </div>

          {vaultState.hasLegacySecrets ? (
            <p className="text-xs leading-5 text-content-tertiary">
              Legacy secrets were detected and will be migrated into the encrypted vault the next
              time you unlock it.
            </p>
          ) : null}

          <div className={`rounded-2xl border px-4 py-3 text-sm ${vaultTone}`}>
            {vaultNotice || 'Initialize or unlock the vault before storing long-lived credentials.'}
          </div>
        </div>

        {selectedUsesApiKeyLane ? (
          <div className="space-y-3">
            <Input
              ref={apiKeyInputRef}
              label="API key"
              type="password"
              placeholder="Paste a provider key when needed"
              helperText="Enter a fresh key to test immediately, or save it into the unlocked vault for later sessions."
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onCopy={(event) => event.preventDefault()}
            />

            {savedMetadata ? (
              <div className="rounded-2xl border border-border bg-surface-elevated px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-medium text-content-primary">
                  <KeyRound className="h-4 w-4 text-primary-600" />
                  Vault credential
                </div>
                <p className="mt-2 text-sm text-content-secondary">
                  {savedMetadata.maskedValue} - updated {formatUpdatedAt(savedMetadata.updatedAt)}
                </p>
                <p className="mt-1 text-xs text-content-tertiary">{credentialHelperMessage}</p>
              </div>
            ) : null}
          </div>
        ) : selectedUsesOAuthLane ? (
          <div className="space-y-3">
            <div className="rounded-2xl border border-border bg-surface-elevated px-4 py-4">
              <p className="text-sm font-medium text-content-primary">
                GitHub Copilot authentication
              </p>
              <p className="mt-1 text-xs leading-5 text-content-secondary">
                Sign in with a GitHub account that has an active Copilot subscription. The OAuth
                token is stored in the unlocked vault instead of plain extension storage.
              </p>

              {oauthState === 'idle' || oauthState === 'error' ? (
                <div className="mt-3 space-y-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      void handleGitHubOAuth();
                    }}
                    iconLeft={<Github className="h-4 w-4" />}
                    disabled={!isReady || vaultState.lockState !== 'unlocked'}
                  >
                    Connect with GitHub
                  </Button>
                  {vaultState.lockState !== 'unlocked' ? (
                    <p className="text-xs text-content-tertiary">
                      Unlock the vault first so the Copilot token can be stored securely.
                    </p>
                  ) : null}
                  {oauthError ? <p className="text-xs text-error-600">{oauthError}</p> : null}
                </div>
              ) : oauthState === 'requesting' ? (
                <div className="mt-3 flex items-center gap-2 text-sm text-content-secondary">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Requesting device code...
                </div>
              ) : oauthState === 'waiting' ? (
                <div className="mt-3 space-y-3">
                  <div className="rounded-xl border border-primary-500/30 bg-primary-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-primary-700">
                      Enter this code on GitHub
                    </p>
                    <p className="mt-1 font-mono text-2xl font-bold tracking-[0.2em] text-primary-800">
                      {oauthUserCode}
                    </p>
                  </div>
                  <a
                    href={oauthVerifyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700"
                  >
                    Open {oauthVerifyUrl}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                  <div className="flex items-center gap-2 text-xs text-content-tertiary">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Waiting for authorization...
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      oauthAbortRef.current?.abort();
                      setOauthState('idle');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : oauthState === 'success' ? (
                <div className="mt-3 flex items-center gap-2 text-sm font-medium text-success-700">
                  <CheckCircle2 className="h-4 w-4" />
                  GitHub Copilot connected successfully
                </div>
              ) : null}
            </div>

            {savedMetadata ? (
              <div className="rounded-2xl border border-border bg-surface-elevated px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-medium text-content-primary">
                  <Github className="h-4 w-4" />
                  Copilot token in vault
                </div>
                <p className="mt-2 text-sm text-content-secondary">
                  {savedMetadata.maskedValue} - updated {formatUpdatedAt(savedMetadata.updatedAt)}
                </p>
                <p className="mt-1 text-xs text-content-tertiary">{credentialHelperMessage}</p>
              </div>
            ) : null}
          </div>
        ) : selectedUsesBrowserAccountLane ? (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-2xl border border-border bg-surface-elevated">
              <div className="border-b border-border/80 bg-[linear-gradient(135deg,_rgb(var(--color-primary-500)/0.10),_transparent_55%)] px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-content-primary">
                        Browser-account authentication
                      </p>
                      <Badge variant="info">OpenAI only</Badge>
                      <Badge variant="default">Background-owned trust</Badge>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-content-secondary">
                      Flux only shows sanitized browser-account status from the background. Raw helper payloads, auth artifacts, and runtime secrets never appear in Options.
                    </p>
                  </div>

                  <Badge
                    variant={
                      accountAuthStatus?.browserLogin
                        ? getBrowserLoginBadgeVariant(accountAuthStatus.browserLogin.status)
                        : surfacedActiveProviderAccount
                          ? getAccountBadgeVariant(surfacedActiveProviderAccount)
                          : 'default'
                    }
                  >
                    {credentialStatusLabel}
                  </Badge>
                </div>
              </div>

              <div className="space-y-4 px-4 py-4">
                <div className="grid gap-3 md:grid-cols-[1.2fr_0.8fr]">
                  <div className="rounded-xl border border-border bg-surface-primary px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-content-tertiary">
                      Browser lane status
                    </p>
                    <p className="mt-2 text-sm font-semibold text-content-primary">
                      {getBrowserLoginStatusLabel(accountAuthStatus?.browserLogin)}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-content-secondary">
                      {credentialHelperMessage}
                    </p>
                  </div>

                  <div className="rounded-xl border border-border bg-surface-primary px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-content-tertiary">
                      Trusted account
                    </p>
                    <p className="mt-2 text-sm font-semibold text-content-primary">
                      {surfacedActiveProviderAccount?.label ?? 'No trusted account yet'}
                    </p>
                    <p className="mt-1 text-xs text-content-secondary">
                      {surfacedActiveProviderAccount?.maskedIdentifier ??
                        surfacedActiveProviderAccount?.accountId ??
                        'Connect through the helper once it exists, or validate previously trusted local artifacts.'}
                    </p>
                  </div>
                </div>

                {savedMetadata ? (
                  <div className="rounded-lg border border-border bg-surface-primary px-4 py-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-content-primary">
                      <KeyRound className="h-4 w-4 text-primary-600" />
                      Stored browser-account artifact
                    </div>
                    <p className="mt-2 text-sm text-content-secondary">
                      {savedMetadata.maskedValue} - updated {formatUpdatedAt(savedMetadata.updatedAt)}
                    </p>
                    <p className="mt-1 text-xs text-content-tertiary">
                      Only masked metadata is shown here. The raw artifact and helper payload remain hidden.
                    </p>
                  </div>
                ) : null}

                <div className={`rounded-xl border px-4 py-3 text-sm ${accountTone}`}>
                  {accountMessage ||
                    'OpenAI browser-account readiness is owned by the background runtime. Connect asks for trusted status; Test connection validates the active stored account if one already exists.'}
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <Button
                    type="button"
                    variant="secondary"
                    size="lg"
                    className="min-h-11"
                    loading={accountActionKey === 'connect'}
                    onClick={() => {
                      void handleOpenAIBrowserConnect();
                    }}
                    iconLeft={<PlugZap className="h-4 w-4" />}
                    disabled={!isReady}
                  >
                    Connect browser account
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : selectedUsesAccountImportLane ? (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-2xl border border-border bg-surface-elevated">
              <div className="border-b border-border/80 bg-[linear-gradient(135deg,_rgb(var(--color-primary-500)/0.10),_transparent_55%)] px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-content-primary">
                        Account-backed authentication
                      </p>
                      <Badge variant="warning">Experimental</Badge>
                      <Badge variant="default">Official artifacts only</Badge>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-content-secondary">
                      Codex follows the OpenCode account flow: import an official ChatGPT/Codex auth
                      artifact, validate it against the background runtime, then choose which
                      imported account stays active.
                    </p>
                  </div>

                  <div className="rounded-xl border border-border bg-surface-primary px-3 py-2 text-right">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-content-tertiary">
                      Auth surface
                    </p>
                    <p className="mt-1 text-sm font-semibold text-content-primary">
                      {accountAuthStatus?.status === 'vault-locked'
                        ? 'Vault locked'
                        : accountAuthStatus?.status === 'needs-auth'
                          ? 'Needs import'
                          : surfacedActiveProviderAccount
                            ? getAccountBadgeLabel(surfacedActiveProviderAccount)
                            : 'Awaiting import'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-4 px-4 py-4">
                <div className="rounded-xl border border-warning-500/25 bg-warning-50 px-4 py-3 text-sm text-warning-800">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>
                      Experimental provider boundary: Flux only supports importing official auth
                      artifacts that already exist. Token exchange, session renewal, and quota
                      telemetry remain best-effort and may require re-importing a fresh artifact.
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-[1.2fr_0.8fr]">
                  <div className="rounded-xl border border-border bg-surface-primary px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-content-tertiary">
                          Account auth status
                        </p>
                        <p className="mt-2 text-sm font-semibold text-content-primary">
                          {surfacedActiveProviderAccount?.label ?? 'No imported account yet'}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-content-secondary">
                          {credentialHelperMessage}
                        </p>
                      </div>
                      <Badge
                        variant={
                          surfacedActiveProviderAccount
                            ? getAccountBadgeVariant(surfacedActiveProviderAccount)
                            : accountAuthStatus?.status === 'vault-locked'
                              ? 'warning'
                              : 'default'
                        }
                      >
                        {credentialStatusLabel}
                      </Badge>
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-lg border border-border bg-surface-elevated px-3 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-tertiary">
                          Active account
                        </p>
                        <p className="mt-1 text-sm font-medium text-content-primary">
                          {surfacedActiveProviderAccount?.maskedIdentifier ??
                            surfacedActiveProviderAccount?.accountId ??
                            'No active account'}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border bg-surface-elevated px-3 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-content-tertiary">
                          Quota snapshot
                        </p>
                        <p className="mt-1 text-sm font-medium text-content-primary">
                          {formatQuotaSummary(activeProviderQuota)}
                        </p>
                      </div>
                    </div>

                    {savedMetadata ? (
                      <div className="mt-3 rounded-lg border border-border bg-surface-elevated px-3 py-3">
                        <div className="flex items-center gap-2 text-sm font-medium text-content-primary">
                          <KeyRound className="h-4 w-4 text-primary-600" />
                          Stored auth artifact
                        </div>
                        <p className="mt-2 text-sm text-content-secondary">
                          {savedMetadata.maskedValue} - updated {formatUpdatedAt(savedMetadata.updatedAt)}
                        </p>
                        <p className="mt-1 text-xs text-content-tertiary">
                          The raw artifact body is never shown again after a successful import.
                        </p>
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-xl border border-border bg-surface-primary px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-content-tertiary">
                      Import official auth artifact
                    </p>
                    <p className="mt-2 text-xs leading-5 text-content-secondary">
                      Paste an official `auth.json` export or supported text bundle. The vault must
                      be unlocked before Flux can store or validate the imported account.
                    </p>

                    <div className="mt-3 space-y-3">
                      <Input
                        label="Account label (optional)"
                        value={accountImportLabel}
                        onChange={(event) => setAccountImportLabel(event.target.value)}
                        placeholder="Workspace Codex seat"
                        helperText="Use a short label if you want this account to be easier to recognize later."
                        disabled={!isReady || accountActionKey === 'connect'}
                      />

                      <div className="flex flex-col gap-1.5">
                        <label
                          htmlFor="codex-auth-artifact"
                          className="text-sm font-medium text-content-primary"
                        >
                          Auth artifact payload
                        </label>
                        <textarea
                          id="codex-auth-artifact"
                          value={accountArtifactValue}
                          onChange={(event) => setAccountArtifactValue(event.target.value)}
                          placeholder="Paste official auth.json or a supported token bundle here"
                          className="min-h-[10rem] w-full rounded-xl border border-border bg-surface-primary px-3 py-3 text-sm text-content-primary placeholder:text-content-tertiary transition-all duration-fast focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                          spellCheck={false}
                          autoCorrect="off"
                          autoCapitalize="none"
                          disabled={!isReady || accountActionKey === 'connect'}
                        />
                        <p className="text-xs leading-snug text-content-tertiary">
                          Supported fields include `refresh_token`, `id_token`, and `account_id`.
                          Flux stores only the masked account record after import.
                        </p>
                      </div>

                      <Button
                        type="button"
                        variant="secondary"
                        size="lg"
                        className="min-h-11"
                        loading={accountActionKey === 'connect'}
                        onClick={() => {
                          void handleAccountImportConnect();
                        }}
                        iconLeft={<PlugZap className="h-4 w-4" />}
                        disabled={!isReady}
                      >
                        Import and connect
                      </Button>

                      {vaultState.lockState !== 'unlocked' ? (
                        <p className="text-xs leading-5 text-content-tertiary">
                          Unlock the vault first. Imported account artifacts are never kept in plain
                          extension storage.
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className={`rounded-xl border px-4 py-3 text-sm ${accountTone}`}>
                  {accountMessage ||
                    'Imported Codex accounts stay local, vault-backed, and provider-specific. Validate before relying on an account for runtime work.'}
                </div>

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-content-tertiary">
                        Imported accounts
                      </p>
                      <p className="mt-1 text-xs leading-5 text-content-secondary">
                        Activate one account at a time. Revoked or refresh-required accounts stay
                        visible until you explicitly remove them.
                      </p>
                    </div>
                    <Badge variant="default">{surfacedProviderAccounts.length} account(s)</Badge>
                  </div>

                  {surfacedProviderAccounts.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border bg-surface-primary px-4 py-4 text-sm leading-6 text-content-secondary">
                      No imported account is available yet. Once an official auth artifact is
                      imported, Flux will show the active account, validation status, and quota
                      refresh controls here.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {surfacedProviderAccounts.map((account) => {
                        const isActive = account.accountId === surfacedActiveAccountId;
                        const accountQuota =
                          accountQuotaStatus?.accountId === account.accountId
                            ? accountQuotaStatus.quota
                            : account.metadata?.quota;
                        const isBusy =
                          accountActionKey === `validate:${account.accountId}` ||
                          accountActionKey === `activate:${account.accountId}` ||
                          accountActionKey === `revoke:${account.accountId}` ||
                          accountActionKey === `remove:${account.accountId}` ||
                          accountActionKey === `quota:${account.accountId}`;

                        return (
                          <div
                            key={account.accountId}
                            className={`rounded-xl border px-4 py-4 ${
                              isActive
                                ? 'border-primary-500/30 bg-primary-50/60'
                                : 'border-border bg-surface-primary'
                            }`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-semibold text-content-primary">
                                    {account.label}
                                  </p>
                                  {isActive ? <Badge variant="success">Active</Badge> : null}
                                  <Badge variant={getAccountBadgeVariant(account)}>
                                    {getAccountBadgeLabel(account)}
                                  </Badge>
                                </div>
                                <p className="mt-1 text-xs text-content-secondary">
                                  {account.maskedIdentifier ?? account.accountId}
                                </p>
                              </div>

                              <div className="text-right text-[11px] leading-5 text-content-tertiary">
                                <p>Updated {formatUpdatedAt(account.updatedAt)}</p>
                                {account.validatedAt ? (
                                  <p>Validated {formatUpdatedAt(account.validatedAt)}</p>
                                ) : null}
                              </div>
                            </div>

                            <div className="mt-3 grid gap-3 md:grid-cols-[1.15fr_0.85fr]">
                              <div className="rounded-lg border border-border bg-surface-elevated px-3 py-3 text-xs leading-5 text-content-secondary">
                                {getAccountStatusDetail(account, vaultState.lockState !== 'unlocked')}
                              </div>
                              <div className="rounded-lg border border-border bg-surface-elevated px-3 py-3 text-xs leading-5 text-content-secondary">
                                <p className="font-medium text-content-primary">Quota</p>
                                <p className="mt-1">{formatQuotaSummary(accountQuota)}</p>
                              </div>
                            </div>

                            <div className="mt-4 flex flex-wrap gap-2">
                              <Button
                                type="button"
                                variant="secondary"
                                size="lg"
                                className="min-h-11"
                                loading={accountActionKey === `validate:${account.accountId}`}
                                onClick={() => {
                                  void handleAccountValidate(account.accountId);
                                }}
                                disabled={!isReady || isBusy}
                                aria-label={`Validate account ${account.label}`}
                              >
                                Validate
                              </Button>

                              {!isActive ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="lg"
                                  className="min-h-11"
                                  loading={accountActionKey === `activate:${account.accountId}`}
                                  onClick={() => {
                                    void handleAccountActivate(account.accountId);
                                  }}
                                  disabled={!isReady || isBusy}
                                  aria-label={`Activate account ${account.label}`}
                                >
                                  Activate
                                </Button>
                              ) : null}

                              <Button
                                type="button"
                                variant="ghost"
                                size="lg"
                                className="min-h-11"
                                loading={accountActionKey === `quota:${account.accountId}`}
                                onClick={() => {
                                  void handleAccountQuotaRefresh(account.accountId);
                                }}
                                disabled={!isReady || isBusy}
                                aria-label={`Refresh quota for ${account.label}`}
                              >
                                Refresh quota
                              </Button>

                              <Button
                                type="button"
                                variant="ghost"
                                size="lg"
                                className="min-h-11"
                                loading={accountActionKey === `revoke:${account.accountId}`}
                                onClick={() => {
                                  void handleAccountRevoke(account.accountId);
                                }}
                                disabled={!isReady || isBusy}
                                aria-label={`Revoke account ${account.label}`}
                              >
                                Revoke
                              </Button>

                              <Button
                                type="button"
                                variant="danger"
                                size="lg"
                                className="min-h-11"
                                loading={accountActionKey === `remove:${account.accountId}`}
                                onClick={() => {
                                  void handleAccountRemove(account.accountId);
                                }}
                                iconLeft={<Trash2 className="h-4 w-4" />}
                                disabled={!isReady || isBusy}
                                aria-label={`Remove account ${account.label}`}
                              >
                                Remove
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-surface-elevated px-4 py-4 text-sm leading-6 text-content-secondary">
            {selectedProvider === 'ollama'
              ? 'Ollama skips API keys. Use the test button to verify the loopback runtime is reachable.'
              : 'Custom provider validation is endpoint-only. No secret is stored for this provider.'}
          </div>
        )}

        <div className={`rounded-2xl border px-4 py-3 text-sm ${statusTone}`}>
          {providerStatusSummary}
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
  );

  if (shouldShowOnboarding) {
    return (
      <OnboardingFlow
        currentStep={onboardingStep}
        selectedProviderLabel={selectedDefinition.label}
        enabledPermissionCount={enabledPermissionCount}
        theme={settings.theme}
        language={settings.language}
        providerSetupPanel={providerSetupPanel}
        providerUsesAccountImport={selectedUsesAccountImportLane}
        providerUsesBrowserAccount={selectedUsesBrowserAccountLane}
        providerAuthChoiceLabel={selectedAuthChoice.label}
        providerRequiresEndpoint={selectedProvider === 'cliproxyapi'}
        providerStatusLabel={onboardingProviderStatusLabel}
        providerSetupHint={onboardingProviderSetupHint}
        providerReadyHint={onboardingProviderReadyHint}
        onStepChange={handleOnboardingStepChange}
        onSkip={handleOnboardingSkip}
        onComplete={() => {
          void handleOnboardingComplete();
        }}
        providerRequiresApiKey={selectedUsesApiKeyLane}
        canComplete={isProviderReadyForOnboarding()}
        isBusy={isSaving || isTesting || isCompletingOnboarding}
        isCompleting={isCompletingOnboarding}
      />
    );
  }

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
                  The options workspace now drives provider setup, the encrypted vault, and runtime
                  permission boundaries through the same background APIs used during live
                  automation.
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
                  Credential status
                </p>
                <p className="mt-2 text-sm font-semibold text-content-primary">
                  {credentialStatusLabel}
                </p>
              </div>
              <div className="rounded-2xl border border-border bg-surface-primary px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-content-tertiary">
                  Enabled capabilities
                </p>
                <p className="mt-2 text-sm font-semibold text-content-primary">
                  {enabledPermissionCount}/{PERMISSION_DEFINITIONS.length}
                </p>
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
                  Provider dropdown, model config, vault-backed credentials, and connection testing.
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-6 pt-6">{providerSetupPanel}</CardContent>
            </Card>

            <Card className="overflow-hidden border border-border bg-surface-elevated shadow-lg shadow-slate-950/5">
              <CardHeader className="border-b border-border/80 bg-[linear-gradient(180deg,_rgb(var(--color-bg-secondary)),_transparent)]">
                <CardTitle as="h2">Permission toggles</CardTitle>
                <CardDescription>
                  Choose which runtime capabilities the extension is allowed to use before an
                  automation flow starts.
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
                      {customScriptingEnabled
                        ? '1 enabled'
                        : advancedModeEnabled
                          ? '0 enabled'
                          : 'Advanced mode off'}
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

                <div className="rounded-[22px] border border-border bg-surface-primary px-4 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p
                          id="advanced-mode-title"
                          className="text-sm font-semibold text-content-primary"
                        >
                          Enable Advanced mode
                        </p>
                        <Badge variant={advancedModeEnabled ? 'info' : 'default'}>Advanced</Badge>
                      </div>
                      <p
                        id="advanced-mode-description"
                        className="text-sm leading-6 text-content-secondary"
                      >
                        Reveal high-risk controls such as custom scripts and evaluate actions. Keep
                        this off unless you need those workflows.
                      </p>
                    </div>

                    <Switch
                      checked={advancedModeEnabled}
                      onCheckedChange={handleAdvancedModeToggle}
                      aria-labelledby="advanced-mode-title"
                      aria-describedby="advanced-mode-description"
                    />
                  </div>
                  <p className="mt-3 text-xs leading-5 text-content-tertiary">
                    {advancedModeEnabled
                      ? 'Advanced mode is on. Evaluate actions still require custom scripts to be enabled and saved.'
                      : 'Advanced mode is off. High-risk scripting controls remain hidden and evaluate actions stay blocked.'}
                  </p>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  {visiblePermissionDefinitions.map((permission) => {
                    const titleId = `${permission.key}-title`;
                    const descriptionId = `${permission.key}-description`;

                    return (
                      <div
                        key={permission.key}
                        className="flex min-h-11 cursor-pointer items-start justify-between gap-4 rounded-[22px] border border-border bg-surface-primary px-4 py-4 transition-colors duration-fast hover:border-primary-300 hover:bg-primary-50/40"
                        onClick={(event) => handlePermissionCardClick(event, permission.key)}
                      >
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p id={titleId} className="text-sm font-semibold text-content-primary">
                              {permission.title}
                            </p>
                            <Badge variant={permission.tone}>{permission.badge}</Badge>
                          </div>
                          <p
                            id={descriptionId}
                            className="text-sm leading-6 text-content-secondary"
                          >
                            {permission.description}
                          </p>
                        </div>

                        <Switch
                          checked={settings[permission.key]}
                          onCheckedChange={(checked) =>
                            handlePermissionToggle(permission.key, checked)
                          }
                          aria-labelledby={titleId}
                          aria-describedby={descriptionId}
                        />
                      </div>
                    );
                  })}
                </div>

                {customScriptingEnabled ? (
                  <div className="rounded-[22px] border border-error-500/20 bg-error-50 px-4 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="error">High-risk capability</Badge>
                      <p className="text-sm font-semibold text-error-700">
                        Custom scripts can execute arbitrary page logic.
                      </p>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-error-700">
                      Leave this off unless you trust the workflow source and understand that
                      scripts can interact with live page state beyond standard guarded actions.
                    </p>
                    <label className="mt-3 flex items-start gap-3 text-sm text-error-700">
                      <input
                        type="checkbox"
                        checked={customScriptsConfirmed}
                        onChange={(event) => setCustomScriptsConfirmed(event.target.checked)}
                        className="mt-1 h-4 w-4 rounded border-error-500/40 text-error-600 focus:ring-error-500"
                      />
                      <span>
                        I understand the risk and want to allow custom scripts for trusted workflows
                        only.
                      </span>
                    </label>
                  </div>
                ) : null}

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className={`rounded-2xl border px-4 py-3 text-sm ${permissionTone}`}>
                    {permissionMessage ||
                      'Toggle the capabilities you want to allow, then save the permission profile.'}
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

            <Card className="overflow-hidden border border-border bg-surface-elevated shadow-lg shadow-slate-950/5">
              <CardHeader className="border-b border-border/80 bg-[linear-gradient(180deg,_rgb(var(--color-bg-secondary)),_transparent)]">
                <CardTitle as="h2">Appearance settings</CardTitle>
                <CardDescription>
                  Set the visual theme and preferred language for Flux surfaces that already read
                  shared settings.
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-6 pt-6">
                <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                  <div className="space-y-4 rounded-[24px] border border-border bg-surface-primary p-5">
                    <div>
                      <p className="text-sm font-semibold text-content-primary">Theme mode</p>
                      <p className="mt-1 text-sm leading-6 text-content-secondary">
                        Choose whether Flux follows your system preference or stays pinned to a
                        specific look.
                      </p>
                    </div>
                    <ThemeToggle
                      className="w-full"
                      onModeChange={handleThemeChange}
                      persistOnSelect={false}
                    />
                  </div>

                  <div className="space-y-4 rounded-[24px] border border-border bg-surface-primary p-5">
                    <Select
                      id="language-select"
                      label="Language"
                      value={settings.language}
                      onChange={handleLanguageChange}
                      options={[
                        { value: 'auto', label: 'Auto detect' },
                        { value: 'en', label: 'English' },
                        { value: 'vi', label: 'Vietnamese' },
                      ]}
                      helperText="Auto keeps the interface ready for the current workflow context until localization expands further."
                      className="bg-surface-elevated"
                    />

                    <div className="rounded-2xl border border-border bg-surface-elevated px-4 py-4 text-sm leading-6 text-content-secondary">
                      Current profile:{' '}
                      <span className="font-semibold text-content-primary">{settings.theme}</span>{' '}
                      theme,{' '}
                      <span className="font-semibold text-content-primary">
                        {settings.language}
                      </span>{' '}
                      language.
                    </div>
                  </div>
                </section>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className={`rounded-2xl border px-4 py-3 text-sm ${appearanceTone}`}>
                    {appearanceMessage ||
                      'Adjust theme or language, then save the appearance profile.'}
                  </div>

                  <Button
                    type="button"
                    loading={isSavingAppearance}
                    onClick={() => {
                      void handleSaveAppearance();
                    }}
                    iconLeft={<Sparkles />}
                    disabled={!isReady}
                  >
                    Save appearance
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="border border-border bg-surface-elevated shadow-lg shadow-slate-950/5">
              <CardHeader>
                <CardTitle as="h2">Control surface status</CardTitle>
                <CardDescription>
                  Live state pulled from the background runtime and the credential vault.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-content-secondary">
                <div className="flex items-start justify-between gap-3 rounded-2xl border border-border bg-surface-primary px-4 py-3">
                  <div>
                    <p className="font-medium text-content-primary">
                      {onboardingState.completed ? 'Onboarding completed' : 'Onboarding available'}
                    </p>
                    <p className="mt-1 text-sm text-content-secondary">
                      {onboardingState.completed
                        ? 'Rerun the guided setup whenever you want to revisit the first-run flow and provider checks.'
                        : `Continue the guided setup from step ${onboardingState.lastStep + 1} before tuning the full dashboard.`}
                    </p>
                  </div>
                  <Button type="button" variant="secondary" onClick={handleOpenOnboarding}>
                    {onboardingState.completed ? 'Restart onboarding' : 'Resume onboarding'}
                  </Button>
                </div>
                <div className="flex items-start gap-3 rounded-2xl border border-border bg-surface-primary px-4 py-3">
                  <ServerCog className="mt-0.5 h-4 w-4 text-primary-600" />
                  <p>
                    Active provider:{' '}
                    <span className="font-medium text-content-primary">
                      {selectedDefinition.label}
                    </span>{' '}
                    on model{' '}
                    <span className="font-medium text-content-primary">{selectedConfig.model}</span>
                    .
                  </p>
                </div>
                <div className="flex items-start gap-3 rounded-2xl border border-border bg-surface-primary px-4 py-3">
                  <KeyRound className="mt-0.5 h-4 w-4 text-primary-600" />
                  <p>
                    Credential state:{' '}
                    <span className="font-medium text-content-primary">
                      {credentialStatusLabel}
                    </span>
                    . {credentialHelperMessage}
                  </p>
                </div>
                <div className="flex items-start gap-3 rounded-2xl border border-border bg-surface-primary px-4 py-3">
                  <RotateCw className="mt-0.5 h-4 w-4 text-primary-600" />
                  <p>
                    Connection tests run through the background runtime and clear the visible input
                    field after each attempt.
                  </p>
                </div>
                <div className="flex items-start gap-3 rounded-2xl border border-border bg-surface-primary px-4 py-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary-600" />
                  <p>
                    Permission toggles persist capability boundaries like screenshots, highlights,
                    floating UI, and custom scripts.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="border border-border bg-surface-elevated shadow-lg shadow-slate-950/5">
              <CardHeader>
                <CardTitle as="h2">Runtime posture</CardTitle>
                <CardDescription>
                  How this configuration affects live automation right now.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-content-secondary">
                <div className="rounded-2xl border border-border bg-surface-primary px-4 py-3">
                  <div className="flex items-center gap-2 font-medium text-content-primary">
                    <ShieldCheck className="h-4 w-4 text-primary-600" />
                    Vault session
                  </div>
                  <p className="mt-1">{vaultStatusDescription}</p>
                </div>
                <div className="rounded-2xl border border-border bg-surface-primary px-4 py-3">
                  <div className="flex items-center gap-2 font-medium text-content-primary">
                    <Sparkles className="h-4 w-4 text-primary-600" />
                    Scripting guardrail
                  </div>
                  <p className="mt-1">
                    {customScriptingEnabled
                      ? 'Advanced mode and custom scripts are enabled. Treat workflow sources as fully trusted before running evaluate actions.'
                      : advancedModeEnabled
                        ? 'Advanced mode is available, but custom scripts are still off. Standard guarded actions remain available.'
                        : 'Advanced mode is off. Custom scripts stay hidden and blocked by default.'}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
