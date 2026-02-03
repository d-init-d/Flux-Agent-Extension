/**
 * Click Action
 * Click vào element trên trang web
 */

import { ElementSelector, findElement, isElementVisible } from '../selectors';
import { ActionResult } from '@shared/types';
import { sleep } from '@shared/utils';

export interface ClickOptions {
  /** Delay trước khi click (ms) */
  delay?: number;
  /** Click đúp */
  doubleClick?: boolean;
  /** Right click */
  rightClick?: boolean;
  /** Scroll element vào view trước khi click */
  scrollIntoView?: boolean;
  /** Chờ element visible trước khi click */
  waitForVisible?: boolean;
  /** Timeout chờ element (ms) */
  timeout?: number;
}

const DEFAULT_OPTIONS: ClickOptions = {
  delay: 100,
  doubleClick: false,
  rightClick: false,
  scrollIntoView: true,
  waitForVisible: true,
  timeout: 5000,
};

/**
 * Wait for element to become visible
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
 * Perform click action
 */
export async function clickAction(
  selector: ElementSelector,
  options: ClickOptions = {}
): Promise<ActionResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  try {
    // Tìm element
    let element: Element | null;
    
    if (opts.waitForVisible) {
      element = await waitForElement(selector, opts.timeout!);
    } else {
      element = findElement(selector);
    }

    if (!element) {
      return {
        success: false,
        message: `Element not found: ${selector.type}="${selector.value}"`,
      };
    }

    // Kiểm tra visibility
    if (!isElementVisible(element)) {
      return {
        success: false,
        message: 'Element exists but is not visible',
      };
    }

    // Scroll vào view nếu cần
    if (opts.scrollIntoView) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(300); // Chờ scroll animation
    }

    // Delay trước khi click
    if (opts.delay) {
      await sleep(opts.delay);
    }

    // Lấy HTMLElement để dispatch events
    const htmlElement = element as HTMLElement;
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    // Tạo mouse events
    const eventOptions: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: centerX,
      clientY: centerY,
      button: opts.rightClick ? 2 : 0,
    };

    // Dispatch events theo thứ tự tự nhiên
    htmlElement.dispatchEvent(new MouseEvent('mouseenter', eventOptions));
    htmlElement.dispatchEvent(new MouseEvent('mouseover', eventOptions));
    htmlElement.dispatchEvent(new MouseEvent('mousedown', eventOptions));
    
    // Focus element nếu có thể
    if (typeof htmlElement.focus === 'function') {
      htmlElement.focus();
    }

    htmlElement.dispatchEvent(new MouseEvent('mouseup', eventOptions));
    htmlElement.dispatchEvent(new MouseEvent('click', eventOptions));

    // Double click nếu cần
    if (opts.doubleClick) {
      await sleep(50);
      htmlElement.dispatchEvent(new MouseEvent('mousedown', eventOptions));
      htmlElement.dispatchEvent(new MouseEvent('mouseup', eventOptions));
      htmlElement.dispatchEvent(new MouseEvent('click', eventOptions));
      htmlElement.dispatchEvent(new MouseEvent('dblclick', eventOptions));
    }

    // Right click nếu cần
    if (opts.rightClick) {
      htmlElement.dispatchEvent(new MouseEvent('contextmenu', eventOptions));
    }

    return {
      success: true,
      message: `Clicked on element: ${selector.type}="${selector.value}"`,
      data: {
        tagName: element.tagName.toLowerCase(),
        text: element.textContent?.substring(0, 50),
        position: { x: centerX, y: centerY },
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Click failed: ${String(error)}`,
    };
  }
}

export default clickAction;
