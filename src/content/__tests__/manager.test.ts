import type { Action } from '@shared/types';

const onCommand = vi.fn();
const bridgeInitialize = vi.fn();
const bridgeDestroy = vi.fn();
const bridgeEmit = vi.fn();

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
    findElement = vi.fn();
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
    onCommand.mockReset();
    bridgeInitialize.mockReset();
    bridgeDestroy.mockReset();
    bridgeEmit.mockReset();

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
});
