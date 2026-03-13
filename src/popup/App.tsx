import { useCallback, useEffect, useState } from 'react';
import {
  Bolt,
  Eye,
  FileText,
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
import { normalizeOnboardingState, ONBOARDING_STORAGE_KEY } from '@/shared/storage/onboarding';
import type { Session } from '@/shared/types';
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

function formatUrlParts(url?: string): Pick<PageInfo, 'url' | 'domain'> {
  if (!url) {
    return {
      url: 'No page URL available yet.',
      domain: 'Unavailable',
    };
  }

  try {
    const parsedUrl = new URL(url);
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

function mapTabToPageInfo(tab?: chrome.tabs.Tab): PageInfo {
  if (!tab) {
    return DEFAULT_PAGE_INFO;
  }

  const urlParts = formatUrlParts(tab.url);
  const title = tab.title?.trim() || 'Untitled tab';
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

  useEffect(() => {
    let isActive = true;

    function applyOnboardingState(rawValue: unknown): void {
      const onboardingState = normalizeOnboardingState(rawValue);
      setNeedsOnboarding(!onboardingState.completed);
      setIsOnboardingLocked(false);

      if (onboardingState.completed) {
        void refreshReplayAvailability(activeTab?.id);
      } else {
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
          setReplaySession(null);
          setReplayReason('Complete guided setup before loading replay actions.');
        }
      });

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      isActive = false;
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [activeTab?.id, refreshReplayAvailability]);

  useEffect(() => {
    if (needsOnboarding || isOnboardingLocked || !activeTab?.id) {
      return;
    }

    void refreshReplayAvailability(activeTab.id);
  }, [activeTab?.id, isOnboardingLocked, needsOnboarding, refreshReplayAvailability]);

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
    const configuredModel = settingsSnapshot.providers[provider]?.model;
    const model =
      typeof configuredModel === 'string' && configuredModel.trim().length > 0
        ? configuredModel
        : 'gpt-4o-mini';

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
  const baseQuickActionsDisabled = isOnboardingLocked || needsOnboarding || tabContextUnavailable;

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

        <section aria-labelledby="popup-quick-actions-heading" className="min-h-0 flex-1">
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
              Complete guided setup to unlock live quick actions for the current tab.
            </p>
          ) : tabContextUnavailable ? (
            <p className="mt-2 text-xs text-[rgb(var(--color-text-secondary))]">
              Quick actions need an accessible active tab before they can run.
            </p>
          ) : replaySession === null ? (
            <p className="mt-2 text-xs text-[rgb(var(--color-text-secondary))]">{replayReason}</p>
          ) : (
            <p className="mt-2 text-xs text-[rgb(var(--color-text-secondary))]">{replayReason}</p>
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
                    : tabContextUnavailable
                      ? 'Active tab unavailable'
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
                    : tabContextUnavailable
                      ? 'The popup is waiting for an active tab it can access.'
                      : actionMessage
                        ? actionMessage
                        : 'Popup quick actions now create or reuse sessions and hand work to the side panel.'}
            </p>
          </div>

          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--color-bg-secondary))] text-[rgb(var(--color-text-secondary))]">
            <MousePointerClick className="h-4 w-4" aria-hidden="true" />
          </span>
        </div>
      </footer>
    </div>
  );
}
