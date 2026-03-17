import { importCodexAccountArtifact, type ImportedCodexAccountArtifact } from '@core/auth/codex-account-import';
import { ErrorCode, ExtensionError } from '@shared/errors';
import type {
  ProviderAccountMetadata,
  ProviderAccountRecord,
  ProviderSessionMetadata,
  ProviderSessionStatus,
} from '@shared/types';
import { Logger } from '@shared/utils';

import { CredentialVault } from './credential-vault';

const OFFICIAL_CODEX_REFRESH_WINDOW_MS = 8 * 24 * 60 * 60 * 1000;
const REFRESH_DEFERRED_ERROR_CODE = 'ACCOUNT_SESSION_REFRESH_DEFERRED';
const REFRESH_UNSUPPORTED_ERROR_CODE = 'ACCOUNT_SESSION_REFRESH_UNSUPPORTED';
const ARTIFACT_INVALID_ERROR_CODE = 'ACCOUNT_SESSION_ARTIFACT_INVALID';
const ARTIFACT_MISSING_ERROR_CODE = 'ACCOUNT_SESSION_ARTIFACT_MISSING';

type CodexSessionPurpose = 'validate' | 'quota-refresh';

type CachedCodexAccountSession = {
  accountId: string;
  accessToken: string;
  idToken: string;
  refreshToken: string;
  authMode?: 'chatgpt';
  cachedAt: number;
  lastRefreshAt?: number;
  refreshAfter?: number;
};

export interface CodexAccountSessionSnapshot {
  account: ProviderAccountRecord;
  sessionStatus: ProviderSessionStatus;
  sessionAvailable: boolean;
  cacheHit: boolean;
  refreshDeferred: boolean;
  reauthRequired: boolean;
  checkedAt: number;
  message: string;
}

interface EnsureCodexAccountSessionOptions {
  accountId: string;
  purpose: CodexSessionPurpose;
  forceRefresh?: boolean;
}

type ImportedSessionState = {
  imported: ImportedCodexAccountArtifact;
  sessionStatus: ProviderSessionStatus;
  sessionAvailable: boolean;
  refreshDeferred: boolean;
  reauthRequired: boolean;
  refreshAfter?: number;
  lastIssuedAt?: number;
  message: string;
  errorCode?: string;
};

function cloneAccountMetadata(metadata: ProviderAccountMetadata | undefined): ProviderAccountMetadata | undefined {
  if (!metadata) {
    return undefined;
  }

  return {
    ...metadata,
    quota: metadata.quota ? { ...metadata.quota } : undefined,
    rateLimit: metadata.rateLimit ? { ...metadata.rateLimit } : undefined,
    entitlement: metadata.entitlement
      ? {
          ...metadata.entitlement,
          features: metadata.entitlement.features ? [...metadata.entitlement.features] : undefined,
        }
      : undefined,
    session: metadata.session ? { ...metadata.session } : undefined,
  };
}

export class CodexAccountSessionManager {
  private readonly logger: Logger;
  private readonly cachedSessions = new Map<string, CachedCodexAccountSession>();
  private readonly inflightResolutions = new Map<string, Promise<CodexAccountSessionSnapshot>>();

  constructor(
    private readonly credentialVault: CredentialVault,
    logger: Logger,
  ) {
    this.logger = logger.child('CodexAccountSessionManager');
  }

  async ensureSession(
    options: EnsureCodexAccountSessionOptions,
  ): Promise<CodexAccountSessionSnapshot> {
    const accountKey = this.getAccountKey(options.accountId);
    const inflight = this.inflightResolutions.get(accountKey);
    if (inflight) {
      return inflight;
    }

    const resolution = this.resolveSession(options).finally(() => {
      this.inflightResolutions.delete(accountKey);
    });
    this.inflightResolutions.set(accountKey, resolution);
    return resolution;
  }

  clearSession(accountId: string): void {
    this.cachedSessions.delete(this.getAccountKey(accountId));
  }

  private async resolveSession(
    options: EnsureCodexAccountSessionOptions,
  ): Promise<CodexAccountSessionSnapshot> {
    const account = await this.requireAccount(options.accountId);
    const checkedAt = Date.now();

    if (account.status === 'revoked') {
      this.clearSession(account.accountId);
      const patchedAccount = await this.persistAccountObservation(account, {
        sessionStatus: 'revoked',
        checkedAt,
        reauthRequired: true,
        errorCode: ARTIFACT_INVALID_ERROR_CODE,
        message: 'Account is revoked and requires a new auth artifact.',
      });
      return {
        account: patchedAccount,
        sessionStatus: 'revoked',
        sessionAvailable: false,
        cacheHit: false,
        refreshDeferred: false,
        reauthRequired: true,
        checkedAt,
        message: 'Account is revoked and requires a new auth artifact.',
      };
    }

    const cachedSession = this.cachedSessions.get(this.getAccountKey(account.accountId));
    if (cachedSession && !this.shouldTreatAsRefreshRequired(cachedSession, checkedAt, options.forceRefresh)) {
      const patchedAccount = await this.persistAccountObservation(account, {
        sessionStatus: 'active',
        checkedAt,
        lastIssuedAt: cachedSession.lastRefreshAt,
        refreshAfter: cachedSession.refreshAfter,
        lastUsedAt: options.purpose === 'quota-refresh' ? checkedAt : undefined,
        message: 'Using cached in-memory Codex session derived from the stored auth artifact.',
      });
      return {
        account: patchedAccount,
        sessionStatus: 'active',
        sessionAvailable: true,
        cacheHit: true,
        refreshDeferred: false,
        reauthRequired: false,
        checkedAt,
        message: 'Using cached in-memory Codex session derived from the stored auth artifact.',
      };
    }

    const artifact = await this.credentialVault.getAccountArtifact('codex', account.accountId);
    if (!artifact) {
      this.clearSession(account.accountId);
      const patchedAccount = await this.persistAccountObservation(account, {
        sessionStatus: 'expired',
        checkedAt,
        reauthRequired: true,
        errorCode: ARTIFACT_MISSING_ERROR_CODE,
        message: 'Stored Codex auth artifact is missing. Re-auth is required.',
      });
      return {
        account: patchedAccount,
        sessionStatus: 'expired',
        sessionAvailable: false,
        cacheHit: false,
        refreshDeferred: false,
        reauthRequired: true,
        checkedAt,
        message: 'Stored Codex auth artifact is missing. Re-auth is required.',
      };
    }

    let importedState: ImportedSessionState;
    try {
      importedState = this.buildImportedSessionState(
        await importCodexAccountArtifact({
          format: artifact.format ?? 'unknown',
          value: artifact.value,
          filename: artifact.filename,
        }),
        artifact.updatedAt,
        checkedAt,
        options,
      );
    } catch (error) {
      this.clearSession(account.accountId);
      const patchedAccount = await this.persistAccountObservation(account, {
        sessionStatus: 'expired',
        checkedAt,
        reauthRequired: true,
        errorCode: ARTIFACT_INVALID_ERROR_CODE,
        message: 'Stored Codex auth artifact is no longer valid. Re-auth is required.',
      });
      this.logger.warn('Failed to hydrate Codex account artifact', {
        accountId: account.accountId,
        reason: error instanceof Error ? error.message : String(error),
      });
      return {
        account: patchedAccount,
        sessionStatus: 'expired',
        sessionAvailable: false,
        cacheHit: false,
        refreshDeferred: false,
        reauthRequired: true,
        checkedAt,
        message: 'Stored Codex auth artifact is no longer valid. Re-auth is required.',
      };
    }

    if (importedState.sessionAvailable && importedState.imported.tokens.accessToken) {
      this.cachedSessions.set(this.getAccountKey(account.accountId), {
        accountId: account.accountId,
        accessToken: importedState.imported.tokens.accessToken,
        idToken: importedState.imported.tokens.idToken,
        refreshToken: importedState.imported.tokens.refreshToken,
        authMode: importedState.imported.authMode,
        cachedAt: checkedAt,
        lastRefreshAt: importedState.lastIssuedAt,
        refreshAfter: importedState.refreshAfter,
      });
    } else {
      this.clearSession(account.accountId);
    }

    const patchedAccount = await this.persistAccountObservation(account, {
      sessionStatus: importedState.sessionStatus,
      checkedAt,
      lastIssuedAt: importedState.lastIssuedAt,
      refreshAfter: importedState.refreshAfter,
      lastUsedAt: importedState.sessionAvailable && options.purpose === 'quota-refresh' ? checkedAt : undefined,
      reauthRequired: importedState.reauthRequired,
      errorCode: importedState.errorCode,
      message: importedState.message,
    });

    return {
      account: patchedAccount,
      sessionStatus: importedState.sessionStatus,
      sessionAvailable: importedState.sessionAvailable,
      cacheHit: false,
      refreshDeferred: importedState.refreshDeferred,
      reauthRequired: importedState.reauthRequired,
      checkedAt,
      message: importedState.message,
    };
  }

  private buildImportedSessionState(
    imported: ImportedCodexAccountArtifact,
    artifactUpdatedAt: number,
    checkedAt: number,
    options: EnsureCodexAccountSessionOptions,
  ): ImportedSessionState {
    const lastIssuedAt = imported.lastRefreshAt ?? artifactUpdatedAt;
    const refreshAfter = lastIssuedAt + OFFICIAL_CODEX_REFRESH_WINDOW_MS;
    const hasAccessToken = Boolean(imported.tokens.accessToken?.trim());
    const refreshRequired = options.forceRefresh === true || !hasAccessToken || checkedAt >= refreshAfter;

    if (!refreshRequired) {
      return {
        imported,
        sessionStatus: 'active',
        sessionAvailable: true,
        refreshDeferred: false,
        reauthRequired: false,
        refreshAfter,
        lastIssuedAt,
        message: 'Validated stored Codex artifact and hydrated an in-memory runtime session.',
      };
    }

    if (options.purpose === 'validate' && !options.forceRefresh) {
      return {
        imported,
        sessionStatus: 'refresh-required',
        sessionAvailable: false,
        refreshDeferred: true,
        reauthRequired: false,
        refreshAfter,
        lastIssuedAt,
        message:
          'Validated artifact shape, but live refresh is deferred because OpenAI documents Codex-managed refresh through the official client rather than direct token exchange.',
        errorCode: REFRESH_DEFERRED_ERROR_CODE,
      };
    }

    return {
      imported,
      sessionStatus: 'refresh-required',
      sessionAvailable: false,
      refreshDeferred: true,
      reauthRequired: true,
      refreshAfter,
      lastIssuedAt,
      message:
        'Stored artifact needs a fresh Codex-managed login. Online refresh is intentionally deferred because the official flow is client-managed.',
      errorCode: REFRESH_UNSUPPORTED_ERROR_CODE,
    };
  }

  private shouldTreatAsRefreshRequired(
    session: CachedCodexAccountSession,
    now: number,
    forceRefresh = false,
  ): boolean {
    if (forceRefresh) {
      return true;
    }

    if (!session.refreshAfter) {
      return false;
    }

    return now >= session.refreshAfter;
  }

  private async persistAccountObservation(
    account: ProviderAccountRecord,
    observation: {
      sessionStatus: ProviderSessionStatus;
      checkedAt: number;
      lastIssuedAt?: number;
      refreshAfter?: number;
      lastUsedAt?: number;
      reauthRequired?: boolean;
      errorCode?: string;
      message: string;
    },
  ): Promise<ProviderAccountRecord> {
    const nextMetadata: ProviderAccountMetadata = {
      ...(cloneAccountMetadata(account.metadata) ?? {}),
      session: {
        authKind: 'session-token',
        status: observation.sessionStatus,
        observedAt: observation.checkedAt,
        lastIssuedAt: observation.lastIssuedAt,
        refreshAfter: observation.refreshAfter,
      } satisfies ProviderSessionMetadata,
      lastErrorCode: observation.errorCode,
      lastErrorAt: observation.errorCode ? observation.checkedAt : undefined,
    };

    const nextStatus = observation.reauthRequired
      ? 'needs-auth'
      : observation.sessionStatus === 'active'
        ? account.isActive
          ? 'active'
          : account.status === 'needs-auth' || account.status === 'error' || account.status === 'unknown'
            ? 'available'
            : account.status
        : account.status;

    const patchedAccount = await this.credentialVault.patchAccount('codex', account.accountId, {
      status: nextStatus,
      validatedAt: observation.sessionStatus === 'active' ? observation.checkedAt : account.validatedAt,
      lastUsedAt: observation.lastUsedAt,
      stale: observation.reauthRequired ?? false,
      metadata: nextMetadata,
    });

    if (!patchedAccount) {
      throw new ExtensionError(
        ErrorCode.STORAGE_WRITE_ERROR,
        `Unable to persist session metadata for account "${account.accountId}"`,
        true,
      );
    }

    this.logger.debug('Updated Codex account session metadata', {
      accountId: patchedAccount.accountId,
      sessionStatus: observation.sessionStatus,
      reauthRequired: observation.reauthRequired ?? false,
    });

    return patchedAccount;
  }

  private async requireAccount(accountId: string): Promise<ProviderAccountRecord> {
    const normalizedAccountId = accountId.trim();
    if (!normalizedAccountId) {
      throw new ExtensionError(ErrorCode.ACTION_INVALID, 'Account id is required', true);
    }

    const account = await this.credentialVault.getAccount('codex', normalizedAccountId);
    if (!account) {
      throw new ExtensionError(
        ErrorCode.ACTION_INVALID,
        `Account "${normalizedAccountId}" was not found`,
        true,
      );
    }

    return account;
  }

  private getAccountKey(accountId: string): string {
    return accountId.trim();
  }
}
