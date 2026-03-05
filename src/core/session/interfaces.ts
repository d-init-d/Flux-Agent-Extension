import type {
  SessionConfig,
  Session,
  SessionEvent,
  ActionRecord,
} from '@shared/types';

/**
 * Session manager interface.
 * Manages AI conversation sessions and their lifecycle.
 */
export interface ISessionManager {
  /** Create a new session */
  createSession(config: SessionConfig, tabId: number): Promise<Session>;

  /** Get session by ID */
  getSession(sessionId: string): Session | null;

  /** Get all active sessions */
  getActiveSessions(): Session[];

  /** Start or resume a session */
  start(sessionId: string, initialPrompt?: string): Promise<void>;

  /** Pause a running session */
  pause(sessionId: string): void;

  /** Resume a paused session */
  resume(sessionId: string): void;

  /** Abort and cleanup a session */
  abort(sessionId: string): void;

  /** Send user message to session */
  sendMessage(sessionId: string, message: string): Promise<void>;

  /** Undo last action(s) */
  undo(sessionId: string, steps?: number): Promise<void>;

  /** Subscribe to session events */
  subscribe(
    sessionId: string,
    handler: (event: SessionEvent) => void,
  ): () => void;

  /** Build page context for AI */
  buildContext(sessionId: string): Promise<string>;

  /** Get action history */
  getHistory(sessionId: string): ActionRecord[];
}

/**
 * Context builder options — controls what data is included in the AI context.
 */
export interface ContextBuilderOptions {
  includeScreenshot: boolean;
  includeDOM: boolean;
  maxElements: number;
  includeNetwork: boolean;
}
