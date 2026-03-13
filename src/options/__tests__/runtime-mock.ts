import { vi } from 'vitest';
import * as providerLoader from '../../core/ai-client/provider-loader';
import { PROVIDER_LOOKUP, createDefaultProviderConfigs } from '../../shared/config';
import type {
  AIProviderType,
  ExtensionMessage,
  ExtensionResponse,
  ExtensionSettings,
  ProviderConfig,
  ProviderCredentialRecord,
  RequestPayloadMap,
  ResponsePayloadMap,
  VaultState,
} from '../../shared/types';
import { normalizeOnboardingState } from '../../shared/storage/onboarding';

const DEFAULT_PROVIDER: AIProviderType = 'openai';
const GENERIC_MASK = '************';

type MessageType = keyof RequestPayloadMap;

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

function createDefaultVaultState(): VaultState {
  return {
    version: 1,
    initialized: true,
    lockState: 'unlocked',
    unlockedAt: Date.now(),
    hasLegacySecrets: false,
    credentials: {},
  };
}

function isAllowedEndpoint(providerType: AIProviderType, endpoint: string): boolean {
  if (!endpoint) {
    return false;
  }

  try {
    const parsed = new URL(endpoint);
    if (providerType === 'ollama') {
      return (
        parsed.protocol === 'http:' &&
        (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
      );
    }

    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function buildCredentialRecord(
  provider: AIProviderType,
  maskedValue = GENERIC_MASK,
): ProviderCredentialRecord {
  return {
    version: 1,
    provider,
    authKind: provider === 'copilot' ? 'oauth-token' : 'api-key',
    maskedValue,
    updatedAt: Date.now(),
  };
}

function mapVaultToProviderMetadata(vault: VaultState) {
  return Object.fromEntries(
    Object.entries(vault.credentials).map(([provider, record]) => [
      provider,
      {
        maskedValue: record?.maskedValue ?? GENERIC_MASK,
        updatedAt: record?.updatedAt ?? Date.now(),
      },
    ]),
  );
}

async function getSettingsState() {
  const stored = await chrome.storage.local.get({
    settings: createDefaultSettings(),
    providers: createDefaultProviderConfigs(),
    activeProvider: DEFAULT_PROVIDER,
    onboarding: normalizeOnboardingState(undefined),
    vault: undefined,
    providerKeyMetadata: undefined,
  });

  const legacySessionKeys = (await chrome.storage.session.get('providerSessionApiKeys'))
    .providerSessionApiKeys as Record<string, string> | undefined;
  const legacyLocalKeys = (await chrome.storage.local.get('encryptedKeys')).encryptedKeys as
    | Record<string, string>
    | undefined;

  const vault = createDefaultVaultState();
  const storedVault = stored.vault as VaultState | undefined;
  if (storedVault && typeof storedVault === 'object') {
    vault.initialized = storedVault.initialized ?? true;
    vault.lockState = storedVault.lockState ?? 'unlocked';
    vault.unlockedAt = storedVault.unlockedAt ?? Date.now();
    vault.hasLegacySecrets = Boolean(legacySessionKeys || legacyLocalKeys);
    vault.credentials = storedVault.credentials ?? {};
  }

  const providerKeyMetadata = stored.providerKeyMetadata as
    | Partial<Record<AIProviderType, { maskedValue: string; updatedAt: number }>>
    | undefined;

  if (providerKeyMetadata) {
    for (const [provider, metadata] of Object.entries(providerKeyMetadata) as Array<
      [AIProviderType, { maskedValue: string; updatedAt: number }]
    >) {
      vault.credentials[provider] = {
        ...buildCredentialRecord(provider, metadata.maskedValue),
        updatedAt: metadata.updatedAt,
      };
    }
  }

  const legacySecrets = [legacySessionKeys, legacyLocalKeys]
    .filter((value): value is Record<string, string> => Boolean(value))
    .reduce<Record<string, string>>((accumulator, current) => ({ ...accumulator, ...current }), {});

  for (const provider of Object.keys(legacySecrets) as AIProviderType[]) {
    if (!vault.credentials[provider]) {
      const maskedValue = providerKeyMetadata?.[provider]?.maskedValue ?? GENERIC_MASK;
      vault.credentials[provider] = buildCredentialRecord(provider, maskedValue);
    }
  }

  if (legacySessionKeys || legacyLocalKeys) {
    await chrome.storage.session.remove('providerSessionApiKeys');
    await chrome.storage.local.remove('encryptedKeys');
  }

  const providerKeyMetadataSnapshot = mapVaultToProviderMetadata(vault);
  await chrome.storage.local.set({
    vault,
    ...(Object.keys(providerKeyMetadataSnapshot).length > 0
      ? { providerKeyMetadata: providerKeyMetadataSnapshot }
      : {}),
  });
  if (Object.keys(providerKeyMetadataSnapshot).length === 0) {
    await chrome.storage.local.remove('providerKeyMetadata');
  }

  return {
    settings: stored.settings as ExtensionSettings,
    providers: stored.providers as Record<AIProviderType, ProviderConfig>,
    activeProvider: stored.activeProvider as AIProviderType,
    onboarding: normalizeOnboardingState(stored.onboarding),
    vault,
  };
}

async function saveVault(vault: VaultState): Promise<void> {
  const providerKeyMetadata = mapVaultToProviderMetadata(vault);
  await chrome.storage.local.set({
    vault,
    ...(Object.keys(providerKeyMetadata).length > 0 ? { providerKeyMetadata } : {}),
  });

  if (Object.keys(providerKeyMetadata).length === 0) {
    await chrome.storage.local.remove('providerKeyMetadata');
  }
}

async function validateProvider(
  provider: AIProviderType,
  config: ProviderConfig,
  apiKey?: string,
  hasStoredCredential = false,
): Promise<boolean> {
  const definition = PROVIDER_LOOKUP[provider];

  if (!definition.requiresCredential) {
    if (provider === 'custom') {
      return isAllowedEndpoint(provider, config.customEndpoint?.trim() ?? '');
    }

    if (provider === 'ollama') {
      const client = await providerLoader.createProvider('ollama');
      await client.initialize({
        provider,
        model: config.model,
        baseUrl: config.customEndpoint?.trim() || undefined,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
      });
      return client.validateApiKey('');
    }

    return true;
  }

  const credential = apiKey?.trim() || (hasStoredCredential ? 'stored-credential' : '');
  if (!credential) {
    return false;
  }

  const client = await providerLoader.createProvider(provider as Exclude<AIProviderType, 'custom'>);
  await client.initialize({
    provider,
    model: config.model,
    apiKey: credential,
    baseUrl: config.customEndpoint?.trim() || undefined,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
  });

  return client.validateApiKey(credential);
}

export function installOptionsRuntimeMock(): void {
  vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(async (message: unknown) => {
    const event = message as ExtensionMessage;
    const type = event.type as MessageType;
    const payload = event.payload as RequestPayloadMap[MessageType];
    const state = await getSettingsState();

    const success = <T extends MessageType>(data: ResponsePayloadMap[T]): ExtensionResponse<ResponsePayloadMap[T]> => ({
      success: true,
      data,
    });

    switch (type) {
      case 'SETTINGS_GET':
        return success({
          settings: state.settings,
          providers: state.providers,
          activeProvider: state.activeProvider,
          onboarding: state.onboarding,
          vault: state.vault,
        });
      case 'SETTINGS_UPDATE': {
        const nextSettings = {
          ...state.settings,
          ...(payload as RequestPayloadMap['SETTINGS_UPDATE']).settings,
        };
        await chrome.storage.local.set({ settings: nextSettings });
        return success(undefined);
      }
      case 'PROVIDER_SET': {
        const request = payload as RequestPayloadMap['PROVIDER_SET'];
        const nextProviders = {
          ...state.providers,
          [request.provider]: request.config,
        };
        const nextSettings = request.makeDefault
          ? { ...state.settings, defaultProvider: request.provider }
          : state.settings;
        const nextOnboarding = {
          ...state.onboarding,
          completed: false,
          completedAt: undefined,
          lastStep: Math.min(state.onboarding.lastStep, 1),
          configuredProvider: request.provider,
          validatedProvider:
            state.onboarding.validatedProvider === request.provider
              ? undefined
              : state.onboarding.validatedProvider,
          providerReady: PROVIDER_LOOKUP[request.provider].requiresCredential ? false : true,
        };
        await chrome.storage.local.set({
          providers: nextProviders,
          activeProvider: request.provider,
          settings: nextSettings,
          onboarding: nextOnboarding,
        });
        return success({
          activeProvider: request.provider,
          providerConfig: request.config,
        });
      }
      case 'API_KEY_SET': {
        const request = payload as RequestPayloadMap['API_KEY_SET'];
        const record = buildCredentialRecord(
          request.provider,
          request.maskedValue ?? (request.provider === 'copilot' ? `ghu_****${request.apiKey.slice(-4)}` : GENERIC_MASK),
        );
        const nextVault = {
          ...state.vault,
          initialized: true,
          lockState: 'unlocked' as const,
          unlockedAt: Date.now(),
          credentials: {
            ...state.vault.credentials,
            [request.provider]: record,
          },
        };
        await saveVault(nextVault);
        return success({
          record,
          vault: nextVault,
        });
      }
      case 'API_KEY_DELETE': {
        const request = payload as RequestPayloadMap['API_KEY_DELETE'];
        const nextVault = {
          ...state.vault,
          credentials: { ...state.vault.credentials },
        };
        delete nextVault.credentials[request.provider];
        await saveVault(nextVault);
        return success({ vault: nextVault });
      }
      case 'API_KEY_VALIDATE': {
        const request = payload as RequestPayloadMap['API_KEY_VALIDATE'];
        const providerConfig = request.config ?? state.providers[request.provider];
        const storedRecord = state.vault.credentials[request.provider];
        const valid = await validateProvider(
          request.provider,
          providerConfig,
          request.apiKey,
          Boolean(storedRecord),
        );
        const nextVault = {
          ...state.vault,
          credentials: { ...state.vault.credentials },
        };
        if (valid && storedRecord) {
          nextVault.credentials[request.provider] = {
            ...storedRecord,
            validatedAt: Date.now(),
            stale: false,
          };
          await saveVault(nextVault);
        }
        return success({
          valid,
          record: nextVault.credentials[request.provider],
          vault: nextVault,
        });
      }
      case 'VAULT_INIT':
      case 'VAULT_UNLOCK': {
        const nextVault = {
          ...state.vault,
          initialized: true,
          lockState: 'unlocked' as const,
          unlockedAt: Date.now(),
        };
        await saveVault(nextVault);
        return success({ vault: nextVault });
      }
      case 'VAULT_LOCK': {
        const nextVault = {
          ...state.vault,
          initialized: true,
          lockState: 'locked' as const,
          unlockedAt: undefined,
        };
        await saveVault(nextVault);
        return success({ vault: nextVault });
      }
      case 'VAULT_STATUS_GET':
        return success({ vault: state.vault });
      default:
        return { success: false, error: { code: 'NOT_IMPLEMENTED', message: `Unhandled ${type}` } };
    }
  });
}
