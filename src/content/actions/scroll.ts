import { ErrorCode, ExtensionError } from '@shared/errors';
import type { ActionResultPayload, ScrollAction, ScrollIntoViewAction } from '@shared/types';
import { SelectorEngine } from '../dom/selector-engine';

export type ScrollExecutionAction = ScrollAction | ScrollIntoViewAction;

const DEFAULT_SCROLL_AMOUNT = 500;

export async function executeScrollAction(
  action: ScrollExecutionAction,
  selectorEngine: SelectorEngine,
): Promise<ActionResultPayload> {
  const startedAt = performance.now();

  try {
    if (action.type === 'scroll') {
      performScroll(action, selectorEngine);
    } else {
      performScrollIntoView(action, selectorEngine);
    }

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

function performScroll(action: ScrollAction, selectorEngine: SelectorEngine): void {
  const amount = action.amount ?? DEFAULT_SCROLL_AMOUNT;
  const vector = directionToOffset(action.direction, amount);

  if (action.selector) {
    const element = selectorEngine.findElement(action.selector);
    if (!element) {
      throw new ExtensionError(
        ErrorCode.ELEMENT_NOT_FOUND,
        'Element not found for scroll action',
        true,
        { selector: action.selector },
      );
    }

    if (!(element instanceof HTMLElement)) {
      throw new ExtensionError(
        ErrorCode.ELEMENT_NOT_INTERACTIVE,
        'Element is not scrollable for scroll action',
        true,
      );
    }

    element.scrollBy({ left: vector.left, top: vector.top, behavior: 'auto' });
    return;
  }

  window.scrollBy({ left: vector.left, top: vector.top, behavior: 'auto' });
}

function performScrollIntoView(action: ScrollIntoViewAction, selectorEngine: SelectorEngine): void {
  const element = selectorEngine.findElement(action.selector);
  if (!element) {
    throw new ExtensionError(
      ErrorCode.ELEMENT_NOT_FOUND,
      'Element not found for scrollIntoView action',
      true,
      { selector: action.selector },
    );
  }

  if (!(element instanceof HTMLElement)) {
    throw new ExtensionError(
      ErrorCode.ELEMENT_NOT_INTERACTIVE,
      'Element is not interactive for scrollIntoView action',
      true,
    );
  }

  element.scrollIntoView({ block: action.block ?? 'center', inline: 'nearest', behavior: 'auto' });
}

function directionToOffset(direction: ScrollAction['direction'], amount: number): { left: number; top: number } {
  switch (direction) {
    case 'up':
      return { left: 0, top: -amount };
    case 'down':
      return { left: 0, top: amount };
    case 'left':
      return { left: -amount, top: 0 };
    case 'right':
      return { left: amount, top: 0 };
    default:
      return assertNever(direction);
  }
}

function getDurationMs(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function assertNever(value: never): never {
  throw new ExtensionError(ErrorCode.ACTION_INVALID, `Unsupported scroll direction: ${String(value)}`, false);
}
