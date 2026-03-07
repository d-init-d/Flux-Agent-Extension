import { create } from 'zustand';
import type { Session } from '@shared/types';
import { sendExtensionRequest } from '../lib/extension-client';

const DEFAULT_SESSION_CONFIG = {
  provider: 'openai' as const,
  model: 'gpt-4o-mini',
};

interface SessionStoreState {
  sessions: Session[];
  activeSessionId: string | null;
  isHydrating: boolean;
  error: string | null;
  hydrate: () => Promise<Session[]>;
  createSession: () => Promise<Session>;
  switchSession: (sessionId: string) => void;
  applySessionUpdate: (
    sessionId: string,
    session: Session | null,
    reason: 'created' | 'updated' | 'deleted',
  ) => void;
}

function sortSessions(sessions: Session[]): Session[] {
  return [...sessions].sort((left, right) => right.lastActivityAt - left.lastActivityAt);
}

export const useSessionStore = create<SessionStoreState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  isHydrating: false,
  error: null,
  hydrate: async () => {
    set({ isHydrating: true, error: null });

    try {
      const response = await sendExtensionRequest('SESSION_LIST', undefined);
      const sessions = sortSessions(response.sessions);
      set((state) => ({
        sessions,
        activeSessionId: state.activeSessionId ?? sessions[0]?.config.id ?? null,
        isHydrating: false,
      }));
      return sessions;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to hydrate sessions';
      set({ error: message, isHydrating: false });
      throw error;
    }
  },
  createSession: async () => {
    const response = await sendExtensionRequest('SESSION_CREATE', {
      config: DEFAULT_SESSION_CONFIG,
    });
    const nextSession = response.session;

    set((state) => ({
      sessions: sortSessions([nextSession, ...state.sessions.filter((session) => session.config.id !== nextSession.config.id)]),
      activeSessionId: nextSession.config.id,
      error: null,
    }));

    return nextSession;
  },
  switchSession: (sessionId) => {
    if (!get().sessions.some((session) => session.config.id === sessionId)) {
      return;
    }

    set({ activeSessionId: sessionId });
  },
  applySessionUpdate: (sessionId, session, reason) => {
    set((state) => {
      if (reason === 'deleted' || session === null) {
        const sessions = state.sessions.filter((item) => item.config.id !== sessionId);
        const nextActiveSessionId =
          sessionId === state.activeSessionId
            ? sessions[0]?.config.id ?? null
            : state.activeSessionId;

        return {
          sessions,
          activeSessionId: nextActiveSessionId,
        };
      }

      const sessions = sortSessions([
        session,
        ...state.sessions.filter((item) => item.config.id !== session.config.id),
      ]);

      return {
        sessions,
        activeSessionId: state.activeSessionId ?? session.config.id,
      };
    });
  },
}));

export function resetSessionStore(): void {
  useSessionStore.setState({
    sessions: [],
    activeSessionId: null,
    isHydrating: false,
    error: null,
  });
}
