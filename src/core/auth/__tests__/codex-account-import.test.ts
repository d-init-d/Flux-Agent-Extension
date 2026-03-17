import { describe, expect, it } from 'vitest';

import { importCodexAccountArtifact } from '../codex-account-import';

function encodeBase64UrlJson(payload: Record<string, unknown>): string {
  return btoa(JSON.stringify(payload)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '');
}

function createJwt(payload: Record<string, unknown>): string {
  return `${encodeBase64UrlJson({ alg: 'none', typ: 'JWT' })}.${encodeBase64UrlJson(payload)}.signature`;
}

describe('importCodexAccountArtifact', () => {
  it('parses official Codex auth.json artifacts', async () => {
    const idToken = createJwt({
      email: 'User@example.com',
      'https://api.openai.com/auth': {
        chatgpt_plan_type: 'plus',
        chatgpt_user_id: 'user_123',
        chatgpt_account_id: 'acct_workspace_001',
      },
    });

    const artifact = await importCodexAccountArtifact(
      {
        format: 'json',
        value: JSON.stringify({
          auth_mode: 'chatgpt',
          last_refresh: '2026-03-17T09:00:00.000Z',
          tokens: {
            access_token: 'access-token',
            id_token: idToken,
            refresh_token: 'refresh-token',
            account_id: 'acct_primary',
          },
        }),
      },
      { label: undefined },
    );

    expect(artifact.source).toBe('official-auth-json');
    expect(artifact.authMode).toBe('chatgpt');
    expect(artifact.tokens.accountId).toBe('acct_primary');
    expect(artifact.identity).toEqual(
      expect.objectContaining({
        email: 'user@example.com',
        plan: 'Plus',
        chatgptUserId: 'user_123',
        chatgptAccountId: 'acct_workspace_001',
      }),
    );
    expect(artifact.derived).toEqual(
      expect.objectContaining({
        accountId: 'acct_primary',
        maskedIdentifier: 'us***@example.com',
        label: 'ChatGPT Plus account (us***@example.com)',
        credentialMaskedValue: 'chatgpt:us***@example.com',
      }),
    );
    expect(artifact.lastRefreshAt).toBe(Date.parse('2026-03-17T09:00:00.000Z'));
  });

  it('parses text token bundles for artifact import', async () => {
    const idToken = createJwt({
      'https://api.openai.com/profile': {
        email: 'backup@example.com',
      },
      'https://api.openai.com/auth': {
        chatgpt_plan_type: 'pro',
        chatgpt_user_id: 'user_backup',
      },
    });

    const artifact = await importCodexAccountArtifact({
      format: 'text',
      value: [
        'auth_mode=chatgpt',
        'account_id=acct_backup',
        'access_token=access-token',
        `id_token=${idToken}`,
        'refresh_token=refresh-token',
      ].join('\n'),
    });

    expect(artifact.source).toBe('text-bundle');
    expect(artifact.storageFormat).toBe('text');
    expect(artifact.derived).toEqual(
      expect.objectContaining({
        accountId: 'acct_backup',
        maskedIdentifier: 'ba***@example.com',
        label: 'ChatGPT Pro account (ba***@example.com)',
      }),
    );
  });

  it('rejects artifacts without the required baseline token bundle', async () => {
    await expect(
      importCodexAccountArtifact({
        format: 'json',
        value: JSON.stringify({
          auth_mode: 'chatgpt',
          tokens: { refresh_token: 'refresh-only' },
        }),
      }),
    ).rejects.toThrow(/requires refresh_token and id_token/i);
  });
});
