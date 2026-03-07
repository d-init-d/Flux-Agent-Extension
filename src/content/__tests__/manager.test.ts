import type { Action } from '@shared/types';

const onCommand = vi.fn();
const bridgeInitialize = vi.fn();
const bridgeDestroy = vi.fn();
const bridgeEmit = vi.fn();
const findElement = vi.fn();

const executeInteractionAction = vi.fn();
const executeInputAction = vi.fn();
const executeScrollAction = vi.fn();
const executeExtractAction = vi.fn();
const executeWaitAction = vi.fn();

vi.mock('@core/bridge', () => {
  class MockContentScriptBridge {
    onCommand = onCommand;
    initialize = bridgeInitialize;
    destroy = bridgeDestroy;
    emit = bridgeEmit;
  }

  return { ContentScriptBridge: MockContentScriptBridge };
});

vi.mock('../actions/interaction', () => ({
  executeInteractionAction,
}));

vi.mock('../actions/input', () => ({
  executeInputAction,
}));

vi.mock('../actions/scroll', () => ({
  executeScrollAction,
}));

vi.mock('../actions/extract', () => ({
  executeExtractAction,
}));

vi.mock('../actions/wait', () => ({
  executeWaitAction,
}));

vi.mock('../dom/selector-engine', () => {
  class MockSelectorEngine {
    findElement = findElement;
  }

  return { SelectorEngine: MockSelectorEngine };
});

vi.mock('../dom/inspector', () => {
  class MockDOMInspector {
    buildPageContext = vi.fn(() => ({ url: 'https://example.com' }));
  }

  return { DOMInspector: MockDOMInspector };
});

vi.mock('../dom/auto-wait-engine', () => {
  class MockAutoWaitEngine {
    destroy = vi.fn();
  }

  return { AutoWaitEngine: MockAutoWaitEngine };
});

describe('ContentScriptManager command routing', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';

    onCommand.mockReset();
    bridgeInitialize.mockReset();
    bridgeDestroy.mockReset();
    bridgeEmit.mockReset();
    findElement.mockReset();

    executeInteractionAction.mockReset();
    executeInputAction.mockReset();
    executeScrollAction.mockReset();
    executeExtractAction.mockReset();
    executeWaitAction.mockReset();

    executeInteractionAction.mockResolvedValue({ actionId: 'x', success: true, duration: 1 });
    executeInputAction.mockResolvedValue({ actionId: 'x', success: true, duration: 1 });
    executeScrollAction.mockResolvedValue({ actionId: 'x', success: true, duration: 1 });
    executeExtractAction.mockResolvedValue({ actionId: 'x', success: true, duration: 1 });
    executeWaitAction.mockResolvedValue({ actionId: 'x', success: true, duration: 1 });

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('routes EXECUTE_ACTION to the correct action executor by action type', async () => {
    (window as Window & { __FLUX_AGENT_CS_INITIALIZED__?: boolean }).__FLUX_AGENT_CS_INITIALIZED__ =
      true;

    const module = await import('../index');
    const manager = new module.ContentScriptManager();

    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>();
    onCommand.mockImplementation(
      (type: string, handler: (payload: unknown) => Promise<unknown>) => {
        handlers.set(type, handler);
        return () => undefined;
      },
    );

    manager.initialize();

    const executeHandler = handlers.get('EXECUTE_ACTION');
    expect(executeHandler).toBeDefined();

    const actionCases: Array<{ action: Action; called: ReturnType<typeof vi.fn> }> = [
      {
        action: { id: 'a1', type: 'click', selector: { strategy: 'css', value: '#btn' } },
        called: executeInteractionAction,
      },
      {
        action: {
          id: 'a2',
          type: 'fill',
          selector: { strategy: 'css', value: '#email' },
          value: 'a@b.com',
        },
        called: executeInputAction,
      },
      {
        action: { id: 'a3', type: 'scroll', direction: 'down' },
        called: executeScrollAction,
      },
      {
        action: { id: 'a4', type: 'extract', selector: { strategy: 'css', value: 'h1' } },
        called: executeExtractAction,
      },
      {
        action: { id: 'a5', type: 'wait', duration: 100 },
        called: executeWaitAction,
      },
    ];

    for (const testCase of actionCases) {
      await executeHandler?.({ action: testCase.action });
      expect(testCase.called).toHaveBeenCalledWith(testCase.action, expect.anything());
    }

    manager.destroy();
    expect(bridgeDestroy).toHaveBeenCalledTimes(1);
  });

  it('creates a pulsing highlight overlay and repositions it on resize events', async () => {
    (window as Window & { __FLUX_AGENT_CS_INITIALIZED__?: boolean }).__FLUX_AGENT_CS_INITIALIZED__ =
      true;

    const module = await import('../index');
    const manager = new module.ContentScriptManager();

    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>();
    onCommand.mockImplementation(
      (type: string, handler: (payload: unknown) => Promise<unknown>) => {
        handlers.set(type, handler);
        return () => undefined;
      },
    );

    const element = document.createElement('button');
    document.body.appendChild(element);

    let rect = new DOMRect(12, 24, 140, 48);
    Object.defineProperty(element, 'getBoundingClientRect', {
      value: vi.fn(() => rect),
    });
    findElement.mockReturnValue(element);

    manager.initialize();

    const highlightHandler = handlers.get('HIGHLIGHT_ELEMENT');
    expect(highlightHandler).toBeDefined();

    await highlightHandler?.({
      selector: { strategy: 'css', value: '#target' },
      color: '#22c55e',
    });

    const overlay = document.querySelector('[data-flux-highlight="true"]') as HTMLElement | null;
    const styles = document.getElementById('flux-highlight-styles');

    expect(overlay).not.toBeNull();
    expect(styles).not.toBeNull();
    expect(overlay?.style.pointerEvents).toBe('none');
    expect(overlay?.className).toBe('flux-highlight-overlay');
    expect(overlay?.style.top).toBe('24px');
    expect(overlay?.style.left).toBe('12px');
    expect(overlay?.style.width).toBe('140px');
    expect(overlay?.style.height).toBe('48px');
    expect(styles?.textContent).toContain('flux-highlight-pulse');

    rect = new DOMRect(64, 96, 200, 56);
    window.dispatchEvent(new Event('resize'));

    expect(overlay?.style.top).toBe('96px');
    expect(overlay?.style.left).toBe('64px');
    expect(overlay?.style.width).toBe('200px');
    expect(overlay?.style.height).toBe('56px');

    manager.destroy();
    expect(document.querySelector('[data-flux-highlight="true"]')).toBeNull();
  });

  it('cleans up active highlights on clear and auto-duration expiry', async () => {
    vi.useFakeTimers();

    (window as Window & { __FLUX_AGENT_CS_INITIALIZED__?: boolean }).__FLUX_AGENT_CS_INITIALIZED__ =
      true;

    const module = await import('../index');
    const manager = new module.ContentScriptManager();

    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>();
    onCommand.mockImplementation(
      (type: string, handler: (payload: unknown) => Promise<unknown>) => {
        handlers.set(type, handler);
        return () => undefined;
      },
    );

    const element = document.createElement('div');
    document.body.appendChild(element);
    Object.defineProperty(element, 'getBoundingClientRect', {
      value: vi.fn(() => new DOMRect(10, 10, 80, 30)),
    });
    findElement.mockReturnValue(element);

    manager.initialize();

    const highlightHandler = handlers.get('HIGHLIGHT_ELEMENT');
    const clearHandler = handlers.get('CLEAR_HIGHLIGHTS');

    await highlightHandler?.({
      selector: { strategy: 'css', value: '.first' },
      duration: 500,
    });
    await highlightHandler?.({
      selector: { strategy: 'css', value: '.second' },
    });

    expect(document.querySelectorAll('[data-flux-highlight="true"]')).toHaveLength(2);

    vi.advanceTimersByTime(500);
    expect(document.querySelectorAll('[data-flux-highlight="true"]')).toHaveLength(1);

    await expect(clearHandler?.(undefined)).resolves.toEqual({ cleared: 1 });
    expect(document.querySelectorAll('[data-flux-highlight="true"]')).toHaveLength(0);

    manager.destroy();
  });
});
