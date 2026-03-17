import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sendExtensionRequest } from '../../shared/extension-client';
import { installOptionsRuntimeMock } from './runtime-mock';

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

  it('fails loudly for deferred account-backed mutation messages', async () => {
    await expect(
      sendExtensionRequest(
        'ACCOUNT_AUTH_CONNECT_START',
        {
          provider: 'codex',
          transport: 'artifact-import',
          artifact: {
            format: 'json',
            value: '{"refresh_token":"opaque"}',
          },
        },
        'options',
      ),
    ).rejects.toThrow(/not implemented/i);

    await expect(
      sendExtensionRequest(
        'ACCOUNT_ACTIVATE',
        { provider: 'codex', accountId: 'acct_codex_primary' },
        'options',
      ),
    ).rejects.toThrow(/not implemented/i);
  });
});
