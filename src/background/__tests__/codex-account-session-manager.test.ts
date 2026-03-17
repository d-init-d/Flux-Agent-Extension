import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as codexAccountImport from '../../core/auth/codex-account-import';
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
});
