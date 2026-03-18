import { DEFAULT_PROVIDER_MODELS } from '@shared/config';
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
  activeProvider: SessionConfig['provider'];
  onboarding: unknown;
  vault: VaultState;
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
  ) {}

  async resolve(
    runtimeState: OpenAIRuntimeCoordinatorState,
    requestedModel: string,
  ): Promise<OpenAIRuntimeResolution> {
    const credentialRecord = runtimeState.vault.credentials.openai;
    const activeAccountId = runtimeState.vault.activeAccounts.openai?.trim();
    const browserState = runtimeState.vault.browserLogins?.openai;
    const shouldUseBrowserAccountLane =
      credentialRecord?.authFamily === 'account-backed' || Boolean(activeAccountId) || Boolean(browserState);

    if (!shouldUseBrowserAccountLane) {
      const credential = await this.requireApiKeyCredential(runtimeState);
      return {
        lane: 'api-key',
        runtimeProvider: 'openai',
        credential,
        model: requestedModel,
      };
    }

    this.assertVaultUnlocked(runtimeState);

    if (browserState && browserState.status !== 'success') {
      throw new ExtensionError(
        ErrorCode.AI_INVALID_KEY,
        `OpenAI browser-account auth is not ready yet (state: ${browserState.status}). Complete browser auth before starting chat.`,
        false,
      );
    }

    if (!credentialRecord || credentialRecord.authFamily !== 'account-backed') {
      throw new ExtensionError(
        ErrorCode.AI_INVALID_KEY,
        'OpenAI is marked for browser-account runtime, but the trusted account-backed credential metadata is missing.',
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
        'No active OpenAI browser account is selected. Complete browser auth before starting chat.',
        false,
      );
    }

    const activeAccount = this.requireActiveAccount(runtimeState, activeAccountId);
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

    const runtimeSession = await this.browserAccountSessionManager.getRuntimeSessionMaterial(
      activeAccountId,
    );

    return {
      lane: 'browser-account',
      runtimeProvider: 'codex',
      credential: runtimeSession.accessToken,
      model: DEFAULT_PROVIDER_MODELS.codex,
    };
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
    runtimeState: OpenAIRuntimeCoordinatorState,
    activeAccountId: string,
  ): ProviderAccountRecord {
    const activeAccount = runtimeState.vault.accounts.openai?.find(
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
