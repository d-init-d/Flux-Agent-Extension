import { ErrorCode, ExtensionError } from '@shared/errors';

const POLL_INTERVAL_MS = 50;
const DEFAULT_IDLE_WINDOW_MS = 300;
const NETWORK_ACTIVITY_EVENT_NAME = '__flux_network_activity__';

type NetworkActivityDetail = {
  activeRequests?: number;
};

export class NetworkActivityMonitor {
  private isStarted = false;
  private activeRequestCount = 0;

  start(): void {
    if (this.isStarted) {
      return;
    }

    this.isStarted = true;
    window.addEventListener(
      NETWORK_ACTIVITY_EVENT_NAME,
      this.handleNetworkActivityEvent as EventListener,
    );
  }

  stop(): void {
    if (!this.isStarted) {
      return;
    }

    this.isStarted = false;
    this.activeRequestCount = 0;
    window.removeEventListener(
      NETWORK_ACTIVITY_EVENT_NAME,
      this.handleNetworkActivityEvent as EventListener,
    );
  }

  async waitForBusy(timeoutMs: number): Promise<void> {
    const initialResourceCount = this.getResourceCount();
    if (document.readyState === 'loading' || this.activeRequestCount > 0) {
      return;
    }

    await this.waitUntil(
      timeoutMs,
      () => {
        if (this.activeRequestCount > 0) {
          return true;
        }

        return this.getResourceCount() > initialResourceCount;
      },
      `Network never became busy within ${timeoutMs}ms`,
    );
  }

  async waitForIdle(timeoutMs: number, idleWindowMs = DEFAULT_IDLE_WINDOW_MS): Promise<void> {
    let lastObservedResourceCount = this.getResourceCount();
    let lastObservedActiveRequests = this.activeRequestCount;
    let lastActivityAt = Date.now();

    await this.waitUntil(
      timeoutMs,
      () => {
        const currentResourceCount = this.getResourceCount();
        if (currentResourceCount !== lastObservedResourceCount) {
          lastObservedResourceCount = currentResourceCount;
          lastActivityAt = Date.now();
        }

        const currentActiveRequests = this.activeRequestCount;
        if (currentActiveRequests !== lastObservedActiveRequests) {
          lastObservedActiveRequests = currentActiveRequests;
          lastActivityAt = Date.now();
        }

        return (
          document.readyState === 'complete' &&
          currentActiveRequests === 0 &&
          Date.now() - lastActivityAt >= idleWindowMs
        );
      },
      `Network did not become idle within ${timeoutMs}ms`,
    );
  }

  private readonly handleNetworkActivityEvent = (event: Event): void => {
    if (!(event instanceof CustomEvent)) {
      return;
    }

    const detail = event.detail as NetworkActivityDetail | undefined;
    if (typeof detail?.activeRequests !== 'number' || !Number.isFinite(detail.activeRequests)) {
      return;
    }

    this.activeRequestCount = Math.max(0, Math.round(detail.activeRequests));
  };

  private getResourceCount(): number {
    if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') {
      return 0;
    }

    return performance.getEntriesByType('resource').length;
  }

  private waitUntil(
    timeoutMs: number,
    predicate: () => boolean,
    timeoutMessage: string,
  ): Promise<void> {
    if (predicate()) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        clearInterval(interval);
        reject(new ExtensionError(ErrorCode.TIMEOUT, timeoutMessage, true));
      }, timeoutMs);

      const interval = setInterval(() => {
        if (!predicate()) {
          return;
        }

        clearTimeout(timeout);
        clearInterval(interval);
        resolve();
      }, POLL_INTERVAL_MS);
    });
  }
}
