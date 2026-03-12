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
  ExtensionSettings,
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

interface MockProviderOptions {
  responseText: string;
  chunkDelayMs?: number;
  onChat?: (messages: AIMessage[]) => void;
}

interface BridgeOptions {
  pageContext: PageContext;
  actionHandler: (action: Action) => Promise<ActionResult>;
  getPageContextError?: Error;
  getPageContextDelayMs?: number;
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

class MockProvider implements IAIProvider {
  readonly name = 'openai' as const;
  readonly supportsVision = false;
  readonly supportsStreaming = true;
  readonly supportsFunctionCalling = false;

  constructor(private readonly options: MockProviderOptions) {}

  async initialize(_config: AIModelConfig): Promise<void> {
    return undefined;
  }

  async *chat(
    messages: AIMessage[],
    _options?: AIRequestOptions,
  ): AsyncGenerator<AIStreamChunk, void, unknown> {
    this.options.onChat?.(messages);

    const parts = 3;
    const segmentLength = Math.max(1, Math.ceil(this.options.responseText.length / parts));

    for (let index = 0; index < this.options.responseText.length; index += segmentLength) {
      if (this.options.chunkDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, this.options.chunkDelayMs));
      }

      yield {
        type: 'text',
        content: this.options.responseText.slice(index, index + segmentLength),
      };
    }
  }

  async validateApiKey(_apiKey: string): Promise<boolean> {
    return true;
  }

  abort(): void {
    // no-op
  }
}

function createAIManager(options: MockProviderOptions): AIClientManager {
  const manager = new AIClientManager({ autoFallback: false });
  manager.registerProvider(new MockProvider(options));
  return manager;
}

function createBridge(options: BridgeOptions): IServiceWorkerBridge {
  const send = vi.fn(async (_tabId: number, type: string, payload: unknown) => {
    if (type === 'GET_PAGE_CONTEXT') {
      if (options.getPageContextError) {
        throw options.getPageContextError;
      }

      if (options.getPageContextDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.getPageContextDelayMs));
      }

      return { context: options.pageContext };
    }

    if (type === 'EXECUTE_ACTION') {
      const request = payload as RequestPayloadMap['ACTION_EXECUTE'];
      return { result: await options.actionHandler(request.action) };
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

async function startPrompt(user: ReturnType<typeof userEvent.setup>, prompt: string): Promise<void> {
  fireEvent.change(screen.getByRole('textbox', { name: 'Message input' }), {
    target: { value: prompt },
  });
  await user.click(screen.getByRole('button', { name: 'Send' }));
}

function createSettings(overrides: Partial<ExtensionSettings> = {}): ExtensionSettings {
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
    ...overrides,
  };
}

function createPageContext(base: Partial<PageContext>): PageContext {
  return {
    url: base.url ?? 'https://edge.example.test',
    title: base.title ?? 'Edge Example',
    summary: base.summary ?? 'Edge example page context',
    frame: base.frame ?? {
      frameId: 0,
      parentFrameId: null,
      url: base.url ?? 'https://edge.example.test',
      origin: new URL(base.url ?? 'https://edge.example.test').origin,
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

function createLargePageContext(): PageContext {
  const interactiveElements = Array.from({ length: 220 }, (_value, index) => ({
    index: index + 1,
    tag: index % 3 === 0 ? 'button' : 'div',
    text: `Bulk action ${index + 1} for enterprise analytics review`,
    type: index % 3 === 0 ? 'button' : undefined,
    role: index % 3 === 0 ? 'button' : 'article',
    placeholder: undefined,
    ariaLabel: `Bulk action ${index + 1}`,
    isVisible: true,
    isEnabled: true,
    boundingBox: {
      x: 24 + (index % 4) * 220,
      y: 120 + index * 28,
      width: 180,
      height: 24,
    },
  }));

  return createPageContext({
    url: 'https://edge.example.test/large-dashboard',
    title: 'Large DOM Dashboard',
    summary:
      'Dense dashboard with hundreds of actionable tiles, repeated analytics labels, and verbose descriptive content.',
    interactiveElements,
    headings: Array.from({ length: 40 }, (_value, index) => ({
      level: index % 3 === 0 ? 2 : 3,
      text: `Operations cluster ${index + 1} monitoring view`,
    })),
    links: Array.from({ length: 60 }, (_value, index) => ({
      text: `Audit trail ${index + 1}`,
      href: `https://edge.example.test/audit/${index + 1}`,
    })),
  });
}

describe('P-02c edge-case E2E expansion', () => {
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

  it('P-02c keeps the UI stable while a slow page-context fetch is in flight', async () => {
    const user = userEvent.setup();
    const actionHandler = vi.fn(async (action: Action): Promise<ActionResult> => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return {
        actionId: action.id,
        success: true,
        duration: 25,
        data: { executed: true, type: action.type },
      };
    });

    activeRuntime = new UISessionRuntime({
      bridge: createBridge({
        pageContext: createPageContext({
          url: 'https://edge.example.test/slow-network',
          title: 'Slow network checkout',
          summary: 'Checkout page with delayed data hydration and a confirm action.',
          interactiveElements: [
            {
              index: 1,
              tag: 'button',
              text: 'Confirm order',
              type: 'button',
              role: 'button',
              placeholder: undefined,
              ariaLabel: 'Confirm order',
              isVisible: true,
              isEnabled: true,
              boundingBox: { x: 980, y: 720, width: 168, height: 42 },
            },
          ],
          headings: [{ level: 1, text: 'Review your order' }],
        }),
        actionHandler,
        getPageContextDelayMs: 60,
      }),
      logger: new Logger('FluxSW:p-02c-e2e', 'debug'),
      aiClientManager: createAIManager({
        responseText: JSON.stringify({
          summary: 'The assistant waits for the slow page context to arrive, then responds without freezing the UI.',
          actions: [],
        }),
      }),
    });

    await renderApp();
    await startPrompt(user, 'Confirm the order once the delayed checkout data is ready');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    });

    expect(await screen.findByText('Confirm the order once the delayed checkout data is ready')).toBeInTheDocument();
    await settleAsyncSideEffects(2);

    expect(actionHandler).not.toHaveBeenCalled();
    expect(await screen.findByText('The assistant waits for the slow page context to arrive, then responds without freezing the UI.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await openActionLog(user);
    expect(await screen.findByText('Planning automation steps')).toBeInTheDocument();
  });

  it('P-02c trims large page context before planning and still executes a deterministic action', async () => {
    const user = userEvent.setup();
    const observedUserMessageLengths: number[] = [];
    const actionHandler = vi.fn(async (action: Action): Promise<ActionResult> => ({
      actionId: action.id,
      success: true,
      duration: 12,
      data: { executed: true, type: action.type },
    }));

    await chrome.storage.local.set({
      settings: createSettings({ maxContextLength: 4_000 }),
    });

    activeRuntime = new UISessionRuntime({
      bridge: createBridge({
        pageContext: createLargePageContext(),
        actionHandler,
      }),
      logger: new Logger('FluxSW:p-02c-e2e', 'debug'),
      aiClientManager: createAIManager({
        responseText: JSON.stringify({
          summary: 'The assistant trims oversized page context and still targets the requested bulk action.',
          actions: [
            {
              id: 'large-dom-bulk-action',
              type: 'click',
              selector: { role: 'button', textExact: 'Bulk action 60 for enterprise analytics review' },
              description: 'Open the requested bulk action from the oversized dashboard',
            },
          ],
        }),
        onChat: (messages) => {
          const userMessage = messages[messages.length - 1];
          if (userMessage?.role === 'user' && typeof userMessage.content === 'string') {
            observedUserMessageLengths.push(userMessage.content.length);
          }
        },
      }),
    });

    await renderApp();
    await sendPrompt(user, 'Open bulk action 60 from the enterprise analytics dashboard');

    await waitFor(() => {
      expect(actionHandler).toHaveBeenCalledTimes(1);
    });

    expect(observedUserMessageLengths).toHaveLength(1);
    expect(observedUserMessageLengths[0]).toBeLessThan(5_000);
    expect(await screen.findByText('The assistant trims oversized page context and still targets the requested bulk action.')).toBeInTheDocument();

    await openActionLog(user);
    expect(await screen.findByText('Open the requested bulk action from the oversized dashboard')).toBeInTheDocument();
  });

  it('P-02c degrades gracefully when page-context collection fails under edge conditions', async () => {
    const user = userEvent.setup();
    const actionHandler = vi.fn(async (action: Action): Promise<ActionResult> => ({
      actionId: action.id,
      success: true,
      duration: 8,
      data: { executed: true, type: action.type },
    }));

    activeRuntime = new UISessionRuntime({
      bridge: createBridge({
        pageContext: createPageContext({
          summary: 'Unused fallback page context',
        }),
        actionHandler,
        getPageContextError: new Error('Synthetic timeout while collecting a very large page context'),
      }),
      logger: new Logger('FluxSW:p-02c-e2e', 'debug'),
      aiClientManager: createAIManager({
        responseText: JSON.stringify({
          summary: 'The assistant falls back to a no-op response when live page context is unavailable.',
          actions: [],
        }),
        chunkDelayMs: 15,
      }),
    });

    await renderApp();
    await sendPrompt(user, 'Summarize what you can do if the page context fetch keeps timing out');

    expect(actionHandler).not.toHaveBeenCalled();
    expect(await screen.findByText('The assistant falls back to a no-op response when live page context is unavailable.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await openActionLog(user);
    expect(await screen.findByText('Planning automation steps')).toBeInTheDocument();
    expect(await screen.findAllByText('The assistant falls back to a no-op response when live page context is unavailable.')).toHaveLength(2);
  });
});
