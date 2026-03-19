import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as providerLoader from '../../core/ai-client/provider-loader';
import { SecureStorage } from '../../shared/crypto/secure-storage';
import type { AppManagedAuthStore } from '../../shared/types';
import { CredentialVault } from '../credential-vault';

function encodeBase64UrlJson(payload: Record<string, unknown>): string {
  return btoa(JSON.stringify(payload)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '');
}

function createJwt(payload: Record<string, unknown>): string {
  return `${encodeBase64UrlJson({ alg: 'none', typ: 'JWT' })}.${encodeBase64UrlJson(payload)}.signature`;
}

describe('CredentialVault account store', () => {
  function readAuthStore(value: unknown): AppManagedAuthStore {
    return value as AppManagedAuthStore;
  }

  beforeEach(async () => {
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
  });

  it('upserts, activates, revokes, removes, and reads quota metadata for codex accounts', async () => {
    const vault = new CredentialVault();
    await vault.init('test-passphrase');
    const idToken = createJwt({
      email: 'primary@example.com',
      'https://api.openai.com/auth': {
        chatgpt_plan_type: 'plus',
        chatgpt_user_id: 'user_primary',
      },
    });

    const primary = await vault.saveAccount('codex', {
      accountId: 'acct_primary',
      label: 'Primary Codex Account',
      maskedIdentifier: 'pr***@example.com',
      credentialMaskedValue: 'chatgpt:pr***@example.com',
      isActive: true,
      status: 'active',
      metadata: {
        quota: {
          scope: 'account',
          unit: 'requests',
          period: 'day',
          used: 10,
          limit: 100,
          remaining: 90,
          observedAt: Date.UTC(2026, 2, 17, 9, 0, 0),
        },
      },
      artifact: {
        format: 'json',
        value: JSON.stringify({
          auth_mode: 'chatgpt',
          tokens: {
            access_token: 'access-primary',
            id_token: idToken,
            refresh_token: 'refresh-primary',
            account_id: 'acct_primary',
          },
        }),
        filename: 'codex-account.json',
      },
    });

    expect(primary.credentialKey).toBe('account-artifact::codex::acct_primary');
    expect((await vault.getState()).credentials.codex).toEqual(
      expect.objectContaining({
        authKind: 'account-artifact',
        maskedValue: 'chatgpt:pr***@example.com',
      }),
    );
    const encryptedArtifact = await chrome.storage.local.get(
      '__encrypted__account-artifact::codex::acct_primary',
    );
    expect(encryptedArtifact['__encrypted__account-artifact::codex::acct_primary']).toEqual(
      expect.any(String),
    );
    expect(await vault.getAccountArtifact('codex', 'acct_primary')).toEqual(
      expect.objectContaining({
        accountId: 'acct_primary',
        format: 'json',
        filename: 'codex-account.json',
      }),
    );

    await vault.saveAccount('codex', {
      accountId: 'acct_backup',
      label: 'Backup Codex Account',
      maskedIdentifier: 'ba***@example.com',
      status: 'available',
    });

    const activated = await vault.activateAccount('codex', 'acct_backup');
    expect(activated).toEqual(
      expect.objectContaining({
        accountId: 'acct_backup',
        status: 'active',
        isActive: true,
      }),
    );

    const updatedQuota = {
      scope: 'account',
      unit: 'requests',
      period: 'day',
      used: 25,
      limit: 100,
      remaining: 75,
      observedAt: Date.UTC(2026, 2, 17, 10, 0, 0),
    } as const;
    await vault.setQuotaMetadata('codex', 'acct_backup', updatedQuota);
    expect(await vault.getQuotaMetadata('codex', 'acct_backup')).toEqual(updatedQuota);

    const revoked = await vault.revokeAccount('codex', 'acct_primary', { revokeCredential: true });
    expect(revoked).toEqual(
      expect.objectContaining({
        accountId: 'acct_primary',
        status: 'revoked',
        stale: true,
        isActive: false,
        credentialKey: undefined,
      }),
    );
    const removedArtifact = await chrome.storage.local.get(
      '__encrypted__account-artifact::codex::acct_primary',
    );
    expect(removedArtifact['__encrypted__account-artifact::codex::acct_primary']).toBeUndefined();

    const removed = await vault.removeAccount('codex', 'acct_primary');
    expect(removed).toBe(true);
    expect(await vault.getAccount('codex', 'acct_primary')).toBeNull();

    const state = await vault.getState();
    expect(state.activeAccounts.codex).toBe('acct_backup');
    expect(state.accounts.codex).toEqual([
      expect.objectContaining({
        accountId: 'acct_backup',
        status: 'active',
        isActive: true,
        metadata: expect.objectContaining({
          quota: expect.objectContaining({ remaining: 75 }),
        }),
      }),
    ]);
  });

  it('normalizes cliproxyapi endpoints before validating credentials', async () => {
    const vault = new CredentialVault();
    const initialize = vi.fn().mockResolvedValue(undefined);
    const validateApiKey = vi.fn().mockResolvedValue(true);
    vi.spyOn(providerLoader, 'createProvider').mockResolvedValue({
      name: 'cliproxyapi',
      supportsVision: true,
      supportsStreaming: true,
      supportsFunctionCalling: true,
      initialize,
      validateApiKey,
      // eslint-disable-next-line require-yield
      chat: async function* () {
        return;
      },
      abort: vi.fn(),
    });

    const valid = await vault.validateCredential(
      'cliproxyapi',
      {
        enabled: true,
        model: 'gpt-5',
        maxTokens: 4096,
        temperature: 0.3,
        customEndpoint: 'http://127.0.0.1:8317/v1/chat/completions',
      },
      'sk-cliproxyapi-test',
    );

    expect(valid).toBe(true);
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'http://127.0.0.1:8317/v1',
      }),
    );
    expect(validateApiKey).toHaveBeenCalledWith('sk-cliproxyapi-test');
  });

  it('rejects invalid cliproxyapi endpoints during credential validation', async () => {
    const vault = new CredentialVault();
    const createProviderSpy = vi.spyOn(providerLoader, 'createProvider');

    const valid = await vault.validateCredential(
      'cliproxyapi',
      {
        enabled: true,
        model: 'gpt-5',
        maxTokens: 4096,
        temperature: 0.3,
        customEndpoint: 'http://example.com/v1',
      },
      'sk-cliproxyapi-test',
    );

    expect(valid).toBe(false);
    expect(createProviderSpy).not.toHaveBeenCalled();
  });

  it('writes new API-key credentials into the app-managed auth store without requiring vault unlock', async () => {
    const vault = new CredentialVault();

    const record = await vault.setCredential('openai', 'sk-openai-local', 'api-key');

    expect(record).toEqual(
      expect.objectContaining({
        provider: 'openai',
        authKind: 'api-key',
        maskedValue: expect.stringContaining('****'),
      }),
    );

    const stored = await chrome.storage.local.get(['authStore', 'vault']);
    expect(readAuthStore(stored.authStore).providers.openai?.apiKey?.secret).toBe('sk-openai-local');
    expect((stored.vault as { credentials?: Record<string, unknown> } | undefined)?.credentials?.openai).toBeUndefined();

    const state = await vault.getState();
    expect(state.credentials.openai).toEqual(
      expect.objectContaining({
        authKind: 'api-key',
      }),
    );
    expect(state.lockState).toBe('uninitialized');
  });

  it('lazy-migrates legacy vault API keys into the app-managed auth store on read', async () => {
    const vault = new CredentialVault();
    await vault.init('test-passphrase');

    const secureStorage = new SecureStorage('test-passphrase');
    await secureStorage.setEncrypted('credential::cliproxyapi', {
      provider: 'cliproxyapi',
      authKind: 'api-key',
      secret: 'sk-legacy-cliproxy',
      updatedAt: Date.UTC(2026, 2, 19, 16, 0, 0),
    });
    await chrome.storage.local.set({
      vault: {
        version: 1,
        initialized: true,
        credentials: {
          cliproxyapi: {
            version: 1,
            provider: 'cliproxyapi',
            providerFamily: 'default',
            authFamily: 'api-key',
            authKind: 'api-key',
            maskedValue: 'sk-****proxy',
            updatedAt: Date.UTC(2026, 2, 19, 16, 0, 0),
            validatedAt: Date.UTC(2026, 2, 19, 16, 1, 0),
          },
        },
        accounts: {},
        activeAccounts: {},
        browserLogins: {},
      },
    });

    const secret = await vault.getCredential('cliproxyapi');
    expect(secret).toBe('sk-legacy-cliproxy');

    const stored = await chrome.storage.local.get('authStore');
    expect(readAuthStore(stored.authStore).providers.cliproxyapi?.apiKey?.secret).toBe('sk-legacy-cliproxy');
  });

  it('marks migrated API-key credentials validated and stale in the app-managed auth store', async () => {
    const vault = new CredentialVault();
    await vault.setCredential('openai', 'sk-openai-local', 'api-key');

    const validated = await vault.markValidated('openai');
    expect(validated).toEqual(
      expect.objectContaining({
        validatedAt: expect.any(Number),
        stale: false,
      }),
    );

    await vault.markCredentialStale('openai');
    const stored = await chrome.storage.local.get('authStore');
    expect(readAuthStore(stored.authStore).providers.openai?.apiKey?.credential).toEqual(
      expect.objectContaining({
        stale: true,
        validatedAt: undefined,
      }),
    );
  });

  it('deletes migrated API-key credentials without resurrecting legacy vault values', async () => {
    const vault = new CredentialVault();
    await vault.init('test-passphrase');

    const secureStorage = new SecureStorage('test-passphrase');
    await secureStorage.setEncrypted('credential::cliproxyapi', {
      provider: 'cliproxyapi',
      authKind: 'api-key',
      secret: 'sk-legacy-cliproxy',
      updatedAt: Date.UTC(2026, 2, 19, 17, 0, 0),
    });
    await chrome.storage.local.set({
      vault: {
        version: 1,
        initialized: true,
        credentials: {
          cliproxyapi: {
            version: 1,
            provider: 'cliproxyapi',
            providerFamily: 'default',
            authFamily: 'api-key',
            authKind: 'api-key',
            maskedValue: 'sk-****proxy',
            updatedAt: Date.UTC(2026, 2, 19, 17, 0, 0),
          },
        },
        accounts: {},
        activeAccounts: {},
        browserLogins: {},
      },
    });

    expect(await vault.getCredential('cliproxyapi')).toBe('sk-legacy-cliproxy');
    await vault.deleteCredential('cliproxyapi');

    expect(await vault.getCredential('cliproxyapi')).toBeNull();
    const state = await vault.getState();
    expect(state.credentials.cliproxyapi).toBeUndefined();
  });

  it('keeps openai browser-login pending state session-only and stores sanitized durable state plus encrypted artifacts', async () => {
    const vault = new CredentialVault();
    await vault.init('test-passphrase');

    const issuedAt = Date.UTC(2026, 2, 18, 8, 0, 0);
    const expiresAt = Date.UTC(2026, 2, 18, 8, 10, 0);
    await vault.setBrowserLoginPending('openai', {
      requestId: 'req_openai_browser_01',
      state: 'raw-state-secret',
      nonce: 'raw-nonce-secret',
      issuedAt,
      expiresAt,
      uiContext: 'options',
    });

    const pendingState = await vault.getState();
    expect(pendingState.browserLogins?.openai).toEqual({
      authMethod: 'browser-account',
      status: 'pending',
      updatedAt: expect.any(Number),
      lastAttemptAt: issuedAt,
      pending: {
        requestId: 'req_openai_browser_01',
        issuedAt,
        expiresAt,
        uiContext: 'options',
      },
    });
    expect((pendingState.browserLogins?.openai?.pending as Record<string, unknown>)?.state).toBeUndefined();
    expect((pendingState.browserLogins?.openai?.pending as Record<string, unknown>)?.nonce).toBeUndefined();

    const storedVaultWhilePending = (await chrome.storage.local.get('vault')).vault as {
      browserLogins?: Record<string, unknown>;
    };
    expect(storedVaultWhilePending.browserLogins).toEqual({});

    const storedPendingSession = await chrome.storage.session.get('__flux_browser_login_session__');
    expect(storedPendingSession['__flux_browser_login_session__']).toBeUndefined();

    await vault.saveAccount('openai', {
      accountId: 'acct_openai_primary',
      label: 'OpenAI Browser Account',
      maskedIdentifier: 'op***@example.com',
      credentialMaskedValue: 'chatgpt:op***@example.com',
      status: 'available',
      artifact: {
        format: 'json',
        filename: 'openai-browser-account.json',
        value: JSON.stringify({
          artifact_version: 1,
          refresh_token: 'refresh-openai-long-lived',
          account_id: 'acct_openai_primary',
        }),
      },
    });

    const completedAt = Date.UTC(2026, 2, 18, 8, 2, 0);
    await vault.setBrowserLoginResult('openai', {
      status: 'success',
      updatedAt: completedAt,
      lastAttemptAt: issuedAt,
      lastCompletedAt: completedAt,
      accountId: 'acct_openai_primary',
      accountLabel: 'OpenAI Browser Account',
      helper: {
        id: 'openai-browser-helper',
        version: '1.0.0',
      },
    });

    const finalState = await vault.getState();
    expect(finalState.credentials.openai).toEqual(
      expect.objectContaining({
        authFamily: 'account-backed',
        authKind: 'account-artifact',
        maskedValue: 'chatgpt:op***@example.com',
      }),
    );
    expect(finalState.accounts.openai).toEqual([
      expect.objectContaining({
        provider: 'openai',
        providerFamily: 'default',
        authFamily: 'account-backed',
        accountId: 'acct_openai_primary',
        credentialKey: 'account-artifact::openai::acct_openai_primary',
      }),
    ]);
    expect(finalState.browserLogins?.openai).toEqual({
      authMethod: 'browser-account',
      status: 'success',
      updatedAt: completedAt,
      lastAttemptAt: issuedAt,
      lastCompletedAt: completedAt,
      accountId: 'acct_openai_primary',
      accountLabel: 'OpenAI Browser Account',
      helper: {
        id: 'openai-browser-helper',
        version: '1.0.0',
      },
      retryable: false,
    });

    const storedVaultAfterSuccess = (await chrome.storage.local.get('vault')).vault as {
      browserLogins: Record<string, Record<string, unknown>>;
    };
    expect(storedVaultAfterSuccess.browserLogins.openai).toEqual({
      authMethod: 'browser-account',
      status: 'success',
      updatedAt: completedAt,
      lastAttemptAt: issuedAt,
      lastCompletedAt: completedAt,
      accountId: 'acct_openai_primary',
      accountLabel: 'OpenAI Browser Account',
      helper: {
        id: 'openai-browser-helper',
        version: '1.0.0',
      },
      retryable: false,
    });
    expect((storedVaultAfterSuccess.browserLogins.openai as Record<string, unknown>).pending).toBeUndefined();

    const encryptedArtifact = await chrome.storage.local.get(
      '__encrypted__account-artifact::openai::acct_openai_primary',
    );
    expect(encryptedArtifact['__encrypted__account-artifact::openai::acct_openai_primary']).toEqual(
      expect.any(String),
    );
    expect(await vault.getAccountArtifact('openai', 'acct_openai_primary')).toEqual(
      expect.objectContaining({
        provider: 'openai',
        accountId: 'acct_openai_primary',
        format: 'json',
        filename: 'openai-browser-account.json',
      }),
    );

    const clearedPendingSession = await chrome.storage.session.get('__flux_browser_login_session__');
    expect(clearedPendingSession['__flux_browser_login_session__']).toBeUndefined();
  });

  it('reconciles stale active account metadata before surfacing account-backed state', async () => {
    await chrome.storage.local.set({
      vault: {
        version: 1,
        initialized: true,
        credentials: {},
        accounts: {
          openai: [
            {
              version: 1,
              provider: 'openai',
              providerFamily: 'default',
              authFamily: 'account-backed',
              accountId: 'acct_openai_stale',
              label: 'OpenAI Browser Account',
              status: 'available',
              isActive: false,
              updatedAt: Date.UTC(2026, 2, 18, 9, 0, 0),
            },
          ],
        },
        activeAccounts: {
          openai: 'acct_openai_stale',
        },
        browserLogins: {},
      },
    });

    const vault = new CredentialVault();
    const state = await vault.getState();

    expect(state.activeAccounts.openai).toBe('acct_openai_stale');
    expect(state.accounts.openai).toEqual([
      expect.objectContaining({
        accountId: 'acct_openai_stale',
        status: 'active',
        isActive: true,
      }),
    ]);
  });
});
