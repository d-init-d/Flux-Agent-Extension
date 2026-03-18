import { beforeEach, describe, expect, it } from 'vitest';

import { Logger } from '../../shared/utils';

import { CredentialVault } from '../credential-vault';
import { CodexAccountSessionManager } from '../codex-account-session-manager';
import { OpenAIRuntimeAuthCoordinator } from '../openai-runtime-auth-coordinator';

function encodeBase64UrlJson(payload: Record<string, unknown>): string {
  return btoa(JSON.stringify(payload)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '');
}

function createJwt(payload: Record<string, unknown>): string {
  return `${encodeBase64UrlJson({ alg: 'none', typ: 'JWT' })}.${encodeBase64UrlJson(payload)}.signature`;
}

async function createRuntimeState(vault: CredentialVault) {
  return {
    settings: {
      language: 'auto' as const,
      theme: 'system' as const,
      defaultProvider: 'openai' as const,
      streamResponses: true,
      includeScreenshotsInContext: false,
      maxContextLength: 32_000,
      defaultTimeout: 30_000,
      autoRetryOnFailure: true,
      maxRetries: 1,
      screenshotOnError: true,
      allowCustomScripts: false,
      allowedDomains: [],
      blockedDomains: [],
      showFloatingBar: true,
      highlightElements: true,
      soundNotifications: false,
      debugMode: false,
      logNetworkRequests: false,
    },
    providers: {},
    activeProvider: 'openai' as const,
    onboarding: {},
    vault: await vault.getState(),
  };
}

function createCoordinator(vault: CredentialVault): OpenAIRuntimeAuthCoordinator {
  const logger = new Logger('FluxSW:test', 'debug');

  return new OpenAIRuntimeAuthCoordinator(
    vault,
    new CodexAccountSessionManager(vault, logger, {
      sourceProvider: 'openai',
      sourceLabel: 'OpenAI browser account',
    }),
    new CodexAccountSessionManager(vault, logger),
  );
}

describe('OpenAIRuntimeAuthCoordinator', () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
  });

  it('keeps the OpenAI API-key lane unchanged when no trusted browser-account state exists', async () => {
    const vault = new CredentialVault();
    await vault.init('test-passphrase');
    await vault.setCredential('openai', 'sk-openai-runtime-key');
    await vault.markValidated('openai');

    const coordinator = createCoordinator(vault);

    const resolution = await coordinator.resolve(await createRuntimeState(vault), 'gpt-4o-mini');

    expect(resolution).toEqual({
      lane: 'api-key',
      runtimeProvider: 'openai',
      credential: 'sk-openai-runtime-key',
      model: 'gpt-4o-mini',
    });
  });

  it('routes trusted OpenAI browser-account state through the internal codex runtime lane', async () => {
    const vault = new CredentialVault();
    await vault.init('test-passphrase');
    const now = Date.UTC(2026, 2, 18, 9, 0, 0);
    const idToken = createJwt({
      email: 'browser@example.com',
      'https://api.openai.com/auth': {
        chatgpt_plan_type: 'pro',
        chatgpt_user_id: 'user_openai_browser',
      },
    });

    await vault.saveAccount('openai', {
      accountId: 'acct_openai_browser',
      label: 'OpenAI Browser Account',
      isActive: true,
      status: 'active',
      artifact: {
        format: 'json',
        value: JSON.stringify({
          auth_mode: 'chatgpt',
          last_refresh: new Date(now).toISOString(),
          tokens: {
            access_token: 'access-openai-browser',
            id_token: idToken,
            refresh_token: 'refresh-openai-browser',
            account_id: 'acct_openai_browser',
          },
        }),
      },
    });
    await vault.setBrowserLoginResult('openai', {
      status: 'success',
      updatedAt: now,
      lastAttemptAt: now,
      lastCompletedAt: now,
      accountId: 'acct_openai_browser',
      accountLabel: 'OpenAI Browser Account',
    });

    const coordinator = createCoordinator(vault);

    const resolution = await coordinator.resolve(
      {
        ...(await createRuntimeState(vault)),
        providers: {
          openai: {
            authChoiceId: 'browser-account',
          },
        },
      },
      'codex-mini-latest',
    );

    expect(resolution).toEqual({
      lane: 'browser-account',
      runtimeProvider: 'codex',
      credential: 'access-openai-browser',
      model: 'codex-mini-latest',
    });
  });

  it('prefers persisted authChoiceId over vault inference when choosing the OpenAI lane', async () => {
    const vault = new CredentialVault();
    await vault.init('test-passphrase');
    await vault.setCredential('openai', 'sk-openai-runtime-key');
    await vault.markValidated('openai');
    const now = Date.UTC(2026, 2, 18, 12, 0, 0);
    const idToken = createJwt({
      email: 'browser@example.com',
      'https://api.openai.com/auth': {
        chatgpt_plan_type: 'pro',
        chatgpt_user_id: 'user_openai_browser',
      },
    });

    await vault.saveAccount('openai', {
      accountId: 'acct_openai_browser',
      label: 'OpenAI Browser Account',
      isActive: true,
      status: 'active',
      artifact: {
        format: 'json',
        value: JSON.stringify({
          auth_mode: 'chatgpt',
          last_refresh: new Date(now).toISOString(),
          tokens: {
            access_token: 'access-openai-browser',
            id_token: idToken,
            refresh_token: 'refresh-openai-browser',
            account_id: 'acct_openai_browser',
          },
        }),
      },
    });
    await vault.setBrowserLoginResult('openai', {
      status: 'success',
      updatedAt: now,
      lastAttemptAt: now,
      lastCompletedAt: now,
      accountId: 'acct_openai_browser',
      accountLabel: 'OpenAI Browser Account',
    });

    const coordinator = createCoordinator(vault);

    const runtimeState = await createRuntimeState(vault);
    runtimeState.providers = {
      openai: {
        authChoiceId: 'api-key',
      },
    };

    const resolution = await coordinator.resolve(runtimeState, 'gpt-4o-mini');

    expect(resolution).toEqual({
      lane: 'api-key',
      runtimeProvider: 'openai',
      credential: 'sk-openai-runtime-key',
      model: 'gpt-4o-mini',
    });
  });

  it('keeps lane-aware browser-account model routing instead of forcing codex-mini-latest', async () => {
    const vault = new CredentialVault();
    await vault.init('test-passphrase');
    const now = Date.UTC(2026, 2, 18, 9, 0, 0);
    const idToken = createJwt({
      email: 'browser@example.com',
      'https://api.openai.com/auth': {
        chatgpt_plan_type: 'pro',
        chatgpt_user_id: 'user_openai_browser',
      },
    });

    await vault.saveAccount('openai', {
      accountId: 'acct_openai_browser',
      label: 'OpenAI Browser Account',
      isActive: true,
      status: 'active',
      artifact: {
        format: 'json',
        value: JSON.stringify({
          auth_mode: 'chatgpt',
          last_refresh: new Date(now).toISOString(),
          tokens: {
            access_token: 'access-openai-browser',
            id_token: idToken,
            refresh_token: 'refresh-openai-browser',
            account_id: 'acct_openai_browser',
          },
        }),
      },
    });
    await vault.setBrowserLoginResult('openai', {
      status: 'success',
      updatedAt: now,
      lastAttemptAt: now,
      lastCompletedAt: now,
      accountId: 'acct_openai_browser',
      accountLabel: 'OpenAI Browser Account',
    });

    const coordinator = createCoordinator(vault);

    const runtimeState = await createRuntimeState(vault);
    runtimeState.providers = {
      openai: {
        authChoiceId: 'browser-account',
      },
    };

    const resolution = await coordinator.resolve(runtimeState, 'codex-latest');

    expect(resolution).toEqual({
      lane: 'browser-account',
      runtimeProvider: 'codex',
      credential: 'access-openai-browser',
      model: 'codex-latest',
    });
  });

  it('fails closed for known cross-lane model mismatches before requesting live runtime material', async () => {
    const vault = new CredentialVault();
    await vault.init('test-passphrase');
    await vault.setCredential('openai', 'sk-openai-runtime-key');
    await vault.markValidated('openai');

    const coordinator = createCoordinator(vault);

    const runtimeState = await createRuntimeState(vault);
    runtimeState.providers = {
      openai: {
        authChoiceId: 'api-key',
      },
    };

    await expect(coordinator.resolve(runtimeState, 'codex-mini-latest')).rejects.toMatchObject({
      code: 'AI_INVALID_KEY',
      message: expect.stringContaining('belongs to the browser-account lane'),
    });
  });

  it('keeps unknown model ids as manual overrides in the selected browser-account lane', async () => {
    const vault = new CredentialVault();
    await vault.init('test-passphrase');
    const now = Date.UTC(2026, 2, 18, 9, 0, 0);
    const idToken = createJwt({
      email: 'browser@example.com',
      'https://api.openai.com/auth': {
        chatgpt_plan_type: 'pro',
        chatgpt_user_id: 'user_openai_browser',
      },
    });

    await vault.saveAccount('openai', {
      accountId: 'acct_openai_browser',
      label: 'OpenAI Browser Account',
      isActive: true,
      status: 'active',
      artifact: {
        format: 'json',
        value: JSON.stringify({
          auth_mode: 'chatgpt',
          last_refresh: new Date(now).toISOString(),
          tokens: {
            access_token: 'access-openai-browser',
            id_token: idToken,
            refresh_token: 'refresh-openai-browser',
            account_id: 'acct_openai_browser',
          },
        }),
      },
    });
    await vault.setBrowserLoginResult('openai', {
      status: 'success',
      updatedAt: now,
      lastAttemptAt: now,
      lastCompletedAt: now,
      accountId: 'acct_openai_browser',
      accountLabel: 'OpenAI Browser Account',
    });

    const coordinator = createCoordinator(vault);

    const runtimeState = await createRuntimeState(vault);
    runtimeState.providers = {
      openai: {
        authChoiceId: 'browser-account',
      },
    };

    const resolution = await coordinator.resolve(runtimeState, 'custom-browser-model');

    expect(resolution).toEqual({
      lane: 'browser-account',
      runtimeProvider: 'codex',
      credential: 'access-openai-browser',
      model: 'custom-browser-model',
    });
  });

  it('fails closed on non-ready OpenAI browser-account state without falling back to the API key lane', async () => {
    const vault = new CredentialVault();
    await vault.init('test-passphrase');
    await vault.setCredential('openai', 'sk-openai-should-not-be-used');
    await vault.markValidated('openai');
    await vault.saveAccount('openai', {
      accountId: 'acct_openai_pending',
      label: 'Pending OpenAI Browser Account',
      isActive: true,
      status: 'active',
      artifact: {
        format: 'json',
        value: JSON.stringify({
          artifact_version: 1,
          refresh_token: 'refresh-openai-pending',
          account_id: 'acct_openai_pending',
        }),
      },
    });
    await vault.setBrowserLoginPending('openai', {
      requestId: 'req-openai-pending',
      state: 'state-secret',
      nonce: 'nonce-secret',
      issuedAt: Date.UTC(2026, 2, 18, 10, 0, 0),
      expiresAt: Date.UTC(2026, 2, 18, 10, 10, 0),
      uiContext: 'unknown',
    });

    const coordinator = createCoordinator(vault);

    await expect(
      coordinator.resolve(
        {
          ...(await createRuntimeState(vault)),
          providers: {
            openai: {
              authChoiceId: 'browser-account',
            },
          },
        },
        'codex-mini-latest',
      ),
    ).rejects.toMatchObject({
      code: 'AI_INVALID_KEY',
      message: expect.stringContaining('browser-account auth is not ready yet'),
    });
  });

  it('fails closed when browser-login state exists even without an active OpenAI account record', async () => {
    const vault = new CredentialVault();
    await vault.init('test-passphrase');
    await vault.setCredential('openai', 'sk-openai-should-not-fallback');
    await vault.markValidated('openai');
    await vault.setBrowserLoginResult('openai', {
      status: 'helper-missing',
      updatedAt: Date.UTC(2026, 2, 18, 11, 30, 0),
      lastAttemptAt: Date.UTC(2026, 2, 18, 11, 30, 0),
      lastCompletedAt: Date.UTC(2026, 2, 18, 11, 31, 0),
      lastErrorCode: 'HELPER_NOT_FOUND',
      retryable: true,
    });

    const coordinator = createCoordinator(vault);

    await expect(
      coordinator.resolve(
        {
          ...(await createRuntimeState(vault)),
          providers: {
            openai: {
              authChoiceId: 'browser-account',
            },
          },
        },
        'codex-mini-latest',
      ),
    ).rejects.toMatchObject({
      code: 'AI_INVALID_KEY',
      message: expect.stringContaining('browser-account auth is not ready yet'),
    });
  });

  it('bridges legacy codex account state into the OpenAI browser-account lane when OpenAI browser state is absent', async () => {
    const vault = new CredentialVault();
    await vault.init('test-passphrase');
    const now = Date.UTC(2026, 2, 19, 8, 0, 0);
    const idToken = createJwt({
      email: 'legacy-codex@example.com',
      'https://api.openai.com/auth': {
        chatgpt_plan_type: 'plus',
        chatgpt_user_id: 'user_legacy_codex_bridge',
      },
    });

    await vault.saveAccount('codex', {
      accountId: 'acct_legacy_codex',
      label: 'Legacy Codex Seat',
      isActive: true,
      status: 'active',
      validatedAt: now,
      artifact: {
        format: 'json',
        value: JSON.stringify({
          auth_mode: 'chatgpt',
          last_refresh: new Date(now).toISOString(),
          tokens: {
            access_token: 'access-legacy-codex',
            id_token: idToken,
            refresh_token: 'refresh-legacy-codex',
            account_id: 'acct_legacy_codex',
          },
        }),
      },
    });
    await vault.markValidated('codex');

    const runtimeState = await createRuntimeState(vault);
    runtimeState.providers = {
      codex: {
        enabled: true,
        model: 'codex-latest',
        maxTokens: 4096,
        temperature: 0.2,
      },
    };

    const resolution = await createCoordinator(vault).resolve(runtimeState, 'codex-latest');

    expect(resolution).toEqual({
      lane: 'browser-account',
      runtimeProvider: 'codex',
      credential: 'access-legacy-codex',
      model: 'codex-latest',
    });
  });
});
