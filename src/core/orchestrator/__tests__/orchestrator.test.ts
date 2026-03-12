import { ErrorCode } from '@shared/errors';
import type { Action, ActionResult, WaitAction } from '@shared/types';
import { ActionOrchestrator } from '../orchestrator';

function createAction(id: string, overrides: Partial<WaitAction> = {}): WaitAction {
  return {
    id,
    type: 'wait',
    duration: 10,
    ...overrides,
  };
}

function successResult(actionId: string, duration = 5): ActionResult {
  return {
    actionId,
    success: true,
    duration,
  };
}

function failureResult(actionId: string, code = ErrorCode.ACTION_FAILED): ActionResult {
  return {
    actionId,
    success: false,
    duration: 5,
    error: {
      code,
      message: 'failed',
      recoverable: true,
    },
  };
}

describe('ActionOrchestrator', () => {
  it('executes batch actions sequentially', async () => {
    const order: string[] = [];
    const orchestrator = new ActionOrchestrator({
      execute: vi.fn(async (action) => {
        order.push(action.id);
        return successResult(action.id);
      }),
    });

    const actions = [createAction('a1'), createAction('a2'), createAction('a3')];
    const results = await orchestrator.executeBatch(actions, { sessionId: 's-1' });

    expect(order).toEqual(['a1', 'a2', 'a3']);
    expect(results).toHaveLength(3);
    expect(results.every((result) => result.success)).toBe(true);
  });

  it('retries failed actions up to retries and then succeeds', async () => {
    const execute = vi
      .fn<(action: Action) => Promise<ActionResult>>()
      .mockResolvedValueOnce(failureResult('retry-action'))
      .mockResolvedValueOnce(failureResult('retry-action'))
      .mockResolvedValueOnce(successResult('retry-action'));

    const orchestrator = new ActionOrchestrator({
      execute: (action) => execute(action),
    });

    const action = createAction('retry-action', { retries: 2 });
    const result = await orchestrator.executeAction(action, { sessionId: 's-2' });

    expect(result.success).toBe(true);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('uses fallback action after retry exhaustion', async () => {
    const execute = vi.fn(async (action: Action): Promise<ActionResult> => {
      if (action.id === 'fallback-action') {
        return successResult(action.id);
      }

      return failureResult(action.id, ErrorCode.ELEMENT_NOT_FOUND);
    });

    const fallbackAction = createAction('fallback-action');
    const orchestrator = new ActionOrchestrator(
      { execute },
      {
        fallbackResolver: () => fallbackAction,
      },
    );

    const result = await orchestrator.executeAction(createAction('primary-action'));

    expect(result.success).toBe(true);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenNthCalledWith(2, fallbackAction, expect.any(Object));
  });

  it('normalizes thrown fallback execution into failure result', async () => {
    const execute = vi.fn(async (action: Action): Promise<ActionResult> => {
      if (action.id === 'fallback-action') {
        throw new Error('fallback exploded');
      }

      return failureResult(action.id, ErrorCode.ELEMENT_NOT_FOUND);
    });

    const fallbackAction = createAction('fallback-action');
    const orchestrator = new ActionOrchestrator(
      { execute },
      {
        fallbackResolver: () => fallbackAction,
      },
    );

    const result = await orchestrator.executeAction(createAction('primary-action'));

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.ACTION_FAILED);
    expect(result.error?.message).toContain('fallback exploded');
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('stops immediately for non-recoverable failure without retry or fallback', async () => {
    const execute = vi.fn(async (action: Action): Promise<ActionResult> => {
      return {
        actionId: action.id,
        success: false,
        duration: 1,
        error: {
          code: ErrorCode.ABORTED,
          message: 'aborted',
          recoverable: false,
        },
      };
    });

    const fallbackAction = createAction('fallback-action');
    const fallbackResolver = vi.fn(() => fallbackAction);
    const orchestrator = new ActionOrchestrator(
      { execute },
      {
        fallbackResolver,
      },
    );

    const result = await orchestrator.executeAction(createAction('primary-action', { retries: 2 }));

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.ABORTED);
    expect(result.error?.recoverable).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(fallbackResolver).not.toHaveBeenCalled();
  });

  it('stops batch on non-optional failure', async () => {
    const execute = vi.fn(async (action: Action): Promise<ActionResult> => {
      if (action.id === 'a1') {
        return failureResult(action.id);
      }

      return successResult(action.id);
    });

    const orchestrator = new ActionOrchestrator({ execute });
    const results = await orchestrator.executeBatch([createAction('a1'), createAction('a2')]);

    expect(results).toHaveLength(1);
    expect(results[0]?.success).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('continues batch when an optional action fails', async () => {
    const execute = vi.fn(async (action: Action): Promise<ActionResult> => {
      if (action.id === 'optional-fail') {
        return failureResult(action.id);
      }

      return successResult(action.id);
    });

    const orchestrator = new ActionOrchestrator({ execute });
    const results = await orchestrator.executeBatch([
      createAction('optional-fail', { optional: true }),
      createAction('next-success'),
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]?.success).toBe(false);
    expect(results[1]?.success).toBe(true);
  });

  it('aborts queued execution and returns aborted result', async () => {
    vi.useFakeTimers();

    const execute = vi.fn(
      (action: Action, context: { abortSignal?: AbortSignal }): Promise<ActionResult> => {
        return new Promise((resolve) => {
          setTimeout(() => {
            if (context.abortSignal?.aborted) {
              resolve(failureResult(action.id, ErrorCode.ABORTED));
              return;
            }

            resolve(successResult(action.id));
          }, 100);
        });
      },
    );

    const orchestrator = new ActionOrchestrator({ execute });

    const resultPromise = orchestrator.executeBatch(
      [createAction('long-action'), createAction('second-action')],
      { sessionId: 'abort-session' },
    );

    setTimeout(() => {
      orchestrator.abort('abort-session');
    }, 10);

    await vi.advanceTimersByTimeAsync(130);
    const results = await resultPromise;

    expect(results).toHaveLength(1);
    expect(results[0]?.error?.code).toBe(ErrorCode.ABORTED);
    expect(results[0]?.success).toBe(false);
  });
});
