import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Session } from '@shared/types';
import { useChatStore, resetChatStore } from '../chatStore';

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
    lastActivityAt: Date.now(),
    errorCount: 0,
    ...overrides,
  };
}

describe('chatStore', () => {
  beforeEach(() => {
    sendExtensionRequest.mockReset();
    resetChatStore();
  });

  afterEach(() => {
    resetChatStore();
  });

  describe('initial state', () => {
    it('should have empty messages and streams', () => {
      const state = useChatStore.getState();
      expect(state.messagesBySession).toEqual({});
      expect(state.streamMessageIdsBySession).toEqual({});
    });
  });

  describe('syncSession', () => {
    it('should map user messages from session', () => {
      const session = createSession('s1', {
        messages: [{ role: 'user', content: 'Hello', timestamp: 1700000000000 }],
      });

      useChatStore.getState().syncSession(session);

      const msgs = useChatStore.getState().messagesBySession['s1'];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].variant).toBe('user');
      expect(msgs[0]).toHaveProperty('text', 'Hello');
    });

    it('should map assistant messages from session', () => {
      const session = createSession('s1', {
        messages: [{ role: 'assistant', content: '**Bold**', timestamp: 1700000000000 }],
      });

      useChatStore.getState().syncSession(session);

      const msgs = useChatStore.getState().messagesBySession['s1'];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].variant).toBe('assistant');
      expect(msgs[0]).toHaveProperty('markdown', '**Bold**');
    });

    it('should filter out system messages', () => {
      const session = createSession('s1', {
        messages: [
          { role: 'system', content: 'system prompt' },
          { role: 'user', content: 'hi' },
        ],
      });

      useChatStore.getState().syncSession(session);

      const msgs = useChatStore.getState().messagesBySession['s1'];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].variant).toBe('user');
    });

    it('should reset stream message id for the session', () => {
      useChatStore.setState({
        streamMessageIdsBySession: { s1: 'msg-1' },
      });

      const session = createSession('s1');
      useChatStore.getState().syncSession(session);

      expect(useChatStore.getState().streamMessageIdsBySession['s1']).toBeNull();
    });

    it('should handle non-string content gracefully', () => {
      const session = createSession('s1', {
        messages: [
          {
            role: 'user',
            content: ['array content'] as unknown as string,
            timestamp: 1700000000000,
          },
          {
            role: 'assistant',
            content: { obj: true } as unknown as string,
            timestamp: 1700000000000,
          },
        ],
      });

      useChatStore.getState().syncSession(session);

      const msgs = useChatStore.getState().messagesBySession['s1'];
      expect(msgs).toHaveLength(2);
      expect(msgs[0]).toHaveProperty('text', '');
      expect(msgs[1]).toHaveProperty('markdown', '');
    });

    it('should use Date.now() when timestamp is undefined', () => {
      const session = createSession('s1', {
        messages: [{ role: 'user', content: 'no ts' }],
      });

      useChatStore.getState().syncSession(session);

      const msgs = useChatStore.getState().messagesBySession['s1'];
      expect(msgs[0].timestamp).toBeTruthy();
    });
  });

  describe('applyStreamChunk', () => {
    it('should create a new assistant message for unknown messageId', () => {
      useChatStore.setState({
        messagesBySession: { s1: [] },
        streamMessageIdsBySession: { s1: null },
      });

      useChatStore.getState().applyStreamChunk({
        sessionId: 's1',
        messageId: 'msg-1',
        delta: 'Hello',
        done: false,
      });

      const msgs = useChatStore.getState().messagesBySession['s1'];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].id).toBe('msg-1');
      expect(msgs[0].variant).toBe('assistant');
      expect(msgs[0]).toHaveProperty('markdown', 'Hello');
      expect(msgs[0]).toHaveProperty('isStreaming', true);

      expect(useChatStore.getState().streamMessageIdsBySession['s1']).toBe('msg-1');
    });

    it('should append delta to existing assistant message', () => {
      useChatStore.setState({
        messagesBySession: {
          s1: [
            {
              id: 'msg-1',
              variant: 'assistant' as const,
              timestamp: new Date().toISOString(),
              markdown: 'Hello',
              isStreaming: true,
            },
          ],
        },
        streamMessageIdsBySession: { s1: 'msg-1' },
      });

      useChatStore.getState().applyStreamChunk({
        sessionId: 's1',
        messageId: 'msg-1',
        delta: ' World',
        done: false,
      });

      const msgs = useChatStore.getState().messagesBySession['s1'];
      expect(msgs[0]).toHaveProperty('markdown', 'Hello World');
      expect(msgs[0]).toHaveProperty('isStreaming', true);
    });

    it('should set isStreaming to false when done', () => {
      useChatStore.setState({
        messagesBySession: {
          s1: [
            {
              id: 'msg-1',
              variant: 'assistant' as const,
              timestamp: new Date().toISOString(),
              markdown: 'Hello',
              isStreaming: true,
            },
          ],
        },
        streamMessageIdsBySession: { s1: 'msg-1' },
      });

      useChatStore.getState().applyStreamChunk({
        sessionId: 's1',
        messageId: 'msg-1',
        delta: '!',
        done: true,
      });

      const msgs = useChatStore.getState().messagesBySession['s1'];
      expect(msgs[0]).toHaveProperty('isStreaming', false);
      expect(useChatStore.getState().streamMessageIdsBySession['s1']).toBeNull();
    });

    it('should handle error in stream chunk with existing message', () => {
      useChatStore.setState({
        messagesBySession: {
          s1: [
            {
              id: 'msg-1',
              variant: 'assistant' as const,
              timestamp: new Date().toISOString(),
              markdown: 'Partial',
              isStreaming: true,
            },
          ],
        },
        streamMessageIdsBySession: { s1: 'msg-1' },
      });

      useChatStore.getState().applyStreamChunk({
        sessionId: 's1',
        messageId: 'msg-1',
        delta: '',
        done: true,
        error: 'Stream interrupted',
      });

      const msgs = useChatStore.getState().messagesBySession['s1'];
      expect(msgs[0]).toHaveProperty('isStreaming', false);
      expect(msgs[1].variant).toBe('error');
      expect(msgs[1]).toHaveProperty('description', 'Stream interrupted');
    });

    it('should handle error without existing message', () => {
      useChatStore.setState({
        messagesBySession: { s1: [] },
        streamMessageIdsBySession: { s1: null },
      });

      useChatStore.getState().applyStreamChunk({
        sessionId: 's1',
        messageId: 'msg-1',
        delta: '',
        done: true,
        error: 'Failed to start',
      });

      const msgs = useChatStore.getState().messagesBySession['s1'];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].variant).toBe('error');
      expect(msgs[0]).toHaveProperty('description', 'Failed to start');
    });

    it('should initialize messages array for unknown session', () => {
      useChatStore.getState().applyStreamChunk({
        sessionId: 'new-session',
        messageId: 'msg-1',
        delta: 'Hi',
        done: false,
      });

      const msgs = useChatStore.getState().messagesBySession['new-session'];
      expect(msgs).toHaveLength(1);
    });

    it('should not update non-assistant existing message on append', () => {
      useChatStore.setState({
        messagesBySession: {
          s1: [
            {
              id: 'msg-1',
              variant: 'user' as const,
              timestamp: new Date().toISOString(),
              text: 'User msg',
            },
          ],
        },
        streamMessageIdsBySession: { s1: null },
      });

      useChatStore.getState().applyStreamChunk({
        sessionId: 's1',
        messageId: 'msg-1',
        delta: 'append',
        done: false,
      });

      const msgs = useChatStore.getState().messagesBySession['s1'];
      expect(msgs[0]).toHaveProperty('text', 'User msg');
    });

    it('should not update non-assistant message on error', () => {
      useChatStore.setState({
        messagesBySession: {
          s1: [
            {
              id: 'msg-1',
              variant: 'user' as const,
              timestamp: new Date().toISOString(),
              text: 'User msg',
            },
          ],
        },
        streamMessageIdsBySession: { s1: null },
      });

      useChatStore.getState().applyStreamChunk({
        sessionId: 's1',
        messageId: 'msg-1',
        delta: '',
        done: true,
        error: 'fail',
      });

      const msgs = useChatStore.getState().messagesBySession['s1'];
      expect(msgs[0].variant).toBe('user');
      expect(msgs[1].variant).toBe('error');
    });
  });

  describe('appendError', () => {
    it('should append an error message to the session', () => {
      useChatStore.setState({
        messagesBySession: { s1: [] },
      });

      useChatStore.getState().appendError('s1', 'Something failed');

      const msgs = useChatStore.getState().messagesBySession['s1'];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].variant).toBe('error');
      expect(msgs[0]).toHaveProperty('description', 'Something failed');
      expect(msgs[0]).toHaveProperty('title', 'Request failed');
    });

    it('should append to existing messages', () => {
      useChatStore.setState({
        messagesBySession: {
          s1: [
            {
              id: 'user-0',
              variant: 'user' as const,
              timestamp: new Date().toISOString(),
              text: 'Hello',
            },
          ],
        },
      });

      useChatStore.getState().appendError('s1', 'Error occurred');

      const msgs = useChatStore.getState().messagesBySession['s1'];
      expect(msgs).toHaveLength(2);
    });

    it('should initialize messages array for unknown session', () => {
      useChatStore.getState().appendError('new-session', 'Error');

      const msgs = useChatStore.getState().messagesBySession['new-session'];
      expect(msgs).toHaveLength(1);
    });
  });

  describe('sendMessage', () => {
    it('should delegate to sendExtensionRequest', async () => {
      sendExtensionRequest.mockResolvedValueOnce(undefined);

      await useChatStore.getState().sendMessage('s1', 'Hello');

      expect(sendExtensionRequest).toHaveBeenCalledWith('SESSION_SEND_MESSAGE', {
        sessionId: 's1',
        message: 'Hello',
        uploads: undefined,
      });
    });

    it('should pass uploads when provided', async () => {
      sendExtensionRequest.mockResolvedValueOnce(undefined);
      const uploads = [
        {
          name: 'file.txt',
          mimeType: 'text/plain',
          size: 5,
          lastModified: 0,
          base64Data: 'aGVsbG8=',
        },
      ];

      await useChatStore.getState().sendMessage('s1', 'With file', uploads);

      expect(sendExtensionRequest).toHaveBeenCalledWith('SESSION_SEND_MESSAGE', {
        sessionId: 's1',
        message: 'With file',
        uploads,
      });
    });
  });

  describe('applyStreamChunk — additional branch coverage', () => {
    it('should create new message with done=true (not streaming)', () => {
      useChatStore.setState({
        messagesBySession: { s1: [] },
        streamMessageIdsBySession: { s1: null },
      });

      useChatStore.getState().applyStreamChunk({
        sessionId: 's1',
        messageId: 'msg-1',
        delta: 'Complete',
        done: true,
      });

      const msgs = useChatStore.getState().messagesBySession['s1'];
      expect(msgs).toHaveLength(1);
      expect(msgs[0]).toHaveProperty('isStreaming', false);
      expect(useChatStore.getState().streamMessageIdsBySession['s1']).toBeNull();
    });

    it('should handle error with existing non-assistant message (no isStreaming update)', () => {
      useChatStore.setState({
        messagesBySession: {
          s1: [
            {
              id: 'msg-1',
              variant: 'error' as const,
              timestamp: new Date().toISOString(),
              title: 'Previous error',
              description: 'old',
              errorCode: 'OLD',
              actions: [],
            },
          ],
        },
        streamMessageIdsBySession: { s1: null },
      });

      useChatStore.getState().applyStreamChunk({
        sessionId: 's1',
        messageId: 'msg-1',
        delta: '',
        done: true,
        error: 'new error',
      });

      const msgs = useChatStore.getState().messagesBySession['s1'];
      expect(msgs[0].variant).toBe('error');
      expect(msgs[0]).toHaveProperty('title', 'Previous error');
      expect(msgs[1].variant).toBe('error');
      expect(msgs[1]).toHaveProperty('description', 'new error');
    });

    it('should set streamMessageIdsBySession to messageId when not done', () => {
      useChatStore.getState().applyStreamChunk({
        sessionId: 'new-s',
        messageId: 'msg-x',
        delta: 'chunk',
        done: false,
      });

      expect(useChatStore.getState().streamMessageIdsBySession['new-s']).toBe('msg-x');
    });

    it('should set streamMessageIdsBySession to null on error', () => {
      useChatStore.setState({
        messagesBySession: { s1: [] },
        streamMessageIdsBySession: { s1: 'msg-1' },
      });

      useChatStore.getState().applyStreamChunk({
        sessionId: 's1',
        messageId: 'msg-1',
        delta: '',
        done: true,
        error: 'fail',
      });

      expect(useChatStore.getState().streamMessageIdsBySession['s1']).toBeNull();
    });
  });

  describe('syncSession — additional branch coverage', () => {
    it('should handle multiple messages of mixed roles', () => {
      const session = createSession('s1', {
        messages: [
          { role: 'system', content: 'system prompt' },
          { role: 'user', content: 'Hello', timestamp: 1700000000000 },
          { role: 'assistant', content: 'Hi!', timestamp: 1700000001000 },
          { role: 'user', content: 'How?', timestamp: 1700000002000 },
          { role: 'tool', content: 'tool result' } as unknown as Session['messages'][0],
        ],
      });

      useChatStore.getState().syncSession(session);

      const msgs = useChatStore.getState().messagesBySession['s1'];
      expect(msgs).toHaveLength(3);
      expect(msgs[0].variant).toBe('user');
      expect(msgs[1].variant).toBe('assistant');
      expect(msgs[2].variant).toBe('user');
    });

    it('should overwrite previous session messages on re-sync', () => {
      const session1 = createSession('s1', {
        messages: [{ role: 'user', content: 'first', timestamp: 1700000000000 }],
      });
      useChatStore.getState().syncSession(session1);

      const session2 = createSession('s1', {
        messages: [
          { role: 'user', content: 'first', timestamp: 1700000000000 },
          { role: 'assistant', content: 'reply', timestamp: 1700000001000 },
        ],
      });
      useChatStore.getState().syncSession(session2);

      const msgs = useChatStore.getState().messagesBySession['s1'];
      expect(msgs).toHaveLength(2);
    });
  });

  describe('resetChatStore', () => {
    it('should reset all state', () => {
      useChatStore.setState({
        messagesBySession: { s1: [] },
        streamMessageIdsBySession: { s1: 'msg-1' },
      });

      resetChatStore();

      const state = useChatStore.getState();
      expect(state.messagesBySession).toEqual({});
      expect(state.streamMessageIdsBySession).toEqual({});
    });
  });
});
