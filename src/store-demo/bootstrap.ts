import type {
  ExtensionMessage,
  ExtensionMessageType,
  SavedWorkflow,
  Session,
  SessionPlaybackSpeed,
} from '@shared/types';
import { ONBOARDING_STORAGE_KEY } from '@shared/storage/onboarding';

type DemoSurface = 'popup' | 'sidepanel' | 'options';
type StorageAreaName = 'local' | 'session' | 'sync';

type RuntimeHandler = (message: ExtensionMessage, state: DemoRuntimeState) => unknown | Promise<unknown>;

interface DemoScenario {
  surface: DemoSurface;
  id: string;
  tabs: chrome.tabs.Tab[];
  storage: Record<StorageAreaName, Record<string, unknown>>;
  buildRuntimeState: () => DemoRuntimeState;
  handlers: Partial<Record<ExtensionMessageType, RuntimeHandler>>;
  runtimeEvents?: ExtensionMessage[];
}

interface DemoRuntimeState {
  sessions: Session[];
  workflows: SavedWorkflow[];
  runtimeEventsDispatched: boolean;
}

type ChromeStorageListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string,
) => void;

type ChromeMessageListener = (
  message: unknown,
  sender?: chrome.runtime.MessageSender,
  sendResponse?: (response?: unknown) => void,
) => void;

declare global {
  interface Window {
    chrome?: typeof chrome;
  }
}

const FIXED_NOW = Date.UTC(2026, 2, 12, 14, 30, 0);

function deepClone<T>(value: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value)) as T;
}

function createTab(id: number, title: string, url: string): chrome.tabs.Tab {
  return {
    id,
    index: 0,
    windowId: 1,
    active: true,
    highlighted: true,
    selected: true,
    pinned: false,
    incognito: false,
    url,
    title,
    status: 'complete',
    discarded: false,
    frozen: false,
    autoDiscardable: true,
    groupId: -1,
    lastAccessed: FIXED_NOW,
  };
}

function createSession(overrides: Partial<Session> & { id: string; name: string }): Session {
  return {
    config: {
      id: overrides.id,
      name: overrides.name,
      provider: 'openai',
      model: 'gpt-4o-mini',
      ...overrides.config,
    },
    status: 'idle',
    targetTabId: 41,
    tabSnapshot: [
      {
        tabIndex: 0,
        id: 41,
        url: 'https://workspace.acme.test/pipeline',
        title: 'Pipeline workspace',
        status: 'complete',
        isActive: true,
        isTarget: true,
      },
    ],
    recording: {
      status: 'idle',
      actions: [],
      startedAt: null,
      updatedAt: null,
      ...overrides.recording,
    },
    playback: {
      status: 'idle',
      nextActionIndex: 0,
      speed: 1,
      startedAt: null,
      updatedAt: null,
      lastCompletedAt: null,
      lastError: null,
      ...overrides.playback,
    },
    messages: [],
    currentTurn: 0,
    actionHistory: [],
    variables: {},
    startedAt: FIXED_NOW,
    lastActivityAt: FIXED_NOW,
    errorCount: 0,
    ...overrides,
  };
}

function createWorkflow(id: string, name: string, updatedAtOffsetMinutes: number, tags: string[]): SavedWorkflow {
  return {
    id,
    name,
    description: name === 'Pipeline handoff flow'
      ? 'Captures the handoff review workflow from triage through export.'
      : 'Replays the weekly competitor pricing check with reusable selectors.',
    actions: [
      {
        action: {
          id: `${id}-navigate`,
          type: 'navigate',
          url: 'https://workspace.acme.test/pipeline',
        },
        timestamp: FIXED_NOW - 5 * 60_000,
      },
      {
        action: {
          id: `${id}-click`,
          type: 'click',
          selector: { css: '[data-testid="open-review"]' },
        },
        timestamp: FIXED_NOW - 4 * 60_000,
      },
      {
        action: {
          id: `${id}-type`,
          type: 'type',
          selector: { css: '[data-testid="workflow-note"]' },
          text: 'Ready for handoff',
        },
        timestamp: FIXED_NOW - 3 * 60_000,
      },
    ],
    tags,
    createdAt: FIXED_NOW - 24 * 60 * 60_000,
    updatedAt: FIXED_NOW - updatedAtOffsetMinutes * 60_000,
    source: {
      sessionId: 'session-workflows',
      sessionName: 'Workspace launch review',
      recordedAt: FIXED_NOW - 7 * 60_000,
    },
  };
}

function createRuntimeEvent(type: ExtensionMessageType, payload: unknown, index: number): ExtensionMessage {
  return {
    id: `demo-event-${index}`,
    channel: 'sidePanel',
    type,
    payload,
    timestamp: FIXED_NOW + index * 1000,
  };
}

function createEventDispatcher<T extends (...args: never[]) => void>() {
  const listeners = new Set<T>();

  return {
    addListener(listener: T) {
      listeners.add(listener);
    },
    removeListener(listener: T) {
      listeners.delete(listener);
    },
    dispatch(...args: Parameters<T>) {
      for (const listener of Array.from(listeners)) {
        listener(...args);
      }
    },
  };
}

function buildWorkspaceSession(): Session {
  return createSession({
    id: 'session-workspace',
    name: 'Workspace launch review',
    status: 'running',
    messages: [
      {
        role: 'user',
        content: 'Review the pipeline board, summarize blockers, and capture the next actions for handoff.',
        timestamp: FIXED_NOW - 8 * 60_000,
      },
      {
        role: 'assistant',
        content: 'I found **3 blockers** in the active launch board.\n\n- Finance approval is still pending.\n- The checklist still needs 2 store screenshots.\n- Legal review is waiting on final copy.',
        timestamp: FIXED_NOW - 7 * 60_000,
      },
    ],
  });
}

function buildWorkflowSession(): Session {
  return createSession({
    id: 'session-workflows',
    name: 'Workspace launch review',
    status: 'idle',
    messages: [
      {
        role: 'user',
        content: 'Record this launch-review flow so the team can replay it next week.',
        timestamp: FIXED_NOW - 10 * 60_000,
      },
      {
        role: 'assistant',
        content: 'The recording is ready. You can replay the 4 captured actions, export them in a script format, or save the sequence as a reusable workflow.',
        timestamp: FIXED_NOW - 9 * 60_000,
      },
    ],
    recording: {
      status: 'idle',
      actions: [
        {
          action: { id: 'recorded-nav', type: 'navigate', url: 'https://workspace.acme.test/pipeline' },
          timestamp: FIXED_NOW - 8 * 60_000,
        },
        {
          action: { id: 'recorded-click', type: 'click', selector: { css: '[data-testid="filters"]' } },
          timestamp: FIXED_NOW - 7 * 60_000,
        },
        {
          action: {
            id: 'recorded-type',
            type: 'type',
            selector: { css: '[data-testid="owner-search"]' },
            text: 'Launch owner',
          },
          timestamp: FIXED_NOW - 6 * 60_000,
        },
        {
          action: { id: 'recorded-export', type: 'click', selector: { css: '[data-testid="export"]' } },
          timestamp: FIXED_NOW - 5 * 60_000,
        },
      ],
      startedAt: FIXED_NOW - 9 * 60_000,
      updatedAt: FIXED_NOW - 5 * 60_000,
    },
    playback: {
      status: 'idle',
      nextActionIndex: 4,
      speed: 1,
      startedAt: FIXED_NOW - 4 * 60_000,
      updatedAt: FIXED_NOW - 3 * 60_000,
      lastCompletedAt: FIXED_NOW - 3 * 60_000,
      lastError: null,
    },
  });
}

const POPUP_TAB_LOCKED = createTab(11, 'Q2 launch checklist | Notion', 'https://workspace.notion.site/q2-launch-checklist');
const POPUP_TAB_UNLOCKED = createTab(12, 'Revenue pipeline dashboard | Acme CRM', 'https://app.acme.test/revenue/pipeline');
const SIDEPANEL_TAB = createTab(41, 'Pipeline workspace', 'https://workspace.acme.test/pipeline');

const SCENARIOS: Record<string, DemoScenario> = {
  'popup-locked': {
    surface: 'popup',
    id: 'popup-locked',
    tabs: [POPUP_TAB_LOCKED],
    storage: {
      local: {
        [ONBOARDING_STORAGE_KEY]: {
          version: 1,
          completed: false,
          lastStep: 1,
          configuredProvider: 'openai',
          providerReady: false,
        },
      },
      session: {},
      sync: {},
    },
    buildRuntimeState: () => ({ sessions: [], workflows: [], runtimeEventsDispatched: false }),
    handlers: {},
  },
  'popup-unlocked': {
    surface: 'popup',
    id: 'popup-unlocked',
    tabs: [POPUP_TAB_UNLOCKED],
    storage: {
      local: {
        [ONBOARDING_STORAGE_KEY]: {
          version: 1,
          completed: true,
          lastStep: 3,
          providerReady: true,
          completedAt: FIXED_NOW - 2 * 60 * 60_000,
        },
      },
      session: {},
      sync: {},
    },
    buildRuntimeState: () => ({ sessions: [], workflows: [], runtimeEventsDispatched: false }),
    handlers: {},
  },
  'sidepanel-workspace': {
    surface: 'sidepanel',
    id: 'sidepanel-workspace',
    tabs: [SIDEPANEL_TAB],
    storage: {
      local: {},
      session: {},
      sync: {},
    },
    buildRuntimeState: () => ({
      sessions: [buildWorkspaceSession()],
      workflows: [],
      runtimeEventsDispatched: false,
    }),
    handlers: {
      SESSION_LIST: async (_message, state) => ({ sessions: state.sessions }),
      SESSION_CREATE: async (_message, state) => ({ session: state.sessions[0] }),
      WORKFLOW_LIST: async () => ({ workflows: [] }),
      SESSION_SEND_MESSAGE: async () => undefined,
    },
    runtimeEvents: [
      createRuntimeEvent('EVENT_ACTION_PROGRESS', {
        sessionId: 'session-workspace',
        entry: {
          id: 'workspace-step-1',
          title: 'Inspecting current board state',
          detail: 'Collected the visible pipeline columns and the cards that are still blocked.',
          timestamp: FIXED_NOW - 6 * 60_000,
          status: 'done',
          progress: 100,
          currentStep: 1,
          totalSteps: 3,
        },
      }, 1),
      createRuntimeEvent('EVENT_ACTION_PROGRESS', {
        sessionId: 'session-workspace',
        entry: {
          id: 'workspace-step-2',
          title: 'Summarizing blockers',
          detail: 'Extracted the stalled cards and grouped them by owner so the handoff stays readable.',
          timestamp: FIXED_NOW - 5 * 60_000,
          status: 'running',
          progress: 66,
          currentStep: 2,
          totalSteps: 3,
        },
      }, 2),
      createRuntimeEvent('EVENT_ACTION_PROGRESS', {
        sessionId: 'session-workspace',
        entry: {
          id: 'workspace-step-3',
          title: 'Drafting next actions',
          detail: 'Prepared a concise checklist for the next review pass in the same session.',
          timestamp: FIXED_NOW - 4 * 60_000,
          status: 'pending',
          progress: 0,
          currentStep: 3,
          totalSteps: 3,
        },
      }, 3),
    ],
  },
  'sidepanel-workflows': {
    surface: 'sidepanel',
    id: 'sidepanel-workflows',
    tabs: [SIDEPANEL_TAB],
    storage: {
      local: {},
      session: {},
      sync: {},
    },
    buildRuntimeState: () => ({
      sessions: [buildWorkflowSession()],
      workflows: [
        createWorkflow('workflow-handoff', 'Pipeline handoff flow', 12, ['handoff', 'launch']),
        createWorkflow('workflow-pricing', 'Competitor pricing sweep', 44, ['pricing', 'weekly']),
      ],
      runtimeEventsDispatched: false,
    }),
    handlers: {
      SESSION_LIST: async (_message, state) => ({ sessions: state.sessions }),
      SESSION_CREATE: async (_message, state) => ({ session: state.sessions[0] }),
      WORKFLOW_LIST: async (_message, state) => ({ workflows: state.workflows }),
      SESSION_SEND_MESSAGE: async () => undefined,
      SESSION_PLAYBACK_SET_SPEED: async (message, state) => {
        const payload = message.payload as { sessionId: string; speed: SessionPlaybackSpeed };
        const session = state.sessions.find((item) => item.config.id === payload.sessionId);
        if (session) {
          session.playback.speed = payload.speed;
        }
        return undefined;
      },
      WORKFLOW_RUN: async (_message, state) => ({ workflow: state.workflows[0], session: state.sessions[0] }),
    },
  },
  'options-control-surface': {
    surface: 'options',
    id: 'options-control-surface',
    tabs: [],
    storage: {
      local: {
        activeProvider: 'openrouter',
        providers: {
          claude: {
            enabled: true,
            model: 'claude-3-5-sonnet-20241022',
            maxTokens: 4096,
            temperature: 0.3,
          },
          openai: {
            enabled: true,
            model: 'gpt-4o-mini',
            maxTokens: 4096,
            temperature: 0.3,
            customEndpoint: 'https://api.openai.com',
          },
          gemini: {
            enabled: true,
            model: 'gemini-2.5-flash',
            maxTokens: 4096,
            temperature: 0.3,
          },
          openrouter: {
            enabled: true,
            model: 'anthropic/claude-3.5-sonnet',
            maxTokens: 4096,
            temperature: 0.2,
          },
          ollama: {
            enabled: true,
            model: 'llama3.2',
            maxTokens: 4096,
            temperature: 0.3,
            customEndpoint: 'http://localhost:11434',
          },
          custom: {
            enabled: false,
            model: 'custom-model',
            maxTokens: 4096,
            temperature: 0.3,
            customEndpoint: 'https://provider.example.com/v1',
          },
        },
        providerKeyMetadata: {
          openrouter: {
            maskedValue: 'sk-or-v1-••••••••',
            updatedAt: FIXED_NOW - 26 * 60_000,
          },
        },
        settings: {
          defaultProvider: 'openrouter',
          theme: 'light',
          language: 'en',
          includeScreenshotsInContext: true,
          screenshotOnError: true,
          allowCustomScripts: false,
          showFloatingBar: true,
          highlightElements: true,
          soundNotifications: false,
        },
        [ONBOARDING_STORAGE_KEY]: {
          version: 1,
          completed: true,
          lastStep: 3,
          providerReady: true,
          configuredProvider: 'openrouter',
          validatedProvider: 'openrouter',
          completedAt: FIXED_NOW - 3 * 60 * 60_000,
        },
      },
      session: {},
      sync: {},
    },
    buildRuntimeState: () => ({ sessions: [], workflows: [], runtimeEventsDispatched: false }),
    handlers: {},
  },
};

function createStorageArea(
  areaName: StorageAreaName,
  store: Record<string, unknown>,
  globalChangeEvent: ReturnType<typeof createEventDispatcher<ChromeStorageListener>>,
) {
  return {
    async get(
      keys?: string | string[] | Record<string, unknown> | null,
    ): Promise<Record<string, unknown>> {
      if (keys === undefined || keys === null) {
        return { ...store };
      }

      if (typeof keys === 'string') {
        return keys in store ? { [keys]: store[keys] } : {};
      }

      if (Array.isArray(keys)) {
        return keys.reduce<Record<string, unknown>>((result, key) => {
          if (key in store) {
            result[key] = store[key];
          }
          return result;
        }, {});
      }

      return Object.entries(keys).reduce<Record<string, unknown>>((result, [key, value]) => {
        result[key] = key in store ? store[key] : value;
        return result;
      }, {});
    },
    async set(items: Record<string, unknown>): Promise<void> {
      const changes = Object.entries(items).reduce<Record<string, chrome.storage.StorageChange>>((result, [key, value]) => {
        result[key] = { oldValue: store[key], newValue: value };
        store[key] = value;
        return result;
      }, {});
      globalChangeEvent.dispatch(changes, areaName);
    },
    async remove(keys: string | string[]): Promise<void> {
      const keyList = Array.isArray(keys) ? keys : [keys];
      const changes = keyList.reduce<Record<string, chrome.storage.StorageChange>>((result, key) => {
        if (key in store) {
          result[key] = { oldValue: store[key] };
          delete store[key];
        }
        return result;
      }, {});

      if (Object.keys(changes).length > 0) {
        globalChangeEvent.dispatch(changes, areaName);
      }
    },
  };
}

function installDemoChrome(scenario: DemoScenario): void {
  const runtimeState = scenario.buildRuntimeState();
  const storageChangeEvent = createEventDispatcher<ChromeStorageListener>();
  const runtimeMessageEvent = createEventDispatcher<ChromeMessageListener>();
  const localStore = deepClone(scenario.storage.local);
  const sessionStore = deepClone(scenario.storage.session);
  const syncStore = deepClone(scenario.storage.sync);

  const chromeMock = {
    tabs: {
      query: async (): Promise<chrome.tabs.Tab[]> => scenario.tabs.map((tab) => ({ ...tab })),
    },
    storage: {
      local: createStorageArea('local', localStore, storageChangeEvent),
      session: createStorageArea('session', sessionStore, storageChangeEvent),
      sync: createStorageArea('sync', syncStore, storageChangeEvent),
      onChanged: {
        addListener(listener: ChromeStorageListener) {
          storageChangeEvent.addListener(listener);
        },
        removeListener(listener: ChromeStorageListener) {
          storageChangeEvent.removeListener(listener);
        },
      },
    },
    runtime: {
      async sendMessage(message: ExtensionMessage): Promise<{ success: boolean; data?: unknown; error?: { code: string; message: string } }> {
        const handler = scenario.handlers[message.type];

        if (!handler) {
          return { success: true, data: undefined };
        }

        try {
          const data = await handler(message, runtimeState);
          return { success: true, data };
        } catch (error) {
          return {
            success: false,
            error: {
              code: 'DEMO_RUNTIME_ERROR',
              message: error instanceof Error ? error.message : 'Demo runtime request failed',
            },
          };
        }
      },
      async openOptionsPage(): Promise<void> {
        return undefined;
      },
      onMessage: {
        addListener(listener: ChromeMessageListener) {
          runtimeMessageEvent.addListener(listener);
          if (!runtimeState.runtimeEventsDispatched && scenario.runtimeEvents && scenario.runtimeEvents.length > 0) {
            runtimeState.runtimeEventsDispatched = true;
            window.setTimeout(() => {
              for (const event of scenario.runtimeEvents ?? []) {
                runtimeMessageEvent.dispatch(event);
              }
            }, 80);
          }
        },
        removeListener(listener: ChromeMessageListener) {
          runtimeMessageEvent.removeListener(listener);
        },
      },
    },
  } as unknown as typeof chrome;

  window.chrome = chromeMock;
}

export function setupStoreScreenshotDemo(surface: DemoSurface): string | null {
  const params = new URLSearchParams(window.location.search);
  const demoId = params.get('demo');

  if (!demoId) {
    return null;
  }

  const scenario = SCENARIOS[demoId];
  if (!scenario || scenario.surface !== surface) {
    throw new Error(`Unknown ${surface} demo scenario: ${demoId}`);
  }

  try {
    localStorage.setItem('flux-agent-theme', 'light');
  } catch {
    // Ignore unavailable storage in restricted contexts.
  }

  document.documentElement.setAttribute('data-store-demo', demoId);
  installDemoChrome({
    ...scenario,
    tabs: scenario.tabs.map((tab) => ({ ...tab })),
    storage: deepClone(scenario.storage),
    runtimeEvents: scenario.runtimeEvents ? deepClone(scenario.runtimeEvents) : undefined,
  });

  return demoId;
}
