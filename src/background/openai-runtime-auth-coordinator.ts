import {
  hasExplicitOpenAISurfaceState,
  normalizeOpenAIAuthChoiceId,
  resolveOpenAIAccountSurfaceSource,
  resolveOpenAIRuntimeRoute,
} from '@shared/config';
import { ErrorCode, ExtensionError } from '@shared/errors';
import type {
  ExtensionSettings,
  ProviderAccountRecord,
  ProviderConfig,
  SessionConfig,
  VaultState,
} from '@shared/types';

import { CredentialVault } from './credential-vault';
import { CodexAccountSessionManager } from './codex-account-session-manager';

interface OpenAIRuntimeCoordinatorState {
  settings: ExtensionSettings;
  providers: Partial<Record<SessionConfig['provider'], Partial<ProviderConfig>>>;
  rawProviders?: Partial<Record<SessionConfig['provider'], Partial<ProviderConfig>>>;
  activeProvider: SessionConfig['provider'];
  onboarding: unknown;
  vault: VaultState;
  rawVault?: VaultState;
}

export interface OpenAIRuntimeResolution {
  lane: 'api-key' | 'browser-account';
  runtimeProvider: SessionConfig['provider'];
  credential: string;
  model: string;
}

export class OpenAIRuntimeAuthCoordinator {
  constructor(
    private readonly credentialVault: CredentialVault,
    private readonly browserAccountSessionManager: CodexAccountSessionManager,
    private readonly legacyCodexSessionManager: CodexAccountSessionManager,
  ) {}

  async resolve(
    runtimeState: OpenAIRuntimeCoordinatorState,
    requestedModel: string,
  ): Promise<OpenAIRuntimeResolution> {
    const sourceProviders = runtimeState.rawProviders ?? runtimeState.providers;
    const sourceVault = runtimeState.rawVault ?? runtimeState.vault;
    const configuredLane = this.resolveConfiguredLane(runtimeState);
    const route = resolveOpenAIRuntimeRoute(configuredLane, requestedModel);
    if (route.mismatch) {
      throw new ExtensionError(
        ErrorCode.AI_INVALID_KEY,
        `OpenAI model "${route.mismatch.model}" belongs to the ${route.mismatch.actualLane} lane, but the selected login method requires the ${route.mismatch.expectedLane} lane. Switch lanes or keep a manual override model id for the chosen lane.`,
        false,
      );
    }

    if (configuredLane === 'api-key') {
      const credential = await this.requireApiKeyCredential(runtimeState);
      return {
        lane: 'api-key',
        runtimeProvider: 'openai',
        credential,
        model: route.model,
      };
    }

    const accountSource = resolveOpenAIAccountSurfaceSource(sourceProviders, sourceVault);
    const credentialRecord = sourceVault.credentials[accountSource];
    const activeAccountId = sourceVault.activeAccounts[accountSource]?.trim();
    const browserState = runtimeState.vault.browserLogins?.openai;

    this.assertVaultUnlocked(runtimeState);

    if (accountSource === 'openai' && browserState && browserState.status !== 'success') {
      throw new ExtensionError(
        ErrorCode.AI_INVALID_KEY,
        `OpenAI browser-account auth is not ready yet (state: ${browserState.status}). Complete browser auth before starting chat.`,
        false,
      );
    }

    if (!credentialRecord || credentialRecord.authFamily !== 'account-backed') {
      throw new ExtensionError(
        ErrorCode.AI_INVALID_KEY,
        `OpenAI is marked for browser-account runtime, but the trusted ${accountSource === 'codex' ? 'legacy Codex' : 'OpenAI'} account-backed credential metadata is missing.`,
        false,
      );
    }

    if (credentialRecord.stale) {
      throw new ExtensionError(
        ErrorCode.AI_INVALID_KEY,
        'OpenAI browser-account state changed after validation. Re-authenticate before starting chat.',
        false,
      );
    }

    if (!activeAccountId) {
      throw new ExtensionError(
        ErrorCode.AI_INVALID_KEY,
        `No active ${accountSource === 'codex' ? 'legacy Codex' : 'OpenAI'} browser account is selected. Complete browser auth before starting chat.`,
        false,
      );
    }

    const activeAccount = this.requireActiveAccount(sourceVault, accountSource, activeAccountId);
    if (activeAccount.stale) {
      throw new ExtensionError(
        ErrorCode.AI_INVALID_KEY,
        'The active OpenAI browser account is stale. Re-authenticate before starting chat.',
        false,
      );
    }

    if (activeAccount.status === 'revoked' || activeAccount.status === 'needs-auth') {
      throw new ExtensionError(
        ErrorCode.AI_INVALID_KEY,
        `The active OpenAI browser account is not ready (${activeAccount.status}). Re-authenticate before starting chat.`,
        false,
      );
    }

    const runtimeSession = await this.getSessionManager(accountSource).getRuntimeSessionMaterial(activeAccountId);

    return {
      lane: 'browser-account',
      runtimeProvider: route.runtimeProvider,
      credential: runtimeSession.accessToken,
      model: route.model,
    };
  }

  private resolveConfiguredLane(runtimeState: OpenAIRuntimeCoordinatorState): 'api-key' | 'browser-account' {
    const sourceProviders = runtimeState.rawProviders ?? runtimeState.providers;
    const sourceVault = runtimeState.rawVault ?? runtimeState.vault;
    const configuredAuthChoiceId = runtimeState.providers.openai?.authChoiceId;
    if (typeof configuredAuthChoiceId === 'string' && configuredAuthChoiceId.trim().length > 0) {
      return normalizeOpenAIAuthChoiceId(configuredAuthChoiceId);
    }

    if (!hasExplicitOpenAISurfaceState(sourceProviders, sourceVault)) {
      return resolveOpenAIAccountSurfaceSource(sourceProviders, sourceVault) === 'codex'
        ? 'browser-account'
        : 'api-key';
    }

    const credentialRecord = sourceVault.credentials.openai;
    const activeAccountId = sourceVault.activeAccounts.openai?.trim();
    const browserState = runtimeState.vault.browserLogins?.openai;

    return credentialRecord?.authFamily === 'account-backed' || Boolean(activeAccountId) || Boolean(browserState)
      ? 'browser-account'
      : 'api-key';
  }

  private assertVaultUnlocked(runtimeState: OpenAIRuntimeCoordinatorState): void {
    if (runtimeState.vault.lockState !== 'unlocked') {
      throw new ExtensionError(
        ErrorCode.AI_INVALID_KEY,
        `Vault is ${runtimeState.vault.lockState}. Unlock it before using OpenAI browser-account auth.`,
        true,
      );
    }
  }

  private requireActiveAccount(
    vault: VaultState,
    provider: 'openai' | 'codex',
    activeAccountId: string,
  ): ProviderAccountRecord {
    const activeAccount = vault.accounts[provider]?.find(
      (account) => account.accountId === activeAccountId,
    );

    if (!activeAccount) {
      throw new ExtensionError(
        ErrorCode.AI_INVALID_KEY,
        'The active OpenAI browser account metadata is missing from the vault.',
        false,
      );
    }

    return activeAccount;
  }

  private getSessionManager(provider: 'openai' | 'codex'): CodexAccountSessionManager {
    return provider === 'openai'
      ? this.browserAccountSessionManager
      : this.legacyCodexSessionManager;
  }

  private async requireApiKeyCredential(
    runtimeState: OpenAIRuntimeCoordinatorState,
  ): Promise<string> {
    this.assertVaultUnlocked(runtimeState);

    const credential = await this.credentialVault.getCredential('openai');
    if (!credential) {
      throw new ExtensionError(
        ErrorCode.AI_INVALID_KEY,
        'No credential is stored for OpenAI.',
        true,
      );
    }

    return credential;
  }
}
