import type { BadgeVariant } from '@/ui/components';
import type { AccountAuthStatusGetResponse, ProviderAccountRecord, ProviderSessionStatus } from '@shared/types';

export type AccountBackedUxState = 'healthy' | 'empty' | 'locked' | 'degraded' | 'needs-validation';

export interface AccountBackedProviderUx {
  state: AccountBackedUxState;
  badgeLabel: string;
  badgeVariant: BadgeVariant;
  title: string;
  detail: string;
  action: string;
  blocksRuntime: boolean;
  activeAccount: ProviderAccountRecord | null;
}

interface AccountBackedProviderUxCopy {
  providerName: string;
  emptyTitle: string;
  emptyDetail: string;
  emptyAction: string;
   storedCredentialUnavailableTitle: string;
   storedCredentialUnavailableDetail: string;
   storedCredentialUnavailableAction: string;
  needsValidationTitle: string;
  needsValidationAction: string;
  readyTitle: string;
  readyDetailSuffix: string;
  readyAction: string;
}

function getAccountBackedProviderUxCopy(
  provider: AccountAuthStatusGetResponse['provider'],
): AccountBackedProviderUxCopy {
  if (provider === 'openai') {
    return {
      providerName: 'OpenAI browser-account',
      emptyTitle: 'Connect an OpenAI browser account',
      emptyDetail:
        'No trusted browser-account artifact is available for the active OpenAI lane yet, so popup quick actions and sidepanel chat stay blocked.',
      emptyAction:
        'Use Connect browser account in options, then run Test connection before relying on live requests.',
      storedCredentialUnavailableTitle: 'Reconnect OpenAI browser-account',
      storedCredentialUnavailableDetail:
        'Flux can see the selected OpenAI browser-account lane, but the saved browser-account state is unavailable in the current session.',
      storedCredentialUnavailableAction:
        'Reconnect the browser account or validate a newly available stored account before relying on live requests.',
      needsValidationTitle: 'OpenAI browser-account is imported but not validated',
      needsValidationAction:
        'Run Test connection in options before relying on quick actions or sidepanel chat.',
      readyTitle: 'OpenAI browser-account is ready',
      readyDetailSuffix: 'is validated and available for popup quick actions plus live sidepanel requests.',
      readyAction:
        'If requests fail later, reconnect the browser account or validate it again in options.',
    };
  }

  return {
    providerName: 'Codex',
      emptyTitle: 'Import a Codex account',
      emptyDetail:
        'No official auth artifact is available for the active Codex provider yet, so live runtime requests stay locked.',
      emptyAction:
        'Import an official artifact in options, then run validation before using quick actions or chat.',
      storedCredentialUnavailableTitle: 'Reconnect Codex account',
      storedCredentialUnavailableDetail:
        'Flux can see the provider selection, but the saved account state is unavailable in the current session.',
      storedCredentialUnavailableAction:
        'Import or reconnect an account in options, then validate the active account again if needed.',
    needsValidationTitle: 'Codex account is imported but not validated',
    needsValidationAction:
      'Run account validation in options before relying on quick actions or sidepanel chat.',
    readyTitle: 'Codex account is ready',
    readyDetailSuffix: 'is validated and available for popup quick actions plus live sidepanel requests.',
    readyAction:
      'If requests fail later, refresh the artifact or validate the account again in options.',
  };
}

function getOpenAIBrowserLoginUx(
  status: AccountAuthStatusGetResponse,
): AccountBackedProviderUx | null {
  if (status.provider !== 'openai') {
    return null;
  }

  switch (status.browserLogin?.status) {
    case 'pending':
      return {
        state: 'needs-validation',
        badgeLabel: 'Browser login pending',
        badgeVariant: 'warning',
        title: 'OpenAI browser login is pending',
        detail:
          'Flux is still waiting for the background-approved browser-account result, so live requests remain blocked.',
        action:
          'Finish the browser-helper step, then return to options and run Test connection once trusted artifacts exist.',
        blocksRuntime: true,
        activeAccount: null,
      };
    case 'helper-missing':
      return {
        state: 'degraded',
        badgeLabel: 'Helper unavailable',
        badgeVariant: 'warning',
        title: 'OpenAI browser helper is unavailable',
        detail:
          'This build cannot complete trusted OpenAI browser-account setup because the helper app is not available.',
        action:
          'Use the API-key lane or install the helper, then retry Connect browser account in options.',
        blocksRuntime: true,
        activeAccount: null,
      };
    case 'cancel':
      return {
        state: 'degraded',
        badgeLabel: 'Browser login cancelled',
        badgeVariant: 'warning',
        title: 'OpenAI browser login was cancelled',
        detail:
          'No trusted browser-account artifact was stored, so runtime requests remain blocked.',
        action:
          'Retry Connect browser account in options when you are ready to finish the trusted login flow.',
        blocksRuntime: true,
        activeAccount: null,
      };
    case 'timeout':
    case 'stale':
    case 'mismatch':
    case 'error':
      return {
        state: 'degraded',
        badgeLabel:
          status.browserLogin.status === 'timeout'
            ? 'Browser login timed out'
            : status.browserLogin.status === 'stale'
              ? 'Browser login stale'
              : status.browserLogin.status === 'mismatch'
                ? 'Browser login mismatch'
                : 'Browser login error',
        badgeVariant: 'warning',
        title: 'OpenAI browser-account is not trusted yet',
        detail:
          'The last browser-account attempt did not produce trusted stored artifacts for live runtime requests.',
        action:
          'Retry Connect browser account in options, then run Test connection after a trusted account appears.',
        blocksRuntime: true,
        activeAccount: null,
      };
    default:
      return null;
  }
}

function getPreferredAccount(
  accounts: ProviderAccountRecord[],
  activeAccountId?: string,
): ProviderAccountRecord | null {
  return accounts.find((account) => account.accountId === activeAccountId) ?? accounts[0] ?? null;
}

function getSessionStatus(account: ProviderAccountRecord | null): ProviderSessionStatus | undefined {
  return account?.metadata?.session?.status;
}

export function resolveAccountBackedProviderUx(
  status: Pick<AccountAuthStatusGetResponse, 'status' | 'accounts' | 'activeAccountId'>,
): AccountBackedProviderUx {
  const typedStatus = status as AccountAuthStatusGetResponse;
  const copy = getAccountBackedProviderUxCopy(typedStatus.provider);
  const activeAccount = getPreferredAccount(status.accounts, status.activeAccountId);
  const sessionStatus = getSessionStatus(activeAccount);

  if (status.status === 'vault-locked') {
    return {
      state: 'locked',
      badgeLabel: 'Stored credential unavailable',
      badgeVariant: 'warning',
      title: copy.storedCredentialUnavailableTitle,
      detail: copy.storedCredentialUnavailableDetail,
      action: copy.storedCredentialUnavailableAction,
      blocksRuntime: true,
      activeAccount,
    };
  }

  if (!activeAccount) {
    const openAIBrowserLoginUx = getOpenAIBrowserLoginUx(typedStatus);
    if (openAIBrowserLoginUx) {
      return openAIBrowserLoginUx;
    }

    return {
      state: 'empty',
      badgeLabel: typedStatus.provider === 'openai' ? 'Browser account missing' : 'Account missing',
      badgeVariant: 'default',
      title: copy.emptyTitle,
      detail: copy.emptyDetail,
      action: copy.emptyAction,
      blocksRuntime: true,
      activeAccount: null,
    };
  }

  if (activeAccount.status === 'revoked' || sessionStatus === 'revoked') {
    return {
        state: 'degraded',
        badgeLabel: 'Reconnect required',
        badgeVariant: 'error',
        title: `${copy.providerName} access was revoked`,
        detail: `${activeAccount.label} can no longer back runtime requests because the imported account or runtime session was revoked.`,
        action: 'Remove it or import a fresh official artifact, then validate the replacement account.',
      blocksRuntime: true,
      activeAccount,
    };
  }

  if (sessionStatus === 'refresh-required') {
    return {
        state: 'degraded',
        badgeLabel: 'Reconnect required',
        badgeVariant: 'warning',
        title: `${copy.providerName} needs a fresh artifact`,
        detail: `${activeAccount.label} is still stored locally, but its runtime session now requires a newer official artifact before Flux can resume safely.`,
        action: 'Re-import a fresh official artifact in options, then validate the account again.',
      blocksRuntime: true,
      activeAccount,
    };
  }

  if (sessionStatus === 'expired') {
    return {
        state: 'degraded',
        badgeLabel: 'Reconnect required',
        badgeVariant: 'warning',
        title: `${copy.providerName} session expired`,
        detail: `${activeAccount.label} no longer has a usable runtime session snapshot for ${copy.providerName}.`,
        action: 'Import a fresh official artifact, then validate again before resuming live requests.',
      blocksRuntime: true,
      activeAccount,
    };
  }

  if (activeAccount.status === 'needs-auth') {
    return {
        state: 'degraded',
        badgeLabel: 'Reconnect required',
        badgeVariant: 'warning',
        title: `${copy.providerName} account needs re-auth`,
        detail: `${activeAccount.label} is stored locally, but the imported auth artifact is no longer trusted for runtime work.`,
        action: 'Re-import the official artifact, then validate the active account again.',
      blocksRuntime: true,
      activeAccount,
    };
  }

  if (activeAccount.stale) {
      return {
        state: 'degraded',
        badgeLabel: 'Validation required',
        badgeVariant: 'warning',
        title: `${copy.providerName} account changed after validation`,
        detail: `${activeAccount.label} no longer matches the last validated runtime snapshot, so Flux treats it as stale.`,
        action: 'Run validation again. If validation still fails, re-import the official artifact.',
      blocksRuntime: true,
      activeAccount,
    };
  }

  if (!activeAccount.validatedAt) {
    return {
      state: 'needs-validation',
      badgeLabel: 'Validation required',
      badgeVariant: 'info',
      title: copy.needsValidationTitle,
      detail: `${activeAccount.label} is stored locally, but Flux has not confirmed the current runtime session yet.`,
      action: copy.needsValidationAction,
      blocksRuntime: true,
      activeAccount,
    };
  }

  return {
    state: 'healthy',
    badgeLabel: 'Ready',
    badgeVariant: 'success',
    title: copy.readyTitle,
    detail: `${activeAccount.label} ${copy.readyDetailSuffix}`,
    action: copy.readyAction,
    blocksRuntime: false,
    activeAccount,
  };
}
