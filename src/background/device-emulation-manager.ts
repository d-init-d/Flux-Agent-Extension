import { DebuggerAdapter } from '@core/browser-controller';
import type { EmulateDeviceAction } from '@shared/types';
import { Logger } from '@shared/utils';

export interface AppliedDeviceEmulation {
  sessionId: string;
  tabId: number;
  preset: EmulateDeviceAction['preset'];
  orientation: NonNullable<EmulateDeviceAction['orientation']>;
  viewport: {
    width: number;
    height: number;
    deviceScaleFactor: number;
    mobile: boolean;
  };
  userAgent: string;
  touchEnabled: true;
}

export interface IDeviceEmulationManager {
  activateSession(sessionId: string, tabId: number | null): void;
  applyAction(sessionId: string, tabId: number, action: EmulateDeviceAction): Promise<AppliedDeviceEmulation>;
  clearSession(sessionId: string): Promise<void>;
  dispose?(): void;
}

interface DeviceEmulationManagerOptions {
  debuggerAdapter?: DebuggerAdapter;
  logger?: Logger;
}

type DevicePresetConfig = {
  width: number;
  height: number;
  deviceScaleFactor: number;
  mobile: boolean;
  userAgent: string;
  platform: string;
};

const DEFAULT_ORIENTATION: NonNullable<EmulateDeviceAction['orientation']> = 'portrait';
const DEFAULT_TOUCH_POINTS = 5;
const DEFAULT_USER_AGENT = typeof navigator !== 'undefined' ? navigator.userAgent : 'Mozilla/5.0';
const DEFAULT_PLATFORM = typeof navigator !== 'undefined' ? navigator.platform : 'Win32';

const DEVICE_PRESETS: Record<EmulateDeviceAction['preset'], DevicePresetConfig> = {
  iphone: {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    platform: 'iPhone',
  },
  pixel: {
    width: 412,
    height: 915,
    deviceScaleFactor: 2.625,
    mobile: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36',
    platform: 'Android',
  },
  ipad: {
    width: 820,
    height: 1180,
    deviceScaleFactor: 2,
    mobile: true,
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    platform: 'iPad',
  },
};

export class DeviceEmulationManager implements IDeviceEmulationManager {
  private readonly debuggerAdapter: DebuggerAdapter;
  private readonly logger: Logger;
  private readonly emulationByTab = new Map<number, AppliedDeviceEmulation>();
  private readonly tabIdsBySession = new Map<string, Set<number>>();
  private readonly activeSessionByTab = new Map<number, string>();
  private readonly removeDebuggerDetachListener: () => void;

  constructor(options: DeviceEmulationManagerOptions = {}) {
    this.debuggerAdapter = options.debuggerAdapter ?? new DebuggerAdapter();
    this.logger = options.logger ?? new Logger('FluxSW:DeviceEmulationManager', 'warn');
    this.removeDebuggerDetachListener = this.debuggerAdapter.onDetach((tabId, reason) => {
      this.logger.debug('Debugger detached; dropping device emulation state', { tabId, reason });
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

    const existing = this.emulationByTab.get(tabId);
    if (existing && existing.sessionId !== sessionId) {
      void this.clearTab(tabId);
      return;
    }

    this.activeSessionByTab.set(tabId, sessionId);
  }

  async applyAction(
    sessionId: string,
    tabId: number,
    action: EmulateDeviceAction,
  ): Promise<AppliedDeviceEmulation> {
    const applied = this.buildAppliedState(sessionId, tabId, action);

    await this.debuggerAdapter.setDeviceMetricsOverride(tabId, {
      width: applied.viewport.width,
      height: applied.viewport.height,
      deviceScaleFactor: applied.viewport.deviceScaleFactor,
      mobile: applied.viewport.mobile,
      screenOrientation:
        applied.orientation === 'landscape'
          ? { type: 'landscapePrimary', angle: 90 }
          : { type: 'portraitPrimary', angle: 0 },
    });
    await this.debuggerAdapter.setUserAgentOverride(tabId, {
      userAgent: applied.userAgent,
      platform: DEVICE_PRESETS[action.preset].platform,
    });
    await this.debuggerAdapter.setTouchEmulationEnabled(tabId, {
      enabled: true,
      maxTouchPoints: DEFAULT_TOUCH_POINTS,
    });

    const existing = this.emulationByTab.get(tabId);
    if (existing && existing.sessionId !== sessionId) {
      this.removeSessionTab(existing.sessionId, tabId);
    }

    this.emulationByTab.set(tabId, applied);
    const sessionTabs = this.tabIdsBySession.get(sessionId) ?? new Set<number>();
    sessionTabs.add(tabId);
    this.tabIdsBySession.set(sessionId, sessionTabs);
    this.activeSessionByTab.set(tabId, sessionId);

    this.logger.debug('Applied device emulation preset', {
      sessionId,
      tabId,
      preset: applied.preset,
      orientation: applied.orientation,
    });

    return applied;
  }

  async clearSession(sessionId: string): Promise<void> {
    const tabIds = [...(this.tabIdsBySession.get(sessionId) ?? [])];
    for (const tabId of tabIds) {
      const applied = this.emulationByTab.get(tabId);
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

  async clearTab(tabId: number): Promise<void> {
    const applied = this.emulationByTab.get(tabId);
    this.dropTabState(tabId);

    if (!applied || !this.debuggerAdapter.isAttached(tabId)) {
      return;
    }

    try {
      await this.debuggerAdapter.clearDeviceMetricsOverride(tabId);
      await this.debuggerAdapter.setUserAgentOverride(tabId, {
        userAgent: DEFAULT_USER_AGENT,
        platform: DEFAULT_PLATFORM,
      });
      await this.debuggerAdapter.setTouchEmulationEnabled(tabId, {
        enabled: false,
        maxTouchPoints: 0,
      });
    } catch (error) {
      this.logger.debug('Failed to clear device emulation state for tab', { tabId, error });
    }
  }

  private readonly handleTabRemoved: Parameters<typeof chrome.tabs.onRemoved.addListener>[0] = (tabId) => {
    this.logger.debug('Tab removed; dropping device emulation state', { tabId });
    this.dropTabState(tabId);
  };

  private buildAppliedState(
    sessionId: string,
    tabId: number,
    action: EmulateDeviceAction,
  ): AppliedDeviceEmulation {
    const preset = DEVICE_PRESETS[action.preset];
    const orientation = action.orientation ?? DEFAULT_ORIENTATION;
    const isLandscape = orientation === 'landscape';

    return {
      sessionId,
      tabId,
      preset: action.preset,
      orientation,
      viewport: {
        width: isLandscape ? preset.height : preset.width,
        height: isLandscape ? preset.width : preset.height,
        deviceScaleFactor: preset.deviceScaleFactor,
        mobile: preset.mobile,
      },
      userAgent: preset.userAgent,
      touchEnabled: true,
    };
  }

  private dropTabState(tabId: number): void {
    const applied = this.emulationByTab.get(tabId);
    if (applied) {
      this.removeSessionTab(applied.sessionId, tabId);
    }

    this.emulationByTab.delete(tabId);
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
