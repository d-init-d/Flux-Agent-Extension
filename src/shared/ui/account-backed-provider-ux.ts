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
  const activeAccount = getPreferredAccount(status.accounts, status.activeAccountId);
  const sessionStatus = getSessionStatus(activeAccount);

  if (status.status === 'vault-locked') {
    return {
      state: 'locked',
      badgeLabel: 'Vault locked',
      badgeVariant: 'warning',
      title: 'Unlock the vault for Codex',
      detail: 'Flux can see the provider selection, but the imported account is unavailable until this browser session unlocks the vault.',
      action: 'Unlock the vault in options, then validate the active account again if needed.',
      blocksRuntime: true,
      activeAccount,
    };
  }

  if (!activeAccount) {
    return {
      state: 'empty',
      badgeLabel: 'Account missing',
      badgeVariant: 'default',
      title: 'Import a Codex account',
      detail: 'No official auth artifact is available for the active Codex provider yet, so live runtime requests stay locked.',
      action: 'Import an official artifact in options, then run validation before using quick actions or chat.',
      blocksRuntime: true,
      activeAccount: null,
    };
  }

  if (activeAccount.status === 'revoked' || sessionStatus === 'revoked') {
    return {
      state: 'degraded',
      badgeLabel: 'Revoked',
      badgeVariant: 'error',
      title: 'Codex access was revoked',
      detail: `${activeAccount.label} can no longer back runtime requests because the imported account or runtime session was revoked.`,
      action: 'Remove it or import a fresh official artifact, then validate the replacement account.',
      blocksRuntime: true,
      activeAccount,
    };
  }

  if (sessionStatus === 'refresh-required') {
    return {
      state: 'degraded',
      badgeLabel: 'Refresh required',
      badgeVariant: 'warning',
      title: 'Codex needs a fresh artifact',
      detail: `${activeAccount.label} is still stored locally, but its runtime session now requires a newer official artifact before Flux can resume safely.`,
      action: 'Re-import a fresh official artifact in options, then validate the account again.',
      blocksRuntime: true,
      activeAccount,
    };
  }

  if (sessionStatus === 'expired') {
    return {
      state: 'degraded',
      badgeLabel: 'Session expired',
      badgeVariant: 'warning',
      title: 'Codex session expired',
      detail: `${activeAccount.label} no longer has a usable runtime session snapshot for Codex.`,
      action: 'Import a fresh official artifact, then validate again before resuming live requests.',
      blocksRuntime: true,
      activeAccount,
    };
  }

  if (activeAccount.status === 'needs-auth') {
    return {
      state: 'degraded',
      badgeLabel: 'Needs auth',
      badgeVariant: 'warning',
      title: 'Codex account needs re-auth',
      detail: `${activeAccount.label} is stored in the vault, but the imported auth artifact is no longer trusted for runtime work.`,
      action: 'Re-import the official artifact, then validate the active account again.',
      blocksRuntime: true,
      activeAccount,
    };
  }

  if (activeAccount.stale) {
    return {
      state: 'degraded',
      badgeLabel: 'Stale',
      badgeVariant: 'warning',
      title: 'Codex account changed after validation',
      detail: `${activeAccount.label} no longer matches the last validated runtime snapshot, so Flux treats it as stale.`,
      action: 'Run validation again. If validation still fails, re-import the official artifact.',
      blocksRuntime: true,
      activeAccount,
    };
  }

  if (!activeAccount.validatedAt) {
    return {
      state: 'needs-validation',
      badgeLabel: 'Validate account',
      badgeVariant: 'info',
      title: 'Codex account is imported but not validated',
      detail: `${activeAccount.label} is stored locally, but Flux has not confirmed the current runtime session yet.`,
      action: 'Run account validation in options before relying on quick actions or sidepanel chat.',
      blocksRuntime: true,
      activeAccount,
    };
  }

  return {
    state: 'healthy',
    badgeLabel: 'Ready',
    badgeVariant: 'success',
    title: 'Codex account is ready',
    detail: `${activeAccount.label} is validated and available for popup quick actions plus live sidepanel requests.`,
    action: 'If requests fail later, refresh the artifact or validate the account again in options.',
    blocksRuntime: false,
    activeAccount,
  };
}
