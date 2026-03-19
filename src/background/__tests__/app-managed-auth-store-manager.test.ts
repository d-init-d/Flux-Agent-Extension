import { beforeEach, describe, expect, it } from 'vitest';

import { AUTH_STORE_STORAGE_KEY } from '../../shared/storage/auth-store';

import { AppManagedAuthStoreManager } from '../app-managed-auth-store-manager';

describe('AppManagedAuthStoreManager', () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
  });

  it('stores API keys durably while exposing only sanitized state', async () => {
    const manager = new AppManagedAuthStoreManager();

    const state = await manager.setApiKey('openai', 'sk-openai-local', {
      version: 1,
      provider: 'openai',
      providerFamily: 'default',
      authFamily: 'api-key',
      authKind: 'api-key',
      maskedValue: 'sk-****local',
      updatedAt: 100,
      validatedAt: 101,
    });

    const stored = await chrome.storage.local.get(AUTH_STORE_STORAGE_KEY);
    const durableStore = stored[AUTH_STORE_STORAGE_KEY] as {
      providers: Record<string, { apiKey?: { secret: string } }>;
    };
    expect(durableStore.providers.openai.apiKey?.secret).toBe('sk-openai-local');
    expect(state.providers.openai?.apiKey).toEqual(
      expect.objectContaining({
        authChoiceId: 'api-key',
        credential: expect.objectContaining({
          maskedValue: 'sk-****local',
        }),
      }),
    );
    expect(state.providers.openai?.apiKey).not.toHaveProperty('secret');
  });

  it('stores browser-account artifacts durably while keeping state sanitized', async () => {
    const manager = new AppManagedAuthStoreManager();

    const state = await manager.saveBrowserAccount('openai', {
      credential: {
        version: 1,
        provider: 'openai',
        providerFamily: 'default',
        authFamily: 'account-backed',
        authKind: 'account-artifact',
        maskedValue: 'acct_****1234',
        updatedAt: 200,
      },
      accounts: [
        {
          version: 1,
          provider: 'openai',
          providerFamily: 'default',
          authFamily: 'account-backed',
          accountId: 'acct_openai_1',
          label: 'OpenAI Browser Account',
          status: 'active',
          isActive: true,
          updatedAt: 200,
          validatedAt: 201,
        },
      ],
      activeAccountId: 'acct_openai_1',
      artifacts: {
        acct_openai_1: {
          accountId: 'acct_openai_1',
          authKind: 'account-artifact',
          value: '{"refresh":"encrypted"}',
          updatedAt: 202,
        },
      },
    });

    const stored = await chrome.storage.local.get(AUTH_STORE_STORAGE_KEY);
    const durableStore = stored[AUTH_STORE_STORAGE_KEY] as {
      providers: Record<string, { browserAccount?: { artifacts: Record<string, { value: string }> } }>;
    };
    expect(durableStore.providers.openai.browserAccount?.artifacts.acct_openai_1.value).toBe(
      '{"refresh":"encrypted"}',
    );
    expect(await manager.getBrowserAccountArtifact('openai', 'acct_openai_1')).toEqual(
      expect.objectContaining({
        accountId: 'acct_openai_1',
        authKind: 'account-artifact',
      }),
    );
    expect(state.providers.openai?.browserAccount).toEqual(
      expect.objectContaining({
        activeAccountId: 'acct_openai_1',
        accounts: [expect.objectContaining({ accountId: 'acct_openai_1' })],
      }),
    );
    expect(JSON.stringify(state.providers.openai?.browserAccount)).not.toContain('encrypted');
  });

  it('does not persist browser-login metadata for non-OpenAI account-backed providers', async () => {
    const manager = new AppManagedAuthStoreManager();

    const state = await manager.saveBrowserAccount('codex', {
      accounts: [
        {
          version: 1,
          provider: 'codex',
          providerFamily: 'chatgpt-account',
          authFamily: 'account-backed',
          accountId: 'acct_codex_1',
          label: 'Legacy Codex Account',
          status: 'active',
          updatedAt: 250,
        },
      ],
      activeAccountId: 'acct_codex_1',
      browserLogin: {
        authMethod: 'browser-account',
        status: 'success',
        updatedAt: 250,
      },
      artifacts: {
        acct_codex_1: {
          accountId: 'acct_codex_1',
          authKind: 'account-artifact',
          value: 'legacy-codex-artifact',
          updatedAt: 250,
        },
      },
    });

    const stored = await chrome.storage.local.get(AUTH_STORE_STORAGE_KEY);
    const durableStore = stored[AUTH_STORE_STORAGE_KEY] as {
      providers: Record<string, { browserAccount?: { browserLogin?: unknown } }>;
    };

    expect(durableStore.providers.codex.browserAccount?.browserLogin).toBeUndefined();
    expect(state.providers.codex?.browserAccount?.browserLogin).toBeUndefined();
  });

  it('keeps browser-login pending attempts session-only and persists only sanitized results', async () => {
    const manager = new AppManagedAuthStoreManager();

    await manager.setBrowserLoginPending('openai', {
      provider: 'openai',
      authMethod: 'browser-account',
      requestId: 'req-openai-browser',
      state: 'raw-state-secret',
      nonce: 'raw-nonce-secret',
      issuedAt: 300,
      expiresAt: 360,
      updatedAt: 300,
      uiContext: 'options',
    });

    const durableAfterPending = await chrome.storage.local.get(AUTH_STORE_STORAGE_KEY);
    expect(durableAfterPending[AUTH_STORE_STORAGE_KEY]).toBeUndefined();

    const pendingState = await manager.getState();
    expect(pendingState.providers.openai?.browserAccount?.browserLogin).toEqual(
      expect.objectContaining({
        status: 'pending',
        pending: expect.objectContaining({ requestId: 'req-openai-browser' }),
      }),
    );

    const resultState = await manager.setBrowserLoginResult('openai', {
      authMethod: 'browser-account',
      status: 'helper-missing',
      updatedAt: 400,
      lastAttemptAt: 300,
      lastCompletedAt: 400,
      lastErrorCode: 'HELPER_NOT_FOUND',
      retryable: true,
      helper: {
        id: 'opencode-helper',
        version: '1.0.0',
      },
    });

    expect(resultState.providers.openai?.browserAccount?.browserLogin).toEqual(
      expect.objectContaining({
        status: 'helper-missing',
        lastErrorCode: 'HELPER_NOT_FOUND',
      }),
    );

    const durableAfterResult = await chrome.storage.local.get(AUTH_STORE_STORAGE_KEY);
    const durableStore = durableAfterResult[AUTH_STORE_STORAGE_KEY] as {
      providers: Record<string, { browserAccount?: { browserLogin?: { status: string } } }>;
    };
    expect(durableStore.providers.openai.browserAccount?.browserLogin).toEqual(
      expect.objectContaining({
        status: 'helper-missing',
      }),
    );

    const pendingSession = await chrome.storage.session.get('__flux_auth_store_browser_login_session__');
    expect(pendingSession.__flux_auth_store_browser_login_session__).toBeUndefined();
  });

  it('rejects browser-login state changes for providers outside the OpenAI browser-login lane', async () => {
    const manager = new AppManagedAuthStoreManager();

    await expect(
      manager.setBrowserLoginPending('cliproxyapi', {
        provider: 'cliproxyapi',
        authMethod: 'browser-account',
        requestId: 'req-invalid-provider',
        state: 'raw-state-secret',
        nonce: 'raw-nonce-secret',
        issuedAt: 300,
        expiresAt: 360,
        updatedAt: 300,
      }),
    ).rejects.toThrow('does not support browser-login auth');

    await expect(
      manager.setBrowserLoginResult('codex', {
        authMethod: 'browser-account',
        status: 'helper-missing',
        updatedAt: 400,
      }),
    ).rejects.toThrow('does not support browser-login auth');
  });

  it('can remove browser accounts and clear provider stores without affecting unrelated providers', async () => {
    const manager = new AppManagedAuthStoreManager();

    await manager.setApiKey('cliproxyapi', 'sk-cli-proxy', {
      version: 1,
      provider: 'cliproxyapi',
      providerFamily: 'default',
      authFamily: 'api-key',
      authKind: 'api-key',
      maskedValue: 'sk-****proxy',
      updatedAt: 500,
    });

    await manager.saveBrowserAccount('openai', {
      accounts: [
        {
          version: 1,
          provider: 'openai',
          providerFamily: 'default',
          authFamily: 'account-backed',
          accountId: 'acct_openai_1',
          label: 'OpenAI Browser Account',
          status: 'active',
          updatedAt: 500,
        },
      ],
      activeAccountId: 'acct_openai_1',
      artifacts: {
        acct_openai_1: {
          accountId: 'acct_openai_1',
          authKind: 'account-artifact',
          value: 'artifact-value',
          updatedAt: 500,
        },
      },
    });

    const afterRemove = await manager.removeBrowserAccount('openai', 'acct_openai_1');
    expect(afterRemove.providers.openai).toBeUndefined();

    const afterClear = await manager.clearProviderStore('cliproxyapi');
    expect(afterClear.providers.cliproxyapi).toBeUndefined();
  });
});
