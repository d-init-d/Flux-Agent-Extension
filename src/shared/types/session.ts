import type { AIProviderType } from './ai';
import type { AIMessage } from './ai';
import type { Action } from './actions';
import type { ActionResult } from './browser';

/**
 * Session state
 */
export type SessionStatus = 'idle' | 'running' | 'paused' | 'error' | 'completed';

/**
 * Session configuration
 */
export interface SessionConfig {
  id: string;
  name?: string;
  provider: AIProviderType;
  model: string;
  systemPrompt?: string;
  maxTurns?: number; // Max conversation turns
  timeout?: number; // Session timeout
}

/**
 * Session state
 */
export interface Session {
  config: SessionConfig;
  status: SessionStatus;
  targetTabId: number | null;

  // Conversation
  messages: AIMessage[];
  currentTurn: number;

  // Execution
  actionHistory: ActionRecord[];
  variables: Record<string, unknown>;

  // Timing
  startedAt: number;
  lastActivityAt: number;

  // Error tracking
  errorCount: number;
  lastError?: {
    message: string;
    action?: string;
    timestamp: number;
  };
}

/**
 * Action execution record (for history/undo)
 */
export interface ActionRecord {
  action: Action;
  result: ActionResult;
  timestamp: number;
  pageStateBeforeSnapshot?: string; // For undo capability
}

/**
 * Session events
 */
export type SessionEvent =
  | { type: 'started'; sessionId: string }
  | { type: 'action_executed'; action: Action; result: ActionResult }
  | { type: 'ai_response'; content: string }
  | { type: 'paused'; reason: string }
  | { type: 'resumed' }
  | { type: 'error'; error: Error }
  | { type: 'completed'; summary: string }
  | { type: 'aborted'; reason: string };
