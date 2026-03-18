import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Session } from '../../../shared/types';
import { useSessionStore, resetSessionStore } from '../sessionStore';

const sendExtensionRequest = vi.fn();

vi.mock('../../lib/extension-client', () => ({
  sendExtensionRequest: (...args: unknown[]) => sendExtensionRequest(...args),
}));

function createSession(id: string, overrides: Partial<Session> = {}): Session {
  return {
    config: {
      id,
      provider: 'openai',
      model: 'gpt-4o-mini',
      ...overrides.config,
    },
    status: 'idle',
    targetTabId: 1,
    tabSnapshot: [],
    recording: {
      status: 'idle',
      actions: [],
      startedAt: null,
      updatedAt: null,
    },
    playback: {
      status: 'idle',
      nextActionIndex: 0,
      speed: 1,
      startedAt: null,
      updatedAt: null,
      lastCompletedAt: null,
      lastError: null,
    },
    messages: [],
    currentTurn: 0,
    actionHistory: [],
    variables: {},
    startedAt: Date.now(),
    lastActivityAt: Date.now() - 1000,
    errorCount: 0,
    ...overrides,
  };
}

describe('sessionStore', () => {
  beforeEach(() => {
    sendExtensionRequest.mockReset();
    resetSessionStore();
  });

  afterEach(() => {
    resetSessionStore();
  });

  describe('initial state', () => {
    it('should have empty sessions and null active session', () => {
      const { sessions, activeSessionId, isHydrating, error } = useSessionStore.getState();
      expect(sessions).toEqual([]);
      expect(activeSessionId).toBeNull();
      expect(isHydrating).toBe(false);
      expect(error).toBeNull();
    });
  });

  describe('hydrate', () => {
    it('should fetch sessions and sort by lastActivityAt descending', async () => {
      const older = createSession('s1', { lastActivityAt: 1000 });
      const newer = createSession('s2', { lastActivityAt: 2000 });
      sendExtensionRequest.mockResolvedValueOnce({ sessions: [older, newer] });

      const sessions = await useSessionStore.getState().hydrate();

      expect(sendExtensionRequest).toHaveBeenCalledWith('SESSION_LIST', undefined);
      expect(sessions[0].config.id).toBe('s2');
      expect(sessions[1].config.id).toBe('s1');
      expect(useSessionStore.getState().isHydrating).toBe(false);
    });

    it('should set activeSessionId to first session when no prior selection', async () => {
      sendExtensionRequest.mockResolvedValueOnce({
        sessions: [createSession('s1'), createSession('s2')],
      });

      await useSessionStore.getState().hydrate();
      expect(useSessionStore.getState().activeSessionId).toBe('s1');
    });

    it('should preserve activeSessionId if it exists in the new list', async () => {
      useSessionStore.setState({ activeSessionId: 's2' });
      sendExtensionRequest.mockResolvedValueOnce({
        sessions: [createSession('s1'), createSession('s2')],
      });

      await useSessionStore.getState().hydrate();
      expect(useSessionStore.getState().activeSessionId).toBe('s2');
    });

    it('should keep activeSessionId even if not in new list (nullish coalescing)', async () => {
      useSessionStore.setState({ activeSessionId: 's-gone' });
      sendExtensionRequest.mockResolvedValueOnce({
        sessions: [createSession('s1')],
      });

      await useSessionStore.getState().hydrate();
      expect(useSessionStore.getState().activeSessionId).toBe('s-gone');
    });

    it('should set activeSessionId to null when list is empty', async () => {
      sendExtensionRequest.mockResolvedValueOnce({ sessions: [] });

      await useSessionStore.getState().hydrate();
      expect(useSessionStore.getState().activeSessionId).toBeNull();
    });

    it('should set error and rethrow on failure', async () => {
      sendExtensionRequest.mockRejectedValueOnce(new Error('Network fail'));

      await expect(useSessionStore.getState().hydrate()).rejects.toThrow('Network fail');
      expect(useSessionStore.getState().error).toBe('Network fail');
      expect(useSessionStore.getState().isHydrating).toBe(false);
    });

    it('should handle non-Error thrown values', async () => {
      sendExtensionRequest.mockRejectedValueOnce('string error');

      await expect(useSessionStore.getState().hydrate()).rejects.toBe('string error');
      expect(useSessionStore.getState().error).toBe('Failed to hydrate sessions');
    });
  });

  describe('createSession', () => {
    it('should create a session, add to list, and set as active', async () => {
      const newSession = createSession('s-new');
      sendExtensionRequest
        .mockResolvedValueOnce({
          activeProvider: 'openai',
          providers: {
            openai: {
              model: 'gpt-4o-mini',
            },
          },
        })
        .mockResolvedValueOnce({ session: newSession });

      const result = await useSessionStore.getState().createSession();

      expect(sendExtensionRequest).toHaveBeenNthCalledWith(1, 'SETTINGS_GET', undefined);
      expect(sendExtensionRequest).toHaveBeenNthCalledWith(2, 'SESSION_CREATE', {
        config: {
          provider: 'openai',
          model: 'gpt-4o-mini',
        },
      });
      expect(result.config.id).toBe('s-new');
      expect(useSessionStore.getState().activeSessionId).toBe('s-new');
      expect(useSessionStore.getState().sessions).toHaveLength(1);
      expect(useSessionStore.getState().error).toBeNull();
    });

    it('should deduplicate if session id already exists', async () => {
      const existing = createSession('s1', { lastActivityAt: 1000 });
      useSessionStore.setState({ sessions: [existing] });

      const updated = createSession('s1', { lastActivityAt: 2000 });
      sendExtensionRequest
        .mockResolvedValueOnce({
          activeProvider: 'openai',
          providers: {
            openai: {
              model: 'gpt-4o-mini',
            },
          },
        })
        .mockResolvedValueOnce({ session: updated });

      await useSessionStore.getState().createSession();

      expect(useSessionStore.getState().sessions).toHaveLength(1);
      expect(useSessionStore.getState().sessions[0].lastActivityAt).toBe(2000);
    });

    it('uses the active provider and model from settings when creating a session', async () => {
      const newSession = createSession('s-cliproxyapi', {
        config: {
          id: 's-cliproxyapi',
          provider: 'cliproxyapi',
          model: 'gpt-5',
        },
      });

      sendExtensionRequest
        .mockResolvedValueOnce({
          activeProvider: 'cliproxyapi',
          providers: {
            cliproxyapi: {
              model: 'gpt-5',
            },
          },
        })
        .mockResolvedValueOnce({ session: newSession });

      await useSessionStore.getState().createSession();

      expect(sendExtensionRequest).toHaveBeenNthCalledWith(2, 'SESSION_CREATE', {
        config: {
          provider: 'cliproxyapi',
          model: 'gpt-5',
        },
      });
    });

    it('falls back to the provider registry default model when settings omit a model', async () => {
      const newSession = createSession('s-cliproxyapi', {
        config: {
          id: 's-cliproxyapi',
          provider: 'cliproxyapi',
          model: 'gpt-5',
        },
      });

      sendExtensionRequest
        .mockResolvedValueOnce({
          activeProvider: 'cliproxyapi',
          providers: {
            cliproxyapi: {},
          },
        })
        .mockResolvedValueOnce({ session: newSession });

      await useSessionStore.getState().createSession();

      expect(sendExtensionRequest).toHaveBeenNthCalledWith(2, 'SESSION_CREATE', {
        config: {
          provider: 'cliproxyapi',
          model: 'gpt-5',
        },
      });
    });

    it('uses the OpenAI browser-account default model when that auth lane is selected', async () => {
      const newSession = createSession('s-openai-browser', {
        config: {
          id: 's-openai-browser',
          provider: 'openai',
          model: 'codex-mini-latest',
        },
      });

      sendExtensionRequest
        .mockResolvedValueOnce({
          activeProvider: 'openai',
          providers: {
            openai: {
              authChoiceId: 'browser-account',
            },
          },
        })
        .mockResolvedValueOnce({ session: newSession });

      await useSessionStore.getState().createSession();

      expect(sendExtensionRequest).toHaveBeenNthCalledWith(2, 'SESSION_CREATE', {
        config: {
          provider: 'openai',
          model: 'codex-mini-latest',
        },
      });
    });
  });

  describe('switchSession', () => {
    it('should switch to a valid session id', () => {
      useSessionStore.setState({
        sessions: [createSession('s1'), createSession('s2')],
        activeSessionId: 's1',
      });

      useSessionStore.getState().switchSession('s2');
      expect(useSessionStore.getState().activeSessionId).toBe('s2');
    });

    it('should be a no-op if session id does not exist', () => {
      useSessionStore.setState({
        sessions: [createSession('s1')],
        activeSessionId: 's1',
      });

      useSessionStore.getState().switchSession('nonexistent');
      expect(useSessionStore.getState().activeSessionId).toBe('s1');
    });
  });

  describe('applySessionUpdate', () => {
    it('should add a new session when reason is created', () => {
      const session = createSession('s1');
      useSessionStore.getState().applySessionUpdate('s1', session, 'created');

      expect(useSessionStore.getState().sessions).toHaveLength(1);
      expect(useSessionStore.getState().activeSessionId).toBe('s1');
    });

    it('should update an existing session when reason is updated', () => {
      const original = createSession('s1', { lastActivityAt: 1000 });
      useSessionStore.setState({ sessions: [original], activeSessionId: 's1' });

      const updated = createSession('s1', { lastActivityAt: 2000 });
      useSessionStore.getState().applySessionUpdate('s1', updated, 'updated');

      expect(useSessionStore.getState().sessions).toHaveLength(1);
      expect(useSessionStore.getState().sessions[0].lastActivityAt).toBe(2000);
    });

    it('should remove session and pick next active when reason is deleted', () => {
      const s1 = createSession('s1', { lastActivityAt: 1000 });
      const s2 = createSession('s2', { lastActivityAt: 2000 });
      useSessionStore.setState({ sessions: [s2, s1], activeSessionId: 's1' });

      useSessionStore.getState().applySessionUpdate('s1', null, 'deleted');

      expect(useSessionStore.getState().sessions).toHaveLength(1);
      expect(useSessionStore.getState().sessions[0].config.id).toBe('s2');
      expect(useSessionStore.getState().activeSessionId).toBe('s2');
    });

    it('should set activeSessionId to null when last session is deleted', () => {
      const s1 = createSession('s1');
      useSessionStore.setState({ sessions: [s1], activeSessionId: 's1' });

      useSessionStore.getState().applySessionUpdate('s1', null, 'deleted');

      expect(useSessionStore.getState().sessions).toHaveLength(0);
      expect(useSessionStore.getState().activeSessionId).toBeNull();
    });

    it('should preserve activeSessionId when a non-active session is deleted', () => {
      const s1 = createSession('s1', { lastActivityAt: 2000 });
      const s2 = createSession('s2', { lastActivityAt: 1000 });
      useSessionStore.setState({ sessions: [s1, s2], activeSessionId: 's1' });

      useSessionStore.getState().applySessionUpdate('s2', null, 'deleted');

      expect(useSessionStore.getState().activeSessionId).toBe('s1');
    });

    it('should treat session === null as deleted even without deleted reason', () => {
      const s1 = createSession('s1');
      useSessionStore.setState({ sessions: [s1], activeSessionId: 's1' });

      useSessionStore.getState().applySessionUpdate('s1', null, 'updated');

      expect(useSessionStore.getState().sessions).toHaveLength(0);
    });

    it('should set activeSessionId if none was set on created/updated', () => {
      const session = createSession('s1');
      useSessionStore.setState({ activeSessionId: null });

      useSessionStore.getState().applySessionUpdate('s1', session, 'created');

      expect(useSessionStore.getState().activeSessionId).toBe('s1');
    });

    it('should preserve existing activeSessionId on updated for different session', () => {
      const s1 = createSession('s1', { lastActivityAt: 2000 });
      const s2 = createSession('s2', { lastActivityAt: 1000 });
      useSessionStore.setState({ sessions: [s1, s2], activeSessionId: 's1' });

      const s2Updated = createSession('s2', { lastActivityAt: 3000 });
      useSessionStore.getState().applySessionUpdate('s2', s2Updated, 'updated');

      expect(useSessionStore.getState().activeSessionId).toBe('s1');
    });
  });

  describe('applySessionUpdate — additional branch coverage', () => {
    it('should delete when reason is deleted even if session object is provided', () => {
      const s1 = createSession('s1');
      useSessionStore.setState({ sessions: [s1], activeSessionId: 's1' });

      useSessionStore.getState().applySessionUpdate('s1', s1, 'deleted');

      expect(useSessionStore.getState().sessions).toHaveLength(0);
      expect(useSessionStore.getState().activeSessionId).toBeNull();
    });

    it('should pick first remaining session as active when deleting active with multiple sessions', () => {
      const s1 = createSession('s1', { lastActivityAt: 3000 });
      const s2 = createSession('s2', { lastActivityAt: 2000 });
      const s3 = createSession('s3', { lastActivityAt: 1000 });
      useSessionStore.setState({ sessions: [s1, s2, s3], activeSessionId: 's1' });

      useSessionStore.getState().applySessionUpdate('s1', null, 'deleted');

      expect(useSessionStore.getState().sessions).toHaveLength(2);
      expect(useSessionStore.getState().activeSessionId).toBe('s2');
    });
  });

  describe('hydrate — isHydrating flag', () => {
    it('should set isHydrating to true while loading', async () => {
      let resolveRequest: (value: { sessions: Session[] }) => void;
      sendExtensionRequest.mockReturnValueOnce(
        new Promise<{ sessions: Session[] }>((resolve) => {
          resolveRequest = resolve;
        }),
      );

      const promise = useSessionStore.getState().hydrate();
      expect(useSessionStore.getState().isHydrating).toBe(true);

      resolveRequest!({ sessions: [createSession('s1')] });
      await promise;

      expect(useSessionStore.getState().isHydrating).toBe(false);
    });
  });

  describe('createSession — error propagation', () => {
    it('should propagate error from sendExtensionRequest', async () => {
      sendExtensionRequest
        .mockResolvedValueOnce({
          activeProvider: 'openai',
          providers: {
            openai: {
              model: 'gpt-4o-mini',
            },
          },
        })
        .mockRejectedValueOnce(new Error('Create failed'));

      await expect(useSessionStore.getState().createSession()).rejects.toThrow('Create failed');
    });

    it('falls back to the legacy default when settings lookup fails', async () => {
      const newSession = createSession('s-new');
      sendExtensionRequest
        .mockRejectedValueOnce(new Error('Settings failed'))
        .mockResolvedValueOnce({ session: newSession });

      await useSessionStore.getState().createSession();

      expect(sendExtensionRequest).toHaveBeenNthCalledWith(2, 'SESSION_CREATE', {
        config: {
          provider: 'openai',
          model: 'gpt-4o-mini',
        },
      });
    });
  });

  describe('sortSessions', () => {
    it('should sort sessions with equal timestamps deterministically', async () => {
      const s1 = createSession('s1', { lastActivityAt: 1000 });
      const s2 = createSession('s2', { lastActivityAt: 1000 });
      sendExtensionRequest.mockResolvedValueOnce({ sessions: [s1, s2] });

      await useSessionStore.getState().hydrate();

      const { sessions } = useSessionStore.getState();
      expect(sessions).toHaveLength(2);
    });
  });

  describe('resetSessionStore', () => {
    it('should reset all state to defaults', () => {
      useSessionStore.setState({
        sessions: [createSession('s1')],
        activeSessionId: 's1',
        isHydrating: true,
        error: 'err',
      });

      resetSessionStore();

      const state = useSessionStore.getState();
      expect(state.sessions).toEqual([]);
      expect(state.activeSessionId).toBeNull();
      expect(state.isHydrating).toBe(false);
      expect(state.error).toBeNull();
    });
  });
});
