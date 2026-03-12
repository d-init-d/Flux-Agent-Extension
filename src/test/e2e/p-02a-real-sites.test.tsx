import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IServiceWorkerBridge } from '@core/bridge';
import { AIClientManager } from '@core/ai-client';
import type { IAIProvider } from '@core/ai-client';
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
import { UISessionRuntime } from '../../background/ui-session-runtime';
import { App } from '../../sidepanel/App';
import { resetActionLogStore } from '../../sidepanel/store/actionLogStore';
import { resetChatStore } from '../../sidepanel/store/chatStore';
import { resetSessionStore } from '../../sidepanel/store/sessionStore';
import { ThemeProvider } from '../../ui/theme';
import { Logger } from '@shared/utils';

const extensionListeners = new Set<(message: ExtensionMessage) => void>();
const pendingExtensionRequests = new Set<Promise<unknown>>();
let activeRuntime: UISessionRuntime | null = null;

type MockTabsApi = typeof chrome.tabs & {
  _getTabs?: () => chrome.tabs.Tab[];
  _setTabs?: (tabs: chrome.tabs.Tab[]) => void;
};

interface SiteScenario {
  prompt: string;
  summary: string;
  pageContext: PageContext;
  actions: Action[];
  expectedExecutedActions: Array<Pick<Action, 'id' | 'type'>>;
  expectedActionLogEntries: string[];
}

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

    const request = activeRuntime.handleMessage(createExtensionMessage(type, payload)) as Promise<
      ExtensionResponse<ResponsePayloadMap[T]>
    >;

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
  pageContext: PageContext,
  actionHandler: (action: Action) => Promise<ActionResult>,
): IServiceWorkerBridge {
  const send = vi.fn(async (_tabId: number, type: string, payload: unknown) => {
    if (type === 'GET_PAGE_CONTEXT') {
      return { context: pageContext };
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
  } as unknown as IServiceWorkerBridge;
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

async function renderApp(): Promise<void> {
  await act(async () => {
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );
  });

  await settleAsyncSideEffects(3);
  await waitFor(() => {
    expect(screen.getByRole('combobox', { name: 'Active session' })).not.toHaveValue('');
  });
}

async function openActionLog(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Expand action log' }));
}

async function sendPrompt(user: ReturnType<typeof userEvent.setup>, prompt: string): Promise<void> {
  fireEvent.change(screen.getByRole('textbox', { name: 'Message input' }), {
    target: { value: prompt },
  });
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

function installNavigationCompletion(): void {
  const tabsApi = chrome.tabs as MockTabsApi;
  const baseUpdate = vi.mocked(chrome.tabs.update).getMockImplementation();

  vi.spyOn(chrome.tabs, 'update').mockImplementation(async (tabId, updateProperties) => {
    const response = baseUpdate
      ? await baseUpdate(tabId, updateProperties)
      : ({ id: tabId, url: updateProperties.url, status: 'loading' } as chrome.tabs.Tab);

    if (updateProperties.url) {
      setTimeout(() => {
        const completedUrl = updateProperties.url!;
        const nextTabs = (tabsApi._getTabs?.() ?? []).map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                url: completedUrl,
                status: 'complete',
              }
            : tab,
        );

        tabsApi._setTabs?.(nextTabs);
        chrome.tabs.onUpdated.dispatch(
          tabId,
          { status: 'complete', url: completedUrl },
          {
            ...(nextTabs.find((tab) => tab.id === tabId) ?? response),
            id: tabId,
            url: completedUrl,
            status: 'complete',
          },
        );
      }, 0);
    }

    return response;
  });
}

function createPageContext(base: Partial<PageContext>): PageContext {
  return {
    url: base.url ?? 'https://example.com',
    title: base.title ?? 'Example',
    summary: base.summary ?? 'Example page context',
    frame: base.frame ?? {
      frameId: 0,
      parentFrameId: null,
      url: base.url ?? 'https://example.com',
      origin: new URL(base.url ?? 'https://example.com').origin,
      name: 'main',
      isTop: true,
    },
    interactiveElements: base.interactiveElements ?? [],
    headings: base.headings ?? [],
    links: base.links ?? [],
    forms: base.forms ?? [],
    viewport: base.viewport ?? {
      width: 1440,
      height: 900,
      scrollX: 0,
      scrollY: 0,
      scrollHeight: 2400,
    },
  };
}

async function runScenario(scenario: SiteScenario): Promise<void> {
  const user = userEvent.setup();
  const actionHandler = vi.fn(
    async (action: Action): Promise<ActionResult> => ({
      actionId: action.id,
      success: true,
      duration: 8,
      data: { executed: true, type: action.type },
    }),
  );

  installNavigationCompletion();
  activeRuntime = new UISessionRuntime({
    bridge: createBridge(scenario.pageContext, actionHandler),
    logger: new Logger('FluxSW:p-02a-e2e', 'debug'),
    aiClientManager: createAIManager(
      JSON.stringify({
        summary: scenario.summary,
        actions: scenario.actions,
      }),
    ),
  });

  await renderApp();
  await sendPrompt(user, scenario.prompt);

  await waitFor(() => {
    expect(actionHandler).toHaveBeenCalledTimes(scenario.expectedExecutedActions.length);
  });

  expect(
    actionHandler.mock.calls.map(([action]) => ({ id: action.id, type: action.type })),
  ).toEqual(scenario.expectedExecutedActions);
  expect(await screen.findByText(scenario.prompt)).toBeInTheDocument();
  expect(await screen.findByText(scenario.summary)).toBeInTheDocument();

  await openActionLog(user);
  for (const entry of scenario.expectedActionLogEntries) {
    expect(await screen.findByText(entry)).toBeInTheDocument();
  }
}

describe('P-02a real-site E2E expansion', () => {
  let originalConsoleError: typeof console.error;

  beforeEach(async () => {
    originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      const message = typeof args[0] === 'string' ? args[0] : '';
      if (message.includes('inside a test was not wrapped in act')) {
        return;
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

  it('P-02a covers a Google search-to-result interaction', async () => {
    await runScenario({
      prompt: 'Search Google for Flux Agent Extension and open the Chrome Web Store result',
      summary: 'Google-style search UI executes a search flow and opens the expected result.',
      pageContext: createPageContext({
        url: 'https://www.google.com/search?q=flux+agent+extension',
        title: 'Flux Agent Extension - Google Search',
        summary: 'Google results page with a search box, search controls, and result links.',
        interactiveElements: [
          {
            index: 1,
            tag: 'textarea',
            text: '',
            type: 'search',
            role: 'combobox',
            placeholder: 'Search',
            ariaLabel: 'Search',
            isVisible: true,
            isEnabled: true,
            boundingBox: { x: 160, y: 24, width: 640, height: 46 },
          },
          {
            index: 2,
            tag: 'button',
            text: 'Google Search',
            type: 'submit',
            role: 'button',
            placeholder: undefined,
            ariaLabel: 'Google Search',
            isVisible: true,
            isEnabled: true,
            boundingBox: { x: 310, y: 92, width: 136, height: 36 },
          },
          {
            index: 3,
            tag: 'a',
            text: 'Flux Agent Extension - Chrome Web Store',
            type: undefined,
            role: 'link',
            placeholder: undefined,
            ariaLabel: 'Flux Agent Extension - Chrome Web Store',
            isVisible: true,
            isEnabled: true,
            boundingBox: { x: 180, y: 220, width: 420, height: 24 },
          },
        ],
        headings: [{ level: 1, text: 'Google' }],
      }),
      actions: [
        {
          id: 'google-fill-search',
          type: 'fill',
          selector: { role: 'combobox', ariaLabel: 'Search' },
          value: 'Flux Agent Extension',
          description: 'Fill the Google search box',
        },
        {
          id: 'google-submit-search',
          type: 'click',
          selector: { role: 'button', textExact: 'Google Search' },
          description: 'Submit the Google search',
        },
        {
          id: 'google-open-result',
          type: 'click',
          selector: { role: 'link', text: 'Flux Agent Extension - Chrome Web Store' },
          description: 'Open the Chrome Web Store result',
        },
      ],
      expectedExecutedActions: [
        { id: 'google-fill-search', type: 'fill' },
        { id: 'google-submit-search', type: 'click' },
        { id: 'google-open-result', type: 'click' },
      ],
      expectedActionLogEntries: [
        'Fill the Google search box',
        'Submit the Google search',
        'Open the Chrome Web Store result',
      ],
    });
  });

  it('P-02a covers an Amazon search-product-cart interaction', async () => {
    await runScenario({
      prompt: 'Search Amazon for a Logitech MX Master 3S and add the first matching item to cart',
      summary:
        'Amazon-style commerce UI executes search, product selection, and add-to-cart actions.',
      pageContext: createPageContext({
        url: 'https://www.amazon.com/s?k=mx+master+3s',
        title: 'Amazon.com : mx master 3s',
        summary:
          'Amazon search results with a department search box, product cards, and add-to-cart CTA.',
        interactiveElements: [
          {
            index: 1,
            tag: 'input',
            text: '',
            type: 'search',
            role: 'searchbox',
            placeholder: 'Search Amazon',
            ariaLabel: 'Search Amazon',
            isVisible: true,
            isEnabled: true,
            boundingBox: { x: 210, y: 16, width: 760, height: 42 },
          },
          {
            index: 2,
            tag: 'input',
            text: '',
            type: 'submit',
            role: 'button',
            placeholder: undefined,
            ariaLabel: 'Go',
            isVisible: true,
            isEnabled: true,
            boundingBox: { x: 975, y: 16, width: 44, height: 42 },
          },
          {
            index: 3,
            tag: 'a',
            text: 'Logitech MX Master 3S Wireless Mouse',
            type: undefined,
            role: 'link',
            placeholder: undefined,
            ariaLabel: 'Logitech MX Master 3S Wireless Mouse',
            isVisible: true,
            isEnabled: true,
            boundingBox: { x: 320, y: 260, width: 360, height: 22 },
          },
          {
            index: 4,
            tag: 'input',
            text: '',
            type: 'submit',
            role: 'button',
            placeholder: undefined,
            ariaLabel: 'Add to Cart',
            isVisible: true,
            isEnabled: true,
            boundingBox: { x: 1020, y: 410, width: 160, height: 38 },
          },
        ],
        headings: [{ level: 1, text: 'Results' }],
      }),
      actions: [
        {
          id: 'amazon-fill-search',
          type: 'fill',
          selector: { role: 'searchbox', ariaLabel: 'Search Amazon' },
          value: 'Logitech MX Master 3S',
          description: 'Fill the Amazon search box',
        },
        {
          id: 'amazon-submit-search',
          type: 'click',
          selector: { role: 'button', ariaLabel: 'Go' },
          description: 'Submit the Amazon search',
        },
        {
          id: 'amazon-open-product',
          type: 'click',
          selector: { role: 'link', text: 'Logitech MX Master 3S Wireless Mouse' },
          description: 'Open the first matching Amazon product',
        },
        {
          id: 'amazon-add-to-cart',
          type: 'click',
          selector: { role: 'button', ariaLabel: 'Add to Cart' },
          description: 'Add the product to cart',
        },
      ],
      expectedExecutedActions: [
        { id: 'amazon-fill-search', type: 'fill' },
        { id: 'amazon-submit-search', type: 'click' },
        { id: 'amazon-open-product', type: 'click' },
        { id: 'amazon-add-to-cart', type: 'click' },
      ],
      expectedActionLogEntries: [
        'Fill the Amazon search box',
        'Submit the Amazon search',
        'Open the first matching Amazon product',
        'Add the product to cart',
      ],
    });
  });

  it('P-02a covers GitHub repository navigation and tab interaction', async () => {
    await runScenario({
      prompt: 'Use GitHub search to open microsoft/playwright and switch to the Issues tab',
      summary:
        'GitHub-style repository UI executes search, repository navigation, and tab switching actions.',
      pageContext: createPageContext({
        url: 'https://github.com/search?q=playwright&type=repositories',
        title: 'Repository search results · GitHub',
        summary:
          'GitHub search and repository context with command palette search, repository links, and nav tabs.',
        interactiveElements: [
          {
            index: 1,
            tag: 'input',
            text: '',
            type: 'search',
            role: 'combobox',
            placeholder: 'Search or jump to...',
            ariaLabel: 'Search or jump to...',
            isVisible: true,
            isEnabled: true,
            boundingBox: { x: 280, y: 14, width: 272, height: 32 },
          },
          {
            index: 2,
            tag: 'a',
            text: 'microsoft/playwright',
            type: undefined,
            role: 'link',
            placeholder: undefined,
            ariaLabel: 'microsoft/playwright',
            isVisible: true,
            isEnabled: true,
            boundingBox: { x: 180, y: 236, width: 220, height: 20 },
          },
          {
            index: 3,
            tag: 'a',
            text: 'Issues',
            type: undefined,
            role: 'link',
            placeholder: undefined,
            ariaLabel: 'Issues',
            isVisible: true,
            isEnabled: true,
            boundingBox: { x: 268, y: 154, width: 78, height: 30 },
          },
        ],
        headings: [{ level: 1, text: 'Repository search results' }],
      }),
      actions: [
        {
          id: 'github-fill-search',
          type: 'fill',
          selector: { role: 'combobox', ariaLabel: 'Search or jump to...' },
          value: 'microsoft/playwright',
          description: 'Fill the GitHub search field',
        },
        {
          id: 'github-submit-search',
          type: 'press',
          selector: { role: 'combobox', ariaLabel: 'Search or jump to...' },
          key: 'Enter',
          description: 'Submit the GitHub search',
        },
        {
          id: 'github-open-repo',
          type: 'click',
          selector: { role: 'link', textExact: 'microsoft/playwright' },
          description: 'Open the microsoft/playwright repository',
        },
        {
          id: 'github-open-issues',
          type: 'click',
          selector: { role: 'link', textExact: 'Issues' },
          description: 'Open the Issues tab',
        },
      ],
      expectedExecutedActions: [
        { id: 'github-fill-search', type: 'fill' },
        { id: 'github-submit-search', type: 'press' },
        { id: 'github-open-repo', type: 'click' },
        { id: 'github-open-issues', type: 'click' },
      ],
      expectedActionLogEntries: [
        'Fill the GitHub search field',
        'Submit the GitHub search',
        'Open the microsoft/playwright repository',
        'Open the Issues tab',
      ],
    });
  });
});
