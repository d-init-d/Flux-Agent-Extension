import type { Action } from './actions';
import type { ElementSelector } from './actions';
import type { PageContext } from './browser';

/**
 * Message types for content script communication
 */
export type MessageType =
  // Commands (Service Worker -> Content Script)
  | 'EXECUTE_ACTION'
  | 'GET_PAGE_CONTEXT'
  | 'HIGHLIGHT_ELEMENT'
  | 'CLEAR_HIGHLIGHTS'
  | 'PING'

  // Responses (Content Script -> Service Worker)
  | 'ACTION_RESULT'
  | 'PAGE_CONTEXT'
  | 'ERROR'
  | 'PONG'

  // Events (Content Script -> Service Worker)
  | 'PAGE_LOADED'
  | 'PAGE_UNLOAD'
  | 'DOM_MUTATION'
  | 'NETWORK_REQUEST'
  | 'CONSOLE_LOG';

/**
 * Base message structure
 */
export interface BridgeMessage<T = unknown> {
  id: string; // Unique message ID for request/response matching
  type: MessageType;
  timestamp: number;
  payload: T;
}

/**
 * Message payloads
 */
export interface ExecuteActionPayload {
  action: Action;
  context: {
    variables: Record<string, unknown>; // Variable store
  };
}

export interface ActionResultPayload {
  actionId: string;
  success: boolean;
  data?: unknown;
  error?: {
    code: string;
    message: string;
    stack?: string;
  };
  duration: number;
}

export interface PageContextPayload {
  context: PageContext;
}

export interface HighlightPayload {
  selector: ElementSelector;
  color?: string;
  duration?: number; // Auto-clear after ms
}
