import { ErrorCode, ExtensionError } from '@shared/errors';
import type { ActionResultPayload, ClickAction, FocusAction, HoverAction } from '@shared/types';
import { SelectorEngine } from '../dom/selector-engine';

export type InteractionAction = ClickAction | HoverAction | FocusAction;

export async function executeInteractionAction(
  action: InteractionAction,
  selectorEngine: SelectorEngine,
): Promise<ActionResultPayload> {
  const startedAt = performance.now();

  try {
    const element = selectorEngine.findElement(action.selector);
    if (!element) {
      throw new ExtensionError(
        ErrorCode.ELEMENT_NOT_FOUND,
        `Element not found for action "${action.type}"`,
        true,
        { selector: action.selector },
      );
    }

    assertElementInteractive(element, action.type);

    try {
      performInteraction(action, element);
    } catch (error) {
      throw new ExtensionError(
        ErrorCode.ACTION_FAILED,
        `Failed to execute action "${action.type}"`,
        true,
        error,
      );
    }

    return {
      actionId: action.id,
      success: true,
      data: null,
      duration: getDurationMs(startedAt),
    };
  } catch (error: unknown) {
    const extensionError = ExtensionError.isExtensionError(error)
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

function performInteraction(action: InteractionAction, element: HTMLElement): void {
  switch (action.type) {
    case 'click':
      element.click();
      return;
    case 'doubleClick':
      dispatchMouseEvent(element, 'dblclick', 0);
      return;
    case 'rightClick':
      dispatchMouseEvent(element, 'contextmenu', 2);
      return;
    case 'hover':
      dispatchMouseEvent(element, 'mouseenter', 0);
      dispatchMouseEvent(element, 'mouseover', 0);
      return;
    case 'focus':
      element.focus();
      return;
    default:
      assertNever(action);
  }
}

function dispatchMouseEvent(
  element: HTMLElement,
  eventType: 'dblclick' | 'contextmenu' | 'mouseenter' | 'mouseover',
  button: 0 | 2,
): void {
  element.dispatchEvent(
    new MouseEvent(eventType, {
      bubbles: true,
      cancelable: true,
      button,
    }),
  );
}

function assertElementInteractive(
  element: Element,
  actionType: InteractionAction['type'],
): asserts element is HTMLElement {
  if (!(element instanceof HTMLElement)) {
    throw new ExtensionError(
      ErrorCode.ELEMENT_NOT_INTERACTIVE,
      `Element is not interactive for action "${actionType}"`,
      true,
    );
  }

  if (isDisabledControl(element)) {
    throw new ExtensionError(
      ErrorCode.ELEMENT_NOT_INTERACTIVE,
      `Element is disabled for action "${actionType}"`,
      true,
    );
  }
}

function isDisabledControl(element: HTMLElement): boolean {
  if ('disabled' in element) {
    return Boolean(
      (element as HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)
        .disabled,
    );
  }
  return false;
}

function getDurationMs(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function assertNever(value: never): never {
  throw new ExtensionError(
    ErrorCode.ACTION_FAILED,
    `Unsupported interaction action: ${String(value)}`,
    false,
  );
}
