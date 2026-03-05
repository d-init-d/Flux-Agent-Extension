/**
 * @module background/index
 * @description Service Worker entry point for the Flux Agent Chrome Extension (MV3).
 *
 * Responsibilities:
 * - Boot the ServiceWorkerBridge for content script communication
 * - Register chrome event listeners (tabs, navigation, runtime)
 * - Track per-tab state (URL, title, loading, content script readiness)
 * - Handle ExtensionMessages from UI surfaces (popup, sidepanel, options)
 * - Keep the service worker alive via periodic self-ping
 */

import { ServiceWorkerBridge } from '@core/bridge';
import { Logger } from '@shared/utils';
import type {
  TabState,
  MessageType,
  ExtensionMessage,
  ExtensionResponse,
} from '@shared/types';

// ============================================================================
// Constants
// ============================================================================

/** Interval (ms) for the keep-alive heartbeat. Must be < 30 s (SW idle limit). */
const KEEP_ALIVE_INTERVAL_MS = 25_000;

/** Default extension settings written on first install. */
const DEFAULT_SETTINGS = {
  language: 'auto' as const,
  theme: 'system' as const,
  debugMode: false,
  streamResponses: true,
  includeScreenshotsInContext: false,
  maxContextLength: 128_000,
  defaultTimeout: 30_000,
  autoRetryOnFailure: true,
  maxRetries: 3,
  screenshotOnError: true,
  allowCustomScripts: false,
  allowedDomains: [] as string[],
  blockedDomains: [] as string[],
  showFloatingBar: true,
  highlightElements: true,
  soundNotifications: false,
  logNetworkRequests: false,
};

// ============================================================================
// KeepAliveManager
// ============================================================================

/**
 * Prevents the MV3 service worker from being terminated due to inactivity.
 *
 * Chrome kills a service worker after ~30 seconds of idle time. This manager
 * calls `chrome.runtime.getPlatformInfo()` on a 25-second interval as a
 * lightweight no-op to reset the idle timer.
 */
export class KeepAliveManager {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child('KeepAlive');
  }

  /**
   * Start the keep-alive heartbeat.
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  start(): void {
    if (this.intervalId !== null) {
      return;
    }

    this.intervalId = setInterval(() => {
      try {
        chrome.runtime.getPlatformInfo().catch(() => {
          // Swallow — the call itself is the keep-alive signal.
        });
      } catch {
        // chrome.runtime may be unavailable if the extension is unloading.
      }
    }, KEEP_ALIVE_INTERVAL_MS);

    this.logger.debug(`Started (interval=${KEEP_ALIVE_INTERVAL_MS}ms)`);
  }

  /** Stop the keep-alive heartbeat. */
  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger.debug('Stopped');
    }
  }

  /** Whether the heartbeat is currently running. */
  isRunning(): boolean {
    return this.intervalId !== null;
  }
}

// ============================================================================
// ServiceWorkerManager
// ============================================================================

/**
 * Top-level orchestrator for the Flux Agent service worker.
 *
 * Owns the bridge, keep-alive manager, tab-state map, and all chrome event
 * listener registrations. Instantiated once at module load.
 */
export class ServiceWorkerManager {
  private readonly bridge: ServiceWorkerBridge;
  private readonly logger: Logger;
  private readonly keepAlive: KeepAliveManager;
  private readonly tabStates: Map<number, TabState> = new Map();

  /** Unsubscribe functions returned by `bridge.onEvent()`. */
  private readonly bridgeUnsubscribers: Array<() => void> = [];

  constructor() {
    this.logger = new Logger('FluxSW', 'debug');
    this.bridge = new ServiceWorkerBridge();
    this.keepAlive = new KeepAliveManager(this.logger);
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Boot sequence — called once when the service worker activates.
   *
   * Order matters:
   * 1. Chrome listeners (must be registered synchronously in the top-level
   *    execution context for MV3 event pages to function correctly).
   * 2. Bridge event handlers.
   * 3. Keep-alive.
   */
  async initialize(): Promise<void> {
    try {
      this.registerChromeListeners();
      this.registerBridgeEventHandlers();
      this.keepAlive.start();
      this.logger.info('Flux Agent Service Worker initialized');
    } catch (error: unknown) {
      this.logger.error('Failed to initialize Service Worker', error);
      throw error;
    }
  }

  /** Tear everything down cleanly. */
  destroy(): void {
    this.keepAlive.stop();

    for (const unsub of this.bridgeUnsubscribers) {
      try {
        unsub();
      } catch {
        // Best-effort cleanup
      }
    }
    this.bridgeUnsubscribers.length = 0;

    this.bridge.destroy();
    this.tabStates.clear();

    this.logger.info('Flux Agent Service Worker destroyed');
  }

  // --------------------------------------------------------------------------
  // Chrome Event Listeners
  // --------------------------------------------------------------------------

  private registerChromeListeners(): void {
    // -- runtime.onInstalled ------------------------------------------------
    chrome.runtime.onInstalled.addListener((details) => {
      try {
        this.onInstalled(details);
      } catch (error: unknown) {
        this.logger.error('Error in onInstalled handler', error);
      }
    });

    // -- runtime.onStartup --------------------------------------------------
    chrome.runtime.onStartup.addListener(() => {
      try {
        this.onStartup();
      } catch (error: unknown) {
        this.logger.error('Error in onStartup handler', error);
      }
    });

    // -- tabs.onUpdated -----------------------------------------------------
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      try {
        this.onTabUpdated(tabId, changeInfo, tab);
      } catch (error: unknown) {
        this.logger.error(`Error in tabs.onUpdated for tab ${tabId}`, error);
      }
    });

    // -- tabs.onRemoved -----------------------------------------------------
    chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
      try {
        this.onTabRemoved(tabId, removeInfo);
      } catch (error: unknown) {
        this.logger.error(`Error in tabs.onRemoved for tab ${tabId}`, error);
      }
    });

    // -- tabs.onActivated ---------------------------------------------------
    chrome.tabs.onActivated.addListener((activeInfo) => {
      try {
        this.onTabActivated(activeInfo);
      } catch (error: unknown) {
        this.logger.error('Error in tabs.onActivated', error);
      }
    });

    // -- webNavigation.onCommitted ------------------------------------------
    chrome.webNavigation.onCommitted.addListener((details) => {
      try {
        this.onNavigationCommitted(details);
      } catch (error: unknown) {
        this.logger.error(
          `Error in webNavigation.onCommitted for tab ${details.tabId}`,
          error,
        );
      }
    });

    // -- runtime.onMessage (Extension Messages from UI) ---------------------
    chrome.runtime.onMessage.addListener(
      (message, sender, sendResponse): boolean | undefined => {
        try {
          return this.handleExtensionMessage(message, sender, sendResponse);
        } catch (error: unknown) {
          this.logger.error('Error in runtime.onMessage (extension)', error);
          sendResponse({
            success: false,
            error: {
              code: 'UNKNOWN_ERROR',
              message:
                error instanceof Error
                  ? error.message
                  : 'Unknown error in message handler',
            },
          } satisfies ExtensionResponse);
          return false;
        }
      },
    );

    this.logger.debug('Chrome event listeners registered');
  }

  // --------------------------------------------------------------------------
  // Chrome Event Handlers
  // --------------------------------------------------------------------------

  // --------------------------------------------------------------------------
  // Chrome Event Handlers
  //
  // Parameter types are intentionally omitted where `chrome-types` diverges
  // from `@types/chrome` naming. TypeScript infers the correct types from the
  // `addListener` call-site.
  // --------------------------------------------------------------------------

  /**
   * Handle extension install or update.
   * Writes default settings to storage on first install.
   */
  private onInstalled: Parameters<typeof chrome.runtime.onInstalled.addListener>[0] = (details) => {
    this.logger.info(`Extension ${details.reason}`, {
      reason: details.reason,
      previousVersion: details.previousVersion,
    });

    if (details.reason === 'install') {
      chrome.storage.local
        .set({ settings: DEFAULT_SETTINGS })
        .then(() => {
          this.logger.info('Default settings initialized in storage');
        })
        .catch((error: unknown) => {
          this.logger.error('Failed to write default settings', error);
        });
    }
  };

  /**
   * Handle browser startup (cold start).
   * Clears any stale tab state from a previous session.
   */
  private onStartup = (): void => {
    this.logger.info('Browser startup — clearing stale state');
    this.tabStates.clear();
  };

  /**
   * Track tab property changes (URL, title, loading status).
   *
   * When `status` transitions to `'complete'`, contentScriptReady is reset to
   * `false`. The content script will re-announce itself via a PAGE_LOADED
   * bridge event once it has loaded.
   */
  private onTabUpdated: Parameters<typeof chrome.tabs.onUpdated.addListener>[0] = (tabId, changeInfo, tab) => {
    const existing = this.tabStates.get(tabId);
    const now = Date.now();

    const updated: TabState = {
      id: tabId,
      url: changeInfo.url ?? existing?.url ?? tab.url ?? '',
      title: changeInfo.title ?? existing?.title ?? tab.title ?? '',
      status:
        changeInfo.status === 'loading' || changeInfo.status === 'complete'
          ? changeInfo.status
          : existing?.status ?? 'loading',
      isActive: existing?.isActive ?? false,
      contentScriptReady:
        changeInfo.status === 'complete'
          ? false // Reset — content script will re-signal via PAGE_LOADED
          : existing?.contentScriptReady ?? false,
      lastUpdated: now,
    };

    this.tabStates.set(tabId, updated);

    this.logger.debug(`Tab ${tabId} updated`, {
      url: updated.url,
      status: updated.status,
      contentScriptReady: updated.contentScriptReady,
    });
  };

  /** Clean up state when a tab is closed. */
  private onTabRemoved: Parameters<typeof chrome.tabs.onRemoved.addListener>[0] = (tabId, _removeInfo) => {
    const had = this.tabStates.delete(tabId);
    if (had) {
      this.logger.debug(`Tab ${tabId} removed — state cleaned up`);
    }
  };

  /**
   * Track which tab is currently active in its window.
   * Marks the newly activated tab as `isActive=true` and the previously active
   * tab in the same window as `isActive=false`.
   */
  private onTabActivated: Parameters<typeof chrome.tabs.onActivated.addListener>[0] = (activeInfo) => {
    // Deactivate the previous active tab in the same window
    for (const [id, state] of this.tabStates) {
      if (state.isActive && id !== activeInfo.tabId) {
        this.tabStates.set(id, { ...state, isActive: false, lastUpdated: Date.now() });
      }
    }

    // Activate the new tab (create state if we haven't seen it yet)
    const existing = this.tabStates.get(activeInfo.tabId);
    if (existing) {
      this.tabStates.set(activeInfo.tabId, {
        ...existing,
        isActive: true,
        lastUpdated: Date.now(),
      });
    } else {
      // We may not have an entry yet (e.g. SW restarted after being killed).
      // Fetch basic info from the chrome API.
      chrome.tabs
        .get(activeInfo.tabId)
        .then((tab) => {
          this.tabStates.set(activeInfo.tabId, {
            id: activeInfo.tabId,
            url: tab.url ?? '',
            title: tab.title ?? '',
            status: tab.status === 'complete' ? 'complete' : 'loading',
            isActive: true,
            contentScriptReady: false,
            lastUpdated: Date.now(),
          });
        })
        .catch((error: unknown) => {
          this.logger.warn(
            `Failed to query tab ${activeInfo.tabId} on activation`,
            error,
          );
        });
    }

    this.logger.debug(`Tab ${activeInfo.tabId} activated`);
  };

  /**
   * Detect committed navigations.
   *
   * Only handles main-frame navigations (frameId === 0). Sub-frame navigations
   * are ignored. Resets contentScriptReady because the page is being replaced.
   */
  private onNavigationCommitted: Parameters<typeof chrome.webNavigation.onCommitted.addListener>[0] = (details) => {
    // Ignore sub-frame navigations
    if (details.frameId !== 0) {
      return;
    }

    const existing = this.tabStates.get(details.tabId);
    this.tabStates.set(details.tabId, {
      id: details.tabId,
      url: details.url,
      title: existing?.title ?? '',
      status: 'loading',
      isActive: existing?.isActive ?? false,
      contentScriptReady: false,
      lastUpdated: Date.now(),
    });

    this.logger.debug(`Navigation committed in tab ${details.tabId}`, {
      url: details.url,
      transitionType: details.transitionType,
    });
  };

  // --------------------------------------------------------------------------
  // Extension Message Handler (UI ↔ SW)
  // --------------------------------------------------------------------------

  /**
   * Handle messages from UI surfaces (popup, sidepanel, options page).
   *
   * This listener is SEPARATE from the ServiceWorkerBridge's onMessage
   * handler. The bridge handles BridgeMessages from content scripts (identified
   * by having a `sender.tab`). This handler processes ExtensionMessages from
   * the extension's own pages (no `sender.tab`).
   *
   * Distinguishing logic:
   * - If the message has a `channel` property → ExtensionMessage from UI.
   * - If the sender has a `tab` property → content script message (handled by
   *   bridge, return `undefined` to let the bridge pick it up).
   *
   * @returns `true` to keep the sendResponse channel open for async reply,
   *          or `undefined` if this listener does not handle the message.
   */
  private handleExtensionMessage(
    message: unknown,
    sender: Parameters<Parameters<typeof chrome.runtime.onMessage.addListener>[0]>[1],
    sendResponse: Parameters<Parameters<typeof chrome.runtime.onMessage.addListener>[0]>[2],
  ): boolean | undefined {
    // Content script messages have sender.tab — let the bridge handle them
    if (sender.tab) {
      return undefined;
    }

    // Validate ExtensionMessage structure
    if (!this.isExtensionMessage(message)) {
      return undefined;
    }

    const extMsg = message as ExtensionMessage;

    this.logger.debug(`ExtensionMessage received: type="${extMsg.type}"`, {
      id: extMsg.id,
      channel: extMsg.channel,
    });

    // Stub handler — all types return NOT_IMPLEMENTED until Sprint 2.x
    const response: ExtensionResponse = {
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: `Handler for "${extMsg.type}" is not yet implemented`,
      },
    };

    sendResponse(response);

    // Return false — response was sent synchronously
    return false;
  }

  /**
   * Duck-type check for ExtensionMessage structure.
   * An ExtensionMessage has: id (string), channel (string), type (string),
   * payload (any), timestamp (number).
   */
  private isExtensionMessage(value: unknown): value is ExtensionMessage {
    if (value === null || value === undefined || typeof value !== 'object') {
      return false;
    }
    const obj = value as Record<string, unknown>;
    return (
      typeof obj['id'] === 'string' &&
      typeof obj['channel'] === 'string' &&
      typeof obj['type'] === 'string' &&
      'payload' in obj &&
      typeof obj['timestamp'] === 'number'
    );
  }

  // --------------------------------------------------------------------------
  // Bridge Event Handlers
  // --------------------------------------------------------------------------

  /**
   * Subscribe to content script events via the bridge.
   *
   * These handlers react to lifecycle events from content scripts
   * (PAGE_LOADED, PAGE_UNLOAD, DOM_MUTATION) to keep tab state in sync.
   */
  private registerBridgeEventHandlers(): void {
    // PAGE_LOADED — content script announces it's ready
    const unsubPageLoaded = this.bridge.onEvent(
      'PAGE_LOADED' as MessageType,
      (tabId: number, payload: unknown) => {
        try {
          const existing = this.tabStates.get(tabId);
          this.tabStates.set(tabId, {
            id: tabId,
            url: existing?.url ?? '',
            title: existing?.title ?? '',
            status: 'complete',
            isActive: existing?.isActive ?? false,
            contentScriptReady: true,
            lastUpdated: Date.now(),
          });

          this.logger.info(`Content script ready in tab ${tabId}`, payload);
        } catch (error: unknown) {
          this.logger.error(`Error handling PAGE_LOADED for tab ${tabId}`, error);
        }
      },
    );
    this.bridgeUnsubscribers.push(unsubPageLoaded);

    // PAGE_UNLOAD — content script is going away
    const unsubPageUnload = this.bridge.onEvent(
      'PAGE_UNLOAD' as MessageType,
      (tabId: number, _payload: unknown) => {
        try {
          const existing = this.tabStates.get(tabId);
          if (existing) {
            this.tabStates.set(tabId, {
              ...existing,
              contentScriptReady: false,
              lastUpdated: Date.now(),
            });
          }

          this.logger.debug(`Content script unloaded in tab ${tabId}`);
        } catch (error: unknown) {
          this.logger.error(`Error handling PAGE_UNLOAD for tab ${tabId}`, error);
        }
      },
    );
    this.bridgeUnsubscribers.push(unsubPageUnload);

    // DOM_MUTATION — logged for future use
    const unsubDomMutation = this.bridge.onEvent(
      'DOM_MUTATION' as MessageType,
      (tabId: number, payload: unknown) => {
        try {
          this.logger.debug(`DOM mutation in tab ${tabId}`, payload);
        } catch (error: unknown) {
          this.logger.error(`Error handling DOM_MUTATION for tab ${tabId}`, error);
        }
      },
    );
    this.bridgeUnsubscribers.push(unsubDomMutation);

    this.logger.debug('Bridge event handlers registered');
  }
}

// ============================================================================
// Bootstrap
// ============================================================================

/**
 * MV3 service workers must register all event listeners synchronously in the
 * top-level execution context. We construct the manager and call initialize()
 * immediately so that chrome.* listeners are wired before the first event
 * fires.
 */
const manager = new ServiceWorkerManager();

manager.initialize().catch((error: unknown) => {
  // Fatal — if initialization fails the extension is non-functional.
  // Log to console as a last resort (Logger may not be usable).
  console.error('[FluxSW] FATAL: Service Worker initialization failed', error);
});
