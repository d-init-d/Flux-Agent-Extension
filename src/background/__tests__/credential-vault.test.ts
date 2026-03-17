import { beforeEach, describe, expect, it } from 'vitest';

import { CredentialVault } from '../credential-vault';

describe('CredentialVault account store', () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
  });

  it('upserts, activates, revokes, removes, and reads quota metadata for codex accounts', async () => {
    const vault = new CredentialVault();
    await vault.init('test-passphrase');

    const primary = await vault.saveAccount('codex', {
      accountId: 'acct_primary',
      label: 'Primary Codex Account',
      maskedIdentifier: 'primary@example.com',
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
        value: '{"refresh_token":"opaque"}',
        filename: 'codex-account.json',
      },
    });

    expect(primary.credentialKey).toBe('account-artifact::codex::acct_primary');
    const encryptedArtifact = await chrome.storage.local.get(
      '__encrypted__account-artifact::codex::acct_primary',
    );
    expect(encryptedArtifact['__encrypted__account-artifact::codex::acct_primary']).toEqual(
      expect.any(String),
    );

    await vault.saveAccount('codex', {
      accountId: 'acct_backup',
      label: 'Backup Codex Account',
      maskedIdentifier: 'backup@example.com',
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
});
