import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { LAZY_LOADABLE_PROVIDER_TYPES } from '@core/ai-client/provider-loader';
import { SUPPORTED_ACTION_TYPES } from '@core/ai-client/prompts/system';
import { ACTION_TYPES } from '@core/command-parser/schemas/action-schemas';
import {
  PROVIDER_REGISTRY,
  SHIPPED_ACTION_TYPES,
  createDefaultProviderConfigs,
  getPrimaryProviderAuthChoice,
  getProviderAuthChoices,
  providerRequiresConnectionValidation,
  providerSupportsMultipleAuthChoices,
  providerUsesAccountImport,
} from '@shared/config';
import { describe, expect, it } from 'vitest';

describe('shared surface consistency', () => {
  it('keeps the shipped action surface aligned across config, parser, and prompt', () => {
    expect([...ACTION_TYPES]).toEqual([...SHIPPED_ACTION_TYPES]);
    expect([...SUPPORTED_ACTION_TYPES]).toEqual([...SHIPPED_ACTION_TYPES]);
  });

  it('keeps default provider configs aligned with the provider registry', () => {
    const providerTypes = PROVIDER_REGISTRY.map((provider) => provider.type).sort();
    const configuredProviders = Object.keys(createDefaultProviderConfigs()).sort();

    expect(configuredProviders).toEqual(providerTypes);
  });

  it('keeps the lazy provider loader aligned with the registry runtime surface', () => {
    const loadableProviderTypes = PROVIDER_REGISTRY.filter((provider) => provider.type !== 'custom')
      .map((provider) => provider.type)
      .sort();

    expect([...LAZY_LOADABLE_PROVIDER_TYPES].sort()).toEqual(loadableProviderTypes);
  });

  it('keeps account-backed provider metadata aligned for codex', () => {
    const codex = PROVIDER_REGISTRY.find((provider) => provider.type === 'codex');

    expect(codex).toMatchObject({
      family: 'chatgpt-account',
      authFamily: 'account-backed',
      authMethod: 'account-import',
      surfaceExposure: 'legacy-internal',
      experimental: true,
      requiresCredential: true,
      supportsEndpoint: false,
    });
    expect(providerUsesAccountImport('codex')).toBe(true);
    expect(providerRequiresConnectionValidation('codex')).toBe(true);
  });

  it('keeps cliproxyapi metadata aligned with the OpenAI-compatible local default', () => {
    const cliproxyapi = PROVIDER_REGISTRY.find((provider) => provider.type === 'cliproxyapi');

    expect(cliproxyapi).toMatchObject({
      family: 'default',
      tier: 'core',
      authFamily: 'api-key',
      authMethod: 'api-key',
      requiresCredential: true,
      supportsEndpoint: true,
      endpointPlaceholder: 'http://127.0.0.1:8317 or https://your-domain/v1',
    });
    expect(providerRequiresConnectionValidation('cliproxyapi')).toBe(true);
  });

  it('keeps the OpenAI auth surface ordered while preserving the legacy-safe primary lane', () => {
    const openai = PROVIDER_REGISTRY.find((provider) => provider.type === 'openai');

    expect(openai).toMatchObject({
      authFamily: 'api-key',
      authMethod: 'api-key',
    });
    expect(providerSupportsMultipleAuthChoices('openai')).toBe(true);
    expect(getProviderAuthChoices('openai')).toEqual([
      {
        id: 'browser-account',
        label: 'ChatGPT Pro/Plus (browser)',
        authFamily: 'account-backed',
        authMethod: 'browser-login',
        description: 'Future browser-helper login lane for ChatGPT Pro/Plus accounts.',
      },
      {
        id: 'api-key',
        label: 'Manually enter API Key',
        authFamily: 'api-key',
        authMethod: 'api-key',
        description: 'Legacy-safe OpenAI API key flow used by the current runtime.',
      },
    ]);
    expect(getPrimaryProviderAuthChoice('openai')).toEqual({
      id: 'api-key',
      label: 'Manually enter API Key',
      authFamily: 'api-key',
      authMethod: 'api-key',
      description: 'Legacy-safe OpenAI API key flow used by the current runtime.',
    });
  });

  it('keeps single-auth providers readable through the shared auth-choice helper', () => {
    expect(providerSupportsMultipleAuthChoices('claude')).toBe(false);
    expect(getProviderAuthChoices('claude')).toEqual([
      {
        id: 'api-key',
        label: 'Claude',
        authFamily: 'api-key',
        authMethod: 'api-key',
      },
    ]);
    expect(getPrimaryProviderAuthChoice('claude')).toEqual({
      id: 'api-key',
      label: 'Claude',
      authFamily: 'api-key',
      authMethod: 'api-key',
    });
  });

  it('keeps the README permission list aligned with the manifest', () => {
    const repoRoot = resolve(__dirname, '../../../../');
    const manifest = JSON.parse(readFileSync(resolve(repoRoot, 'src/manifest.json'), 'utf-8')) as {
      permissions: string[];
      host_permissions: string[];
    };
    const readme = readFileSync(resolve(repoRoot, 'README.md'), 'utf-8');
    const permissionsMarker = 'The manifest currently declares these permissions:';
    const hostMarker = 'Host permissions are currently';
    const permissionsStart = readme.indexOf(permissionsMarker);
    const permissionsEnd = readme.indexOf(hostMarker);

    expect(permissionsStart).toBeGreaterThanOrEqual(0);
    expect(permissionsEnd).toBeGreaterThan(permissionsStart);

    const permissionsSection = readme
      .slice(permissionsStart + permissionsMarker.length, permissionsEnd)
      .trim();
    const documentedPermissions = permissionsSection
      .split('\n')
      .map((line) => line.replace(/\r$/, '').trim())
      .filter((line) => line.startsWith('- `'))
      .map((line) => line.slice(3, -1));

    expect(documentedPermissions).toEqual(manifest.permissions);
    expect(readme).toContain('Host permissions are currently `"<all_urls>"`');
    expect(manifest.host_permissions).toEqual(['<all_urls>']);
  });
});
