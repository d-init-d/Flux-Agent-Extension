import type {
  ActionRecord,
  AIMessage,
  PageContext,
  RecordedSessionAction,
  Session,
  SessionConfig,
  SessionEvent,
} from '@shared/types';
import { ErrorCode, ExtensionError } from '@shared/errors';
import { ContextBuilder, DEFAULT_CONTEXT_BUILDER_OPTIONS } from './context-builder';
import type { ContextBuilderOptions, ISessionManager } from './interfaces';

type SessionEventHandler = (event: SessionEvent) => void;

export class SessionManager implements ISessionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly subscriptions = new Map<string, Set<SessionEventHandler>>();
  private readonly pageContexts = new Map<string, PageContext>();
  private readonly contextBuilder = new ContextBuilder();

  async createSession(config: SessionConfig, tabId: number): Promise<Session> {
    if (this.sessions.has(config.id)) {
      throw new ExtensionError(
        ErrorCode.SESSION_LIMIT_REACHED,
        `Session "${config.id}" already exists`,
        true,
      );
    }

    const now = Date.now();
    const session: Session = {
      config: { ...config },
      status: 'idle',
      targetTabId: tabId,
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
      startedAt: now,
      lastActivityAt: now,
      errorCount: 0,
    };

    this.sessions.set(config.id, session);
    return session;
  }

  getSession(sessionId: string): Session | null {
    return this.sessions.get(sessionId) ?? null;
  }

  getActiveSessions(): Session[] {
    return [...this.sessions.values()].filter((session) => session.status !== 'completed');
  }

  async start(sessionId: string, initialPrompt?: string): Promise<void> {
    const session = this.requireSession(sessionId);

    session.status = 'running';
    session.lastActivityAt = Date.now();
    this.emit(sessionId, { type: 'started', sessionId });

    if (typeof initialPrompt === 'string' && initialPrompt.trim().length > 0) {
      await this.sendMessage(sessionId, initialPrompt);
    }
  }

  pause(sessionId: string): void {
    const session = this.requireSession(sessionId);
    session.status = 'paused';
    session.lastActivityAt = Date.now();
    this.emit(sessionId, { type: 'paused', reason: 'paused by user' });
  }

  resume(sessionId: string): void {
    const session = this.requireSession(sessionId);
    session.status = 'running';
    session.lastActivityAt = Date.now();
    this.emit(sessionId, { type: 'resumed' });
  }

  abort(sessionId: string): void {
    this.requireSession(sessionId);
    this.emit(sessionId, { type: 'aborted', reason: 'aborted by user' });
    this.sessions.delete(sessionId);
    this.pageContexts.delete(sessionId);
    this.subscriptions.delete(sessionId);
  }

  async sendMessage(sessionId: string, message: string): Promise<void> {
    const session = this.requireSession(sessionId);
    const normalizedMessage = message.trim();

    if (normalizedMessage.length === 0) {
      throw new ExtensionError(ErrorCode.ACTION_INVALID, 'Cannot send an empty message', true);
    }

    const aiMessage: AIMessage = {
      role: 'user',
      content: normalizedMessage,
      timestamp: Date.now(),
    };

    session.messages.push(aiMessage);
    session.currentTurn += 1;
    session.lastActivityAt = Date.now();
  }

  async undo(sessionId: string, steps: number = 1): Promise<void> {
    const session = this.requireSession(sessionId);

    if (!Number.isInteger(steps) || steps <= 0) {
      throw new ExtensionError(
        ErrorCode.ACTION_INVALID,
        'Undo steps must be a positive integer',
        true,
      );
    }

    if (session.actionHistory.length === 0) {
      return;
    }

    session.actionHistory.splice(-steps);
    session.lastActivityAt = Date.now();
  }

  subscribe(sessionId: string, handler: SessionEventHandler): () => void {
    this.requireSession(sessionId);

    const handlers = this.subscriptions.get(sessionId) ?? new Set<SessionEventHandler>();
    handlers.add(handler);
    this.subscriptions.set(sessionId, handlers);

    return () => {
      const currentHandlers = this.subscriptions.get(sessionId);
      if (!currentHandlers) {
        return;
      }

      currentHandlers.delete(handler);

      if (currentHandlers.size === 0) {
        this.subscriptions.delete(sessionId);
      }
    };
  }

  async buildContext(sessionId: string): Promise<string> {
    const session = this.requireSession(sessionId);
    const pageContext = this.resolvePageContext(sessionId, session);

    return this.contextBuilder.buildContext(pageContext, session, DEFAULT_CONTEXT_BUILDER_OPTIONS);
  }

  getHistory(sessionId: string): ActionRecord[] {
    const session = this.requireSession(sessionId);
    return [...session.actionHistory];
  }

  setPageContext(sessionId: string, pageContext: PageContext): void {
    this.requireSession(sessionId);
    this.pageContexts.set(sessionId, pageContext);
  }

  pushActionRecord(sessionId: string, record: ActionRecord): void {
    const session = this.requireSession(sessionId);
    session.actionHistory.push(record);
    session.lastActivityAt = Date.now();
    this.emit(sessionId, { type: 'action_executed', action: record.action, result: record.result });
  }

  addAIResponse(sessionId: string, content: string): void {
    const session = this.requireSession(sessionId);
    const message: AIMessage = {
      role: 'assistant',
      content,
      timestamp: Date.now(),
    };

    session.messages.push(message);
    session.lastActivityAt = Date.now();
    this.emit(sessionId, { type: 'ai_response', content });
  }

  startRecording(sessionId: string): void {
    const session = this.requireSession(sessionId);
    const now = Date.now();
    session.recording.status = 'recording';
    session.recording.actions = [];
    session.recording.startedAt = now;
    session.recording.updatedAt = now;
    session.lastActivityAt = now;
  }

  pauseRecording(sessionId: string): void {
    const session = this.requireSession(sessionId);
    const now = Date.now();
    session.recording.status = 'paused';
    session.recording.updatedAt = now;
    session.lastActivityAt = now;
  }

  resumeRecording(sessionId: string): void {
    const session = this.requireSession(sessionId);
    const now = Date.now();
    session.recording.status = 'recording';
    session.recording.updatedAt = now;
    session.lastActivityAt = now;
  }

  stopRecording(sessionId: string): void {
    const session = this.requireSession(sessionId);
    session.recording.status = 'idle';
    session.recording.updatedAt = Date.now();
    session.lastActivityAt = session.recording.updatedAt;
  }

  appendRecordedAction(sessionId: string, action: RecordedSessionAction): void {
    const session = this.requireSession(sessionId);
    session.recording.actions.push(action);
    session.recording.updatedAt = action.timestamp;
    session.lastActivityAt = action.timestamp;
  }

  replaceRecordedActions(sessionId: string, actions: RecordedSessionAction[]): void {
    const session = this.requireSession(sessionId);
    const clonedActions = JSON.parse(JSON.stringify(actions)) as RecordedSessionAction[];
    const now = Date.now();
    const firstTimestamp = clonedActions[0]?.timestamp ?? null;
    const lastTimestamp = clonedActions.at(-1)?.timestamp ?? null;

    session.recording.status = 'idle';
    session.recording.actions = clonedActions;
    session.recording.startedAt = firstTimestamp;
    session.recording.updatedAt = lastTimestamp ?? now;
    session.lastActivityAt = now;
  }

  startPlayback(sessionId: string, speed: 0.5 | 1 | 2 = 1): void {
    const session = this.requireSession(sessionId);
    const now = Date.now();
    session.playback.status = 'playing';
    session.playback.nextActionIndex = 0;
    session.playback.speed = speed;
    session.playback.startedAt = now;
    session.playback.updatedAt = now;
    session.playback.lastCompletedAt = null;
    session.playback.lastError = null;
    session.lastActivityAt = now;
  }

  pausePlayback(sessionId: string): void {
    const session = this.requireSession(sessionId);
    const now = Date.now();
    session.playback.status = 'paused';
    session.playback.updatedAt = now;
    session.lastActivityAt = now;
  }

  resumePlayback(sessionId: string, speed?: 0.5 | 1 | 2): void {
    const session = this.requireSession(sessionId);
    const now = Date.now();
    session.playback.status = 'playing';
    session.playback.speed = speed ?? session.playback.speed;
    session.playback.startedAt ??= now;
    session.playback.updatedAt = now;
    session.playback.lastError = null;
    session.lastActivityAt = now;
  }

  stopPlayback(sessionId: string): void {
    const session = this.requireSession(sessionId);
    const now = Date.now();
    session.playback.status = 'idle';
    session.playback.nextActionIndex = 0;
    session.playback.startedAt = null;
    session.playback.updatedAt = now;
    session.playback.lastCompletedAt = null;
    session.playback.lastError = null;
    session.lastActivityAt = now;
  }

  completePlayback(sessionId: string): void {
    const session = this.requireSession(sessionId);
    const now = Date.now();
    session.playback.status = 'idle';
    session.playback.updatedAt = now;
    session.playback.lastCompletedAt = now;
    session.playback.lastError = null;
    session.lastActivityAt = now;
  }

  setPlaybackSpeed(sessionId: string, speed: 0.5 | 1 | 2): void {
    const session = this.requireSession(sessionId);
    const now = Date.now();
    session.playback.speed = speed;
    session.playback.updatedAt = now;
    session.lastActivityAt = now;
  }

  setPlaybackNextActionIndex(sessionId: string, nextActionIndex: number): void {
    const session = this.requireSession(sessionId);
    const now = Date.now();
    session.playback.nextActionIndex = nextActionIndex;
    session.playback.updatedAt = now;
    session.lastActivityAt = now;
  }

  setPlaybackError(
    sessionId: string,
    error: {
      message: string;
      actionId?: string;
      actionType?: RecordedSessionAction['action']['type'];
      timestamp?: number;
    },
  ): void {
    const session = this.requireSession(sessionId);
    const timestamp = error.timestamp ?? Date.now();
    session.playback.lastError = {
      message: error.message,
      actionId: error.actionId,
      actionType: error.actionType,
      timestamp,
    };
    session.playback.updatedAt = timestamp;
    session.lastActivityAt = timestamp;
  }

  clearPlaybackError(sessionId: string): void {
    const session = this.requireSession(sessionId);
    const now = Date.now();
    session.playback.lastError = null;
    session.playback.updatedAt = now;
    session.lastActivityAt = now;
  }

  markPlaybackActionCompleted(
    sessionId: string,
    nextActionIndex: number,
    timestamp: number = Date.now(),
  ): void {
    const session = this.requireSession(sessionId);
    session.playback.nextActionIndex = nextActionIndex;
    session.playback.updatedAt = timestamp;
    session.playback.lastCompletedAt = timestamp;
    session.lastActivityAt = timestamp;
  }

  private emit(sessionId: string, event: SessionEvent): void {
    const handlers = this.subscriptions.get(sessionId);
    if (!handlers) {
      return;
    }

    for (const handler of handlers) {
      handler(event);
    }
  }

  private requireSession(sessionId: string): Session {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new ExtensionError(
        ErrorCode.SESSION_NOT_FOUND,
        `Session "${sessionId}" was not found`,
        true,
      );
    }

    return session;
  }

  private resolvePageContext(sessionId: string, session: Session): PageContext {
    const storedContext = this.pageContexts.get(sessionId);
    if (storedContext) {
      return storedContext;
    }

    const variableContext = session.variables.pageContext;
    if (this.isPageContext(variableContext)) {
      return variableContext;
    }

    return {
      url: 'about:blank',
      title: 'Unknown page',
      summary: 'No page context available yet.',
      frame: {
        frameId: 0,
        parentFrameId: null,
        url: 'about:blank',
        origin: 'null',
        isTop: true,
      },
      interactiveElements: [],
      headings: [],
      links: [],
      forms: [],
      viewport: {
        width: 0,
        height: 0,
        scrollX: 0,
        scrollY: 0,
        scrollHeight: 0,
      },
    };
  }

  private isPageContext(value: unknown): value is PageContext {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const candidate = value as Partial<PageContext>;
    return (
      typeof candidate.url === 'string' &&
      typeof candidate.title === 'string' &&
      Array.isArray(candidate.interactiveElements) &&
      Array.isArray(candidate.headings) &&
      Array.isArray(candidate.links) &&
      Array.isArray(candidate.forms) &&
      typeof candidate.viewport === 'object' &&
      candidate.viewport !== null
    );
  }
}
