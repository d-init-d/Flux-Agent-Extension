/**
 * @module chrome-mock
 * @description Comprehensive Chrome Extension API mock for Vitest.
 *
 * Provides in-memory implementations of all chrome.* APIs used by the extension.
 * Each API namespace tracks state internally and supports event listeners.
 *
 * Usage:
 *   import { createChromeMock, resetAllMocks, getMockStore } from './chrome';
 *   beforeEach(() => { vi.stubGlobal('chrome', createChromeMock()); });
 *   afterEach(() => { resetAllMocks(); });
 */

// ============================================================================
// Event System
// ============================================================================

/**
 * Creates a mock Chrome event that supports addListener, removeListener,
 * hasListener, and dispatch (for testing).
 */
export function createMockEvent<T extends (...args: unknown[]) => void>() {
  const listeners = new Set<T>();

  return {
    addListener: vi.fn((callback: T) => {
      listeners.add(callback);
    }),
    removeListener: vi.fn((callback: T) => {
      listeners.delete(callback);
    }),
    hasListener: vi.fn((callback: T): boolean => {
      return listeners.has(callback);
    }),
    hasListeners: vi.fn((): boolean => {
      return listeners.size > 0;
    }),
    /** Test-only: fire event to all registered listeners */
    dispatch: (...args: Parameters<T>) => {
      listeners.forEach((listener) => {
        try {
          listener(...args);
        } catch {
          // swallow errors in listeners during tests
        }
      });
    },
    /** Test-only: get count of registered listeners */
    listenerCount: () => listeners.size,
    /** Test-only: clear all listeners */
    clearListeners: () => listeners.clear(),
  };
}

export type MockEvent<T extends (...args: unknown[]) => void> = ReturnType<
  typeof createMockEvent<T>
>;

// ============================================================================
// Internal Mock Store
// ============================================================================

/** In-memory store for chrome.storage.local */
let storageLocalStore: Record<string, unknown> = {};

/** In-memory store for chrome.storage.sync */
let storageSyncStore: Record<string, unknown> = {};

/** In-memory store for chrome.storage.session */
let storageSessionStore: Record<string, unknown> = {};

/** Mock tabs registry */
let mockTabs: chrome.tabs.Tab[] = [
  {
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
  },
];

/** Tab ID counter */
let nextTabId = 2;

/** Mock cookies store */
let cookieStore: chrome.cookies.Cookie[] = [];

/** Mock notification store */
let notificationStore: Map<string, chrome.notifications.NotificationOptions> =
  new Map();

/** Debugger attached targets */
let debuggerTargets: Set<string> = new Set();

// ============================================================================
// chrome.storage
// ============================================================================

function createStorageArea(store: Record<string, unknown>) {
  const onChanged = createMockEvent<
    (changes: Record<string, chrome.storage.StorageChange>) => void
  >();

  return {
    get: vi.fn(
      (
        keys?:
          | string
          | string[]
          | Record<string, unknown>
          | null,
      ): Promise<Record<string, unknown>> => {
        if (keys === null || keys === undefined) {
          return Promise.resolve({ ...store });
        }

        if (typeof keys === 'string') {
          const result: Record<string, unknown> = {};
          if (keys in store) {
            result[keys] = store[keys];
          }
          return Promise.resolve(result);
        }

        if (Array.isArray(keys)) {
          const result: Record<string, unknown> = {};
          for (const key of keys) {
            if (key in store) {
              result[key] = store[key];
            }
          }
          return Promise.resolve(result);
        }

        // Object with defaults
        const result: Record<string, unknown> = {};
        for (const [key, defaultValue] of Object.entries(keys)) {
          result[key] = key in store ? store[key] : defaultValue;
        }
        return Promise.resolve(result);
      },
    ),

    set: vi.fn((items: Record<string, unknown>): Promise<void> => {
      const changes: Record<string, chrome.storage.StorageChange> = {};
      for (const [key, newValue] of Object.entries(items)) {
        const oldValue = store[key];
        store[key] = newValue;
        changes[key] = { oldValue, newValue };
      }
      onChanged.dispatch(changes);
      return Promise.resolve();
    }),

    remove: vi.fn((keys: string | string[]): Promise<void> => {
      const keysArr = Array.isArray(keys) ? keys : [keys];
      const changes: Record<string, chrome.storage.StorageChange> = {};
      for (const key of keysArr) {
        if (key in store) {
          changes[key] = { oldValue: store[key] };
          delete store[key];
        }
      }
      if (Object.keys(changes).length > 0) {
        onChanged.dispatch(changes);
      }
      return Promise.resolve();
    }),

    clear: vi.fn((): Promise<void> => {
      const changes: Record<string, chrome.storage.StorageChange> = {};
      for (const [key, oldValue] of Object.entries(store)) {
        changes[key] = { oldValue };
      }
      // Clear in-place so the reference stays valid
      for (const key of Object.keys(store)) {
        delete store[key];
      }
      if (Object.keys(changes).length > 0) {
        onChanged.dispatch(changes);
      }
      return Promise.resolve();
    }),

    onChanged,

    /** Test-only: direct access to internal store */
    _getStore: () => store,
  };
}

function createMockStorage() {
  return {
    local: createStorageArea(storageLocalStore),
    sync: createStorageArea(storageSyncStore),
    session: createStorageArea(storageSessionStore),
    onChanged: createMockEvent<
      (
        changes: Record<string, chrome.storage.StorageChange>,
        areaName: string,
      ) => void
    >(),
  };
}

// ============================================================================
// chrome.tabs
// ============================================================================

function createMockTabs() {
  const onUpdated = createMockEvent<
    (
      tabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab,
    ) => void
  >();
  const onRemoved = createMockEvent<
    (tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) => void
  >();
  const onActivated = createMockEvent<
    (activeInfo: chrome.tabs.TabActiveInfo) => void
  >();
  const onCreated = createMockEvent<(tab: chrome.tabs.Tab) => void>();

  return {
    query: vi.fn(
      (queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> => {
        let results = [...mockTabs];

        if (queryInfo.active !== undefined) {
          results = results.filter((t) => t.active === queryInfo.active);
        }
        if (queryInfo.currentWindow !== undefined) {
          results = results.filter((t) => t.windowId === 1);
        }
        if (queryInfo.url !== undefined) {
          const urlPattern = queryInfo.url;
          if (typeof urlPattern === 'string') {
            results = results.filter((t) => t.url?.includes(urlPattern));
          }
        }
        if (queryInfo.status !== undefined) {
          results = results.filter((t) => t.status === queryInfo.status);
        }

        return Promise.resolve(results);
      },
    ),

    get: vi.fn((tabId: number): Promise<chrome.tabs.Tab> => {
      const tab = mockTabs.find((t) => t.id === tabId);
      if (!tab) {
        return Promise.reject(new Error(`No tab with id: ${tabId}`));
      }
      return Promise.resolve({ ...tab });
    }),

    create: vi.fn(
      (
        createProperties: chrome.tabs.CreateProperties,
      ): Promise<chrome.tabs.Tab> => {
        const newTab: chrome.tabs.Tab = {
          id: nextTabId++,
          index: mockTabs.length,
          windowId: createProperties.windowId ?? 1,
          highlighted: false,
          active: createProperties.active ?? true,
          pinned: createProperties.pinned ?? false,
          incognito: false,
          url: createProperties.url ?? 'chrome://newtab',
          title: '',
          status: 'loading',
          discarded: false,
          autoDiscardable: true,
          groupId: -1,
        };

        // Deactivate other tabs if this one is active
        if (newTab.active) {
          for (const tab of mockTabs) {
            tab.active = false;
          }
        }

        mockTabs.push(newTab);
        onCreated.dispatch(newTab);
        return Promise.resolve({ ...newTab });
      },
    ),

    update: vi.fn(
      (
        tabId: number,
        updateProperties: chrome.tabs.UpdateProperties,
      ): Promise<chrome.tabs.Tab> => {
        const tab = mockTabs.find((t) => t.id === tabId);
        if (!tab) {
          return Promise.reject(new Error(`No tab with id: ${tabId}`));
        }

        const changeInfo: chrome.tabs.TabChangeInfo = {};

        if (updateProperties.url !== undefined) {
          changeInfo.url = updateProperties.url;
          tab.url = updateProperties.url;
          changeInfo.status = 'loading';
          tab.status = 'loading';
        }
        if (updateProperties.active !== undefined) {
          tab.active = updateProperties.active;
          if (updateProperties.active) {
            for (const t of mockTabs) {
              if (t.id !== tabId) t.active = false;
            }
            onActivated.dispatch({ tabId, windowId: tab.windowId });
          }
        }
        if (updateProperties.pinned !== undefined) {
          changeInfo.pinned = updateProperties.pinned;
          tab.pinned = updateProperties.pinned;
        }

        onUpdated.dispatch(tabId, changeInfo, { ...tab });
        return Promise.resolve({ ...tab });
      },
    ),

    remove: vi.fn((tabIds: number | number[]): Promise<void> => {
      const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
      for (const id of ids) {
        const index = mockTabs.findIndex((t) => t.id === id);
        if (index !== -1) {
          const tab = mockTabs[index];
          mockTabs.splice(index, 1);
          onRemoved.dispatch(id, {
            windowId: tab.windowId,
            isWindowClosing: false,
          });
        }
      }
      return Promise.resolve();
    }),

    sendMessage: vi.fn(
      (
        tabId: number,
        message: unknown,
        _options?: chrome.tabs.MessageSendOptions,
      ): Promise<unknown> => {
        const tab = mockTabs.find((t) => t.id === tabId);
        if (!tab) {
          return Promise.reject(
            new Error(`Could not establish connection. Receiving end does not exist.`),
          );
        }
        // Default: resolve with undefined (no listener responded)
        return Promise.resolve(undefined);
      },
    ),

    captureVisibleTab: vi.fn(
      (
        windowId?: number,
        options?: chrome.tabs.CaptureVisibleTabOptions,
      ): Promise<string> => {
        const format = options?.format ?? 'png';
        return Promise.resolve(
          `data:image/${format};base64,mockScreenshotBase64Data`,
        );
      },
    ),

    onUpdated,
    onRemoved,
    onActivated,
    onCreated,

    /** Test-only: set mock tabs for query */
    _setTabs: (tabs: chrome.tabs.Tab[]) => {
      mockTabs = tabs;
    },
    /** Test-only: get current tabs */
    _getTabs: () => [...mockTabs],
  };
}

// ============================================================================
// chrome.scripting
// ============================================================================

function createMockScripting() {
  return {
    executeScript: vi.fn(
      (
        injection: chrome.scripting.ScriptInjection,
      ): Promise<chrome.scripting.InjectionResult[]> => {
        return Promise.resolve([
          {
            documentId: 'mock-doc-id',
            frameId: 0,
            result: undefined,
          },
        ]);
      },
    ),

    insertCSS: vi.fn(
      (injection: chrome.scripting.CSSInjection): Promise<void> => {
        return Promise.resolve();
      },
    ),

    removeCSS: vi.fn(
      (injection: chrome.scripting.CSSInjection): Promise<void> => {
        return Promise.resolve();
      },
    ),
  };
}

// ============================================================================
// chrome.runtime
// ============================================================================

function createMockRuntime() {
  const onMessage = createMockEvent<
    (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => void
  >();
  const onInstalled = createMockEvent<
    (details: chrome.runtime.InstalledDetails) => void
  >();
  const onStartup = createMockEvent<() => void>();
  const onConnect = createMockEvent<(port: chrome.runtime.Port) => void>();
  const onSuspend = createMockEvent<() => void>();

  return {
    id: 'mock-extension-id-abc123',

    sendMessage: vi.fn(
      (message: unknown, _options?: unknown): Promise<unknown> => {
        return Promise.resolve(undefined);
      },
    ),

    getURL: vi.fn((path: string): string => {
      return `chrome-extension://mock-extension-id-abc123/${path}`;
    }),

    getManifest: vi.fn(
      (): chrome.runtime.Manifest => ({
        manifest_version: 3,
        name: 'Flux Agent Extension',
        version: '0.1.0',
        description: 'AI-powered browser automation',
      }),
    ),

    openOptionsPage: vi.fn((): Promise<void> => {
      return Promise.resolve();
    }),

    connect: vi.fn(
      (
        connectInfo?: chrome.runtime.ConnectInfo,
      ): chrome.runtime.Port => {
        const port: chrome.runtime.Port = {
          name: connectInfo?.name ?? '',
          disconnect: vi.fn(),
          postMessage: vi.fn(),
          onDisconnect: createMockEvent(),
          onMessage: createMockEvent(),
          sender: undefined,
        };
        return port;
      },
    ),

    lastError: null as chrome.runtime.LastError | null,

    onMessage,
    onInstalled,
    onStartup,
    onConnect,
    onSuspend,

    /** Test-only: simulate runtime.lastError */
    _setLastError: (error: chrome.runtime.LastError | null) => {
      createMockRuntime._lastError = error;
    },
    _lastError: null as chrome.runtime.LastError | null,
  };
}

// ============================================================================
// chrome.commands
// ============================================================================

function createMockCommands() {
  return {
    onCommand: createMockEvent<(command: string) => void>(),
  };
}

// ============================================================================
// chrome.sidePanel
// ============================================================================

function createMockSidePanel() {
  return {
    setOptions: vi.fn(
      (options: chrome.sidePanel.SetPanelBehaviorOptions): Promise<void> => {
        return Promise.resolve();
      },
    ),

    open: vi.fn(
      (options?: { windowId?: number; tabId?: number }): Promise<void> => {
        return Promise.resolve();
      },
    ),

    getOptions: vi.fn(
      (
        options?: chrome.sidePanel.GetPanelOptions,
      ): Promise<chrome.sidePanel.PanelOptions> => {
        return Promise.resolve({ enabled: true });
      },
    ),

    setPanelBehavior: vi.fn(
      (behavior: chrome.sidePanel.SetPanelBehaviorOptions): Promise<void> => {
        return Promise.resolve();
      },
    ),
  };
}

// ============================================================================
// chrome.debugger
// ============================================================================

function createMockDebugger() {
  const onEvent = createMockEvent<
    (
      source: chrome.debugger.Debuggee,
      method: string,
      params?: object,
    ) => void
  >();
  const onDetach = createMockEvent<
    (source: chrome.debugger.Debuggee, reason: string) => void
  >();

  return {
    attach: vi.fn(
      (
        target: chrome.debugger.Debuggee,
        requiredVersion: string,
      ): Promise<void> => {
        const key = JSON.stringify(target);
        if (debuggerTargets.has(key)) {
          return Promise.reject(
            new Error('Another debugger is already attached'),
          );
        }
        debuggerTargets.add(key);
        return Promise.resolve();
      },
    ),

    detach: vi.fn(
      (target: chrome.debugger.Debuggee): Promise<void> => {
        const key = JSON.stringify(target);
        debuggerTargets.delete(key);
        onDetach.dispatch(target, 'canceled_by_user');
        return Promise.resolve();
      },
    ),

    sendCommand: vi.fn(
      (
        target: chrome.debugger.Debuggee,
        method: string,
        commandParams?: object,
      ): Promise<object> => {
        const key = JSON.stringify(target);
        if (!debuggerTargets.has(key)) {
          return Promise.reject(new Error('Debugger is not attached'));
        }
        // Return empty object by default — tests can override with mockReturnValue
        return Promise.resolve({});
      },
    ),

    onEvent,
    onDetach,
  };
}

// ============================================================================
// chrome.cookies
// ============================================================================

function createMockCookies() {
  const onChanged = createMockEvent<
    (changeInfo: chrome.cookies.CookieChangeInfo) => void
  >();

  return {
    get: vi.fn(
      (
        details: chrome.cookies.Details,
      ): Promise<chrome.cookies.Cookie | null> => {
        const found = cookieStore.find(
          (c) =>
            c.name === details.name &&
            c.domain === (details.url ? new URL(details.url).hostname : ''),
        );
        return Promise.resolve(found ?? null);
      },
    ),

    getAll: vi.fn(
      (details: chrome.cookies.GetAllDetails): Promise<chrome.cookies.Cookie[]> => {
        let results = [...cookieStore];
        if (details.domain) {
          results = results.filter((c) => c.domain === details.domain);
        }
        if (details.name) {
          results = results.filter((c) => c.name === details.name);
        }
        return Promise.resolve(results);
      },
    ),

    set: vi.fn(
      (details: chrome.cookies.SetDetails): Promise<chrome.cookies.Cookie> => {
        const cookie: chrome.cookies.Cookie = {
          name: details.name ?? '',
          value: details.value ?? '',
          domain: details.domain ?? '',
          path: details.path ?? '/',
          secure: details.secure ?? false,
          httpOnly: details.httpOnly ?? false,
          sameSite: (details.sameSite as chrome.cookies.SameSiteStatus) ?? 'unspecified',
          expirationDate: details.expirationDate,
          session: !details.expirationDate,
          hostOnly: false,
          storeId: '0',
        };

        // Remove existing cookie with same name+domain
        cookieStore = cookieStore.filter(
          (c) => !(c.name === cookie.name && c.domain === cookie.domain),
        );
        cookieStore.push(cookie);

        onChanged.dispatch({ cookie, removed: false, cause: 'explicit' });
        return Promise.resolve(cookie);
      },
    ),

    remove: vi.fn(
      (
        details: chrome.cookies.Details,
      ): Promise<chrome.cookies.Details | null> => {
        const index = cookieStore.findIndex(
          (c) => c.name === details.name,
        );
        if (index !== -1) {
          const removed = cookieStore.splice(index, 1)[0];
          onChanged.dispatch({
            cookie: removed,
            removed: true,
            cause: 'explicit',
          });
          return Promise.resolve(details);
        }
        return Promise.resolve(null);
      },
    ),

    onChanged,

    /** Test-only: set cookies directly */
    _setCookies: (cookies: chrome.cookies.Cookie[]) => {
      cookieStore = cookies;
    },
  };
}

// ============================================================================
// chrome.webNavigation
// ============================================================================

function createMockWebNavigation() {
  return {
    onCompleted: createMockEvent<
      (details: chrome.webNavigation.WebNavigationFramedCallbackDetails) => void
    >(),
    onBeforeNavigate: createMockEvent<
      (details: chrome.webNavigation.WebNavigationParentedCallbackDetails) => void
    >(),
    onCommitted: createMockEvent<
      (details: chrome.webNavigation.WebNavigationTransitionCallbackDetails) => void
    >(),
    onDOMContentLoaded: createMockEvent<
      (details: chrome.webNavigation.WebNavigationFramedCallbackDetails) => void
    >(),
    onErrorOccurred: createMockEvent<
      (details: chrome.webNavigation.WebNavigationFramedErrorCallbackDetails) => void
    >(),
  };
}

// ============================================================================
// chrome.notifications
// ============================================================================

function createMockNotifications() {
  const onClicked = createMockEvent<(notificationId: string) => void>();
  const onClosed = createMockEvent<
    (notificationId: string, byUser: boolean) => void
  >();

  return {
    create: vi.fn(
      (
        notificationId: string,
        options: chrome.notifications.NotificationOptions,
      ): Promise<string> => {
        const id = notificationId || `notification-${Date.now()}`;
        notificationStore.set(id, options);
        return Promise.resolve(id);
      },
    ),

    clear: vi.fn((notificationId: string): Promise<boolean> => {
      const existed = notificationStore.has(notificationId);
      notificationStore.delete(notificationId);
      if (existed) {
        onClosed.dispatch(notificationId, false);
      }
      return Promise.resolve(existed);
    }),

    update: vi.fn(
      (
        notificationId: string,
        options: chrome.notifications.NotificationOptions,
      ): Promise<boolean> => {
        if (notificationStore.has(notificationId)) {
          notificationStore.set(notificationId, options);
          return Promise.resolve(true);
        }
        return Promise.resolve(false);
      },
    ),

    getAll: vi.fn((): Promise<Record<string, boolean>> => {
      const result: Record<string, boolean> = {};
      for (const id of notificationStore.keys()) {
        result[id] = true;
      }
      return Promise.resolve(result);
    }),

    onClicked,
    onClosed,
  };
}

// ============================================================================
// chrome.action (MV3 replacement for browserAction)
// ============================================================================

function createMockAction() {
  return {
    setIcon: vi.fn(
      (details: chrome.action.SetIconDetails): Promise<void> => {
        return Promise.resolve();
      },
    ),
    setTitle: vi.fn(
      (details: chrome.action.SetTitleDetails): Promise<void> => {
        return Promise.resolve();
      },
    ),
    setBadgeText: vi.fn(
      (details: chrome.action.SetBadgeTextDetails): Promise<void> => {
        return Promise.resolve();
      },
    ),
    setBadgeBackgroundColor: vi.fn(
      (details: chrome.action.SetBadgeBackgroundColorDetails): Promise<void> => {
        return Promise.resolve();
      },
    ),
    onClicked: createMockEvent<(tab: chrome.tabs.Tab) => void>(),
  };
}

// ============================================================================
// chrome.alarms
// ============================================================================

function createMockAlarms() {
  const alarmStore = new Map<string, chrome.alarms.Alarm>();
  const onAlarm = createMockEvent<(alarm: chrome.alarms.Alarm) => void>();

  return {
    create: vi.fn(
      (
        name: string,
        alarmInfo: chrome.alarms.AlarmCreateInfo,
      ): Promise<void> => {
        const alarm: chrome.alarms.Alarm = {
          name,
          scheduledTime: Date.now() + (alarmInfo.delayInMinutes ?? 0) * 60_000,
          periodInMinutes: alarmInfo.periodInMinutes,
        };
        alarmStore.set(name, alarm);
        return Promise.resolve();
      },
    ),

    get: vi.fn(
      (name: string): Promise<chrome.alarms.Alarm | undefined> => {
        return Promise.resolve(alarmStore.get(name));
      },
    ),

    getAll: vi.fn((): Promise<chrome.alarms.Alarm[]> => {
      return Promise.resolve([...alarmStore.values()]);
    }),

    clear: vi.fn((name: string): Promise<boolean> => {
      const had = alarmStore.has(name);
      alarmStore.delete(name);
      return Promise.resolve(had);
    }),

    clearAll: vi.fn((): Promise<boolean> => {
      const had = alarmStore.size > 0;
      alarmStore.clear();
      return Promise.resolve(had);
    }),

    onAlarm,
  };
}

// ============================================================================
// Main Factory
// ============================================================================

/**
 * Create a fresh Chrome API mock object.
 *
 * @returns A fully mocked `chrome` global object.
 */
export function createChromeMock() {
  return {
    storage: createMockStorage(),
    tabs: createMockTabs(),
    scripting: createMockScripting(),
    runtime: createMockRuntime(),
    commands: createMockCommands(),
    sidePanel: createMockSidePanel(),
    debugger: createMockDebugger(),
    cookies: createMockCookies(),
    webNavigation: createMockWebNavigation(),
    notifications: createMockNotifications(),
    action: createMockAction(),
    alarms: createMockAlarms(),
  };
}

/** The current active mock instance — set by `installChromeMock()` */
let currentMock: ReturnType<typeof createChromeMock> | null = null;

/**
 * Install chrome mock as a global. Call in beforeEach.
 */
export function installChromeMock(): ReturnType<typeof createChromeMock> {
  const mock = createChromeMock();
  currentMock = mock;
  vi.stubGlobal('chrome', mock);
  return mock;
}

/**
 * Reset ALL internal mock state. Call in afterEach.
 *
 * - Clears in-memory stores (storage, tabs, cookies, notifications)
 * - Resets tab counter
 * - Clears debugger targets
 */
export function resetAllMocks(): void {
  // Clear storage stores in-place
  for (const key of Object.keys(storageLocalStore)) {
    delete storageLocalStore[key];
  }
  for (const key of Object.keys(storageSyncStore)) {
    delete storageSyncStore[key];
  }
  for (const key of Object.keys(storageSessionStore)) {
    delete storageSessionStore[key];
  }

  // Reset tabs
  mockTabs = [
    {
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
    },
  ];
  nextTabId = 2;

  // Clear cookies
  cookieStore = [];

  // Clear notifications
  notificationStore.clear();

  // Clear debugger targets
  debuggerTargets.clear();

  currentMock = null;
}

/**
 * Get a snapshot of all internal mock state for test assertions.
 */
export function getMockStore() {
  return {
    storageLocal: { ...storageLocalStore },
    storageSync: { ...storageSyncStore },
    storageSession: { ...storageSessionStore },
    tabs: [...mockTabs],
    cookies: [...cookieStore],
    notifications: Object.fromEntries(notificationStore),
    debuggerTargets: [...debuggerTargets],
  };
}

/**
 * Get the currently installed chrome mock instance.
 */
export function getCurrentMock(): ReturnType<typeof createChromeMock> | null {
  return currentMock;
}
