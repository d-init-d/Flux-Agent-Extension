import { ErrorCode, ExtensionError } from '@shared/errors';
import type {
  ActionResultPayload,
  WaitAction,
  WaitForElementAction,
  WaitForNavigationAction,
  WaitForNetworkAction,
} from '@shared/types';
import { AutoWaitEngine } from '../dom/auto-wait-engine';

export type WaitExecutionAction =
  | WaitAction
  | WaitForElementAction
  | WaitForNavigationAction
  | WaitForNetworkAction;

export async function executeWaitAction(
  action: WaitExecutionAction,
  autoWaitEngine: AutoWaitEngine,
): Promise<ActionResultPayload> {
  const startedAt = performance.now();

  try {
    await performWaitAction(action, autoWaitEngine);

    return {
      actionId: action.id,
      success: true,
      data: null,
      duration: getDurationMs(startedAt),
    };
  } catch (error: unknown) {
    const extensionError =
      ExtensionError.isExtensionError(error)
        ? error
        : new ExtensionError(
            ErrorCode.ACTION_FAILED,
            `Failed to execute action "${action.type}"`,
            true,
            error,
          );

    return {
      actionId: action.id,
      success: false,
      data: null,
      error: {
        code: extensionError.code,
        message: extensionError.message,
        stack: error instanceof Error ? error.stack : undefined,
      },
      duration: getDurationMs(startedAt),
    };
  }
}

async function performWaitAction(
  action: WaitExecutionAction,
  autoWaitEngine: AutoWaitEngine,
): Promise<void> {
  switch (action.type) {
    case 'wait':
      await autoWaitEngine.wait(action.duration);
      return;
    case 'waitForElement':
      await autoWaitEngine.waitForElement(
        action.selector,
        action.state ?? 'visible',
        action.timeout,
      );
      return;
    case 'waitForNavigation':
      await autoWaitEngine.waitForNavigation(action.urlPattern, action.timeout);
      return;
    case 'waitForNetwork':
      await autoWaitEngine.waitForNetwork(action.state, action.timeout);
      return;
    default:
      assertNever(action);
  }
}

function getDurationMs(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function assertNever(value: never): never {
  throw new ExtensionError(
    ErrorCode.ACTION_INVALID,
    `Unsupported wait action: ${String(value)}`,
    false,
  );
}
