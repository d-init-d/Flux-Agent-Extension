/**
 * Type Action
 * Nhập text vào input/textarea
 */

import { ElementSelector, findElement, isElementVisible } from '../selectors';
import { ActionResult } from '@shared/types';
import { sleep } from '@shared/utils';

export interface TypeOptions {
  /** Delay giữa mỗi ký tự (ms) - 0 để type ngay lập tức */
  charDelay?: number;
  /** Xóa nội dung cũ trước khi type */
  clearFirst?: boolean;
  /** Delay trước khi bắt đầu type (ms) */
  delay?: number;
  /** Press Enter sau khi type xong */
  pressEnter?: boolean;
  /** Press Tab sau khi type xong */
  pressTab?: boolean;
  /** Scroll element vào view trước khi type */
  scrollIntoView?: boolean;
  /** Timeout chờ element (ms) */
  timeout?: number;
}

const DEFAULT_OPTIONS: TypeOptions = {
  charDelay: 0,
  clearFirst: true,
  delay: 100,
  pressEnter: false,
  pressTab: false,
  scrollIntoView: true,
  timeout: 5000,
};

/**
 * Wait for element to become visible and interactable
 */
async function waitForElement(
  selector: ElementSelector,
  timeout: number
): Promise<Element | null> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const element = findElement(selector);
    if (element && isElementVisible(element)) {
      return element;
    }
    await sleep(100);
  }

  return null;
}

/**
 * Check if element can accept text input
 */
function isTypeable(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();
  
  if (tagName === 'textarea') return true;
  
  if (tagName === 'input') {
    const type = (element as HTMLInputElement).type.toLowerCase();
    const textTypes = ['text', 'password', 'email', 'tel', 'url', 'search', 'number'];
    return textTypes.includes(type);
  }

  // contenteditable elements
  if ((element as HTMLElement).isContentEditable) {
    return true;
  }

  return false;
}

/**
 * Type text character by character with delay
 */
async function typeWithDelay(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLElement,
  text: string,
  charDelay: number
): Promise<void> {
  for (const char of text) {
    // Dispatch key events
    const keyEventOptions: KeyboardEventInit = {
      key: char,
      code: `Key${char.toUpperCase()}`,
      bubbles: true,
      cancelable: true,
    };

    element.dispatchEvent(new KeyboardEvent('keydown', keyEventOptions));
    element.dispatchEvent(new KeyboardEvent('keypress', keyEventOptions));

    // Actually insert the character
    if ('value' in element) {
      element.value += char;
    } else if (element.isContentEditable) {
      document.execCommand('insertText', false, char);
    }

    // Trigger input event
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      data: char,
      inputType: 'insertText',
    }));

    element.dispatchEvent(new KeyboardEvent('keyup', keyEventOptions));

    if (charDelay > 0) {
      await sleep(charDelay);
    }
  }
}

/**
 * Perform type action
 */
export async function typeAction(
  selector: ElementSelector,
  text: string,
  options: TypeOptions = {}
): Promise<ActionResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  try {
    // Tìm element
    const element = await waitForElement(selector, opts.timeout!);

    if (!element) {
      return {
        success: false,
        message: `Element not found: ${selector.type}="${selector.value}"`,
      };
    }

    // Kiểm tra có thể type được không
    if (!isTypeable(element)) {
      return {
        success: false,
        message: `Element is not typeable: ${element.tagName.toLowerCase()}`,
      };
    }

    // Scroll vào view nếu cần
    if (opts.scrollIntoView) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(300);
    }

    // Focus vào element
    const htmlElement = element as HTMLElement;
    htmlElement.focus();
    await sleep(opts.delay!);

    // Clear existing content nếu cần
    if (opts.clearFirst) {
      if ('value' in htmlElement) {
        (htmlElement as HTMLInputElement).value = '';
      } else if (htmlElement.isContentEditable) {
        htmlElement.textContent = '';
      }
      
      // Trigger input event for clearing
      htmlElement.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteContent',
      }));
    }

    // Type text
    if (opts.charDelay && opts.charDelay > 0) {
      // Type từng ký tự với delay
      await typeWithDelay(htmlElement as HTMLInputElement, text, opts.charDelay);
    } else {
      // Type ngay lập tức
      if ('value' in htmlElement) {
        (htmlElement as HTMLInputElement).value = text;
      } else if (htmlElement.isContentEditable) {
        htmlElement.textContent = text;
      }

      // Trigger input và change events
      htmlElement.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        data: text,
        inputType: 'insertText',
      }));
    }

    // Trigger change event
    htmlElement.dispatchEvent(new Event('change', { bubbles: true }));

    // Press Enter nếu cần
    if (opts.pressEnter) {
      await sleep(50);
      htmlElement.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true,
      }));
      htmlElement.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true,
      }));

      // Submit form nếu có
      const form = htmlElement.closest('form');
      if (form) {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    }

    // Press Tab nếu cần
    if (opts.pressTab) {
      await sleep(50);
      htmlElement.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Tab',
        code: 'Tab',
        bubbles: true,
        cancelable: true,
      }));
    }

    return {
      success: true,
      message: `Typed "${text.substring(0, 20)}${text.length > 20 ? '...' : ''}" into element`,
      data: {
        tagName: element.tagName.toLowerCase(),
        textLength: text.length,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Type failed: ${String(error)}`,
    };
  }
}

export default typeAction;
