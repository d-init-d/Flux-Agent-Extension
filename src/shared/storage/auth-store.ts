import { PROVIDER_LOOKUP } from '@shared/config';
import type {
  AIProviderFamily,
  AIProviderType,
  ApiKeyAuthStoreRecord,
  ApiKeyAuthStoreState,
  AppManagedAuthStore,
  AppManagedAuthStoreState,
  BrowserAccountArtifactStoreRecord,
  BrowserAccountAuthStoreRecord,
  BrowserAccountAuthStoreState,
  ProviderAccountRecord,
  ProviderEntitlementState,
  ProviderQuotaState,
  ProviderRateLimitState,
  ProviderAuthStore,
  ProviderAuthStoreState,
  ProviderBrowserLoginMetadata,
  ProviderBrowserLoginState,
  ProviderCredentialRecord,
  ProviderSessionMetadata,
} from '@shared/types';

export const AUTH_STORE_STORAGE_KEY = 'authStore' as const;
export const AUTH_STORE_VERSION = 1;

function isProviderType(value: unknown): value is AIProviderType {
  return typeof value === 'string' && value in PROVIDER_LOOKUP;
}

function isProviderFamily(value: unknown): value is AIProviderFamily {
  return value === 'default' || value === 'chatgpt-account';
}

function normalizeCredentialRecord(value: unknown): ProviderCredentialRecord | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<ProviderCredentialRecord>;
  if (
    typeof candidate.version !== 'number' ||
    !isProviderType(candidate.provider) ||
    typeof candidate.maskedValue !== 'string' ||
    typeof candidate.updatedAt !== 'number' ||
    (candidate.authFamily !== 'api-key' &&
      candidate.authFamily !== 'oauth-token' &&
      candidate.authFamily !== 'account-backed' &&
      candidate.authFamily !== 'none') ||
    (candidate.authKind !== 'api-key' &&
      candidate.authKind !== 'oauth-token' &&
      candidate.authKind !== 'account-artifact' &&
      candidate.authKind !== 'session-token' &&
      candidate.authKind !== 'none')
  ) {
    return undefined;
  }

  return {
    version: Math.trunc(candidate.version),
    provider: candidate.provider,
    providerFamily: isProviderFamily(candidate.providerFamily)
      ? candidate.providerFamily
      : undefined,
    authFamily: candidate.authFamily,
    authKind: candidate.authKind,
    storageSource:
      candidate.storageSource === 'vault' || candidate.storageSource === 'auth-store'
        ? candidate.storageSource
        : undefined,
    maskedValue: candidate.maskedValue,
    updatedAt: Math.trunc(candidate.updatedAt),
    validatedAt:
      typeof candidate.validatedAt === 'number' ? Math.trunc(candidate.validatedAt) : undefined,
    stale: candidate.stale === true,
  };
}

function normalizeBrowserLoginMetadata(value: unknown): ProviderBrowserLoginMetadata | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<ProviderBrowserLoginMetadata>;
  if (
    candidate.authMethod !== 'browser-account' ||
    (candidate.status !== 'idle' &&
      candidate.status !== 'success' &&
      candidate.status !== 'cancel' &&
      candidate.status !== 'timeout' &&
      candidate.status !== 'stale' &&
      candidate.status !== 'mismatch' &&
      candidate.status !== 'helper-missing' &&
      candidate.status !== 'error') ||
    typeof candidate.updatedAt !== 'number'
  ) {
    return undefined;
  }

  return {
    authMethod: 'browser-account',
    status: candidate.status,
    updatedAt: Math.trunc(candidate.updatedAt),
    lastAttemptAt:
      typeof candidate.lastAttemptAt === 'number' ? Math.trunc(candidate.lastAttemptAt) : undefined,
    lastCompletedAt:
      typeof candidate.lastCompletedAt === 'number'
        ? Math.trunc(candidate.lastCompletedAt)
        : undefined,
    accountId: typeof candidate.accountId === 'string' ? candidate.accountId : undefined,
    accountLabel: typeof candidate.accountLabel === 'string' ? candidate.accountLabel : undefined,
    lastErrorCode:
      typeof candidate.lastErrorCode === 'string' ? candidate.lastErrorCode : undefined,
    retryable: candidate.retryable === true,
    helper:
      candidate.helper && typeof candidate.helper === 'object'
        ? {
            id: typeof candidate.helper.id === 'string' ? candidate.helper.id : undefined,
            version:
              typeof candidate.helper.version === 'string' ? candidate.helper.version : undefined,
          }
        : undefined,
  };
}

function normalizeAccountRecord(value: unknown): ProviderAccountRecord | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<ProviderAccountRecord>;
  if (
    typeof candidate.version !== 'number' ||
    !isProviderType(candidate.provider) ||
    !isProviderFamily(candidate.providerFamily) ||
    candidate.authFamily !== 'account-backed' ||
    typeof candidate.accountId !== 'string' ||
    typeof candidate.label !== 'string' ||
    (candidate.status !== 'active' &&
      candidate.status !== 'available' &&
      candidate.status !== 'needs-auth' &&
      candidate.status !== 'revoked' &&
      candidate.status !== 'error' &&
      candidate.status !== 'unknown') ||
    typeof candidate.updatedAt !== 'number'
  ) {
    return undefined;
  }

  return {
    version: Math.trunc(candidate.version),
    provider: candidate.provider,
    providerFamily: candidate.providerFamily,
    authFamily: 'account-backed',
    accountId: candidate.accountId,
    label: candidate.label,
    maskedIdentifier:
      typeof candidate.maskedIdentifier === 'string' ? candidate.maskedIdentifier : undefined,
    credentialKey:
      typeof candidate.credentialKey === 'string' ? candidate.credentialKey : undefined,
    status: candidate.status,
    isActive: candidate.isActive === true,
    updatedAt: Math.trunc(candidate.updatedAt),
    validatedAt:
      typeof candidate.validatedAt === 'number' ? Math.trunc(candidate.validatedAt) : undefined,
    lastUsedAt:
      typeof candidate.lastUsedAt === 'number' ? Math.trunc(candidate.lastUsedAt) : undefined,
    stale: candidate.stale === true,
    metadata: normalizeAccountMetadata(candidate.metadata),
  };
}

function normalizeQuotaState(value: unknown): ProviderQuotaState | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<ProviderQuotaState>;
  if (
    (candidate.scope !== 'provider' && candidate.scope !== 'account' && candidate.scope !== 'session') ||
    (candidate.unit !== 'requests' &&
      candidate.unit !== 'tokens' &&
      candidate.unit !== 'credits' &&
      candidate.unit !== 'unknown') ||
    (candidate.period !== 'minute' &&
      candidate.period !== 'hour' &&
      candidate.period !== 'day' &&
      candidate.period !== 'month' &&
      candidate.period !== 'lifetime' &&
      candidate.period !== 'unknown') ||
    typeof candidate.observedAt !== 'number'
  ) {
    return undefined;
  }

  return {
    scope: candidate.scope,
    unit: candidate.unit,
    period: candidate.period,
    used: typeof candidate.used === 'number' ? candidate.used : undefined,
    limit: typeof candidate.limit === 'number' ? candidate.limit : undefined,
    remaining: typeof candidate.remaining === 'number' ? candidate.remaining : undefined,
    observedAt: Math.trunc(candidate.observedAt),
  };
}

function normalizeRateLimitState(value: unknown): ProviderRateLimitState | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<ProviderRateLimitState>;
  if (
    (candidate.scope !== 'provider' && candidate.scope !== 'account' && candidate.scope !== 'session') ||
    typeof candidate.observedAt !== 'number'
  ) {
    return undefined;
  }

  return {
    scope: candidate.scope,
    limit: typeof candidate.limit === 'number' ? candidate.limit : undefined,
    remaining: typeof candidate.remaining === 'number' ? candidate.remaining : undefined,
    resetAt: typeof candidate.resetAt === 'number' ? candidate.resetAt : undefined,
    retryAfterSeconds:
      typeof candidate.retryAfterSeconds === 'number' ? candidate.retryAfterSeconds : undefined,
    windowMs: typeof candidate.windowMs === 'number' ? candidate.windowMs : undefined,
    observedAt: Math.trunc(candidate.observedAt),
  };
}

function normalizeEntitlementState(value: unknown): ProviderEntitlementState | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<ProviderEntitlementState>;
  if (
    candidate.status !== 'active' &&
    candidate.status !== 'inactive' &&
    candidate.status !== 'limited' &&
    candidate.status !== 'unknown'
  ) {
    return undefined;
  }

  return {
    status: candidate.status,
    plan: typeof candidate.plan === 'string' ? candidate.plan : undefined,
    features: Array.isArray(candidate.features)
      ? candidate.features.filter((feature): feature is string => typeof feature === 'string')
      : undefined,
    checkedAt: typeof candidate.checkedAt === 'number' ? Math.trunc(candidate.checkedAt) : undefined,
    source:
      candidate.source === 'manual-import' ||
      candidate.source === 'validation' ||
      candidate.source === 'runtime-session' ||
      candidate.source === 'unknown'
        ? candidate.source
        : undefined,
  };
}

function normalizeSessionMetadata(value: unknown): ProviderSessionMetadata | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<ProviderSessionMetadata>;
  if (
    candidate.authKind !== 'session-token' ||
    (candidate.status !== 'active' &&
      candidate.status !== 'refresh-required' &&
      candidate.status !== 'expired' &&
      candidate.status !== 'revoked' &&
      candidate.status !== 'unknown') ||
    typeof candidate.observedAt !== 'number'
  ) {
    return undefined;
  }

  return {
    authKind: 'session-token',
    status: candidate.status,
    observedAt: Math.trunc(candidate.observedAt),
    lastIssuedAt:
      typeof candidate.lastIssuedAt === 'number' ? Math.trunc(candidate.lastIssuedAt) : undefined,
    expiresAt: typeof candidate.expiresAt === 'number' ? Math.trunc(candidate.expiresAt) : undefined,
    refreshAfter:
      typeof candidate.refreshAfter === 'number' ? Math.trunc(candidate.refreshAfter) : undefined,
  };
}

function normalizeAccountMetadata(
  value: unknown,
): ProviderAccountRecord['metadata'] | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as NonNullable<ProviderAccountRecord['metadata']>;
  const metadata = {
    quota: normalizeQuotaState(candidate.quota),
    rateLimit: normalizeRateLimitState(candidate.rateLimit),
    entitlement: normalizeEntitlementState(candidate.entitlement),
    session: normalizeSessionMetadata(candidate.session),
    lastErrorCode:
      typeof candidate.lastErrorCode === 'string' ? candidate.lastErrorCode : undefined,
    lastErrorAt:
      typeof candidate.lastErrorAt === 'number' ? Math.trunc(candidate.lastErrorAt) : undefined,
  };

  return Object.values(metadata).some((entry) => entry !== undefined) ? metadata : undefined;
}

function normalizeApiKeyRecord(value: unknown): ApiKeyAuthStoreRecord | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<ApiKeyAuthStoreRecord>;
  const credential = normalizeCredentialRecord(candidate.credential);
  if (
    typeof candidate.version !== 'number' ||
    candidate.authChoiceId !== 'api-key' ||
    candidate.authFamily !== 'api-key' ||
    candidate.authKind !== 'api-key' ||
    typeof candidate.secret !== 'string' ||
    !credential
  ) {
    return undefined;
  }

  return {
    version: Math.trunc(candidate.version),
    authChoiceId: 'api-key',
    authFamily: 'api-key',
    authKind: 'api-key',
    secret: candidate.secret,
    credential,
  };
}

function normalizeArtifactRecord(value: unknown): BrowserAccountArtifactStoreRecord | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<BrowserAccountArtifactStoreRecord>;
  if (
    typeof candidate.accountId !== 'string' ||
    candidate.authKind !== 'account-artifact' ||
    typeof candidate.value !== 'string' ||
    typeof candidate.updatedAt !== 'number'
  ) {
    return undefined;
  }

  return {
    accountId: candidate.accountId,
    authKind: 'account-artifact',
    value: candidate.value,
    updatedAt: Math.trunc(candidate.updatedAt),
    filename: typeof candidate.filename === 'string' ? candidate.filename : undefined,
    format:
      candidate.format === 'json' || candidate.format === 'text' || candidate.format === 'unknown'
        ? candidate.format
        : undefined,
  };
}

function normalizeBrowserAccountRecord(
  provider: AIProviderType,
  value: unknown,
): BrowserAccountAuthStoreRecord | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<BrowserAccountAuthStoreRecord>;
  if (
    typeof candidate.version !== 'number' ||
    candidate.authChoiceId !== 'browser-account' ||
    candidate.authFamily !== 'account-backed' ||
    candidate.authKind !== 'account-artifact' ||
    !Array.isArray(candidate.accounts) ||
    !candidate.artifacts ||
    typeof candidate.artifacts !== 'object'
  ) {
    return undefined;
  }

  const accounts = candidate.accounts.map(normalizeAccountRecord).filter(Boolean) as ProviderAccountRecord[];
  const artifacts = Object.fromEntries(
    Object.entries(candidate.artifacts)
      .map(([accountId, artifact]) => [accountId, normalizeArtifactRecord(artifact)])
      .filter((entry): entry is [string, BrowserAccountArtifactStoreRecord] => Boolean(entry[1])),
  );

  return {
    version: Math.trunc(candidate.version),
    authChoiceId: 'browser-account',
    authFamily: 'account-backed',
    authKind: 'account-artifact',
    credential: normalizeCredentialRecord(candidate.credential),
    accounts,
    activeAccountId:
      typeof candidate.activeAccountId === 'string' ? candidate.activeAccountId : undefined,
    browserLogin:
      provider === 'openai' ? normalizeBrowserLoginMetadata(candidate.browserLogin) : undefined,
    artifacts,
  };
}

function normalizeProviderAuthStore(
  provider: AIProviderType,
  value: unknown,
): ProviderAuthStore | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<ProviderAuthStore>;
  if (
    typeof candidate.version !== 'number' ||
    candidate.provider !== provider ||
    typeof candidate.updatedAt !== 'number'
  ) {
    return undefined;
  }

  return {
    version: Math.trunc(candidate.version),
    provider,
    providerFamily: isProviderFamily(candidate.providerFamily) ? candidate.providerFamily : undefined,
    updatedAt: Math.trunc(candidate.updatedAt),
    apiKey: normalizeApiKeyRecord(candidate.apiKey),
    browserAccount: normalizeBrowserAccountRecord(provider, candidate.browserAccount),
    migratedFromVaultAt:
      typeof candidate.migratedFromVaultAt === 'number'
        ? Math.trunc(candidate.migratedFromVaultAt)
        : undefined,
  };
}

export function createDefaultAuthStore(): AppManagedAuthStore {
  return {
    version: AUTH_STORE_VERSION,
    providers: {},
  };
}

export function normalizeAuthStore(value: unknown): AppManagedAuthStore {
  const defaults = createDefaultAuthStore();
  if (!value || typeof value !== 'object') {
    return defaults;
  }

  const candidate = value as Partial<AppManagedAuthStore>;
  const providers = Object.fromEntries(
    Object.entries(candidate.providers ?? {})
      .map(([provider, record]) => {
        if (!isProviderType(provider)) {
          return null;
        }

        return [provider, normalizeProviderAuthStore(provider, record)] as const;
      })
      .filter((entry): entry is readonly [AIProviderType, ProviderAuthStore] => Boolean(entry?.[1])),
  ) as Partial<Record<AIProviderType, ProviderAuthStore>>;

  return {
    version: typeof candidate.version === 'number' ? Math.trunc(candidate.version) : defaults.version,
    providers,
    migratedFromVaultAt:
      typeof candidate.migratedFromVaultAt === 'number'
        ? Math.trunc(candidate.migratedFromVaultAt)
        : undefined,
  };
}

export function createDefaultAuthStoreState(): AppManagedAuthStoreState {
  return {
    version: AUTH_STORE_VERSION,
    providers: {},
  };
}

function toBrowserLoginState(
  browserLogin: ProviderBrowserLoginMetadata | undefined,
): ProviderBrowserLoginState | undefined {
  if (!browserLogin) {
    return undefined;
  }

  return {
    ...browserLogin,
    status: browserLogin.status,
  };
}

export function toAuthStoreState(store: AppManagedAuthStore): AppManagedAuthStoreState {
  const normalized = normalizeAuthStore(store);

  return {
    version: normalized.version,
    migratedFromVaultAt: normalized.migratedFromVaultAt,
    providers: Object.fromEntries(
      Object.entries(normalized.providers).map(([provider, record]) => {
        const nextRecord: ProviderAuthStoreState = {
          version: record.version,
          provider: record.provider,
          providerFamily: record.providerFamily,
          updatedAt: record.updatedAt,
          migratedFromVaultAt: record.migratedFromVaultAt,
          ...(record.apiKey
            ? {
                apiKey: {
                  authChoiceId: 'api-key',
                  authFamily: 'api-key',
                  authKind: 'api-key',
                  credential: record.apiKey.credential,
                } satisfies ApiKeyAuthStoreState,
              }
            : {}),
          ...(record.browserAccount
            ? {
                browserAccount: {
                  authChoiceId: 'browser-account',
                  authFamily: 'account-backed',
                  authKind: 'account-artifact',
                  credential: record.browserAccount.credential,
                  accounts: record.browserAccount.accounts,
                  activeAccountId: record.browserAccount.activeAccountId,
                  browserLogin: toBrowserLoginState(record.browserAccount.browserLogin),
                } satisfies BrowserAccountAuthStoreState,
              }
            : {}),
        };

        return [provider, nextRecord];
      }),
    ) as Partial<Record<AIProviderType, ProviderAuthStoreState>>,
  };
}

export function hasAuthStoreData(store: AppManagedAuthStore): boolean {
  return Object.keys(store.providers).length > 0;
}
