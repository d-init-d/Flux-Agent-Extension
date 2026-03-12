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
    url: base.url ?? 'https://example.com/app',
    title: base.title ?? 'Flux Demo App',
    summary: base.summary ?? 'Demo page with form fields and submit buttons.',
    frame: base.frame ?? {
      frameId: 0,
      parentFrameId: null,
      url: base.url ?? 'https://example.com/app',
      origin: new URL(base.url ?? 'https://example.com/app').origin,
      name: 'main',
      isTop: true,
    },
    interactiveElements: base.interactiveElements ?? [
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
    headings: base.headings ?? [{ level: 1, text: 'Flux Demo App' }],
    links: base.links ?? [],
    forms: base.forms ?? [
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
    viewport: base.viewport ?? {
      width: 1440,
      height: 900,
      scrollX: 0,
      scrollY: 0,
      scrollHeight: 2400,
    },
  };
}

function getActiveSessionId(): string {
  return (screen.getByRole('combobox', { name: 'Active session' }) as HTMLSelectElement).value;
}

async function getSessionState(sessionId: string) {
  const response = await activeRuntime?.handleMessage(
    createExtensionMessage('SESSION_GET_STATE', { sessionId }),
  );

  expect(response?.success).toBe(true);
  return response?.data?.session ?? null;
}

describe('P-02d error-recovery E2E expansion', () => {
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

  it('P-02d retries a recoverable failure and still completes the remaining plan', async () => {
    const user = userEvent.setup();
    const actionHandler = vi.fn(async (action: Action): Promise<ActionResult> => {
      if (action.id === 'retry-save-draft') {
        return {
          actionId: action.id,
          success: true,
          duration: 8,
          data: { saved: true },
        };
      }

      return {
        actionId: action.id,
        success: true,
        duration: 6,
        data: { confirmed: true },
      };
    });

    actionHandler.mockResolvedValueOnce({
      actionId: 'retry-click',
      success: false,
      duration: 9,
      error: {
        code: 'ELEMENT_NOT_FOUND',
        message: 'Login button was still hydrating',
        recoverable: true,
      },
    });

    activeRuntime = new UISessionRuntime({
      bridge: createBridge(
        createPageContext({
          summary: 'Demo page with a Login button followed by a Submit button.',
        }),
        actionHandler,
      ),
      logger: new Logger('FluxSW:p-02d-e2e', 'debug'),
      aiClientManager: createAIManager(
        JSON.stringify({
          summary: 'The assistant retries the Login click and then continues to Submit.',
          actions: [
            {
              id: 'retry-click',
              type: 'click',
              selector: { role: 'button', textExact: 'Login' },
              description: 'Retry the Login button until it responds',
            },
            {
              id: 'submit-after-retry',
              type: 'click',
              selector: { role: 'button', textExact: 'Submit' },
              description: 'Continue with the Submit button',
            },
          ],
        }),
      ),
    });

    await renderApp();
    const sessionId = getActiveSessionId();

    await sendPrompt(user, 'Click login, retry once if needed, then continue to submit');

    await waitFor(() => {
      expect(actionHandler).toHaveBeenCalledTimes(3);
    });

    expect(actionHandler.mock.calls.map(([action]) => action.id)).toEqual([
      'retry-click',
      'retry-click',
      'submit-after-retry',
    ]);
    expect(
      await screen.findByText(
        'The assistant retries the Login click and then continues to Submit.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Login button was still hydrating')).not.toBeInTheDocument();

    const session = await getSessionState(sessionId);
    expect(session?.status).toBe('idle');
    expect(session?.lastError ?? null).toBeNull();
    expect(session?.actionHistory.map((entry) => entry.action.id)).toEqual([
      'retry-click',
      'submit-after-retry',
    ]);

    await openActionLog(user);
    expect(await screen.findByText('Retry the Login button until it responds')).toBeInTheDocument();
    expect(await screen.findByText('Continue with the Submit button')).toBeInTheDocument();
  });

  it('P-02d stops the remaining actions after an unrecoverable failure and surfaces the error cleanly', async () => {
    const user = userEvent.setup();
    const actionHandler = vi.fn(async (action: Action): Promise<ActionResult> => {
      if (action.id === 'dismiss-missing-modal') {
        return {
          actionId: action.id,
          success: false,
          duration: 11,
          error: {
            code: 'ELEMENT_NOT_FOUND',
            message: 'Security confirmation modal never appeared',
            recoverable: false,
          },
        };
      }

      return {
        actionId: action.id,
        success: true,
        duration: 5,
      };
    });

    activeRuntime = new UISessionRuntime({
      bridge: createBridge(
        createPageContext({
          summary: 'Demo page where Login must succeed before Submit can run.',
        }),
        actionHandler,
      ),
      logger: new Logger('FluxSW:p-02d-e2e', 'debug'),
      aiClientManager: createAIManager(
        JSON.stringify({
          summary: 'The assistant tries Login first and then Submit.',
          actions: [
            {
              id: 'dismiss-missing-modal',
              type: 'click',
              selector: { role: 'button', textExact: 'Login' },
              description: 'Click the Login button',
            },
            {
              id: 'finalize-approval',
              type: 'click',
              selector: { role: 'button', textExact: 'Submit' },
              description: 'Click the Submit button',
            },
          ],
        }),
      ),
    });

    await renderApp();
    const sessionId = getActiveSessionId();

    await sendPrompt(user, 'Try the login flow and stop if login cannot recover');

    await waitFor(() => {
      expect(actionHandler).toHaveBeenCalledTimes(1);
    });

    expect(actionHandler.mock.calls.map(([action]) => action.id)).toEqual([
      'dismiss-missing-modal',
    ]);
    expect(
      (await screen.findAllByText('Security confirmation modal never appeared')).length,
    ).toBeGreaterThanOrEqual(2);

    const session = await getSessionState(sessionId);
    expect(session?.status).toBe('error');
    expect(session?.lastError?.message).toBe('Security confirmation modal never appeared');
    expect(session?.actionHistory.map((entry) => entry.action.id)).toEqual([
      'dismiss-missing-modal',
    ]);

    await openActionLog(user);
    expect(await screen.findByText('Click the Login button')).toBeInTheDocument();
    expect(
      screen.getAllByText('Security confirmation modal never appeared').length,
    ).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('Click the Submit button')).not.toBeInTheDocument();
  });

  it('P-02d tolerates an optional action failure and continues the flow without crashing the UI', async () => {
    const user = userEvent.setup();
    const actionHandler = vi.fn(async (action: Action): Promise<ActionResult> => {
      if (action.id === 'dismiss-optional-banner') {
        return {
          actionId: action.id,
          success: false,
          duration: 7,
          error: {
            code: 'ELEMENT_NOT_FOUND',
            message: 'Promo banner was already absent',
            recoverable: false,
          },
        };
      }

      return {
        actionId: action.id,
        success: true,
        duration: 6,
        data: { advanced: true },
      };
    });

    activeRuntime = new UISessionRuntime({
      bridge: createBridge(
        createPageContext({
          summary: 'Demo page where an optional Login step can fail without blocking Submit.',
          interactiveElements: [
            {
              index: 1,
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
              index: 2,
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
        }),
        actionHandler,
      ),
      logger: new Logger('FluxSW:p-02d-e2e', 'debug'),
      aiClientManager: createAIManager(
        JSON.stringify({
          summary: 'The assistant skips the optional Login failure and still reaches Submit.',
          actions: [
            {
              id: 'dismiss-optional-banner',
              type: 'click',
              selector: { role: 'button', textExact: 'Login' },
              description: 'Click the Login button only if it is currently needed',
              optional: true,
            },
            {
              id: 'continue-payment',
              type: 'click',
              selector: { role: 'button', textExact: 'Submit' },
              description: 'Continue with the Submit button',
            },
          ],
        }),
      ),
    });

    await renderApp();
    const sessionId = getActiveSessionId();

    await sendPrompt(user, 'Skip login if it is optional, then continue to submit');

    await waitFor(() => {
      expect(actionHandler).toHaveBeenCalledTimes(2);
    });

    expect(actionHandler.mock.calls.map(([action]) => action.id)).toEqual([
      'dismiss-optional-banner',
      'continue-payment',
    ]);
    expect(
      await screen.findByText(
        'The assistant skips the optional Login failure and still reaches Submit.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Request failed')).not.toBeInTheDocument();

    const session = await getSessionState(sessionId);
    expect(session?.status).toBe('idle');
    expect(session?.lastError ?? null).toBeNull();
    expect(
      session?.actionHistory.map((entry) => ({
        id: entry.action.id,
        success: entry.result.success,
      })),
    ).toEqual([
      { id: 'dismiss-optional-banner', success: false },
      { id: 'continue-payment', success: true },
    ]);

    await openActionLog(user);
    expect(
      await screen.findByText('Click the Login button only if it is currently needed'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Promo banner was already absent')).toBeInTheDocument();
    expect(await screen.findByText('Continue with the Submit button')).toBeInTheDocument();
  });
});
