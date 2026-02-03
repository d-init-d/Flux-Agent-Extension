/**
 * Message types for communication between extension components
 */

// Message types enum
export type MessageType = 
  // Sidebar → Background
  | 'CHAT_SEND'
  | 'SETTINGS_UPDATE'
  | 'PROVIDER_SWITCH'
  | 'ACTION_EXECUTE'
  | 'ACTION_CANCEL'
  
  // Provider management (Phase 4)
  | 'GET_PROVIDER_SETTINGS'
  | 'SET_PROVIDER'
  | 'SET_API_KEY'
  | 'CHAT_WITH_AI'
  
  // Background → Sidebar
  | 'CHAT_RESPONSE'
  | 'CHAT_STREAM'
  | 'ACTION_STATUS'
  | 'ERROR'
  
  // Background ↔ Content - Core
  | 'DOM_ACTION'
  | 'DOM_ACTION_RESULT'
  | 'SCREENSHOT_REQUEST'
  | 'SCREENSHOT_RESULT'
  | 'PAGE_CONTEXT_REQUEST'
  | 'PAGE_CONTEXT_RESULT'
  
  // Quick Actions (Phase 2)
  | 'CLICK'
  | 'CLICK_RESULT'
  | 'TYPE'
  | 'TYPE_RESULT'
  | 'SCROLL'
  | 'SCROLL_RESULT'
  | 'SCROLL_TO'
  | 'SCROLL_TO_RESULT'
  | 'HOVER'
  | 'HOVER_RESULT'
  | 'EXTRACT_TEXT'
  | 'EXTRACT_TEXT_RESULT'
  | 'EXTRACT_TABLE'
  | 'EXTRACT_TABLE_RESULT'
  | 'EXTRACT_LINKS'
  | 'EXTRACT_LINKS_RESULT'
  | 'HIGHLIGHT'
  | 'REMOVE_HIGHLIGHT';

// Base message structure
export interface Message<T = unknown> {
  type: MessageType;
  payload: T;
  timestamp: number;
  id: string;
}

// Chat messages
export interface ChatMessage {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  actions?: Action[];
}

// Actions
export interface Action {
  id: string;
  type: 'click' | 'type' | 'scroll' | 'scrollToElement' | 'hover' | 'leaveHover' | 'extract' | 'screenshot';
  params: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: ActionResult;
}

export interface ActionResult {
  success: boolean;
  message?: string;
  data?: unknown;
  screenshot?: string;
}

// Page context
export interface PageContext {
  url: string;
  title: string;
  description?: string;
  headings: string[];
  forms: FormInfo[];
  links: LinkInfo[];
  interactiveElements: InteractiveElement[];
}

export interface FormInfo {
  id?: string;
  name?: string;
  action?: string;
  method?: string;
  fields: FormField[];
}

export interface FormField {
  name: string;
  type: string;
  label?: string;
  placeholder?: string;
  required: boolean;
}

export interface LinkInfo {
  href: string;
  text: string;
}

export interface InteractiveElement {
  type: 'button' | 'link' | 'input' | 'select';
  text: string;
  selector: string;
}
