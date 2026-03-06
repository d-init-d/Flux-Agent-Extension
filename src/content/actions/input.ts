import { ErrorCode, ExtensionError } from '@shared/errors';
import type {
  ActionResultPayload,
  CheckAction,
  ClearAction,
  FillAction,
  SelectAction,
  TypeAction,
} from '@shared/types';
import { SelectorEngine } from '../dom/selector-engine';

export type InputAction = FillAction | TypeAction | ClearAction | SelectAction | CheckAction;

type InputTarget = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

export async function executeInputAction(
  action: InputAction,
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

    if (!(element instanceof HTMLElement)) {
      throw new ExtensionError(
        ErrorCode.ELEMENT_NOT_INTERACTIVE,
        `Element is not interactive for action "${action.type}"`,
        true,
      );
    }

    try {
      await performInputAction(action, element);
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

async function performInputAction(action: InputAction, element: HTMLElement): Promise<void> {
  switch (action.type) {
    case 'fill': {
      fillElement(element, action.value, action.clearFirst !== false);
      return;
    }
    case 'type': {
      await typeIntoElement(element, action.text, action.delay ?? 0);
      return;
    }
    case 'clear': {
      clearElement(element);
      return;
    }
    case 'select': {
      selectOption(element, action);
      return;
    }
    case 'check':
    case 'uncheck': {
      setCheckboxOrRadio(element, action.type === 'check');
      return;
    }
    default:
      assertNever(action);
  }
}

function fillElement(element: HTMLElement, value: string, clearFirst: boolean): void {
  const target = getTextInputTarget(element, 'fill');
  target.focus();

  if (isContentEditable(target)) {
    const nextValue = clearFirst ? value : (target.textContent ?? '') + value;
    target.textContent = nextValue;
    dispatchInputEvents(target);
    return;
  }

  const currentValue = getValue(target);
  const nextValue = clearFirst ? value : currentValue + value;
  setValueReactSafe(target, nextValue);
}

async function typeIntoElement(element: HTMLElement, text: string, delayMs: number): Promise<void> {
  const target = getTextInputTarget(element, 'type');
  target.focus();

  for (const character of text) {
    if (isContentEditable(target)) {
      const current = target.textContent ?? '';
      target.textContent = current + character;
      dispatchInputEvents(target);
    } else {
      const current = getValue(target);
      setValueReactSafe(target, current + character);
    }

    if (delayMs > 0) {
      await wait(delayMs);
    }
  }
}

function clearElement(element: HTMLElement): void {
  const target = getTextInputTarget(element, 'clear');
  target.focus();

  if (isContentEditable(target)) {
    target.textContent = '';
    dispatchInputEvents(target);
    return;
  }

  setValueReactSafe(target, '');
}

function selectOption(element: HTMLElement, action: SelectAction): void {
  if (!(element instanceof HTMLSelectElement)) {
    throw new ExtensionError(
      ErrorCode.ELEMENT_NOT_INTERACTIVE,
      'Select action requires a <select> element',
      true,
    );
  }

  if (element.disabled) {
    throw new ExtensionError(
      ErrorCode.ELEMENT_NOT_INTERACTIVE,
      'Select element is disabled',
      true,
    );
  }

  const optionIndex = resolveSelectOptionIndex(element, action);
  if (optionIndex < 0 || optionIndex >= element.options.length) {
    throw new ExtensionError(
      ErrorCode.ELEMENT_NOT_FOUND,
      'Select option not found',
      true,
      { option: action.option },
    );
  }

  element.selectedIndex = optionIndex;
  dispatchInputEvents(element);
}

function resolveSelectOptionIndex(element: HTMLSelectElement, action: SelectAction): number {
  if (typeof action.option === 'string') {
    const valueMatch = Array.from(element.options).findIndex((option) => option.value === action.option);
    if (valueMatch !== -1) {
      return valueMatch;
    }
    return Array.from(element.options).findIndex((option) => option.label === action.option);
  }

  const option = action.option;

  if (typeof option.index === 'number') {
    return option.index;
  }

  if (typeof option.value === 'string') {
    const byValue = Array.from(element.options).findIndex((selectOption) => selectOption.value === option.value);
    if (byValue !== -1) {
      return byValue;
    }
  }

  if (typeof option.label === 'string') {
    return Array.from(element.options).findIndex((selectOption) => selectOption.label === option.label);
  }

  return -1;
}

function setCheckboxOrRadio(element: HTMLElement, checked: boolean): void {
  if (!(element instanceof HTMLInputElement)) {
    throw new ExtensionError(
      ErrorCode.ELEMENT_NOT_INTERACTIVE,
      'Check/uncheck action requires an <input> element',
      true,
    );
  }

  if (element.type !== 'checkbox' && element.type !== 'radio') {
    throw new ExtensionError(
      ErrorCode.ELEMENT_NOT_INTERACTIVE,
      'Check/uncheck action requires checkbox or radio input',
      true,
    );
  }

  if (element.disabled) {
    throw new ExtensionError(
      ErrorCode.ELEMENT_NOT_INTERACTIVE,
      'Checkbox/radio element is disabled',
      true,
    );
  }

  if (element.type === 'radio' && !checked) {
    throw new ExtensionError(
      ErrorCode.ACTION_INVALID,
      'Radio input cannot be unchecked directly',
      true,
    );
  }

  element.checked = checked;
  dispatchInputEvents(element);
}

function getTextInputTarget(element: HTMLElement, actionType: InputAction['type']): InputTarget {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    if (element.disabled) {
      throw new ExtensionError(
        ErrorCode.ELEMENT_NOT_INTERACTIVE,
        `Input is disabled for action "${actionType}"`,
        true,
      );
    }
    return element;
  }

  if (isContentEditable(element)) {
    return element;
  }

  throw new ExtensionError(
    ErrorCode.ELEMENT_NOT_INTERACTIVE,
    `Element does not support "${actionType}" action`,
    true,
  );
}

function isContentEditable(element: Element): element is HTMLElement {
  return element instanceof HTMLElement && element.isContentEditable;
}

function getValue(element: HTMLInputElement | HTMLTextAreaElement): string {
  return element.value ?? '';
}

function setValueReactSafe(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = Object.getPrototypeOf(element) as HTMLInputElement | HTMLTextAreaElement;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  const setter = descriptor?.set;

  if (setter) {
    setter.call(element, value);
  } else {
    element.value = value;
  }

  dispatchInputEvents(element);
}

function dispatchInputEvents(element: HTMLElement): void {
  element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
  element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getDurationMs(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function assertNever(value: never): never {
  throw new ExtensionError(
    ErrorCode.ACTION_FAILED,
    `Unsupported input action: ${String(value)}`,
    false,
  );
}
