import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IServiceWorkerBridge } from '@core/bridge';
import { AIClientManager } from '@core/ai-client';
import type { IAIProvider } from '@core/ai-client';
import * as providerLoader from '@core/ai-client/provider-loader';
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
  SavedWorkflow,
} from '@shared/types';
import type { IDeviceEmulationManager } from '../device-emulation-manager';
import type { IGeolocationMockManager } from '../geolocation-mock-manager';
import type { INetworkInterceptionManager } from '../network-interception-manager';
import { CredentialVault } from '../credential-vault';
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

function encodeBase64UrlJson(payload: Record<string, unknown>): string {
  return btoa(JSON.stringify(payload)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '');
}

function createJwt(payload: Record<string, unknown>): string {
  return `${encodeBase64UrlJson({ alg: 'none', typ: 'JWT' })}.${encodeBase64UrlJson(payload)}.signature`;
}

function createPageContext(): PageContext {
  return {
    url: 'https://example.com/form',
    title: 'Example Form',
    summary: 'Form with email field and submit button.',
    frame: {
      frameId: 0,
      parentFrameId: null,
      url: 'https://example.com/form',
      origin: 'https://example.com',
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

function decodeDownloadTextUrl(url: string): string {
  const [, encodedContent = ''] = url.split(',', 2);
  return decodeURIComponent(encodedContent);
}

function createSavedWorkflow(id: string, overrides: Partial<SavedWorkflow> = {}): SavedWorkflow {
  return {
    id,
    name: 'Checkout smoke test',
    description: 'Replays the checkout journey up to payment confirmation.',
    actions: [
      {
        action: {
          id: `${id}-click-1`,
          type: 'click',
          selector: { css: '[data-testid="continue"]' },
        },
        timestamp: 100,
      },
      {
        action: { id: `${id}-click-2`, type: 'click', selector: { css: '[data-testid="submit"]' } },
        timestamp: 600,
      },
    ],
    tags: ['qa', 'checkout'],
    createdAt: 1_710_000_000_000,
    updatedAt: 1_710_000_001_000,
    source: {
      sessionId: 'session-1',
      sessionName: 'Regression pass',
      recordedAt: 1_710_000_001_000,
    },
    ...overrides,
  };
}

class MockProvider implements IAIProvider {
  readonly name = 'openai' as const;
  readonly supportsVision = false;
  readonly supportsStreaming = true;
  readonly supportsFunctionCalling = false;
  public lastMessages: AIMessage[] = [];
  private readonly responseQueue: string[];

  constructor(responseText: string | string[]) {
    this.responseQueue = Array.isArray(responseText) ? [...responseText] : [responseText];
  }

  async initialize(_config: AIModelConfig): Promise<void> {
    return undefined;
  }

  async *chat(
    messages: AIMessage[],
    _options?: AIRequestOptions,
  ): AsyncGenerator<AIStreamChunk, void, unknown> {
    this.lastMessages = messages;
    const responseText =
      this.responseQueue.shift() ?? this.responseQueue.at(-1) ?? '{"summary":"noop","actions":[]}';
    const midpoint = Math.max(1, Math.floor(responseText.length / 2));
    yield { type: 'text', content: responseText.slice(0, midpoint) };
    yield { type: 'text', content: responseText.slice(midpoint) };
  }

  async validateApiKey(_apiKey: string): Promise<boolean> {
    return true;
  }

  abort(): void {
    // no-op
  }
}

function createAIManager(responseText: string | string[]): {
  manager: AIClientManager;
  provider: MockProvider;
} {
  const manager = new AIClientManager({ autoFallback: false });
  const provider = new MockProvider(responseText);
  manager.registerProvider(provider);
  return { manager, provider };
}

async function seedUnlockedOpenAiVaultFixture(): Promise<void> {
  const vault = new CredentialVault();
  await vault.init('test-passphrase');
  await vault.setCredential('openai', 'sk-openai-test');
  await vault.markValidated('openai');
}

async function seedUnlockedOpenAiBrowserAccountVaultFixture(): Promise<void> {
  const vault = new CredentialVault();
  await vault.init('test-passphrase');
  const now = Date.UTC(2026, 2, 18, 9, 30, 0);
  const idToken = createJwt({
    email: 'browser-runtime@example.com',
    'https://api.openai.com/auth': {
      chatgpt_plan_type: 'pro',
      chatgpt_user_id: 'user_openai_browser_runtime',
    },
  });

  await vault.saveAccount('openai', {
    accountId: 'acct_openai_browser_runtime',
    label: 'OpenAI Browser Runtime',
    isActive: true,
    status: 'active',
    artifact: {
      format: 'json',
      value: JSON.stringify({
        auth_mode: 'chatgpt',
        last_refresh: new Date(now).toISOString(),
        tokens: {
          access_token: 'access-openai-browser-runtime',
          id_token: idToken,
          refresh_token: 'refresh-openai-browser-runtime',
          account_id: 'acct_openai_browser_runtime',
        },
      }),
    },
  });
  await vault.setBrowserLoginResult('openai', {
    status: 'success',
    updatedAt: now,
    lastAttemptAt: now,
    lastCompletedAt: now,
    accountId: 'acct_openai_browser_runtime',
    accountLabel: 'OpenAI Browser Runtime',
  });
}

function createLazyLoadedProvider(
  type: IAIProvider['name'],
  responseText = '{"summary":"noop","actions":[]}',
): IAIProvider {
  return {
    name: type,
    supportsVision: false,
    supportsStreaming: true,
    supportsFunctionCalling: false,
    async initialize(): Promise<void> {
      return undefined;
    },
    async *chat(): AsyncGenerator<AIStreamChunk, void, unknown> {
      yield { type: 'text', content: responseText };
    },
    async validateApiKey(): Promise<boolean> {
      return true;
    },
    abort(): void {
      // no-op
    },
  };
}

function createBridge(
  actionHandler: (action: Action) => Promise<ActionResult>,
): IServiceWorkerBridge & {
  send: ReturnType<typeof vi.fn>;
  ensureContentScript: ReturnType<typeof vi.fn>;
  sendOneWay: ReturnType<typeof vi.fn>;
  emitEvent: (
    type: string,
    tabId: number,
    frame: Record<string, unknown>,
    payload?: unknown,
  ) => void;
} {
  const eventHandlers = new Map<
    string,
    (tabId: number, frame: unknown, payload: unknown) => void
  >();
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
    onEvent: vi.fn(
      (type: string, handler: (tabId: number, frame: unknown, payload: unknown) => void) => {
        eventHandlers.set(type, handler);
        return () => {
          eventHandlers.delete(type);
        };
      },
    ),
    isReady: vi.fn(async () => true),
    emitEvent: (type: string, tabId: number, frame: Record<string, unknown>, payload?: unknown) => {
      eventHandlers.get(type)?.(tabId, frame, payload);
    },
  } as unknown as IServiceWorkerBridge & {
    send: ReturnType<typeof vi.fn>;
    ensureContentScript: ReturnType<typeof vi.fn>;
    sendOneWay: ReturnType<typeof vi.fn>;
    emitEvent: (
      type: string,
      tabId: number,
      frame: Record<string, unknown>,
      payload?: unknown,
    ) => void;
  };
}

function createNetworkManagerStub(): INetworkInterceptionManager {
  return {
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
}

function createDeviceManagerStub(): IDeviceEmulationManager {
  return {
    activateSession: vi.fn(),
    applyAction: vi.fn(async (sessionId: string, tabId: number, action) => ({
      sessionId,
      tabId,
      preset: action.preset,
      orientation: action.orientation ?? 'portrait',
      viewport: {
        width: 390,
        height: 844,
        deviceScaleFactor: 3,
        mobile: true,
      },
      userAgent: 'Mock Mobile UA',
      touchEnabled: true as const,
    })),
    clearSession: vi.fn(async () => undefined),
  };
}

function createGeolocationManagerStub(): IGeolocationMockManager {
  return {
    activateSession: vi.fn(),
    applyAction: vi.fn(async (sessionId: string, tabId: number, action) => ({
      sessionId,
      tabId,
      latitude: action.latitude,
      longitude: action.longitude,
      accuracy: action.accuracy,
    })),
    clearSession: vi.fn(async () => undefined),
  };
}

function installNavigationCompletion(
  url: string,
  mode: 'load' | 'domContentLoaded' = 'load',
): void {
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
          chrome.tabs.onUpdated.dispatch(
            tabId,
            { status: 'complete', url },
            {
              ...(nextTabs.find((tab) => tab.id === tabId) ?? response),
              id: tabId,
              url,
              status: 'complete',
            },
          );
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

function installCreatedTabCompletion(
  url: string,
  mode: 'load' | 'domContentLoaded' = 'load',
): void {
  const tabsApi = chrome.tabs as MockTabsApi;
  const baseCreate = vi.mocked(chrome.tabs.create).getMockImplementation();

  vi.spyOn(chrome.tabs, 'create').mockImplementation(async (createProperties) => {
    const response = baseCreate
      ? await baseCreate(createProperties)
      : ({ id: 2, url: createProperties.url, status: 'loading' } as chrome.tabs.Tab);

    if (createProperties.url === url && response.id !== undefined) {
      setTimeout(() => {
        const existingTabs = tabsApi._getTabs?.() ?? [];
        const nextTabs = existingTabs.map((tab) =>
          tab.id === response.id
            ? {
                ...tab,
                url,
                status: 'complete',
              }
            : tab,
        );
        tabsApi._setTabs?.(nextTabs);

        chrome.webNavigation.onCommitted.dispatch({
          tabId: response.id,
          frameId: 0,
          url,
          processId: 1,
          timeStamp: Date.now(),
          transitionQualifiers: [],
          transitionType: 'link',
        });
        chrome.webNavigation.onDOMContentLoaded.dispatch({
          tabId: response.id,
          frameId: 0,
          url,
          processId: 1,
          timeStamp: Date.now(),
        });

        if (mode === 'load') {
          chrome.tabs.onUpdated.dispatch(
            response.id,
            { status: 'complete', url },
            {
              ...(nextTabs.find((tab) => tab.id === response.id) ?? response),
              id: response.id,
              url,
              status: 'complete',
            },
          );
          chrome.webNavigation.onCompleted.dispatch({
            tabId: response.id,
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
    await seedUnlockedOpenAiVaultFixture();
  });

  it('normalizes cliproxyapi endpoints when saving provider settings', async () => {
    const bridge = createBridge(async (action) => ({
      actionId: action.id,
      success: true,
      duration: 5,
    }));
    const runtime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}').manager,
    });

    const response = await runtime.handleMessage(
      createExtensionMessage('PROVIDER_SET', {
        provider: 'cliproxyapi',
        config: {
          enabled: true,
          model: 'gpt-5',
          maxTokens: 4096,
          temperature: 0.3,
          customEndpoint: 'http://127.0.0.1:8317/v1/chat/completions',
        },
        makeDefault: true,
      }),
    );

    expect(response.success).toBe(true);
    expect(response.data?.providerConfig.customEndpoint).toBe('http://127.0.0.1:8317/v1');

    const stored = await chrome.storage.local.get('providers');
    expect(stored.providers).toEqual(
      expect.objectContaining({
        cliproxyapi: expect.objectContaining({
          customEndpoint: 'http://127.0.0.1:8317/v1',
        }),
      }),
    );
  });

  it('rejects non-loopback http cliproxyapi endpoints in provider saves', async () => {
    const bridge = createBridge(async (action) => ({
      actionId: action.id,
      success: true,
      duration: 5,
    }));
    const runtime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}').manager,
    });

    await expect(
      runtime.handleMessage(
        createExtensionMessage('PROVIDER_SET', {
          provider: 'cliproxyapi',
          config: {
            enabled: true,
            model: 'gpt-5',
            maxTokens: 4096,
            temperature: 0.3,
            customEndpoint: 'http://example.com/v1',
          },
          makeDefault: true,
        }),
      ),
    ).rejects.toThrow(/hosted cliproxyapi endpoints/i);
  });

  it('normalizes cliproxyapi endpoints before credential validation', async () => {
    const bridge = createBridge(async (action) => ({
      actionId: action.id,
      success: true,
      duration: 5,
    }));
    const validateCredentialSpy = vi
      .spyOn(CredentialVault.prototype, 'validateCredential')
      .mockResolvedValue(true);
    const runtime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}').manager,
    });

    const response = await runtime.handleMessage(
      createExtensionMessage('API_KEY_VALIDATE', {
        provider: 'cliproxyapi',
        apiKey: 'sk-cliproxyapi-test',
        authKind: 'api-key',
        config: {
          enabled: true,
          model: 'gpt-5',
          maxTokens: 4096,
          temperature: 0.3,
          customEndpoint: 'https://proxy.example.com/v1/models',
        },
      }),
    );

    expect(response.success).toBe(true);
    expect(validateCredentialSpy).toHaveBeenCalledWith(
      'cliproxyapi',
      expect.objectContaining({
        customEndpoint: 'https://proxy.example.com/v1',
      }),
      'sk-cliproxyapi-test',
    );

    validateCredentialSpy.mockRestore();
  });

  it('uses the normalized cliproxyapi endpoint when streaming a session message', async () => {
    const vault = new CredentialVault();
    await vault.init('test-passphrase');
    await vault.setCredential('cliproxyapi', 'sk-cliproxyapi-test');
    await vault.markValidated('cliproxyapi');
    await chrome.storage.local.set({
      providers: {
        openai: {
          enabled: true,
          authChoiceId: 'browser-account',
          model: 'codex-mini-latest',
          maxTokens: 4096,
          temperature: 0.2,
        },
        cliproxyapi: {
          enabled: true,
          model: 'gpt-5',
          maxTokens: 4096,
          temperature: 0.3,
          customEndpoint: 'https://proxy.example.com/v1',
        },
      },
      activeProvider: 'cliproxyapi',
      settings: {
        defaultProvider: 'cliproxyapi',
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
    });

    const manager = new AIClientManager({ autoFallback: false });
    manager.registerProvider(
      createLazyLoadedProvider('cliproxyapi', '{"summary":"noop","actions":[]}'),
    );
    const switchProviderSpy = vi.spyOn(manager, 'switchProvider');
    const getCredentialSpy = vi.spyOn(CredentialVault.prototype, 'getCredential');

    const runtime = new UISessionRuntime({
      bridge: createBridge(async (action) => ({
        actionId: action.id,
        success: true,
        duration: 5,
      })),
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: manager,
    });

    const createResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_CREATE', {
        config: { provider: 'cliproxyapi', model: 'gpt-5' },
      }),
    );
    const sessionId = createResponse.data?.session.config.id;

    const sendResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_SEND_MESSAGE', {
        sessionId: sessionId!,
        message: 'Say hello from CLIProxyAPI',
      }),
    );

    expect(sendResponse.success).toBe(true);
    expect(switchProviderSpy).toHaveBeenCalledWith(
      'cliproxyapi',
      expect.objectContaining({
        provider: 'cliproxyapi',
        baseUrl: 'https://proxy.example.com/v1',
      }),
    );

    getCredentialSpy.mockRestore();
  });

  it('blocks cliproxyapi session sends until the stored credential has been validated', async () => {
    const vault = new CredentialVault();
    await vault.init('test-passphrase');
    await vault.setCredential('cliproxyapi', 'sk-cliproxyapi-unvalidated');
    await chrome.storage.local.set({
      providers: {
        openai: {
          enabled: true,
          model: 'gpt-4o-mini',
          maxTokens: 4096,
          temperature: 0.2,
        },
        cliproxyapi: {
          enabled: true,
          model: 'gpt-5',
          maxTokens: 4096,
          temperature: 0.3,
          customEndpoint: 'https://proxy.example.com/v1',
        },
      },
    });

    const manager = new AIClientManager({ autoFallback: false });
    manager.registerProvider(
      createLazyLoadedProvider('cliproxyapi', '{"summary":"noop","actions":[]}'),
    );
    const switchProviderSpy = vi.spyOn(manager, 'switchProvider');
    const getCredentialSpy = vi.spyOn(CredentialVault.prototype, 'getCredential');

    const runtime = new UISessionRuntime({
      bridge: createBridge(async (action) => ({
        actionId: action.id,
        success: true,
        duration: 5,
      })),
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: manager,
    });

    const createResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_CREATE', {
        config: { provider: 'cliproxyapi', model: 'gpt-5' },
      }),
    );
    const sessionId = createResponse.data?.session.config.id;

    const sendResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_SEND_MESSAGE', {
        sessionId: sessionId!,
        message: 'Say hello from CLIProxyAPI',
      }),
    );

    expect(sendResponse.success).toBe(false);
    expect(sendResponse.error).toEqual(
      expect.objectContaining({
        code: 'ACTION_FAILED',
        message: expect.stringContaining('CLIProxyAPI is saved but not validated yet'),
      }),
    );
    expect(switchProviderSpy).not.toHaveBeenCalled();
    expect(getCredentialSpy).not.toHaveBeenCalledWith('cliproxyapi');
  });

  it('blocks cliproxyapi session sends when the stored credential is stale', async () => {
    const vault = new CredentialVault();
    await vault.init('test-passphrase');
    await vault.setCredential('cliproxyapi', 'sk-cliproxyapi-stale');
    await vault.markValidated('cliproxyapi');
    await vault.markCredentialStale('cliproxyapi');
    await chrome.storage.local.set({
      providers: {
        openai: {
          enabled: true,
          model: 'gpt-4o-mini',
          maxTokens: 4096,
          temperature: 0.2,
        },
        cliproxyapi: {
          enabled: true,
          model: 'gpt-5',
          maxTokens: 4096,
          temperature: 0.3,
          customEndpoint: 'https://proxy.example.com/v1',
        },
      },
    });

    const manager = new AIClientManager({ autoFallback: false });
    manager.registerProvider(
      createLazyLoadedProvider('cliproxyapi', '{"summary":"noop","actions":[]}'),
    );
    const switchProviderSpy = vi.spyOn(manager, 'switchProvider');
    const getCredentialSpy = vi.spyOn(CredentialVault.prototype, 'getCredential');

    const runtime = new UISessionRuntime({
      bridge: createBridge(async (action) => ({
        actionId: action.id,
        success: true,
        duration: 5,
      })),
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: manager,
    });

    const createResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_CREATE', {
        config: { provider: 'cliproxyapi', model: 'gpt-5' },
      }),
    );
    const sessionId = createResponse.data?.session.config.id;

    const sendResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_SEND_MESSAGE', {
        sessionId: sessionId!,
        message: 'Say hello from CLIProxyAPI',
      }),
    );

    expect(sendResponse.success).toBe(false);
    expect(sendResponse.error).toEqual(
      expect.objectContaining({
        code: 'ACTION_FAILED',
        message: expect.stringContaining('CLIProxyAPI settings changed after validation'),
      }),
    );
    expect(switchProviderSpy).not.toHaveBeenCalled();
    expect(getCredentialSpy).not.toHaveBeenCalledWith('cliproxyapi');
  });

  it('routes openai browser-account runtime through the internal codex adapter', async () => {
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
    await seedUnlockedOpenAiBrowserAccountVaultFixture();
    await chrome.storage.local.set({
      providers: {
        openai: {
          enabled: true,
          authChoiceId: 'browser-account',
          model: 'codex-latest',
          maxTokens: 4096,
          temperature: 0.2,
          customEndpoint: 'https://api.openai.com/v1',
        },
      },
    });

    const manager = new AIClientManager({ autoFallback: false });
    manager.registerProvider(createLazyLoadedProvider('codex', '{"summary":"noop","actions":[]}'));
    const switchProviderSpy = vi.spyOn(manager, 'switchProvider');
    const getCredentialSpy = vi.spyOn(CredentialVault.prototype, 'getCredential');

    const runtime = new UISessionRuntime({
      bridge: createBridge(async (action) => ({
        actionId: action.id,
        success: true,
        duration: 5,
      })),
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: manager,
    });

    const createResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_CREATE', {
        config: { provider: 'openai', model: 'codex-latest' },
      }),
    );
    const sessionId = createResponse.data?.session.config.id;

    const sendResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_SEND_MESSAGE', {
        sessionId: sessionId!,
        message: 'Use the browser-account lane',
      }),
    );

    expect(sendResponse.success).toBe(true);
    expect(switchProviderSpy).toHaveBeenCalledWith(
      'codex',
      expect.objectContaining({
        provider: 'codex',
        apiKey: 'access-openai-browser-runtime',
        model: 'codex-latest',
      }),
    );
    const browserAccountCall = switchProviderSpy.mock.calls.find(([type]) => type === 'codex');
    expect(browserAccountCall?.[1]).not.toHaveProperty('baseUrl');
    expect(getCredentialSpy).not.toHaveBeenCalledWith('openai');
  });

  it('fails closed for non-ready openai browser-account state without falling back to the api-key lane', async () => {
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();

    const vault = new CredentialVault();
    await vault.init('test-passphrase');
    await vault.setCredential('openai', 'sk-openai-should-not-fallback');
    await vault.markValidated('openai');
    await vault.saveAccount('openai', {
      accountId: 'acct_openai_pending_runtime',
      label: 'Pending OpenAI Browser Runtime',
      isActive: true,
      status: 'active',
      artifact: {
        format: 'json',
        value: JSON.stringify({
          artifact_version: 1,
          refresh_token: 'refresh-openai-pending-runtime',
          account_id: 'acct_openai_pending_runtime',
        }),
      },
    });
    await vault.setBrowserLoginResult('openai', {
      status: 'stale',
      updatedAt: Date.UTC(2026, 2, 18, 11, 0, 0),
      lastAttemptAt: Date.UTC(2026, 2, 18, 11, 0, 0),
      lastCompletedAt: Date.UTC(2026, 2, 18, 11, 5, 0),
      accountId: 'acct_openai_pending_runtime',
      accountLabel: 'Pending OpenAI Browser Runtime',
      lastErrorCode: 'BROWSER_LOGIN_STALE',
      retryable: true,
    });

    await chrome.storage.local.set({
      providers: {
        openai: {
          enabled: true,
          model: 'gpt-4o-mini',
          maxTokens: 4096,
          temperature: 0.2,
        },
      },
    });

    const manager = new AIClientManager({ autoFallback: false });
    manager.registerProvider(createLazyLoadedProvider('openai', '{"summary":"noop","actions":[]}'));
    manager.registerProvider(createLazyLoadedProvider('codex', '{"summary":"noop","actions":[]}'));
    const switchProviderSpy = vi.spyOn(manager, 'switchProvider');
    const getCredentialSpy = vi.spyOn(CredentialVault.prototype, 'getCredential');

    const runtime = new UISessionRuntime({
      bridge: createBridge(async (action) => ({
        actionId: action.id,
        success: true,
        duration: 5,
      })),
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: manager,
    });

    const createResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_CREATE', {
        config: { provider: 'openai', model: 'codex-mini-latest' },
      }),
    );
    const sessionId = createResponse.data?.session.config.id;

    const sendResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_SEND_MESSAGE', {
        sessionId: sessionId!,
        message: 'This must fail closed',
      }),
    );

    expect(sendResponse.success).toBe(false);
    expect(sendResponse.error).toEqual(
      expect.objectContaining({
        code: 'ACTION_FAILED',
        message: expect.stringContaining('browser-account auth is not ready yet'),
      }),
    );
    expect(switchProviderSpy).not.toHaveBeenCalled();
    expect(getCredentialSpy).not.toHaveBeenCalledWith('openai');
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
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}').manager,
    });

    const createResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_CREATE', {
        config: { provider: 'openai', model: 'gpt-4o-mini' },
      }),
    );

    expect(createResponse.success).toBe(true);
    expect(createResponse.data?.session.config.id).toBeTruthy();

    const listResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_LIST', undefined),
    );
    expect(listResponse.success).toBe(true);
    expect(listResponse.data?.sessions).toHaveLength(1);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'EVENT_SESSION_UPDATE',
        payload: expect.objectContaining({ reason: 'created' }),
      }),
    );
  });

  it('lists, updates, and deletes saved workflows through workflow messages', async () => {
    await chrome.storage.local.set({
      savedWorkflows: {
        version: 1,
        items: [
          createSavedWorkflow('workflow-1'),
          createSavedWorkflow('workflow-2', { name: 'Billing retry' }),
        ],
      },
    });

    const runtime = new UISessionRuntime({
      bridge: createBridge(async (action) => ({
        actionId: action.id,
        success: true,
        duration: 5,
      })),
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}').manager,
    });

    const listResponse = await runtime.handleMessage(
      createExtensionMessage('WORKFLOW_LIST', undefined),
    );
    expect(listResponse.success).toBe(true);
    expect(listResponse.data?.workflows.map((workflow) => workflow.id)).toEqual([
      'workflow-1',
      'workflow-2',
    ]);

    const updateResponse = await runtime.handleMessage(
      createExtensionMessage('WORKFLOW_UPDATE', {
        workflowId: 'workflow-1',
        updates: {
          name: 'Checkout regression',
          description: 'Updated workflow metadata.',
          tags: ['qa', 'edited'],
        },
      }),
    );

    expect(updateResponse.success).toBe(true);
    expect(updateResponse.data?.workflow).toEqual(
      expect.objectContaining({
        id: 'workflow-1',
        name: 'Checkout regression',
        description: 'Updated workflow metadata.',
        tags: ['qa', 'edited'],
        actions: expect.arrayContaining([
          expect.objectContaining({ action: expect.objectContaining({ type: 'click' }) }),
        ]),
        source: expect.objectContaining({ sessionName: 'Regression pass' }),
      }),
    );

    const storedAfterUpdate = await chrome.storage.local.get('savedWorkflows');
    expect(storedAfterUpdate.savedWorkflows.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'workflow-1',
          name: 'Checkout regression',
          description: 'Updated workflow metadata.',
          tags: ['qa', 'edited'],
        }),
      ]),
    );

    const deleteResponse = await runtime.handleMessage(
      createExtensionMessage('WORKFLOW_DELETE', { workflowId: 'workflow-2' }),
    );
    expect(deleteResponse.success).toBe(true);
    expect(deleteResponse.data?.workflowId).toBe('workflow-2');

    const storedAfterDelete = await chrome.storage.local.get('savedWorkflows');
    expect(storedAfterDelete.savedWorkflows.items).toEqual([
      expect.objectContaining({ id: 'workflow-1', name: 'Checkout regression' }),
    ]);
  });

  it('creates a saved workflow through workflow messages with normalized metadata', async () => {
    const runtime = new UISessionRuntime({
      bridge: createBridge(async (action) => ({
        actionId: action.id,
        success: true,
        duration: 5,
      })),
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}').manager,
    });

    const createResponse = await runtime.handleMessage(
      createExtensionMessage('WORKFLOW_CREATE', {
        name: '  Checkout handoff  ',
        description: '  Replays the saved checkout handoff.  ',
        tags: [' qa ', 'smoke', 'qa', ''],
        actions: createSavedWorkflow('workflow-create-source').actions,
        source: {
          sessionId: ' session-1 ',
          sessionName: '  Checkout recorder  ',
          recordedAt: 1_710_000_001_000.9,
        },
      }),
    );

    expect(createResponse.success).toBe(true);
    expect(createResponse.data?.workflow).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        name: 'Checkout handoff',
        description: 'Replays the saved checkout handoff.',
        tags: ['qa', 'smoke'],
        actions: createSavedWorkflow('workflow-create-source').actions,
        source: {
          sessionId: 'session-1',
          sessionName: 'Checkout recorder',
          recordedAt: 1_710_000_001_000,
        },
      }),
    );

    const stored = await chrome.storage.local.get('savedWorkflows');
    expect(stored.savedWorkflows.items).toHaveLength(1);
    expect(stored.savedWorkflows.items[0]).toEqual(createResponse.data?.workflow);
  });

  it('loads a saved workflow into the session and starts playback immediately', async () => {
    vi.useFakeTimers();

    const workflow = createSavedWorkflow('workflow-run-1');
    await chrome.storage.local.set({
      savedWorkflows: {
        version: 1,
        items: [workflow],
      },
    });

    const actionHandler = vi.fn(
      async (action: Action): Promise<ActionResult> => ({
        actionId: action.id,
        success: true,
        duration: 5,
      }),
    );
    const runtime = new UISessionRuntime({
      bridge: createBridge(actionHandler),
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}').manager,
    });

    const createResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_CREATE', {
        config: { provider: 'openai', model: 'gpt-4o-mini' },
      }),
    );
    const sessionId = createResponse.data?.session.config.id;

    const runResponse = await runtime.handleMessage(
      createExtensionMessage('WORKFLOW_RUN', {
        workflowId: 'workflow-run-1',
        sessionId: sessionId!,
      }),
    );

    expect(runResponse.success).toBe(true);
    expect(runResponse.data?.workflow.id).toBe('workflow-run-1');
    expect(runResponse.data?.session.recording.actions).toEqual(workflow.actions);
    expect(runResponse.data?.session.playback).toEqual(
      expect.objectContaining({ status: 'playing', nextActionIndex: 0 }),
    );

    const sessionBroadcasts = vi
      .mocked(chrome.runtime.sendMessage)
      .mock.calls.map(([message]) => message)
      .filter(
        (message): message is ExtensionMessage =>
          typeof message === 'object' &&
          message !== null &&
          'type' in message &&
          (message as ExtensionMessage).type === 'EVENT_SESSION_UPDATE',
      );
    expect(sessionBroadcasts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            sessionId: sessionId,
            reason: 'updated',
            session: expect.objectContaining({
              recording: expect.objectContaining({ actions: workflow.actions }),
              playback: expect.objectContaining({ status: 'playing' }),
            }),
          }),
        }),
      ]),
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(actionHandler).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(actionHandler).toHaveBeenCalledTimes(2);

    const stateResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_GET_STATE', { sessionId: sessionId! }),
    );
    expect(stateResponse.data?.session?.recording.actions).toEqual(workflow.actions);
    expect(stateResponse.data?.session?.playback).toEqual(
      expect.objectContaining({ status: 'idle', nextActionIndex: 2 }),
    );
  });

  it('synchronizes an ordered tab snapshot into the AI context', async () => {
    (chrome.tabs as MockTabsApi)._setTabs?.([
      {
        id: 7,
        index: 2,
        windowId: 1,
        highlighted: false,
        active: false,
        pinned: false,
        incognito: false,
        url: 'https://docs.example.com',
        title: 'Docs',
        status: 'complete',
        discarded: false,
        autoDiscardable: true,
        groupId: -1,
      },
      {
        id: 3,
        index: 0,
        windowId: 1,
        highlighted: true,
        active: true,
        pinned: false,
        incognito: false,
        url: 'https://app.example.com',
        title: 'App',
        status: 'complete',
        discarded: false,
        autoDiscardable: true,
        groupId: -1,
      },
    ]);

    const ai = createAIManager('{"summary":"noop","actions":[]}');
    const runtime = new UISessionRuntime({
      bridge: createBridge(async (action) => ({
        actionId: action.id,
        success: true,
        duration: 5,
      })),
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: ai.manager,
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
        message: 'Describe the current tabs',
      }),
    );

    expect(sendResponse.success).toBe(true);
    const userMessage = [...ai.provider.lastMessages]
      .reverse()
      .find((message) => message.role === 'user');
    expect(typeof userMessage?.content).toBe('string');
    const userContent = userMessage?.content as string;
    expect(userContent).toContain('## Tabs');
    expect(userContent).toContain('[0] id=3 markers=target, active, complete');
    expect(userContent).toContain('[1] id=7 markers=complete');
    expect(userContent).not.toContain('title=');
    expect(userContent).not.toContain('App');
    expect(userContent).not.toContain('Docs');

    const stateResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_GET_STATE', { sessionId: sessionId! }),
    );

    expect(stateResponse.data?.session?.tabSnapshot).toEqual([
      expect.objectContaining({ tabIndex: 0, id: 3, isTarget: true, isActive: true }),
      expect.objectContaining({ tabIndex: 1, id: 7, isTarget: false, isActive: false }),
    ]);
  });

  it('streams an AI plan, executes the action, and persists the UI-facing summary', async () => {
    const actionHandler = vi.fn(
      async (action: Action): Promise<ActionResult> => ({
        actionId: action.id,
        success: true,
        duration: 12,
        data: { clicked: true },
      }),
    );
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
      ).manager,
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
    expect(bridge.send).toHaveBeenCalledWith(
      1,
      'GET_PAGE_CONTEXT',
      { includeChildFrames: true },
      { frameId: 0 },
    );
    expect(bridge.send).toHaveBeenCalledWith(
      1,
      'EXECUTE_ACTION',
      expect.objectContaining({
        action: expect.objectContaining({
          type: 'click',
          selector: { role: 'button', textExact: 'Submit' },
        }),
      }),
      { frameId: 0 },
    );
    expect(bridge.sendOneWay).toHaveBeenCalledWith(
      1,
      'HIGHLIGHT_ELEMENT',
      expect.objectContaining({ selector: { role: 'button', textExact: 'Submit' } }),
      { frameId: 0 },
    );
    expect(actionHandler).toHaveBeenCalledTimes(1);

    const broadcastCalls = vi
      .mocked(chrome.runtime.sendMessage)
      .mock.calls.map(([message]) => message);
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

  it('lazy-registers only the active provider when using the default AI client manager', async () => {
    const createProviderSpy = vi
      .spyOn(providerLoader, 'createProvider')
      .mockImplementation(async (type) => createLazyLoadedProvider(type));

    try {
      const runtime = new UISessionRuntime({
        bridge: createBridge(async (action) => ({
          actionId: action.id,
          success: true,
          duration: 5,
        })),
        logger: new Logger('FluxSW:test', 'debug'),
      });

      const createResponse = await runtime.handleMessage(
        createExtensionMessage('SESSION_CREATE', {
          config: { provider: 'openai', model: 'gpt-4o-mini' },
        }),
      );
      const sessionId = createResponse.data?.session.config.id;

      const firstResponse = await runtime.handleMessage(
        createExtensionMessage('SESSION_SEND_MESSAGE', {
          sessionId: sessionId!,
          message: 'Say hi',
        }),
      );
      expect(firstResponse.success).toBe(true);

      const secondResponse = await runtime.handleMessage(
        createExtensionMessage('SESSION_SEND_MESSAGE', {
          sessionId: sessionId!,
          message: 'Say hi again',
        }),
      );
      expect(secondResponse.success).toBe(true);

      expect(createProviderSpy).toHaveBeenCalledTimes(1);
      expect(createProviderSpy).toHaveBeenCalledWith('openai');
    } finally {
      createProviderSpy.mockRestore();
    }
  });

  it('routes iframe DOM actions to the resolved frame target when selector.frame uses url matching', async () => {
    const actionHandler = vi.fn(
      async (action: Action): Promise<ActionResult> => ({
        actionId: action.id,
        success: true,
        duration: 5,
      }),
    );
    const bridge = createBridge(actionHandler);

    const runtime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager(
        JSON.stringify({
          summary: 'Click the continue button inside the checkout iframe',
          actions: [
            {
              id: 'iframe-click-1',
              type: 'click',
              selector: {
                textExact: 'Continue',
                role: 'button',
                frame: {
                  mode: 'url',
                  urlPattern: 'https://pay.example.com/*',
                },
              },
            },
          ],
        }),
      ).manager,
      networkInterceptionManager: createNetworkManagerStub(),
      deviceEmulationManager: createDeviceManagerStub(),
    });

    bridge.emitEvent(
      'PAGE_LOADED',
      1,
      {
        tabId: 1,
        frameId: 7,
        documentId: 'frame-doc-7',
        parentFrameId: 0,
        url: 'https://pay.example.com/embedded-checkout',
        origin: 'https://pay.example.com',
        isTop: false,
      },
      {
        url: 'https://pay.example.com/embedded-checkout',
        title: 'Embedded Checkout',
        isTop: false,
      },
    );

    const createResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_CREATE', {
        config: { provider: 'openai', model: 'gpt-4o-mini' },
      }),
    );
    const sessionId = createResponse.data?.session.config.id;

    const sendResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_SEND_MESSAGE', {
        sessionId: sessionId!,
        message: 'Click continue in the embedded checkout frame',
      }),
    );

    expect(sendResponse.success).toBe(true);
    expect(bridge.send).toHaveBeenCalledWith(
      1,
      'EXECUTE_ACTION',
      expect.objectContaining({
        action: expect.objectContaining({
          type: 'click',
          selector: expect.objectContaining({
            frame: expect.objectContaining({
              mode: 'url',
              urlPattern: 'https://pay.example.com/*',
            }),
          }),
        }),
      }),
      { frameId: 7, documentId: 'frame-doc-7' },
    );
  });

  it('retries recoverable action failures before succeeding', async () => {
    const actionHandler = vi.fn(
      async (_action: Action): Promise<ActionResult> => ({
        actionId: 'action-retry',
        success: true,
        duration: 9,
        data: { clicked: true },
      }),
    );

    actionHandler
      .mockResolvedValueOnce({
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
      ).manager,
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

  it('stores recorded click actions with selector position and frame context', async () => {
    const bridge = createBridge(
      async (action: Action): Promise<ActionResult> => ({
        actionId: action.id,
        success: true,
        duration: 5,
      }),
    );
    const runtime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}').manager,
    });

    const createResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_CREATE', {
        config: { provider: 'openai', model: 'gpt-4o-mini' },
      }),
    );
    const sessionId = createResponse.data?.session.config.id;

    const startResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_RECORDING_START', {
        sessionId: sessionId!,
      }),
    );

    expect(startResponse.success).toBe(true);
    expect(bridge.sendOneWay).toHaveBeenCalledWith(
      1,
      'SET_RECORDING_STATE',
      { active: true },
      { frameId: 0 },
    );

    bridge.emitEvent(
      'RECORDED_CLICK',
      1,
      {
        tabId: 1,
        frameId: 7,
        documentId: 'frame-doc-7',
        parentFrameId: 0,
        url: 'https://example.com/embedded',
        origin: 'https://example.com',
        isTop: false,
      },
      {
        action: {
          id: 'recorded-click-1',
          type: 'click',
          selector: { testId: 'save-button' },
          position: { x: 6, y: -4 },
        },
      },
    );

    const stateResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_GET_STATE', { sessionId: sessionId! }),
    );

    expect(stateResponse.data?.session?.recording.status).toBe('recording');
    expect(stateResponse.data?.session?.recording.actions).toHaveLength(1);
    expect(stateResponse.data?.session?.recording.actions[0]?.action).toEqual(
      expect.objectContaining({
        type: 'click',
        selector: {
          testId: 'save-button',
          frame: { mode: 'documentId', documentId: 'frame-doc-7' },
        },
        position: { x: 6, y: -4 },
      }),
    );

    const stopResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_RECORDING_STOP', {
        sessionId: sessionId!,
      }),
    );

    expect(stopResponse.success).toBe(true);
    expect(bridge.sendOneWay).toHaveBeenLastCalledWith(
      1,
      'SET_RECORDING_STATE',
      { active: false },
      { frameId: 0 },
    );
  });

  it('pauses recording without appending new actions, then resumes without clearing prior actions', async () => {
    (chrome.tabs as MockTabsApi)._setTabs?.([
      {
        id: 1,
        index: 0,
        windowId: 1,
        highlighted: true,
        active: true,
        pinned: false,
        incognito: false,
        url: 'https://example.com/form',
        title: 'Form',
        status: 'complete',
        discarded: false,
        autoDiscardable: true,
        groupId: -1,
      },
    ]);

    const bridge = createBridge(
      async (action: Action): Promise<ActionResult> => ({
        actionId: action.id,
        success: true,
        duration: 5,
      }),
    );
    const runtime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}').manager,
    });

    const createResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_CREATE', {
        config: { provider: 'openai', model: 'gpt-4o-mini' },
      }),
    );
    const sessionId = createResponse.data?.session.config.id;
    const topFrame = {
      tabId: 1,
      frameId: 0,
      documentId: 'main-doc',
      parentFrameId: null,
      url: 'https://example.com/form',
      origin: 'https://example.com',
      isTop: true,
    };

    await runtime.handleMessage(
      createExtensionMessage('SESSION_RECORDING_START', {
        sessionId: sessionId!,
      }),
    );

    bridge.emitEvent('RECORDED_CLICK', 1, topFrame, {
      action: {
        id: 'recorded-click-before-pause',
        type: 'click',
        selector: { testId: 'save-button' },
      },
    });

    await runtime.handleMessage(
      createExtensionMessage('SESSION_RECORDING_PAUSE', {
        sessionId: sessionId!,
      }),
    );

    bridge.emitEvent('RECORDED_CLICK', 1, topFrame, {
      action: {
        id: 'recorded-click-during-pause',
        type: 'click',
        selector: { testId: 'ignored-button' },
      },
    });

    let stateResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_GET_STATE', { sessionId: sessionId! }),
    );
    expect(stateResponse.data?.session?.recording.status).toBe('paused');
    expect(stateResponse.data?.session?.recording.actions.map((entry) => entry.action.id)).toEqual([
      'recorded-click-before-pause',
    ]);

    await runtime.handleMessage(
      createExtensionMessage('SESSION_RECORDING_RESUME', {
        sessionId: sessionId!,
      }),
    );

    bridge.emitEvent('RECORDED_CLICK', 1, topFrame, {
      action: {
        id: 'recorded-click-after-resume',
        type: 'click',
        selector: { testId: 'resume-button' },
      },
    });

    stateResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_GET_STATE', { sessionId: sessionId! }),
    );
    expect(stateResponse.data?.session?.recording.status).toBe('recording');
    expect(stateResponse.data?.session?.recording.actions.map((entry) => entry.action.id)).toEqual([
      'recorded-click-before-pause',
      'recorded-click-after-resume',
    ]);
  });

  it('rejects recording start and resume while playback is not idle', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-09T00:00:00.000Z'));

    const bridge = createBridge(
      async (action: Action): Promise<ActionResult> => ({
        actionId: action.id,
        success: true,
        duration: 5,
      }),
    );
    const runtime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}').manager,
    });

    const createResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_CREATE', {
        config: { provider: 'openai', model: 'gpt-4o-mini' },
      }),
    );
    const sessionId = createResponse.data?.session.config.id;
    const topFrame = {
      tabId: 1,
      frameId: 0,
      documentId: 'main-doc',
      parentFrameId: null,
      url: 'https://example.com/form',
      origin: 'https://example.com',
      isTop: true,
    };

    await runtime.handleMessage(
      createExtensionMessage('SESSION_RECORDING_START', { sessionId: sessionId! }),
    );
    bridge.emitEvent('RECORDED_CLICK', 1, topFrame, {
      action: {
        id: 'recorded-click-1',
        type: 'click',
        selector: { testId: 'submit' },
      },
    });
    vi.setSystemTime(new Date('2026-03-09T00:00:01.000Z'));
    bridge.emitEvent('RECORDED_CLICK', 1, topFrame, {
      action: {
        id: 'recorded-click-2',
        type: 'click',
        selector: { testId: 'submit-2' },
      },
    });
    await runtime.handleMessage(
      createExtensionMessage('SESSION_RECORDING_STOP', { sessionId: sessionId! }),
    );

    await runtime.handleMessage(
      createExtensionMessage('SESSION_PLAYBACK_START', { sessionId: sessionId! }),
    );
    await vi.advanceTimersByTimeAsync(0);

    await expect(
      runtime.handleMessage(
        createExtensionMessage('SESSION_RECORDING_START', { sessionId: sessionId! }),
      ),
    ).rejects.toMatchObject({ code: 'ACTION_INVALID' });

    await runtime.handleMessage(
      createExtensionMessage('SESSION_PLAYBACK_PAUSE', { sessionId: sessionId! }),
    );

    await expect(
      runtime.handleMessage(
        createExtensionMessage('SESSION_RECORDING_RESUME', { sessionId: sessionId! }),
      ),
    ).rejects.toMatchObject({ code: 'ACTION_INVALID' });
  });

  it('restarts recording with a fresh action list after an earlier recording', async () => {
    const bridge = createBridge(
      async (action: Action): Promise<ActionResult> => ({
        actionId: action.id,
        success: true,
        duration: 5,
      }),
    );
    const runtime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}').manager,
    });

    const createResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_CREATE', {
        config: { provider: 'openai', model: 'gpt-4o-mini' },
      }),
    );
    const sessionId = createResponse.data?.session.config.id;
    const topFrame = {
      tabId: 1,
      frameId: 0,
      documentId: 'main-doc',
      parentFrameId: null,
      url: 'https://example.com/form',
      origin: 'https://example.com',
      isTop: true,
    };

    await runtime.handleMessage(
      createExtensionMessage('SESSION_RECORDING_START', {
        sessionId: sessionId!,
      }),
    );
    bridge.emitEvent('RECORDED_CLICK', 1, topFrame, {
      action: {
        id: 'recorded-click-first-session',
        type: 'click',
        selector: { testId: 'save-button' },
      },
    });
    await runtime.handleMessage(
      createExtensionMessage('SESSION_RECORDING_STOP', {
        sessionId: sessionId!,
      }),
    );

    await runtime.handleMessage(
      createExtensionMessage('SESSION_RECORDING_START', {
        sessionId: sessionId!,
      }),
    );

    const stateResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_GET_STATE', { sessionId: sessionId! }),
    );
    expect(stateResponse.data?.session?.recording.status).toBe('recording');
    expect(stateResponse.data?.session?.recording.actions).toEqual([]);
  });

  it('sends start, pause, resume, and stop recording state updates to the target tab', async () => {
    const bridge = createBridge(
      async (action: Action): Promise<ActionResult> => ({
        actionId: action.id,
        success: true,
        duration: 5,
      }),
    );
    const runtime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}').manager,
    });

    const createResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_CREATE', {
        config: { provider: 'openai', model: 'gpt-4o-mini' },
      }),
    );
    const sessionId = createResponse.data?.session.config.id;

    await runtime.handleMessage(
      createExtensionMessage('SESSION_RECORDING_START', {
        sessionId: sessionId!,
      }),
    );
    await runtime.handleMessage(
      createExtensionMessage('SESSION_RECORDING_PAUSE', {
        sessionId: sessionId!,
      }),
    );
    await runtime.handleMessage(
      createExtensionMessage('SESSION_RECORDING_RESUME', {
        sessionId: sessionId!,
      }),
    );
    await runtime.handleMessage(
      createExtensionMessage('SESSION_RECORDING_STOP', {
        sessionId: sessionId!,
      }),
    );

    expect(bridge.sendOneWay).toHaveBeenNthCalledWith(
      1,
      1,
      'SET_RECORDING_STATE',
      { active: true },
      { frameId: 0 },
    );
    expect(bridge.sendOneWay).toHaveBeenNthCalledWith(
      2,
      1,
      'SET_RECORDING_STATE',
      { active: false },
      { frameId: 0 },
    );
    expect(bridge.sendOneWay).toHaveBeenNthCalledWith(
      3,
      1,
      'SET_RECORDING_STATE',
      { active: true },
      { frameId: 0 },
    );
    expect(bridge.sendOneWay).toHaveBeenNthCalledWith(
      4,
      1,
      'SET_RECORDING_STATE',
      { active: false },
      { frameId: 0 },
    );
  });

  it('stores recorded fill actions with typed values and iframe frame context', async () => {
    const bridge = createBridge(
      async (action: Action): Promise<ActionResult> => ({
        actionId: action.id,
        success: true,
        duration: 5,
      }),
    );
    const runtime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}').manager,
    });

    const createResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_CREATE', {
        config: { provider: 'openai', model: 'gpt-4o-mini' },
      }),
    );
    const sessionId = createResponse.data?.session.config.id;

    const startResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_RECORDING_START', {
        sessionId: sessionId!,
      }),
    );

    expect(startResponse.success).toBe(true);

    bridge.emitEvent(
      'RECORDED_INPUT',
      1,
      {
        tabId: 1,
        frameId: 7,
        documentId: 'frame-doc-7',
        parentFrameId: 0,
        url: 'https://example.com/embedded',
        origin: 'https://example.com',
        isTop: false,
      },
      {
        action: {
          id: 'recorded-input-1',
          type: 'fill',
          selector: { testId: 'email-field' },
          value: 'alice@example.com',
        },
      },
    );

    const stateResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_GET_STATE', { sessionId: sessionId! }),
    );

    expect(stateResponse.data?.session?.recording.actions).toHaveLength(1);
    expect(stateResponse.data?.session?.recording.actions[0]?.action).toEqual(
      expect.objectContaining({
        type: 'fill',
        selector: {
          testId: 'email-field',
          frame: { mode: 'documentId', documentId: 'frame-doc-7' },
        },
        value: 'alice@example.com',
      }),
    );
  });

  it('ignores recorded input events when recording is inactive', async () => {
    const bridge = createBridge(
      async (action: Action): Promise<ActionResult> => ({
        actionId: action.id,
        success: true,
        duration: 5,
      }),
    );
    const runtime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}').manager,
    });

    const createResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_CREATE', {
        config: { provider: 'openai', model: 'gpt-4o-mini' },
      }),
    );
    const sessionId = createResponse.data?.session.config.id;

    bridge.emitEvent(
      'RECORDED_INPUT',
      1,
      {
        tabId: 1,
        frameId: 0,
        documentId: 'main-doc',
        parentFrameId: null,
        url: 'https://example.com/form',
        origin: 'https://example.com',
        isTop: true,
      },
      {
        action: {
          id: 'recorded-input-inactive',
          type: 'fill',
          selector: { testId: 'email-field' },
          value: 'ignored@example.com',
        },
      },
    );

    const stateResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_GET_STATE', { sessionId: sessionId! }),
    );

    expect(stateResponse.data?.session?.recording.status).toBe('idle');
    expect(stateResponse.data?.session?.recording.actions).toHaveLength(0);
  });

  it('records top-frame navigation actions only while recording is active', async () => {
    (chrome.tabs as MockTabsApi)._setTabs?.([
      {
        id: 1,
        index: 0,
        windowId: 1,
        highlighted: true,
        active: true,
        pinned: false,
        incognito: false,
        url: 'https://example.com/form',
        title: 'Form',
        status: 'complete',
        discarded: false,
        autoDiscardable: true,
        groupId: -1,
      },
    ]);

    const bridge = createBridge(
      async (action: Action): Promise<ActionResult> => ({
        actionId: action.id,
        success: true,
        duration: 5,
      }),
    );
    const runtime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}').manager,
    });

    const createResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_CREATE', {
        config: { provider: 'openai', model: 'gpt-4o-mini' },
      }),
    );
    const sessionId = createResponse.data?.session.config.id;

    bridge.emitEvent(
      'RECORDED_NAVIGATION',
      1,
      {
        tabId: 1,
        frameId: 0,
        documentId: 'main-doc',
        parentFrameId: null,
        url: 'https://example.com/form',
        origin: 'https://example.com',
        isTop: true,
      },
      {
        action: {
          id: 'recorded-navigation-inactive',
          type: 'navigate',
          url: 'https://example.com/ignored',
        },
      },
    );

    let stateResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_GET_STATE', { sessionId: sessionId! }),
    );
    expect(stateResponse.data?.session?.recording.actions).toHaveLength(0);

    await runtime.handleMessage(
      createExtensionMessage('SESSION_RECORDING_START', {
        sessionId: sessionId!,
      }),
    );

    bridge.emitEvent(
      'RECORDED_NAVIGATION',
      1,
      {
        tabId: 1,
        frameId: 0,
        documentId: 'main-doc',
        parentFrameId: null,
        url: 'https://example.com/form',
        origin: 'https://example.com',
        isTop: true,
      },
      {
        action: {
          id: 'recorded-navigation-1',
          type: 'navigate',
          url: 'https://example.com/dashboard?tab=activity',
        },
      },
    );

    stateResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_GET_STATE', { sessionId: sessionId! }),
    );
    expect(stateResponse.data?.session?.recording.actions).toHaveLength(1);
    expect(stateResponse.data?.session?.recording.actions[0]?.action).toEqual(
      expect.objectContaining({
        type: 'navigate',
        url: 'https://example.com/dashboard?tab=activity',
      }),
    );

    await runtime.handleMessage(
      createExtensionMessage('SESSION_RECORDING_STOP', {
        sessionId: sessionId!,
      }),
    );

    bridge.emitEvent(
      'RECORDED_NAVIGATION',
      1,
      {
        tabId: 1,
        frameId: 0,
        documentId: 'main-doc',
        parentFrameId: null,
        url: 'https://example.com/dashboard?tab=activity',
        origin: 'https://example.com',
        isTop: true,
      },
      {
        action: {
          id: 'recorded-navigation-after-stop',
          type: 'navigate',
          url: 'https://example.com/ignored-after-stop',
        },
      },
    );

    stateResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_GET_STATE', { sessionId: sessionId! }),
    );
    expect(stateResponse.data?.session?.recording.actions).toHaveLength(1);
  });

  it('deduplicates consecutive recorded navigation URLs', async () => {
    (chrome.tabs as MockTabsApi)._setTabs?.([
      {
        id: 1,
        index: 0,
        windowId: 1,
        highlighted: true,
        active: true,
        pinned: false,
        incognito: false,
        url: 'https://example.com/form',
        title: 'Form',
        status: 'complete',
        discarded: false,
        autoDiscardable: true,
        groupId: -1,
      },
    ]);

    const bridge = createBridge(
      async (action: Action): Promise<ActionResult> => ({
        actionId: action.id,
        success: true,
        duration: 5,
      }),
    );
    const runtime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}').manager,
    });

    const createResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_CREATE', {
        config: { provider: 'openai', model: 'gpt-4o-mini' },
      }),
    );
    const sessionId = createResponse.data?.session.config.id;

    await runtime.handleMessage(
      createExtensionMessage('SESSION_RECORDING_START', {
        sessionId: sessionId!,
      }),
    );

    const frame = {
      tabId: 1,
      frameId: 0,
      documentId: 'main-doc',
      parentFrameId: null,
      url: 'https://example.com/form',
      origin: 'https://example.com',
      isTop: true,
    };

    bridge.emitEvent('RECORDED_NAVIGATION', 1, frame, {
      action: {
        id: 'recorded-navigation-1',
        type: 'navigate',
        url: 'https://example.com/checkout',
      },
    });
    bridge.emitEvent('RECORDED_NAVIGATION', 1, frame, {
      action: {
        id: 'recorded-navigation-2',
        type: 'navigate',
        url: 'https://example.com/checkout',
      },
    });

    const stateResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_GET_STATE', { sessionId: sessionId! }),
    );
    expect(stateResponse.data?.session?.recording.actions).toHaveLength(1);
    expect(stateResponse.data?.session?.recording.actions[0]?.action).toEqual(
      expect.objectContaining({ type: 'navigate', url: 'https://example.com/checkout' }),
    );
  });

  it('ignores iframe navigation events for top-level recording', async () => {
    (chrome.tabs as MockTabsApi)._setTabs?.([
      {
        id: 1,
        index: 0,
        windowId: 1,
        highlighted: true,
        active: true,
        pinned: false,
        incognito: false,
        url: 'https://example.com/form',
        title: 'Form',
        status: 'complete',
        discarded: false,
        autoDiscardable: true,
        groupId: -1,
      },
    ]);

    const bridge = createBridge(
      async (action: Action): Promise<ActionResult> => ({
        actionId: action.id,
        success: true,
        duration: 5,
      }),
    );
    const runtime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}').manager,
    });

    const createResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_CREATE', {
        config: { provider: 'openai', model: 'gpt-4o-mini' },
      }),
    );
    const sessionId = createResponse.data?.session.config.id;

    await runtime.handleMessage(
      createExtensionMessage('SESSION_RECORDING_START', {
        sessionId: sessionId!,
      }),
    );

    bridge.emitEvent(
      'RECORDED_NAVIGATION',
      1,
      {
        tabId: 1,
        frameId: 7,
        documentId: 'frame-doc-7',
        parentFrameId: 0,
        url: 'https://pay.example.com/embedded',
        origin: 'https://pay.example.com',
        isTop: false,
      },
      {
        action: {
          id: 'recorded-navigation-iframe',
          type: 'navigate',
          url: 'https://pay.example.com/embedded#step-2',
        },
      },
    );

    const stateResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_GET_STATE', { sessionId: sessionId! }),
    );
    expect(stateResponse.data?.session?.recording.actions).toHaveLength(0);
  });

  it('records top-frame full page navigations from PAGE_LOADED while recording', async () => {
    (chrome.tabs as MockTabsApi)._setTabs?.([
      {
        id: 1,
        index: 0,
        windowId: 1,
        highlighted: true,
        active: true,
        pinned: false,
        incognito: false,
        url: 'https://example.com/form',
        title: 'Form',
        status: 'complete',
        discarded: false,
        autoDiscardable: true,
        groupId: -1,
      },
    ]);

    const bridge = createBridge(
      async (action: Action): Promise<ActionResult> => ({
        actionId: action.id,
        success: true,
        duration: 5,
      }),
    );
    const runtime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}').manager,
    });

    const createResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_CREATE', {
        config: { provider: 'openai', model: 'gpt-4o-mini' },
      }),
    );
    const sessionId = createResponse.data?.session.config.id;

    await runtime.handleMessage(
      createExtensionMessage('SESSION_RECORDING_START', {
        sessionId: sessionId!,
      }),
    );

    bridge.emitEvent(
      'PAGE_LOADED',
      1,
      {
        tabId: 1,
        frameId: 0,
        documentId: 'main-doc-2',
        parentFrameId: null,
        url: 'https://example.com/orders',
        origin: 'https://example.com',
        isTop: true,
      },
      {
        url: 'https://example.com/orders',
        title: 'Orders',
        isTop: true,
      },
    );

    const stateResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_GET_STATE', { sessionId: sessionId! }),
    );
    expect(stateResponse.data?.session?.recording.actions).toHaveLength(1);
    expect(stateResponse.data?.session?.recording.actions[0]?.action).toEqual(
      expect.objectContaining({ type: 'navigate', url: 'https://example.com/orders' }),
    );
  });

  it('plays back recorded actions with timestamp-based delays, pause/resume, and stop reset', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-09T00:00:00.000Z'));

    const actionHandler = vi.fn(
      async (action: Action): Promise<ActionResult> => ({
        actionId: action.id,
        success: true,
        duration: 5,
      }),
    );
    const bridge = createBridge(actionHandler);
    const runtime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}').manager,
    });

    const createResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_CREATE', {
        config: { provider: 'openai', model: 'gpt-4o-mini' },
      }),
    );
    const sessionId = createResponse.data?.session.config.id;
    const topFrame = {
      tabId: 1,
      frameId: 0,
      documentId: 'main-doc',
      parentFrameId: null,
      url: 'https://example.com/form',
      origin: 'https://example.com',
      isTop: true,
    };

    await runtime.handleMessage(
      createExtensionMessage('SESSION_RECORDING_START', { sessionId: sessionId! }),
    );

    bridge.emitEvent('RECORDED_CLICK', 1, topFrame, {
      action: {
        id: 'playback-click-1',
        type: 'click',
        selector: { testId: 'first-button' },
      },
    });
    vi.setSystemTime(new Date('2026-03-09T00:00:01.000Z'));
    bridge.emitEvent('RECORDED_CLICK', 1, topFrame, {
      action: {
        id: 'playback-click-2',
        type: 'click',
        selector: { testId: 'second-button' },
      },
    });

    await runtime.handleMessage(
      createExtensionMessage('SESSION_RECORDING_STOP', { sessionId: sessionId! }),
    );
    await runtime.handleMessage(
      createExtensionMessage('SESSION_PLAYBACK_SET_SPEED', { sessionId: sessionId!, speed: 2 }),
    );

    const startResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_PLAYBACK_START', { sessionId: sessionId! }),
    );
    expect(startResponse.success).toBe(true);

    await vi.advanceTimersByTimeAsync(0);
    expect(actionHandler).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(250);
    expect(actionHandler).toHaveBeenCalledTimes(1);

    const pauseResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_PLAYBACK_PAUSE', { sessionId: sessionId! }),
    );
    expect(pauseResponse.success).toBe(true);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(actionHandler).toHaveBeenCalledTimes(1);

    let stateResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_GET_STATE', { sessionId: sessionId! }),
    );
    expect(stateResponse.data?.session?.playback).toEqual(
      expect.objectContaining({
        status: 'paused',
        nextActionIndex: 1,
        speed: 2,
      }),
    );

    const resumeResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_PLAYBACK_RESUME', { sessionId: sessionId!, speed: 0.5 }),
    );
    expect(resumeResponse.success).toBe(true);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(actionHandler).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    expect(actionHandler).toHaveBeenCalledTimes(2);

    stateResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_GET_STATE', { sessionId: sessionId! }),
    );
    expect(stateResponse.data?.session?.playback).toEqual(
      expect.objectContaining({
        status: 'idle',
        nextActionIndex: 2,
        speed: 0.5,
        lastError: null,
      }),
    );
    expect(stateResponse.data?.session?.actionHistory).toHaveLength(2);

    actionHandler.mockClear();

    await runtime.handleMessage(
      createExtensionMessage('SESSION_PLAYBACK_START', { sessionId: sessionId!, speed: 1 }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(actionHandler).toHaveBeenCalledTimes(1);

    const stopResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_PLAYBACK_STOP', { sessionId: sessionId! }),
    );
    expect(stopResponse.success).toBe(true);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(actionHandler).toHaveBeenCalledTimes(1);

    stateResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_GET_STATE', { sessionId: sessionId! }),
    );
    expect(stateResponse.data?.session?.playback).toEqual(
      expect.objectContaining({
        status: 'idle',
        nextActionIndex: 0,
        speed: 1,
        startedAt: null,
      }),
    );
  });

  it('stops active playback through ACTION_ABORT and marks the current progress entry aborted', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-09T00:00:00.000Z'));

    const actionHandler = vi.fn(
      async (action: Action): Promise<ActionResult> => ({
        actionId: action.id,
        success: true,
        duration: 5,
      }),
    );
    const bridge = createBridge(actionHandler);
    const runtime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}').manager,
    });

    const createResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_CREATE', {
        config: { provider: 'openai', model: 'gpt-4o-mini' },
      }),
    );
    const sessionId = createResponse.data?.session.config.id;
    const topFrame = {
      tabId: 1,
      frameId: 0,
      documentId: 'main-doc',
      parentFrameId: null,
      url: 'https://example.com/form',
      origin: 'https://example.com',
      isTop: true,
    };

    await runtime.handleMessage(
      createExtensionMessage('SESSION_RECORDING_START', { sessionId: sessionId! }),
    );
    bridge.emitEvent('RECORDED_CLICK', 1, topFrame, {
      action: {
        id: 'recorded-click-1',
        type: 'click',
        selector: { testId: 'submit' },
      },
    });
    vi.setSystemTime(new Date('2026-03-09T00:00:01.000Z'));
    bridge.emitEvent('RECORDED_CLICK', 1, topFrame, {
      action: {
        id: 'recorded-click-2',
        type: 'click',
        selector: { testId: 'submit-2' },
      },
    });
    await runtime.handleMessage(
      createExtensionMessage('SESSION_RECORDING_STOP', { sessionId: sessionId! }),
    );

    vi.mocked(chrome.runtime.sendMessage).mockClear();

    await runtime.handleMessage(
      createExtensionMessage('SESSION_PLAYBACK_START', { sessionId: sessionId! }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(actionHandler).toHaveBeenCalledTimes(1);

    const abortResponse = await runtime.handleMessage(
      createExtensionMessage('ACTION_ABORT', { sessionId: sessionId! }),
    );
    expect(abortResponse.success).toBe(true);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(actionHandler).toHaveBeenCalledTimes(1);

    const stateResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_GET_STATE', { sessionId: sessionId! }),
    );
    expect(stateResponse.data?.session?.playback).toEqual(
      expect.objectContaining({
        status: 'idle',
        nextActionIndex: 0,
        startedAt: null,
      }),
    );

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'EVENT_SESSION_UPDATE',
        payload: expect.objectContaining({
          sessionId,
          session: expect.objectContaining({
            playback: expect.objectContaining({ status: 'idle', nextActionIndex: 0 }),
          }),
        }),
      }),
    );
  });

  it('rejects invalid playback transitions and invalid speed values', async () => {
    const bridge = createBridge(
      async (action: Action): Promise<ActionResult> => ({
        actionId: action.id,
        success: true,
        duration: 5,
      }),
    );
    const runtime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}').manager,
    });

    const createResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_CREATE', {
        config: { provider: 'openai', model: 'gpt-4o-mini' },
      }),
    );
    const sessionId = createResponse.data?.session.config.id;

    await expect(
      runtime.handleMessage(
        createExtensionMessage('SESSION_PLAYBACK_START', { sessionId: sessionId! }),
      ),
    ).rejects.toMatchObject({ code: 'ACTION_INVALID' });

    await runtime.handleMessage(
      createExtensionMessage('SESSION_RECORDING_START', { sessionId: sessionId! }),
    );

    const topFrame = {
      tabId: 1,
      frameId: 0,
      documentId: 'main-doc',
      parentFrameId: null,
      url: 'https://example.com/form',
      origin: 'https://example.com',
      isTop: true,
    };

    await expect(
      runtime.handleMessage(
        createExtensionMessage('SESSION_PLAYBACK_START', { sessionId: sessionId! }),
      ),
    ).rejects.toMatchObject({ code: 'ACTION_INVALID' });

    await expect(
      runtime.handleMessage(
        createExtensionMessage('SESSION_PLAYBACK_RESUME', { sessionId: sessionId! }),
      ),
    ).rejects.toMatchObject({ code: 'ACTION_INVALID' });

    await expect(
      runtime.handleMessage(
        createExtensionMessage('SESSION_PLAYBACK_SET_SPEED', { sessionId: sessionId!, speed: 3 }),
      ),
    ).rejects.toMatchObject({ code: 'ACTION_INVALID' });

    await runtime.handleMessage(createExtensionMessage('SESSION_START', { sessionId: sessionId! }));

    await expect(
      runtime.handleMessage(
        createExtensionMessage('SESSION_PLAYBACK_START', { sessionId: sessionId! }),
      ),
    ).rejects.toMatchObject({ code: 'ACTION_INVALID' });

    await runtime.handleMessage(createExtensionMessage('SESSION_PAUSE', { sessionId: sessionId! }));

    bridge.emitEvent('RECORDED_CLICK', 1, topFrame, {
      action: {
        id: 'recorded-click-1',
        type: 'click',
        selector: { testId: 'submit' },
      },
    });
    await runtime.handleMessage(
      createExtensionMessage('SESSION_RECORDING_STOP', { sessionId: sessionId! }),
    );

    (chrome.tabs as MockTabsApi)._setTabs?.([]);

    await expect(
      runtime.handleMessage(
        createExtensionMessage('SESSION_PLAYBACK_START', { sessionId: sessionId! }),
      ),
    ).rejects.toMatchObject({ code: 'TAB_NOT_FOUND' });
  });

  it('routes network interception actions to the background manager instead of the DOM bridge', async () => {
    const actionHandler = vi.fn(
      async (action: Action): Promise<ActionResult> => ({
        actionId: action.id,
        success: true,
        duration: 5,
      }),
    );
    const bridge = createBridge(actionHandler);
    const networkInterceptionManager = createNetworkManagerStub();

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
      ).manager,
      networkInterceptionManager,
      deviceEmulationManager: createDeviceManagerStub(),
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
    expect(bridge.send.mock.calls.filter(([, type]) => type === 'EXECUTE_ACTION')).toHaveLength(0);
  });

  it('routes device emulation actions to the background manager instead of the DOM bridge', async () => {
    const actionHandler = vi.fn(
      async (action: Action): Promise<ActionResult> => ({
        actionId: action.id,
        success: true,
        duration: 5,
      }),
    );
    const bridge = createBridge(actionHandler);
    const deviceEmulationManager = createDeviceManagerStub();

    const runtime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager(
        JSON.stringify({
          summary: 'Use the iPhone preset',
          actions: [
            { id: 'emu-1', type: 'emulateDevice', preset: 'iphone', orientation: 'portrait' },
          ],
        }),
      ).manager,
      networkInterceptionManager: createNetworkManagerStub(),
      deviceEmulationManager,
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
        message: 'Emulate an iPhone viewport',
      }),
    );

    expect(sendResponse.success).toBe(true);
    expect(deviceEmulationManager.applyAction).toHaveBeenCalledWith(
      sessionId,
      1,
      expect.objectContaining({
        type: 'emulateDevice',
        preset: 'iphone',
        orientation: 'portrait',
      }),
    );
    expect(actionHandler).not.toHaveBeenCalled();
    expect(bridge.send.mock.calls.filter(([, type]) => type === 'EXECUTE_ACTION')).toHaveLength(0);
  });

  it('routes geolocation mock actions to the background manager instead of the DOM bridge', async () => {
    const actionHandler = vi.fn(
      async (action: Action): Promise<ActionResult> => ({
        actionId: action.id,
        success: true,
        duration: 5,
      }),
    );
    const bridge = createBridge(actionHandler);
    const geolocationMockManager = createGeolocationManagerStub();

    const runtime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager(
        JSON.stringify({
          summary: 'Mock the browser location',
          actions: [
            {
              id: 'geo-1',
              type: 'mockGeolocation',
              latitude: 37.7749,
              longitude: -122.4194,
              accuracy: 25,
            },
          ],
        }),
      ).manager,
      networkInterceptionManager: createNetworkManagerStub(),
      deviceEmulationManager: createDeviceManagerStub(),
      geolocationMockManager,
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
        message: 'Pretend I am in San Francisco',
      }),
    );

    expect(sendResponse.success).toBe(true);
    expect(geolocationMockManager.applyAction).toHaveBeenCalledWith(
      sessionId,
      1,
      expect.objectContaining({
        type: 'mockGeolocation',
        latitude: 37.7749,
        longitude: -122.4194,
        accuracy: 25,
      }),
    );
    expect(actionHandler).not.toHaveBeenCalled();
    expect(bridge.send.mock.calls.filter(([, type]) => type === 'EXECUTE_ACTION')).toHaveLength(0);
  });

  it('stages uploads for the session and resolves them into uploadFile DOM actions', async () => {
    const actionHandler = vi.fn(
      async (action: Action): Promise<ActionResult> => ({
        actionId: action.id,
        success: true,
        duration: 8,
        data: { uploaded: true },
      }),
    );
    const bridge = createBridge(actionHandler);

    const runtime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager(
        JSON.stringify({
          summary: 'Upload the selected resume',
          actions: [
            {
              id: 'upload-1',
              type: 'uploadFile',
              selector: { css: '#resume-input' },
              fileIds: ['file-resume'],
            },
          ],
        }),
      ).manager,
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
        message: 'Upload the resume file',
        uploads: [
          {
            id: 'file-resume',
            name: 'resume.txt',
            mimeType: 'text/plain',
            size: 4,
            lastModified: 1700000000000,
            base64Data: 'dGVzdA==',
          },
        ],
      }),
    );

    expect(sendResponse.success).toBe(true);
    expect(bridge.send).toHaveBeenCalledWith(
      1,
      'EXECUTE_ACTION',
      expect.objectContaining({
        action: expect.objectContaining({ type: 'uploadFile', fileIds: ['file-resume'] }),
        context: expect.objectContaining({
          uploads: [
            expect.objectContaining({
              id: 'file-resume',
              name: 'resume.txt',
              base64Data: 'dGVzdA==',
            }),
          ],
        }),
      }),
      { frameId: 0 },
    );
  });

  it('clears network interception rules when a session is aborted', async () => {
    const networkInterceptionManager = createNetworkManagerStub();
    const deviceEmulationManager = createDeviceManagerStub();
    const geolocationMockManager = createGeolocationManagerStub();

    const runtime = new UISessionRuntime({
      bridge: createBridge(async (action) => ({
        actionId: action.id,
        success: true,
        duration: 5,
      })),
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}').manager,
      networkInterceptionManager,
      deviceEmulationManager,
      geolocationMockManager,
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
    expect(deviceEmulationManager.clearSession).toHaveBeenCalledWith(sessionId);
    expect(geolocationMockManager.clearSession).toHaveBeenCalledWith(sessionId);
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

    const networkInterceptionManager = createNetworkManagerStub();
    const deviceEmulationManager = createDeviceManagerStub();
    const geolocationMockManager = createGeolocationManagerStub();

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
      ).manager,
      networkInterceptionManager,
      deviceEmulationManager,
      geolocationMockManager,
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
    expect(deviceEmulationManager.clearSession).toHaveBeenCalledWith(sessionId);
    expect(geolocationMockManager.clearSession).toHaveBeenCalledWith(sessionId);
    expect(networkInterceptionManager.activateSession).toHaveBeenLastCalledWith(sessionId, 2);
    expect(deviceEmulationManager.activateSession).toHaveBeenLastCalledWith(sessionId, 2);
    expect(geolocationMockManager.activateSession).toHaveBeenLastCalledWith(sessionId, 2);

    const stateResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_GET_STATE', { sessionId: sessionId! }),
    );
    expect(stateResponse.data?.session?.tabSnapshot).toEqual([
      expect.objectContaining({ tabIndex: 0, id: 1, isTarget: false }),
      expect.objectContaining({ tabIndex: 1, id: 2, isTarget: true }),
    ]);
  });

  it('clears session managers before opening a new target tab', async () => {
    installCreatedTabCompletion('https://docs.example.com', 'load');

    const networkInterceptionManager = createNetworkManagerStub();
    const deviceEmulationManager = createDeviceManagerStub();
    const geolocationMockManager = createGeolocationManagerStub();

    const runtime = new UISessionRuntime({
      bridge: createBridge(async (action) => ({
        actionId: action.id,
        success: true,
        duration: 5,
      })),
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager(
        JSON.stringify({
          summary: 'Open docs in a new tab',
          actions: [{ id: 'new-tab-1', type: 'newTab', url: 'https://docs.example.com' }],
        }),
      ).manager,
      networkInterceptionManager,
      deviceEmulationManager,
      geolocationMockManager,
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
        message: 'Open docs in a new tab',
      }),
    );

    expect(sendResponse.success).toBe(true);
    expect(networkInterceptionManager.clearSession).toHaveBeenCalledWith(sessionId);
    expect(deviceEmulationManager.clearSession).toHaveBeenCalledWith(sessionId);
    expect(geolocationMockManager.clearSession).toHaveBeenCalledWith(sessionId);
    expect(networkInterceptionManager.activateSession).toHaveBeenLastCalledWith(sessionId, 2);
    expect(deviceEmulationManager.activateSession).toHaveBeenLastCalledWith(sessionId, 2);
    expect(geolocationMockManager.activateSession).toHaveBeenLastCalledWith(sessionId, 2);
  });

  it('switches tabs by the planned snapshot even if live tab order changes before execution', async () => {
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

    const ai = createAIManager(
      JSON.stringify({
        summary: 'Switch to the second tab',
        actions: [{ id: 'switch-snapshot', type: 'switchTab', tabIndex: 1 }],
      }),
    );

    vi.spyOn(ai.provider, 'chat').mockImplementation(async function* (messages: AIMessage[]) {
      this.lastMessages = messages;
      (chrome.tabs as MockTabsApi)._setTabs?.([
        {
          id: 2,
          index: 0,
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
        {
          id: 1,
          index: 1,
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
      ]);

      yield { type: 'text', content: '{"summary":"Switch to the second tab",' };
      yield {
        type: 'text',
        content: '"actions":[{"id":"switch-snapshot","type":"switchTab","tabIndex":1}]}',
      };
    });

    const runtime = new UISessionRuntime({
      bridge: createBridge(async (action) => ({
        actionId: action.id,
        success: true,
        duration: 5,
      })),
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: ai.manager,
      networkInterceptionManager: createNetworkManagerStub(),
      deviceEmulationManager: createDeviceManagerStub(),
      geolocationMockManager: createGeolocationManagerStub(),
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
    expect(chrome.tabs.update).toHaveBeenCalledWith(2, { active: true });
    expect(chrome.tabs.update).not.toHaveBeenCalledWith(1, { active: true });
  });

  it('waits for a new tab URL to finish loading before continuing cross-tab actions', async () => {
    installCreatedTabCompletion('https://docs.example.com', 'load');

    const bridge = createBridge(async (action) => ({
      actionId: action.id,
      success: true,
      duration: 5,
    }));

    bridge.send.mockImplementation(async (tabId: number, type: string, payload: unknown) => {
      const tab = (chrome.tabs as MockTabsApi)
        ._getTabs?.()
        .find((candidate) => candidate.id === tabId);

      if (tabId === 2 && tab?.status !== 'complete') {
        throw new Error(`Tab ${tabId} is still loading`);
      }

      if (type === 'GET_PAGE_CONTEXT') {
        return { context: createPageContext() };
      }

      if (type === 'EXECUTE_ACTION') {
        const request = payload as RequestPayloadMap['ACTION_EXECUTE'];
        return {
          result: {
            actionId: request.action.id,
            success: true,
            duration: 5,
          },
        };
      }

      throw new Error(`Unexpected bridge command: ${type}`);
    });

    const runtime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager(
        JSON.stringify({
          summary: 'Open docs in a new tab and click Start',
          actions: [
            {
              id: 'new-tab-sequence',
              type: 'newTab',
              url: 'https://docs.example.com',
            },
            {
              id: 'click-new-tab',
              type: 'click',
              selector: { role: 'button', textExact: 'Start' },
            },
          ],
        }),
      ).manager,
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
        message: 'Open docs in a new tab and click Start',
      }),
    );

    expect(sendResponse.success).toBe(true);
    expect(bridge.send).toHaveBeenCalledWith(
      2,
      'GET_PAGE_CONTEXT',
      { includeChildFrames: true },
      { frameId: 0 },
    );
    expect(bridge.send).toHaveBeenCalledWith(
      2,
      'EXECUTE_ACTION',
      expect.objectContaining({
        action: expect.objectContaining({
          id: 'click-new-tab',
          type: 'click',
        }),
      }),
      { frameId: 0 },
    );

    const stateResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_GET_STATE', { sessionId: sessionId! }),
    );
    expect(stateResponse.data?.session?.targetTabId).toBe(2);
  });

  it('clears session managers when closing the active session tab', async () => {
    const networkInterceptionManager = createNetworkManagerStub();
    const deviceEmulationManager = createDeviceManagerStub();
    const geolocationMockManager = createGeolocationManagerStub();

    const runtime = new UISessionRuntime({
      bridge: createBridge(async (action) => ({
        actionId: action.id,
        success: true,
        duration: 5,
      })),
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager(
        JSON.stringify({
          summary: 'Close the current tab',
          actions: [{ id: 'close-tab-1', type: 'closeTab' }],
        }),
      ).manager,
      networkInterceptionManager,
      deviceEmulationManager,
      geolocationMockManager,
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
        message: 'Close the current tab',
      }),
    );

    expect(sendResponse.success).toBe(true);
    expect(networkInterceptionManager.clearSession).toHaveBeenCalledWith(sessionId);
    expect(deviceEmulationManager.clearSession).toHaveBeenCalledWith(sessionId);
    expect(geolocationMockManager.clearSession).toHaveBeenCalledWith(sessionId);
    expect(networkInterceptionManager.activateSession).toHaveBeenLastCalledWith(sessionId, null);
    expect(deviceEmulationManager.activateSession).toHaveBeenLastCalledWith(sessionId, null);
    expect(geolocationMockManager.activateSession).toHaveBeenLastCalledWith(sessionId, null);
    expect(chrome.tabs.remove).toHaveBeenCalledWith(1);
  });

  it('retargets the session to a remaining tab after closing the current target tab', async () => {
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

    const networkInterceptionManager = createNetworkManagerStub();
    const deviceEmulationManager = createDeviceManagerStub();
    const geolocationMockManager = createGeolocationManagerStub();
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
          summary: 'Switch, close, then keep working in the remaining tab',
          actions: [
            { id: 'switch-2', type: 'switchTab', tabIndex: 1 },
            { id: 'close-2', type: 'closeTab' },
            {
              id: 'click-after-close',
              type: 'click',
              selector: { role: 'button', textExact: 'Submit' },
            },
          ],
        }),
      ).manager,
      networkInterceptionManager,
      deviceEmulationManager,
      geolocationMockManager,
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
        message: 'Switch, close, then keep working in the remaining tab',
      }),
    );

    expect(sendResponse.success).toBe(true);
    expect(networkInterceptionManager.activateSession).toHaveBeenLastCalledWith(sessionId, 1);
    expect(deviceEmulationManager.activateSession).toHaveBeenLastCalledWith(sessionId, 1);
    expect(geolocationMockManager.activateSession).toHaveBeenLastCalledWith(sessionId, 1);
    expect(bridge.send).toHaveBeenCalledWith(
      1,
      'EXECUTE_ACTION',
      expect.objectContaining({
        action: expect.objectContaining({
          id: 'click-after-close',
          type: 'click',
        }),
      }),
      { frameId: 0 },
    );

    const stateResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_GET_STATE', { sessionId: sessionId! }),
    );
    expect(stateResponse.data?.session?.targetTabId).toBe(1);
    expect(stateResponse.data?.session?.tabSnapshot).toEqual([
      expect.objectContaining({ tabIndex: 0, id: 1, isTarget: true }),
    ]);
  });

  it('reindexes the ordered tab snapshot after closing a non-target tab by tabIndex', async () => {
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
        url: 'https://middle.example.com',
        title: 'Middle',
        status: 'complete',
        discarded: false,
        autoDiscardable: true,
        groupId: -1,
      },
      {
        id: 3,
        index: 2,
        windowId: 1,
        highlighted: false,
        active: false,
        pinned: false,
        incognito: false,
        url: 'https://tail.example.com',
        title: 'Tail',
        status: 'complete',
        discarded: false,
        autoDiscardable: true,
        groupId: -1,
      },
    ]);

    const ai = createAIManager(
      JSON.stringify({
        summary: 'Close the middle tab',
        actions: [{ id: 'close-middle', type: 'closeTab', tabIndex: 1 }],
      }),
    );

    const runtime = new UISessionRuntime({
      bridge: createBridge(async (action) => ({
        actionId: action.id,
        success: true,
        duration: 5,
      })),
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: ai.manager,
    });

    const createResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_CREATE', {
        config: { provider: 'openai', model: 'gpt-4o-mini' },
      }),
    );
    const sessionId = createResponse.data?.session.config.id;

    const closeResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_SEND_MESSAGE', {
        sessionId: sessionId!,
        message: 'Close the middle tab',
      }),
    );

    expect(closeResponse.success).toBe(true);

    const stateResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_GET_STATE', { sessionId: sessionId! }),
    );
    expect(stateResponse.data?.session?.targetTabId).toBe(1);
    expect(stateResponse.data?.session?.tabSnapshot).toEqual([
      expect.objectContaining({ tabIndex: 0, id: 1, isTarget: true, isActive: true }),
      expect.objectContaining({ tabIndex: 1, id: 3, isTarget: false, isActive: false }),
    ]);
  });

  it('fails safely when a planned closeTab target disappears before execution', async () => {
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

    const ai = createAIManager(
      JSON.stringify({
        summary: 'Close the second tab',
        actions: [{ id: 'close-missing', type: 'closeTab', tabIndex: 1 }],
      }),
    );

    vi.spyOn(ai.provider, 'chat').mockImplementation(async function* (messages: AIMessage[]) {
      this.lastMessages = messages;
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
      ]);

      yield { type: 'text', content: '{"summary":"Close the second tab",' };
      yield {
        type: 'text',
        content: '"actions":[{"id":"close-missing","type":"closeTab","tabIndex":1}]}',
      };
    });

    const runtime = new UISessionRuntime({
      bridge: createBridge(async (action) => ({
        actionId: action.id,
        success: true,
        duration: 5,
      })),
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: ai.manager,
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
        message: 'Close the second tab',
      }),
    );

    expect(sendResponse.success).toBe(false);
    expect(sendResponse.error?.code).toBe('ACTION_FAILED');
    expect(sendResponse.error?.message).toContain('snapshot index 1');
    expect(chrome.tabs.remove).not.toHaveBeenCalled();
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
      ).manager,
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
    expect(bridge.send).toHaveBeenNthCalledWith(
      1,
      1,
      'GET_PAGE_CONTEXT',
      { includeChildFrames: true },
      { frameId: 0 },
    );
    expect(bridge.send).toHaveBeenNthCalledWith(
      2,
      1,
      'GET_PAGE_CONTEXT',
      { includeChildFrames: true },
      { frameId: 0 },
    );
  });

  it('routes savePdf actions through CDP debugger and triggers chrome.downloads', async () => {
    vi.spyOn(chrome.debugger, 'sendCommand').mockResolvedValue({ data: 'bW9jay1wZGYtZGF0YQ==' });

    const actionHandler = vi.fn(
      async (action: Action): Promise<ActionResult> => ({
        actionId: action.id,
        success: true,
        duration: 5,
      }),
    );
    const bridge = createBridge(actionHandler);

    const runtime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager(
        JSON.stringify({
          summary: 'Save the page as PDF',
          actions: [
            {
              id: 'pdf-1',
              type: 'savePdf',
              landscape: true,
              filename: 'report.pdf',
            },
          ],
        }),
      ).manager,
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
        message: 'Save this page as a PDF',
      }),
    );

    expect(sendResponse.success).toBe(true);
    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 1 },
      'Page.printToPDF',
      expect.objectContaining({ landscape: true }),
    );
    expect(chrome.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringContaining('data:application/pdf;base64,'),
        filename: 'report.pdf',
        saveAs: false,
      }),
    );
    expect(chrome.debugger.detach).toHaveBeenCalledWith({ tabId: 1 });
    expect(actionHandler).not.toHaveBeenCalled();
    expect(bridge.send.mock.calls.filter(([, type]) => type === 'EXECUTE_ACTION')).toHaveLength(0);

    const stateResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_GET_STATE', { sessionId: sessionId! }),
    );
    expect(stateResponse.data?.session?.actionHistory).toHaveLength(1);
    expect(stateResponse.data?.session?.actionHistory[0]?.result).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ filename: 'report.pdf' }),
      }),
    );
  });

  it('exports recorded sessions as json, playwright, and puppeteer downloads', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-09T12:34:56.789Z'));
    vi.mocked(chrome.downloads.download).mockClear();

    const bridge = createBridge(
      async (action: Action): Promise<ActionResult> => ({
        actionId: action.id,
        success: true,
        duration: 5,
      }),
    );
    const runtime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}').manager,
    });

    const createResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_CREATE', {
        config: { provider: 'openai', model: 'gpt-4o-mini', name: 'Checkout Flow' },
      }),
    );
    const sessionId = createResponse.data?.session.config.id;
    const topFrame = {
      tabId: 1,
      frameId: 0,
      documentId: 'main-doc',
      parentFrameId: null,
      url: 'https://example.com/form',
      origin: 'https://example.com',
      isTop: true,
    };
    const iframe = {
      tabId: 1,
      frameId: 7,
      documentId: 'frame-doc-7',
      parentFrameId: 0,
      url: 'https://pay.example.com/embedded',
      origin: 'https://pay.example.com',
      isTop: false,
    };

    await runtime.handleMessage(
      createExtensionMessage('SESSION_RECORDING_START', { sessionId: sessionId! }),
    );
    bridge.emitEvent('RECORDED_NAVIGATION', 1, topFrame, {
      action: {
        id: 'recorded-navigation-1',
        type: 'navigate',
        url: 'https://example.com/checkout',
        waitUntil: 'domContentLoaded',
      },
    });
    vi.setSystemTime(new Date('2026-03-09T12:34:58.289Z'));
    bridge.emitEvent('RECORDED_CLICK', 1, iframe, {
      action: {
        id: 'recorded-click-1',
        type: 'click',
        selector: {
          testId: 'pay-now',
          textExact: 'Pay now',
          nth: 1,
        },
      },
    });
    vi.setSystemTime(new Date('2026-03-09T12:35:00.789Z'));
    bridge.emitEvent('RECORDED_INPUT', 1, topFrame, {
      action: {
        id: 'recorded-input-1',
        type: 'fill',
        selector: { ariaLabel: 'Email address', placeholder: 'Email address' },
        value: 'alice@example.com',
      },
    });
    await runtime.handleMessage(
      createExtensionMessage('SESSION_RECORDING_STOP', { sessionId: sessionId! }),
    );

    const jsonResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_RECORDING_EXPORT', { sessionId: sessionId!, format: 'json' }),
    );
    expect(jsonResponse.success).toBe(true);
    expect(jsonResponse.data).toEqual(
      expect.objectContaining({
        downloadId: expect.any(Number),
        format: 'json',
        filename: 'recording-Checkout-Flow-json-2026-03-09T12-35-00-789Z.json',
      }),
    );

    const jsonDownloadCall = vi.mocked(chrome.downloads.download).mock.calls.at(-1)?.[0];
    expect(jsonDownloadCall).toEqual(
      expect.objectContaining({
        filename: 'recording-Checkout-Flow-json-2026-03-09T12-35-00-789Z.json',
        saveAs: false,
      }),
    );
    const jsonExport = JSON.parse(decodeDownloadTextUrl(jsonDownloadCall?.url ?? ''));
    expect(jsonExport).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        sessionId,
        sessionName: 'Checkout Flow',
        actionCount: 3,
        exportedAt: '2026-03-09T12:35:00.789Z',
      }),
    );
    expect(jsonExport.actions).toHaveLength(3);
    expect(jsonExport.actions[1].action.selector.frame).toEqual({
      mode: 'documentId',
      documentId: 'frame-doc-7',
    });
    expect(jsonExport.actions[2].action.value).toBe('[REDACTED_EMAIL]');

    const playwrightResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_RECORDING_EXPORT', {
        sessionId: sessionId!,
        format: 'playwright',
      }),
    );
    expect(playwrightResponse.success).toBe(true);
    expect(playwrightResponse.data).toEqual(
      expect.objectContaining({
        downloadId: expect.any(Number),
        format: 'playwright',
        filename: 'recording-Checkout-Flow-playwright-2026-03-09T12-35-00-789Z.js',
      }),
    );

    const playwrightDownloadCall = vi.mocked(chrome.downloads.download).mock.calls.at(-1)?.[0];
    expect(playwrightDownloadCall).toEqual(
      expect.objectContaining({
        filename: 'recording-Checkout-Flow-playwright-2026-03-09T12-35-00-789Z.js',
        saveAs: false,
      }),
    );
    const playwrightScript = decodeDownloadTextUrl(playwrightDownloadCall?.url ?? '');
    expect(playwrightScript).toContain("const { chromium } = require('playwright');");
    expect(playwrightScript).toContain('await page.waitForTimeout(delayMs);');
    expect(playwrightScript).toContain('[REDACTED_EMAIL]');
    expect(playwrightScript).not.toContain('alice@example.com');
    expect(playwrightScript).toContain('frame-doc-7');
    expect(playwrightScript).toContain('recording.actions[index]');

    const puppeteerResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_RECORDING_EXPORT', {
        sessionId: sessionId!,
        format: 'puppeteer',
      }),
    );
    expect(puppeteerResponse.success).toBe(true);
    expect(puppeteerResponse.data).toEqual(
      expect.objectContaining({
        downloadId: expect.any(Number),
        format: 'puppeteer',
        filename: 'recording-Checkout-Flow-puppeteer-2026-03-09T12-35-00-789Z.js',
      }),
    );

    const puppeteerDownloadCall = vi.mocked(chrome.downloads.download).mock.calls.at(-1)?.[0];
    expect(puppeteerDownloadCall).toEqual(
      expect.objectContaining({
        filename: 'recording-Checkout-Flow-puppeteer-2026-03-09T12-35-00-789Z.js',
        saveAs: false,
      }),
    );
    const puppeteerScript = decodeDownloadTextUrl(puppeteerDownloadCall?.url ?? '');
    expect(puppeteerScript).toContain("const puppeteer = require('puppeteer');");
    expect(puppeteerScript).toContain(
      'await new Promise((resolve) => setTimeout(resolve, delayMs));',
    );
    expect(puppeteerScript).toContain('[REDACTED_EMAIL]');
    expect(puppeteerScript).not.toContain('alice@example.com');
    expect(puppeteerScript).toContain('frame-doc-7');
    expect(puppeteerScript).toContain('recording.actions[index]');
  });

  it('returns account-backed auth snapshots for codex message contracts', async () => {
    const observedAt = Date.UTC(2026, 2, 17, 8, 30, 0);
    await chrome.storage.local.set({
      vault: {
        version: 1,
        initialized: true,
        credentials: {
          codex: {
            version: 1,
            provider: 'codex',
            providerFamily: 'chatgpt-account',
            authFamily: 'account-backed',
            authKind: 'account-artifact',
            maskedValue: 'acct_****7890',
            updatedAt: observedAt,
          },
        },
        accounts: {
          codex: [
            {
              version: 1,
              provider: 'codex',
              providerFamily: 'chatgpt-account',
              authFamily: 'account-backed',
              accountId: 'acct_primary',
              label: 'Primary Codex Account',
              maskedIdentifier: 'user@example.com',
              status: 'active',
              isActive: true,
              updatedAt: observedAt,
              validatedAt: observedAt,
              metadata: {
                quota: {
                  scope: 'account',
                  unit: 'requests',
                  period: 'day',
                  used: 12,
                  limit: 100,
                  remaining: 88,
                  observedAt,
                },
              },
            },
          ],
        },
        activeAccounts: {
          codex: 'acct_primary',
        },
      },
    });
    await chrome.storage.session.set({
      __flux_vault_session__: {
        passphrase: 'test-passphrase',
        unlockedAt: observedAt,
      },
    });

    const runtime = new UISessionRuntime({
      bridge: createBridge(async (action) => ({
        actionId: action.id,
        success: true,
        duration: 5,
      })),
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}').manager,
    });

    const authStatus = await runtime.handleMessage(
      createExtensionMessage('ACCOUNT_AUTH_STATUS_GET', { provider: 'codex' }),
    );
    expect(authStatus.success).toBe(true);
    expect(authStatus.data).toEqual(
      expect.objectContaining({
        provider: 'codex',
        authFamily: 'account-backed',
        status: 'ready',
        availableTransports: ['artifact-import'],
        activeAccountId: 'acct_primary',
        credential: expect.objectContaining({ authKind: 'account-artifact' }),
        accounts: [
          expect.objectContaining({
            accountId: 'acct_primary',
            label: 'Primary Codex Account',
          }),
        ],
      }),
    );

    const accountList = await runtime.handleMessage(
      createExtensionMessage('ACCOUNT_LIST', { provider: 'codex' }),
    );
    expect(accountList.success).toBe(true);
    expect(accountList.data).toEqual({
      provider: 'codex',
      accounts: [expect.objectContaining({ accountId: 'acct_primary' })],
      activeAccountId: 'acct_primary',
    });

    const accountGet = await runtime.handleMessage(
      createExtensionMessage('ACCOUNT_GET', {
        provider: 'codex',
        accountId: 'acct_primary',
      }),
    );
    expect(accountGet.success).toBe(true);
    expect(accountGet.data?.account).toEqual(
      expect.objectContaining({
        accountId: 'acct_primary',
        metadata: expect.objectContaining({
          quota: expect.objectContaining({ remaining: 88 }),
        }),
      }),
    );

    const quotaStatus = await runtime.handleMessage(
      createExtensionMessage('ACCOUNT_QUOTA_STATUS_GET', { provider: 'codex' }),
    );
    expect(quotaStatus.success).toBe(true);
    expect(quotaStatus.data).toEqual({
      provider: 'codex',
      accountId: 'acct_primary',
      quota: expect.objectContaining({ limit: 100, remaining: 88 }),
    });
  });

  it('surfaces sanitized OpenAI browser-account status through account auth messages', async () => {
    const observedAt = Date.UTC(2026, 2, 18, 9, 0, 0);
    await chrome.storage.local.set({
      vault: {
        version: 1,
        initialized: true,
        credentials: {
          openai: {
            version: 1,
            provider: 'openai',
            providerFamily: 'default',
            authFamily: 'account-backed',
            authKind: 'account-artifact',
            maskedValue: 'acct_****5678',
            updatedAt: observedAt,
            validatedAt: observedAt,
          },
        },
        accounts: {
          openai: [
            {
              version: 1,
              provider: 'openai',
              providerFamily: 'default',
              authFamily: 'account-backed',
              accountId: 'acct_openai_browser_surface',
              label: 'Browser Seat',
              maskedIdentifier: 'br***@example.com',
              status: 'active',
              isActive: true,
              updatedAt: observedAt,
              validatedAt: observedAt,
            },
          ],
        },
        activeAccounts: {
          openai: 'acct_openai_browser_surface',
        },
        browserLogins: {
          openai: {
            authMethod: 'browser-account',
            status: 'success',
            updatedAt: observedAt,
            lastAttemptAt: observedAt,
            lastCompletedAt: observedAt,
            accountId: 'acct_openai_browser_surface',
            accountLabel: 'Browser Seat',
            helper: {
              id: 'openai-helper',
              version: '0.0.0-test',
            },
          },
        },
      },
    });
    await chrome.storage.session.set({
      __flux_vault_session__: {
        passphrase: 'test-passphrase',
        unlockedAt: observedAt,
      },
    });

    const runtime = new UISessionRuntime({
      bridge: createBridge(async (action) => ({ actionId: action.id, success: true, duration: 5 })),
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}').manager,
    });

    const authStatus = await runtime.handleMessage(
      createExtensionMessage('ACCOUNT_AUTH_STATUS_GET', { provider: 'openai' }),
    );

    expect(authStatus.success).toBe(true);
    expect(authStatus.data).toEqual(
      expect.objectContaining({
        provider: 'openai',
        authFamily: 'account-backed',
        status: 'ready',
        availableTransports: ['browser-helper'],
        activeAccountId: 'acct_openai_browser_surface',
        browserLogin: expect.objectContaining({
          status: 'success',
          accountId: 'acct_openai_browser_surface',
          helper: expect.objectContaining({ id: 'openai-helper', version: '0.0.0-test' }),
        }),
      }),
    );
  });

  it('validates an existing trusted OpenAI browser-account artifact through the account-backed runtime path', async () => {
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
    await seedUnlockedOpenAiBrowserAccountVaultFixture();

    const runtime = new UISessionRuntime({
      bridge: createBridge(async (action) => ({ actionId: action.id, success: true, duration: 5 })),
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}').manager,
    });

    const validateResponse = await runtime.handleMessage(
      createExtensionMessage('ACCOUNT_AUTH_VALIDATE', {
        provider: 'openai',
        accountId: 'acct_openai_browser_runtime',
      }),
    );

    expect(validateResponse.success).toBe(true);
    expect(validateResponse.data).toEqual(
      expect.objectContaining({
        provider: 'openai',
        valid: true,
        account: expect.objectContaining({
          accountId: 'acct_openai_browser_runtime',
          provider: 'openai',
        }),
        message: expect.stringContaining('Validated stored OpenAI browser account artifact'),
      }),
    );
  });

  it('fails closed with helper-missing when starting OpenAI browser-account connect without a helper', async () => {
    const observedAt = Date.UTC(2026, 2, 18, 9, 30, 0);
    await chrome.storage.local.set({
      vault: {
        version: 1,
        initialized: true,
        credentials: {},
        accounts: {},
        activeAccounts: {},
        browserLogins: {},
      },
    });
    await chrome.storage.session.set({
      __flux_vault_session__: {
        passphrase: 'test-passphrase',
        unlockedAt: observedAt,
      },
    });

    const runtime = new UISessionRuntime({
      bridge: createBridge(async (action) => ({ actionId: action.id, success: true, duration: 5 })),
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}').manager,
    });

    const connectResponse = await runtime.handleMessage(
      createExtensionMessage('ACCOUNT_AUTH_CONNECT_START', {
        provider: 'openai',
        transport: 'browser-helper',
        browserLogin: { uiContext: 'options' },
      }),
    );

    expect(connectResponse.success).toBe(true);
    expect(connectResponse.data).toEqual(
      expect.objectContaining({
        provider: 'openai',
        transport: 'browser-helper',
        accepted: false,
        nextStep: 'manual-action',
        message: expect.stringContaining('helper is not available in this build'),
        browserLogin: expect.objectContaining({ status: 'helper-missing' }),
      }),
    );

    const authStatus = await runtime.handleMessage(
      createExtensionMessage('ACCOUNT_AUTH_STATUS_GET', { provider: 'openai' }),
    );

    expect(authStatus.success).toBe(true);
    expect(authStatus.data).toEqual(
      expect.objectContaining({
        provider: 'openai',
        status: 'needs-auth',
        availableTransports: ['browser-helper'],
        browserLogin: expect.objectContaining({ status: 'helper-missing' }),
      }),
    );
  });

  it('executes baseline codex account-store mutations while keeping auth exchange deferred', async () => {
    const observedAt = Date.UTC(2026, 2, 17, 9, 0, 0);
    const idToken = createJwt({
      email: 'imported@example.com',
      'https://api.openai.com/auth': {
        chatgpt_plan_type: 'pro',
        chatgpt_user_id: 'user_imported',
      },
    });
    await chrome.storage.local.set({
      vault: {
        version: 1,
        initialized: true,
        credentials: {
          codex: {
            version: 1,
            provider: 'codex',
            providerFamily: 'chatgpt-account',
            authFamily: 'account-backed',
            authKind: 'account-artifact',
            maskedValue: 'acct_****1234',
            updatedAt: observedAt,
          },
        },
        accounts: {
          codex: [
            {
              version: 1,
              provider: 'codex',
              providerFamily: 'chatgpt-account',
              authFamily: 'account-backed',
              accountId: 'acct_primary',
              label: 'Primary Codex Account',
              maskedIdentifier: 'primary@example.com',
              status: 'active',
              isActive: true,
              updatedAt: observedAt,
              metadata: {
                quota: {
                  scope: 'account',
                  unit: 'requests',
                  period: 'day',
                  used: 12,
                  limit: 100,
                  remaining: 88,
                  observedAt,
                },
              },
            },
            {
              version: 1,
              provider: 'codex',
              providerFamily: 'chatgpt-account',
              authFamily: 'account-backed',
              accountId: 'acct_backup',
              label: 'Backup Codex Account',
              maskedIdentifier: 'backup@example.com',
              status: 'available',
              isActive: false,
              updatedAt: observedAt,
            },
          ],
        },
        activeAccounts: {
          codex: 'acct_primary',
        },
      },
    });
    await chrome.storage.session.set({
      __flux_vault_session__: {
        passphrase: 'test-passphrase',
        unlockedAt: observedAt,
      },
    });

    const runtime = new UISessionRuntime({
      bridge: createBridge(async (action) => ({
        actionId: action.id,
        success: true,
        duration: 5,
      })),
      logger: new Logger('FluxSW:test', 'debug'),
      aiClientManager: createAIManager('{"summary":"noop","actions":[]}').manager,
    });

    const connectResponse = await runtime.handleMessage(
      createExtensionMessage('ACCOUNT_AUTH_CONNECT_START', {
        provider: 'codex',
        transport: 'artifact-import',
        artifact: {
          format: 'json',
          value: JSON.stringify({
            auth_mode: 'chatgpt',
            tokens: {
              access_token: 'access-imported',
              id_token: idToken,
              refresh_token: 'refresh-imported',
            },
          }),
        },
      }),
    );
    expect(connectResponse.success).toBe(true);
    expect(connectResponse.data).toEqual({
      provider: 'codex',
      transport: 'artifact-import',
      accepted: true,
      nextStep: 'validate',
      message: 'Imported ChatGPT Pro account (im***@example.com). Run validation to confirm the persisted auth state.',
    });

    const validateResponse = await runtime.handleMessage(
      createExtensionMessage('ACCOUNT_AUTH_VALIDATE', {
        provider: 'codex',
        accountId: 'acct_5aea75ff65d29e4c',
      }),
    );
    expect(validateResponse.success).toBe(true);
    expect(validateResponse.data).toEqual(
      expect.objectContaining({
        provider: 'codex',
        valid: true,
        checkedAt: expect.any(Number),
        message:
          'Validated artifact shape for ChatGPT Pro account (im***@example.com). Validated stored Codex artifact and hydrated an in-memory runtime session.',
        account: expect.objectContaining({
          accountId: 'acct_5aea75ff65d29e4c',
          maskedIdentifier: 'im***@example.com',
          validatedAt: expect.any(Number),
          metadata: expect.objectContaining({
            session: expect.objectContaining({
              authKind: 'session-token',
              status: 'active',
            }),
          }),
        }),
      }),
    );

    const activateResponse = await runtime.handleMessage(
      createExtensionMessage('ACCOUNT_ACTIVATE', {
        provider: 'codex',
        accountId: 'acct_backup',
      }),
    );
    expect(activateResponse.success).toBe(true);
    expect(activateResponse.data).toEqual({
      provider: 'codex',
      accountId: 'acct_backup',
      activeAccountId: 'acct_backup',
    });

    const quotaRefreshResponse = await runtime.handleMessage(
      createExtensionMessage('ACCOUNT_QUOTA_REFRESH', {
        provider: 'codex',
        accountId: 'acct_backup',
      }),
    );
    expect(quotaRefreshResponse.success).toBe(true);
    expect(quotaRefreshResponse.data).toEqual({
      provider: 'codex',
      accountId: 'acct_backup',
      quota: undefined,
      refreshedAt: expect.any(Number),
    });

    const revokeResponse = await runtime.handleMessage(
      createExtensionMessage('ACCOUNT_REVOKE', {
        provider: 'codex',
        accountId: 'acct_backup',
      }),
    );
    expect(revokeResponse.success).toBe(true);
    expect(revokeResponse.data).toEqual({
      provider: 'codex',
      accountId: 'acct_backup',
      revoked: true,
    });

    const removeResponse = await runtime.handleMessage(
      createExtensionMessage('ACCOUNT_REMOVE', {
        provider: 'codex',
        accountId: 'acct_primary',
      }),
    );
    expect(removeResponse.success).toBe(true);
    expect(removeResponse.data).toEqual({
      provider: 'codex',
      accountId: 'acct_primary',
      removed: true,
    });

    const accountListResponse = await runtime.handleMessage(
      createExtensionMessage('ACCOUNT_LIST', { provider: 'codex' }),
    );
    expect(accountListResponse.success).toBe(true);
    expect(accountListResponse.data).toEqual(
      expect.objectContaining({
        provider: 'codex',
        activeAccountId: undefined,
        accounts: expect.arrayContaining([
          expect.objectContaining({
            accountId: 'acct_5aea75ff65d29e4c',
            status: 'available',
            isActive: false,
            validatedAt: expect.any(Number),
            metadata: expect.objectContaining({
              session: expect.objectContaining({
                authKind: 'session-token',
                status: 'active',
              }),
            }),
          }),
          expect.objectContaining({
            accountId: 'acct_backup',
            status: 'revoked',
            isActive: false,
            stale: true,
          }),
        ]),
      }),
    );
  });
});
