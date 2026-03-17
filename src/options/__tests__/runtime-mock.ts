import { vi } from 'vitest';
import * as providerLoader from '../../core/ai-client/provider-loader';
import { PROVIDER_LOOKUP, createDefaultProviderConfigs } from '../../shared/config';
import type {
  AIProviderType,
  ExtensionMessage,
  ExtensionResponse,
  ProviderAccountRecord,
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
    accounts: {},
    activeAccounts: {},
  };
}

function getDefaultAuthKind(provider: AIProviderType): ProviderCredentialRecord['authKind'] {
  if (provider === 'copilot') {
    return 'oauth-token';
  }

  if (provider === 'codex') {
    return 'account-artifact';
  }

  return 'api-key';
}

function getMaskedCredentialValue(provider: AIProviderType, secret: string): string {
  if (provider === 'copilot') {
    return `ghu_****${secret.slice(-4)}`;
  }

  if (provider === 'codex') {
    return secret.length > 8 ? `acct_****${secret.slice(-4)}` : GENERIC_MASK;
  }

  return GENERIC_MASK;
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
  authKind: ProviderCredentialRecord['authKind'] = getDefaultAuthKind(provider),
): ProviderCredentialRecord {
  return {
    version: 1,
    provider,
    providerFamily: provider === 'codex' ? 'chatgpt-account' : 'default',
    authFamily:
      authKind === 'oauth-token'
        ? 'oauth-token'
        : authKind === 'account-artifact' || authKind === 'session-token'
          ? 'account-backed'
        : 'api-key',
    authKind,
    maskedValue,
    updatedAt: Date.now(),
  };
}

function supportsAccountBackedAuth(provider: AIProviderType): boolean {
  return PROVIDER_LOOKUP[provider].authFamily === 'account-backed';
}

function cloneAccountRecord(account: ProviderAccountRecord): ProviderAccountRecord {
  return {
    ...account,
    metadata: account.metadata
      ? {
          ...account.metadata,
          quota: account.metadata.quota ? { ...account.metadata.quota } : undefined,
          rateLimit: account.metadata.rateLimit ? { ...account.metadata.rateLimit } : undefined,
          entitlement: account.metadata.entitlement ? { ...account.metadata.entitlement } : undefined,
          session: account.metadata.session ? { ...account.metadata.session } : undefined,
        }
      : undefined,
  };
}

function createNotImplementedResponse<T>(message: string, details?: unknown): ExtensionResponse<T> {
  return {
    success: false,
    error: {
      code: 'NOT_IMPLEMENTED',
      message,
      details,
    },
  };
}

function createUnsupportedAccountProviderResponse<T>(provider: AIProviderType): ExtensionResponse<T> {
  return {
    success: false,
    error: {
      code: 'UNSUPPORTED_PROVIDER_AUTH_FAMILY',
      message: `Provider ${provider} does not use account-backed auth messaging.`,
      details: { provider },
    },
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
    vault.accounts = storedVault.accounts ?? {};
    vault.activeAccounts = storedVault.activeAccounts ?? {};
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

  if (provider === 'codex') {
    return true;
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
          request.maskedValue ?? getMaskedCredentialValue(request.provider, request.apiKey),
          request.authKind ?? getDefaultAuthKind(request.provider),
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
      case 'ACCOUNT_AUTH_STATUS_GET': {
        const request = payload as RequestPayloadMap['ACCOUNT_AUTH_STATUS_GET'];
        if (!supportsAccountBackedAuth(request.provider)) {
          return createUnsupportedAccountProviderResponse(request.provider);
        }

        const accounts = (state.vault.accounts[request.provider] ?? []).map(cloneAccountRecord);
        const credential = state.vault.credentials[request.provider];
        const activeAccountId = state.vault.activeAccounts[request.provider];

        return success({
          provider: request.provider,
          authFamily: 'account-backed',
          status:
            state.vault.lockState !== 'unlocked'
              ? 'vault-locked'
              : accounts.length > 0 || credential
                ? 'ready'
                : 'needs-auth',
          availableTransports: ['artifact-import'],
          credential,
          accounts,
          activeAccountId,
          vault: state.vault,
        });
      }
      case 'ACCOUNT_LIST': {
        const request = payload as RequestPayloadMap['ACCOUNT_LIST'];
        if (!supportsAccountBackedAuth(request.provider)) {
          return createUnsupportedAccountProviderResponse(request.provider);
        }

        return success({
          provider: request.provider,
          accounts: (state.vault.accounts[request.provider] ?? []).map(cloneAccountRecord),
          activeAccountId: state.vault.activeAccounts[request.provider],
        });
      }
      case 'ACCOUNT_GET': {
        const request = payload as RequestPayloadMap['ACCOUNT_GET'];
        if (!supportsAccountBackedAuth(request.provider)) {
          return createUnsupportedAccountProviderResponse(request.provider);
        }

        return success({
          provider: request.provider,
          account:
            (state.vault.accounts[request.provider] ?? [])
              .map(cloneAccountRecord)
              .find((account) => account.accountId === request.accountId) ?? null,
          activeAccountId: state.vault.activeAccounts[request.provider],
        });
      }
      case 'ACCOUNT_QUOTA_STATUS_GET': {
        const request = payload as RequestPayloadMap['ACCOUNT_QUOTA_STATUS_GET'];
        if (!supportsAccountBackedAuth(request.provider)) {
          return createUnsupportedAccountProviderResponse(request.provider);
        }

        const accountId = request.accountId ?? state.vault.activeAccounts[request.provider];
        const account = accountId
          ? (state.vault.accounts[request.provider] ?? []).find(
              (candidate) => candidate.accountId === accountId,
            )
          : undefined;

        return success({
          provider: request.provider,
          accountId,
          quota: account?.metadata?.quota,
        });
      }
      case 'ACCOUNT_AUTH_CONNECT_START': {
        const request = payload as RequestPayloadMap['ACCOUNT_AUTH_CONNECT_START'];
        if (!supportsAccountBackedAuth(request.provider)) {
          return createUnsupportedAccountProviderResponse(request.provider);
        }

        return createNotImplementedResponse(
          `Account-backed auth connect is not implemented for ${request.provider} yet.`,
          { provider: request.provider, transport: request.transport },
        );
      }
      case 'ACCOUNT_AUTH_VALIDATE': {
        const request = payload as RequestPayloadMap['ACCOUNT_AUTH_VALIDATE'];
        if (!supportsAccountBackedAuth(request.provider)) {
          return createUnsupportedAccountProviderResponse(request.provider);
        }

        return createNotImplementedResponse(
          `Account-backed auth validation is not implemented for ${request.provider} yet.`,
          { provider: request.provider, accountId: request.accountId },
        );
      }
      case 'ACCOUNT_ACTIVATE': {
        const request = payload as RequestPayloadMap['ACCOUNT_ACTIVATE'];
        if (!supportsAccountBackedAuth(request.provider)) {
          return createUnsupportedAccountProviderResponse(request.provider);
        }

        const accounts = [...(state.vault.accounts[request.provider] ?? [])];
        const target = accounts.find((account) => account.accountId === request.accountId);
        if (!target) {
          throw new Error(`Account ${request.accountId} was not found`);
        }

        const now = Date.now();
        const nextVault = {
          ...state.vault,
          accounts: {
            ...state.vault.accounts,
            [request.provider]: accounts.map((account) => ({
              ...cloneAccountRecord(account),
              isActive: account.accountId === request.accountId,
              status:
                account.accountId === request.accountId
                  ? 'active'
                  : account.status === 'active'
                    ? 'available'
                    : account.status,
              lastUsedAt: account.accountId === request.accountId ? now : account.lastUsedAt,
              updatedAt: account.accountId === request.accountId ? now : account.updatedAt,
              stale: account.accountId === request.accountId ? false : account.stale,
            })),
          },
          activeAccounts: {
            ...state.vault.activeAccounts,
            [request.provider]: request.accountId,
          },
        };
        await saveVault(nextVault);
        return success({
          provider: request.provider,
          accountId: request.accountId,
          activeAccountId: request.accountId,
        });
      }
      case 'ACCOUNT_REVOKE': {
        const request = payload as RequestPayloadMap['ACCOUNT_REVOKE'];
        if (!supportsAccountBackedAuth(request.provider)) {
          return createUnsupportedAccountProviderResponse(request.provider);
        }

        const accounts = [...(state.vault.accounts[request.provider] ?? [])];
        const targetIndex = accounts.findIndex((account) => account.accountId === request.accountId);
        if (targetIndex < 0) {
          return success({
            provider: request.provider,
            accountId: request.accountId,
            revoked: false,
          });
        }

        const now = Date.now();
        const current = accounts[targetIndex];
        accounts[targetIndex] = {
          ...cloneAccountRecord(current),
          credentialKey: request.revokeCredential ? undefined : current.credentialKey,
          status: 'revoked',
          isActive: false,
          stale: true,
          validatedAt: undefined,
          updatedAt: now,
          metadata: {
            ...current.metadata,
            lastErrorCode: request.revokeCredential
              ? 'ACCOUNT_REVOKED_CREDENTIAL_REMOVED'
              : 'ACCOUNT_REVOKED',
            lastErrorAt: now,
          },
        };
        const nextActiveAccounts = { ...state.vault.activeAccounts };
        if (nextActiveAccounts[request.provider] === request.accountId) {
          delete nextActiveAccounts[request.provider];
        }
        const nextVault = {
          ...state.vault,
          accounts: {
            ...state.vault.accounts,
            [request.provider]: accounts,
          },
          activeAccounts: nextActiveAccounts,
        };
        await saveVault(nextVault);
        return success({
          provider: request.provider,
          accountId: request.accountId,
          revoked: true,
        });
      }
      case 'ACCOUNT_REMOVE': {
        const request = payload as RequestPayloadMap['ACCOUNT_REMOVE'];
        if (!supportsAccountBackedAuth(request.provider)) {
          return createUnsupportedAccountProviderResponse(request.provider);
        }

        const accounts = (state.vault.accounts[request.provider] ?? []).filter(
          (account) => account.accountId !== request.accountId,
        );
        const removed = accounts.length !== (state.vault.accounts[request.provider] ?? []).length;
        const nextActiveAccounts = { ...state.vault.activeAccounts };
        if (nextActiveAccounts[request.provider] === request.accountId) {
          delete nextActiveAccounts[request.provider];
          if (accounts[0]) {
            accounts[0] = {
              ...cloneAccountRecord(accounts[0]),
              isActive: true,
              status: accounts[0].status === 'revoked' ? 'needs-auth' : 'active',
              updatedAt: Date.now(),
            };
            nextActiveAccounts[request.provider] = accounts[0].accountId;
          }
        }
        const nextAccounts = { ...state.vault.accounts };
        if (accounts.length > 0) {
          nextAccounts[request.provider] = accounts.map(cloneAccountRecord);
        } else {
          delete nextAccounts[request.provider];
        }
        const nextVault = {
          ...state.vault,
          accounts: nextAccounts,
          activeAccounts: nextActiveAccounts,
        };
        await saveVault(nextVault);
        return success({
          provider: request.provider,
          accountId: request.accountId,
          removed,
        });
      }
      case 'ACCOUNT_QUOTA_REFRESH': {
        const request = payload as RequestPayloadMap['ACCOUNT_QUOTA_REFRESH'];
        if (!supportsAccountBackedAuth(request.provider)) {
          return createUnsupportedAccountProviderResponse(request.provider);
        }

        const accountId = request.accountId ?? state.vault.activeAccounts[request.provider];
        const account = accountId
          ? (state.vault.accounts[request.provider] ?? []).find(
              (candidate) => candidate.accountId === accountId,
            )
          : undefined;
        return success({
          provider: request.provider,
          accountId,
          quota: account?.metadata?.quota,
          refreshedAt: Date.now(),
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
