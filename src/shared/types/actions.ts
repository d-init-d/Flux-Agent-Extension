/**
 * All supported action types
 */
export type ActionType =
  // Navigation
  | 'navigate'
  | 'goBack'
  | 'goForward'
  | 'reload'
  // Interaction
  | 'click'
  | 'doubleClick'
  | 'rightClick'
  | 'hover'
  | 'focus'
  // Input
  | 'fill'
  | 'type'
  | 'clear'
  | 'select' // Select dropdown option
  | 'check' // Checkbox
  | 'uncheck'
  // Keyboard
  | 'press' // Single key
  | 'hotkey' // Key combination
  // Scroll
  | 'scroll'
  | 'scrollIntoView'
  // Wait
  | 'wait'
  | 'waitForElement'
  | 'waitForNavigation'
  | 'waitForNetwork'
  // Extract
  | 'extract' // Get text/attribute
  | 'extractAll' // Get multiple elements
  | 'screenshot'
  | 'fullPageScreenshot'
  // Tab Management
  | 'newTab'
  | 'closeTab'
  | 'switchTab'
  // Advanced
  | 'evaluate' // Run custom JS
  | 'interceptNetwork'
  | 'mockResponse';

export type NetworkResourceType =
  | 'Document'
  | 'XHR'
  | 'Fetch'
  | 'Script'
  | 'Image'
  | 'Stylesheet'
  | 'Media'
  | 'Other';

export type InterceptNetworkOperation = 'continue' | 'block';

/**
 * Element selector - multiple strategies
 */
export interface ElementSelector {
  // At least one must be provided
  css?: string; // CSS selector
  xpath?: string; // XPath selector
  text?: string; // Text content (partial match)
  textExact?: string; // Text content (exact match)
  ariaLabel?: string; // aria-label attribute
  placeholder?: string; // Input placeholder
  testId?: string; // data-testid attribute
  role?: string; // ARIA role
  nth?: number; // Index when multiple matches (0-based)

  // Visual selectors (for AI-generated)
  nearText?: string; // Element near this text
  withinSection?: string; // Section heading or landmark
}

/**
 * Base action interface
 */
export interface BaseAction {
  id: string; // Unique action ID
  type: ActionType;
  description?: string; // Human-readable description
  timeout?: number; // Override default timeout (ms)
  optional?: boolean; // Don't fail if action fails
  retries?: number; // Retry count on failure
}

/**
 * Navigation actions
 */
export interface NavigateAction extends BaseAction {
  type: 'navigate';
  url: string;
  waitUntil?: 'load' | 'domContentLoaded' | 'networkIdle';
}

export interface GoBackAction extends BaseAction {
  type: 'goBack';
}

export interface GoForwardAction extends BaseAction {
  type: 'goForward';
}

export interface ReloadAction extends BaseAction {
  type: 'reload';
  hardReload?: boolean;
}

/**
 * Click actions
 */
export interface ClickAction extends BaseAction {
  type: 'click' | 'doubleClick' | 'rightClick';
  selector: ElementSelector;
  position?: { x: number; y: number }; // Offset from element center
  modifiers?: ('ctrl' | 'shift' | 'alt' | 'meta')[];
}

export interface HoverAction extends BaseAction {
  type: 'hover';
  selector: ElementSelector;
}

export interface FocusAction extends BaseAction {
  type: 'focus';
  selector: ElementSelector;
}

/**
 * Input actions
 */
export interface FillAction extends BaseAction {
  type: 'fill';
  selector: ElementSelector;
  value: string;
  clearFirst?: boolean; // Clear existing content first (default: true)
}

export interface TypeAction extends BaseAction {
  type: 'type';
  selector: ElementSelector;
  text: string;
  delay?: number; // Delay between keystrokes (ms)
}

export interface ClearAction extends BaseAction {
  type: 'clear';
  selector: ElementSelector;
}

export interface SelectAction extends BaseAction {
  type: 'select';
  selector: ElementSelector;
  option: string | { value?: string; label?: string; index?: number };
}

export interface CheckAction extends BaseAction {
  type: 'check' | 'uncheck';
  selector: ElementSelector;
}

/**
 * Keyboard actions
 */
export interface PressAction extends BaseAction {
  type: 'press';
  key: string; // e.g., 'Enter', 'Tab', 'Escape'
  selector?: ElementSelector; // Optional: focus element first
}

export interface HotkeyAction extends BaseAction {
  type: 'hotkey';
  keys: string[]; // e.g., ['ctrl', 'a'] or ['cmd', 'shift', 'p']
}

/**
 * Scroll actions
 */
export interface ScrollAction extends BaseAction {
  type: 'scroll';
  direction: 'up' | 'down' | 'left' | 'right';
  amount?: number; // Pixels, default 500
  selector?: ElementSelector; // Scroll within element
}

export interface ScrollIntoViewAction extends BaseAction {
  type: 'scrollIntoView';
  selector: ElementSelector;
  block?: 'start' | 'center' | 'end';
}

/**
 * Wait actions
 */
export interface WaitAction extends BaseAction {
  type: 'wait';
  duration: number; // Milliseconds
}

export interface WaitForElementAction extends BaseAction {
  type: 'waitForElement';
  selector: ElementSelector;
  state?: 'visible' | 'hidden' | 'attached' | 'detached';
}

export interface WaitForNavigationAction extends BaseAction {
  type: 'waitForNavigation';
  urlPattern?: string; // Regex pattern
}

export interface WaitForNetworkAction extends BaseAction {
  type: 'waitForNetwork';
  state: 'idle' | 'busy';
  timeout?: number;
}

/**
 * Extract actions
 */
export interface ExtractAction extends BaseAction {
  type: 'extract';
  selector: ElementSelector;
  attribute?: string; // 'textContent' | 'innerHTML' | 'href' | custom
  outputVariable?: string; // Store result in variable
}

export interface ExtractAllAction extends BaseAction {
  type: 'extractAll';
  selector: ElementSelector;
  attributes?: string[]; // Multiple attributes per element
  limit?: number; // Max elements to extract
  outputVariable?: string;
}

export interface ScreenshotAction extends BaseAction {
  type: 'screenshot' | 'fullPageScreenshot';
  selector?: ElementSelector; // Screenshot specific element
  format?: 'png' | 'jpeg';
  quality?: number; // 0-100 for jpeg
  outputVariable?: string; // Store base64 result
}

/**
 * Tab actions
 */
export interface NewTabAction extends BaseAction {
  type: 'newTab';
  url?: string;
  active?: boolean;
}

export interface CloseTabAction extends BaseAction {
  type: 'closeTab';
  tabIndex?: number; // Default: current tab
}

export interface SwitchTabAction extends BaseAction {
  type: 'switchTab';
  tabIndex: number;
}

/**
 * Advanced actions
 */
export interface EvaluateAction extends BaseAction {
  type: 'evaluate';
  script: string; // JavaScript to execute
  args?: unknown[]; // Arguments to pass
  outputVariable?: string;
}

export interface InterceptNetworkAction extends BaseAction {
  type: 'interceptNetwork';
  urlPatterns: string[];
  operation: InterceptNetworkOperation;
  resourceTypes?: NetworkResourceType[];
}

export interface MockResponseDefinition {
  status: number;
  headers?: Record<string, string>;
  body: string;
  bodyEncoding?: 'utf8' | 'base64';
  contentType?: string;
}

export interface MockResponseAction extends BaseAction {
  type: 'mockResponse';
  urlPatterns: string[];
  resourceTypes?: NetworkResourceType[];
  response: MockResponseDefinition;
}

/**
 * Union type for all actions
 */
export type Action =
  | NavigateAction
  | GoBackAction
  | GoForwardAction
  | ReloadAction
  | ClickAction
  | HoverAction
  | FocusAction
  | FillAction
  | TypeAction
  | ClearAction
  | SelectAction
  | CheckAction
  | PressAction
  | HotkeyAction
  | ScrollAction
  | ScrollIntoViewAction
  | WaitAction
  | WaitForElementAction
  | WaitForNavigationAction
  | WaitForNetworkAction
  | ExtractAction
  | ExtractAllAction
  | ScreenshotAction
  | NewTabAction
  | CloseTabAction
  | SwitchTabAction
  | EvaluateAction
  | InterceptNetworkAction
  | MockResponseAction;

/**
 * Parsed AI response containing actions
 */
export interface ParsedResponse {
  thinking?: string; // AI's reasoning (for display)
  actions: Action[]; // Actions to execute
  summary?: string; // Human-readable summary
  needsMoreInfo?: {
    // If AI needs clarification
    question: string;
    context: string;
  };
}
