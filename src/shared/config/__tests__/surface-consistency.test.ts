import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { SUPPORTED_ACTION_TYPES } from '@core/ai-client/prompts/system';
import { ACTION_TYPES } from '@core/command-parser/schemas/action-schemas';
import { PROVIDER_REGISTRY, SHIPPED_ACTION_TYPES, createDefaultProviderConfigs } from '@shared/config';
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

  it('keeps account-backed provider metadata aligned for codex', () => {
    const codex = PROVIDER_REGISTRY.find((provider) => provider.type === 'codex');

    expect(codex).toMatchObject({
      family: 'chatgpt-account',
      authFamily: 'account-backed',
      authMethod: 'account-import',
      experimental: true,
      requiresCredential: true,
      supportsEndpoint: false,
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
