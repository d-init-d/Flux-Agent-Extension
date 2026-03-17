import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sendExtensionRequest } from '../../shared/extension-client';
import { installOptionsRuntimeMock } from './runtime-mock';

function encodeBase64UrlJson(payload: Record<string, unknown>): string {
  return btoa(JSON.stringify(payload)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '');
}

function createJwt(payload: Record<string, unknown>): string {
  return `${encodeBase64UrlJson({ alg: 'none', typ: 'JWT' })}.${encodeBase64UrlJson(payload)}.signature`;
}

describe('options runtime mock account-backed auth contract', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    installOptionsRuntimeMock();
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
  });

  it('returns codex account-backed auth snapshots for read-only account messages', async () => {
    const observedAt = Date.UTC(2026, 2, 17, 9, 0, 0);
    await chrome.storage.local.set({
      vault: {
        version: 1,
        initialized: true,
        lockState: 'unlocked',
        unlockedAt: observedAt,
        hasLegacySecrets: false,
        credentials: {
          codex: {
            version: 1,
            provider: 'codex',
            providerFamily: 'chatgpt-account',
            authFamily: 'account-backed',
            authKind: 'account-artifact',
            maskedValue: 'acct_****4321',
            updatedAt: observedAt,
          },
        },
        accounts: {
          codex: [
            {
              version: 1,
              provider: 'codex',
              providerFamily: 'chatgpt-account',
              authFamily: 'account-backed',
              accountId: 'acct_codex_primary',
              label: 'Codex Primary',
              maskedIdentifier: 'user@example.com',
              status: 'active',
              isActive: true,
              updatedAt: observedAt,
              metadata: {
                quota: {
                  scope: 'account',
                  unit: 'requests',
                  period: 'day',
                  used: 20,
                  limit: 100,
                  remaining: 80,
                  observedAt,
                },
              },
            },
          ],
        },
        activeAccounts: {
          codex: 'acct_codex_primary',
        },
      },
    });

    const authStatus = await sendExtensionRequest(
      'ACCOUNT_AUTH_STATUS_GET',
      { provider: 'codex' },
      'options',
    );
    expect(authStatus).toEqual(
      expect.objectContaining({
        provider: 'codex',
        status: 'ready',
        availableTransports: ['artifact-import'],
        activeAccountId: 'acct_codex_primary',
        accounts: [expect.objectContaining({ accountId: 'acct_codex_primary' })],
      }),
    );

    const account = await sendExtensionRequest(
      'ACCOUNT_GET',
      { provider: 'codex', accountId: 'acct_codex_primary' },
      'options',
    );
    expect(account.account).toEqual(
      expect.objectContaining({
        accountId: 'acct_codex_primary',
        metadata: expect.objectContaining({
          quota: expect.objectContaining({ remaining: 80 }),
        }),
      }),
    );

    const quota = await sendExtensionRequest(
      'ACCOUNT_QUOTA_STATUS_GET',
      { provider: 'codex' },
      'options',
    );
    expect(quota).toEqual({
      provider: 'codex',
      accountId: 'acct_codex_primary',
      quota: expect.objectContaining({ limit: 100, remaining: 80 }),
    });
  });

  it('keeps auth exchange deferred but surfaces baseline account-store mutations', async () => {
    const observedAt = Date.UTC(2026, 2, 17, 9, 0, 0);
    const idToken = createJwt({
      email: 'imported@example.com',
      'https://api.openai.com/auth': {
        chatgpt_plan_type: 'pro',
        chatgpt_user_id: 'user_imported',
      },
    });
    await chrome.storage.local.set({
      vault: {
        version: 1,
        initialized: true,
        lockState: 'unlocked',
        unlockedAt: observedAt,
        hasLegacySecrets: false,
        credentials: {
          codex: {
            version: 1,
            provider: 'codex',
            providerFamily: 'chatgpt-account',
            authFamily: 'account-backed',
            authKind: 'account-artifact',
            maskedValue: 'acct_****4321',
            updatedAt: observedAt,
          },
        },
        accounts: {
          codex: [
            {
              version: 1,
              provider: 'codex',
              providerFamily: 'chatgpt-account',
              authFamily: 'account-backed',
              accountId: 'acct_codex_primary',
              label: 'Codex Primary',
              maskedIdentifier: 'user@example.com',
              status: 'active',
              isActive: true,
              updatedAt: observedAt,
            },
            {
              version: 1,
              provider: 'codex',
              providerFamily: 'chatgpt-account',
              authFamily: 'account-backed',
              accountId: 'acct_codex_backup',
              label: 'Codex Backup',
              maskedIdentifier: 'backup@example.com',
              status: 'available',
              isActive: false,
              updatedAt: observedAt,
            },
          ],
        },
        activeAccounts: {
          codex: 'acct_codex_primary',
        },
      },
    });

    await expect(
      sendExtensionRequest(
        'ACCOUNT_AUTH_CONNECT_START',
        {
          provider: 'codex',
          transport: 'artifact-import',
          artifact: {
            format: 'json',
            value: JSON.stringify({
              auth_mode: 'chatgpt',
              tokens: {
                access_token: 'access-imported',
                id_token: idToken,
                refresh_token: 'refresh-imported',
              },
            }),
          },
        },
        'options',
      ),
    ).resolves.toEqual({
      provider: 'codex',
      transport: 'artifact-import',
      accepted: true,
      nextStep: 'validate',
      message: 'Imported ChatGPT Pro account (im***@example.com). Run validation to confirm the persisted auth state.',
    });

    await expect(
      sendExtensionRequest(
        'ACCOUNT_AUTH_VALIDATE',
        { provider: 'codex', accountId: 'acct_5aea75ff65d29e4c' },
        'options',
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        provider: 'codex',
        valid: true,
        checkedAt: expect.any(Number),
        account: expect.objectContaining({
          accountId: 'acct_5aea75ff65d29e4c',
          maskedIdentifier: 'im***@example.com',
          validatedAt: expect.any(Number),
        }),
      }),
    );

    const activation = await sendExtensionRequest(
      'ACCOUNT_ACTIVATE',
      { provider: 'codex', accountId: 'acct_codex_backup' },
      'options',
    );
    expect(activation).toEqual({
      provider: 'codex',
      accountId: 'acct_codex_backup',
      activeAccountId: 'acct_codex_backup',
    });

    const revoke = await sendExtensionRequest(
      'ACCOUNT_REVOKE',
      { provider: 'codex', accountId: 'acct_codex_backup' },
      'options',
    );
    expect(revoke).toEqual({
      provider: 'codex',
      accountId: 'acct_codex_backup',
      revoked: true,
    });

    const remove = await sendExtensionRequest(
      'ACCOUNT_REMOVE',
      { provider: 'codex', accountId: 'acct_codex_primary' },
      'options',
    );
    expect(remove).toEqual({
      provider: 'codex',
      accountId: 'acct_codex_primary',
      removed: true,
    });

    const refreshedQuota = await sendExtensionRequest(
      'ACCOUNT_QUOTA_REFRESH',
      { provider: 'codex', accountId: 'acct_codex_backup' },
      'options',
    );
    expect(refreshedQuota).toEqual({
      provider: 'codex',
      accountId: 'acct_codex_backup',
      quota: undefined,
      refreshedAt: expect.any(Number),
    });

    const accountList = await sendExtensionRequest('ACCOUNT_LIST', { provider: 'codex' }, 'options');
    expect(accountList).toEqual(
      expect.objectContaining({
        provider: 'codex',
        activeAccountId: undefined,
        accounts: expect.arrayContaining([
          expect.objectContaining({
            accountId: 'acct_5aea75ff65d29e4c',
            status: 'available',
            isActive: false,
          }),
          expect.objectContaining({
            accountId: 'acct_codex_backup',
            status: 'revoked',
            isActive: false,
            stale: true,
          }),
        ]),
      }),
    );

  });
});
