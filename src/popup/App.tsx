import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bolt,
  CheckCircle2,
  Eye,
  FileText,
  Lock,
  MousePointerClick,
  Sparkles,
  TimerReset,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/components';
import { sendExtensionRequest } from '@/shared/extension-client';
import { PROVIDER_LOOKUP } from '@/shared/config';
import { normalizeOnboardingState, ONBOARDING_STORAGE_KEY } from '@/shared/storage/onboarding';
import { resolveAccountBackedProviderUx } from '@/shared/ui/account-backed-provider-ux';
import { resolveKeyBasedProviderUx } from '@/shared/ui/key-based-provider-ux';
import {
  resolveActiveProviderSurfaceState,
  resolveProviderModelForSession,
} from '@/shared/ui/provider-surface';
import type { AccountAuthStatusGetResponse, AIProviderType, Session, SettingsGetResponse } from '@/shared/types';
import { ThemeToggle } from '@/ui/theme';

interface PageInfo {
  title: string;
  url: string;
  domain: string;
  summary: string;
  status: string;
  isFallback: boolean;
}

type QuickActionId =
  | 'summarize-page'
  | 'extract-data'
  | 'inspect-elements'
  | 'replay-last-run';

interface QuickActionDefinition {
  id: QuickActionId;
  label: string;
  description: string;
  icon: typeof FileText;
}

interface PopupProviderStatus {
  provider: AIProviderType | null;
  providerLabel: string;
  badgeLabel: string;
  badgeVariant: 'default' | 'info' | 'success' | 'warning' | 'error';
  title: string;
  detail: string;
  action: string;
  blocksQuickActions: boolean;
}

const DEFAULT_PAGE_INFO: PageInfo = {
  title: 'Waiting for active tab',
  url: 'No page URL available yet.',
  domain: 'Unavailable',
  summary: 'Open a tab to see live page context and trigger quick actions from the popup.',
  status: 'Awaiting tab context',
  isFallback: true,
};

const QUICK_ACTIONS: QuickActionDefinition[] = [
  {
    id: 'summarize-page',
    label: 'Summarize page',
    description: 'Send a concise brief request to the side panel.',
    icon: FileText,
  },
  {
    id: 'extract-data',
    label: 'Extract data',
    description: 'Ask Flux to capture the most important structured data.',
    icon: Sparkles,
  },
  {
    id: 'inspect-elements',
    label: 'Inspect elements',
    description: 'Review likely targets, controls, and next actions on the page.',
    icon: Eye,
  },
  {
    id: 'replay-last-run',
    label: 'Replay last run',
    description: 'Start playback for the latest recorded automation session.',
    icon: TimerReset,
  },
] as const;

const QUICK_ACTION_PROMPTS: Record<Exclude<QuickActionId, 'replay-last-run'>, string> = {
  'summarize-page':
    'Summarize the current page. Focus on the visible content, the main sections, and the most actionable takeaways.',
  'extract-data':
    'Extract the most important structured data from the current page. Return concise entities, fields, and values that matter.',
  'inspect-elements':
    'Inspect the current page and identify the main interactive elements, forms, clickable targets, and likely next steps.',
};

const SUPPORTED_PAGE_PROTOCOLS = new Set(['http:', 'https:']);

const DEFAULT_PROVIDER_STATUS: PopupProviderStatus = {
  provider: null,
  providerLabel: 'Provider status',
  badgeLabel: 'Checking',
  badgeVariant: 'default',
  title: 'Checking provider state',
  detail: 'Flux is loading the current provider and account state for popup quick actions.',
  action: 'Open options if this status does not update.',
  blocksQuickActions: false,
};

function formatUrlParts(url?: string): Pick<PageInfo, 'url' | 'domain'> {
  if (!url) {
    return {
      url: 'No page URL available yet.',
      domain: 'Unavailable',
    };
  }

  try {
    const parsedUrl = new URL(url);

    if (!SUPPORTED_PAGE_PROTOCOLS.has(parsedUrl.protocol)) {
      return {
        url,
        domain: `${parsedUrl.protocol.replace(':', '')} page`,
      };
    }

    const displayUrl = `${parsedUrl.hostname}${parsedUrl.pathname}${parsedUrl.search}`;

    return {
      url: displayUrl || parsedUrl.hostname,
      domain: parsedUrl.hostname,
    };
  } catch {
    return {
      url,
      domain: 'Unavailable',
    };
  }
}

function isSupportedTabUrl(url?: string): boolean {
  if (!url) {
    return false;
  }

  try {
    return SUPPORTED_PAGE_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

function mapTabToPageInfo(tab?: chrome.tabs.Tab): PageInfo {
  if (!tab) {
    return DEFAULT_PAGE_INFO;
  }

  const urlParts = formatUrlParts(tab.url);
  const title = tab.title?.trim() || 'Untitled tab';

  if (!tab.url) {
    return {
      title,
      url: urlParts.url,
      domain: urlParts.domain,
      summary:
        'The active tab has not exposed a page URL yet. Wait for the page to finish loading or switch to a regular website tab.',
      status: 'Active tab unavailable',
      isFallback: true,
    };
  }

  if (!isSupportedTabUrl(tab.url)) {
    return {
      title,
      url: urlParts.url,
      domain: urlParts.domain,
      summary:
        'Flux only runs quick actions on regular website tabs (http/https). Chrome internal pages, extension pages, and blank tabs are not supported.',
      status: 'Open a website tab',
      isFallback: true,
    };
  }

  const summary = tab.url
    ? 'Live context loaded from the active tab so popup actions can target the current page.'
    : 'Active tab found, but the page URL is not available yet.';

  return {
    title,
    url: urlParts.url,
    domain: urlParts.domain,
    summary,
    status: tab.status === 'loading' ? 'Loading tab context' : 'Ready for quick actions',
    isFallback: false,
  };
}

function sortSessionsByActivity(sessions: Session[]): Session[] {
  return [...sessions].sort((left, right) => right.lastActivityAt - left.lastActivityAt);
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

function createDefaultProviderStatus(snapshot: SettingsGetResponse): PopupProviderStatus {
  const surface = resolveActiveProviderSurfaceState(snapshot);
  const provider = surface.surfacedProvider;
  const providerLabel = surface.surfacedProviderLabel;

  if (surface.uxKind === 'key-based') {
    const ux = resolveKeyBasedProviderUx(provider, {
      config: snapshot.providers[provider],
      credential: snapshot.vault.credentials[provider],
      vaultLockState: snapshot.vault.lockState,
    });

    return {
      provider,
      providerLabel,
      badgeLabel: ux.badgeLabel,
      badgeVariant: ux.badgeVariant,
      title: ux.title,
      detail: ux.detail,
      action: ux.action,
        blocksQuickActions: ux.blocksRuntime,
      };
  }

  const hasCredential = Boolean(snapshot.vault.credentials[provider]);

  if (snapshot.vault.lockState === 'locked' && hasCredential) {
    return {
      provider,
      providerLabel,
      badgeLabel: 'Stored credential unavailable',
      badgeVariant: 'warning',
      title: `${providerLabel} needs a fresh local credential`,
      detail:
        'The active provider is configured, but the stored credential is unavailable in the current session, so live requests may need provider settings before they can resume.',
      action: 'Open provider settings, save the credential again if needed, then re-run Test connection.',
      blocksQuickActions: false,
    };
  }

  if (hasCredential) {
    return {
      provider,
      providerLabel,
      badgeLabel: 'Ready',
      badgeVariant: 'success',
      title: `${providerLabel} is ready`,
      detail: 'The popup can hand work to the side panel with the current provider configuration.',
      action: 'Use options to rotate or revalidate the credential if requests fail later.',
      blocksQuickActions: false,
    };
  }

  return {
    provider,
    providerLabel,
    badgeLabel: 'Setup pending',
    badgeVariant: 'info',
    title: `${providerLabel} still needs provider setup`,
    detail:
      'The popup can still open the side panel, but the active provider may not answer until its credential or account state is completed in options.',
    action: 'Open options to save credentials, connect OAuth, or import an account artifact.',
    blocksQuickActions: false,
  };
}

function mapAccountBackedStatusToPopupStatus(
  provider: AIProviderType,
  authStatus: AccountAuthStatusGetResponse,
): PopupProviderStatus {
  const providerLabel = PROVIDER_LOOKUP[provider].label;
  const ux = resolveAccountBackedProviderUx(authStatus);

  return {
    provider,
    providerLabel,
    badgeLabel: ux.badgeLabel,
    badgeVariant: ux.badgeVariant,
    title: ux.title,
    detail: ux.detail,
    action: ux.action,
    blocksQuickActions: ux.blocksRuntime,
  };
}

async function getActiveTabContext(): Promise<{
  tab: chrome.tabs.Tab | null;
  pageInfo: PageInfo;
}> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
    return {
      tab: null,
      pageInfo: DEFAULT_PAGE_INFO,
    };
  }

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0] ?? null;

    return {
      tab: activeTab,
      pageInfo: mapTabToPageInfo(activeTab ?? undefined),
    };
  } catch {
    return {
      tab: null,
      pageInfo: {
        ...DEFAULT_PAGE_INFO,
        status: 'Active tab unavailable',
        summary:
          'The popup could not read the current tab context, so live quick actions are temporarily unavailable.',
      },
    };
  }
}

async function openSidePanelForTab(tab: chrome.tabs.Tab | null): Promise<void> {
  if (!tab?.id || tab.windowId === undefined || !chrome.sidePanel?.open) {
    return;
  }

  await chrome.sidePanel.open({
    tabId: tab.id,
    windowId: tab.windowId,
  });
}

export function App() {
  const [activeTab, setActiveTab] = useState<chrome.tabs.Tab | null>(null);
  const [pageInfo, setPageInfo] = useState<PageInfo>(DEFAULT_PAGE_INFO);
  const [isOnboardingLocked, setIsOnboardingLocked] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [pendingActionId, setPendingActionId] = useState<QuickActionId | null>(null);
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [replaySession, setReplaySession] = useState<Session | null>(null);
  const [replayReason, setReplayReason] = useState('Checking recorded sessions...');
  const [providerStatus, setProviderStatus] = useState<PopupProviderStatus>(DEFAULT_PROVIDER_STATUS);
  const [isProviderStatusLoading, setIsProviderStatusLoading] = useState(true);

  const refreshReplayAvailability = useCallback(async (tabId?: number): Promise<void> => {
    try {
      const response = await sendExtensionRequest('SESSION_LIST', undefined, 'popup');
      const sessions = sortSessionsByActivity(response.sessions);
      const sessionForCurrentTab =
        tabId !== undefined
          ? sessions.find(
              (session) => session.targetTabId === tabId && session.recording.actions.length > 0,
            ) ?? null
          : null;
      const nextReplaySession =
        sessionForCurrentTab ?? sessions.find((session) => session.recording.actions.length > 0) ?? null;

      setReplaySession(nextReplaySession);
      setReplayReason(
        nextReplaySession
          ? tabId !== undefined && nextReplaySession.targetTabId !== tabId
            ? 'Latest replayable session is on a different tab. Flux will open the side panel here and replay that session.'
            : 'Latest recorded session is ready to replay.'
          : 'No recorded automation run is available yet.',
      );
    } catch (error) {
      setReplaySession(null);
      setReplayReason(getErrorMessage(error, 'Recorded sessions could not be loaded.'));
    }
  }, []);

  const refreshProviderStatus = useCallback(async (): Promise<void> => {
    setIsProviderStatusLoading(true);

    try {
      const settingsSnapshot = await sendExtensionRequest('SETTINGS_GET', undefined, 'popup');
      const surface = resolveActiveProviderSurfaceState(settingsSnapshot);

      if (surface.uxKind === 'account-backed' && surface.accountStatusProvider) {
        const authStatus = await sendExtensionRequest(
          'ACCOUNT_AUTH_STATUS_GET',
          { provider: surface.accountStatusProvider },
          'popup',
        );

        setProviderStatus(mapAccountBackedStatusToPopupStatus(surface.surfacedProvider, authStatus));
      } else {
        setProviderStatus(createDefaultProviderStatus(settingsSnapshot));
      }
    } catch (error) {
      setProviderStatus({
        provider: null,
        providerLabel: 'Provider status',
        badgeLabel: 'Unavailable',
        badgeVariant: 'warning',
        title: 'Provider state could not be refreshed',
        detail: getErrorMessage(
          error,
          'The popup could not load the current provider state, so quick-action status may be stale.',
        ),
        action: 'Open options to confirm the active provider and account health.',
        blocksQuickActions: false,
      });
    } finally {
      setIsProviderStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    let isActive = true;

    function applyOnboardingState(rawValue: unknown): void {
      const onboardingState = normalizeOnboardingState(rawValue);
      setNeedsOnboarding(!onboardingState.completed);
      setIsOnboardingLocked(false);

      if (onboardingState.completed) {
        void refreshProviderStatus();
        void refreshReplayAvailability(activeTab?.id);
      } else {
        setProviderStatus(DEFAULT_PROVIDER_STATUS);
        setIsProviderStatusLoading(false);
        setReplaySession(null);
        setReplayReason('Complete guided setup before loading replay actions.');
      }
    }

    function handleStorageChange(
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ): void {
      if (!isActive || areaName !== 'local' || !(ONBOARDING_STORAGE_KEY in changes)) {
        return;
      }

      applyOnboardingState(changes[ONBOARDING_STORAGE_KEY]?.newValue);
    }

    void getActiveTabContext().then(({ tab, pageInfo: nextPageInfo }) => {
      if (!isActive) {
        return;
      }

      setActiveTab(tab);
      setPageInfo(nextPageInfo);
    });

    void chrome.storage.local
      .get(ONBOARDING_STORAGE_KEY)
      .then((storageState) => {
        if (!isActive) {
          return;
        }

        applyOnboardingState(storageState[ONBOARDING_STORAGE_KEY]);
      })
      .catch(() => {
        if (isActive) {
          setNeedsOnboarding(true);
          setIsOnboardingLocked(false);
          setProviderStatus(DEFAULT_PROVIDER_STATUS);
          setIsProviderStatusLoading(false);
          setReplaySession(null);
          setReplayReason('Complete guided setup before loading replay actions.');
        }
      });

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      isActive = false;
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [activeTab?.id, refreshProviderStatus, refreshReplayAvailability]);

  useEffect(() => {
    if (needsOnboarding || isOnboardingLocked || !activeTab?.id) {
      return;
    }

    void refreshReplayAvailability(activeTab.id);
  }, [activeTab?.id, isOnboardingLocked, needsOnboarding, refreshReplayAvailability]);

  useEffect(() => {
    if (needsOnboarding || isOnboardingLocked) {
      return;
    }

    void refreshProviderStatus();
  }, [isOnboardingLocked, needsOnboarding, refreshProviderStatus]);

  async function handleFinishSetup(): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.runtime?.openOptionsPage) {
      return;
    }

    try {
      const storageState = await chrome.storage.local.get(ONBOARDING_STORAGE_KEY);
      const onboardingState = normalizeOnboardingState(storageState[ONBOARDING_STORAGE_KEY]);

      await chrome.storage.local.set({
        [ONBOARDING_STORAGE_KEY]: {
          ...onboardingState,
          completed: false,
          resumeRequestedAt: Date.now(),
        },
      });
    } catch {
      await chrome.storage.local.set({
        [ONBOARDING_STORAGE_KEY]: {
          ...normalizeOnboardingState(undefined),
          resumeRequestedAt: Date.now(),
        },
      });
    }

    await chrome.runtime.openOptionsPage();
  }

  async function ensureSessionForTab(tab: chrome.tabs.Tab): Promise<Session> {
    const response = await sendExtensionRequest('SESSION_LIST', undefined, 'popup');
    const sessions = sortSessionsByActivity(response.sessions);
    const existingSession = sessions.find((session) => session.targetTabId === tab.id);

    if (existingSession) {
      return existingSession;
    }

    const settingsSnapshot = await sendExtensionRequest('SETTINGS_GET', undefined, 'popup');
    const provider = settingsSnapshot.activeProvider;
    const model = resolveProviderModelForSession(provider, settingsSnapshot);

    const created = await sendExtensionRequest(
      'SESSION_CREATE',
      {
        tabId: tab.id,
        config: {
          provider,
          model,
          name: tab.title?.trim() ? `${tab.title.trim()} quick action` : 'Quick action session',
        },
      },
      'popup',
    );

    return created.session;
  }

  async function handleQuickAction(actionId: QuickActionId): Promise<void> {
    if (needsOnboarding || isOnboardingLocked) {
      return;
    }

    if (!activeTab?.id) {
      setActionError('Open a tab first so Flux has a live page context to target.');
      setActionMessage('');
      return;
    }

    if (pageInfo.isFallback) {
      setActionError('The active tab context is unavailable right now. Try again after the page is accessible.');
      setActionMessage('');
      return;
    }

    if (providerBlocksQuickActions) {
      setActionError(`${providerStatus.title}. ${providerStatus.action}`);
      setActionMessage('');
      return;
    }

    setPendingActionId(actionId);
    setActionError('');
    setActionMessage('');

    try {
      await openSidePanelForTab(activeTab);

      if (actionId === 'replay-last-run') {
        const latestReplaySession = replaySession ?? null;
        if (!latestReplaySession) {
          throw new Error('No recorded automation run is available to replay yet.');
        }

        await sendExtensionRequest(
          'SESSION_PLAYBACK_START',
          {
            sessionId: latestReplaySession.config.id,
            speed: latestReplaySession.playback.speed,
          },
          'popup',
        );

        setActionMessage('Started playback for the latest recorded automation session in the side panel.');
      } else {
        const session = await ensureSessionForTab(activeTab);
        await sendExtensionRequest(
          'SESSION_SEND_MESSAGE',
          {
            sessionId: session.config.id,
            message: QUICK_ACTION_PROMPTS[actionId],
          },
          'popup',
        );

        const selectedAction = QUICK_ACTIONS.find((action) => action.id === actionId);
        setActionMessage(
          selectedAction
            ? `${selectedAction.label} was sent to the side panel for the current tab.`
            : 'Quick action started in the side panel.',
        );
      }

      await refreshReplayAvailability(activeTab.id);
    } catch (error) {
      setActionError(getErrorMessage(error, 'Quick action failed.'));
    } finally {
      setPendingActionId(null);
    }
  }

  const tabContextUnavailable = !activeTab?.id || pageInfo.isFallback;
  const providerBlocksQuickActions = providerStatus.blocksQuickActions;
  const baseQuickActionsDisabled =
    isOnboardingLocked || needsOnboarding || tabContextUnavailable || providerBlocksQuickActions;
  const tabContextMessage =
    activeTab?.id && pageInfo.isFallback
      ? pageInfo.summary
      : 'Quick actions need an accessible active tab before they can run.';
  const tabContextStatusLabel = activeTab?.id && pageInfo.isFallback ? pageInfo.status : 'Active tab unavailable';
  const quickActionAvailabilityMessage = needsOnboarding
    ? 'Complete guided setup to unlock live quick actions for the current tab.'
    : tabContextUnavailable
      ? tabContextMessage
      : providerBlocksQuickActions
        ? `${providerStatus.detail} ${providerStatus.action}`
        : replayReason;

  return (
    <div
      className="flex h-[480px] w-[360px] flex-col overflow-hidden bg-[rgb(var(--color-bg-primary))] text-[rgb(var(--color-text-primary))]"
      data-testid="popup-root"
    >
      <header className="relative overflow-hidden border-b border-[rgb(var(--color-border-default))] bg-[linear-gradient(135deg,rgb(var(--color-bg-secondary))_0%,rgb(var(--color-bg-primary))_55%,rgb(var(--color-primary-50))_100%)] px-4 py-4">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.16),transparent_58%)]" />

        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[rgb(var(--color-text-secondary))]">
              Flux Agent
            </p>
            <h1 className="mt-1 text-xl font-semibold leading-snug tracking-tight">
              Quick actions
            </h1>
            <p className="mt-1 text-sm text-[rgb(var(--color-text-secondary))]">
              Compact command center for the current page.
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[rgb(var(--color-border-default))] bg-[rgb(var(--color-bg-primary))] shadow-sm">
              <Bolt className="h-5 w-5 text-[rgb(var(--color-primary-600))]" aria-hidden="true" />
            </span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3">
        <Card variant="elevated" className="overflow-hidden" data-testid="popup-page-card">
          <CardHeader className="pb-1">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardDescription className="text-xs uppercase tracking-[0.14em]">
                  Current page
                </CardDescription>
                <CardTitle as="h2" className="mt-1 text-base">
                  {pageInfo.title}
                </CardTitle>
              </div>
              <Badge variant={pageInfo.isFallback ? 'default' : 'info'} dot>
                {pageInfo.status}
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="space-y-3 pt-2">
            <p className="text-ellipsis-2 text-sm leading-relaxed text-[rgb(var(--color-text-secondary))]">
              {pageInfo.summary}
            </p>

            <dl className="grid grid-cols-1 gap-2 text-sm">
              <div className="rounded-xl border border-[rgb(var(--color-border-default))] bg-[rgb(var(--color-bg-secondary))] px-3 py-2">
                <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-[rgb(var(--color-text-tertiary))]">
                  Domain
                </dt>
                <dd className="mt-1 truncate font-medium text-[rgb(var(--color-text-primary))]">
                  {pageInfo.domain}
                </dd>
              </div>

              <div className="rounded-xl border border-[rgb(var(--color-border-default))] px-3 py-2">
                <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-[rgb(var(--color-text-tertiary))]">
                  URL
                </dt>
                <dd className="mt-1 truncate font-medium text-[rgb(var(--color-text-secondary))]">
                  {pageInfo.url}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card
          variant="elevated"
          className="overflow-hidden"
          data-testid="popup-provider-card"
        >
          <CardHeader className="pb-1">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardDescription className="text-xs uppercase tracking-[0.14em]">
                  Active provider
                </CardDescription>
                <CardTitle as="h2" className="mt-1 text-base">
                  {providerStatus.providerLabel}
                </CardTitle>
              </div>
              <Badge variant={providerStatus.badgeVariant} dot>
                {isProviderStatusLoading ? 'Checking' : providerStatus.badgeLabel}
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="space-y-3 pt-2">
            <div className="flex items-start gap-3 rounded-2xl border border-[rgb(var(--color-border-default))] bg-[rgb(var(--color-bg-secondary))] px-3 py-3">
              <span
                className={[
                  'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                  providerStatus.badgeVariant === 'success'
                    ? 'bg-[rgb(var(--color-success-50))] text-[rgb(var(--color-success-700))]'
                    : providerStatus.badgeVariant === 'error'
                      ? 'bg-[rgb(var(--color-error-50))] text-[rgb(var(--color-error-700))]'
                      : providerStatus.badgeVariant === 'warning'
                        ? 'bg-[rgb(var(--color-warning-50))] text-[rgb(var(--color-warning-700))]'
                        : 'bg-[rgb(var(--color-primary-50))] text-[rgb(var(--color-primary-700))]',
                ].join(' ')}
              >
                {providerStatus.blocksQuickActions ? (
                  providerStatus.badgeVariant === 'warning' ? (
                    <Lock className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  )
                ) : (
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                )}
              </span>

              <div className="min-w-0">
                <p className="text-sm font-semibold leading-snug tracking-tight text-[rgb(var(--color-text-primary))]">
                  {providerStatus.title}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-[rgb(var(--color-text-secondary))]">
                  {providerStatus.detail}
                </p>
              </div>
            </div>

            <p className="text-xs leading-relaxed text-[rgb(var(--color-text-secondary))]">
              {providerStatus.action}
            </p>
          </CardContent>
        </Card>

        <section
          aria-labelledby="popup-quick-actions-heading"
          className="min-h-0 flex-1 overflow-y-auto pr-1"
        >
          {needsOnboarding ? (
            <Card
              variant="elevated"
              className="mb-3 border border-[rgb(var(--color-primary-200))] bg-[linear-gradient(135deg,rgb(var(--color-primary-50))_0%,rgb(var(--color-bg-primary))_100%)]"
            >
              <CardContent className="flex items-start justify-between gap-3 px-4 py-4">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[rgb(var(--color-primary-700))]">
                    Guided setup
                  </p>
                  <p className="mt-1 text-sm font-semibold text-[rgb(var(--color-text-primary))]">
                    Open guided setup before your first live workflow.
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-[rgb(var(--color-text-secondary))]">
                    Review the welcome steps, verify a provider connection, and confirm the
                    capability boundaries in options.
                  </p>
                </div>

                <Button
                  type="button"
                  className="shrink-0"
                  onClick={() => {
                    void handleFinishSetup();
                  }}
                >
                  Open guided setup
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 id="popup-quick-actions-heading" className="text-sm font-semibold tracking-tight">
              Quick actions
            </h2>
            <span className="text-xs text-[rgb(var(--color-text-secondary))]">4 actions</span>
          </div>

          <div className="grid grid-cols-2 gap-3" data-testid="popup-quick-actions">
            {QUICK_ACTIONS.map((action) => {
              const Icon = action.icon;
              const isReplayDisabled = action.id === 'replay-last-run' && replaySession === null;
              const disabled = baseQuickActionsDisabled || isReplayDisabled || pendingActionId !== null;

              return (
                <Button
                  key={action.id}
                  type="button"
                  variant="secondary"
                  size="lg"
                  loading={pendingActionId === action.id}
                  disabled={disabled}
                  className="group flex h-full min-h-28 flex-col items-start justify-start rounded-2xl border border-[rgb(var(--color-border-default))] px-3 py-3 text-left shadow-sm"
                  onClick={() => {
                    void handleQuickAction(action.id);
                  }}
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[rgb(var(--color-primary-50))] text-[rgb(var(--color-primary-700))] transition-transform duration-150 group-hover:-translate-y-0.5">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="mt-3 block text-sm font-semibold leading-snug tracking-tight text-[rgb(var(--color-text-primary))]">
                    {action.label}
                  </span>
                  <span className="mt-1 text-ellipsis-2 text-xs leading-relaxed text-[rgb(var(--color-text-secondary))]">
                    {action.description}
                  </span>
                </Button>
              );
            })}
          </div>

          {needsOnboarding ? (
            <p className="mt-2 text-xs text-[rgb(var(--color-text-secondary))]">
              {quickActionAvailabilityMessage}
            </p>
          ) : tabContextUnavailable ? (
            <p className="mt-2 text-xs text-[rgb(var(--color-text-secondary))]">
              {quickActionAvailabilityMessage}
            </p>
          ) : providerBlocksQuickActions ? (
            <p className="mt-2 text-xs text-[rgb(var(--color-text-secondary))]">
              {quickActionAvailabilityMessage}
            </p>
          ) : replaySession === null ? (
            <p className="mt-2 text-xs text-[rgb(var(--color-text-secondary))]">
              {quickActionAvailabilityMessage}
            </p>
          ) : (
            <p className="mt-2 text-xs text-[rgb(var(--color-text-secondary))]">
              {quickActionAvailabilityMessage}
            </p>
          )}
        </section>
      </main>

      <footer className="border-t border-[rgb(var(--color-border-default))] bg-[rgb(var(--color-bg-secondary))] px-4 py-3">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-[rgb(var(--color-border-default))] bg-[rgb(var(--color-bg-primary))] px-3 py-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-tight">
              {needsOnboarding
                ? 'Guided setup required'
                : pendingActionId
                  ? 'Launching quick action'
                  : actionError
                    ? 'Action failed'
                    : providerBlocksQuickActions
                      ? providerStatus.badgeLabel
                    : tabContextUnavailable
                      ? tabContextStatusLabel
                      : actionMessage
                        ? 'Side panel launched'
                        : 'Ready for live actions'}
            </p>
            <p className="truncate text-xs text-[rgb(var(--color-text-secondary))]">
              {needsOnboarding
                ? 'Finish guided setup to unlock quick actions for the current tab.'
                : pendingActionId
                  ? 'Flux is opening the side panel and handing off the request.'
                  : actionError
                    ? actionError
                    : providerBlocksQuickActions
                      ? quickActionAvailabilityMessage
                    : tabContextUnavailable
                      ? tabContextMessage
                      : actionMessage
                        ? actionMessage
                        : 'Popup quick actions now create or reuse sessions and hand work to the side panel.'}
            </p>
          </div>

          {needsOnboarding ? (
            <Button
              type="button"
              size="sm"
              className="shrink-0"
              onClick={() => {
                void handleFinishSetup();
              }}
            >
              Finish setup
            </Button>
          ) : (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--color-bg-secondary))] text-[rgb(var(--color-text-secondary))]">
              <MousePointerClick className="h-4 w-4" aria-hidden="true" />
            </span>
          )}
        </div>
      </footer>
    </div>
  );
}
