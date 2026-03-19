import { describe, expect, it } from 'vitest';

import { resolveKeyBasedProviderUx } from '../key-based-provider-ux';

describe('resolveKeyBasedProviderUx', () => {
  it('returns a CLIProxyAPI-specific missing-endpoint state before credentials are considered', () => {
    const ux = resolveKeyBasedProviderUx('cliproxyapi', {
      config: { customEndpoint: '' },
      vaultLockState: 'unlocked',
    });

    expect(ux).toEqual(
      expect.objectContaining({
        state: 'missing-endpoint',
        badgeLabel: 'Endpoint required',
        title: 'Add a CLIProxyAPI endpoint',
        blocksRuntime: true,
      }),
    );
  });

  it('returns needs-validation for cliproxyapi after endpoint save but before a live test passes', () => {
    const ux = resolveKeyBasedProviderUx('cliproxyapi', {
      config: { customEndpoint: 'https://proxy.example.com/v1' },
      credential: {
        version: 1,
        provider: 'cliproxyapi',
        providerFamily: 'default',
        authFamily: 'api-key',
        authKind: 'api-key',
        maskedValue: '********',
        updatedAt: Date.UTC(2026, 2, 18, 12, 0, 0),
      },
      vaultLockState: 'unlocked',
    });

    expect(ux).toEqual(
      expect.objectContaining({
        state: 'needs-validation',
        badgeLabel: 'Test connection',
        title: 'CLIProxyAPI endpoint saved but unvalidated',
        blocksRuntime: true,
      }),
    );
  });

  it('returns stale for cliproxyapi when the validated credential changed after the last test', () => {
    const ux = resolveKeyBasedProviderUx('cliproxyapi', {
      config: { customEndpoint: 'https://proxy.example.com/v1' },
      credential: {
        version: 1,
        provider: 'cliproxyapi',
        providerFamily: 'default',
        authFamily: 'api-key',
        authKind: 'api-key',
        maskedValue: '********',
        updatedAt: Date.UTC(2026, 2, 18, 12, 30, 0),
        validatedAt: Date.UTC(2026, 2, 18, 12, 0, 0),
        stale: true,
      },
      vaultLockState: 'unlocked',
    });

    expect(ux).toEqual(
      expect.objectContaining({
        state: 'stale',
        badgeLabel: 'Re-test required',
        title: 'CLIProxyAPI settings changed after validation',
        blocksRuntime: true,
      }),
    );
  });

  it('returns ready only when cliproxyapi endpoint and credential are both validated', () => {
    const ux = resolveKeyBasedProviderUx('cliproxyapi', {
      config: { customEndpoint: 'https://proxy.example.com/v1' },
      credential: {
        version: 1,
        provider: 'cliproxyapi',
        providerFamily: 'default',
        authFamily: 'api-key',
        authKind: 'api-key',
        maskedValue: '********',
        updatedAt: Date.UTC(2026, 2, 18, 13, 0, 0),
        validatedAt: Date.UTC(2026, 2, 18, 13, 0, 0),
        stale: false,
      },
      vaultLockState: 'unlocked',
    });

    expect(ux).toEqual(
      expect.objectContaining({
        state: 'ready',
        badgeLabel: 'Ready',
        title: 'CLIProxyAPI is ready',
        blocksRuntime: false,
      }),
    );
  });

  it('keeps non-CLI providers on the generic missing-credential copy path', () => {
    const ux = resolveKeyBasedProviderUx('openai', {
      vaultLockState: 'unlocked',
    });

    expect(ux).toEqual(
      expect.objectContaining({
        state: 'missing-credential',
        badgeLabel: 'Credential missing',
        title: 'Add a OpenAI API key',
        blocksRuntime: true,
      }),
    );
  });

  it('does not surface vault-locked for auth-store-backed API-key credentials', () => {
    const ux = resolveKeyBasedProviderUx('openai', {
      credential: {
        version: 1,
        provider: 'openai',
        providerFamily: 'default',
        authFamily: 'api-key',
        authKind: 'api-key',
        storageSource: 'auth-store',
        maskedValue: 'sk-****store',
        updatedAt: Date.UTC(2026, 2, 19, 18, 0, 0),
        validatedAt: Date.UTC(2026, 2, 19, 18, 0, 0),
      },
      vaultLockState: 'locked',
    });

    expect(ux).toEqual(
      expect.objectContaining({
        state: 'ready',
        badgeLabel: 'Ready',
        blocksRuntime: false,
      }),
    );
  });
});
