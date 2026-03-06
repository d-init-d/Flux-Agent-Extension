import { ErrorCode, ExtensionError } from '@shared/errors';
import type { ElementSelector, WaitForElementAction, WaitForNetworkAction } from '@shared/types';
import { SelectorEngine } from './selector-engine';
import { NetworkActivityMonitor } from './network-activity-monitor';

const DEFAULT_TIMEOUT_MS = 10_000;
const WAIT_POLL_INTERVAL_MS = 100;
const NAVIGATION_ACTIVITY_EVENT_NAME = '__flux_navigation_activity__';
const INSTALL_TRACKERS_MESSAGE_TYPE = 'FLUX_INSTALL_PAGE_TRACKERS';

export class AutoWaitEngine {
  private readonly networkMonitor: NetworkActivityMonitor;
  private lastNavigationSignalAt = 0;
  private trackerInstallStatus: 'pending' | 'ready' | 'failed' = 'pending';

  constructor(
    private readonly selectorEngine: SelectorEngine,
    networkMonitor?: NetworkActivityMonitor,
  ) {
    this.networkMonitor = networkMonitor ?? new NetworkActivityMonitor();
    this.networkMonitor.start();
    window.addEventListener(
      NAVIGATION_ACTIVITY_EVENT_NAME,
      this.handleNavigationActivityEvent as EventListener,
    );
    this.requestMainWorldTrackers();
  }

  destroy(): void {
    window.removeEventListener(
      NAVIGATION_ACTIVITY_EVENT_NAME,
      this.handleNavigationActivityEvent as EventListener,
    );
    this.networkMonitor.stop();
  }

  wait(durationMs: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, durationMs);
    });
  }

  async waitForElement(
    selector: ElementSelector,
    state: NonNullable<WaitForElementAction['state']> = 'visible',
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() <= deadline) {
      if (this.checkElementState(selector, state)) {
        return;
      }

      await this.waitForMutationOrDelay(WAIT_POLL_INTERVAL_MS);
    }

    throw new ExtensionError(
      ErrorCode.TIMEOUT,
      `waitForElement timed out after ${timeoutMs}ms for state "${state}"`,
      true,
      { selector, state },
    );
  }

  async waitForNavigation(urlPattern?: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
    const initialUrl = location.href;
    const initialNavigationCount = this.getNavigationEntryCount();
    const initialNavigationSignalAt = this.lastNavigationSignalAt;
    let regex: RegExp | null = null;

    if (urlPattern) {
      try {
        regex = new RegExp(urlPattern);
      } catch {
        throw new ExtensionError(
          ErrorCode.ACTION_INVALID,
          `Invalid urlPattern regex: ${urlPattern}`,
          true,
        );
      }
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const currentUrl = location.href;
      const changedUrl = currentUrl !== initialUrl;
      const changedNavigationEntry =
        this.getNavigationEntryCount() > initialNavigationCount;
      const changedNavigationSignal =
        this.lastNavigationSignalAt > initialNavigationSignalAt;
      const hasNavigationSignal =
        changedUrl || changedNavigationEntry || changedNavigationSignal;
      const matchesPattern = regex ? regex.test(currentUrl) : true;

      if (hasNavigationSignal && matchesPattern) {
        return;
      }

      await this.waitForMutationOrDelay(WAIT_POLL_INTERVAL_MS);
    }

    throw new ExtensionError(
      ErrorCode.TIMEOUT,
      `waitForNavigation timed out after ${timeoutMs}ms`,
      true,
      { urlPattern },
    );
  }

  private readonly handleNavigationActivityEvent = (event: Event): void => {
    if (!(event instanceof CustomEvent)) {
      this.lastNavigationSignalAt = Date.now();
      return;
    }

    const detail = event.detail as { timestamp?: number } | undefined;
    if (typeof detail?.timestamp === 'number' && Number.isFinite(detail.timestamp)) {
      this.lastNavigationSignalAt = detail.timestamp;
      return;
    }

    this.lastNavigationSignalAt = Date.now();
  };

  private requestMainWorldTrackers(): void {
    try {
      const maybePromise = chrome.runtime.sendMessage({
        type: INSTALL_TRACKERS_MESSAGE_TYPE,
      });

      if (maybePromise && typeof maybePromise.then === 'function') {
        void maybePromise
          .then((response: unknown) => {
            if (!this.isTrackerInstallResponse(response)) {
              this.trackerInstallStatus = 'ready';
              return;
            }

            if (response.success) {
              this.trackerInstallStatus = 'ready';
              return;
            }

            this.trackerInstallStatus = 'failed';
            const message = response.error?.message ?? 'Unknown tracker install error';
            console.warn(`[AutoWaitEngine] Failed to install MAIN-world trackers: ${message}`);
          })
          .catch((error: unknown) => {
            this.trackerInstallStatus = 'failed';
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`[AutoWaitEngine] Failed to request MAIN-world trackers: ${message}`);
          });
      } else {
        this.trackerInstallStatus = 'ready';
      }
    } catch (error: unknown) {
      this.trackerInstallStatus = 'failed';
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[AutoWaitEngine] Tracker request threw synchronously: ${message}`);
    }
  }

  private isTrackerInstallResponse(
    value: unknown,
  ): value is { success: boolean; error?: { message?: string } } {
    if (value === null || value === undefined || typeof value !== 'object') {
      return false;
    }

    const candidate = value as Record<string, unknown>;
    if (typeof candidate.success !== 'boolean') {
      return false;
    }

    if (candidate.error === undefined) {
      return true;
    }

    if (candidate.error === null || typeof candidate.error !== 'object') {
      return false;
    }

    const error = candidate.error as Record<string, unknown>;
    return error.message === undefined || typeof error.message === 'string';
  }

  private getNavigationEntryCount(): number {
    if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') {
      return 0;
    }

    return performance.getEntriesByType('navigation').length;
  }

  waitForNetwork(
    state: WaitForNetworkAction['state'],
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<void> {
    if (state === 'busy') {
      return this.networkMonitor.waitForBusy(timeoutMs);
    }

    return this.networkMonitor.waitForIdle(timeoutMs);
  }

  private checkElementState(
    selector: ElementSelector,
    state: NonNullable<WaitForElementAction['state']>,
  ): boolean {
    const element = this.selectorEngine.findElement(selector);

    switch (state) {
      case 'attached':
        return element !== null;
      case 'detached':
        return element === null;
      case 'visible':
        return element instanceof HTMLElement && this.isElementVisible(element);
      case 'hidden':
        return !(element instanceof HTMLElement) || !this.isElementVisible(element);
      default:
        return false;
    }
  }

  private isElementVisible(element: HTMLElement): boolean {
    const style = window.getComputedStyle(element);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (Number.parseFloat(style.opacity || '1') <= 0) return false;
    if (element.hasAttribute('hidden')) return false;

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  private waitForMutationOrDelay(delayMs: number): Promise<void> {
    if (!document.documentElement) {
      return this.wait(delayMs);
    }

    return new Promise((resolve) => {
      let resolved = false;

      const complete = () => {
        if (resolved) {
          return;
        }
        resolved = true;
        observer.disconnect();
        clearTimeout(timer);
        resolve();
      };

      const observer = new MutationObserver(() => {
        complete();
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
      });

      const timer = setTimeout(() => {
        complete();
      }, delayMs);
    });
  }
}
