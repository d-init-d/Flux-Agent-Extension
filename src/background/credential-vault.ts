import { createProvider } from '@core/ai-client/provider-loader';
import { SecureStorage } from '@shared/crypto/secure-storage';
import { ErrorCode, ExtensionError } from '@shared/errors';
import { PROVIDER_LOOKUP } from '@shared/config';
import type {
  AIProviderType,
  ProviderAccountRecord,
  ProviderAuthFamily,
  ProviderAuthKind,
  ProviderConfig,
  ProviderCredentialRecord,
  VaultMetadata,
  VaultState,
} from '@shared/types';

const VAULT_STORAGE_KEY = 'vault';
const LEGACY_LOCAL_SECRET_KEY = 'encryptedKeys';
const LEGACY_SESSION_SECRET_KEY = 'providerSessionApiKeys';
const VAULT_SESSION_KEY = '__flux_vault_session__';
const VAULT_SENTINEL_KEY = 'vault::sentinel';
const CREDENTIAL_KEY_PREFIX = 'credential::';
const ACCOUNT_ARTIFACT_KEY_PREFIX = 'account-artifact::';
const GENERIC_MASK = '************';

type StoredCredentialSecret = {
  provider: AIProviderType;
  authKind: ProviderAuthKind;
  secret: string;
  updatedAt: number;
};

type VaultSessionState = {
  passphrase: string;
  unlockedAt: number;
};

type StoredAccountArtifact = {
  provider: 'codex';
  accountId: string;
  authKind: Extract<ProviderAuthKind, 'account-artifact' | 'session-token'>;
  value: string;
  updatedAt: number;
  filename?: string;
  format?: 'json' | 'text' | 'unknown';
};

type AccountArtifactInput = {
  authKind?: Extract<ProviderAuthKind, 'account-artifact' | 'session-token'>;
  value: string;
  filename?: string;
  format?: 'json' | 'text' | 'unknown';
};

type SaveAccountInput = {
  accountId: string;
  label: string;
  maskedIdentifier?: string;
  status?: ProviderAccountRecord['status'];
  isActive?: boolean;
  validatedAt?: number;
  lastUsedAt?: number;
  stale?: boolean;
  metadata?: ProviderAccountRecord['metadata'];
  artifact?: AccountArtifactInput;
};

type ProviderQuotaMetadata = NonNullable<ProviderAccountRecord['metadata']>['quota'];

const DEFAULT_VAULT_METADATA: VaultMetadata = {
  version: 1,
  initialized: false,
  credentials: {},
  accounts: {},
  activeAccounts: {},
};

function isProviderType(value: unknown): value is AIProviderType {
  return typeof value === 'string' && value in PROVIDER_LOOKUP;
}

function normalizeCredentialRecord(value: unknown): ProviderCredentialRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<ProviderCredentialRecord>;
  const authFamily = normalizeAuthFamily(candidate.authFamily, candidate.authKind);
  if (
    typeof candidate.version !== 'number' ||
    !isProviderType(candidate.provider) ||
    !isProviderAuthKind(candidate.authKind) ||
    !authFamily ||
    typeof candidate.maskedValue !== 'string' ||
    typeof candidate.updatedAt !== 'number'
  ) {
    return null;
  }

  return {
    version: candidate.version,
    provider: candidate.provider,
    providerFamily: candidate.provider === 'codex' ? 'chatgpt-account' : 'default',
    authFamily,
    authKind: candidate.authKind,
    maskedValue: candidate.maskedValue,
    updatedAt: candidate.updatedAt,
    validatedAt: typeof candidate.validatedAt === 'number' ? candidate.validatedAt : undefined,
    stale: candidate.stale === true,
  };
}

function normalizeAccountRecord(value: unknown): ProviderAccountRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<ProviderAccountRecord>;
  if (
    typeof candidate.version !== 'number' ||
    candidate.provider !== 'codex' ||
    candidate.providerFamily !== 'chatgpt-account' ||
    candidate.authFamily !== 'account-backed' ||
    typeof candidate.accountId !== 'string' ||
    !candidate.accountId.trim() ||
    typeof candidate.label !== 'string' ||
    !candidate.label.trim() ||
    !isProviderAccountStatus(candidate.status) ||
    typeof candidate.updatedAt !== 'number'
  ) {
    return null;
  }

  return {
    version: candidate.version,
    provider: candidate.provider,
    providerFamily: candidate.providerFamily,
    authFamily: candidate.authFamily,
    accountId: candidate.accountId,
    label: candidate.label,
    maskedIdentifier:
      typeof candidate.maskedIdentifier === 'string' ? candidate.maskedIdentifier : undefined,
    credentialKey: typeof candidate.credentialKey === 'string' ? candidate.credentialKey : undefined,
    status: candidate.status,
    isActive: candidate.isActive === true,
    updatedAt: candidate.updatedAt,
    validatedAt: typeof candidate.validatedAt === 'number' ? candidate.validatedAt : undefined,
    lastUsedAt: typeof candidate.lastUsedAt === 'number' ? candidate.lastUsedAt : undefined,
    stale: candidate.stale === true,
    metadata:
      candidate.metadata && typeof candidate.metadata === 'object'
        ? (candidate.metadata as ProviderAccountRecord['metadata'])
        : undefined,
  };
}

function normalizeVaultMetadata(value: unknown): VaultMetadata {
  if (!value || typeof value !== 'object') {
    return DEFAULT_VAULT_METADATA;
  }

  const candidate = value as Partial<VaultMetadata>;
  const credentials: Partial<Record<AIProviderType, ProviderCredentialRecord>> = {};
  const accounts: Partial<Record<AIProviderType, ProviderAccountRecord[]>> = {};
  const activeAccounts: Partial<Record<AIProviderType, string>> = {};

  if (candidate.credentials && typeof candidate.credentials === 'object') {
    for (const [provider, record] of Object.entries(candidate.credentials)) {
      if (!isProviderType(provider)) {
        continue;
      }

      const normalizedRecord = normalizeCredentialRecord(record);
      if (normalizedRecord) {
        credentials[provider] = normalizedRecord;
      }
    }
  }

  if (candidate.accounts && typeof candidate.accounts === 'object') {
    for (const [provider, records] of Object.entries(candidate.accounts)) {
      if (!isProviderType(provider) || !Array.isArray(records)) {
        continue;
      }

      const normalizedRecords = records
        .map((record) => normalizeAccountRecord(record))
        .filter((record): record is ProviderAccountRecord => record !== null);

      if (normalizedRecords.length > 0) {
        accounts[provider] = normalizedRecords;
      }
    }
  }

  if (candidate.activeAccounts && typeof candidate.activeAccounts === 'object') {
    for (const [provider, accountId] of Object.entries(candidate.activeAccounts)) {
      if (isProviderType(provider) && typeof accountId === 'string' && accountId.trim()) {
        activeAccounts[provider] = accountId;
      }
    }
  }

  return {
    version: typeof candidate.version === 'number' ? candidate.version : DEFAULT_VAULT_METADATA.version,
    initialized: candidate.initialized === true,
    credentials,
    accounts,
    activeAccounts,
    migratedFromLegacyAt:
      typeof candidate.migratedFromLegacyAt === 'number' ? candidate.migratedFromLegacyAt : undefined,
  };
}

function cloneAccountMetadata(
  metadata: ProviderAccountRecord['metadata'],
): ProviderAccountRecord['metadata'] {
  if (!metadata) {
    return undefined;
  }

  return {
    ...metadata,
    quota: metadata.quota ? { ...metadata.quota } : undefined,
    rateLimit: metadata.rateLimit ? { ...metadata.rateLimit } : undefined,
    entitlement: metadata.entitlement
      ? {
          ...metadata.entitlement,
          features: metadata.entitlement.features ? [...metadata.entitlement.features] : undefined,
        }
      : undefined,
    session: metadata.session ? { ...metadata.session } : undefined,
  };
}

function cloneAccountRecord(account: ProviderAccountRecord): ProviderAccountRecord {
  return {
    ...account,
    metadata: cloneAccountMetadata(account.metadata),
  };
}

function buildCredentialRecord(
  provider: AIProviderType,
  authKind: ProviderAuthKind,
  updatedAt: number,
  maskedValue = GENERIC_MASK,
): ProviderCredentialRecord {
  const authFamily = getAuthFamilyForKind(authKind, provider);
  return {
    version: 1,
    provider,
    providerFamily: provider === 'codex' ? 'chatgpt-account' : 'default',
    authFamily,
    authKind,
    maskedValue,
    updatedAt,
  };
}

function isProviderAuthKind(value: unknown): value is ProviderAuthKind {
  return (
    value === 'api-key' ||
    value === 'oauth-token' ||
    value === 'account-artifact' ||
    value === 'session-token' ||
    value === 'none'
  );
}

function isProviderAccountStatus(value: unknown): value is ProviderAccountRecord['status'] {
  return (
    value === 'active' ||
    value === 'available' ||
    value === 'needs-auth' ||
    value === 'revoked' ||
    value === 'error' ||
    value === 'unknown'
  );
}

function getAuthFamilyForKind(
  authKind: ProviderAuthKind,
  provider: AIProviderType,
): ProviderAuthFamily {
  switch (authKind) {
    case 'api-key':
      return 'api-key';
    case 'oauth-token':
      return 'oauth-token';
    case 'account-artifact':
    case 'session-token':
      return provider === 'codex' ? 'account-backed' : 'none';
    case 'none':
      return 'none';
  }
}

function normalizeAuthFamily(
  authFamily: ProviderCredentialRecord['authFamily'] | undefined,
  authKind: ProviderAuthKind | undefined,
): ProviderAuthFamily | null {
  if (authFamily === 'api-key' || authFamily === 'oauth-token' || authFamily === 'account-backed' || authFamily === 'none') {
    return authFamily;
  }

  if (!authKind) {
    return null;
  }

  switch (authKind) {
    case 'api-key':
      return 'api-key';
    case 'oauth-token':
      return 'oauth-token';
    case 'account-artifact':
    case 'session-token':
      return 'account-backed';
    case 'none':
      return 'none';
  }
}

function buildMaskedValue(
  provider: AIProviderType,
  secret: string,
  fallbackMask = GENERIC_MASK,
): string {
  if (!secret) {
    return fallbackMask;
  }

  if (provider === 'copilot') {
    return `ghu_****${secret.slice(-4)}`;
  }

  if (provider === 'codex') {
    return secret.length > 8 ? `acct_****${secret.slice(-4)}` : fallbackMask;
  }

  return fallbackMask;
}

export class CredentialVault {
  private activePassphrase: string | null = null;
  private unlockedAt: number | undefined;

  async init(passphrase: string): Promise<VaultState> {
    return this.unlock(passphrase, true);
  }

  async unlock(passphrase: string, initializeIfNeeded = false): Promise<VaultState> {
    if (!passphrase.trim()) {
      throw new ExtensionError(ErrorCode.AI_INVALID_KEY, 'Vault passphrase is required', true);
    }

    const secureStorage = new SecureStorage(passphrase.trim());
    const metadata = await this.getMetadata();

    if (metadata.initialized) {
      try {
        await secureStorage.getEncrypted<string>(VAULT_SENTINEL_KEY);
      } catch (error) {
        throw new ExtensionError(
          ErrorCode.AI_INVALID_KEY,
          'Vault passphrase is incorrect',
          true,
          { originalError: error instanceof Error ? error.message : String(error) },
        );
      }
    } else if (initializeIfNeeded) {
      await secureStorage.setEncrypted(VAULT_SENTINEL_KEY, 'flux-agent-vault');
      metadata.initialized = true;
      await this.saveMetadata(metadata);
    }

    this.activePassphrase = passphrase.trim();
    this.unlockedAt = Date.now();
    await chrome.storage.session.set({
      [VAULT_SESSION_KEY]: {
        passphrase: this.activePassphrase,
        unlockedAt: this.unlockedAt,
      } satisfies VaultSessionState,
    });

    await this.migrateLegacySecrets(secureStorage, metadata);
    return this.getState();
  }

  async lock(): Promise<VaultState> {
    this.activePassphrase = null;
    this.unlockedAt = undefined;
    await chrome.storage.session.remove(VAULT_SESSION_KEY);
    return this.getState();
  }

  async getState(): Promise<VaultState> {
    const metadata = await this.getMetadata();
    const sessionState = await this.getSessionState();
    const hasLegacySecrets = await this.hasLegacySecrets();
    const lockState = metadata.initialized
      ? sessionState
        ? 'unlocked'
        : 'locked'
      : 'uninitialized';

    if (sessionState) {
      this.activePassphrase = sessionState.passphrase;
      this.unlockedAt = sessionState.unlockedAt;
    }

    return {
      version: metadata.version,
      initialized: metadata.initialized,
      lockState,
      unlockedAt: lockState === 'unlocked' ? this.unlockedAt : undefined,
      hasLegacySecrets,
      credentials: metadata.credentials,
      accounts: metadata.accounts,
      activeAccounts: metadata.activeAccounts,
    };
  }

  async setCredential(
    provider: AIProviderType,
    secret: string,
    authKind: ProviderAuthKind = 'api-key',
    maskedValue?: string,
  ): Promise<ProviderCredentialRecord> {
    if (!secret.trim()) {
      throw new ExtensionError(ErrorCode.AI_INVALID_KEY, 'Credential value is required', true);
    }

    const secureStorage = await this.requireUnlockedStorage();
    const metadata = await this.getMetadata();
    const updatedAt = Date.now();
    const record = buildCredentialRecord(
      provider,
      authKind,
      updatedAt,
      maskedValue ?? buildMaskedValue(provider, secret),
    );

    await secureStorage.setEncrypted(this.getCredentialStorageKey(provider), {
      provider,
      authKind,
      secret: secret.trim(),
      updatedAt,
    } satisfies StoredCredentialSecret);

    metadata.credentials[provider] = record;
    if (!metadata.initialized) {
      metadata.initialized = true;
    }
    await this.saveMetadata(metadata);

    return record;
  }

  async deleteCredential(provider: AIProviderType): Promise<VaultState> {
    const secureStorage = await this.requireUnlockedStorage();
    const metadata = await this.getMetadata();

    await secureStorage.removeEncrypted(this.getCredentialStorageKey(provider));
    delete metadata.credentials[provider];
    await this.saveMetadata(metadata);

    return this.getState();
  }

  async getCredential(provider: AIProviderType): Promise<string | null> {
    const secureStorage = await this.requireUnlockedStorage();
    const stored = await secureStorage.getEncrypted<StoredCredentialSecret>(
      this.getCredentialStorageKey(provider),
    );

    return stored?.secret ?? null;
  }

  async listAccounts(provider: AIProviderType): Promise<ProviderAccountRecord[]> {
    const metadata = await this.getMetadata();
    return (metadata.accounts[provider] ?? []).map((account) => cloneAccountRecord(account));
  }

  async getAccount(
    provider: AIProviderType,
    accountId: string,
  ): Promise<ProviderAccountRecord | null> {
    const normalizedAccountId = accountId.trim();
    if (!normalizedAccountId) {
      return null;
    }

    const metadata = await this.getMetadata();
    const account = (metadata.accounts[provider] ?? []).find(
      (candidate) => candidate.accountId === normalizedAccountId,
    );

    return account ? cloneAccountRecord(account) : null;
  }

  async saveAccount(
    provider: AIProviderType,
    input: SaveAccountInput,
  ): Promise<ProviderAccountRecord> {
    if (provider !== 'codex') {
      throw new ExtensionError(
        ErrorCode.ACTION_INVALID,
        `Provider ${provider} does not support account-backed storage yet`,
        true,
      );
    }

    const accountId = input.accountId.trim();
    const label = input.label.trim();
    if (!accountId || !label) {
      throw new ExtensionError(
        ErrorCode.ACTION_INVALID,
        'Account id and label are required',
        true,
      );
    }

    const metadata = await this.getMetadata();
    const now = Date.now();
    const providerAccounts = [...(metadata.accounts[provider] ?? [])];
    const existingIndex = providerAccounts.findIndex((account) => account.accountId === accountId);
    const existingAccount = existingIndex >= 0 ? providerAccounts[existingIndex] : undefined;

    let credentialKey = existingAccount?.credentialKey;
    if (provider === 'codex' && input.artifact?.value.trim()) {
      const secureStorage = await this.requireUnlockedStorage();
      credentialKey = this.getAccountArtifactStorageKey(provider, accountId);
      await secureStorage.setEncrypted(credentialKey, {
        provider,
        accountId,
        authKind: input.artifact.authKind ?? 'account-artifact',
        value: input.artifact.value.trim(),
        filename: input.artifact.filename?.trim() || undefined,
        format: input.artifact.format ?? 'unknown',
        updatedAt: now,
      } satisfies StoredAccountArtifact);
    }

    const nextAccount: ProviderAccountRecord = {
      version: 1,
      provider,
      providerFamily: 'chatgpt-account',
      authFamily: 'account-backed',
      accountId,
      label,
      maskedIdentifier: input.maskedIdentifier?.trim() || existingAccount?.maskedIdentifier,
      credentialKey,
      status: input.status ?? existingAccount?.status ?? 'available',
      isActive: input.isActive ?? existingAccount?.isActive ?? false,
      updatedAt: now,
      validatedAt: input.validatedAt ?? existingAccount?.validatedAt,
      lastUsedAt: input.lastUsedAt ?? existingAccount?.lastUsedAt,
      stale: input.stale ?? existingAccount?.stale,
      metadata:
        input.metadata !== undefined
          ? cloneAccountMetadata(input.metadata)
          : cloneAccountMetadata(existingAccount?.metadata),
    };

    if (existingIndex >= 0) {
      providerAccounts[existingIndex] = nextAccount;
    } else {
      providerAccounts.push(nextAccount);
    }

    if (nextAccount.isActive) {
      metadata.activeAccounts[provider] = accountId;
      for (let index = 0; index < providerAccounts.length; index += 1) {
        const current = providerAccounts[index];
        providerAccounts[index] = {
          ...current,
          isActive: current.accountId === accountId,
          status:
            current.accountId === accountId
              ? 'active'
              : current.status === 'active'
                ? 'available'
                : current.status,
        };
      }
    } else if (metadata.activeAccounts[provider] === accountId) {
      metadata.activeAccounts[provider] = accountId;
    }

    metadata.accounts[provider] = providerAccounts;
    if (!metadata.initialized) {
      metadata.initialized = true;
    }
    await this.saveMetadata(metadata);

    const savedAccount = providerAccounts.find((account) => account.accountId === accountId);
    if (!savedAccount) {
      throw new ExtensionError(ErrorCode.STORAGE_WRITE_ERROR, 'Failed to save account metadata', true);
    }

    return cloneAccountRecord(savedAccount);
  }

  async activateAccount(
    provider: AIProviderType,
    accountId: string,
  ): Promise<ProviderAccountRecord> {
    const normalizedAccountId = accountId.trim();
    if (!normalizedAccountId) {
      throw new ExtensionError(ErrorCode.ACTION_INVALID, 'Account id is required', true);
    }

    const metadata = await this.getMetadata();
    const providerAccounts = [...(metadata.accounts[provider] ?? [])];
    const target = providerAccounts.find((account) => account.accountId === normalizedAccountId);
    if (!target) {
      throw new ExtensionError(
        ErrorCode.ACTION_INVALID,
        `Account "${normalizedAccountId}" was not found`,
        true,
      );
    }
    if (target.status === 'revoked') {
      throw new ExtensionError(
        ErrorCode.ACTION_INVALID,
        `Account "${normalizedAccountId}" is revoked and cannot be activated`,
        true,
      );
    }

    const now = Date.now();
    metadata.accounts[provider] = providerAccounts.map((account) => ({
      ...account,
      isActive: account.accountId === normalizedAccountId,
      status:
        account.accountId === normalizedAccountId
          ? 'active'
          : account.status === 'active'
            ? 'available'
            : account.status,
      lastUsedAt: account.accountId === normalizedAccountId ? now : account.lastUsedAt,
      stale: account.accountId === normalizedAccountId ? false : account.stale,
      updatedAt: account.accountId === normalizedAccountId ? now : account.updatedAt,
    }));
    metadata.activeAccounts[provider] = normalizedAccountId;
    await this.saveMetadata(metadata);

    const activated = metadata.accounts[provider]?.find(
      (account) => account.accountId === normalizedAccountId,
    );
    if (!activated) {
      throw new ExtensionError(ErrorCode.STORAGE_WRITE_ERROR, 'Failed to activate account', true);
    }

    return cloneAccountRecord(activated);
  }

  async removeAccount(provider: AIProviderType, accountId: string): Promise<boolean> {
    const normalizedAccountId = accountId.trim();
    if (!normalizedAccountId) {
      return false;
    }

    const metadata = await this.getMetadata();
    const providerAccounts = metadata.accounts[provider] ?? [];
    const account = providerAccounts.find((candidate) => candidate.accountId === normalizedAccountId);
    if (!account) {
      return false;
    }

    if (account.credentialKey) {
      const secureStorage = await this.requireUnlockedStorage();
      await secureStorage.removeEncrypted(account.credentialKey);
    }

    const nextAccounts = providerAccounts.filter(
      (candidate) => candidate.accountId !== normalizedAccountId,
    );
    if (nextAccounts.length > 0) {
      metadata.accounts[provider] = nextAccounts;
    } else {
      delete metadata.accounts[provider];
    }

    if (metadata.activeAccounts[provider] === normalizedAccountId) {
      delete metadata.activeAccounts[provider];
      const fallbackAccount = nextAccounts[0];
      if (fallbackAccount) {
        fallbackAccount.isActive = true;
        fallbackAccount.status = fallbackAccount.status === 'revoked' ? 'needs-auth' : 'active';
        fallbackAccount.updatedAt = Date.now();
        metadata.activeAccounts[provider] = fallbackAccount.accountId;
      }
    }

    await this.saveMetadata(metadata);
    return true;
  }

  async revokeAccount(
    provider: AIProviderType,
    accountId: string,
    options?: { revokeCredential?: boolean },
  ): Promise<ProviderAccountRecord | null> {
    const normalizedAccountId = accountId.trim();
    if (!normalizedAccountId) {
      return null;
    }

    const metadata = await this.getMetadata();
    const providerAccounts = [...(metadata.accounts[provider] ?? [])];
    const targetIndex = providerAccounts.findIndex(
      (candidate) => candidate.accountId === normalizedAccountId,
    );
    if (targetIndex < 0) {
      return null;
    }

    const current = providerAccounts[targetIndex];
    const now = Date.now();
    let credentialKey = current.credentialKey;
    if (options?.revokeCredential && credentialKey) {
      const secureStorage = await this.requireUnlockedStorage();
      await secureStorage.removeEncrypted(credentialKey);
      credentialKey = undefined;
    }

    const revokedAccount: ProviderAccountRecord = {
      ...current,
      credentialKey,
      status: 'revoked',
      isActive: false,
      stale: true,
      validatedAt: undefined,
      updatedAt: now,
      metadata: {
        ...cloneAccountMetadata(current.metadata),
        lastErrorCode: options?.revokeCredential ? 'ACCOUNT_REVOKED_CREDENTIAL_REMOVED' : 'ACCOUNT_REVOKED',
        lastErrorAt: now,
      },
    };
    providerAccounts[targetIndex] = revokedAccount;
    metadata.accounts[provider] = providerAccounts;

    if (metadata.activeAccounts[provider] === normalizedAccountId) {
      delete metadata.activeAccounts[provider];
    }

    await this.saveMetadata(metadata);
    return cloneAccountRecord(revokedAccount);
  }

  async getQuotaMetadata(
    provider: AIProviderType,
    accountId: string,
  ): Promise<ProviderQuotaMetadata | undefined> {
    const account = await this.getAccount(provider, accountId);
    return account?.metadata?.quota ? { ...account.metadata.quota } : undefined;
  }

  async setQuotaMetadata(
    provider: AIProviderType,
    accountId: string,
    quota: ProviderQuotaMetadata,
  ): Promise<ProviderAccountRecord | null> {
    const normalizedAccountId = accountId.trim();
    if (!normalizedAccountId) {
      return null;
    }

    const metadata = await this.getMetadata();
    const providerAccounts = [...(metadata.accounts[provider] ?? [])];
    const targetIndex = providerAccounts.findIndex(
      (candidate) => candidate.accountId === normalizedAccountId,
    );
    if (targetIndex < 0) {
      return null;
    }

    const current = providerAccounts[targetIndex];
    const nextAccount: ProviderAccountRecord = {
      ...current,
      updatedAt: Date.now(),
      metadata: {
        ...cloneAccountMetadata(current.metadata),
        quota: quota ? { ...quota } : undefined,
      },
    };
    providerAccounts[targetIndex] = nextAccount;
    metadata.accounts[provider] = providerAccounts;
    await this.saveMetadata(metadata);

    return cloneAccountRecord(nextAccount);
  }

  async markValidated(provider: AIProviderType): Promise<ProviderCredentialRecord | undefined> {
    const metadata = await this.getMetadata();
    const current = metadata.credentials[provider];
    if (!current) {
      return undefined;
    }

    const nextRecord: ProviderCredentialRecord = {
      ...current,
      validatedAt: Date.now(),
      stale: false,
    };
    metadata.credentials[provider] = nextRecord;
    await this.saveMetadata(metadata);
    return nextRecord;
  }

  async markCredentialStale(provider: AIProviderType): Promise<void> {
    const metadata = await this.getMetadata();
    const current = metadata.credentials[provider];
    if (!current) {
      return;
    }

    metadata.credentials[provider] = {
      ...current,
      stale: true,
      validatedAt: undefined,
    };
    await this.saveMetadata(metadata);
  }

  async validateCredential(
    provider: AIProviderType,
    config: ProviderConfig,
    credential?: string | null,
  ): Promise<boolean> {
    const providerDefinition = PROVIDER_LOOKUP[provider];

    if (!providerDefinition.requiresCredential) {
      if (provider === 'custom') {
        return Boolean(config.customEndpoint?.trim());
      }

      if (provider === 'ollama') {
        const client = await createProvider('ollama');
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

    const secret = credential?.trim() || (await this.getCredential(provider));
    if (!secret) {
      return false;
    }

    if (provider === 'codex') {
      return true;
    }

    const client = provider === 'custom' ? null : await createProvider(provider as Exclude<AIProviderType, 'custom'>);
    if (!client) {
      return Boolean(config.customEndpoint?.trim());
    }

    await client.initialize({
      provider,
      model: config.model,
      apiKey: secret,
      baseUrl: config.customEndpoint?.trim() || undefined,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
    });

    return client.validateApiKey(secret);
  }

  private async getMetadata(): Promise<VaultMetadata> {
    const stored = await chrome.storage.local.get({
      [VAULT_STORAGE_KEY]: DEFAULT_VAULT_METADATA,
    });

    return normalizeVaultMetadata(stored[VAULT_STORAGE_KEY]);
  }

  private async saveMetadata(metadata: VaultMetadata): Promise<void> {
    await chrome.storage.local.set({
      [VAULT_STORAGE_KEY]: metadata,
    });
  }

  private async getSessionState(): Promise<VaultSessionState | null> {
    const stored = await chrome.storage.session.get(VAULT_SESSION_KEY);
    const sessionState = stored[VAULT_SESSION_KEY];
    if (!sessionState || typeof sessionState !== 'object') {
      return null;
    }

    const candidate = sessionState as Partial<VaultSessionState>;
    if (typeof candidate.passphrase !== 'string' || typeof candidate.unlockedAt !== 'number') {
      return null;
    }

    return {
      passphrase: candidate.passphrase,
      unlockedAt: candidate.unlockedAt,
    };
  }

  private async requireUnlockedStorage(): Promise<SecureStorage> {
    if (!this.activePassphrase) {
      const sessionState = await this.getSessionState();
      if (sessionState) {
        this.activePassphrase = sessionState.passphrase;
        this.unlockedAt = sessionState.unlockedAt;
      }
    }

    if (!this.activePassphrase) {
      throw new ExtensionError(
        ErrorCode.AI_INVALID_KEY,
        'Vault is locked. Unlock it before accessing credentials.',
        true,
      );
    }

    return new SecureStorage(this.activePassphrase);
  }

  private async hasLegacySecrets(): Promise<boolean> {
    const [localSecrets, sessionSecrets] = await Promise.all([
      chrome.storage.local.get(LEGACY_LOCAL_SECRET_KEY),
      chrome.storage.session.get(LEGACY_SESSION_SECRET_KEY),
    ]);

    return Boolean(localSecrets[LEGACY_LOCAL_SECRET_KEY] || sessionSecrets[LEGACY_SESSION_SECRET_KEY]);
  }

  private getCredentialStorageKey(provider: AIProviderType): string {
    return `${CREDENTIAL_KEY_PREFIX}${provider}`;
  }

  private getAccountArtifactStorageKey(provider: AIProviderType, accountId: string): string {
    return `${ACCOUNT_ARTIFACT_KEY_PREFIX}${provider}::${accountId}`;
  }

  private async migrateLegacySecrets(
    secureStorage: SecureStorage,
    metadata: VaultMetadata,
  ): Promise<void> {
    const [localSecretsResult, sessionSecretsResult] = await Promise.all([
      chrome.storage.local.get([LEGACY_LOCAL_SECRET_KEY, 'providerKeyMetadata']),
      chrome.storage.session.get(LEGACY_SESSION_SECRET_KEY),
    ]);

    const localSecrets = localSecretsResult[LEGACY_LOCAL_SECRET_KEY];
    const sessionSecrets = sessionSecretsResult[LEGACY_SESSION_SECRET_KEY];
    const legacyMetadata = localSecretsResult['providerKeyMetadata'];
    const mergedSecrets = [localSecrets, sessionSecrets]
      .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object'))
      .reduce<Record<string, string>>((accumulator, value) => {
        for (const [provider, secret] of Object.entries(value)) {
          if (isProviderType(provider) && typeof secret === 'string' && secret.trim()) {
            accumulator[provider] = secret.trim();
          }
        }
        return accumulator;
      }, {});

    if (Object.keys(mergedSecrets).length === 0) {
      return;
    }

    const now = Date.now();
    for (const [provider, secret] of Object.entries(mergedSecrets) as Array<[AIProviderType, string]>) {
      const authKind: ProviderAuthKind = provider === 'copilot' ? 'oauth-token' : 'api-key';
      const legacyRecord =
        legacyMetadata && typeof legacyMetadata === 'object'
          ? (legacyMetadata as Record<string, unknown>)[provider]
          : undefined;
      const maskedValue =
        legacyRecord && typeof legacyRecord === 'object' && typeof (legacyRecord as { maskedValue?: unknown }).maskedValue === 'string'
          ? ((legacyRecord as { maskedValue: string }).maskedValue)
          : buildMaskedValue(provider, secret);

      await secureStorage.setEncrypted(this.getCredentialStorageKey(provider), {
        provider,
        authKind,
        secret,
        updatedAt: now,
      } satisfies StoredCredentialSecret);

      metadata.credentials[provider] = buildCredentialRecord(provider, authKind, now, maskedValue);
    }

    metadata.initialized = true;
    metadata.migratedFromLegacyAt = now;
    await this.saveMetadata(metadata);
    await Promise.all([
      chrome.storage.local.remove(LEGACY_LOCAL_SECRET_KEY),
      chrome.storage.session.remove(LEGACY_SESSION_SECRET_KEY),
    ]);
  }
}
