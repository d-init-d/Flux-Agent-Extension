import { useEffect, useMemo, useState } from 'react';
import { ActionLogPanel } from './components/ActionLogPanel';
import { ChatContainer } from './components/ChatContainer';
import { InputComposer } from './components/InputComposer';
import { useActionLog } from './hooks/useActionLog';
import { useChat } from './hooks/useChat';
import { useEscapeToStopShortcut } from './keyboard-shortcuts';
import { useSession } from './hooks/useSession';
import { subscribeToExtensionEvents } from './lib/extension-client';
import { Button } from '@/ui/components';
import { ThemeToggle } from '@/ui/theme';
import type {
  AIStreamEventPayload,
  ActionProgressEventPayload,
  SessionUpdateEventPayload,
} from '@shared/types';

export function App() {
  useEscapeToStopShortcut();
  const [initialSessionCount, setInitialSessionCount] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

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

  const handleSend = async (value: string) => {
    setSubmitError(null);
    let sessionId = activeSessionId;

    try {
      if (!sessionId) {
        const createdSession = await createSession();
        syncSession(createdSession);
        sessionId = createdSession.config.id;
      }

      await sendMessage(sessionId, value);
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
          onSend={(value) => void handleSend(value)}
        />
      </footer>
    </div>
  );
}
