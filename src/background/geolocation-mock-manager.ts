import { DebuggerAdapter } from '@core/browser-controller';
import type { MockGeolocationAction } from '@shared/types/actions';
import { Logger } from '@shared/utils';

export interface AppliedGeolocationMock {
  sessionId: string;
  tabId: number;
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export interface IGeolocationMockManager {
  activateSession(sessionId: string, tabId: number | null): void;
  applyAction(sessionId: string, tabId: number, action: MockGeolocationAction): Promise<AppliedGeolocationMock>;
  clearSession(sessionId: string): Promise<void>;
  dispose?(): void;
}

interface GeolocationMockManagerOptions {
  debuggerAdapter?: DebuggerAdapter;
  logger?: Logger;
}

export class GeolocationMockManager implements IGeolocationMockManager {
  private readonly debuggerAdapter: DebuggerAdapter;
  private readonly logger: Logger;
  private readonly mockByTab = new Map<number, AppliedGeolocationMock>();
  private readonly tabIdsBySession = new Map<string, Set<number>>();
  private readonly activeSessionByTab = new Map<number, string>();
  private readonly removeDebuggerDetachListener: () => void;

  constructor(options: GeolocationMockManagerOptions = {}) {
    this.debuggerAdapter = options.debuggerAdapter ?? new DebuggerAdapter();
    this.logger = options.logger ?? new Logger('FluxSW:GeolocationMockManager', 'warn');
    this.removeDebuggerDetachListener = this.debuggerAdapter.onDetach((tabId, reason) => {
      this.logger.debug('Debugger detached; dropping geolocation mock state', { tabId, reason });
      this.dropTabState(tabId);
    });

    chrome.tabs.onRemoved.addListener(this.handleTabRemoved);
  }

  dispose(): void {
    this.removeDebuggerDetachListener();
    chrome.tabs.onRemoved.removeListener(this.handleTabRemoved);
  }

  activateSession(sessionId: string, tabId: number | null): void {
    for (const [candidateTabId, candidateSessionId] of this.activeSessionByTab.entries()) {
      if (candidateSessionId === sessionId && candidateTabId !== tabId) {
        this.activeSessionByTab.delete(candidateTabId);
      }
    }

    if (tabId === null) {
      return;
    }

    const existing = this.mockByTab.get(tabId);
    if (existing && existing.sessionId !== sessionId) {
      void this.clearTab(tabId);
      return;
    }

    this.activeSessionByTab.set(tabId, sessionId);
  }

  async applyAction(
    sessionId: string,
    tabId: number,
    action: MockGeolocationAction,
  ): Promise<AppliedGeolocationMock> {
    const applied: AppliedGeolocationMock = {
      sessionId,
      tabId,
      latitude: action.latitude,
      longitude: action.longitude,
      accuracy: action.accuracy,
    };

    await this.debuggerAdapter.setGeolocationOverride(tabId, {
      latitude: applied.latitude,
      longitude: applied.longitude,
      accuracy: applied.accuracy,
    });

    const existing = this.mockByTab.get(tabId);
    if (existing && existing.sessionId !== sessionId) {
      this.removeSessionTab(existing.sessionId, tabId);
    }

    this.mockByTab.set(tabId, applied);
    const sessionTabs = this.tabIdsBySession.get(sessionId) ?? new Set<number>();
    sessionTabs.add(tabId);
    this.tabIdsBySession.set(sessionId, sessionTabs);
    this.activeSessionByTab.set(tabId, sessionId);

    this.logger.debug('Applied geolocation mock override', {
      sessionId,
      tabId,
      latitude: applied.latitude,
      longitude: applied.longitude,
      accuracy: applied.accuracy,
    });

    return applied;
  }

  async clearSession(sessionId: string): Promise<void> {
    const tabIds = [...(this.tabIdsBySession.get(sessionId) ?? [])];
    for (const tabId of tabIds) {
      const applied = this.mockByTab.get(tabId);
      if (applied?.sessionId === sessionId) {
        await this.clearTab(tabId);
      }
    }

    for (const [tabId, activeSessionId] of this.activeSessionByTab.entries()) {
      if (activeSessionId === sessionId) {
        this.activeSessionByTab.delete(tabId);
      }
    }
  }

  private async clearTab(tabId: number): Promise<void> {
    const applied = this.mockByTab.get(tabId);
    this.dropTabState(tabId);

    if (!applied || !this.debuggerAdapter.isAttached(tabId)) {
      return;
    }

    try {
      await this.debuggerAdapter.clearGeolocationOverride(tabId);
    } catch (error) {
      this.logger.debug('Failed to clear geolocation mock state for tab', { tabId, error });
    }
  }

  private readonly handleTabRemoved: Parameters<typeof chrome.tabs.onRemoved.addListener>[0] = (tabId) => {
    this.logger.debug('Tab removed; dropping geolocation mock state', { tabId });
    this.dropTabState(tabId);
  };

  private dropTabState(tabId: number): void {
    const applied = this.mockByTab.get(tabId);
    if (applied) {
      this.removeSessionTab(applied.sessionId, tabId);
    }

    this.mockByTab.delete(tabId);
    this.activeSessionByTab.delete(tabId);
  }

  private removeSessionTab(sessionId: string, tabId: number): void {
    const sessionTabs = this.tabIdsBySession.get(sessionId);
    if (!sessionTabs) {
      return;
    }

    sessionTabs.delete(tabId);
    if (sessionTabs.size === 0) {
      this.tabIdsBySession.delete(sessionId);
    }
  }
}
