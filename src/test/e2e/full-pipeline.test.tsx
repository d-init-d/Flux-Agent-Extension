import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
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
} {
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
    onEvent: vi.fn(() => () => undefined),
    isReady: vi.fn(async () => true),
  } as unknown as IServiceWorkerBridge & {
    send: ReturnType<typeof vi.fn>;
    ensureContentScript: ReturnType<typeof vi.fn>;
    sendOneWay: ReturnType<typeof vi.fn>;
  };
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

async function settleAsyncSideEffects(iterations: number = 1): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await act(async () => {
      await flushExtensionRequests();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
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

describe('Full pipeline E2E (U-16)', () => {
  // Suppress the React act() warnings that originate from the App bootstrap
  // async chain (hydrate → setInitialSessionCount → createSession → syncSession).
  // These are fire-and-forget promises inside useEffect and cannot be wrapped in
  // act() without refactoring production code. The warnings are harmless and do
  // not affect test correctness.
  let originalConsoleError: typeof console.error;

  beforeEach(async () => {
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
});
