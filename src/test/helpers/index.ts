/**
 * @module test-helpers
 * @description Shared test utilities, mock factories, and helper functions.
 *
 * Provides typed factory functions that produce valid mock objects matching
 * the project's TypeScript interfaces (from ARCHITECTURE.md).
 *
 * Usage:
 *   import { createMockTab, createMockSession, mockFetch } from '@/test/helpers';
 */

import { type ReactElement } from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';

// ============================================================================
// React Rendering Helpers
// ============================================================================

/**
 * Render a React component with all necessary providers (Zustand, React Query, etc.)
 *
 * Currently wraps the base `render` — providers will be added as the
 * UI layer is built out in later sprints.
 *
 * @param ui - The React element to render.
 * @param options - Additional render options.
 * @returns Testing Library render result.
 */
export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
): RenderResult {
  // TODO: Wrap with <QueryClientProvider> and Zustand context when UI is built
  return render(ui, { ...options });
}

// ============================================================================
// Chrome Tab Factories
// ============================================================================

/**
 * Create a mock `chrome.tabs.Tab` with sensible defaults.
 * All properties can be overridden.
 */
export function createMockTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id: 1,
    index: 0,
    windowId: 1,
    highlighted: true,
    active: true,
    pinned: false,
    incognito: false,
    url: 'https://example.com',
    title: 'Example Page',
    status: 'complete',
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    ...overrides,
  };
}

// ============================================================================
// Session Factories
// ============================================================================

/** Supported AI provider types (mirrors ARCHITECTURE.md) */
type AIProviderType = 'claude' | 'openai' | 'gemini' | 'ollama' | 'custom';

/** Session status (mirrors ARCHITECTURE.md) */
type SessionStatus = 'idle' | 'running' | 'paused' | 'error' | 'completed';

/** Minimal Session shape matching ARCHITECTURE.md */
interface MockSession {
  config: {
    id: string;
    name?: string;
    provider: AIProviderType;
    model: string;
    systemPrompt?: string;
    maxTurns?: number;
    timeout?: number;
  };
  status: SessionStatus;
  targetTabId: number | null;
  tabSnapshot: Array<{
    tabIndex: number;
    id: number;
    url: string;
    title: string;
    status: 'loading' | 'complete';
    isActive: boolean;
    isTarget: boolean;
  }>;
  messages: Array<{ role: string; content: string }>;
  currentTurn: number;
  actionHistory: Array<{
    action: { id: string; type: string };
    result: { actionId: string; success: boolean; duration: number };
    timestamp: number;
  }>;
  variables: Record<string, unknown>;
  startedAt: number;
  lastActivityAt: number;
  errorCount: number;
  lastError?: { message: string; action?: string; timestamp: number };
}

/**
 * Create a mock Session object matching the architecture spec.
 */
export function createMockSession(overrides: Partial<MockSession> = {}): MockSession {
  const now = Date.now();
  return {
    config: {
      id: 'session-test-001',
      name: 'Test Session',
      provider: 'claude',
      model: 'claude-sonnet-4-20250514',
      maxTurns: 20,
      timeout: 300_000,
      ...overrides.config,
    },
    status: 'idle',
    targetTabId: 1,
    tabSnapshot: [
      {
        tabIndex: 0,
        id: 1,
        url: 'https://example.com',
        title: 'Example Page',
        status: 'complete',
        isActive: true,
        isTarget: true,
      },
    ],
    messages: [],
    currentTurn: 0,
    actionHistory: [],
    variables: {},
    startedAt: now,
    lastActivityAt: now,
    errorCount: 0,
    ...overrides,
  };
}

// ============================================================================
// Action Factories
// ============================================================================

/** Minimal Action shape matching ARCHITECTURE.md BaseAction */
interface MockAction {
  id: string;
  type: string;
  description?: string;
  timeout?: number;
  optional?: boolean;
  retries?: number;
  [key: string]: unknown;
}

/**
 * Create a mock Action object. Type defaults to 'click'.
 */
export function createMockAction(overrides: Partial<MockAction> = {}): MockAction {
  return {
    id: `action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'click',
    description: 'Test action',
    timeout: 5000,
    optional: false,
    retries: 0,
    ...overrides,
  };
}

/**
 * Create a mock navigate action.
 */
export function createMockNavigateAction(
  url = 'https://example.com',
  overrides: Partial<MockAction> = {},
): MockAction {
  return createMockAction({
    type: 'navigate',
    description: `Navigate to ${url}`,
    url,
    ...overrides,
  });
}

/**
 * Create a mock ActionResult.
 */
export function createMockActionResult(
  overrides: Partial<{
    actionId: string;
    success: boolean;
    data: unknown;
    error: { code: string; message: string; recoverable: boolean };
    duration: number;
    screenshot: string;
  }> = {},
) {
  return {
    actionId: overrides.actionId ?? `action-${Date.now()}`,
    success: true,
    duration: 42,
    ...overrides,
  };
}

// ============================================================================
// Fetch Mock
// ============================================================================

/** Options for creating a mock fetch response */
interface MockFetchResponseInit {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: unknown;
  ok?: boolean;
}

/**
 * Create a mock `fetch` function that returns a predictable Response.
 *
 * @param responseInit - Response configuration.
 * @returns A `vi.fn()` mock of the global `fetch`.
 *
 * @example
 * ```ts
 * const fetchMock = mockFetch({ status: 200, body: { token: 'abc' } });
 * vi.stubGlobal('fetch', fetchMock);
 *
 * const res = await fetch('/api/login');
 * expect(res.ok).toBe(true);
 * expect(await res.json()).toEqual({ token: 'abc' });
 * ```
 */
export function mockFetch(responseInit: MockFetchResponseInit = {}) {
  const {
    status = 200,
    statusText = 'OK',
    headers = { 'Content-Type': 'application/json' },
    body = {},
    ok = status >= 200 && status < 300,
  } = responseInit;

  const mockResponse = {
    ok,
    status,
    statusText,
    headers: new Headers(headers),
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
    blob: vi.fn().mockResolvedValue(new Blob()),
    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    clone: vi.fn(function (this: typeof mockResponse) {
      return { ...this };
    }),
  };

  return vi.fn().mockResolvedValue(mockResponse);
}

/**
 * Create a mock fetch that returns different responses in sequence.
 *
 * @param responses - Array of response configs, served in order.
 * @returns A `vi.fn()` mock.
 *
 * @example
 * ```ts
 * const fetchMock = mockFetchSequence([
 *   { status: 429, body: { error: 'rate limit' } },
 *   { status: 200, body: { data: 'ok' } },
 * ]);
 * ```
 */
export function mockFetchSequence(responses: MockFetchResponseInit[]) {
  let callIndex = 0;

  return vi.fn().mockImplementation(() => {
    const config = responses[Math.min(callIndex++, responses.length - 1)];
    const {
      status = 200,
      statusText = 'OK',
      headers = { 'Content-Type': 'application/json' },
      body = {},
      ok = status >= 200 && status < 300,
    } = config;

    return Promise.resolve({
      ok,
      status,
      statusText,
      headers: new Headers(headers),
      json: vi.fn().mockResolvedValue(body),
      text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
      blob: vi.fn().mockResolvedValue(new Blob()),
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
      clone: vi.fn(),
    });
  });
}

// ============================================================================
// Async Helpers
// ============================================================================

/**
 * Wait for all pending promises / microtasks to flush.
 * Useful when testing code that uses `queueMicrotask` or chained promises.
 */
export function waitForAsync(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Wait for a specified number of milliseconds.
 *
 * @param ms - Milliseconds to wait.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Flush all pending timers (if using vi.useFakeTimers()).
 * Shortcut that advances timers and flushes microtasks.
 */
export async function flushTimers(): Promise<void> {
  vi.advanceTimersByTime(0);
  await waitForAsync();
}

// ============================================================================
// Storage Helpers
// ============================================================================

/**
 * Seed chrome.storage.local with data before a test.
 *
 * @param data - Key/value pairs to store.
 */
export async function seedStorage(
  data: Record<string, unknown>,
  area: 'local' | 'sync' | 'session' = 'local',
): Promise<void> {
  await chrome.storage[area].set(data);
}

/**
 * Read a single value from chrome.storage.local.
 */
export async function readStorage<T = unknown>(
  key: string,
  area: 'local' | 'sync' | 'session' = 'local',
): Promise<T | undefined> {
  const result = await chrome.storage[area].get(key);
  return result[key] as T | undefined;
}

// ============================================================================
// Error Assertion Helpers
// ============================================================================

/**
 * Assert that an async function throws an error with a specific message.
 *
 * @param fn - The async function to invoke.
 * @param expectedMessage - Substring that the error message must contain.
 */
export async function expectAsyncError(
  fn: () => Promise<unknown>,
  expectedMessage: string,
): Promise<void> {
  try {
    await fn();
    throw new Error(`Expected function to throw, but it resolved successfully.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    expect(message).toContain(expectedMessage);
  }
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export { createMockEvent, getCurrentMock, getMockStore } from '../mocks/chrome';
