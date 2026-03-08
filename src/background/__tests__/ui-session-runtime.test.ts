import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IServiceWorkerBridge } from '@core/bridge';
import { AIClientManager } from '@core/ai-client';
import type { IAIProvider } from '@core/ai-client';
import { CommandParser } from '@core/command-parser';
import { Logger } from '@shared/utils';
import type {
  Action,
  ActionResult,
  AIMessage,
  AIModelConfig,
  AIRequestOptions,
  AIStreamChunk,
  ExtensionMessage,
  PageContext,
  RequestPayloadMap,
} from '@shared/types';
import type { INetworkInterceptionManager } from '../network-interception-manager';
import { UISessionRuntime } from '../ui-session-runtime';

type MockTabsApi = typeof chrome.tabs & {
  _getTabs?: () => chrome.tabs.Tab[];
  _setTabs?: (tabs: chrome.tabs.Tab[]) => void;
};

function createExtensionMessage<T extends keyof RequestPayloadMap>(
  type: T,
  payload: RequestPayloadMap[T],
): ExtensionMessage<RequestPayloadMap[T]> {
  return {
    id: `msg-${type}`,
    channel: 'sidePanel',
    type,
    payload,
    timestamp: Date.now(),
  };
}

function createPageContext(): PageContext {
  return {
    url: 'https://example.com/form',
    title: 'Example Form',
    summary: 'Form with email field and submit button.',
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
        boundingBox: { x: 10, y: 20, width: 200, height: 40 },
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
        boundingBox: { x: 10, y: 80, width: 120, height: 44 },
      },
    ],
    headings: [{ level: 1, text: 'Example Form' }],
    links: [],
    forms: [
      {
        action: '/submit',
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
      width: 1280,
      height: 720,
      scrollX: 0,
      scrollY: 0,
      scrollHeight: 1200,
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

function installNavigationCompletion(url: string, mode: 'load' | 'domContentLoaded' = 'load'): void {
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

        if (mode === 'load') {
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
        }
      }, 0);
    }

    return response;
  });
}

describe('UI session runtime', () => {
  beforeEach(async () => {
    vi.useRealTimers();
    vi.spyOn(chrome.runtime, 'sendMessage').mockResolvedValue(undefined);
    await chrome.storage.local.set({
      settings: {
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
        language: 'auto',
        theme: 'system',
      },
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

  it('creates and lists sessions through the runtime', async () => {
    const bridge = createBridge(async (action) => ({
      actionId: action.id,
      success: true,
      duration: 5,
    }));

    const runtime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}'),
    });

    const createResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_CREATE', {
        config: { provider: 'openai', model: 'gpt-4o-mini' },
      }),
    );

    expect(createResponse.success).toBe(true);
    expect(createResponse.data?.session.config.id).toBeTruthy();

    const listResponse = await runtime.handleMessage(createExtensionMessage('SESSION_LIST', undefined));
    expect(listResponse.success).toBe(true);
    expect(listResponse.data?.sessions).toHaveLength(1);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'EVENT_SESSION_UPDATE',
        payload: expect.objectContaining({ reason: 'created' }),
      }),
    );
  });

  it('streams an AI plan, executes the action, and persists the UI-facing summary', async () => {
    const actionHandler = vi.fn(async (action: Action): Promise<ActionResult> => ({
      actionId: action.id,
      success: true,
      duration: 12,
      data: { clicked: true },
    }));
    const bridge = createBridge(actionHandler);
    const runtime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager(
        JSON.stringify({
          summary: 'Click the Submit button',
          actions: [
            {
              type: 'click',
              selector: { role: 'button', textExact: 'Submit' },
              description: 'Click the Submit button',
            },
          ],
        }),
      ),
    });

    const createResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_CREATE', {
        config: { provider: 'openai', model: 'gpt-4o-mini' },
      }),
    );
    const sessionId = createResponse.data?.session.config.id;

    const sendResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_SEND_MESSAGE', {
        sessionId: sessionId!,
        message: 'Click the submit button',
      }),
    );

    expect(sendResponse.success).toBe(true);
    expect(bridge.ensureContentScript).toHaveBeenCalled();
    expect(bridge.send).toHaveBeenCalledWith(1, 'GET_PAGE_CONTEXT', undefined);
    expect(bridge.send).toHaveBeenCalledWith(
      1,
      'EXECUTE_ACTION',
      expect.objectContaining({
        action: expect.objectContaining({
          type: 'click',
          selector: { role: 'button', textExact: 'Submit' },
        }),
      }),
    );
    expect(bridge.sendOneWay).toHaveBeenCalledWith(
      1,
      'HIGHLIGHT_ELEMENT',
      expect.objectContaining({ selector: { role: 'button', textExact: 'Submit' } }),
    );
    expect(actionHandler).toHaveBeenCalledTimes(1);

    const broadcastCalls = vi.mocked(chrome.runtime.sendMessage).mock.calls.map(([message]) => message);
    expect(broadcastCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'EVENT_AI_STREAM' }),
        expect.objectContaining({ type: 'EVENT_ACTION_PROGRESS' }),
        expect.objectContaining({ type: 'EVENT_SESSION_UPDATE' }),
      ]),
    );

    const stateResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_GET_STATE', { sessionId: sessionId! }),
    );

    expect(stateResponse.data?.session?.messages).toHaveLength(2);
    expect(stateResponse.data?.session?.messages[1]).toEqual(
      expect.objectContaining({ role: 'assistant', content: 'Click the Submit button' }),
    );
    expect(stateResponse.data?.session?.actionHistory).toHaveLength(1);
    expect(stateResponse.data?.session?.actionHistory[0]).toEqual(
      expect.objectContaining({
        action: expect.objectContaining({ type: 'click' }),
        result: expect.objectContaining({ success: true }),
      }),
    );
  });

  it('retries recoverable action failures before succeeding', async () => {
    const actionHandler = vi.fn(async (_action: Action): Promise<ActionResult> => ({
      actionId: 'action-retry',
      success: true,
      duration: 9,
      data: { clicked: true },
    }));

    actionHandler.mockResolvedValueOnce({
        actionId: 'action-retry',
        success: false,
        duration: 10,
        error: {
          code: 'ELEMENT_NOT_FOUND',
          message: 'Button not ready yet',
          recoverable: true,
        },
      })
      .mockResolvedValueOnce({
        actionId: 'action-retry',
        success: true,
        duration: 9,
        data: { clicked: true },
      });

    const runtime = new UISessionRuntime({
      bridge: createBridge(actionHandler),
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager(
        JSON.stringify({
          summary: 'Retry the click until it succeeds',
          actions: [
            {
              id: 'action-retry',
              type: 'click',
              selector: { role: 'button', textExact: 'Submit' },
              description: 'Click the Submit button',
            },
          ],
        }),
      ),
    });

    const createResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_CREATE', {
        config: { provider: 'openai', model: 'gpt-4o-mini' },
      }),
    );
    const sessionId = createResponse.data?.session.config.id;

    const sendResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_SEND_MESSAGE', {
        sessionId: sessionId!,
        message: 'Click the submit button',
      }),
    );

    expect(sendResponse.success).toBe(true);
    expect(actionHandler).toHaveBeenCalledTimes(2);

    const stateResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_GET_STATE', { sessionId: sessionId! }),
    );

    expect(stateResponse.data?.session?.actionHistory).toHaveLength(1);
    expect(stateResponse.data?.session?.actionHistory[0]?.result).toEqual(
      expect.objectContaining({ success: true }),
    );
  });

  it('routes network interception actions to the background manager instead of the DOM bridge', async () => {
    const actionHandler = vi.fn(async (action: Action): Promise<ActionResult> => ({
      actionId: action.id,
      success: true,
      duration: 5,
    }));
    const bridge = createBridge(actionHandler);
    const networkInterceptionManager: INetworkInterceptionManager = {
      activateSession: vi.fn(),
      registerAction: vi.fn(async (sessionId: string, tabId: number, action) => ({
        ruleId: action.id,
        sessionId,
        tabId,
        operation: action.type === 'mockResponse' ? 'mock' : action.operation,
        activeRuleCount: 1,
        urlPatterns: [...action.urlPatterns],
      })),
      clearSession: vi.fn(async () => undefined),
    };

    const runtime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager(
        JSON.stringify({
          summary: 'Block tracker requests',
          actions: [
            {
              id: 'rule-block',
              type: 'interceptNetwork',
              urlPatterns: ['https://ads.example.com/*'],
              operation: 'block',
            },
          ],
        }),
      ),
      networkInterceptionManager,
      parserFactory: () => new CommandParser({ strictMode: false, allowEvaluate: false }),
    });

    const createResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_CREATE', {
        config: { provider: 'openai', model: 'gpt-4o-mini' },
      }),
    );
    const sessionId = createResponse.data?.session.config.id;

    const sendResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_SEND_MESSAGE', {
        sessionId: sessionId!,
        message: 'Block tracker requests on this page',
      }),
    );

    expect(sendResponse.success).toBe(true);
    expect(networkInterceptionManager.registerAction).toHaveBeenCalledWith(
      sessionId,
      1,
      expect.objectContaining({
        type: 'interceptNetwork',
        urlPatterns: ['https://ads.example.com/*'],
        operation: 'block',
      }),
    );
    expect(actionHandler).not.toHaveBeenCalled();
    expect(
      bridge.send.mock.calls.filter(([, type]) => type === 'EXECUTE_ACTION'),
    ).toHaveLength(0);
  });

  it('clears network interception rules when a session is aborted', async () => {
    const networkInterceptionManager: INetworkInterceptionManager = {
      activateSession: vi.fn(),
      registerAction: vi.fn(async () => ({
        ruleId: 'rule-1',
        sessionId: 'session-1',
        tabId: 1,
        operation: 'block',
        activeRuleCount: 1,
        urlPatterns: ['https://ads.example.com/*'],
      })),
      clearSession: vi.fn(async () => undefined),
    };

    const runtime = new UISessionRuntime({
      bridge: createBridge(async (action) => ({
        actionId: action.id,
        success: true,
        duration: 5,
      })),
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}'),
      networkInterceptionManager,
    });

    const createResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_CREATE', {
        config: { provider: 'openai', model: 'gpt-4o-mini' },
      }),
    );
    const sessionId = createResponse.data?.session.config.id;

    const abortResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_ABORT', { sessionId: sessionId! }),
    );

    expect(abortResponse.success).toBe(true);
    expect(networkInterceptionManager.clearSession).toHaveBeenCalledWith(sessionId);
  });

  it('clears session network interception rules before switching the target tab', async () => {
    (chrome.tabs as MockTabsApi)._setTabs?.([
      {
        id: 1,
        index: 0,
        windowId: 1,
        highlighted: true,
        active: true,
        pinned: false,
        incognito: false,
        url: 'https://example.com',
        title: 'Primary',
        status: 'complete',
        discarded: false,
        autoDiscardable: true,
        groupId: -1,
      },
      {
        id: 2,
        index: 1,
        windowId: 1,
        highlighted: false,
        active: false,
        pinned: false,
        incognito: false,
        url: 'https://second.example.com',
        title: 'Secondary',
        status: 'complete',
        discarded: false,
        autoDiscardable: true,
        groupId: -1,
      },
    ]);

    const networkInterceptionManager: INetworkInterceptionManager = {
      activateSession: vi.fn(),
      registerAction: vi.fn(async () => ({
        ruleId: 'rule-1',
        sessionId: 'session-1',
        tabId: 1,
        operation: 'block',
        activeRuleCount: 1,
        urlPatterns: ['https://ads.example.com/*'],
      })),
      clearSession: vi.fn(async () => undefined),
    };

    const runtime = new UISessionRuntime({
      bridge: createBridge(async (action) => ({
        actionId: action.id,
        success: true,
        duration: 5,
      })),
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager(
        JSON.stringify({
          summary: 'Switch to the second tab',
          actions: [{ id: 'switch-1', type: 'switchTab', tabIndex: 1 }],
        }),
      ),
      networkInterceptionManager,
    });

    const createResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_CREATE', {
        config: { provider: 'openai', model: 'gpt-4o-mini' },
      }),
    );
    const sessionId = createResponse.data?.session.config.id;

    const sendResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_SEND_MESSAGE', {
        sessionId: sessionId!,
        message: 'Switch to the second tab',
      }),
    );

    expect(sendResponse.success).toBe(true);
    expect(networkInterceptionManager.clearSession).toHaveBeenCalledWith(sessionId);
    expect(networkInterceptionManager.activateSession).toHaveBeenLastCalledWith(sessionId, 2);
  });

  it('waits for navigation readiness before collecting fresh page context', async () => {
    installNavigationCompletion('https://localhost/dashboard', 'domContentLoaded');

    const bridge = createBridge(async (action) => ({
      actionId: action.id,
      success: true,
      duration: 5,
    }));
    const runtime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager(
        JSON.stringify({
          summary: 'Navigate to the dashboard',
          actions: [
            {
              type: 'navigate',
              url: 'https://localhost/dashboard',
              waitUntil: 'domContentLoaded',
              description: 'Open the dashboard',
            },
          ],
        }),
      ),
    });

    const createResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_CREATE', {
        config: { provider: 'openai', model: 'gpt-4o-mini' },
      }),
    );
    const sessionId = createResponse.data?.session.config.id;

    const sendResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_SEND_MESSAGE', {
        sessionId: sessionId!,
        message: 'Open the dashboard',
      }),
    );

    expect(sendResponse.success).toBe(true);
    expect(chrome.tabs.update).toHaveBeenCalledWith(1, { url: 'https://localhost/dashboard' });
    expect(bridge.send).toHaveBeenNthCalledWith(1, 1, 'GET_PAGE_CONTEXT', undefined);
    expect(bridge.send).toHaveBeenNthCalledWith(2, 1, 'GET_PAGE_CONTEXT', undefined);
  });
});
