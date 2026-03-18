import type { AIProviderType, ProviderAccountRecord, ProviderBrowserLoginState, ProviderConfig, ProviderCredentialRecord, VaultState } from '../types';

import { getOpenAIDefaultModel } from './openai-model-catalog';

type ProviderConfigMap = Partial<Record<AIProviderType, Partial<ProviderConfig>>>;

function hasStoredProviderState(provider: AIProviderType, providers: ProviderConfigMap, vault: VaultState): boolean {
  return (
    providers[provider] !== undefined ||
    vault.credentials[provider] !== undefined ||
    Boolean(vault.browserLogins?.[provider]) ||
    Boolean(vault.activeAccounts[provider]?.trim()) ||
    (vault.accounts[provider]?.length ?? 0) > 0
  );
}

function mapCredentialToOpenAI(record: ProviderCredentialRecord): ProviderCredentialRecord {
  return {
    ...record,
    provider: 'openai',
    providerFamily: 'default',
  };
}

function mapAccountToOpenAI(account: ProviderAccountRecord): ProviderAccountRecord {
  return {
    ...account,
    provider: 'openai',
    providerFamily: 'default',
  };
}

function createSyntheticOpenAIBrowserLogin(vault: VaultState): ProviderBrowserLoginState | undefined {
  const sourceCredential = vault.credentials.codex;
  const sourceAccounts = vault.accounts.codex ?? [];
  const activeAccountId = vault.activeAccounts.codex?.trim();
  const activeAccount =
    sourceAccounts.find((account) => account.accountId === activeAccountId) ??
    sourceAccounts.find((account) => account.isActive) ??
    sourceAccounts[0];

  if (!sourceCredential && !activeAccount) {
    return undefined;
  }

  if (!activeAccount) {
    return undefined;
  }

  const updatedAt = Math.max(
    sourceCredential?.updatedAt ?? 0,
    activeAccount?.updatedAt ?? 0,
    activeAccount?.validatedAt ?? 0,
  );

  return {
    authMethod: 'browser-account',
    status: 'success',
    updatedAt,
    lastAttemptAt: updatedAt,
    lastCompletedAt: activeAccount?.validatedAt ?? updatedAt,
    accountId: activeAccount?.accountId,
    accountLabel: activeAccount?.label,
    retryable: false,
  };
}

export function hasExplicitOpenAISurfaceState(
  providers: ProviderConfigMap,
  vault: VaultState,
): boolean {
  return hasStoredProviderState('openai', providers, vault);
}

export function hasLegacyCodexSurfaceState(
  providers: ProviderConfigMap,
  vault: VaultState,
): boolean {
  return hasStoredProviderState('codex', providers, vault);
}

export function shouldBridgeLegacyCodexToOpenAI(
  providers: ProviderConfigMap,
  vault: VaultState,
): boolean {
  return !hasExplicitOpenAISurfaceState(providers, vault) && hasLegacyCodexSurfaceState(providers, vault);
}

export function resolveOpenAIAccountSurfaceSource(
  providers: ProviderConfigMap,
  vault: VaultState,
): 'openai' | 'codex' {
  return shouldBridgeLegacyCodexToOpenAI(providers, vault) ? 'codex' : 'openai';
}

export function createBridgedOpenAIProviderConfig(
  providers: ProviderConfigMap,
  vault: VaultState,
  defaults: Record<AIProviderType, ProviderConfig>,
): ProviderConfig | undefined {
  if (!shouldBridgeLegacyCodexToOpenAI(providers, vault)) {
    return undefined;
  }

  const legacyConfig = providers.codex;
  return {
    ...defaults.openai,
    enabled: legacyConfig?.enabled ?? defaults.openai.enabled,
    model:
      typeof legacyConfig?.model === 'string' && legacyConfig.model.trim().length > 0
        ? legacyConfig.model
        : getOpenAIDefaultModel('browser-account'),
    maxTokens:
      typeof legacyConfig?.maxTokens === 'number'
        ? legacyConfig.maxTokens
        : defaults.openai.maxTokens,
    temperature:
      typeof legacyConfig?.temperature === 'number'
        ? legacyConfig.temperature
        : defaults.openai.temperature,
    authChoiceId: 'browser-account',
  };
}

export function createBridgedOpenAIVaultSurface(
  providers: ProviderConfigMap,
  vault: VaultState,
): VaultState {
  if (!shouldBridgeLegacyCodexToOpenAI(providers, vault)) {
    return vault;
  }

  const nextCredentials = { ...vault.credentials };
  const nextAccounts = { ...vault.accounts };
  const nextActiveAccounts = { ...vault.activeAccounts };
  const nextBrowserLogins = { ...(vault.browserLogins ?? {}) };

  if (!nextCredentials.openai && vault.credentials.codex) {
    nextCredentials.openai = mapCredentialToOpenAI(vault.credentials.codex);
  }

  if (!nextAccounts.openai && vault.accounts.codex) {
    nextAccounts.openai = vault.accounts.codex.map(mapAccountToOpenAI);
  }

  if (!nextActiveAccounts.openai && vault.activeAccounts.codex) {
    nextActiveAccounts.openai = vault.activeAccounts.codex;
  }

  if (!nextBrowserLogins.openai) {
    const browserLogin = createSyntheticOpenAIBrowserLogin(vault);
    if (browserLogin) {
      nextBrowserLogins.openai = browserLogin;
    }
  }

  return {
    ...vault,
    credentials: nextCredentials,
    accounts: nextAccounts,
    activeAccounts: nextActiveAccounts,
    browserLogins: Object.keys(nextBrowserLogins).length > 0 ? nextBrowserLogins : undefined,
  };
}
