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
    vi.spyOn(chrome.storage.local, 'get').mockResolvedValue({
      settings: { showFloatingBar: true },
    });
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

  it('shows a floating action status card during execution and removes it after success', async () => {
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

    let resolveAction: ((value: unknown) => void) | null = null;
    executeInteractionAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAction = resolve;
        }),
    );

    manager.initialize();

    const executeHandler = handlers.get('EXECUTE_ACTION');
    expect(executeHandler).toBeDefined();

    const action = {
      id: 'a-running',
      type: 'click',
      selector: { css: '#submit-button' },
      description: 'Submit checkout form',
    };

    const resultPromise = executeHandler?.({ action, context: { variables: {} } }) as Promise<unknown>;

    await vi.waitFor(() => {
      const overlay = document.querySelector('[data-flux-action-status="true"]') as HTMLElement | null;
      expect(overlay).not.toBeNull();
      expect(overlay?.textContent).toContain('Running');
      expect(overlay?.textContent).toContain('Submit checkout form');
      expect(overlay?.textContent).toContain('#submit-button');
      expect(overlay?.style.pointerEvents).toBe('none');
    });

    resolveAction?.({ actionId: 'a-running', success: true, duration: 20 });
    await resultPromise;

    const overlayAfterSuccess = document.querySelector(
      '[data-flux-action-status="true"]',
    ) as HTMLElement | null;
    const styleNode = document.getElementById('flux-action-status-styles');

    expect(overlayAfterSuccess?.textContent).toContain('Success');
    expect(overlayAfterSuccess?.textContent).toContain('Click');
    expect(styleNode).not.toBeNull();

    vi.advanceTimersByTime(1400);

    expect(document.querySelector('[data-flux-action-status="true"]')).toBeNull();
    expect(document.getElementById('flux-action-status-styles')).toBeNull();

    manager.destroy();
  });

  it('shows failure state details and respects disabled floating bar setting', async () => {
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

    executeInputAction.mockResolvedValue({
      actionId: 'a-fail',
      success: false,
      duration: 12,
      error: { code: 'ELEMENT_NOT_FOUND', message: 'Input field not found' },
    });

    manager.initialize();

    const executeHandler = handlers.get('EXECUTE_ACTION');
    expect(executeHandler).toBeDefined();

    await executeHandler?.({
      action: {
        id: 'a-fail',
        type: 'fill',
        selector: { css: '#email' },
        value: 'user@example.com',
      },
      context: { variables: {} },
    });

    const failureOverlay = document.querySelector(
      '[data-flux-action-status="true"]',
    ) as HTMLElement | null;

    expect(failureOverlay?.textContent).toContain('Failed');
    expect(failureOverlay?.textContent).toContain('Fill field');
    expect(failureOverlay?.textContent).toContain('Input field not found');
    expect(failureOverlay?.textContent).toContain('Value: user@example.com');

    vi.advanceTimersByTime(2600);
    expect(document.querySelector('[data-flux-action-status="true"]')).toBeNull();

    vi.mocked(chrome.storage.local.get).mockResolvedValueOnce({
      settings: { showFloatingBar: false },
    });

    await executeHandler?.({
      action: {
        id: 'a-disabled',
        type: 'click',
        selector: { css: '#disabled-case' },
      },
      context: { variables: {} },
    });

    expect(document.querySelector('[data-flux-action-status="true"]')).toBeNull();
    expect(document.getElementById('flux-action-status-styles')).toBeNull();

    manager.destroy();
  });

  it('does not recreate the action overlay after destroy while an action is still pending', async () => {
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

    let resolveAction: ((value: unknown) => void) | null = null;
    executeInteractionAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAction = resolve;
        }),
    );

    manager.initialize();

    const executeHandler = handlers.get('EXECUTE_ACTION');
    expect(executeHandler).toBeDefined();

    const resultPromise = executeHandler?.({
      action: {
        id: 'a-destroy-pending',
        type: 'click',
        selector: { css: '#destroy-case' },
      },
      context: { variables: {} },
    }) as Promise<unknown>;

    await vi.waitFor(() => {
      expect(document.querySelector('[data-flux-action-status="true"]')).not.toBeNull();
    });

    manager.destroy();

    expect(document.querySelector('[data-flux-action-status="true"]')).toBeNull();
    expect(document.getElementById('flux-action-status-styles')).toBeNull();

    resolveAction?.({ actionId: 'a-destroy-pending', success: true, duration: 8 });
    await resultPromise;

    expect(document.querySelector('[data-flux-action-status="true"]')).toBeNull();
    expect(document.getElementById('flux-action-status-styles')).toBeNull();
  });

  it('keeps the latest running action visible when older actions finish later', async () => {
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

    const resolvers = new Map<string, (value: unknown) => void>();
    executeInteractionAction.mockImplementation(
      (action: { id: string }) =>
        new Promise((resolve) => {
          resolvers.set(action.id, resolve);
        }),
    );

    manager.initialize();

    const executeHandler = handlers.get('EXECUTE_ACTION');
    expect(executeHandler).toBeDefined();

    const firstAction = {
      id: 'a-first',
      type: 'click',
      selector: { css: '#first' },
      description: 'First running action',
    };
    const secondAction = {
      id: 'a-second',
      type: 'click',
      selector: { css: '#second' },
      description: 'Second running action',
    };

    const firstPromise = executeHandler?.({ action: firstAction, context: { variables: {} } }) as Promise<unknown>;
    await vi.waitFor(() => {
      const overlay = document.querySelector('[data-flux-action-status="true"]');
      expect(overlay?.textContent).toContain('First running action');
      expect(overlay?.textContent).toContain('Running');
    });

    const secondPromise = executeHandler?.({ action: secondAction, context: { variables: {} } }) as Promise<unknown>;
    await vi.waitFor(() => {
      const overlay = document.querySelector('[data-flux-action-status="true"]');
      expect(overlay?.textContent).toContain('Second running action');
      expect(overlay?.textContent).toContain('Running');
    });

    resolvers.get(firstAction.id)?.({ actionId: firstAction.id, success: true, duration: 9 });
    await firstPromise;

    const overlayAfterFirstCompletion = document.querySelector(
      '[data-flux-action-status="true"]',
    ) as HTMLElement | null;
    expect(overlayAfterFirstCompletion?.textContent).toContain('Second running action');
    expect(overlayAfterFirstCompletion?.textContent).toContain('Running');

    resolvers.get(secondAction.id)?.({ actionId: secondAction.id, success: true, duration: 11 });
    await secondPromise;

    const overlayAfterSecondCompletion = document.querySelector(
      '[data-flux-action-status="true"]',
    ) as HTMLElement | null;
    expect(overlayAfterSecondCompletion?.textContent).toContain('Second running action');
    expect(overlayAfterSecondCompletion?.textContent).toContain('Success');

    vi.advanceTimersByTime(1400);
    expect(document.querySelector('[data-flux-action-status="true"]')).toBeNull();

    manager.destroy();
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
