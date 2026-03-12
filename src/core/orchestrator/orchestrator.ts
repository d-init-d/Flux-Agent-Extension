import { ErrorCode } from '@shared/errors';
import type { Action, ActionResult } from '@shared/types';

const GLOBAL_QUEUE_KEY = '__global__';

export interface ExecutionContext {
  sessionId?: string;
  variables?: Record<string, unknown>;
  abortSignal?: AbortSignal;
}

export interface IActionExecutor {
  execute(action: Action, context: ExecutionContext): Promise<ActionResult>;
}

export type FallbackResolver = (
  action: Action,
  error: ActionResult['error'] | undefined,
) => Action | null;

export interface ActionOrchestratorConfig {
  defaultRetries: number;
  fallbackResolver?: FallbackResolver;
}

const DEFAULT_CONFIG: ActionOrchestratorConfig = {
  defaultRetries: 0,
};

export class ActionOrchestrator {
  private readonly queueBySession = new Map<string, Promise<unknown>>();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly config: ActionOrchestratorConfig;

  constructor(
    private readonly executor: IActionExecutor,
    config: Partial<ActionOrchestratorConfig> = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  executeAction(action: Action, context: ExecutionContext = {}): Promise<ActionResult> {
    const queueKey = this.resolveQueueKey(context.sessionId);

    return this.enqueue(queueKey, async () => {
      const resolvedContext = this.resolveContext(queueKey, context);
      const result = await this.executeWithRecovery(action, resolvedContext);
      return result;
    });
  }

  executeBatch(actions: Action[], context: ExecutionContext = {}): Promise<ActionResult[]> {
    const queueKey = this.resolveQueueKey(context.sessionId);

    return this.enqueue(queueKey, async () => {
      const resolvedContext = this.resolveContext(queueKey, context);
      const results: ActionResult[] = [];

      for (const action of actions) {
        if (resolvedContext.abortSignal?.aborted) {
          results.push(this.createAbortedResult(action.id));
          break;
        }

        const result = await this.executeWithRecovery(action, resolvedContext);
        results.push(result);

        if (!result.success && !action.optional) {
          break;
        }
      }

      return results;
    });
  }

  abort(sessionId?: string): void {
    const queueKey = this.resolveQueueKey(sessionId);
    const controller = this.abortControllers.get(queueKey);
    if (controller) {
      controller.abort();
    }
  }

  private resolveContext(queueKey: string, context: ExecutionContext): ExecutionContext {
    const existingController = this.abortControllers.get(queueKey);
    const controller =
      existingController && !existingController.signal.aborted
        ? existingController
        : new AbortController();

    this.abortControllers.set(queueKey, controller);

    const mergedSignal = this.mergeAbortSignals(controller.signal, context.abortSignal);
    return {
      ...context,
      sessionId: context.sessionId,
      variables: context.variables ?? {},
      abortSignal: mergedSignal,
    };
  }

  private async executeWithRecovery(
    action: Action,
    context: ExecutionContext,
  ): Promise<ActionResult> {
    const retries =
      typeof action.retries === 'number' && action.retries >= 0
        ? action.retries
        : this.config.defaultRetries;

    let attempt = 0;
    let lastResult: ActionResult | null = null;

    while (attempt <= retries) {
      if (context.abortSignal?.aborted) {
        return this.createAbortedResult(action.id);
      }

      let result: ActionResult;
      try {
        result = await this.executor.execute(action, context);
      } catch (error: unknown) {
        result = this.toFailureResult(action.id, error);
      }

      if (result.success) {
        return result;
      }

      if (result.error?.recoverable === false) {
        return result;
      }

      lastResult = result;
      attempt += 1;
      if (attempt <= retries) {
        continue;
      }
    }

    if (
      this.config.fallbackResolver &&
      lastResult &&
      !lastResult.success &&
      lastResult.error?.recoverable !== false
    ) {
      const fallbackAction = this.config.fallbackResolver(action, lastResult.error);
      if (fallbackAction) {
        let fallbackResult: ActionResult;
        try {
          fallbackResult = await this.executor.execute(fallbackAction, context);
        } catch (error: unknown) {
          fallbackResult = this.toFailureResult(fallbackAction.id, error);
        }

        if (fallbackResult.success) {
          return fallbackResult;
        }

        if (fallbackResult.error?.recoverable === false) {
          return fallbackResult;
        }

        lastResult = fallbackResult;
      }
    }

    if (lastResult) {
      const code = lastResult.error?.code ?? ErrorCode.ACTION_FAILED;
      const recoverable = code === ErrorCode.ABORTED ? false : true;
      return {
        ...lastResult,
        error: {
          code,
          message:
            lastResult.error?.message ??
            `Action "${action.type}" failed and requires user decision`,
          recoverable,
        },
      };
    }

    return {
      actionId: action.id,
      success: false,
      duration: 0,
      error: {
        code: ErrorCode.ACTION_FAILED,
        message: `Action "${action.type}" failed and requires user decision`,
        recoverable: true,
      },
    };
  }

  private createAbortedResult(actionId: string): ActionResult {
    return {
      actionId,
      success: false,
      duration: 0,
      error: {
        code: ErrorCode.ABORTED,
        message: 'Execution aborted',
        recoverable: false,
      },
    };
  }

  private resolveQueueKey(sessionId?: string): string {
    return sessionId && sessionId.trim().length > 0 ? sessionId : GLOBAL_QUEUE_KEY;
  }

  private mergeAbortSignals(
    internalSignal: AbortSignal,
    externalSignal: AbortSignal | undefined,
  ): AbortSignal {
    if (!externalSignal) {
      return internalSignal;
    }

    if (internalSignal.aborted || externalSignal.aborted) {
      const abortedController = new AbortController();
      abortedController.abort();
      return abortedController.signal;
    }

    const mergedController = new AbortController();

    const onAbort = () => {
      if (!mergedController.signal.aborted) {
        mergedController.abort();
      }
    };

    internalSignal.addEventListener('abort', onAbort, { once: true });
    externalSignal.addEventListener('abort', onAbort, { once: true });

    return mergedController.signal;
  }

  private toFailureResult(actionId: string, error: unknown): ActionResult {
    if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
      const candidate = error as {
        code?: string;
        message?: string;
        recoverable?: boolean;
      };

      if (typeof candidate.code === 'string' && typeof candidate.message === 'string') {
        return {
          actionId,
          success: false,
          duration: 0,
          error: {
            code: candidate.code,
            message: candidate.message,
            recoverable:
              typeof candidate.recoverable === 'boolean'
                ? candidate.recoverable
                : candidate.code !== ErrorCode.ABORTED,
          },
        };
      }
    }

    return {
      actionId,
      success: false,
      duration: 0,
      error: {
        code: ErrorCode.ACTION_FAILED,
        message: error instanceof Error ? error.message : 'Action executor failed unexpectedly',
        recoverable: true,
      },
    };
  }

  private enqueue<T>(queueKey: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queueBySession.get(queueKey) ?? Promise.resolve();

    const next = previous
      .catch(() => {
        // Keep queue alive after previous failure.
      })
      .then(task);

    this.queueBySession.set(queueKey, next);

    return next.finally(() => {
      if (this.queueBySession.get(queueKey) === next) {
        this.queueBySession.delete(queueKey);
        const controller = this.abortControllers.get(queueKey);
        if (controller && controller.signal.aborted) {
          this.abortControllers.delete(queueKey);
        }
      }
    });
  }
}
