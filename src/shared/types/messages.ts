import type { Action } from './actions';
import type { ActionResult, PageContext } from './browser';
import type { SessionConfig, Session } from './session';
import type { ContextBuilderOptions } from '../../core/session/interfaces';

/**
 * Message channels
 */
export type MessageChannel = 'popup' | 'sidePanel' | 'contentScript' | 'offscreen';

/**
 * All message types in the extension
 */
export type ExtensionMessageType =
  // Session management
  | 'SESSION_CREATE'
  | 'SESSION_START'
  | 'SESSION_PAUSE'
  | 'SESSION_RESUME'
  | 'SESSION_ABORT'
  | 'SESSION_SEND_MESSAGE'
  | 'SESSION_GET_STATE'
  | 'SESSION_LIST'

  // Action execution
  | 'ACTION_EXECUTE'
  | 'ACTION_EXECUTE_BATCH'
  | 'ACTION_ABORT'
  | 'ACTION_UNDO'

  // Tab management
  | 'TAB_ATTACH'
  | 'TAB_DETACH'
  | 'TAB_GET_STATE'
  | 'TAB_CAPTURE'

  // Settings
  | 'SETTINGS_GET'
  | 'SETTINGS_UPDATE'
  | 'PROVIDER_SET'
  | 'API_KEY_SET'
  | 'API_KEY_VALIDATE'

  // Context
  | 'CONTEXT_GET'
  | 'CONTEXT_UPDATE'

  // Events (broadcasts)
  | 'EVENT_SESSION_UPDATE'
  | 'EVENT_ACTION_PROGRESS'
  | 'EVENT_AI_STREAM'
  | 'EVENT_ERROR';

/**
 * Base message structure
 */
export interface ExtensionMessage<T = unknown> {
  id: string;
  channel: MessageChannel;
  type: ExtensionMessageType;
  payload: T;
  timestamp: number;
}

/**
 * Response wrapper
 */
export interface ExtensionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// ============================================================================
// Request/Response types for each message
// ============================================================================

export interface SessionCreateRequest {
  config: Omit<SessionConfig, 'id'>;
  tabId?: number;
}

export interface SessionCreateResponse {
  session: Session;
}

export interface SessionStartRequest {
  sessionId: string;
  prompt?: string;
}

export interface ActionExecuteRequest {
  sessionId?: string;
  action: Action;
}

export interface ActionExecuteResponse {
  result: ActionResult;
}

export interface ContextGetRequest {
  tabId?: number;
  options?: ContextBuilderOptions;
}

export interface ContextGetResponse {
  context: PageContext;
}

/**
 * Type-safe message sender interface
 */
export interface MessageSender {
  <T extends ExtensionMessageType>(
    type: T,
    payload: RequestPayloadMap[T],
  ): Promise<ResponsePayloadMap[T]>;
}

/**
 * Type maps for request payloads
 */
export interface RequestPayloadMap {
  SESSION_CREATE: SessionCreateRequest;
  SESSION_START: SessionStartRequest;
  SESSION_PAUSE: { sessionId: string };
  SESSION_RESUME: { sessionId: string };
  SESSION_ABORT: { sessionId: string };
  SESSION_SEND_MESSAGE: { sessionId: string; message: string };
  SESSION_GET_STATE: { sessionId: string };
  SESSION_LIST: void;
  ACTION_EXECUTE: ActionExecuteRequest;
  ACTION_EXECUTE_BATCH: { sessionId?: string; actions: Action[] };
  ACTION_ABORT: { sessionId?: string };
  ACTION_UNDO: { sessionId: string; steps?: number };
  TAB_ATTACH: { tabId: number };
  TAB_DETACH: { tabId: number };
  TAB_GET_STATE: { tabId?: number };
  TAB_CAPTURE: { tabId?: number };
  SETTINGS_GET: void;
  SETTINGS_UPDATE: { settings: Record<string, unknown> };
  PROVIDER_SET: { provider: string; config: Record<string, unknown> };
  API_KEY_SET: { provider: string; apiKey: string };
  API_KEY_VALIDATE: { provider: string; apiKey: string };
  CONTEXT_GET: ContextGetRequest;
  CONTEXT_UPDATE: { tabId: number };
  EVENT_SESSION_UPDATE: { sessionId: string };
  EVENT_ACTION_PROGRESS: { actionId: string; progress: number };
  EVENT_AI_STREAM: { sessionId: string; chunk: string };
  EVENT_ERROR: { code: string; message: string };
}

/**
 * Type maps for response payloads
 */
export interface ResponsePayloadMap {
  SESSION_CREATE: SessionCreateResponse;
  SESSION_START: void;
  SESSION_PAUSE: void;
  SESSION_RESUME: void;
  SESSION_ABORT: void;
  SESSION_SEND_MESSAGE: void;
  SESSION_GET_STATE: { session: Session | null };
  SESSION_LIST: { sessions: Session[] };
  ACTION_EXECUTE: ActionExecuteResponse;
  ACTION_EXECUTE_BATCH: { results: ActionResult[] };
  ACTION_ABORT: void;
  ACTION_UNDO: void;
  TAB_ATTACH: void;
  TAB_DETACH: void;
  TAB_GET_STATE: { state: Record<string, unknown> | null };
  TAB_CAPTURE: { screenshot: string };
  SETTINGS_GET: { settings: Record<string, unknown> };
  SETTINGS_UPDATE: void;
  PROVIDER_SET: void;
  API_KEY_SET: void;
  API_KEY_VALIDATE: { valid: boolean };
  CONTEXT_GET: ContextGetResponse;
  CONTEXT_UPDATE: void;
  EVENT_SESSION_UPDATE: void;
  EVENT_ACTION_PROGRESS: void;
  EVENT_AI_STREAM: void;
  EVENT_ERROR: void;
}
