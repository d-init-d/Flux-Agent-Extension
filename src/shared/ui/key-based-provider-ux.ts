import type { BadgeVariant } from '@/ui/components';
import {
  PROVIDER_LOOKUP,
  providerUsesOAuthToken,
} from '@shared/config';
import { evaluateProviderEndpointPolicy } from '@shared/provider-endpoints';
import type {
  AIProviderType,
  ProviderConfig,
  ProviderCredentialRecord,
  VaultLockState,
} from '@shared/types';

export type KeyBasedUxState =
  | 'missing-endpoint'
  | 'missing-credential'
  | 'vault-locked'
  | 'needs-validation'
  | 'stale'
  | 'ready';

export interface KeyBasedProviderUx {
  state: KeyBasedUxState;
  badgeLabel: string;
  badgeVariant: BadgeVariant;
  title: string;
  detail: string;
  action: string;
  blocksRuntime: boolean;
}

interface ResolveKeyBasedProviderUxOptions {
  config?: Partial<ProviderConfig>;
  credential?: ProviderCredentialRecord;
  vaultLockState: VaultLockState;
}

function isCLIProxyAPI(provider: AIProviderType): boolean {
  return provider === 'cliproxyapi';
}

export function resolveKeyBasedProviderUx(
  provider: AIProviderType,
  options: ResolveKeyBasedProviderUxOptions,
): KeyBasedProviderUx {
  const definition = PROVIDER_LOOKUP[provider];
  const credentialLabel = providerUsesOAuthToken(definition) ? 'token' : 'API key';
  const credential = options.credential;
  const hasCredential = Boolean(credential);
  const credentialSource = credential?.storageSource ?? 'vault';
  const endpointPolicy = definition.supportsEndpoint
    ? evaluateProviderEndpointPolicy(provider, options.config?.customEndpoint)
    : { valid: true };

  if (isCLIProxyAPI(provider) && !endpointPolicy.valid) {
    return {
      state: 'missing-endpoint',
      badgeLabel: 'Endpoint required',
      badgeVariant: 'warning',
      title: 'Add a CLIProxyAPI endpoint',
      detail:
        'CLIProxyAPI is endpoint-driven. Flux cannot treat it as ready until a valid local or hosted /v1 endpoint is saved.',
      action:
        'Save the CLIProxyAPI endpoint first, then run Test connection to confirm the saved endpoint and credential together.',
      blocksRuntime: true,
    };
  }

  if (definition.requiresCredential && !hasCredential) {
    return {
      state: 'missing-credential',
      badgeLabel: providerUsesOAuthToken(definition) ? 'Connect account' : 'Credential missing',
      badgeVariant: 'warning',
      title: isCLIProxyAPI(provider)
        ? 'Add a CLIProxyAPI API key'
        : `Add a ${definition.label} ${credentialLabel}`,
      detail: isCLIProxyAPI(provider)
        ? 'The CLIProxyAPI endpoint can be saved, but runtime requests stay blocked until an API key is saved locally.'
        : `${definition.label} still needs a locally saved ${credentialLabel} before live requests can run.`,
      action: isCLIProxyAPI(provider)
        ? 'Save the API key locally, then run Test connection so Flux can mark CLIProxyAPI ready.'
        : `Save the ${credentialLabel} locally, then run Test connection before relying on this provider.`,
      blocksRuntime: true,
    };
  }

  if (options.vaultLockState !== 'unlocked' && hasCredential && credentialSource === 'vault') {
    return {
      state: 'vault-locked',
      badgeLabel: 'Stored credential unavailable',
      badgeVariant: 'warning',
      title: isCLIProxyAPI(provider)
        ? 'CLIProxyAPI needs a fresh local credential'
        : `${definition.label} needs a fresh local credential`,
      detail: isCLIProxyAPI(provider)
        ? 'CLIProxyAPI has saved settings, but the stored endpoint and API key are unavailable in the current session.'
        : `${definition.label} has a saved credential, but it is unavailable in the current session.`,
      action:
        'Open provider settings, save the credential again if needed, then re-run Test connection before relying on this provider.',
      blocksRuntime: true,
    };
  }

  if (credential?.stale) {
    return {
      state: 'stale',
      badgeLabel: 'Re-test required',
      badgeVariant: 'warning',
      title: isCLIProxyAPI(provider)
        ? 'CLIProxyAPI settings changed after validation'
        : `${definition.label} settings changed after validation`,
      detail: isCLIProxyAPI(provider)
        ? 'The saved CLIProxyAPI endpoint or credential changed after the last successful connection test, so Flux no longer treats it as ready.'
        : `The saved ${definition.label} settings changed after the last successful connection test, so Flux no longer treats it as ready.`,
      action: 'Run Test connection again before relying on popup quick actions or sidepanel chat.',
      blocksRuntime: true,
    };
  }

  if (definition.requiresCredential && !credential?.validatedAt) {
    return {
      state: 'needs-validation',
      badgeLabel: isCLIProxyAPI(provider) ? 'Test connection' : 'Validate connection',
      badgeVariant: 'info',
      title: isCLIProxyAPI(provider)
        ? 'CLIProxyAPI endpoint saved but unvalidated'
        : `${definition.label} is saved but unvalidated`,
      detail: isCLIProxyAPI(provider)
        ? 'Flux sees a saved CLIProxyAPI endpoint and local API key, but readiness stays blocked until a live connection test succeeds.'
        : `Flux sees a locally saved ${definition.label} credential, but readiness stays blocked until a live connection test succeeds.`,
      action: isCLIProxyAPI(provider)
        ? 'Keep the saved endpoint, then run Test connection. Flux marks CLIProxyAPI ready only after that validation passes.'
        : 'Run Test connection before relying on this provider in popup or sidepanel workflows.',
      blocksRuntime: true,
    };
  }

  return {
    state: 'ready',
    badgeLabel: 'Ready',
    badgeVariant: 'success',
    title: isCLIProxyAPI(provider) ? 'CLIProxyAPI is ready' : `${definition.label} is ready`,
    detail: isCLIProxyAPI(provider)
      ? 'The saved CLIProxyAPI endpoint and local API key passed validation, so popup quick actions and sidepanel sends can use the real provider state.'
      : `${definition.label} has a validated locally saved credential and can back popup or sidepanel requests.`,
    action: isCLIProxyAPI(provider)
      ? 'If the endpoint or key changes later, save again and re-run Test connection before relying on it.'
      : 'If requests fail later, re-run Test connection before relying on this provider again.',
    blocksRuntime: false,
  };
}
