import type {
  ClickAction,
  FillAction,
  NavigateAction,
  Action,
  ElementSelector,
  FrameTarget,
} from './actions';
import type { FrameDescriptor, PageContext } from './browser';
import type { SerializedFileUpload } from './uploads';

/**
 * Message types for content script communication
 */
export type MessageType =
  // Commands (Service Worker -> Content Script)
  | 'EXECUTE_ACTION'
  | 'GET_PAGE_CONTEXT'
  | 'HIGHLIGHT_ELEMENT'
  | 'CLEAR_HIGHLIGHTS'
  | 'SET_RECORDING_STATE'
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
  | 'RECORDED_CLICK'
  | 'RECORDED_INPUT'
  | 'RECORDED_NAVIGATION'
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

export interface BridgeSendTarget {
  frameId?: number;
  documentId?: string;
}

export interface BridgeFrameContext extends FrameDescriptor {
  tabId?: number;
}

/**
 * Message payloads
 */
export interface ExecuteActionPayload {
  action: Action;
  context: {
    variables: Record<string, unknown>; // Variable store
    uploads?: SerializedFileUpload[];
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

export interface GetPageContextPayload {
  frame?: FrameTarget;
  includeChildFrames?: boolean;
}

export interface PageContextPayload {
  context: PageContext;
}

export interface HighlightPayload {
  selector: ElementSelector;
  color?: string;
  duration?: number; // Auto-clear after ms
}

export interface SetRecordingStatePayload {
  active: boolean;
}

export interface RecordedClickPayload {
  action: ClickAction;
}

export interface RecordedInputPayload {
  action: FillAction;
}

export interface RecordedNavigationPayload {
  action: NavigateAction;
}
