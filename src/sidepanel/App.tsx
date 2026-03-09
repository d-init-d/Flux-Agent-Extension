import { useEffect, useMemo, useState } from 'react';
import { ActionLogPanel } from './components/ActionLogPanel';
import { ChatContainer } from './components/ChatContainer';
import { InputComposer } from './components/InputComposer';
import { useActionLog } from './hooks/useActionLog';
import { useChat } from './hooks/useChat';
import { useEscapeToStopShortcut } from './keyboard-shortcuts';
import { useSession } from './hooks/useSession';
import { sendExtensionRequest, subscribeToExtensionEvents } from './lib/extension-client';
import { Button } from '@/ui/components';
import { ThemeToggle } from '@/ui/theme';
import type {
  AIStreamEventPayload,
  ActionProgressEventPayload,
  SessionPlaybackSpeed,
  SerializedFileUpload,
  SessionUpdateEventPayload,
} from '@shared/types';

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
  const isCompleted = playbackStatus === 'idle' && nextActionIndex === actionCount && lastCompletedAt !== null;

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

export function App() {
  useEscapeToStopShortcut();
  const [initialSessionCount, setInitialSessionCount] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [recordingRequest, setRecordingRequest] = useState<RecordingRequestAction | null>(null);
  const [playbackRequest, setPlaybackRequest] = useState<PlaybackRequestAction | null>(null);
  const [playbackSpeedDraft, setPlaybackSpeedDraft] = useState<SessionPlaybackSpeed>(1);

  const { sessions, activeSessionId, isHydrating, hydrate, createSession, switchSession, applySessionUpdate } =
    useSession();
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
          applySessionUpdate(
            payload.sessionId,
            payload.session,
            payload.reason,
          );
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
  const activeMessages = activeSessionId ? messagesBySession[activeSessionId] ?? [] : [];
  const activeActions = activeSessionId ? entriesBySession[activeSessionId] ?? [] : [];
  const activeStreamMessageId = activeSessionId
    ? streamMessageIdsBySession[activeSessionId] ?? null
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
  const playbackButtonsDisabled = !activeSessionId || playbackRequest !== null;
  const playbackSpeedDisabled =
    !activeSessionId ||
    recordingStatus !== 'idle' ||
    playbackRequest !== null;

  useEffect(() => {
    setPlaybackSpeedDraft(playbackState.speed);
  }, [activeSessionId, playbackState.speed]);

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

  const handleSend = async (value: string, uploads?: SerializedFileUpload[]) => {
    setSubmitError(null);
    let sessionId = activeSessionId;

    try {
      if (!sessionId) {
        const createdSession = await createSession();
        syncSession(createdSession);
        sessionId = createdSession.config.id;
      }

      await sendMessage(sessionId, value, uploads);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed';
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
              variant="secondary"
              size="md"
              className="min-h-9 px-3"
              onClick={() => {
                setSubmitError(null);
                void createSession().catch((error) => {
                  setSubmitError(error instanceof Error ? error.message : 'Failed to create session');
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
                      <p className="mt-2 text-sm leading-relaxed text-[rgb(var(--color-error-700))]" role="status">
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
          disabled={activeStreamMessageId !== null}
          onSend={(value, uploads) => handleSend(value, uploads)}
        />
      </footer>
    </div>
  );
}
