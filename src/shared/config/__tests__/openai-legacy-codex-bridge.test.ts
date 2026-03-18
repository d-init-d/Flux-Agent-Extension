import {
  createBridgedOpenAIVaultSurface,
  createDefaultProviderConfigs,
  resolveOpenAIAccountSurfaceSource,
  shouldBridgeLegacyCodexToOpenAI,
} from '@shared/config';
import type { VaultState } from '@shared/types';
import { describe, expect, it } from 'vitest';

function createBaseVaultState(): VaultState {
  return {
    version: 1,
    initialized: true,
    lockState: 'unlocked',
    unlockedAt: Date.UTC(2026, 2, 19, 10, 0, 0),
    hasLegacySecrets: false,
    credentials: {},
    accounts: {},
    activeAccounts: {},
    browserLogins: {},
  };
}

describe('openai legacy codex bridge', () => {
  it('bridges legacy codex state onto the openai browser-account surface only when explicit openai state is absent', () => {
    const providers = {
      codex: {
        enabled: true,
        model: 'codex-latest',
        maxTokens: 8192,
        temperature: 0.2,
      },
    };
    const vault: VaultState = {
      ...createBaseVaultState(),
      credentials: {
        codex: {
          version: 1,
          provider: 'codex',
          providerFamily: 'chatgpt-account',
          authFamily: 'account-backed',
          authKind: 'account-artifact',
          maskedValue: 'acct_****2468',
          updatedAt: Date.UTC(2026, 2, 19, 10, 0, 0),
          validatedAt: Date.UTC(2026, 2, 19, 10, 0, 0),
        },
      },
      accounts: {
        codex: [
          {
            version: 1,
            provider: 'codex',
            providerFamily: 'chatgpt-account',
            authFamily: 'account-backed',
            accountId: 'acct_legacy_bridge',
            label: 'Legacy Bridge Account',
            status: 'active',
            isActive: true,
            updatedAt: Date.UTC(2026, 2, 19, 10, 0, 0),
            validatedAt: Date.UTC(2026, 2, 19, 10, 0, 0),
          },
        ],
      },
      activeAccounts: {
        codex: 'acct_legacy_bridge',
      },
    };

    expect(shouldBridgeLegacyCodexToOpenAI(providers, vault)).toBe(true);
    expect(resolveOpenAIAccountSurfaceSource(providers, vault)).toBe('codex');

    const bridged = createBridgedOpenAIVaultSurface(providers, vault);
    expect(bridged.accounts.openai).toEqual([
      expect.objectContaining({
        provider: 'openai',
        providerFamily: 'default',
        accountId: 'acct_legacy_bridge',
      }),
    ]);
    expect(bridged.browserLogins?.openai).toEqual(
      expect.objectContaining({
        status: 'success',
        accountId: 'acct_legacy_bridge',
      }),
    );
  });

  it('does not synthesize a success browser-login state from orphaned codex credential metadata alone', () => {
    const providers = {
      ...createDefaultProviderConfigs(),
    };
    const vault: VaultState = {
      ...createBaseVaultState(),
      credentials: {
        codex: {
          version: 1,
          provider: 'codex',
          providerFamily: 'chatgpt-account',
          authFamily: 'account-backed',
          authKind: 'account-artifact',
          maskedValue: 'acct_****9999',
          updatedAt: Date.UTC(2026, 2, 19, 11, 0, 0),
        },
      },
    };

    const bridged = createBridgedOpenAIVaultSurface(providers, vault);
    expect(bridged.browserLogins?.openai).toBeUndefined();
  });
});
