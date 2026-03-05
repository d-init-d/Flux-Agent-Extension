# AI Browser Controller - Technical Architecture

> **Version:** 1.0.0  
> **Last Updated:** 2026-03-05  
> **Status:** Design Phase

---

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [System Architecture](#2-system-architecture)
3. [Core Modules Design](#3-core-modules-design)
4. [API Design & TypeScript Interfaces](#4-api-design--typescript-interfaces)
5. [Technology Stack](#5-technology-stack)
6. [File Structure](#6-file-structure)
7. [Critical Technical Decisions](#7-critical-technical-decisions)
8. [Limitations & Mitigations](#8-limitations--mitigations)
9. [Security Considerations](#9-security-considerations)
10. [Future Roadmap](#10-future-roadmap)

---

## 1. Executive Summary

### 1.1 Project Vision
Build a Chrome Extension (Manifest V3) that enables AI models to control the browser autonomously - navigating, clicking, filling forms, taking screenshots, and extracting data - all without requiring any local server or Node.js installation.

### 1.2 Key Design Principles
| Principle | Description |
|-----------|-------------|
| **Zero Setup** | User installs extension only, no external dependencies |
| **Provider Agnostic** | Support Claude, GPT, Gemini, local models via unified interface |
| **Graceful Degradation** | Fallback strategies when primary methods fail |
| **Security First** | Sanitize all AI-generated commands, sandbox execution |
| **Performance** | Minimal overhead, efficient DOM operations |

### 1.3 Success Metrics
- Works on 95%+ of websites without special configuration
- Command execution latency < 100ms for DOM operations
- Memory footprint < 50MB idle, < 150MB active
- Support 10+ concurrent AI sessions

---

## 2. System Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CHROME EXTENSION (MV3)                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        PRESENTATION LAYER                           │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐    │   │
│  │  │   Popup UI   │  │  Side Panel  │  │  Floating Action Bar   │    │   │
│  │  │  (Settings)  │  │ (Chat + Log) │  │  (Quick Actions)       │    │   │
│  │  └──────┬───────┘  └──────┬───────┘  └───────────┬────────────┘    │   │
│  └─────────┼─────────────────┼──────────────────────┼─────────────────┘   │
│            │                 │                      │                      │
│            └─────────────────┼──────────────────────┘                      │
│                              │ Message Passing                             │
│                              ▼                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    SERVICE WORKER (Background)                      │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌──────────────┐  │   │
│  │  │  AI Client  │ │  Command    │ │  Browser    │ │   Session    │  │   │
│  │  │   Module    │ │  Parser     │ │  Controller │ │   Manager    │  │   │
│  │  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └──────┬───────┘  │   │
│  │         │               │               │               │          │   │
│  │         └───────────────┴───────┬───────┴───────────────┘          │   │
│  │                                 │                                   │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │                   ORCHESTRATOR ENGINE                       │   │   │
│  │  │  - Action Queue & Prioritization                            │   │   │
│  │  │  - Error Recovery & Retry Logic                             │   │   │
│  │  │  - Rate Limiting & Throttling                               │   │   │
│  │  └─────────────────────────────┬───────────────────────────────┘   │   │
│  └────────────────────────────────┼───────────────────────────────────┘   │
│                                   │                                        │
│            ┌──────────────────────┼──────────────────────┐                │
│            │ chrome.runtime       │ chrome.tabs          │                │
│            │ .sendMessage()       │ .sendMessage()       │                │
│            ▼                      ▼                      ▼                │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      CONTENT SCRIPTS LAYER                          │   │
│  │                                                                     │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │   │
│  │  │  DOM Inspector  │  │ Event Simulator │  │ Visual Feedback │     │   │
│  │  │  & Selector     │  │ (Click/Type)    │  │ (Highlights)    │     │   │
│  │  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘     │   │
│  │           │                    │                    │              │   │
│  │  ┌────────┴────────────────────┴────────────────────┴────────┐     │   │
│  │  │                    BRIDGE MODULE                          │     │   │
│  │  │  - Secure Message Protocol                                │     │   │
│  │  │  - Command Execution Sandbox                              │     │   │
│  │  │  - Result Serialization                                   │     │   │
│  │  └───────────────────────────────────────────────────────────┘     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTPS
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          EXTERNAL AI PROVIDERS                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │  Claude  │  │   GPT    │  │  Gemini  │  │  Ollama  │  │  Custom  │      │
│  │   API    │  │   API    │  │   API    │  │  (Local) │  │   API    │      │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Component Responsibilities

| Component | Responsibility | Runs In |
|-----------|---------------|---------|
| **Popup UI** | Settings, API key management, quick toggles | Extension popup |
| **Side Panel** | Chat interface, action log, real-time status | Side panel (persistent) |
| **Service Worker** | Core logic, AI communication, tab control | Background (ephemeral) |
| **Content Scripts** | DOM manipulation, event simulation, screenshots | Target web pages |
| **Offscreen Document** | Audio/video processing, clipboard operations | Hidden document |

### 2.3 Data Flow Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                            USER INTERACTION FLOW                           │
└────────────────────────────────────────────────────────────────────────────┘

  User Input                AI Processing              Browser Execution
      │                          │                           │
      ▼                          │                           │
┌──────────┐                     │                           │
│  "Click  │                     │                           │
│  login"  │                     │                           │
└────┬─────┘                     │                           │
     │                           │                           │
     ▼                           ▼                           │
┌──────────┐   Send Prompt   ┌──────────┐                    │
│  Side    │ ───────────────►│  Service │                    │
│  Panel   │                 │  Worker  │                    │
└──────────┘                 └────┬─────┘                    │
                                  │                          │
                                  ▼                          │
                            ┌──────────┐   API Call      ┌──────────┐
                            │    AI    │ ───────────────►│  Claude/ │
                            │  Client  │                 │   GPT    │
                            └────┬─────┘◄────────────────└──────────┘
                                  │         Response           │
                                  │                            │
                                  ▼                            │
                            ┌──────────┐                       │
                            │ Command  │  Parse Actions        │
                            │ Parser   │ ─────────────┐        │
                            └──────────┘              │        │
                                                      ▼        │
                            ┌──────────┐         ┌──────────┐  │
                            │ Browser  │◄────────│  Action  │  │
                            │Controller│         │  Queue   │  │
                            └────┬─────┘         └──────────┘  │
                                  │                            │
                                  │  chrome.tabs               │
                                  │  .sendMessage()            │
                                  ▼                            ▼
                            ┌──────────┐               ┌──────────┐
                            │ Content  │───────────────│   DOM    │
                            │ Script   │   Execute     │ (Target) │
                            └────┬─────┘               └──────────┘
                                  │                          │
                                  │  Result                  │
                                  ▼                          │
                            ┌──────────┐                     │
                            │ Session  │◄────────────────────┘
                            │ Manager  │   Page State
                            └────┬─────┘
                                  │
                                  │  Update Context
                                  ▼
                            ┌──────────┐
                            │  Next    │
                            │  AI Call │ ──► (Loop continues)
                            └──────────┘
```

### 2.4 State Management Strategy

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         STATE ARCHITECTURE                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    chrome.storage.local                         │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐     │   │
│  │  │   Settings  │  │   API Keys  │  │  Conversation       │     │   │
│  │  │  (Persisted)│  │  (Encrypted)│  │  History (Last 50)  │     │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                │                                        │
│                                │ Hydrate on Load                        │
│                                ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    IN-MEMORY STATE (Service Worker)             │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐     │   │
│  │  │  Active     │  │   Action    │  │   Tab Registry      │     │   │
│  │  │  Sessions   │  │   Queue     │  │   (Active Tabs)     │     │   │
│  │  │  Map<id,Ctx>│  │   FIFO      │  │   Map<tabId,State>  │     │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                │                                        │
│                                │ Sync                                   │
│                                ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    REACTIVE STATE (Side Panel)                  │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐     │   │
│  │  │   Zustand   │  │  UI State   │  │   Real-time Log     │     │   │
│  │  │   Store     │  │  (Local)    │  │   (Streaming)       │     │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**State Persistence Strategy:**

| State Type | Storage | TTL | Encryption |
|------------|---------|-----|------------|
| API Keys | `chrome.storage.local` | Permanent | AES-256-GCM |
| Settings | `chrome.storage.local` | Permanent | No |
| Conversation History | `chrome.storage.local` | 7 days | No |
| Active Sessions | Memory | Session | N/A |
| Action Queue | Memory | Session | N/A |
| Page Context | Memory | Per-navigation | N/A |

---

## 3. Core Modules Design

### 3.1 AI Client Module

```typescript
// ============================================================================
// FILE: src/core/ai-client/types.ts
// ============================================================================

/**
 * Supported AI providers
 */
export type AIProviderType = 
  | 'claude'      // Anthropic Claude
  | 'openai'      // OpenAI GPT
  | 'gemini'      // Google Gemini
  | 'ollama'      // Local Ollama
  | 'openrouter'  // OpenRouter (multi-provider)
  | 'custom';     // Custom API endpoint

/**
 * AI model configuration
 */
export interface AIModelConfig {
  provider: AIProviderType;
  model: string;                    // e.g., 'claude-3-5-sonnet-20241022'
  apiKey?: string;                  // Required for cloud providers
  baseUrl?: string;                 // For custom/ollama providers
  maxTokens?: number;               // Max response tokens
  temperature?: number;             // 0-1 creativity scale
  systemPrompt?: string;            // Override default system prompt
}

/**
 * Message format for AI conversation
 */
export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | AIMessageContent[];
  timestamp?: number;
}

export interface AIMessageContent {
  type: 'text' | 'image';
  text?: string;
  image_url?: {
    url: string;              // Base64 data URL or HTTPS URL
    detail?: 'low' | 'high';  // Image quality for vision
  };
}

/**
 * Streaming chunk from AI
 */
export interface AIStreamChunk {
  type: 'text' | 'tool_call' | 'error' | 'done';
  content?: string;
  toolCall?: {
    id: string;
    name: string;
    arguments: string;
  };
  error?: Error;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * AI request options
 */
export interface AIRequestOptions {
  signal?: AbortSignal;
  onChunk?: (chunk: AIStreamChunk) => void;
  tools?: AITool[];
  maxRetries?: number;
  timeout?: number;
}

/**
 * Tool definition for function calling
 */
export interface AITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;  // JSON Schema
  };
}

// ============================================================================
// FILE: src/core/ai-client/interfaces.ts
// ============================================================================

/**
 * Abstract interface for all AI providers
 */
export interface IAIProvider {
  readonly name: AIProviderType;
  readonly supportsVision: boolean;
  readonly supportsStreaming: boolean;
  readonly supportsFunctionCalling: boolean;

  /**
   * Initialize provider with configuration
   */
  initialize(config: AIModelConfig): Promise<void>;

  /**
   * Send message and get streaming response
   */
  chat(
    messages: AIMessage[],
    options?: AIRequestOptions
  ): AsyncGenerator<AIStreamChunk, void, unknown>;

  /**
   * Validate API key without making a real request
   */
  validateApiKey(apiKey: string): Promise<boolean>;

  /**
   * Get remaining quota/credits if available
   */
  getUsage?(): Promise<{ remaining: number; total: number } | null>;

  /**
   * Abort current request
   */
  abort(): void;
}

/**
 * AI Client Manager - orchestrates multiple providers
 */
export interface IAIClientManager {
  /**
   * Register a provider implementation
   */
  registerProvider(provider: IAIProvider): void;

  /**
   * Get active provider
   */
  getActiveProvider(): IAIProvider;

  /**
   * Switch to a different provider
   */
  switchProvider(type: AIProviderType, config: AIModelConfig): Promise<void>;

  /**
   * Send a chat request with automatic retry and fallback
   */
  chat(
    messages: AIMessage[],
    options?: AIRequestOptions
  ): AsyncGenerator<AIStreamChunk, void, unknown>;
}
```

### 3.2 Command Parser Module

```typescript
// ============================================================================
// FILE: src/core/command-parser/types.ts
// ============================================================================

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
  | 'select'       // Select dropdown option
  | 'check'        // Checkbox
  | 'uncheck'
  // Keyboard
  | 'press'        // Single key
  | 'hotkey'       // Key combination
  // Scroll
  | 'scroll'
  | 'scrollIntoView'
  // Wait
  | 'wait'
  | 'waitForElement'
  | 'waitForNavigation'
  | 'waitForNetwork'
  // Extract
  | 'extract'      // Get text/attribute
  | 'extractAll'   // Get multiple elements
  | 'screenshot'
  | 'fullPageScreenshot'
  // Tab Management
  | 'newTab'
  | 'closeTab'
  | 'switchTab'
  // Advanced
  | 'evaluate'     // Run custom JS
  | 'interceptNetwork'
  | 'mockResponse';

/**
 * Element selector - multiple strategies
 */
export interface ElementSelector {
  // At least one must be provided
  css?: string;                // CSS selector
  xpath?: string;              // XPath selector
  text?: string;               // Text content (partial match)
  textExact?: string;          // Text content (exact match)
  ariaLabel?: string;          // aria-label attribute
  placeholder?: string;        // Input placeholder
  testId?: string;             // data-testid attribute
  role?: string;               // ARIA role
  nth?: number;                // Index when multiple matches (0-based)
  
  // Visual selectors (for AI-generated)
  nearText?: string;           // Element near this text
  withinSection?: string;      // Section heading or landmark
}

/**
 * Base action interface
 */
export interface BaseAction {
  id: string;                  // Unique action ID
  type: ActionType;
  description?: string;        // Human-readable description
  timeout?: number;            // Override default timeout (ms)
  optional?: boolean;          // Don't fail if action fails
  retries?: number;            // Retry count on failure
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
  position?: { x: number; y: number };  // Offset from element center
  modifiers?: ('ctrl' | 'shift' | 'alt' | 'meta')[];
}

export interface HoverAction extends BaseAction {
  type: 'hover';
  selector: ElementSelector;
}

/**
 * Input actions
 */
export interface FillAction extends BaseAction {
  type: 'fill';
  selector: ElementSelector;
  value: string;
  clearFirst?: boolean;        // Clear existing content first (default: true)
}

export interface TypeAction extends BaseAction {
  type: 'type';
  selector: ElementSelector;
  text: string;
  delay?: number;              // Delay between keystrokes (ms)
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
  key: string;                 // e.g., 'Enter', 'Tab', 'Escape'
  selector?: ElementSelector;  // Optional: focus element first
}

export interface HotkeyAction extends BaseAction {
  type: 'hotkey';
  keys: string[];              // e.g., ['ctrl', 'a'] or ['cmd', 'shift', 'p']
}

/**
 * Scroll actions
 */
export interface ScrollAction extends BaseAction {
  type: 'scroll';
  direction: 'up' | 'down' | 'left' | 'right';
  amount?: number;             // Pixels, default 500
  selector?: ElementSelector;  // Scroll within element
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
  duration: number;            // Milliseconds
}

export interface WaitForElementAction extends BaseAction {
  type: 'waitForElement';
  selector: ElementSelector;
  state?: 'visible' | 'hidden' | 'attached' | 'detached';
}

export interface WaitForNavigationAction extends BaseAction {
  type: 'waitForNavigation';
  urlPattern?: string;         // Regex pattern
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
  attribute?: string;          // 'textContent' | 'innerHTML' | 'href' | custom
  outputVariable?: string;     // Store result in variable
}

export interface ExtractAllAction extends BaseAction {
  type: 'extractAll';
  selector: ElementSelector;
  attributes?: string[];       // Multiple attributes per element
  limit?: number;              // Max elements to extract
  outputVariable?: string;
}

export interface ScreenshotAction extends BaseAction {
  type: 'screenshot' | 'fullPageScreenshot';
  selector?: ElementSelector;  // Screenshot specific element
  format?: 'png' | 'jpeg';
  quality?: number;            // 0-100 for jpeg
  outputVariable?: string;     // Store base64 result
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
  tabIndex?: number;           // Default: current tab
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
  script: string;              // JavaScript to execute
  args?: unknown[];            // Arguments to pass
  outputVariable?: string;
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
  | FillAction
  | TypeAction
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
  | EvaluateAction;

/**
 * Parsed AI response containing actions
 */
export interface ParsedResponse {
  thinking?: string;           // AI's reasoning (for display)
  actions: Action[];           // Actions to execute
  summary?: string;            // Human-readable summary
  needsMoreInfo?: {            // If AI needs clarification
    question: string;
    context: string;
  };
}

// ============================================================================
// FILE: src/core/command-parser/interfaces.ts
// ============================================================================

export interface ICommandParser {
  /**
   * Parse AI response text into structured actions
   */
  parse(response: string): ParsedResponse;

  /**
   * Validate an action before execution
   */
  validate(action: Action): ValidationResult;

  /**
   * Sanitize potentially dangerous actions
   */
  sanitize(action: Action): Action;
}

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
}

/**
 * Parser configuration
 */
export interface ParserConfig {
  strictMode: boolean;         // Fail on any validation error
  allowEvaluate: boolean;      // Allow custom JS execution
  allowedDomains?: string[];   // Whitelist for navigation
  blockedSelectors?: string[]; // Dangerous selectors to block
}
```

### 3.3 Browser Controller Module

```typescript
// ============================================================================
// FILE: src/core/browser-controller/types.ts
// ============================================================================

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
  data?: unknown;              // Result data (e.g., extracted text)
  error?: {
    code: string;
    message: string;
    recoverable: boolean;
  };
  duration: number;            // Execution time in ms
  screenshot?: string;         // Base64 screenshot if requested
}

/**
 * Browser controller options
 */
export interface BrowserControllerOptions {
  defaultTimeout: number;      // Default action timeout
  screenshotOnError: boolean;  // Capture screenshot on failure
  logActions: boolean;         // Log all actions for debugging
  enableDebugger: boolean;     // Use chrome.debugger API
}

// ============================================================================
// FILE: src/core/browser-controller/interfaces.ts
// ============================================================================

/**
 * Main browser controller interface
 */
export interface IBrowserController {
  /**
   * Initialize controller for a tab
   */
  attachToTab(tabId: number): Promise<void>;

  /**
   * Detach from current tab
   */
  detach(): Promise<void>;

  /**
   * Execute a single action
   */
  execute(action: Action): Promise<ActionResult>;

  /**
   * Execute multiple actions in sequence
   */
  executeSequence(
    actions: Action[],
    options?: {
      stopOnError?: boolean;
      onProgress?: (result: ActionResult, index: number) => void;
    }
  ): Promise<ActionResult[]>;

  /**
   * Get current tab state
   */
  getTabState(): TabState | null;

  /**
   * Get page context for AI
   */
  getPageContext(): Promise<PageContext>;

  /**
   * Take screenshot
   */
  captureScreenshot(options?: ScreenshotOptions): Promise<string>;

  /**
   * Abort current action
   */
  abort(): void;
}

/**
 * Page context sent to AI for decision making
 */
export interface PageContext {
  url: string;
  title: string;
  
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

export interface InteractiveElement {
  index: number;               // Reference index for selection
  tag: string;
  type?: string;               // input type
  role?: string;               // ARIA role
  text: string;                // Visible text
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

export interface ScreenshotOptions {
  fullPage?: boolean;
  format?: 'png' | 'jpeg';
  quality?: number;
  selector?: string;           // Capture specific element
}
```

### 3.4 Content Script Bridge Module

```typescript
// ============================================================================
// FILE: src/core/bridge/types.ts
// ============================================================================

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
  id: string;                  // Unique message ID for request/response matching
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
    variables: Record<string, unknown>;  // Variable store
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
  duration?: number;           // Auto-clear after ms
}

// ============================================================================
// FILE: src/core/bridge/interfaces.ts
// ============================================================================

/**
 * Service Worker side of the bridge
 */
export interface IServiceWorkerBridge {
  /**
   * Send command to content script and wait for response
   */
  send<T, R>(tabId: number, type: MessageType, payload: T): Promise<R>;

  /**
   * Send command without waiting for response
   */
  sendOneWay<T>(tabId: number, type: MessageType, payload: T): void;

  /**
   * Listen for events from content scripts
   */
  onEvent(
    type: MessageType,
    handler: (tabId: number, payload: unknown) => void
  ): () => void;

  /**
   * Check if content script is ready
   */
  isReady(tabId: number): Promise<boolean>;

  /**
   * Inject content script if not present
   */
  ensureContentScript(tabId: number): Promise<void>;
}

/**
 * Content Script side of the bridge
 */
export interface IContentScriptBridge {
  /**
   * Listen for commands from service worker
   */
  onCommand<T>(
    type: MessageType,
    handler: (payload: T) => Promise<unknown>
  ): () => void;

  /**
   * Send event to service worker
   */
  emit<T>(type: MessageType, payload: T): void;

  /**
   * Initialize bridge and signal readiness
   */
  initialize(): void;
}
```

### 3.5 Session & Context Manager Module

```typescript
// ============================================================================
// FILE: src/core/session/types.ts
// ============================================================================

/**
 * Session state
 */
export type SessionStatus = 
  | 'idle'
  | 'running'
  | 'paused'
  | 'error'
  | 'completed';

/**
 * Session configuration
 */
export interface SessionConfig {
  id: string;
  name?: string;
  provider: AIProviderType;
  model: string;
  systemPrompt?: string;
  maxTurns?: number;           // Max conversation turns
  timeout?: number;            // Session timeout
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
  pageStateBeforeSnapshot?: string;  // For undo capability
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

// ============================================================================
// FILE: src/core/session/interfaces.ts
// ============================================================================

/**
 * Session manager interface
 */
export interface ISessionManager {
  /**
   * Create a new session
   */
  createSession(config: SessionConfig, tabId: number): Promise<Session>;

  /**
   * Get session by ID
   */
  getSession(sessionId: string): Session | null;

  /**
   * Get all active sessions
   */
  getActiveSessions(): Session[];

  /**
   * Start or resume a session
   */
  start(sessionId: string, initialPrompt?: string): Promise<void>;

  /**
   * Pause a running session
   */
  pause(sessionId: string): void;

  /**
   * Resume a paused session
   */
  resume(sessionId: string): void;

  /**
   * Abort and cleanup a session
   */
  abort(sessionId: string): void;

  /**
   * Send user message to session
   */
  sendMessage(sessionId: string, message: string): Promise<void>;

  /**
   * Undo last action(s)
   */
  undo(sessionId: string, steps?: number): Promise<void>;

  /**
   * Subscribe to session events
   */
  subscribe(
    sessionId: string,
    handler: (event: SessionEvent) => void
  ): () => void;

  /**
   * Build page context for AI
   */
  buildContext(sessionId: string): Promise<string>;

  /**
   * Get action history
   */
  getHistory(sessionId: string): ActionRecord[];
}

/**
 * Context builder options
 */
export interface ContextBuilderOptions {
  includeScreenshot: boolean;
  includeDOM: boolean;
  maxElements: number;
  includeNetwork: boolean;
}
```

---

## 4. API Design & TypeScript Interfaces

### 4.1 Storage Schema

```typescript
// ============================================================================
// FILE: src/shared/storage/schema.ts
// ============================================================================

/**
 * Extension settings stored in chrome.storage.local
 */
export interface StorageSchema {
  // Settings
  settings: ExtensionSettings;
  
  // AI Provider configurations
  providers: Record<AIProviderType, ProviderConfig>;
  
  // Active provider
  activeProvider: AIProviderType;
  
  // Encrypted API keys (encrypted with user's passphrase)
  encryptedKeys: Record<AIProviderType, string>;
  
  // Conversation history (per session)
  conversationHistory: Record<string, AIMessage[]>;
  
  // Session configs
  savedSessions: SessionConfig[];
  
  // Usage statistics
  usage: UsageStats;
  
  // Extension state
  extensionState: {
    lastActiveTab: number;
    sidePanelOpen: boolean;
    lastSession: string | null;
  };
}

export interface ExtensionSettings {
  // General
  language: 'en' | 'vi' | 'auto';
  theme: 'light' | 'dark' | 'system';
  
  // AI Settings
  defaultProvider: AIProviderType;
  streamResponses: boolean;
  includeScreenshotsInContext: boolean;
  maxContextLength: number;
  
  // Execution
  defaultTimeout: number;
  autoRetryOnFailure: boolean;
  maxRetries: number;
  screenshotOnError: boolean;
  
  // Security
  allowCustomScripts: boolean;
  allowedDomains: string[];    // Empty = all domains
  blockedDomains: string[];
  
  // UI
  showFloatingBar: boolean;
  highlightElements: boolean;
  soundNotifications: boolean;
  
  // Debug
  debugMode: boolean;
  logNetworkRequests: boolean;
}

export interface ProviderConfig {
  enabled: boolean;
  model: string;
  maxTokens: number;
  temperature: number;
  customEndpoint?: string;
  customHeaders?: Record<string, string>;
}

export interface UsageStats {
  totalSessions: number;
  totalActions: number;
  totalTokensUsed: Record<AIProviderType, number>;
  lastUsed: number;
  actionsPerDay: Record<string, number>;  // ISO date -> count
}
```

### 4.2 Message Protocol

```typescript
// ============================================================================
// FILE: src/shared/protocol/messages.ts
// ============================================================================

/**
 * Message channels
 */
export type MessageChannel = 
  | 'popup'
  | 'sidePanel'
  | 'contentScript'
  | 'offscreen';

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

// Type-safe message sender
export interface MessageSender {
  <T extends ExtensionMessageType>(
    type: T,
    payload: RequestPayloadMap[T]
  ): Promise<ResponsePayloadMap[T]>;
}

// Type maps (to be extended)
export type RequestPayloadMap = {
  SESSION_CREATE: SessionCreateRequest;
  SESSION_START: SessionStartRequest;
  ACTION_EXECUTE: ActionExecuteRequest;
  CONTEXT_GET: ContextGetRequest;
  // ... more mappings
};

export type ResponsePayloadMap = {
  SESSION_CREATE: SessionCreateResponse;
  SESSION_START: void;
  ACTION_EXECUTE: ActionExecuteResponse;
  CONTEXT_GET: ContextGetResponse;
  // ... more mappings
};
```

### 4.3 Error Codes

```typescript
// ============================================================================
// FILE: src/shared/errors/codes.ts
// ============================================================================

/**
 * Standardized error codes
 */
export enum ErrorCode {
  // General
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  TIMEOUT = 'TIMEOUT',
  ABORTED = 'ABORTED',
  
  // AI Provider
  AI_API_ERROR = 'AI_API_ERROR',
  AI_RATE_LIMIT = 'AI_RATE_LIMIT',
  AI_INVALID_KEY = 'AI_INVALID_KEY',
  AI_QUOTA_EXCEEDED = 'AI_QUOTA_EXCEEDED',
  AI_MODEL_NOT_FOUND = 'AI_MODEL_NOT_FOUND',
  AI_PARSE_ERROR = 'AI_PARSE_ERROR',
  
  // Browser
  TAB_NOT_FOUND = 'TAB_NOT_FOUND',
  TAB_CLOSED = 'TAB_CLOSED',
  TAB_PERMISSION_DENIED = 'TAB_PERMISSION_DENIED',
  CONTENT_SCRIPT_NOT_READY = 'CONTENT_SCRIPT_NOT_READY',
  CONTENT_SCRIPT_INJECTION_FAILED = 'CONTENT_SCRIPT_INJECTION_FAILED',
  
  // DOM
  ELEMENT_NOT_FOUND = 'ELEMENT_NOT_FOUND',
  ELEMENT_NOT_VISIBLE = 'ELEMENT_NOT_VISIBLE',
  ELEMENT_NOT_INTERACTIVE = 'ELEMENT_NOT_INTERACTIVE',
  ELEMENT_DETACHED = 'ELEMENT_DETACHED',
  MULTIPLE_ELEMENTS_FOUND = 'MULTIPLE_ELEMENTS_FOUND',
  
  // Action
  ACTION_INVALID = 'ACTION_INVALID',
  ACTION_FAILED = 'ACTION_FAILED',
  ACTION_BLOCKED = 'ACTION_BLOCKED',
  NAVIGATION_FAILED = 'NAVIGATION_FAILED',
  
  // Session
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  SESSION_LIMIT_REACHED = 'SESSION_LIMIT_REACHED',
  
  // Storage
  STORAGE_QUOTA_EXCEEDED = 'STORAGE_QUOTA_EXCEEDED',
  STORAGE_READ_ERROR = 'STORAGE_READ_ERROR',
  STORAGE_WRITE_ERROR = 'STORAGE_WRITE_ERROR',
  
  // Security
  DOMAIN_BLOCKED = 'DOMAIN_BLOCKED',
  SCRIPT_BLOCKED = 'SCRIPT_BLOCKED',
  SENSITIVE_DATA_DETECTED = 'SENSITIVE_DATA_DETECTED',
}

/**
 * Custom error class
 */
export class ExtensionError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public recoverable: boolean = false,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ExtensionError';
  }

  static isExtensionError(error: unknown): error is ExtensionError {
    return error instanceof ExtensionError;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      recoverable: this.recoverable,
      details: this.details,
    };
  }
}
```

---

## 5. Technology Stack

### 5.1 Core Technologies

| Category | Technology | Rationale |
|----------|------------|-----------|
| **Language** | TypeScript 5.x | Type safety, better IDE support, catch errors at compile time |
| **Build Tool** | Vite + CRXJS | Fast HMR, native ESM, excellent Chrome Extension support |
| **Bundler** | Rollup (via Vite) | Tree-shaking, code splitting |
| **Package Manager** | pnpm | Fast, disk-efficient, strict dependencies |

### 5.2 UI Framework

| Category | Technology | Rationale |
|----------|------------|-----------|
| **Framework** | React 18 | Ecosystem, hooks, concurrent features |
| **State (Global)** | Zustand | Lightweight, no boilerplate, works with MV3 |
| **State (Server)** | TanStack Query | Caching, retry, background refetch |
| **Styling** | Tailwind CSS 3 | Utility-first, small bundle, consistent design |
| **Components** | shadcn/ui | Copy-paste components, full control, accessible |
| **Icons** | Lucide React | Tree-shakeable, consistent style |

### 5.3 Development & Testing

| Category | Technology | Rationale |
|----------|------------|-----------|
| **Testing** | Vitest | Fast, Vite-native, Jest-compatible |
| **E2E Testing** | Playwright | Cross-browser, reliable, extension support |
| **Linting** | ESLint + typescript-eslint | Catch errors, enforce style |
| **Formatting** | Prettier | Consistent formatting |
| **Type Checking** | tsc (strict mode) | Catch type errors |
| **Git Hooks** | Husky + lint-staged | Pre-commit quality |

### 5.4 Utilities

| Category | Technology | Rationale |
|----------|------------|-----------|
| **Schema Validation** | Zod | Runtime validation, TypeScript inference |
| **Date/Time** | date-fns | Tree-shakeable, immutable |
| **Unique IDs** | nanoid | Small, fast, URL-safe |
| **Encryption** | Web Crypto API | Native browser API, no dependencies |
| **Markdown** | marked + DOMPurify | Parse AI responses safely |

### 5.5 AI SDK

| Provider | SDK/Library | Notes |
|----------|-------------|-------|
| **Claude** | @anthropic-ai/sdk | Official Anthropic SDK |
| **OpenAI** | openai | Official OpenAI SDK |
| **Gemini** | @google/generative-ai | Official Google SDK |
| **Ollama** | Custom fetch wrapper | Simple REST API |
| **OpenRouter** | Custom fetch wrapper | OpenAI-compatible |

### 5.6 Dependency Summary

```json
{
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "zustand": "^4.5.0",
    "@tanstack/react-query": "^5.0.0",
    "zod": "^3.23.0",
    "nanoid": "^5.0.0",
    "marked": "^12.0.0",
    "dompurify": "^3.1.0",
    "date-fns": "^3.6.0",
    "lucide-react": "^0.400.0",
    "@anthropic-ai/sdk": "^0.30.0",
    "openai": "^4.60.0",
    "@google/generative-ai": "^0.20.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "@crxjs/vite-plugin": "^2.0.0-beta.25",
    "tailwindcss": "^3.4.0",
    "vitest": "^2.0.0",
    "@playwright/test": "^1.45.0",
    "eslint": "^9.10.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "prettier": "^3.3.0",
    "husky": "^9.1.0",
    "lint-staged": "^15.2.0"
  }
}
```

---

## 6. File Structure

```
ai-browser-controller/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                    # Lint, type-check, test
│   │   └── release.yml               # Build and package extension
│   └── ISSUE_TEMPLATE/
│       ├── bug_report.md
│       └── feature_request.md
│
├── .husky/
│   └── pre-commit                    # Run lint-staged
│
├── docs/
│   ├── ARCHITECTURE.md               # This file
│   ├── CONTRIBUTING.md
│   ├── SECURITY.md
│   └── API.md
│
├── src/
│   ├── manifest.json                 # Chrome Extension Manifest V3
│   │
│   ├── background/                   # Service Worker
│   │   ├── index.ts                  # Entry point
│   │   ├── orchestrator.ts           # Main action orchestrator
│   │   └── listeners.ts              # Chrome event listeners
│   │
│   ├── content/                      # Content Scripts
│   │   ├── index.ts                  # Entry point (injected)
│   │   ├── bridge.ts                 # Message bridge implementation
│   │   ├── dom/
│   │   │   ├── inspector.ts          # DOM analysis & context building
│   │   │   ├── selector.ts           # Element selection strategies
│   │   │   └── mutations.ts          # MutationObserver wrapper
│   │   ├── actions/
│   │   │   ├── click.ts
│   │   │   ├── fill.ts
│   │   │   ├── type.ts
│   │   │   ├── scroll.ts
│   │   │   ├── extract.ts
│   │   │   └── index.ts              # Action executor
│   │   └── visual/
│   │       ├── highlight.ts          # Element highlighting
│   │       └── overlay.ts            # Action overlay UI
│   │
│   ├── popup/                        # Popup UI
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   └── components/
│   │       ├── QuickActions.tsx
│   │       ├── ProviderSelector.tsx
│   │       └── SettingsForm.tsx
│   │
│   ├── sidepanel/                    # Side Panel UI
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── Chat/
│   │   │   │   ├── ChatContainer.tsx
│   │   │   │   ├── MessageList.tsx
│   │   │   │   ├── MessageBubble.tsx
│   │   │   │   ├── InputArea.tsx
│   │   │   │   └── ActionPreview.tsx
│   │   │   ├── ActionLog/
│   │   │   │   ├── ActionLogPanel.tsx
│   │   │   │   ├── ActionItem.tsx
│   │   │   │   └── ActionTimeline.tsx
│   │   │   ├── Context/
│   │   │   │   ├── PageContextView.tsx
│   │   │   │   └── ElementTree.tsx
│   │   │   └── common/
│   │   │       ├── Button.tsx
│   │   │       ├── Input.tsx
│   │   │       └── ...
│   │   ├── hooks/
│   │   │   ├── useSession.ts
│   │   │   ├── useActionLog.ts
│   │   │   └── usePageContext.ts
│   │   └── store/
│   │       ├── sessionStore.ts
│   │       └── uiStore.ts
│   │
│   ├── offscreen/                    # Offscreen Document (for APIs not in SW)
│   │   ├── index.html
│   │   └── main.ts
│   │
│   ├── core/                         # Core Business Logic
│   │   ├── ai-client/
│   │   │   ├── types.ts
│   │   │   ├── interfaces.ts
│   │   │   ├── manager.ts            # AIClientManager implementation
│   │   │   ├── providers/
│   │   │   │   ├── base.ts           # Base provider class
│   │   │   │   ├── claude.ts
│   │   │   │   ├── openai.ts
│   │   │   │   ├── gemini.ts
│   │   │   │   ├── ollama.ts
│   │   │   │   └── openrouter.ts
│   │   │   └── prompts/
│   │   │       ├── system.ts         # System prompts
│   │   │       └── templates.ts      # Prompt templates
│   │   │
│   │   ├── command-parser/
│   │   │   ├── types.ts
│   │   │   ├── interfaces.ts
│   │   │   ├── parser.ts             # Main parser implementation
│   │   │   ├── validator.ts          # Action validation
│   │   │   ├── sanitizer.ts          # Security sanitization
│   │   │   └── schemas/
│   │   │       └── action-schemas.ts # Zod schemas for actions
│   │   │
│   │   ├── browser-controller/
│   │   │   ├── types.ts
│   │   │   ├── interfaces.ts
│   │   │   ├── controller.ts         # Main controller
│   │   │   ├── tab-manager.ts        # Tab lifecycle
│   │   │   ├── debugger-adapter.ts   # chrome.debugger wrapper
│   │   │   └── scripting-adapter.ts  # chrome.scripting wrapper
│   │   │
│   │   ├── bridge/
│   │   │   ├── types.ts
│   │   │   ├── interfaces.ts
│   │   │   ├── service-worker-bridge.ts
│   │   │   └── content-script-bridge.ts
│   │   │
│   │   └── session/
│   │       ├── types.ts
│   │       ├── interfaces.ts
│   │       ├── manager.ts            # SessionManager implementation
│   │       ├── context-builder.ts    # Build AI context
│   │       └── history.ts            # Action history & undo
│   │
│   ├── shared/                       # Shared utilities
│   │   ├── constants.ts
│   │   ├── utils/
│   │   │   ├── id.ts                 # ID generation
│   │   │   ├── retry.ts              # Retry logic
│   │   │   ├── timeout.ts            # Timeout utilities
│   │   │   └── logger.ts             # Logging
│   │   ├── storage/
│   │   │   ├── schema.ts             # Storage schema
│   │   │   ├── index.ts              # Storage API wrapper
│   │   │   └── encryption.ts         # API key encryption
│   │   ├── protocol/
│   │   │   └── messages.ts           # Message types
│   │   ├── errors/
│   │   │   ├── codes.ts              # Error codes
│   │   │   └── handler.ts            # Error handling
│   │   └── types/
│   │       └── chrome.d.ts           # Chrome API type extensions
│   │
│   └── assets/
│       ├── icons/
│       │   ├── icon-16.png
│       │   ├── icon-32.png
│       │   ├── icon-48.png
│       │   └── icon-128.png
│       └── styles/
│           └── globals.css
│
├── tests/
│   ├── unit/
│   │   ├── ai-client/
│   │   ├── command-parser/
│   │   ├── browser-controller/
│   │   └── session/
│   ├── integration/
│   │   ├── bridge.test.ts
│   │   └── orchestrator.test.ts
│   └── e2e/
│       ├── fixtures/
│       ├── pages/                    # Test HTML pages
│       └── extension.spec.ts
│
├── scripts/
│   ├── build.ts                      # Build script
│   ├── package.ts                    # Package for store
│   └── dev.ts                        # Development utilities
│
├── .eslintrc.cjs
├── .prettierrc
├── .gitignore
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── tailwind.config.ts
├── postcss.config.cjs
└── README.md
```

---

## 7. Critical Technical Decisions

### 7.1 chrome.debugger vs chrome.scripting

#### Decision Matrix

| Criteria | chrome.scripting | chrome.debugger |
|----------|------------------|-----------------|
| **Permissions** | `scripting`, `activeTab` | `debugger` (scary warning) |
| **User Experience** | Seamless | Yellow "debugging" banner |
| **Capabilities** | Limited to DOM | Full DevTools Protocol |
| **Cross-origin** | Limited | Full access |
| **Network Interception** | No | Yes |
| **Performance** | Good | Overhead |
| **CSP Bypass** | No | Yes |

#### **Recommendation: Hybrid Approach**

```typescript
// Decision logic in browser controller
async function selectAdapter(action: Action, tabState: TabState): Promise<Adapter> {
  // Use chrome.scripting for most actions (better UX)
  const scriptingCapable = [
    'click', 'fill', 'type', 'scroll', 'extract',
    'hover', 'focus', 'check', 'uncheck'
  ];
  
  // Use chrome.debugger only when necessary
  const debuggerRequired = [
    'interceptNetwork',
    'mockResponse',
    'bypassCSP',
    'emulateDevice'
  ];
  
  // Check if site blocks content scripts
  if (!tabState.contentScriptReady) {
    return DebuggerAdapter; // Fallback to debugger
  }
  
  if (debuggerRequired.includes(action.type)) {
    return DebuggerAdapter;
  }
  
  return ScriptingAdapter; // Default
}
```

#### **Minimize Debugger Banner Annoyance**

1. **Lazy Attachment:** Only attach debugger when absolutely needed
2. **Auto-Detach:** Detach immediately after operation completes
3. **User Control:** Setting to disable debugger entirely
4. **Clear Communication:** Explain why banner appears in UI

### 7.2 Handling Sites That Block Content Scripts

**Problem:** Some sites use aggressive CSP or script blocking.

**Solutions (in order of preference):**

```typescript
// Strategy 1: Try normal injection first
async function ensureContentScript(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/index.js'],
    });
    return true;
  } catch (e) {
    // Strategy 2: Try world: 'MAIN' (same context as page)
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/index.js'],
        world: 'MAIN', // Bypass some CSP
      });
      return true;
    } catch (e2) {
      // Strategy 3: Fall back to chrome.debugger
      return await attachDebuggerFallback(tabId);
    }
  }
}
```

### 7.3 Authentication & Session Handling

**Challenge:** Many sites require login, and we need to preserve sessions.

**Solution:**

```typescript
// 1. Use existing browser sessions
// Content scripts have access to all cookies the user has

// 2. For API-based auth, store tokens securely
interface AuthStore {
  // Map of domain -> auth state
  sessions: Map<string, {
    cookies: chrome.cookies.Cookie[];
    localStorage: Record<string, string>;
    sessionStorage: Record<string, string>;
  }>;
}

// 3. Session export/import for automation
async function exportSession(tabId: number): Promise<SessionSnapshot> {
  const cookies = await chrome.cookies.getAll({ url: tabState.url });
  const storage = await bridge.send(tabId, 'GET_STORAGE', {});
  
  return {
    url: tabState.url,
    cookies,
    localStorage: storage.local,
    sessionStorage: storage.session,
    timestamp: Date.now(),
  };
}

// 4. Restore session
async function importSession(tabId: number, snapshot: SessionSnapshot): Promise<void> {
  for (const cookie of snapshot.cookies) {
    await chrome.cookies.set({
      url: snapshot.url,
      ...cookie,
    });
  }
  
  await bridge.send(tabId, 'SET_STORAGE', {
    local: snapshot.localStorage,
    session: snapshot.sessionStorage,
  });
  
  // Reload to apply
  await chrome.tabs.reload(tabId);
}
```

### 7.4 Performance Optimization Strategies

#### 7.4.1 DOM Context Building

**Problem:** Building full page context is expensive.

**Solution: Progressive Context Loading**

```typescript
// Level 0: Minimal (URL, title, viewport)
// Level 1: Interactive elements only
// Level 2: Full DOM structure
// Level 3: Include screenshot

async function buildContext(
  tabId: number, 
  level: 0 | 1 | 2 | 3 = 1
): Promise<PageContext> {
  switch (level) {
    case 0:
      return getMinimalContext(tabId);
    case 1:
      return getInteractiveContext(tabId); // Default
    case 2:
      return getFullDOMContext(tabId);
    case 3:
      const ctx = await getFullDOMContext(tabId);
      ctx.screenshot = await captureScreenshot(tabId, { quality: 50 });
      return ctx;
  }
}

// AI decides when to request more context
// "I need more information about the form structure"
// -> Trigger level 2 context
```

#### 7.4.2 Action Batching

```typescript
// Instead of executing one action at a time,
// batch compatible actions together

async function optimizeActionQueue(actions: Action[]): Promise<Action[][]> {
  const batches: Action[][] = [];
  let currentBatch: Action[] = [];
  
  for (const action of actions) {
    if (canBatch(currentBatch, action)) {
      currentBatch.push(action);
    } else {
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
      }
      currentBatch = [action];
    }
  }
  
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }
  
  return batches;
}

function canBatch(batch: Action[], action: Action): boolean {
  // Can batch non-dependent actions
  // e.g., multiple fills, multiple clicks on different elements
  const nonBlocking = ['fill', 'type', 'check', 'uncheck'];
  return (
    batch.every(a => nonBlocking.includes(a.type)) &&
    nonBlocking.includes(action.type) &&
    batch.length < 5
  );
}
```

#### 7.4.3 Service Worker Keep-Alive

**Problem:** MV3 service workers are ephemeral (30-second idle timeout).

**Solution:**

```typescript
// Keep-alive mechanism for long-running sessions
class ServiceWorkerKeepAlive {
  private intervalId: number | null = null;
  
  start(): void {
    // Chrome doesn't kill service worker with active alarms
    chrome.alarms.create('keepalive', { periodInMinutes: 0.4 }); // ~24 seconds
    
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === 'keepalive') {
        this.ping();
      }
    });
  }
  
  stop(): void {
    chrome.alarms.clear('keepalive');
  }
  
  private ping(): void {
    // Touch storage to keep alive
    chrome.storage.session.get('_keepalive');
  }
}

// Also use chrome.runtime.onConnect for long-running operations
function keepAliveWithPort(): chrome.runtime.Port {
  const port = chrome.runtime.connect({ name: 'keepalive' });
  port.onDisconnect.addListener(() => {
    // Reconnect if needed
    if (hasActiveSession()) {
      keepAliveWithPort();
    }
  });
  return port;
}
```

---

## 8. Limitations & Mitigations

### 8.1 Known Limitations

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| **Service Worker Ephemeral** | State loss on idle | Persist critical state to storage; use alarms for keep-alive |
| **No DOM Access in SW** | Can't directly manipulate DOM | Use content scripts; message passing |
| **CSP Restrictions** | Some sites block injected scripts | Fall back to chrome.debugger; user notification |
| **Cross-Origin Limits** | Can't access iframes from different origins | Use chrome.debugger for cross-origin; notify user |
| **File Downloads** | Can't download files directly | Use chrome.downloads API; user prompt |
| **Clipboard** | Limited clipboard access in SW | Use offscreen document |
| **Audio/Video** | No direct media access in SW | Use offscreen document |
| **Captcha** | Can't solve captchas automatically | Pause and request user intervention |

### 8.2 Site Compatibility Matrix

| Site Type | Compatibility | Notes |
|-----------|--------------|-------|
| Standard websites | ✅ Full | Works without issues |
| SPAs (React, Vue) | ✅ Full | May need waitForElement |
| Sites with CSP | ⚠️ Partial | May need debugger fallback |
| Banking/Financial | ⚠️ Partial | Often blocked; user must enable |
| Google properties | ⚠️ Partial | May have anti-automation |
| Chrome Web Store | ❌ Blocked | Extensions can't inject scripts |
| chrome:// pages | ❌ Blocked | Browser restriction |
| Local files | ⚠️ Partial | User must enable in extension settings |

### 8.3 Rate Limiting Strategy

```typescript
interface RateLimiter {
  // Per-provider rate limits
  limits: Map<AIProviderType, {
    requestsPerMinute: number;
    tokensPerMinute: number;
    currentRequests: number;
    currentTokens: number;
    resetAt: number;
  }>;
  
  // Check if we can make a request
  canRequest(provider: AIProviderType): boolean;
  
  // Record a request
  recordRequest(provider: AIProviderType, tokens: number): void;
  
  // Get time until rate limit resets
  getResetTime(provider: AIProviderType): number;
}

// Default limits (configurable)
const DEFAULT_LIMITS: Record<AIProviderType, { rpm: number; tpm: number }> = {
  claude: { rpm: 50, tpm: 100000 },
  openai: { rpm: 60, tpm: 90000 },
  gemini: { rpm: 60, tpm: 120000 },
  ollama: { rpm: 1000, tpm: Infinity }, // Local, no limits
  openrouter: { rpm: 60, tpm: 100000 },
  custom: { rpm: 60, tpm: 100000 },
};
```

---

## 9. Security Considerations

### 9.1 Threat Model

| Threat | Risk | Mitigation |
|--------|------|------------|
| **Malicious AI Response** | High | Sanitize all actions; blocklist dangerous patterns |
| **API Key Theft** | High | Encrypt keys; never log keys; secure storage |
| **XSS via Content Script** | Medium | Use DOMPurify; avoid innerHTML |
| **Data Exfiltration** | Medium | Audit all network requests; CSP |
| **Privilege Escalation** | Low | Minimal permissions; review before publish |

### 9.2 Action Sanitization

```typescript
class ActionSanitizer {
  private blockedPatterns = [
    // Dangerous JavaScript patterns
    /eval\s*\(/i,
    /Function\s*\(/i,
    /setTimeout\s*\(\s*['"`]/i,
    /document\.write/i,
    
    // Dangerous URLs
    /javascript:/i,
    /data:text\/html/i,
    
    // Credential harvesting
    /password/i, // in extract actions on login forms
  ];
  
  private blockedSelectors = [
    '[data-sensitive]',
    '.credit-card',
    '#ssn',
  ];
  
  sanitize(action: Action): Action {
    // Validate action structure
    this.validateStructure(action);
    
    // Check for dangerous patterns
    this.checkPatterns(action);
    
    // Sanitize specific action types
    switch (action.type) {
      case 'navigate':
        return this.sanitizeNavigate(action as NavigateAction);
      case 'evaluate':
        return this.sanitizeEvaluate(action as EvaluateAction);
      case 'extract':
        return this.sanitizeExtract(action as ExtractAction);
      default:
        return action;
    }
  }
  
  private sanitizeNavigate(action: NavigateAction): NavigateAction {
    const url = new URL(action.url);
    
    // Block dangerous protocols
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new ExtensionError(
        ErrorCode.ACTION_BLOCKED,
        `Blocked navigation to ${url.protocol} URL`
      );
    }
    
    return action;
  }
  
  private sanitizeEvaluate(action: EvaluateAction): EvaluateAction {
    for (const pattern of this.blockedPatterns) {
      if (pattern.test(action.script)) {
        throw new ExtensionError(
          ErrorCode.SCRIPT_BLOCKED,
          'Blocked potentially dangerous script'
        );
      }
    }
    
    return action;
  }
}
```

### 9.3 API Key Encryption

```typescript
// Use Web Crypto API for encryption
class KeyEncryption {
  private async deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(passphrase),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }
  
  async encrypt(apiKey: string, passphrase: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await this.deriveKey(passphrase, salt);
    
    const encoder = new TextEncoder();
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(apiKey)
    );
    
    // Combine salt + iv + encrypted
    const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    combined.set(salt, 0);
    combined.set(iv, salt.length);
    combined.set(new Uint8Array(encrypted), salt.length + iv.length);
    
    return btoa(String.fromCharCode(...combined));
  }
  
  async decrypt(encryptedData: string, passphrase: string): Promise<string> {
    const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
    
    const salt = combined.slice(0, 16);
    const iv = combined.slice(16, 28);
    const encrypted = combined.slice(28);
    
    const key = await this.deriveKey(passphrase, salt);
    
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      encrypted
    );
    
    return new TextDecoder().decode(decrypted);
  }
}
```

---

## 10. Future Roadmap

### 10.1 Phase 1: Core MVP (Weeks 1-4)

- [ ] Basic extension structure
- [ ] Single AI provider (Claude)
- [ ] Essential actions: navigate, click, fill, extract
- [ ] Simple chat UI in side panel
- [ ] Basic error handling

### 10.2 Phase 2: Enhanced Features (Weeks 5-8)

- [ ] Multiple AI providers
- [ ] Full action set
- [ ] Session management
- [ ] Action history & undo
- [ ] Visual element highlighting
- [ ] Screenshot support

### 10.3 Phase 3: Advanced (Weeks 9-12)

- [ ] chrome.debugger fallback
- [ ] Network interception
- [ ] Multi-tab workflows
- [ ] Workflow recording & playback
- [ ] Export/import sessions

### 10.4 Phase 4: Polish & Scale (Weeks 13-16)

- [ ] Performance optimization
- [ ] Comprehensive testing
- [ ] Documentation
- [ ] Chrome Web Store submission
- [ ] Firefox port (WebExtensions)

### 10.5 Future Ideas

- **Voice control:** Use Web Speech API for voice commands
- **Vision models:** Use screenshot + vision models for better understanding
- **Workflow marketplace:** Share and discover automation workflows
- **Team features:** Shared sessions, audit logs
- **Local AI:** Better Ollama integration for privacy

---

## Appendix A: Manifest.json

```json
{
  "manifest_version": 3,
  "name": "AI Browser Controller",
  "version": "1.0.0",
  "description": "Let AI control your browser - navigate, click, fill forms, and extract data autonomously",
  
  "permissions": [
    "activeTab",
    "scripting",
    "storage",
    "tabs",
    "sidePanel",
    "alarms",
    "offscreen"
  ],
  
  "optional_permissions": [
    "debugger",
    "cookies",
    "downloads",
    "webNavigation",
    "webRequest"
  ],
  
  "host_permissions": [
    "<all_urls>"
  ],
  
  "background": {
    "service_worker": "background/index.js",
    "type": "module"
  },
  
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content/index.js"],
      "run_at": "document_idle",
      "all_frames": true
    }
  ],
  
  "action": {
    "default_popup": "popup/index.html",
    "default_icon": {
      "16": "assets/icons/icon-16.png",
      "32": "assets/icons/icon-32.png",
      "48": "assets/icons/icon-48.png",
      "128": "assets/icons/icon-128.png"
    }
  },
  
  "side_panel": {
    "default_path": "sidepanel/index.html"
  },
  
  "icons": {
    "16": "assets/icons/icon-16.png",
    "32": "assets/icons/icon-32.png",
    "48": "assets/icons/icon-48.png",
    "128": "assets/icons/icon-128.png"
  },
  
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
  },
  
  "web_accessible_resources": [
    {
      "resources": ["content/inject.js"],
      "matches": ["<all_urls>"]
    }
  ]
}
```

---

## Appendix B: System Prompt Template

```typescript
const SYSTEM_PROMPT = `You are an AI browser automation assistant. You help users interact with web pages by generating precise commands.

## Your Capabilities
You can perform these actions on web pages:
- Navigate to URLs
- Click on buttons, links, and other elements
- Fill in forms (text inputs, dropdowns, checkboxes)
- Extract text and data from pages
- Scroll and wait for elements
- Take screenshots

## Response Format
Always respond with a JSON object containing:
{
  "thinking": "Your reasoning about what to do",
  "actions": [
    {
      "type": "action_type",
      "selector": { ... },
      ...action_params
    }
  ],
  "summary": "Brief description of what you're doing"
}

## Element Selection
Use these selector strategies (in order of preference):
1. text: Visible text content
2. ariaLabel: Accessibility label
3. placeholder: Input placeholder
4. testId: data-testid attribute
5. role: ARIA role
6. css: CSS selector (last resort)

## Current Page Context
The user will provide you with:
- Current URL and title
- List of interactive elements with their properties
- Form information
- Screenshot (if requested)

## Rules
1. Be precise with selectors - prefer text-based selection
2. Wait for elements before interacting when needed
3. Handle errors gracefully - suggest alternatives
4. Ask for clarification if the task is ambiguous
5. Never perform destructive actions without confirmation
6. Respect user privacy - don't extract sensitive data unnecessarily

## Example
User: "Click the login button"
Response:
{
  "thinking": "User wants to click login. I see a button with text 'Log in' in the navigation.",
  "actions": [
    {
      "type": "click",
      "selector": { "text": "Log in", "role": "button" },
      "description": "Click the Log in button"
    }
  ],
  "summary": "Clicking the Log in button"
}`;
```

---

## Appendix C: Glossary

| Term | Definition |
|------|------------|
| **Action** | A single browser operation (click, type, navigate, etc.) |
| **Bridge** | Message passing layer between service worker and content scripts |
| **Content Script** | JavaScript injected into web pages |
| **Context** | Page state information sent to AI for decision making |
| **MV3** | Manifest Version 3 (Chrome Extension API version) |
| **Orchestrator** | Component that coordinates AI responses and action execution |
| **Service Worker** | Background script that runs extension logic |
| **Session** | A conversation instance with AI + associated state |
| **Side Panel** | Chrome's persistent side panel UI |

---

**Document End**

*Last updated: 2026-03-05*
*Author: Tech Lead*
*Status: Ready for Review*
