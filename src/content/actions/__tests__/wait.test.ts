import type {
  WaitAction,
  WaitForElementAction,
  WaitForNavigationAction,
  WaitForNetworkAction,
} from '@shared/types';
import { SelectorEngine } from '../../dom/selector-engine';
import { AutoWaitEngine } from '../../dom/auto-wait-engine';
import { executeWaitAction } from '../wait';

const NETWORK_ACTIVITY_EVENT_NAME = '__flux_network_activity__';
const NAVIGATION_ACTIVITY_EVENT_NAME = '__flux_navigation_activity__';

describe('executeWaitAction', () => {
  let selectorEngine: SelectorEngine;
  let autoWaitEngine: AutoWaitEngine;

  beforeEach(() => {
    document.body.innerHTML = '';
    selectorEngine = new SelectorEngine();
    autoWaitEngine = new AutoWaitEngine(selectorEngine);
  });

  afterEach(() => {
    autoWaitEngine.destroy();
    vi.useRealTimers();
    if (window.location.hash) {
      window.location.hash = '';
    }
  });

  it('waits for a fixed duration', async () => {
    vi.useFakeTimers();

    const action: WaitAction = {
      id: 'wait-1',
      type: 'wait',
      duration: 50,
    };

    const resultPromise = executeWaitAction(action, autoWaitEngine);
    await vi.advanceTimersByTimeAsync(60);
    const result = await resultPromise;

    expect(result.success).toBe(true);
  });

  it('waits until element becomes attached', async () => {
    const action: WaitForElementAction = {
      id: 'wait-element-1',
      type: 'waitForElement',
      selector: { css: '#late-button' },
      state: 'attached',
      timeout: 500,
    };

    setTimeout(() => {
      document.body.innerHTML = '<button id="late-button">Later</button>';
    }, 30);

    const result = await executeWaitAction(action, autoWaitEngine);
    expect(result.success).toBe(true);
  });

  it('waits for URL change navigation', async () => {
    const action: WaitForNavigationAction = {
      id: 'wait-nav-1',
      type: 'waitForNavigation',
      timeout: 700,
    };

    setTimeout(() => {
      window.location.hash = 'next';
    }, 40);

    const result = await executeWaitAction(action, autoWaitEngine);
    expect(result.success).toBe(true);
  });

  it('treats page navigation event signals as navigation when URL is unchanged', async () => {
    const action: WaitForNavigationAction = {
      id: 'wait-nav-state',
      type: 'waitForNavigation',
      timeout: 700,
    };

    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent(NAVIGATION_ACTIVITY_EVENT_NAME, {
          detail: { timestamp: Date.now(), url: window.location.href },
        }),
      );
    }, 40);

    const result = await executeWaitAction(action, autoWaitEngine);
    expect(result.success).toBe(true);
  });

  it('delegates network busy and idle waits to auto-wait engine', async () => {
    const waitForNetworkSpy = vi
      .spyOn(autoWaitEngine, 'waitForNetwork')
      .mockResolvedValue(undefined);

    const busyAction: WaitForNetworkAction = {
      id: 'wait-net-busy',
      type: 'waitForNetwork',
      state: 'busy',
      timeout: 500,
    };

    const busyResult = await executeWaitAction(busyAction, autoWaitEngine);
    expect(busyResult.success).toBe(true);
    expect(waitForNetworkSpy).toHaveBeenNthCalledWith(1, 'busy', 500);

    const idleAction: WaitForNetworkAction = {
      id: 'wait-net-idle',
      type: 'waitForNetwork',
      state: 'idle',
      timeout: 1_200,
    };

    const idleResult = await executeWaitAction(idleAction, autoWaitEngine);
    expect(idleResult.success).toBe(true);
    expect(waitForNetworkSpy).toHaveBeenNthCalledWith(2, 'idle', 1200);
  });

  it('waitForNetwork busy resolves when page reports in-flight requests', async () => {
    vi.useFakeTimers();

    const action: WaitForNetworkAction = {
      id: 'wait-net-busy-inflight',
      type: 'waitForNetwork',
      state: 'busy',
      timeout: 500,
    };

    const resultPromise = executeWaitAction(action, autoWaitEngine);

    window.dispatchEvent(
      new CustomEvent(NETWORK_ACTIVITY_EVENT_NAME, {
        detail: { activeRequests: 1 },
      }),
    );

    await vi.advanceTimersByTimeAsync(80);
    const result = await resultPromise;

    expect(result.success).toBe(true);
  });

  it('waitForNetwork idle waits until in-flight requests are drained', async () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');

    window.dispatchEvent(
      new CustomEvent(NETWORK_ACTIVITY_EVENT_NAME, {
        detail: { activeRequests: 1 },
      }),
    );

    const action: WaitForNetworkAction = {
      id: 'wait-net-idle-inflight',
      type: 'waitForNetwork',
      state: 'idle',
      timeout: 1_500,
    };

    const resultPromise = executeWaitAction(action, autoWaitEngine);

    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent(NETWORK_ACTIVITY_EVENT_NAME, {
          detail: { activeRequests: 0 },
        }),
      );
    }, 200);

    const result = await resultPromise;
    expect(result.success).toBe(true);
    expect(result.duration).toBeGreaterThanOrEqual(450);
  });
});
