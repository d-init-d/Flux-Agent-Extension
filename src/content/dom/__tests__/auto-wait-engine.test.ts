import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SelectorEngine } from '../selector-engine';
import { NetworkActivityMonitor } from '../network-activity-monitor';
import { AutoWaitEngine } from '../auto-wait-engine';

vi.mock('../network-activity-monitor', () => ({
  NetworkActivityMonitor: class MockNetworkActivityMonitor {
    start = vi.fn();
    stop = vi.fn();
    waitForBusy = vi.fn().mockResolvedValue(undefined);
    waitForIdle = vi.fn().mockResolvedValue(undefined);
  },
}));

function createEngine(findElementResult: Element | null = null) {
  const selectorEngine = new SelectorEngine();
  vi.spyOn(selectorEngine, 'findElement').mockReturnValue(findElementResult);

  const networkMonitor = new NetworkActivityMonitor();
  const engine = new AutoWaitEngine(selectorEngine, networkMonitor);
  return { engine, selectorEngine, networkMonitor };
}

describe('AutoWaitEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('creates with provided networkMonitor', () => {
      const { engine, networkMonitor } = createEngine();
      expect(networkMonitor.start).toHaveBeenCalled();
      engine.destroy();
    });

    it('creates with default networkMonitor when none provided', () => {
      const selectorEngine = new SelectorEngine();
      const engine = new AutoWaitEngine(selectorEngine);
      engine.destroy();
    });
  });

  describe('destroy', () => {
    it('stops the network monitor', () => {
      const { engine, networkMonitor } = createEngine();
      engine.destroy();
      expect(networkMonitor.stop).toHaveBeenCalled();
    });
  });

  describe('wait', () => {
    it('resolves after the specified duration', async () => {
      const { engine } = createEngine();
      const promise = engine.wait(500);
      vi.advanceTimersByTime(500);
      await expect(promise).resolves.toBeUndefined();
      engine.destroy();
    });
  });

  describe('waitForElement', () => {
    it('resolves immediately when element is already visible', async () => {
      const el = document.createElement('div');
      document.body.appendChild(el);
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        width: 100, height: 50, top: 0, left: 0, bottom: 50, right: 100, x: 0, y: 0, toJSON: () => {},
      });
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        display: 'block', visibility: 'visible', opacity: '1',
      } as unknown as CSSStyleDeclaration);
      const { engine, selectorEngine } = createEngine(el);

      vi.spyOn(selectorEngine, 'findElement').mockReturnValue(el);

      await engine.waitForElement({ css: 'div' }, 'visible', 1000);
      engine.destroy();
      document.body.removeChild(el);
    });

    it('resolves for "attached" state when element exists', async () => {
      const el = document.createElement('div');
      const { engine, selectorEngine } = createEngine(el);
      vi.spyOn(selectorEngine, 'findElement').mockReturnValue(el);

      await engine.waitForElement({ css: 'div' }, 'attached', 1000);
      engine.destroy();
    });

    it('resolves for "detached" state when element is null', async () => {
      const { engine, selectorEngine } = createEngine(null);
      vi.spyOn(selectorEngine, 'findElement').mockReturnValue(null);

      await engine.waitForElement({ css: '.gone' }, 'detached', 1000);
      engine.destroy();
    });

    it('resolves for "hidden" state when element is not HTMLElement', async () => {
      const { engine, selectorEngine } = createEngine(null);
      vi.spyOn(selectorEngine, 'findElement').mockReturnValue(null);

      await engine.waitForElement({ css: '.hidden' }, 'hidden', 1000);
      engine.destroy();
    });

    it('times out when element never appears', async () => {
      const { engine, selectorEngine } = createEngine(null);
      vi.spyOn(selectorEngine, 'findElement').mockReturnValue(null);

      const promise = engine.waitForElement({ css: '.never' }, 'attached', 200);
      vi.advanceTimersByTime(300);

      await expect(promise).rejects.toThrow(/timed out/);
      engine.destroy();
    });

    it('uses "visible" as default state', async () => {
      const el = document.createElement('div');
      document.body.appendChild(el);
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        width: 100, height: 50, top: 0, left: 0, bottom: 50, right: 100, x: 0, y: 0, toJSON: () => {},
      });
      vi.spyOn(window, 'getComputedStyle').mockReturnValue({
        display: 'block', visibility: 'visible', opacity: '1',
      } as unknown as CSSStyleDeclaration);
      const { engine, selectorEngine } = createEngine(el);
      vi.spyOn(selectorEngine, 'findElement').mockReturnValue(el);

      await engine.waitForElement({ css: 'div' });
      engine.destroy();
      document.body.removeChild(el);
    });
  });

  describe('waitForNavigation', () => {
    it('throws for invalid urlPattern regex', async () => {
      const { engine } = createEngine();
      await expect(
        engine.waitForNavigation('[invalid', 100),
      ).rejects.toThrow(/Invalid urlPattern regex/);
      engine.destroy();
    });

    it('times out when navigation never occurs', async () => {
      const { engine } = createEngine();
      const promise = engine.waitForNavigation(undefined, 200);
      vi.advanceTimersByTime(300);
      await expect(promise).rejects.toThrow(/timed out/);
      engine.destroy();
    });
  });

  describe('waitForNetwork', () => {
    it('delegates to networkMonitor.waitForBusy when state is "busy"', async () => {
      const { engine, networkMonitor } = createEngine();
      await engine.waitForNetwork('busy', 5000);
      expect(networkMonitor.waitForBusy).toHaveBeenCalledWith(5000);
      engine.destroy();
    });

    it('delegates to networkMonitor.waitForIdle when state is "idle"', async () => {
      const { engine, networkMonitor } = createEngine();
      await engine.waitForNetwork('idle', 5000);
      expect(networkMonitor.waitForIdle).toHaveBeenCalledWith(5000);
      engine.destroy();
    });
  });

  describe('handleNavigationActivityEvent', () => {
    it('handles non-CustomEvent navigation signals', () => {
      const { engine } = createEngine();
      const event = new Event('__flux_navigation_activity__');
      window.dispatchEvent(event);
      engine.destroy();
    });

    it('handles CustomEvent with valid timestamp', () => {
      const { engine } = createEngine();
      const event = new CustomEvent('__flux_navigation_activity__', {
        detail: { timestamp: 1234567890 },
      });
      window.dispatchEvent(event);
      engine.destroy();
    });

    it('handles CustomEvent without valid timestamp', () => {
      const { engine } = createEngine();
      const event = new CustomEvent('__flux_navigation_activity__', {
        detail: { timestamp: 'invalid' },
      });
      window.dispatchEvent(event);
      engine.destroy();
    });

    it('handles CustomEvent with undefined detail', () => {
      const { engine } = createEngine();
      const event = new CustomEvent('__flux_navigation_activity__');
      window.dispatchEvent(event);
      engine.destroy();
    });
  });

  describe('requestMainWorldTrackers', () => {
    it('handles successful tracker install response', () => {
      vi.stubGlobal('chrome', {
        ...globalThis.chrome,
        runtime: {
          ...globalThis.chrome?.runtime,
          sendMessage: vi.fn().mockResolvedValue({ success: true }),
        },
      });
      const { engine } = createEngine();
      engine.destroy();
    });

    it('handles failed tracker install response', async () => {
      vi.stubGlobal('chrome', {
        ...globalThis.chrome,
        runtime: {
          ...globalThis.chrome?.runtime,
          sendMessage: vi.fn().mockResolvedValue({
            success: false,
            error: { message: 'Install failed' },
          }),
        },
      });
      const { engine } = createEngine();
      await vi.advanceTimersByTimeAsync(10);
      engine.destroy();
    });

    it('handles non-response (not tracker install response)', async () => {
      vi.stubGlobal('chrome', {
        ...globalThis.chrome,
        runtime: {
          ...globalThis.chrome?.runtime,
          sendMessage: vi.fn().mockResolvedValue('not-an-object'),
        },
      });
      const { engine } = createEngine();
      await vi.advanceTimersByTimeAsync(10);
      engine.destroy();
    });

    it('handles rejection from sendMessage', async () => {
      vi.stubGlobal('chrome', {
        ...globalThis.chrome,
        runtime: {
          ...globalThis.chrome?.runtime,
          sendMessage: vi.fn().mockRejectedValue(new Error('no listener')),
        },
      });
      const { engine } = createEngine();
      await vi.advanceTimersByTimeAsync(10);
      engine.destroy();
    });

    it('handles rejection with non-Error value', async () => {
      vi.stubGlobal('chrome', {
        ...globalThis.chrome,
        runtime: {
          ...globalThis.chrome?.runtime,
          sendMessage: vi.fn().mockRejectedValue('string error'),
        },
      });
      const { engine } = createEngine();
      await vi.advanceTimersByTimeAsync(10);
      engine.destroy();
    });

    it('handles synchronous throw from sendMessage', () => {
      vi.stubGlobal('chrome', {
        ...globalThis.chrome,
        runtime: {
          ...globalThis.chrome?.runtime,
          sendMessage: vi.fn().mockImplementation(() => {
            throw new Error('sync error');
          }),
        },
      });
      const { engine } = createEngine();
      engine.destroy();
    });

    it('handles sendMessage returning non-thenable', () => {
      vi.stubGlobal('chrome', {
        ...globalThis.chrome,
        runtime: {
          ...globalThis.chrome?.runtime,
          sendMessage: vi.fn().mockReturnValue(undefined),
        },
      });
      const { engine } = createEngine();
      engine.destroy();
    });

    it('handles failed response without error message', async () => {
      vi.stubGlobal('chrome', {
        ...globalThis.chrome,
        runtime: {
          ...globalThis.chrome?.runtime,
          sendMessage: vi.fn().mockResolvedValue({
            success: false,
            error: {},
          }),
        },
      });
      const { engine } = createEngine();
      await vi.advanceTimersByTimeAsync(10);
      engine.destroy();
    });
  });

  describe('isTrackerInstallResponse', () => {
    it('handles null response', async () => {
      vi.stubGlobal('chrome', {
        ...globalThis.chrome,
        runtime: {
          ...globalThis.chrome?.runtime,
          sendMessage: vi.fn().mockResolvedValue(null),
        },
      });
      const { engine } = createEngine();
      await vi.advanceTimersByTimeAsync(10);
      engine.destroy();
    });

    it('handles object without success field', async () => {
      vi.stubGlobal('chrome', {
        ...globalThis.chrome,
        runtime: {
          ...globalThis.chrome?.runtime,
          sendMessage: vi.fn().mockResolvedValue({ other: 'field' }),
        },
      });
      const { engine } = createEngine();
      await vi.advanceTimersByTimeAsync(10);
      engine.destroy();
    });

    it('handles response with success=true and no error', async () => {
      vi.stubGlobal('chrome', {
        ...globalThis.chrome,
        runtime: {
          ...globalThis.chrome?.runtime,
          sendMessage: vi.fn().mockResolvedValue({ success: true }),
        },
      });
      const { engine } = createEngine();
      await vi.advanceTimersByTimeAsync(10);
      engine.destroy();
    });

    it('handles response with error as non-object', async () => {
      vi.stubGlobal('chrome', {
        ...globalThis.chrome,
        runtime: {
          ...globalThis.chrome?.runtime,
          sendMessage: vi.fn().mockResolvedValue({
            success: false,
            error: 'string-error',
          }),
        },
      });
      const { engine } = createEngine();
      await vi.advanceTimersByTimeAsync(10);
      engine.destroy();
    });

    it('handles response with error=null', async () => {
      vi.stubGlobal('chrome', {
        ...globalThis.chrome,
        runtime: {
          ...globalThis.chrome?.runtime,
          sendMessage: vi.fn().mockResolvedValue({
            success: false,
            error: null,
          }),
        },
      });
      const { engine } = createEngine();
      await vi.advanceTimersByTimeAsync(10);
      engine.destroy();
    });

    it('handles response with error.message as non-string', async () => {
      vi.stubGlobal('chrome', {
        ...globalThis.chrome,
        runtime: {
          ...globalThis.chrome?.runtime,
          sendMessage: vi.fn().mockResolvedValue({
            success: false,
            error: { message: 123 },
          }),
        },
      });
      const { engine } = createEngine();
      await vi.advanceTimersByTimeAsync(10);
      engine.destroy();
    });
  });

  describe('checkElementState — edge cases', () => {
    it('returns false for unknown state', async () => {
      const { engine, selectorEngine } = createEngine(null);
      vi.spyOn(selectorEngine, 'findElement').mockReturnValue(document.createElement('div'));

      const promise = engine.waitForElement({ css: 'div' }, 'bogus' as 'visible', 200);
      vi.advanceTimersByTime(300);
      await expect(promise).rejects.toThrow(/timed out/);
      engine.destroy();
    });

    it('checks hidden state with visible HTMLElement', async () => {
      const el = document.createElement('div');
      document.body.appendChild(el);
      const { engine, selectorEngine } = createEngine(el);

      let callCount = 0;
      vi.spyOn(selectorEngine, 'findElement').mockImplementation(() => {
        callCount++;
        if (callCount > 2) return null;
        return el;
      });

      const promise = engine.waitForElement({ css: 'div' }, 'hidden', 500);
      vi.advanceTimersByTime(400);
      await promise;
      engine.destroy();
      document.body.removeChild(el);
    });
  });
});
