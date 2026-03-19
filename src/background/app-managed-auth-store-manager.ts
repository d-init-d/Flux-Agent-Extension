import { PROVIDER_LOOKUP, providerSupportsAccountBackedAuth } from '@shared/config';
import {
  AUTH_STORE_STORAGE_KEY,
  createDefaultAuthStore,
  normalizeAuthStore,
  toAuthStoreState,
} from '@shared/storage/auth-store';
import type {
  AIProviderFamily,
  AIProviderType,
  AppManagedAuthStore,
  AppManagedAuthStoreState,
  BrowserAccountArtifactStoreRecord,
  BrowserLoginPendingState,
  ProviderAccountRecord,
  ProviderAuthKind,
  ProviderBrowserLoginMetadata,
  ProviderBrowserLoginState,
  ProviderCredentialRecord,
} from '@shared/types';

const AUTH_STORE_PENDING_SESSION_KEY = '__flux_auth_store_browser_login_session__';

type StoredBrowserLoginAttempt = {
  provider: AIProviderType;
  authMethod: 'browser-account';
  requestId: string;
  state: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  updatedAt: number;
  uiContext?: 'options' | 'onboarding' | 'unknown';
};

type SaveBrowserAccountInput = {
  credential?: ProviderCredentialRecord;
  accounts: ProviderAccountRecord[];
  activeAccountId?: string;
  browserLogin?: ProviderBrowserLoginMetadata;
  artifacts?: Record<string, BrowserAccountArtifactStoreRecord>;
};

function resolveProviderFamily(provider: AIProviderType): AIProviderFamily {
  return provider === 'codex' ? 'chatgpt-account' : 'default';
}

function isProviderType(value: unknown): value is AIProviderType {
  return typeof value === 'string' && value in PROVIDER_LOOKUP;
}

function supportsBrowserLoginProvider(provider: AIProviderType): boolean {
  return provider === 'openai';
}

function cloneArtifact(
  artifact: BrowserAccountArtifactStoreRecord,
): BrowserAccountArtifactStoreRecord {
  return {
    ...artifact,
  };
}

export class AppManagedAuthStoreManager {
  async getStore(): Promise<AppManagedAuthStore> {
    const stored = await chrome.storage.local.get(AUTH_STORE_STORAGE_KEY);
    return normalizeAuthStore(stored[AUTH_STORE_STORAGE_KEY]);
  }

  async getProviderStore(provider: AIProviderType) {
    return (await this.getStore()).providers[provider];
  }

  async hasProviderStore(provider: AIProviderType): Promise<boolean> {
    return Boolean((await this.getStore()).providers[provider]);
  }

  async getState(): Promise<AppManagedAuthStoreState> {
    const state = toAuthStoreState(await this.getStore());
    const pendingAttempts = await this.getBrowserLoginAttempts();

    for (const [provider, pending] of Object.entries(pendingAttempts)) {
      if (!isProviderType(provider) || !supportsBrowserLoginProvider(provider)) {
        continue;
      }

      const existing = state.providers[provider];
      if (!existing) {
        state.providers[provider] = {
          version: 1,
          provider,
          providerFamily: resolveProviderFamily(provider),
          updatedAt: pending.updatedAt,
          browserAccount: {
            authChoiceId: 'browser-account',
            authFamily: 'account-backed',
            authKind: 'account-artifact',
            accounts: [],
            browserLogin: {
              authMethod: 'browser-account',
              status: 'pending',
              updatedAt: pending.updatedAt,
              pending: {
                requestId: pending.requestId,
                issuedAt: pending.issuedAt,
                expiresAt: pending.expiresAt,
                uiContext: pending.uiContext,
              },
            },
          },
        };
        continue;
      }

      state.providers[provider] = {
        ...existing,
        browserAccount: {
          authChoiceId: 'browser-account',
          authFamily: 'account-backed',
          authKind: 'account-artifact',
          accounts: existing.browserAccount?.accounts ?? [],
          activeAccountId: existing.browserAccount?.activeAccountId,
          credential: existing.browserAccount?.credential,
          browserLogin: {
            ...(existing.browserAccount?.browserLogin ?? {}),
            authMethod: 'browser-account',
            status: 'pending',
            updatedAt: pending.updatedAt,
            pending: {
              requestId: pending.requestId,
              issuedAt: pending.issuedAt,
              expiresAt: pending.expiresAt,
              uiContext: pending.uiContext,
            },
          } as ProviderBrowserLoginState,
        },
      };
    }

    return state;
  }

  async setApiKey(
    provider: AIProviderType,
    secret: string,
    credential: ProviderCredentialRecord,
  ): Promise<AppManagedAuthStoreState> {
    const store = await this.getStore();
    const current = store.providers[provider];
    store.providers[provider] = {
      version: current?.version ?? 1,
      provider,
      providerFamily: current?.providerFamily ?? resolveProviderFamily(provider),
      updatedAt: credential.updatedAt,
      migratedFromVaultAt: current?.migratedFromVaultAt,
      apiKey: {
        version: 1,
        authChoiceId: 'api-key',
        authFamily: 'api-key',
        authKind: 'api-key',
        secret,
        credential,
      },
      browserAccount: current?.browserAccount,
    };
    await this.saveStore(store);
    return this.getState();
  }

  async deleteApiKey(provider: AIProviderType): Promise<AppManagedAuthStoreState> {
    const store = await this.getStore();
    const current = store.providers[provider];
    if (!current) {
      store.providers[provider] = {
        version: 1,
        provider,
        providerFamily: resolveProviderFamily(provider),
        updatedAt: Date.now(),
      };
      await this.saveStore(store);
      return this.getState();
    }

    if (current.browserAccount) {
      store.providers[provider] = {
        ...current,
        apiKey: undefined,
        updatedAt: Date.now(),
      };
    } else {
      store.providers[provider] = {
        version: current.version,
        provider,
        providerFamily: current.providerFamily,
        updatedAt: Date.now(),
        migratedFromVaultAt: current.migratedFromVaultAt,
      };
    }

    await this.saveStore(store);
    return this.getState();
  }

  async getApiKey(provider: AIProviderType): Promise<string | null> {
    return (await this.getStore()).providers[provider]?.apiKey?.secret ?? null;
  }

  async getApiKeyRecord(provider: AIProviderType): Promise<ProviderCredentialRecord | undefined> {
    return (await this.getStore()).providers[provider]?.apiKey?.credential;
  }

  async markApiKeyValidated(provider: AIProviderType): Promise<ProviderCredentialRecord | undefined> {
    const store = await this.getStore();
    const current = store.providers[provider]?.apiKey;
    if (!current) {
      return undefined;
    }

    const nextCredential: ProviderCredentialRecord = {
      ...current.credential,
      validatedAt: Date.now(),
      stale: false,
    };
    store.providers[provider] = {
      ...store.providers[provider]!,
      updatedAt: nextCredential.updatedAt,
      apiKey: {
        ...current,
        credential: nextCredential,
      },
    };
    await this.saveStore(store);
    return nextCredential;
  }

  async markApiKeyStale(provider: AIProviderType): Promise<ProviderCredentialRecord | undefined> {
    const store = await this.getStore();
    const current = store.providers[provider]?.apiKey;
    if (!current) {
      return undefined;
    }

    const nextCredential: ProviderCredentialRecord = {
      ...current.credential,
      validatedAt: undefined,
      stale: true,
    };
    store.providers[provider] = {
      ...store.providers[provider]!,
      updatedAt: nextCredential.updatedAt,
      apiKey: {
        ...current,
        credential: nextCredential,
      },
    };
    await this.saveStore(store);
    return nextCredential;
  }

  async saveBrowserAccount(
    provider: AIProviderType,
    input: SaveBrowserAccountInput,
  ): Promise<AppManagedAuthStoreState> {
    if (!providerSupportsAccountBackedAuth(provider)) {
      throw new Error(`Provider ${provider} does not support account-backed auth`);
    }

    const store = await this.getStore();
    const current = store.providers[provider];
    store.providers[provider] = {
      version: current?.version ?? 1,
      provider,
      providerFamily: current?.providerFamily ?? resolveProviderFamily(provider),
      updatedAt: Date.now(),
      migratedFromVaultAt: current?.migratedFromVaultAt,
      apiKey: current?.apiKey,
      browserAccount: {
        version: 1,
        authChoiceId: 'browser-account',
        authFamily: 'account-backed',
        authKind: 'account-artifact',
        credential: input.credential,
        accounts: input.accounts,
        activeAccountId: input.activeAccountId,
        browserLogin: supportsBrowserLoginProvider(provider) ? input.browserLogin : undefined,
        artifacts: Object.fromEntries(
          Object.entries(input.artifacts ?? {}).map(([accountId, artifact]) => [
            accountId,
            cloneArtifact(artifact),
          ]),
        ),
      },
    };
    await this.saveStore(store);
    return this.getState();
  }

  async getBrowserAccountArtifact(
    provider: AIProviderType,
    accountId: string,
  ): Promise<BrowserAccountArtifactStoreRecord | null> {
    const store = await this.getStore();
    return store.providers[provider]?.browserAccount?.artifacts[accountId] ?? null;
  }

  async removeBrowserAccount(provider: AIProviderType, accountId: string): Promise<AppManagedAuthStoreState> {
    const store = await this.getStore();
    const current = store.providers[provider]?.browserAccount;
    if (!current) {
      return this.getState();
    }

    const nextArtifacts = { ...current.artifacts };
    delete nextArtifacts[accountId];

    const nextAccounts = current.accounts.filter((account) => account.accountId !== accountId);
    const nextActiveAccountId =
      current.activeAccountId === accountId ? nextAccounts[0]?.accountId : current.activeAccountId;

    if (!nextAccounts.length && !Object.keys(nextArtifacts).length) {
      const providerRecord = store.providers[provider];
      if (providerRecord?.apiKey) {
        store.providers[provider] = {
          ...providerRecord,
          browserAccount: undefined,
        };
      } else {
        delete store.providers[provider];
      }
    } else {
      store.providers[provider] = {
        ...store.providers[provider]!,
        browserAccount: {
          ...current,
          accounts: nextAccounts,
          activeAccountId: nextActiveAccountId,
          artifacts: nextArtifacts,
        },
      };
    }

    await this.saveStore(store);
    return this.getState();
  }

  async clearProviderStore(provider: AIProviderType): Promise<AppManagedAuthStoreState> {
    const store = await this.getStore();
    delete store.providers[provider];
    await this.saveStore(store);
    await this.clearBrowserLoginPending(provider);
    return this.getState();
  }

  async setBrowserLoginPending(
    provider: AIProviderType,
    pending: StoredBrowserLoginAttempt,
  ): Promise<AppManagedAuthStoreState> {
    if (!supportsBrowserLoginProvider(provider)) {
      throw new Error(`Provider ${provider} does not support browser-login auth`);
    }

    const attempts = await this.getBrowserLoginAttempts();
    attempts[provider] = pending;
    await chrome.storage.session.set({
      [AUTH_STORE_PENDING_SESSION_KEY]: attempts,
    });
    return this.getState();
  }

  async clearBrowserLoginPending(provider: AIProviderType): Promise<AppManagedAuthStoreState> {
    const attempts = await this.getBrowserLoginAttempts();
    delete attempts[provider];
    if (Object.keys(attempts).length) {
      await chrome.storage.session.set({
        [AUTH_STORE_PENDING_SESSION_KEY]: attempts,
      });
    } else {
      await chrome.storage.session.remove(AUTH_STORE_PENDING_SESSION_KEY);
    }
    return this.getState();
  }

  async setBrowserLoginResult(
    provider: AIProviderType,
    browserLogin: ProviderBrowserLoginMetadata,
  ): Promise<AppManagedAuthStoreState> {
    if (!supportsBrowserLoginProvider(provider)) {
      throw new Error(`Provider ${provider} does not support browser-login auth`);
    }

    const store = await this.getStore();
    const current = store.providers[provider];
    store.providers[provider] = {
      version: current?.version ?? 1,
      provider,
      providerFamily: current?.providerFamily ?? resolveProviderFamily(provider),
      updatedAt: browserLogin.updatedAt,
      migratedFromVaultAt: current?.migratedFromVaultAt,
      apiKey: current?.apiKey,
      browserAccount: {
        version: current?.browserAccount?.version ?? 1,
        authChoiceId: 'browser-account',
        authFamily: 'account-backed',
        authKind: 'account-artifact',
        credential: current?.browserAccount?.credential,
        accounts: current?.browserAccount?.accounts ?? [],
        activeAccountId: current?.browserAccount?.activeAccountId,
        artifacts: current?.browserAccount?.artifacts ?? {},
        browserLogin,
      },
    };
    await this.saveStore(store);
    await this.clearBrowserLoginPending(provider);
    return this.getState();
  }

  private async saveStore(store: AppManagedAuthStore): Promise<void> {
    await chrome.storage.local.set({
      [AUTH_STORE_STORAGE_KEY]: store,
    });
  }

  private async getBrowserLoginAttempts(): Promise<
    Partial<Record<AIProviderType, StoredBrowserLoginAttempt>>
  > {
    const stored = await chrome.storage.session.get(AUTH_STORE_PENDING_SESSION_KEY);
    const attempts = stored[AUTH_STORE_PENDING_SESSION_KEY];
    if (!attempts || typeof attempts !== 'object') {
      return {};
    }

    return Object.fromEntries(
      Object.entries(attempts)
        .filter(([provider, value]) => isProviderType(provider) && value && typeof value === 'object')
        .map(([provider, value]) => [provider, value as StoredBrowserLoginAttempt]),
    ) as Partial<Record<AIProviderType, StoredBrowserLoginAttempt>>;
  }
}
