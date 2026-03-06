/**
 * Tab state tracking
 */
export interface TabState {
  id: number;
  url: string;
  title: string;
  status: 'loading' | 'complete';
  isActive: boolean;
  contentScriptReady: boolean;
  lastUpdated: number;
}

/**
 * Execution result from an action
 */
export interface ActionResult {
  actionId: string;
  success: boolean;
  data?: unknown; // Result data (e.g., extracted text)
  error?: {
    code: string;
    message: string;
    recoverable: boolean;
  };
  duration: number; // Execution time in ms
  screenshot?: string; // Base64 screenshot if requested
}

/**
 * Browser controller options
 */
export interface BrowserControllerOptions {
  defaultTimeout: number; // Default action timeout
  screenshotOnError: boolean; // Capture screenshot on failure
  logActions: boolean; // Log all actions for debugging
  enableDebugger: boolean; // Use chrome.debugger API
}

/**
 * Page context sent to AI for decision making
 */
export interface PageContext {
  url: string;
  title: string;
  summary?: string;

  // Simplified DOM representation
  interactiveElements: InteractiveElement[];

  // Page structure
  headings: { level: number; text: string }[];
  links: { text: string; href: string }[];
  forms: FormInfo[];

  // Viewport info
  viewport: {
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
    scrollHeight: number;
  };

  // Screenshot (optional, base64)
  screenshot?: string;
}

/**
 * Interactive element info for AI context
 */
export interface InteractiveElement {
  index: number; // Reference index for selection
  tag: string;
  type?: string; // input type
  role?: string; // ARIA role
  text: string; // Visible text
  placeholder?: string;
  ariaLabel?: string;
  isVisible: boolean;
  isEnabled: boolean;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * Form information for AI context
 */
export interface FormInfo {
  action: string;
  method: string;
  fields: {
    name: string;
    type: string;
    label?: string;
    required: boolean;
    value?: string;
  }[];
}

/**
 * Screenshot capture options
 */
export interface ScreenshotOptions {
  fullPage?: boolean;
  format?: 'png' | 'jpeg';
  quality?: number;
  selector?: string; // Capture specific element
}
