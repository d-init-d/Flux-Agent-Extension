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
  
  // Background → Sidebar
  | 'CHAT_RESPONSE'
  | 'CHAT_STREAM'
  | 'ACTION_STATUS'
  | 'ERROR'
  
  // Background → Content
  | 'DOM_ACTION'
  | 'SCREENSHOT_REQUEST'
  | 'PAGE_CONTEXT_REQUEST'
  
  // Content → Background
  | 'DOM_ACTION_RESULT'
  | 'SCREENSHOT_RESULT'
  | 'PAGE_CONTEXT_RESULT';

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
  type: 'click' | 'type' | 'scroll' | 'hover' | 'extract' | 'screenshot';
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
