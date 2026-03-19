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
import { seedReadyOpenAiVaultFixture } from './seed-ready-openai';

const extensionListeners = new Set<(message: ExtensionMessage) => void>();
const pendingExtensionRequests = new Set<Promise<unknown>>();
let activeRuntime: UISessionRuntime | null = null;

interface SpaScenario {
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

function createPageContext(base: Partial<PageContext>): PageContext {
  return {
    url: base.url ?? 'https://spa.example.test',
    title: base.title ?? 'SPA Example',
    summary: base.summary ?? 'SPA example page context',
    frame: base.frame ?? {
      frameId: 0,
      parentFrameId: null,
      url: base.url ?? 'https://spa.example.test',
      origin: new URL(base.url ?? 'https://spa.example.test').origin,
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

async function runScenario(scenario: SpaScenario): Promise<void> {
  const user = userEvent.setup();
  const actionHandler = vi.fn(
    async (action: Action): Promise<ActionResult> => ({
      actionId: action.id,
      success: true,
      duration: 8,
      data: { executed: true, type: action.type },
    }),
  );

  activeRuntime = new UISessionRuntime({
    bridge: createBridge(scenario.pageContext, actionHandler),
    logger: new Logger('FluxSW:p-02b-e2e', 'debug'),
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

describe('P-02b SPA-style E2E expansion', () => {
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
    await seedReadyOpenAiVaultFixture();
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

  it('P-02b covers a React-style dashboard route transition flow', async () => {
    await runScenario({
      prompt:
        'Open the Analytics route in the React admin and refresh the revenue chart for this quarter',
      summary:
        'React-style dashboard actions move through sidebar routing, tab state, and a chart refresh without a full page load.',
      pageContext: createPageContext({
        url: 'https://spa.example.test/react-admin#/overview',
        title: 'Acme Ops Console',
        summary:
          'Single-page React admin shell with sidebar routing, nested tabs, and panel actions.',
        interactiveElements: [
          {
            index: 1,
            tag: 'a',
            text: 'Analytics',
            type: undefined,
            role: 'link',
            placeholder: undefined,
            ariaLabel: 'Analytics',
            isVisible: true,
            isEnabled: true,
            boundingBox: { x: 24, y: 180, width: 128, height: 36 },
          },
          {
            index: 2,
            tag: 'button',
            text: 'Revenue',
            type: 'button',
            role: 'tab',
            placeholder: undefined,
            ariaLabel: 'Revenue',
            isVisible: true,
            isEnabled: true,
            boundingBox: { x: 280, y: 140, width: 112, height: 34 },
          },
          {
            index: 3,
            tag: 'button',
            text: 'Refresh chart',
            type: 'button',
            role: 'button',
            placeholder: undefined,
            ariaLabel: 'Refresh chart',
            isVisible: true,
            isEnabled: true,
            boundingBox: { x: 1120, y: 142, width: 132, height: 36 },
          },
        ],
        headings: [{ level: 1, text: 'Overview' }],
      }),
      actions: [
        {
          id: 'react-open-analytics-route',
          type: 'click',
          selector: { role: 'link', textExact: 'Analytics' },
          description: 'Open the Analytics route from the React sidebar',
        },
        {
          id: 'react-open-revenue-tab',
          type: 'click',
          selector: { role: 'tab', textExact: 'Revenue' },
          description: 'Switch to the Revenue tab',
        },
        {
          id: 'react-refresh-chart',
          type: 'click',
          selector: { role: 'button', textExact: 'Refresh chart' },
          description: 'Refresh the revenue chart',
        },
      ],
      expectedExecutedActions: [
        { id: 'react-open-analytics-route', type: 'click' },
        { id: 'react-open-revenue-tab', type: 'click' },
        { id: 'react-refresh-chart', type: 'click' },
      ],
      expectedActionLogEntries: [
        'Open the Analytics route from the React sidebar',
        'Switch to the Revenue tab',
        'Refresh the revenue chart',
      ],
    });
  }, 15000);

  it('P-02b covers a Vue-style filter and list refinement flow', async () => {
    await runScenario({
      prompt:
        'In the Vue customer list, filter to enterprise accounts in Europe and open the Acme GmbH row',
      summary:
        'Vue-style reactive filtering applies chips and search criteria before opening the matching list row.',
      pageContext: createPageContext({
        url: 'https://spa.example.test/customers',
        title: 'Customers | Vue CRM',
        summary: 'Reactive Vue list view with pill filters, live search, and row actions.',
        interactiveElements: [
          {
            index: 1,
            tag: 'input',
            text: '',
            type: 'search',
            role: 'searchbox',
            placeholder: 'Search customers',
            ariaLabel: 'Search customers',
            isVisible: true,
            isEnabled: true,
            boundingBox: { x: 220, y: 96, width: 420, height: 40 },
          },
          {
            index: 2,
            tag: 'button',
            text: 'Enterprise',
            type: 'button',
            role: 'button',
            placeholder: undefined,
            ariaLabel: 'Enterprise',
            isVisible: true,
            isEnabled: true,
            boundingBox: { x: 220, y: 154, width: 118, height: 34 },
          },
          {
            index: 3,
            tag: 'button',
            text: 'Europe',
            type: 'button',
            role: 'button',
            placeholder: undefined,
            ariaLabel: 'Europe',
            isVisible: true,
            isEnabled: true,
            boundingBox: { x: 350, y: 154, width: 96, height: 34 },
          },
          {
            index: 4,
            tag: 'button',
            text: 'Open Acme GmbH',
            type: 'button',
            role: 'button',
            placeholder: undefined,
            ariaLabel: 'Open Acme GmbH',
            isVisible: true,
            isEnabled: true,
            boundingBox: { x: 1080, y: 244, width: 156, height: 36 },
          },
        ],
        headings: [{ level: 1, text: 'Customers' }],
      }),
      actions: [
        {
          id: 'vue-fill-customer-search',
          type: 'fill',
          selector: { role: 'searchbox', ariaLabel: 'Search customers' },
          value: 'Acme GmbH',
          description: 'Search for Acme GmbH in the customer list',
        },
        {
          id: 'vue-apply-enterprise-filter',
          type: 'click',
          selector: { role: 'button', textExact: 'Enterprise' },
          description: 'Apply the Enterprise filter chip',
        },
        {
          id: 'vue-apply-europe-filter',
          type: 'click',
          selector: { role: 'button', textExact: 'Europe' },
          description: 'Apply the Europe region filter chip',
        },
        {
          id: 'vue-open-row',
          type: 'click',
          selector: { role: 'button', ariaLabel: 'Open Acme GmbH' },
          description: 'Open the Acme GmbH customer row',
        },
      ],
      expectedExecutedActions: [
        { id: 'vue-fill-customer-search', type: 'fill' },
        { id: 'vue-apply-enterprise-filter', type: 'click' },
        { id: 'vue-apply-europe-filter', type: 'click' },
        { id: 'vue-open-row', type: 'click' },
      ],
      expectedActionLogEntries: [
        'Search for Acme GmbH in the customer list',
        'Apply the Enterprise filter chip',
        'Apply the Europe region filter chip',
        'Open the Acme GmbH customer row',
      ],
    });
  });

  it('P-02b covers an Angular-style wizard and stateful step flow', async () => {
    await runScenario({
      prompt:
        'In the Angular onboarding wizard, enter the workspace name, continue to Review, and finish setup',
      summary:
        'Angular-style wizard actions preserve form state across steps and finish on the final confirmation view.',
      pageContext: createPageContext({
        url: 'https://spa.example.test/onboarding/organization',
        title: 'Workspace setup | Angular Portal',
        summary:
          'Stepper-based Angular onboarding flow with form state, next actions, and final confirmation.',
        interactiveElements: [
          {
            index: 1,
            tag: 'input',
            text: '',
            type: 'text',
            role: 'textbox',
            placeholder: 'Workspace name',
            ariaLabel: 'Workspace name',
            isVisible: true,
            isEnabled: true,
            boundingBox: { x: 320, y: 210, width: 420, height: 42 },
          },
          {
            index: 2,
            tag: 'button',
            text: 'Continue to Review',
            type: 'button',
            role: 'button',
            placeholder: undefined,
            ariaLabel: 'Continue to Review',
            isVisible: true,
            isEnabled: true,
            boundingBox: { x: 910, y: 620, width: 178, height: 40 },
          },
          {
            index: 3,
            tag: 'button',
            text: 'Review step',
            type: 'button',
            role: 'button',
            placeholder: undefined,
            ariaLabel: 'Review step',
            isVisible: true,
            isEnabled: true,
            boundingBox: { x: 448, y: 136, width: 96, height: 34 },
          },
          {
            index: 4,
            tag: 'button',
            text: 'Finish setup',
            type: 'button',
            role: 'button',
            placeholder: undefined,
            ariaLabel: 'Finish setup',
            isVisible: true,
            isEnabled: true,
            boundingBox: { x: 930, y: 620, width: 168, height: 40 },
          },
        ],
        headings: [{ level: 1, text: 'Set up your workspace' }],
        forms: [
          {
            action: '/onboarding/organization',
            method: 'post',
            fields: [
              {
                name: 'workspaceName',
                type: 'text',
                label: 'Workspace name',
                required: true,
              },
            ],
          },
        ],
      }),
      actions: [
        {
          id: 'angular-fill-workspace-name',
          type: 'fill',
          selector: { role: 'textbox', ariaLabel: 'Workspace name' },
          value: 'Operations Workspace',
          description: 'Fill the Workspace name field',
        },
        {
          id: 'angular-open-review-step',
          type: 'click',
          selector: { role: 'button', textExact: 'Continue to Review' },
          description: 'Continue to the Review step',
        },
        {
          id: 'angular-focus-review-step',
          type: 'click',
          selector: { role: 'button', textExact: 'Review step' },
          description: 'Focus the Review step',
        },
        {
          id: 'angular-finish-setup',
          type: 'click',
          selector: { role: 'button', textExact: 'Finish setup' },
          description: 'Finish the setup flow',
        },
      ],
      expectedExecutedActions: [
        { id: 'angular-fill-workspace-name', type: 'fill' },
        { id: 'angular-open-review-step', type: 'click' },
        { id: 'angular-focus-review-step', type: 'click' },
        { id: 'angular-finish-setup', type: 'click' },
      ],
      expectedActionLogEntries: [
        'Fill the Workspace name field',
        'Continue to the Review step',
        'Focus the Review step',
        'Finish the setup flow',
      ],
    });
  });
});
