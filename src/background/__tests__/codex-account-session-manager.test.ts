import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as codexAccountImport from '../../core/auth/codex-account-import';
import { ErrorCode } from '../../shared/errors';
import { Logger } from '../../shared/utils';

import { CodexAccountSessionManager } from '../codex-account-session-manager';
import { CredentialVault } from '../credential-vault';

function encodeBase64UrlJson(payload: Record<string, unknown>): string {
  return btoa(JSON.stringify(payload)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '');
}

function createJwt(payload: Record<string, unknown>): string {
  return `${encodeBase64UrlJson({ alg: 'none', typ: 'JWT' })}.${encodeBase64UrlJson(payload)}.signature`;
}

describe('CodexAccountSessionManager', () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
    vi.restoreAllMocks();
  });

  it('hydrates a memory-only runtime session and reuses the cached token bundle', async () => {
    const vault = new CredentialVault();
    await vault.init('test-passphrase');
    const now = Date.UTC(2026, 2, 17, 10, 0, 0);
    const idToken = createJwt({
      email: 'cached@example.com',
      'https://api.openai.com/auth': {
        chatgpt_plan_type: 'pro',
        chatgpt_user_id: 'user_cached',
      },
    });

    await vault.saveAccount('codex', {
      accountId: 'acct_cached',
      label: 'Cached Codex Account',
      maskedIdentifier: 'ca***@example.com',
      credentialMaskedValue: 'chatgpt:ca***@example.com',
      isActive: true,
      status: 'active',
      artifact: {
        format: 'json',
        value: JSON.stringify({
          auth_mode: 'chatgpt',
          last_refresh: new Date(now).toISOString(),
          tokens: {
            access_token: 'access-cached',
            id_token: idToken,
            refresh_token: 'refresh-cached',
            account_id: 'acct_cached',
          },
        }),
        filename: 'codex-account.json',
      },
    });

    vi.useFakeTimers();
    vi.setSystemTime(now + 60_000);

    const manager = new CodexAccountSessionManager(vault, new Logger('FluxSW:test', 'debug'));
    const getArtifactSpy = vi.spyOn(vault, 'getAccountArtifact');

    const first = await manager.ensureSession({
      accountId: 'acct_cached',
      purpose: 'validate',
    });
    const second = await manager.ensureSession({
      accountId: 'acct_cached',
      purpose: 'validate',
    });

    expect(first.sessionAvailable).toBe(true);
    expect(first.sessionStatus).toBe('active');
    expect(first.cacheHit).toBe(false);
    expect(first.account.metadata?.session).toEqual(
      expect.objectContaining({
        authKind: 'session-token',
        status: 'active',
      }),
    );
    expect(first.account.metadata?.lastErrorCode).toBeUndefined();
    expect(JSON.stringify(first.account)).not.toContain('access-cached');

    expect(second.sessionAvailable).toBe(true);
    expect(second.cacheHit).toBe(true);
    expect(getArtifactSpy).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('serializes concurrent session hydration for the same account', async () => {
    const vault = new CredentialVault();
    await vault.init('test-passphrase');
    const now = Date.UTC(2026, 2, 17, 11, 0, 0);
    const idToken = createJwt({
      email: 'serialized@example.com',
      'https://api.openai.com/auth': {
        chatgpt_plan_type: 'plus',
        chatgpt_user_id: 'user_serialized',
      },
    });

    await vault.saveAccount('codex', {
      accountId: 'acct_serialized',
      label: 'Serialized Codex Account',
      isActive: false,
      status: 'available',
      artifact: {
        format: 'json',
        value: JSON.stringify({
          auth_mode: 'chatgpt',
          last_refresh: new Date(now).toISOString(),
          tokens: {
            access_token: 'access-serialized',
            id_token: idToken,
            refresh_token: 'refresh-serialized',
            account_id: 'acct_serialized',
          },
        }),
      },
    });

    vi.useFakeTimers();
    vi.setSystemTime(now + 60_000);

    const manager = new CodexAccountSessionManager(vault, new Logger('FluxSW:test', 'debug'));
    const originalImport = codexAccountImport.importCodexAccountArtifact;
    const importSpy = vi
      .spyOn(codexAccountImport, 'importCodexAccountArtifact')
      .mockImplementation(async (...args) => {
        await Promise.resolve();
        return originalImport(...args);
      });

    const [first, second] = await Promise.all([
      manager.ensureSession({ accountId: 'acct_serialized', purpose: 'validate' }),
      manager.ensureSession({ accountId: 'acct_serialized', purpose: 'validate' }),
    ]);

    expect(first.sessionStatus).toBe('active');
    expect(second.sessionStatus).toBe('active');
    expect(importSpy).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('returns runtime session material for active account-backed chat requests', async () => {
    const vault = new CredentialVault();
    await vault.init('test-passphrase');
    const now = Date.UTC(2026, 2, 17, 11, 30, 0);
    const idToken = createJwt({
      email: 'runtime@example.com',
      'https://api.openai.com/auth': {
        chatgpt_plan_type: 'pro',
        chatgpt_user_id: 'user_runtime',
      },
    });

    await vault.saveAccount('codex', {
      accountId: 'acct_runtime',
      label: 'Runtime Codex Account',
      isActive: true,
      status: 'active',
      artifact: {
        format: 'json',
        value: JSON.stringify({
          auth_mode: 'chatgpt',
          last_refresh: new Date(now).toISOString(),
          tokens: {
            access_token: 'access-runtime',
            id_token: idToken,
            refresh_token: 'refresh-runtime',
            account_id: 'acct_runtime',
          },
        }),
      },
    });

    vi.useFakeTimers();
    vi.setSystemTime(now + 60_000);

    const manager = new CodexAccountSessionManager(vault, new Logger('FluxSW:test', 'debug'));
    const runtimeSession = await manager.getRuntimeSessionMaterial('acct_runtime');

    expect(runtimeSession).toEqual(
      expect.objectContaining({
        accountId: 'acct_runtime',
        accessToken: 'access-runtime',
        authMode: 'chatgpt',
      }),
    );

    vi.useRealTimers();
  });

  it('marks the account stale when live refresh would be required', async () => {
    const vault = new CredentialVault();
    await vault.init('test-passphrase');
    const now = Date.UTC(2026, 2, 17, 12, 0, 0);
    const idToken = createJwt({
      email: 'stale@example.com',
      'https://api.openai.com/auth': {
        chatgpt_plan_type: 'plus',
        chatgpt_user_id: 'user_stale',
      },
    });

    await vault.saveAccount('codex', {
      accountId: 'acct_stale',
      label: 'Stale Codex Account',
      isActive: true,
      status: 'active',
      artifact: {
        format: 'json',
        value: JSON.stringify({
          auth_mode: 'chatgpt',
          last_refresh: new Date(now - 9 * 24 * 60 * 60 * 1000).toISOString(),
          tokens: {
            id_token: idToken,
            refresh_token: 'refresh-stale',
            account_id: 'acct_stale',
          },
        }),
      },
    });

    vi.useFakeTimers();
    vi.setSystemTime(now);

    const manager = new CodexAccountSessionManager(vault, new Logger('FluxSW:test', 'debug'));
    const result = await manager.ensureSession({
      accountId: 'acct_stale',
      purpose: 'quota-refresh',
    });

    expect(result.sessionAvailable).toBe(false);
    expect(result.sessionStatus).toBe('refresh-required');
    expect(result.refreshDeferred).toBe(true);
    expect(result.reauthRequired).toBe(true);
    expect(result.account.status).toBe('needs-auth');
    expect(result.account.stale).toBe(true);
    expect(result.account.metadata).toEqual(
      expect.objectContaining({
        lastErrorCode: 'ACCOUNT_SESSION_REFRESH_UNSUPPORTED',
        session: expect.objectContaining({
          authKind: 'session-token',
          status: 'refresh-required',
        }),
      }),
    );

    vi.useRealTimers();
  });

  it('keeps validate-only refreshes deferred when the artifact has no usable access token', async () => {
    const vault = new CredentialVault();
    await vault.init('test-passphrase');
    const now = Date.UTC(2026, 2, 17, 12, 30, 0);
    const idToken = createJwt({
      email: 'deferred@example.com',
      'https://api.openai.com/auth': {
        chatgpt_plan_type: 'plus',
        chatgpt_user_id: 'user_deferred',
      },
    });

    await vault.saveAccount('codex', {
      accountId: 'acct_deferred',
      label: 'Deferred Codex Account',
      isActive: true,
      status: 'active',
      artifact: {
        format: 'json',
        value: JSON.stringify({
          auth_mode: 'chatgpt',
          last_refresh: new Date(now).toISOString(),
          tokens: {
            id_token: idToken,
            refresh_token: 'refresh-deferred',
            account_id: 'acct_deferred',
          },
        }),
      },
    });

    vi.useFakeTimers();
    vi.setSystemTime(now + 60_000);

    const manager = new CodexAccountSessionManager(vault, new Logger('FluxSW:test', 'debug'));
    const result = await manager.ensureSession({
      accountId: 'acct_deferred',
      purpose: 'validate',
    });

    expect(result.sessionAvailable).toBe(false);
    expect(result.sessionStatus).toBe('refresh-required');
    expect(result.refreshDeferred).toBe(true);
    expect(result.reauthRequired).toBe(false);
    expect(result.account.status).toBe('active');
    expect(result.account.stale).toBe(false);
    expect(result.account.metadata).toEqual(
      expect.objectContaining({
        lastErrorCode: 'ACCOUNT_SESSION_REFRESH_DEFERRED',
        session: expect.objectContaining({
          authKind: 'session-token',
          status: 'refresh-required',
        }),
      }),
    );

    vi.useRealTimers();
  });

  it('drops cached runtime material once the account is revoked', async () => {
    const vault = new CredentialVault();
    await vault.init('test-passphrase');
    const now = Date.UTC(2026, 2, 17, 13, 0, 0);
    const idToken = createJwt({
      email: 'revoked@example.com',
      'https://api.openai.com/auth': {
        chatgpt_plan_type: 'pro',
        chatgpt_user_id: 'user_revoked',
      },
    });

    await vault.saveAccount('codex', {
      accountId: 'acct_revoked',
      label: 'Revoked Codex Account',
      isActive: true,
      status: 'active',
      artifact: {
        format: 'json',
        value: JSON.stringify({
          auth_mode: 'chatgpt',
          last_refresh: new Date(now).toISOString(),
          tokens: {
            access_token: 'access-revoked',
            id_token: idToken,
            refresh_token: 'refresh-revoked',
            account_id: 'acct_revoked',
          },
        }),
      },
    });

    vi.useFakeTimers();
    vi.setSystemTime(now + 60_000);

    const manager = new CodexAccountSessionManager(vault, new Logger('FluxSW:test', 'debug'));

    const initial = await manager.ensureSession({
      accountId: 'acct_revoked',
      purpose: 'validate',
    });
    expect(initial.sessionAvailable).toBe(true);

    await vault.patchAccount('codex', 'acct_revoked', {
      status: 'revoked',
      isActive: false,
    });

    const revoked = await manager.ensureSession({
      accountId: 'acct_revoked',
      purpose: 'validate',
    });

    expect(revoked.sessionAvailable).toBe(false);
    expect(revoked.cacheHit).toBe(false);
    expect(revoked.sessionStatus).toBe('revoked');
    expect(revoked.reauthRequired).toBe(true);
    expect(revoked.account.metadata).toEqual(
      expect.objectContaining({
        lastErrorCode: 'ACCOUNT_SESSION_ARTIFACT_INVALID',
        session: expect.objectContaining({
          authKind: 'session-token',
          status: 'revoked',
        }),
      }),
    );

    await expect(manager.getRuntimeSessionMaterial('acct_revoked')).rejects.toMatchObject({
      code: ErrorCode.AI_INVALID_KEY,
    });

    vi.useRealTimers();
  });
});
