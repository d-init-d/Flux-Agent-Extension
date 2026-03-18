import { useEffect, useMemo, useState } from 'react';
import { ActionLogPanel } from './components/ActionLogPanel';
import { ChatContainer } from './components/ChatContainer';
import { InputComposer } from './components/InputComposer';
import { SaveWorkflowModal, WorkflowLibraryModal } from './components/WorkflowModals';
import { useActionLog } from './hooks/useActionLog';
import { useChat } from './hooks/useChat';
import { useEscapeToStopShortcut } from './keyboard-shortcuts';
import { useSession } from './hooks/useSession';
import { sendExtensionRequest, subscribeToExtensionEvents } from './lib/extension-client';
import { useWorkflowUIStore } from './store/workflowUIStore';
import { Button } from '@/ui/components';
import { PROVIDER_LOOKUP, providerUsesAccountImport } from '@/shared/config';
import { resolveAccountBackedProviderUx } from '@/shared/ui/account-backed-provider-ux';
import { resolveKeyBasedProviderUx } from '@/shared/ui/key-based-provider-ux';
import { ThemeToggle } from '@/ui/theme';
import type {
  AccountAuthStatusGetResponse,
  AIProviderType,
  AIStreamEventPayload,
  ActionProgressEventPayload,
  SettingsGetResponse,
  SavedWorkflowSource,
  SessionRecordingExportFormat,
  SessionPlaybackSpeed,
  SerializedFileUpload,
  Session,
  SessionUpdateEventPayload,
} from '@shared/types';

interface SidepanelProviderNotice {
  badgeLabel: string;
  badgeVariant: 'default' | 'info' | 'success' | 'warning' | 'error';
  title: string;
  detail: string;
  action: string;
  blocksSend: boolean;
}

type RecordingRequestAction =
  | 'SESSION_RECORDING_START'
  | 'SESSION_RECORDING_PAUSE'
  | 'SESSION_RECORDING_RESUME'
  | 'SESSION_RECORDING_STOP';

type PlaybackRequestAction =
  | 'SESSION_PLAYBACK_START'
  | 'SESSION_PLAYBACK_PAUSE'
  | 'SESSION_PLAYBACK_RESUME'
  | 'SESSION_PLAYBACK_STOP'
  | 'SESSION_PLAYBACK_SET_SPEED';

const PLAYBACK_SPEED_OPTIONS: Array<{ value: SessionPlaybackSpeed; label: string }> = [
  { value: 0.5, label: '0.5x' },
  { value: 1, label: '1x' },
  { value: 2, label: '2x' },
];

const RECORDING_EXPORT_FORMAT_OPTIONS: Array<{
  value: SessionRecordingExportFormat;
  label: string;
}> = [
  { value: 'json', label: 'JSON' },
  { value: 'playwright', label: 'Playwright' },
  { value: 'puppeteer', label: 'Puppeteer' },
];

function getRecordingSummary(status: 'idle' | 'recording' | 'paused', actionCount: number): string {
  const actionLabel = `${actionCount} action${actionCount === 1 ? '' : 's'}`;

  switch (status) {
    case 'recording':
      return `${actionLabel} captured so far. New browser steps will keep syncing into this session.`;
    case 'paused':
      return `${actionLabel} captured. Resume when you want to keep collecting steps.`;
    default:
      return actionCount > 0
        ? `${actionLabel} captured in this session. Start again to continue recording.`
        : 'Capture browser actions for this session when you are ready.';
  }
}

function formatActionCount(actionCount: number): string {
  return `${actionCount} action${actionCount === 1 ? '' : 's'}`;
}

function getPlaybackSummary({
  playbackStatus,
  actionCount,
  nextActionIndex,
  speed,
  lastCompletedAt,
}: {
  playbackStatus: 'idle' | 'playing' | 'paused';
  actionCount: number;
  nextActionIndex: number;
  speed: SessionPlaybackSpeed;
  lastCompletedAt: number | null;
}): string {
  if (actionCount === 0) {
    return 'Playback is unavailable until this session has recorded actions.';
  }

  const actionLabel = formatActionCount(actionCount);
  const currentStep = Math.min(nextActionIndex + 1, actionCount);
  const isCompleted =
    playbackStatus === 'idle' && nextActionIndex === actionCount && lastCompletedAt !== null;

  if (isCompleted) {
    return `Playback finished for ${actionLabel}. You can replay it from the start.`;
  }

  switch (playbackStatus) {
    case 'playing':
      return `Playing step ${currentStep} of ${actionCount} at ${speed}x.`;
    case 'paused':
      return `Paused on step ${currentStep} of ${actionCount} at ${speed}x.`;
    default:
      return `Ready to replay ${actionLabel} from the start.`;
  }
}

function getPlaybackProgressLabel(nextActionIndex: number, actionCount: number): string {
  if (actionCount === 0) {
    return '0 / 0 actions';
  }

  return `${Math.min(nextActionIndex, actionCount)} / ${actionCount} actions`;
}

function getPlaybackErrorMessage(message: string): string {
  const normalized = message.trim();
  if (!normalized) {
    return 'Playback paused because the last step failed.';
  }

  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

function getSessionDisplayName(session: Session | null): string {
  return session?.config.name?.trim() || 'Current session';
}

function getDefaultWorkflowDraft(session: Session | null, actionCount: number) {
  const sessionName = getSessionDisplayName(session);

  return {
    name: `${sessionName} workflow`,
    description: `Captured ${formatActionCount(actionCount)} from ${sessionName}.`,
    tags: '',
  };
}

function getWorkflowSource(session: Session | null): SavedWorkflowSource | undefined {
  if (!session) {
    return undefined;
  }

  return {
    sessionId: session.config.id,
    sessionName: session.config.name?.trim() || undefined,
    recordedAt: session.recording.updatedAt ?? session.recording.startedAt ?? undefined,
  };
}

function mapKeyBasedProviderNotice(
  provider: AIProviderType,
  settingsSnapshot: SettingsGetResponse,
): SidepanelProviderNotice {
  const ux = resolveKeyBasedProviderUx(provider, {
    config: settingsSnapshot.providers[provider],
    credential: settingsSnapshot.vault.credentials[provider],
    vaultLockState: settingsSnapshot.vault.lockState,
  });

  return {
    badgeLabel: ux.badgeLabel,
    badgeVariant: ux.badgeVariant,
    title: ux.title,
    detail: ux.detail,
    action: ux.action,
    blocksSend: ux.blocksRuntime,
  };
}

export function App() {
  useEscapeToStopShortcut();
  const [initialSessionCount, setInitialSessionCount] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [providerNotice, setProviderNotice] = useState<SidepanelProviderNotice | null>(null);
  const [recordingRequest, setRecordingRequest] = useState<RecordingRequestAction | null>(null);
  const [recordingExportRequest, setRecordingExportRequest] =
    useState<SessionRecordingExportFormat | null>(null);
  const [playbackRequest, setPlaybackRequest] = useState<PlaybackRequestAction | null>(null);
  const [playbackSpeedDraft, setPlaybackSpeedDraft] = useState<SessionPlaybackSpeed>(1);
  const [recordingExportFormat, setRecordingExportFormat] =
    useState<SessionRecordingExportFormat>('json');
  const workflowModal = useWorkflowUIStore((state) => state.activeModal);
  const workflowViewMode = useWorkflowUIStore((state) => state.viewMode);
  const workflowItems = useWorkflowUIStore((state) => state.items);
  const workflowIsHydrating = useWorkflowUIStore((state) => state.isHydrating);
  const workflowIsSaving = useWorkflowUIStore((state) => state.isSaving);
  const workflowSaveMode = useWorkflowUIStore((state) => state.saveMode);
  const workflowRunningId = useWorkflowUIStore((state) => state.isRunningWorkflowId);
  const workflowDeletingId = useWorkflowUIStore((state) => state.isDeletingWorkflowId);
  const workflowError = useWorkflowUIStore((state) => state.error);
  const workflowSaveDraft = useWorkflowUIStore((state) => state.saveDraft);
  const selectedWorkflowId = useWorkflowUIStore((state) => state.selectedWorkflowId);
  const hydrateWorkflows = useWorkflowUIStore((state) => state.hydrate);
  const openWorkflowLibrary = useWorkflowUIStore((state) => state.openLibrary);
  const openSaveWorkflowModal = useWorkflowUIStore((state) => state.openSaveModal);
  const openEditWorkflowModal = useWorkflowUIStore((state) => state.openEditModal);
  const closeWorkflowModal = useWorkflowUIStore((state) => state.closeModal);
  const setWorkflowViewMode = useWorkflowUIStore((state) => state.setViewMode);
  const updateWorkflowSaveDraft = useWorkflowUIStore((state) => state.updateSaveDraft);
  const selectWorkflow = useWorkflowUIStore((state) => state.selectWorkflow);
  const saveWorkflow = useWorkflowUIStore((state) => state.saveWorkflow);
  const deleteWorkflow = useWorkflowUIStore((state) => state.deleteWorkflow);
  const runWorkflow = useWorkflowUIStore((state) => state.runWorkflow);

  const {
    sessions,
    activeSessionId,
    isHydrating,
    hydrate,
    createSession,
    switchSession,
    applySessionUpdate,
  } = useSession();
  const {
    messagesBySession,
    streamMessageIdsBySession,
    syncSession,
    applyStreamChunk,
    appendError,
    sendMessage,
  } = useChat();
  const { entriesBySession, applyProgressEvent } = useActionLog();

  useEffect(() => {
    const unsubscribe = subscribeToExtensionEvents((message) => {
      switch (message.type) {
        case 'EVENT_SESSION_UPDATE': {
          const payload = message.payload as SessionUpdateEventPayload;
          applySessionUpdate(payload.sessionId, payload.session, payload.reason);
          if (payload.session) {
            syncSession(payload.session);
          }
          break;
        }
        case 'EVENT_AI_STREAM': {
          applyStreamChunk(message.payload as AIStreamEventPayload);
          break;
        }
        case 'EVENT_ACTION_PROGRESS': {
          applyProgressEvent(message.payload as ActionProgressEventPayload);
          break;
        }
      }
    });

    hydrate()
      .then((loadedSessions) => {
        loadedSessions.forEach((session) => {
          syncSession(session);
        });
        setInitialSessionCount(loadedSessions.length);
      })
      .catch(() => {
        // Surface-level error state can be added in a later task.
        setInitialSessionCount(0);
      });

    return unsubscribe;
  }, [applyProgressEvent, applySessionUpdate, applyStreamChunk, hydrate, syncSession]);

  useEffect(() => {
    void hydrateWorkflows();
  }, [hydrateWorkflows]);

  useEffect(() => {
    if (initialSessionCount !== 0 || isHydrating || sessions.length > 0) {
      return;
    }

    createSession()
      .then((session) => {
        syncSession(session);
      })
      .catch(() => {
        // Surface-level error state can be added in a later task.
      });
  }, [createSession, initialSessionCount, isHydrating, sessions.length, syncSession]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.config.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );
  const activeMessages = activeSessionId ? (messagesBySession[activeSessionId] ?? []) : [];
  const activeActions = activeSessionId ? (entriesBySession[activeSessionId] ?? []) : [];
  const activeStreamMessageId = activeSessionId
    ? (streamMessageIdsBySession[activeSessionId] ?? null)
    : null;

  const statusLabel = activeSession?.status ?? (isHydrating ? 'Loading' : 'Ready');
  const recordingStatus = activeSession?.recording.status ?? 'idle';
  const recordingActionCount = activeSession?.recording.actions.length ?? 0;
  const recordingSummary = getRecordingSummary(recordingStatus, recordingActionCount);
  const playbackState = activeSession?.playback ?? {
    status: 'idle',
    nextActionIndex: 0,
    speed: 1 as SessionPlaybackSpeed,
    startedAt: null,
    updatedAt: null,
    lastCompletedAt: null,
    lastError: null,
  };
  const playbackSpeed = playbackSpeedDraft;
  const playbackSummary = getPlaybackSummary({
    playbackStatus: playbackState.status,
    actionCount: recordingActionCount,
    nextActionIndex: playbackState.nextActionIndex,
    speed: playbackSpeed,
    lastCompletedAt: playbackState.lastCompletedAt,
  });
  const playbackProgressLabel = getPlaybackProgressLabel(
    playbackState.nextActionIndex,
    recordingActionCount,
  );
  const playbackIsCompleted =
    playbackState.status === 'idle' &&
    recordingActionCount > 0 &&
    playbackState.nextActionIndex === recordingActionCount &&
    playbackState.lastCompletedAt !== null;
  const playDisabled =
    !activeSessionId ||
    recordingActionCount === 0 ||
    recordingStatus !== 'idle' ||
    playbackRequest !== null;
  const recordingExportDisabled =
    !activeSessionId ||
    recordingActionCount === 0 ||
    recordingStatus !== 'idle' ||
    recordingExportRequest !== null;
  const playbackButtonsDisabled = !activeSessionId || playbackRequest !== null;
  const playbackSpeedDisabled =
    !activeSessionId || recordingStatus !== 'idle' || playbackRequest !== null;
  const canSaveWorkflow = Boolean(activeSessionId) && recordingActionCount > 0;
  const activeSessionName = getSessionDisplayName(activeSession);
  const selectedWorkflow = useMemo(
    () => workflowItems.find((workflow) => workflow.id === selectedWorkflowId) ?? null,
    [selectedWorkflowId, workflowItems],
  );
  const workflowRunDisabled = !activeSessionId;
  const activeProviderLabel = activeSession ? PROVIDER_LOOKUP[activeSession.config.provider].label : 'Provider';
  const saveModalActionCount =
    workflowSaveMode === 'edit' ? (selectedWorkflow?.actions.length ?? 0) : recordingActionCount;
  const saveModalSourceSessionName =
    workflowSaveMode === 'edit'
      ? (selectedWorkflow?.source?.sessionName ?? selectedWorkflow?.name ?? 'Saved workflow')
      : activeSessionName;

  useEffect(() => {
    setPlaybackSpeedDraft(playbackState.speed);
  }, [activeSessionId, playbackState.speed]);

  useEffect(() => {
    const provider = activeSession?.config.provider;
    if (!provider || (!providerUsesAccountImport(provider) && provider !== 'cliproxyapi')) {
      setProviderNotice(null);
      return;
    }

    let cancelled = false;

    const loadNotice = async () => {
      if (providerUsesAccountImport(provider)) {
        const authStatus = await sendExtensionRequest('ACCOUNT_AUTH_STATUS_GET', { provider });
        const ux = resolveAccountBackedProviderUx(authStatus as AccountAuthStatusGetResponse);
        return {
          badgeLabel: ux.badgeLabel,
          badgeVariant: ux.badgeVariant,
          title: ux.title,
          detail: ux.detail,
          action: ux.action,
          blocksSend: ux.blocksRuntime,
        } satisfies SidepanelProviderNotice;
      }

      const settingsSnapshot = await sendExtensionRequest('SETTINGS_GET', undefined);
      return mapKeyBasedProviderNotice(provider, settingsSnapshot as SettingsGetResponse);
    };

    void loadNotice()
      .then((authStatus) => {
        if (cancelled) {
          return;
        }

        setProviderNotice(authStatus);
      })
      .catch(() => {
        if (!cancelled) {
          setProviderNotice({
            badgeLabel: 'Status unavailable',
            badgeVariant: 'warning',
            title:
              provider === 'cliproxyapi'
                ? 'CLIProxyAPI readiness could not be refreshed'
                : 'Codex account state could not be refreshed',
            detail:
              provider === 'cliproxyapi'
                ? 'The side panel could not confirm the current CLIProxyAPI endpoint and validation state, so provider guidance may be stale.'
                : 'The side panel could not confirm the current Codex account health, so provider guidance may be stale.',
            action:
              provider === 'cliproxyapi'
                ? 'Open options and re-check the saved endpoint plus connection test before retrying a live request.'
                : 'Open options and re-check the imported account before retrying a live request.',
            blocksSend: false,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeSession?.config.provider, activeSessionId]);

  const handleRecordingRequest = async (type: RecordingRequestAction) => {
    if (!activeSessionId || recordingRequest) {
      return;
    }

    setSubmitError(null);
    setRecordingRequest(type);

    try {
      await sendExtensionRequest(type, { sessionId: activeSessionId });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Recording request failed');
    } finally {
      setRecordingRequest(null);
    }
  };

  const handlePlaybackRequest = async (type: PlaybackRequestAction) => {
    if (!activeSessionId || playbackRequest) {
      return;
    }

    setSubmitError(null);
    setPlaybackRequest(type);

    try {
      if (type === 'SESSION_PLAYBACK_START' || type === 'SESSION_PLAYBACK_RESUME') {
        await sendExtensionRequest(type, {
          sessionId: activeSessionId,
          speed: playbackSpeedDraft,
        });
      } else {
        await sendExtensionRequest(type, { sessionId: activeSessionId });
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Playback request failed');
    } finally {
      setPlaybackRequest(null);
    }
  };

  const handlePlaybackSpeedChange = async (value: string) => {
    if (!activeSessionId || playbackRequest) {
      return;
    }

    const speed = Number(value);
    if (!PLAYBACK_SPEED_OPTIONS.some((option) => option.value === speed)) {
      return;
    }

    const nextSpeed = speed as SessionPlaybackSpeed;

    setSubmitError(null);
    setPlaybackSpeedDraft(nextSpeed);
    setPlaybackRequest('SESSION_PLAYBACK_SET_SPEED');

    try {
      await sendExtensionRequest('SESSION_PLAYBACK_SET_SPEED', {
        sessionId: activeSessionId,
        speed: nextSpeed,
      });
    } catch (error) {
      setPlaybackSpeedDraft(playbackState.speed);
      setSubmitError(error instanceof Error ? error.message : 'Playback speed update failed');
    } finally {
      setPlaybackRequest(null);
    }
  };

  const handleRecordingExport = async () => {
    if (!activeSessionId || recordingExportRequest !== null) {
      return;
    }

    setSubmitError(null);
    setRecordingExportRequest(recordingExportFormat);

    try {
      await sendExtensionRequest('SESSION_RECORDING_EXPORT', {
        sessionId: activeSessionId,
        format: recordingExportFormat,
      });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Recording export failed');
    } finally {
      setRecordingExportRequest(null);
    }
  };

  const handleOpenSaveWorkflow = () => {
    if (!activeSession || recordingActionCount === 0) {
      return;
    }

    openSaveWorkflowModal(getDefaultWorkflowDraft(activeSession, recordingActionCount));
  };

  const handleSaveWorkflow = async () => {
    if (workflowSaveMode === 'edit') {
      await saveWorkflow();
      return;
    }

    if (!activeSession || recordingActionCount === 0) {
      return;
    }

    await saveWorkflow({
      actions: activeSession.recording.actions,
      source: getWorkflowSource(activeSession),
    });
  };

  const handleRunWorkflow = async (workflowId: string) => {
    if (!activeSessionId) {
      return;
    }

    setSubmitError(null);
    const didRun = await runWorkflow(workflowId, activeSessionId);
    if (!didRun) {
      const message = useWorkflowUIStore.getState().error;
      if (message) {
        setSubmitError(message);
      }
    }
  };

  const handleDeleteWorkflow = async (workflowId: string) => {
    setSubmitError(null);
    const didDelete = await deleteWorkflow(workflowId);
    if (!didDelete) {
      const message = useWorkflowUIStore.getState().error;
      if (message) {
        setSubmitError(message);
      }
    }
  };

  const handleSend = async (value: string, uploads?: SerializedFileUpload[]) => {
    setSubmitError(null);
    let sessionId = activeSessionId;
    let nextProviderNotice = providerNotice;

    try {
      let targetProvider = activeSession?.config.provider;

      if (!sessionId) {
        const createdSession = await createSession();
        syncSession(createdSession);
        sessionId = createdSession.config.id;
        targetProvider = createdSession.config.provider;
      }

      if (targetProvider && (!providerUsesAccountImport(targetProvider) && targetProvider !== 'cliproxyapi')) {
        nextProviderNotice = null;
      } else if (targetProvider) {
        if (providerUsesAccountImport(targetProvider)) {
          const authStatus = await sendExtensionRequest('ACCOUNT_AUTH_STATUS_GET', {
            provider: targetProvider,
          });
          const ux = resolveAccountBackedProviderUx(authStatus as AccountAuthStatusGetResponse);
          nextProviderNotice = {
            badgeLabel: ux.badgeLabel,
            badgeVariant: ux.badgeVariant,
            title: ux.title,
            detail: ux.detail,
            action: ux.action,
            blocksSend: ux.blocksRuntime,
          };
        } else {
          const settingsSnapshot = await sendExtensionRequest('SETTINGS_GET', undefined);
          nextProviderNotice = mapKeyBasedProviderNotice(
            targetProvider,
            settingsSnapshot as SettingsGetResponse,
          );
        }

        setProviderNotice(nextProviderNotice);
        if (nextProviderNotice.blocksSend) {
          const message = `${nextProviderNotice.title}. ${nextProviderNotice.action}`;
          setSubmitError(message);
          if (sessionId) {
            appendError(sessionId, message);
          }
          return;
        }
      }

      await sendMessage(sessionId, value, uploads);
    } catch (error) {
      const fallbackMessage = error instanceof Error ? error.message : 'Request failed';
      const message =
        nextProviderNotice?.blocksSend
          ? `${nextProviderNotice.title}. ${nextProviderNotice.action}`
          : fallbackMessage;
      setSubmitError(message);
      if (sessionId) {
        appendError(sessionId, message);
      }
    }
  };

  return (
    <div className="flex h-screen min-h-0 flex-col bg-[rgb(var(--color-bg-primary))] text-[rgb(var(--color-text-primary))]">
      <header
        className="border-b border-[rgb(var(--color-border-default))] bg-[rgb(var(--color-bg-secondary))] px-4 py-4 sm:px-6"
        data-testid="sidepanel-header"
      >
        <div className="mx-auto flex w-full max-w-3xl items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold leading-snug tracking-tight">Flux Agent</h1>
            <p className="mt-1 text-sm text-[rgb(var(--color-text-secondary))]">
              Connected side panel assistant
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <label className="flex items-center gap-2 text-xs font-medium text-[rgb(var(--color-text-secondary))]">
              <span className="sr-only">Active session</span>
              <select
                aria-label="Active session"
                className="min-h-9 rounded-lg border border-[rgb(var(--color-border-default))] bg-[rgb(var(--color-bg-primary))] px-3 text-sm text-[rgb(var(--color-text-primary))]"
                value={activeSessionId ?? ''}
                onChange={(event) => switchSession(event.target.value)}
              >
                {sessions.map((session, index) => (
                  <option key={session.config.id} value={session.config.id}>
                    {session.config.name?.trim() || `Session ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              variant="ghost"
              size="md"
              className="min-h-9 px-3"
              onClick={openWorkflowLibrary}
            >
              Saved workflows
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="md"
              className="min-h-9 px-3"
              onClick={() => {
                setSubmitError(null);
                void createSession().catch((error) => {
                  setSubmitError(
                    error instanceof Error ? error.message : 'Failed to create session',
                  );
                });
              }}
            >
              New session
            </Button>
            <span className="inline-flex h-7 items-center rounded-full border border-[rgb(var(--color-border-default))] px-3 text-xs font-medium text-[rgb(var(--color-text-secondary))]">
              {statusLabel}
            </span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {providerNotice &&
      activeSession?.config.provider &&
      (providerUsesAccountImport(activeSession.config.provider) ||
        activeSession.config.provider === 'cliproxyapi') ? (
        <section className="border-b border-[rgb(var(--color-border-default))] bg-[rgb(var(--color-bg-secondary)/0.7)] px-4 py-3 sm:px-6">
          <div className="mx-auto w-full max-w-3xl">
            <div className="rounded-2xl border border-[rgb(var(--color-border-default)/0.8)] bg-[rgb(var(--color-bg-primary))] px-4 py-4 shadow-sm sm:px-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold leading-snug tracking-tight text-[rgb(var(--color-text-primary))]">
                      {activeProviderLabel}
                    </p>
                    <span
                      className={[
                        'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium',
                        providerNotice.badgeVariant === 'success'
                          ? 'border-[rgb(var(--color-success-500)/0.2)] bg-[rgb(var(--color-success-50))] text-[rgb(var(--color-success-700))]'
                          : providerNotice.badgeVariant === 'error'
                            ? 'border-[rgb(var(--color-error-500)/0.2)] bg-[rgb(var(--color-error-50))] text-[rgb(var(--color-error-700))]'
                            : providerNotice.badgeVariant === 'warning'
                              ? 'border-[rgb(var(--color-warning-500)/0.2)] bg-[rgb(var(--color-warning-50))] text-[rgb(var(--color-warning-700))]'
                              : 'border-[rgb(var(--color-border-default))] bg-[rgb(var(--color-bg-secondary))] text-[rgb(var(--color-text-secondary))]',
                      ].join(' ')}
                    >
                      {providerNotice.badgeLabel}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-medium text-[rgb(var(--color-text-primary))]">
                    {providerNotice.title}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-[rgb(var(--color-text-secondary))]">
                    {providerNotice.detail}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-[rgb(var(--color-text-tertiary))]">
                    {providerNotice.action}
                  </p>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  className="min-h-11 shrink-0 px-4"
                  onClick={() => {
                    void chrome.runtime.openOptionsPage();
                  }}
                >
                  Open provider settings
                </Button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section
        aria-label="Recording controls"
        className="border-b border-[rgb(var(--color-border-default))] bg-[rgb(var(--color-bg-secondary)/0.82)] px-4 py-3 sm:px-6"
        data-testid="sidepanel-recording-controls"
      >
        <div className="mx-auto w-full max-w-3xl">
          <div className="grid gap-3">
            <div className="rounded-2xl border border-[rgb(var(--color-border-default)/0.8)] bg-[rgb(var(--color-bg-primary))] shadow-sm">
              <div className="flex flex-col gap-4 px-4 py-4 sm:px-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold leading-snug tracking-tight text-[rgb(var(--color-text-primary))]">
                        Session recording
                      </p>
                      {recordingStatus === 'recording' ? (
                        <span
                          className="inline-flex items-center gap-2 rounded-full border border-[rgb(var(--color-error-500)/0.2)] bg-[rgb(var(--color-error-50))] px-2.5 py-1 text-xs font-medium text-[rgb(var(--color-error-700))]"
                          data-testid="recording-live-indicator"
                        >
                          <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
                            <span className="absolute inset-0 rounded-full bg-[rgb(var(--color-error-500))] opacity-75 animate-ping" />
                            <span className="relative h-2.5 w-2.5 rounded-full bg-[rgb(var(--color-error-600))]" />
                          </span>
                          Live
                        </span>
                      ) : null}
                      {recordingStatus === 'paused' ? (
                        <span className="inline-flex items-center rounded-full border border-[rgb(var(--color-border-default))] bg-[rgb(var(--color-bg-secondary))] px-2.5 py-1 text-xs font-medium text-[rgb(var(--color-text-secondary))]">
                          Paused
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-[rgb(var(--color-text-secondary))]">
                      {recordingSummary}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {recordingStatus === 'idle' ? (
                      <Button
                        type="button"
                        variant="primary"
                        size="md"
                        className="min-h-11 px-4"
                        disabled={!activeSessionId}
                        loading={recordingRequest === 'SESSION_RECORDING_START'}
                        onClick={() => {
                          void handleRecordingRequest('SESSION_RECORDING_START');
                        }}
                      >
                        Start recording
                      </Button>
                    ) : null}

                    {recordingStatus === 'recording' ? (
                      <>
                        <Button
                          type="button"
                          variant="secondary"
                          size="md"
                          className="min-h-11 px-4"
                          loading={recordingRequest === 'SESSION_RECORDING_PAUSE'}
                          disabled={recordingRequest !== null}
                          onClick={() => {
                            void handleRecordingRequest('SESSION_RECORDING_PAUSE');
                          }}
                        >
                          Pause
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          size="md"
                          className="min-h-11 px-4"
                          loading={recordingRequest === 'SESSION_RECORDING_STOP'}
                          disabled={recordingRequest !== null}
                          onClick={() => {
                            void handleRecordingRequest('SESSION_RECORDING_STOP');
                          }}
                        >
                          Stop
                        </Button>
                      </>
                    ) : null}

                    {recordingStatus === 'paused' ? (
                      <>
                        <Button
                          type="button"
                          variant="primary"
                          size="md"
                          className="min-h-11 px-4"
                          loading={recordingRequest === 'SESSION_RECORDING_RESUME'}
                          disabled={recordingRequest !== null}
                          onClick={() => {
                            void handleRecordingRequest('SESSION_RECORDING_RESUME');
                          }}
                        >
                          Resume
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          size="md"
                          className="min-h-11 px-4"
                          loading={recordingRequest === 'SESSION_RECORDING_STOP'}
                          disabled={recordingRequest !== null}
                          onClick={() => {
                            void handleRecordingRequest('SESSION_RECORDING_STOP');
                          }}
                        >
                          Stop
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            <div
              className="rounded-2xl border border-[rgb(var(--color-border-default)/0.8)] bg-[rgb(var(--color-bg-primary))] shadow-sm"
              data-testid="sidepanel-playback-controls"
            >
              <div className="flex flex-col gap-4 px-4 py-4 sm:px-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold leading-snug tracking-tight text-[rgb(var(--color-text-primary))]">
                        Playback recorded actions
                      </p>
                      {playbackState.status === 'playing' ? (
                        <span className="inline-flex items-center rounded-full border border-[rgb(var(--color-primary-500)/0.2)] bg-[rgb(var(--color-primary-50))] px-2.5 py-1 text-xs font-medium text-[rgb(var(--color-primary-700))]">
                          Playing
                        </span>
                      ) : null}
                      {playbackState.status === 'paused' ? (
                        <span className="inline-flex items-center rounded-full border border-[rgb(var(--color-border-default))] bg-[rgb(var(--color-bg-secondary))] px-2.5 py-1 text-xs font-medium text-[rgb(var(--color-text-secondary))]">
                          Paused
                        </span>
                      ) : null}
                      {playbackIsCompleted ? (
                        <span className="inline-flex items-center rounded-full border border-[rgb(var(--color-success-500)/0.2)] bg-[rgb(var(--color-success-50))] px-2.5 py-1 text-xs font-medium text-[rgb(var(--color-success-700))]">
                          Finished
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-medium text-[rgb(var(--color-text-tertiary))]">
                      <span className="inline-flex items-center rounded-full border border-[rgb(var(--color-border-default))] px-2.5 py-1">
                        {playbackProgressLabel}
                      </span>
                      <span className="inline-flex items-center rounded-full border border-[rgb(var(--color-border-default))] px-2.5 py-1">
                        Speed {playbackSpeed}x
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-[rgb(var(--color-text-secondary))]">
                      {playbackSummary}
                    </p>
                    {playbackState.status === 'paused' && playbackState.lastError ? (
                      <p
                        className="mt-2 text-sm leading-relaxed text-[rgb(var(--color-error-700))]"
                        role="status"
                      >
                        Playback issue: {getPlaybackErrorMessage(playbackState.lastError.message)}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-3 sm:items-end">
                    <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-[rgb(var(--color-text-secondary))]">
                      <span>Playback speed</span>
                      <select
                        aria-label="Playback speed"
                        className="min-h-11 rounded-lg border border-[rgb(var(--color-border-default))] bg-[rgb(var(--color-bg-primary))] px-3 text-sm text-[rgb(var(--color-text-primary))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-border-focus))] disabled:cursor-not-allowed disabled:opacity-50"
                        value={String(playbackSpeed)}
                        disabled={playbackSpeedDisabled}
                        onChange={(event) => {
                          void handlePlaybackSpeedChange(event.target.value);
                        }}
                      >
                        {PLAYBACK_SPEED_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="flex flex-wrap items-end gap-2">
                      <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-[rgb(var(--color-text-secondary))]">
                        <span>Export format</span>
                        <select
                          aria-label="Recording export format"
                          className="min-h-11 rounded-lg border border-[rgb(var(--color-border-default))] bg-[rgb(var(--color-bg-primary))] px-3 text-sm text-[rgb(var(--color-text-primary))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-border-focus))] disabled:cursor-not-allowed disabled:opacity-50"
                          value={recordingExportFormat}
                          disabled={recordingExportDisabled}
                          onChange={(event) => {
                            setRecordingExportFormat(
                              event.target.value as SessionRecordingExportFormat,
                            );
                          }}
                        >
                          {RECORDING_EXPORT_FORMAT_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Button
                        type="button"
                        variant="outline"
                        size="md"
                        className="min-h-11 px-4"
                        disabled={!canSaveWorkflow}
                        onClick={handleOpenSaveWorkflow}
                      >
                        Save workflow
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="md"
                        className="min-h-11 px-4"
                        disabled={recordingExportDisabled}
                        loading={recordingExportRequest !== null}
                        onClick={() => {
                          void handleRecordingExport();
                        }}
                      >
                        Export
                      </Button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {playbackState.status === 'idle' ? (
                        <Button
                          type="button"
                          variant="primary"
                          size="md"
                          className="min-h-11 px-4"
                          disabled={playDisabled}
                          loading={playbackRequest === 'SESSION_PLAYBACK_START'}
                          onClick={() => {
                            void handlePlaybackRequest('SESSION_PLAYBACK_START');
                          }}
                        >
                          Play
                        </Button>
                      ) : null}

                      {playbackState.status === 'playing' ? (
                        <>
                          <Button
                            type="button"
                            variant="secondary"
                            size="md"
                            className="min-h-11 px-4"
                            disabled={playbackButtonsDisabled}
                            loading={playbackRequest === 'SESSION_PLAYBACK_PAUSE'}
                            onClick={() => {
                              void handlePlaybackRequest('SESSION_PLAYBACK_PAUSE');
                            }}
                          >
                            Pause
                          </Button>
                          <Button
                            type="button"
                            variant="danger"
                            size="md"
                            className="min-h-11 px-4"
                            disabled={playbackButtonsDisabled}
                            loading={playbackRequest === 'SESSION_PLAYBACK_STOP'}
                            onClick={() => {
                              void handlePlaybackRequest('SESSION_PLAYBACK_STOP');
                            }}
                          >
                            Stop
                          </Button>
                        </>
                      ) : null}

                      {playbackState.status === 'paused' ? (
                        <>
                          <Button
                            type="button"
                            variant="primary"
                            size="md"
                            className="min-h-11 px-4"
                            disabled={playbackButtonsDisabled}
                            loading={playbackRequest === 'SESSION_PLAYBACK_RESUME'}
                            onClick={() => {
                              void handlePlaybackRequest('SESSION_PLAYBACK_RESUME');
                            }}
                          >
                            Resume
                          </Button>
                          <Button
                            type="button"
                            variant="danger"
                            size="md"
                            className="min-h-11 px-4"
                            disabled={playbackButtonsDisabled}
                            loading={playbackRequest === 'SESSION_PLAYBACK_STOP'}
                            onClick={() => {
                              void handlePlaybackRequest('SESSION_PLAYBACK_STOP');
                            }}
                          >
                            Stop
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <main className="flex min-h-0 flex-1 flex-col" data-testid="sidepanel-chat-area">
        <div className="min-h-0 flex-1">
          <ChatContainer messages={activeMessages} />
        </div>
        <ActionLogPanel actions={activeActions} />
      </main>

      <footer
        className="border-t border-[rgb(var(--color-border-default))] bg-[rgb(var(--color-bg-primary))] px-4 py-3 sm:px-6"
        data-testid="sidepanel-input-section"
      >
        {submitError ? (
          <p className="mb-2 text-sm text-[rgb(var(--color-error-700))]" role="status">
            {submitError}
          </p>
        ) : null}
        <InputComposer
          disabled={activeStreamMessageId !== null || providerNotice?.blocksSend === true}
          onSend={(value, uploads) => handleSend(value, uploads)}
        />
      </footer>

      <WorkflowLibraryModal
        open={workflowModal === 'library'}
        workflows={workflowItems}
        isHydrating={workflowIsHydrating}
        viewMode={workflowViewMode}
        selectedWorkflowId={selectedWorkflowId}
        canSaveCurrentSession={canSaveWorkflow}
        canRunSelectedWorkflow={!workflowRunDisabled}
        isRunningSelectedWorkflow={
          selectedWorkflowId !== null && workflowRunningId === selectedWorkflowId
        }
        isDeletingSelectedWorkflow={
          selectedWorkflowId !== null && workflowDeletingId === selectedWorkflowId
        }
        error={workflowError}
        onClose={closeWorkflowModal}
        onOpenSaveWorkflow={handleOpenSaveWorkflow}
        onRunWorkflow={(workflowId) => {
          void handleRunWorkflow(workflowId);
        }}
        onEditWorkflow={openEditWorkflowModal}
        onDeleteWorkflow={(workflowId) => {
          void handleDeleteWorkflow(workflowId);
        }}
        onSelectWorkflow={selectWorkflow}
        onViewModeChange={setWorkflowViewMode}
      />

      <SaveWorkflowModal
        open={workflowModal === 'save'}
        mode={workflowSaveMode}
        draft={workflowSaveDraft}
        actionCount={saveModalActionCount}
        sourceSessionName={saveModalSourceSessionName}
        isSaving={workflowIsSaving}
        error={workflowError}
        onClose={closeWorkflowModal}
        onDraftChange={updateWorkflowSaveDraft}
        onSave={() => {
          void handleSaveWorkflow();
        }}
      />
    </div>
  );
}
