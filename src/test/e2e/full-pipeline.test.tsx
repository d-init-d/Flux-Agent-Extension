import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../ui/theme';
import { App } from '../../sidepanel/App';
import { resetActionLogStore } from '../../sidepanel/store/actionLogStore';
import { resetChatStore } from '../../sidepanel/store/chatStore';
import { resetSessionStore } from '../../sidepanel/store/sessionStore';
import { UISessionRuntime } from '../../background/ui-session-runtime';
import type { IServiceWorkerBridge } from '@core/bridge';
import { AIClientManager } from '@core/ai-client';
import type { IAIProvider } from '@core/ai-client';
import { Logger } from '@shared/utils';
import type {
  Action,
  ActionResult,
  AIMessage,
  AIModelConfig,
  AIRequestOptions,
  AIStreamChunk,
  ExtensionMessage,
  ExtensionResponse,
  PageContext,
  RequestPayloadMap,
  ResponsePayloadMap,
} from '@shared/types';

const extensionListeners = new Set<(message: ExtensionMessage) => void>();
const pendingExtensionRequests = new Set<Promise<unknown>>();
let activeRuntime: UISessionRuntime | null = null;

type MockTabsApi = typeof chrome.tabs & {
  _getTabs?: () => chrome.tabs.Tab[];
  _setTabs?: (tabs: chrome.tabs.Tab[]) => void;
};

function createExtensionMessage<T extends keyof RequestPayloadMap>(
  type: T,
  payload: RequestPayloadMap[T],
): ExtensionMessage<RequestPayloadMap[T]> {
  return {
    id: `msg-${type}-${Date.now()}`,
    channel: 'sidePanel',
    type,
    payload,
    timestamp: Date.now(),
  };
}

vi.mock('../../sidepanel/lib/extension-client', () => ({
  sendExtensionRequest: async <T extends keyof RequestPayloadMap>(
    type: T,
    payload: RequestPayloadMap[T],
  ): Promise<ResponsePayloadMap[T]> => {
    if (!activeRuntime) {
      throw new Error('Runtime is not initialized for E2E test');
    }

    const request = activeRuntime.handleMessage(
      createExtensionMessage(type, payload),
    ) as Promise<ExtensionResponse<ResponsePayloadMap[T]>>;

    pendingExtensionRequests.add(request);
    const response = await request.finally(() => {
      pendingExtensionRequests.delete(request);
    });

    if (!response.success) {
      throw new Error(response.error?.message ?? `Extension request ${type} failed`);
    }

    return response.data as ResponsePayloadMap[T];
  },
  subscribeToExtensionEvents: (handler: (message: ExtensionMessage) => void) => {
    extensionListeners.add(handler);
    return () => {
      extensionListeners.delete(handler);
    };
  },
}));

function createPageContext(): PageContext {
  return {
    url: 'https://example.com/app',
    title: 'Flux Demo App',
    summary: 'Demo page with form fields and submit buttons.',
    frame: {
      frameId: 0,
      parentFrameId: null,
      url: 'https://example.com/app',
      origin: 'https://example.com',
      name: 'main',
      isTop: true,
    },
    interactiveElements: [
      {
        index: 1,
        tag: 'input',
        text: '',
        type: 'email',
        role: 'textbox',
        placeholder: 'Email',
        ariaLabel: 'Email',
        isVisible: true,
        isEnabled: true,
        boundingBox: { x: 20, y: 40, width: 220, height: 40 },
      },
      {
        index: 2,
        tag: 'button',
        text: 'Login',
        type: 'button',
        role: 'button',
        placeholder: undefined,
        ariaLabel: 'Login',
        isVisible: true,
        isEnabled: true,
        boundingBox: { x: 20, y: 100, width: 120, height: 42 },
      },
      {
        index: 3,
        tag: 'button',
        text: 'Submit',
        type: 'button',
        role: 'button',
        placeholder: undefined,
        ariaLabel: 'Submit',
        isVisible: true,
        isEnabled: true,
        boundingBox: { x: 20, y: 160, width: 120, height: 42 },
      },
    ],
    headings: [{ level: 1, text: 'Flux Demo App' }],
    links: [],
    forms: [
      {
        action: '/login',
        method: 'post',
        fields: [
          {
            name: 'email',
            type: 'email',
            label: 'Email',
            required: true,
          },
        ],
      },
    ],
    viewport: {
      width: 1440,
      height: 900,
      scrollX: 0,
      scrollY: 0,
      scrollHeight: 1600,
    },
  };
}

class MockProvider implements IAIProvider {
  readonly name = 'openai' as const;
  readonly supportsVision = false;
  readonly supportsStreaming = true;
  readonly supportsFunctionCalling = false;

  constructor(private readonly responseText: string) {}

  async initialize(_config: AIModelConfig): Promise<void> {
    return undefined;
  }

  async *chat(
    _messages: AIMessage[],
    _options?: AIRequestOptions,
  ): AsyncGenerator<AIStreamChunk, void, unknown> {
    const midpoint = Math.max(1, Math.floor(this.responseText.length / 2));
    yield { type: 'text', content: this.responseText.slice(0, midpoint) };
    yield { type: 'text', content: this.responseText.slice(midpoint) };
  }

  async validateApiKey(_apiKey: string): Promise<boolean> {
    return true;
  }

  abort(): void {
    // no-op
  }
}

function createAIManager(responseText: string): AIClientManager {
  const manager = new AIClientManager({ autoFallback: false });
  manager.registerProvider(new MockProvider(responseText));
  return manager;
}

function createBridge(
  actionHandler: (action: Action) => Promise<ActionResult>,
): IServiceWorkerBridge & {
  send: ReturnType<typeof vi.fn>;
  ensureContentScript: ReturnType<typeof vi.fn>;
  sendOneWay: ReturnType<typeof vi.fn>;
  emitEvent: (type: string, tabId: number, frame: Record<string, unknown>, payload?: unknown) => void;
} {
  const eventHandlers = new Map<string, (tabId: number, frame: unknown, payload: unknown) => void>();
  const send = vi.fn(async (_tabId: number, type: string, payload: unknown) => {
    if (type === 'GET_PAGE_CONTEXT') {
      return { context: createPageContext() };
    }

    if (type === 'EXECUTE_ACTION') {
      const request = payload as RequestPayloadMap['ACTION_EXECUTE'];
      return { result: await actionHandler(request.action) };
    }

    throw new Error(`Unexpected bridge command: ${type}`);
  });

  return {
    send,
    ensureContentScript: vi.fn(async () => undefined),
    sendOneWay: vi.fn(),
    onEvent: vi.fn((type: string, handler: (tabId: number, frame: unknown, payload: unknown) => void) => {
      eventHandlers.set(type, handler);
      return () => {
        eventHandlers.delete(type);
      };
    }),
    isReady: vi.fn(async () => true),
    emitEvent: (type: string, tabId: number, frame: Record<string, unknown>, payload?: unknown) => {
      eventHandlers.get(type)?.(tabId, frame, payload);
    },
  } as unknown as IServiceWorkerBridge & {
    send: ReturnType<typeof vi.fn>;
    ensureContentScript: ReturnType<typeof vi.fn>;
    sendOneWay: ReturnType<typeof vi.fn>;
    emitEvent: (type: string, tabId: number, frame: Record<string, unknown>, payload?: unknown) => void;
  };
}

function createTopFrame(url: string = 'https://example.com/app'): Record<string, unknown> {
  return {
    tabId: 1,
    frameId: 0,
    documentId: 'main-doc',
    parentFrameId: null,
    url,
    origin: 'https://example.com',
    isTop: true,
  };
}

async function emitRecordedEvent(
  bridge: ReturnType<typeof createBridge>,
  type: 'RECORDED_CLICK' | 'RECORDED_INPUT' | 'RECORDED_NAVIGATION' | 'PAGE_LOADED',
  payload: unknown,
  frame: Record<string, unknown> = createTopFrame(),
  options: { useFakeTimers?: boolean } = {},
): Promise<void> {
  act(() => {
    bridge.emitEvent(type, 1, frame, payload);
  });
  await settleAsyncSideEffects(2, options);
}

async function renderApp(): Promise<void> {
  await act(async () => {
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );
  });

  await settleAsyncSideEffects(3);

  await waitForActiveSession();
}

async function flushExtensionRequests(): Promise<void> {
  while (pendingExtensionRequests.size > 0) {
    const pending = [...pendingExtensionRequests];
    await Promise.allSettled(pending);
  }
}

async function settleAsyncSideEffects(
  iterations: number = 1,
  options: { useFakeTimers?: boolean } = {},
): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await act(async () => {
      await flushExtensionRequests();
      await Promise.resolve();
      if (options.useFakeTimers) {
        await vi.advanceTimersByTimeAsync(0);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });
  }
}

async function advancePlaybackTime(milliseconds: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
    await flushExtensionRequests();
    await Promise.resolve();
  });

  await settleAsyncSideEffects(1, { useFakeTimers: true });
}

function installNavigationCompletion(url: string): void {
  const tabsApi = chrome.tabs as MockTabsApi;
  const baseUpdate = vi.mocked(chrome.tabs.update).getMockImplementation();

  vi.spyOn(chrome.tabs, 'update').mockImplementation(async (tabId, updateProperties) => {
    const response = baseUpdate
      ? await baseUpdate(tabId, updateProperties)
      : ({ id: tabId, url: updateProperties.url, status: 'loading' } as chrome.tabs.Tab);

    if (updateProperties.url === url) {
      setTimeout(() => {
        const existingTabs = tabsApi._getTabs?.() ?? [];
        const nextTabs = existingTabs.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                url,
                status: 'complete',
              }
            : tab,
        );

        tabsApi._setTabs?.(nextTabs);

        chrome.webNavigation.onCommitted.dispatch({
          tabId,
          frameId: 0,
          url,
          processId: 1,
          timeStamp: Date.now(),
          transitionQualifiers: [],
          transitionType: 'link',
        });
        chrome.webNavigation.onDOMContentLoaded.dispatch({
          tabId,
          frameId: 0,
          url,
          processId: 1,
          timeStamp: Date.now(),
        });
        chrome.tabs.onUpdated.dispatch(tabId, { status: 'complete', url }, {
          ...(nextTabs.find((tab) => tab.id === tabId) ?? response),
          id: tabId,
          url,
          status: 'complete',
        });
        chrome.webNavigation.onCompleted.dispatch({
          tabId,
          frameId: 0,
          url,
          processId: 1,
          timeStamp: Date.now(),
        });
      }, 0);
    }

    return response;
  });
}

async function waitForActiveSession(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByRole('combobox', { name: 'Active session' })).not.toHaveValue('');
  });
}

async function openActionLog(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Expand action log' }));
}

async function sendPrompt(user: ReturnType<typeof userEvent.setup>, prompt: string): Promise<void> {
  await user.type(screen.getByRole('textbox', { name: 'Message input' }), prompt);
  await user.click(screen.getByRole('button', { name: 'Send' }));
  await settleAsyncSideEffects(2);
}

function createSettings() {
  return {
    language: 'auto',
    theme: 'system',
    defaultProvider: 'openai',
    streamResponses: false,
    includeScreenshotsInContext: false,
    maxContextLength: 32_000,
    defaultTimeout: 30_000,
    autoRetryOnFailure: true,
    maxRetries: 1,
    screenshotOnError: true,
    allowCustomScripts: false,
    allowedDomains: [],
    blockedDomains: [],
    showFloatingBar: true,
    highlightElements: true,
    soundNotifications: false,
    debugMode: false,
    logNetworkRequests: false,
  };
}

function decodeDownloadTextUrl(url: string): string {
  const [, encodedContent = ''] = url.split(',', 2);
  return decodeURIComponent(encodedContent);
}

function extractEmbeddedRecording(script: string): {
  actionCount: number;
  exportedAt: string;
  actions: Array<{ action: Action; timestamp: number }>;
} {
  const prefix = 'const recording = ';
  const start = script.indexOf(prefix);
  const end = script.indexOf('\n\nfunction wildcardToRegExp', start);

  if (start === -1 || end === -1) {
    throw new Error('Unable to locate embedded recording payload in exported script');
  }

  return JSON.parse(script.slice(start + prefix.length, end).trim().replace(/;$/, '')) as {
    actionCount: number;
    exportedAt: string;
    actions: Array<{ action: Action; timestamp: number }>;
  };
}

describe('Full pipeline E2E (U-16)', () => {
  // Suppress the React act() warnings that originate from the App bootstrap
  // async chain (hydrate → setInitialSessionCount → createSession → syncSession).
  // These are fire-and-forget promises inside useEffect and cannot be wrapped in
  // act() without refactoring production code. The warnings are harmless and do
  // not affect test correctness.
  let originalConsoleError: typeof console.error;

  beforeEach(async () => {
    vi.useRealTimers();
    originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      const message = typeof args[0] === 'string' ? args[0] : '';
      if (message.includes('inside a test was not wrapped in act')) {
        return; // suppress act() warnings from App bootstrap
      }
      originalConsoleError.call(console, ...args);
    };

    extensionListeners.clear();
    pendingExtensionRequests.clear();
    activeRuntime = null;
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(async (message: unknown) => {
      const event = message as ExtensionMessage;
      if (event?.type?.startsWith('EVENT_')) {
        act(() => {
          for (const listener of extensionListeners) {
            listener(event);
          }
        });
      }

      return undefined;
    });

    await chrome.storage.local.set({
      settings: createSettings(),
      providers: {
        openai: {
          enabled: true,
          model: 'gpt-4o-mini',
          maxTokens: 4096,
          temperature: 0.2,
        },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    console.error = originalConsoleError;
    activeRuntime = null;
    extensionListeners.clear();
    pendingExtensionRequests.clear();
    cleanup();
    act(() => {
      resetSessionStore();
      resetChatStore();
      resetActionLogStore();
    });
  });

  it('U-16a navigates the current tab and updates the UI', async () => {
    const user = userEvent.setup();
    installNavigationCompletion('https://localhost/dashboard');
    const bridge = createBridge(async (action) => ({
      actionId: action.id,
      success: true,
      duration: 5,
    }));

    activeRuntime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:e2e', 'debug'),
      aiClientManager: createAIManager(
        JSON.stringify({
          summary: 'Navigate to the dashboard.',
          actions: [
            {
              type: 'navigate',
              url: 'https://localhost/dashboard',
              description: 'Navigate to the dashboard',
            },
          ],
        }),
      ),
    });

    await renderApp();
    await sendPrompt(user, 'Go to the dashboard');

    await waitFor(() => {
      expect(chrome.tabs.update).toHaveBeenCalledWith(1, { url: 'https://localhost/dashboard' });
    });

    expect(await screen.findByText('Go to the dashboard')).toBeInTheDocument();
    expect(await screen.findByText('Navigate to the dashboard.')).toBeInTheDocument();

    await openActionLog(user);
    expect(await screen.findByText('Navigate to the dashboard')).toBeInTheDocument();
  });

  it('U-16b fills a form field and updates the UI', async () => {
    const user = userEvent.setup();
    const actionHandler = vi.fn(async (action: Action): Promise<ActionResult> => ({
      actionId: action.id,
      success: true,
      duration: 11,
      data: { filled: true },
    }));
    const bridge = createBridge(actionHandler);

    activeRuntime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:e2e', 'debug'),
      aiClientManager: createAIManager(
        JSON.stringify({
          summary: 'Fill the email field with the requested value.',
          actions: [
            {
              type: 'fill',
              selector: { placeholder: 'Email' },
              value: 'user@example.com',
              description: 'Fill the Email field',
            },
          ],
        }),
      ),
    });

    await renderApp();
    await sendPrompt(user, 'Fill the email field with user@example.com');

    await waitFor(() => {
      expect(actionHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'fill',
          selector: { placeholder: 'Email' },
          value: 'user@example.com',
        }),
      );
    });

    expect(await screen.findByText('Fill the email field with user@example.com')).toBeInTheDocument();
    expect(await screen.findByText('Fill the email field with the requested value.')).toBeInTheDocument();

    await openActionLog(user);
    expect(await screen.findByText('Fill the Email field')).toBeInTheDocument();
  });

  it('U-16c clicks an element and updates the UI', async () => {
    const user = userEvent.setup();
    const actionHandler = vi.fn(async (action: Action): Promise<ActionResult> => ({
      actionId: action.id,
      success: true,
      duration: 8,
      data: { clicked: true },
    }));
    const bridge = createBridge(actionHandler);

    activeRuntime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:e2e', 'debug'),
      aiClientManager: createAIManager(
        JSON.stringify({
          summary: 'Click the Login button.',
          actions: [
            {
              type: 'click',
              selector: { role: 'button', textExact: 'Login' },
              description: 'Click the Login button',
            },
          ],
        }),
      ),
    });

    await renderApp();
    await sendPrompt(user, 'Click the login button');

    await waitFor(() => {
      expect(actionHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'click',
          selector: { role: 'button', textExact: 'Login' },
        }),
      );
    });

    expect(await screen.findByText('Click the login button')).toBeInTheDocument();
    expect(await screen.findByText('Click the Login button.')).toBeInTheDocument();

    await openActionLog(user);
    expect(await screen.findByText('Click the Login button')).toBeInTheDocument();
  });

  it('U-16d retries a recoverable failure and still completes the pipeline', async () => {
    const user = userEvent.setup();
    const actionHandler = vi.fn(async (_action: Action): Promise<ActionResult> => ({
      actionId: 'retry-click',
      success: true,
      duration: 7,
      data: { clicked: true },
    }));

    actionHandler.mockResolvedValueOnce({
        actionId: 'retry-click',
        success: false,
        duration: 10,
        error: {
          code: 'ELEMENT_NOT_FOUND',
          message: 'Login button not ready yet',
          recoverable: true,
        },
      })
      .mockResolvedValueOnce({
        actionId: 'retry-click',
        success: true,
        duration: 7,
        data: { clicked: true },
      });
    const bridge = createBridge(actionHandler);

    activeRuntime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:e2e', 'debug'),
      aiClientManager: createAIManager(
        JSON.stringify({
          summary: 'Retry the Login button click until it succeeds.',
          actions: [
            {
              id: 'retry-click',
              type: 'click',
              selector: { role: 'button', textExact: 'Login' },
              description: 'Click the Login button',
            },
          ],
        }),
      ),
    });

    await renderApp();
    await sendPrompt(user, 'Click the login button even if it takes one retry');

    await waitFor(() => {
      expect(actionHandler).toHaveBeenCalledTimes(2);
    });

    expect(
      await screen.findByText('Click the login button even if it takes one retry'),
    ).toBeInTheDocument();

    await openActionLog(user);
    expect(await screen.findByText('Click the Login button')).toBeInTheDocument();
    expect(screen.queryByText('Request failed')).not.toBeInTheDocument();
  });

  it('A-08a records a full click-input-pause-resume-stop flow through the sidepanel UI', async () => {
    const user = userEvent.setup();
    const bridge = createBridge(async (action) => ({
      actionId: action.id,
      success: true,
      duration: 5,
    }));

    activeRuntime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:e2e', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}'),
    });

    await renderApp();

    const sessionSelect = screen.getByRole('combobox', { name: 'Active session' }) as HTMLSelectElement;
    const sessionId = sessionSelect.value;
    expect(sessionId).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Start recording' }));

    await waitFor(() => {
      expect(screen.getByTestId('recording-live-indicator')).toHaveTextContent('Live');
    });
    expect(screen.getByText('0 actions captured so far. New browser steps will keep syncing into this session.')).toBeInTheDocument();

    await emitRecordedEvent(bridge, 'RECORDED_CLICK', {
      action: {
        id: 'recorded-click-1',
        type: 'click',
        selector: { testId: 'login-button' },
      },
    });
    await emitRecordedEvent(bridge, 'RECORDED_INPUT', {
      action: {
        id: 'recorded-input-1',
        type: 'fill',
        selector: { testId: 'email-field' },
        value: 'alice@example.com',
      },
    });

    await waitFor(() => {
      expect(screen.getByText('2 actions captured so far. New browser steps will keep syncing into this session.')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => {
      expect(screen.getByText('Paused')).toBeInTheDocument();
    });

    await emitRecordedEvent(bridge, 'RECORDED_CLICK', {
      action: {
        id: 'recorded-click-paused',
        type: 'click',
        selector: { testId: 'ignored-while-paused' },
      },
    });

    expect(screen.getByText('2 actions captured. Resume when you want to keep collecting steps.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => {
      expect(screen.getByTestId('recording-live-indicator')).toHaveTextContent('Live');
    });

    await emitRecordedEvent(bridge, 'RECORDED_CLICK', {
      action: {
        id: 'recorded-click-2',
        type: 'click',
        selector: { testId: 'submit-button' },
      },
    });

    expect(screen.getByText('3 actions captured so far. New browser steps will keep syncing into this session.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start recording' })).toBeInTheDocument();
    });
    expect(screen.getByText('3 actions captured in this session. Start again to continue recording.')).toBeInTheDocument();

    const stateResponse = await activeRuntime.handleMessage(
      createExtensionMessage('SESSION_GET_STATE', { sessionId: sessionId! }),
    );
    expect(stateResponse.success).toBe(true);
    expect(stateResponse.data?.session?.recording.status).toBe('idle');
    expect(stateResponse.data?.session?.recording.actions.map((entry) => entry.action.id)).toEqual([
      'recorded-click-1',
      'recorded-input-1',
      'recorded-click-2',
    ]);
  });

  it('A-08b records navigation events only while active and appends again after resume', async () => {
    const user = userEvent.setup();
    const bridge = createBridge(async (action) => ({
      actionId: action.id,
      success: true,
      duration: 5,
    }));

    activeRuntime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:e2e', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}'),
    });

    await renderApp();

    const sessionId = (screen.getByRole('combobox', { name: 'Active session' }) as HTMLSelectElement).value;
    expect(sessionId).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Start recording' }));

    await emitRecordedEvent(
      bridge,
      'RECORDED_NAVIGATION',
      {
        action: {
          id: 'recorded-navigation-1',
          type: 'navigate',
          url: 'https://example.com/dashboard',
        },
      },
      createTopFrame('https://example.com/app'),
    );

    await waitFor(() => {
      expect(screen.getByText('1 action captured so far. New browser steps will keep syncing into this session.')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => {
      expect(screen.getByText('Paused')).toBeInTheDocument();
    });

    await emitRecordedEvent(
      bridge,
      'PAGE_LOADED',
      {
        url: 'https://example.com/ignored-during-pause',
        title: 'Ignored during pause',
        isTop: true,
      },
      createTopFrame('https://example.com/ignored-during-pause'),
    );

    expect(screen.getByText('1 action captured. Resume when you want to keep collecting steps.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Resume' }));

    await emitRecordedEvent(
      bridge,
      'PAGE_LOADED',
      {
        url: 'https://example.com/orders',
        title: 'Orders',
        isTop: true,
      },
      createTopFrame('https://example.com/orders'),
    );

    await waitFor(() => {
      expect(screen.getByText('2 actions captured so far. New browser steps will keep syncing into this session.')).toBeInTheDocument();
    });

    const stateResponse = await activeRuntime.handleMessage(
      createExtensionMessage('SESSION_GET_STATE', { sessionId: sessionId! }),
    );
    expect(stateResponse.success).toBe(true);
    expect(stateResponse.data?.session?.recording.actions.map((entry) => entry.action)).toEqual([
      expect.objectContaining({ id: 'recorded-navigation-1', type: 'navigate', url: 'https://example.com/dashboard' }),
      expect.objectContaining({ type: 'navigate', url: 'https://example.com/orders' }),
    ]);
  });

  it('A-09a replays a recorded click-fill-click flow with deterministic timing, pause, and resume', async () => {
    const actionHandler = vi.fn(async (action: Action): Promise<ActionResult> => ({
      actionId: action.id,
      success: true,
      duration: 5,
      data: action.type === 'fill' ? { filled: true } : { clicked: true },
    }));
    const bridge = createBridge(actionHandler);

    activeRuntime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:e2e', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}'),
    });

    await renderApp();

    const sessionId = (screen.getByRole('combobox', { name: 'Active session' }) as HTMLSelectElement).value;
    expect(sessionId).toBeTruthy();

    const recordedAt = {
      first: Date.parse('2026-03-09T00:00:00.000Z'),
      second: Date.parse('2026-03-09T00:00:01.000Z'),
      third: Date.parse('2026-03-09T00:00:03.000Z'),
      playbackStart: Date.parse('2026-03-09T00:00:04.000Z'),
    };
    const dateNowSpy = vi.spyOn(Date, 'now');

    fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
    await settleAsyncSideEffects(1);

    dateNowSpy.mockReturnValue(recordedAt.first);
    await emitRecordedEvent(bridge, 'RECORDED_CLICK', {
      action: {
        id: 'playback-click-1',
        type: 'click',
        selector: { testId: 'login-button' },
      },
    });

    dateNowSpy.mockReturnValue(recordedAt.second);
    await emitRecordedEvent(bridge, 'RECORDED_INPUT', {
      action: {
        id: 'playback-fill-1',
        type: 'fill',
        selector: { testId: 'email-field' },
        value: 'alice@example.com',
      },
    });

    dateNowSpy.mockReturnValue(recordedAt.third);
    await emitRecordedEvent(bridge, 'RECORDED_CLICK', {
      action: {
        id: 'playback-click-2',
        type: 'click',
        selector: { testId: 'submit-button' },
      },
    });

    expect(screen.getByText('3 actions captured so far. New browser steps will keep syncing into this session.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await settleAsyncSideEffects(1);

    expect(screen.getByText('Ready to replay 3 actions from the start.')).toBeInTheDocument();
    expect(screen.getByText('0 / 3 actions')).toBeInTheDocument();

    const recordedState = await activeRuntime.handleMessage(
      createExtensionMessage('SESSION_GET_STATE', { sessionId }),
    );
    expect(recordedState.success).toBe(true);
    expect(recordedState.data?.session?.recording.actions.map((entry) => entry.action.id)).toEqual([
      'playback-click-1',
      'playback-fill-1',
      'playback-click-2',
    ]);

    dateNowSpy.mockRestore();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(recordedAt.playbackStart));

    fireEvent.change(screen.getByRole('combobox', { name: 'Playback speed' }), {
      target: { value: '2' },
    });
    await settleAsyncSideEffects(1, { useFakeTimers: true });
    expect(screen.getByRole('combobox', { name: 'Playback speed' })).toHaveValue('2');

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    await settleAsyncSideEffects(1, { useFakeTimers: true });

    await advancePlaybackTime(0);
    expect(actionHandler).toHaveBeenCalledTimes(1);
    expect(actionHandler.mock.calls.map(([action]) => action.id)).toEqual(['playback-click-1']);
    expect(screen.getByText('Playing')).toBeInTheDocument();
    expect(screen.getByText('Playing step 2 of 3 at 2x.')).toBeInTheDocument();
    expect(screen.getByText('1 / 3 actions')).toBeInTheDocument();

    await advancePlaybackTime(499);
    expect(actionHandler).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await settleAsyncSideEffects(2, { useFakeTimers: true });

    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(screen.getByText('Paused on step 2 of 3 at 2x.')).toBeInTheDocument();
    expect(screen.getByText('1 / 3 actions')).toBeInTheDocument();

    await advancePlaybackTime(5_000);
    expect(actionHandler).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByRole('combobox', { name: 'Playback speed' }), {
      target: { value: '0.5' },
    });
    await settleAsyncSideEffects(1, { useFakeTimers: true });
    expect(screen.getByRole('combobox', { name: 'Playback speed' })).toHaveValue('0.5');

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await settleAsyncSideEffects(1, { useFakeTimers: true });

    await advancePlaybackTime(1_999);
    expect(actionHandler).toHaveBeenCalledTimes(1);

    await advancePlaybackTime(1);
    expect(actionHandler).toHaveBeenCalledTimes(2);
    expect(actionHandler.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        id: 'playback-fill-1',
        type: 'fill',
        selector: { testId: 'email-field' },
        value: 'alice@example.com',
      }),
    );
    expect(screen.getByText('Playing step 3 of 3 at 0.5x.')).toBeInTheDocument();
    expect(screen.getByText('2 / 3 actions')).toBeInTheDocument();

    await advancePlaybackTime(3_999);
    expect(actionHandler).toHaveBeenCalledTimes(2);

    await advancePlaybackTime(1);
    expect(actionHandler).toHaveBeenCalledTimes(3);
    expect(actionHandler.mock.calls.map(([action]) => action.id)).toEqual([
      'playback-click-1',
      'playback-fill-1',
      'playback-click-2',
    ]);
    expect(screen.getByText('Finished')).toBeInTheDocument();
    expect(screen.getByText('Playback finished for 3 actions. You can replay it from the start.')).toBeInTheDocument();
    expect(screen.getByText('3 / 3 actions')).toBeInTheDocument();

    const finishedState = await activeRuntime.handleMessage(
      createExtensionMessage('SESSION_GET_STATE', { sessionId }),
    );
    expect(finishedState.success).toBe(true);
    expect(finishedState.data?.session?.playback).toEqual(
      expect.objectContaining({
        status: 'idle',
        nextActionIndex: 3,
        speed: 0.5,
        lastError: null,
      }),
    );
  });

  it('A-09b stops playback from the UI and resets progress back to the start', async () => {
    const actionHandler = vi.fn(async (action: Action): Promise<ActionResult> => ({
      actionId: action.id,
      success: true,
      duration: 5,
    }));
    const bridge = createBridge(actionHandler);

    activeRuntime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:e2e', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}'),
    });

    await renderApp();

    const sessionId = (screen.getByRole('combobox', { name: 'Active session' }) as HTMLSelectElement).value;
    expect(sessionId).toBeTruthy();

    const recordedAt = {
      first: Date.parse('2026-03-09T01:00:00.000Z'),
      second: Date.parse('2026-03-09T01:00:01.000Z'),
      playbackStart: Date.parse('2026-03-09T01:00:02.000Z'),
    };
    const dateNowSpy = vi.spyOn(Date, 'now');

    fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
    await settleAsyncSideEffects(1);

    dateNowSpy.mockReturnValue(recordedAt.first);
    await emitRecordedEvent(bridge, 'RECORDED_CLICK', {
      action: {
        id: 'stop-click-1',
        type: 'click',
        selector: { testId: 'open-menu' },
      },
    });

    dateNowSpy.mockReturnValue(recordedAt.second);
    await emitRecordedEvent(bridge, 'RECORDED_INPUT', {
      action: {
        id: 'stop-fill-1',
        type: 'fill',
        selector: { testId: 'search-field' },
        value: 'Flux',
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await settleAsyncSideEffects(1);
    expect(screen.getByText('Ready to replay 2 actions from the start.')).toBeInTheDocument();

    dateNowSpy.mockRestore();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(recordedAt.playbackStart));

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    await settleAsyncSideEffects(1, { useFakeTimers: true });

    await advancePlaybackTime(0);
    expect(actionHandler).toHaveBeenCalledTimes(1);
    expect(actionHandler.mock.calls.map(([action]) => action.id)).toEqual(['stop-click-1']);
    expect(screen.getByText('Playing step 2 of 2 at 1x.')).toBeInTheDocument();
    expect(screen.getByText('1 / 2 actions')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await settleAsyncSideEffects(2, { useFakeTimers: true });

    expect(screen.getByText('Ready to replay 2 actions from the start.')).toBeInTheDocument();
    expect(screen.getByText('0 / 2 actions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled();

    await advancePlaybackTime(5_000);
    expect(actionHandler).toHaveBeenCalledTimes(1);

    const stoppedState = await activeRuntime.handleMessage(
      createExtensionMessage('SESSION_GET_STATE', { sessionId }),
    );
    expect(stoppedState.success).toBe(true);
    expect(stoppedState.data?.session?.playback).toEqual(
      expect.objectContaining({
        status: 'idle',
        nextActionIndex: 0,
        speed: 1,
        startedAt: null,
      }),
    );
  });

  it('A-10a records navigate-click-fill steps and exports ordered JSON from the sidepanel', async () => {
    const user = userEvent.setup();
    const bridge = createBridge(async (action) => ({
      actionId: action.id,
      success: true,
      duration: 5,
    }));

    activeRuntime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:e2e', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}'),
    });

    await renderApp();

    const sessionId = (screen.getByRole('combobox', { name: 'Active session' }) as HTMLSelectElement).value;
    expect(sessionId).toBeTruthy();

    const recordedAt = {
      navigate: Date.parse('2026-03-09T01:00:00.000Z'),
      click: Date.parse('2026-03-09T01:00:01.250Z'),
      fill: Date.parse('2026-03-09T01:00:03.500Z'),
      exportAt: Date.parse('2026-03-09T01:00:10.000Z'),
    };
    const dateNowSpy = vi.spyOn(Date, 'now');

    await user.click(screen.getByRole('button', { name: 'Start recording' }));

    dateNowSpy.mockReturnValue(recordedAt.navigate);
    await emitRecordedEvent(bridge, 'RECORDED_NAVIGATION', {
      action: {
        id: 'export-nav-1',
        type: 'navigate',
        url: 'https://example.com/checkout?step=shipping',
      },
    });

    dateNowSpy.mockReturnValue(recordedAt.click);
    await emitRecordedEvent(bridge, 'RECORDED_CLICK', {
      action: {
        id: 'export-click-1',
        type: 'click',
        selector: { role: 'button', textExact: 'Continue' },
      },
    });

    dateNowSpy.mockReturnValue(recordedAt.fill);
    await emitRecordedEvent(bridge, 'RECORDED_INPUT', {
      action: {
        id: 'export-fill-1',
        type: 'fill',
        selector: { placeholder: 'Email' },
        value: 'qa@example.com',
      },
    });

    await waitFor(() => {
      expect(screen.getByText('3 actions captured so far. New browser steps will keep syncing into this session.')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => {
      expect(screen.getByText('Ready to replay 3 actions from the start.')).toBeInTheDocument();
    });

    dateNowSpy.mockRestore();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(recordedAt.exportAt));
    vi.mocked(chrome.downloads.download).mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await settleAsyncSideEffects(2, { useFakeTimers: true });

    expect(chrome.downloads.download).toHaveBeenCalledTimes(1);
    const downloadCall = vi.mocked(chrome.downloads.download).mock.calls[0]?.[0];
    expect(downloadCall).toEqual(
      expect.objectContaining({
        url: expect.stringContaining('data:application/json;charset=utf-8,'),
        filename: expect.stringMatching(/^recording-.+-json-2026-03-09T01-00-10-000Z\.json$/),
        saveAs: false,
      }),
    );

    const jsonExport = JSON.parse(decodeDownloadTextUrl(downloadCall?.url ?? '')) as {
      sessionId: string;
      actionCount: number;
      recordingStatus: string;
      exportedAt: string;
      actions: Array<{ action: Action; timestamp: number }>;
    };

    expect(jsonExport).toEqual(
      expect.objectContaining({
        sessionId,
        actionCount: 3,
        recordingStatus: 'idle',
        exportedAt: '2026-03-09T01:00:10.000Z',
      }),
    );
    expect(jsonExport.actions.map((entry) => entry.action)).toEqual([
      expect.objectContaining({
        id: 'export-nav-1',
        type: 'navigate',
        url: 'https://example.com/checkout?step=shipping',
      }),
      expect.objectContaining({
        id: 'export-click-1',
        type: 'click',
        selector: { role: 'button', textExact: 'Continue' },
      }),
      expect.objectContaining({
        id: 'export-fill-1',
        type: 'fill',
        selector: { placeholder: 'Email' },
        value: 'qa@example.com',
      }),
    ]);
    expect(jsonExport.actions.map((entry) => entry.timestamp)).toEqual([
      recordedAt.navigate,
      recordedAt.click,
      recordedAt.fill,
    ]);
  });

  it('A-10b exports a Playwright script with escaped recorded input and replay timing logic', async () => {
    const user = userEvent.setup();
    const bridge = createBridge(async (action) => ({
      actionId: action.id,
      success: true,
      duration: 5,
    }));

    activeRuntime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:e2e', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}'),
    });

    await renderApp();

    const recordedAt = {
      navigate: Date.parse('2026-03-09T02:30:00.000Z'),
      click: Date.parse('2026-03-09T02:30:01.500Z'),
      fill: Date.parse('2026-03-09T02:30:04.000Z'),
      exportAt: Date.parse('2026-03-09T02:30:10.000Z'),
    };
    const specialValue = 'Line 1 "quoted" \\\\ path\nLine 2';
    const dateNowSpy = vi.spyOn(Date, 'now');

    await user.click(screen.getByRole('button', { name: 'Start recording' }));

    dateNowSpy.mockReturnValue(recordedAt.navigate);
    await emitRecordedEvent(bridge, 'RECORDED_NAVIGATION', {
      action: {
        id: 'export-script-nav',
        type: 'navigate',
        url: 'https://example.com/profile',
      },
    });

    dateNowSpy.mockReturnValue(recordedAt.click);
    await emitRecordedEvent(bridge, 'RECORDED_CLICK', {
      action: {
        id: 'export-script-click',
        type: 'click',
        selector: { testId: 'notes-toggle' },
      },
    });

    dateNowSpy.mockReturnValue(recordedAt.fill);
    await emitRecordedEvent(bridge, 'RECORDED_INPUT', {
      action: {
        id: 'export-script-fill',
        type: 'fill',
        selector: { ariaLabel: 'Notes', placeholder: 'Notes' },
        value: specialValue,
      },
    });

    await waitFor(() => {
      expect(screen.getByText('3 actions captured so far. New browser steps will keep syncing into this session.')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => {
      expect(screen.getByText('Ready to replay 3 actions from the start.')).toBeInTheDocument();
    });

    dateNowSpy.mockRestore();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(recordedAt.exportAt));
    vi.mocked(chrome.downloads.download).mockClear();

    fireEvent.change(screen.getByRole('combobox', { name: 'Recording export format' }), {
      target: { value: 'playwright' },
    });
    await settleAsyncSideEffects(1, { useFakeTimers: true });

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await settleAsyncSideEffects(2, { useFakeTimers: true });

    expect(chrome.downloads.download).toHaveBeenCalledTimes(1);
    const downloadCall = vi.mocked(chrome.downloads.download).mock.calls[0]?.[0];
    expect(downloadCall).toEqual(
      expect.objectContaining({
        url: expect.stringContaining('data:text/javascript;charset=utf-8,'),
        filename: expect.stringMatching(/^recording-.+-playwright-2026-03-09T02-30-10-000Z\.js$/),
        saveAs: false,
      }),
    );

    const playwrightScript = decodeDownloadTextUrl(downloadCall?.url ?? '');
    const embeddedRecording = extractEmbeddedRecording(playwrightScript);

    expect(playwrightScript).toContain("const { chromium } = require('playwright');");
    expect(playwrightScript).toContain('function getDelayMs(actions, index)');
    expect(playwrightScript).toContain('return Math.max(0, actions[index].timestamp - actions[index - 1].timestamp);');
    expect(playwrightScript).toContain('await page.waitForTimeout(delayMs);');
    expect(playwrightScript).toContain(JSON.stringify(specialValue));
    expect(embeddedRecording.actionCount).toBe(3);
    expect(embeddedRecording.exportedAt).toBe('2026-03-09T02:30:10.000Z');
    expect(embeddedRecording.actions.map((entry) => entry.action)).toEqual([
      expect.objectContaining({
        id: 'export-script-nav',
        type: 'navigate',
        url: 'https://example.com/profile',
      }),
      expect.objectContaining({
        id: 'export-script-click',
        type: 'click',
        selector: { testId: 'notes-toggle' },
      }),
      expect.objectContaining({
        id: 'export-script-fill',
        type: 'fill',
        selector: { ariaLabel: 'Notes', placeholder: 'Notes' },
        value: specialValue,
      }),
    ]);
    expect(embeddedRecording.actions.map((entry) => entry.timestamp)).toEqual([
      recordedAt.navigate,
      recordedAt.click,
      recordedAt.fill,
    ]);
  });
});
