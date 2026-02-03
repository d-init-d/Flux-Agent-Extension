/**
 * Hover Action
 * Hover vào element để trigger tooltips, dropdowns, menus
 */

import { ElementSelector, findElement, isElementVisible } from '../selectors';
import { ActionResult } from '@shared/types';
import { sleep } from '@shared/utils';

export interface HoverOptions {
  /** Thời gian hover (ms) - 0 để hover vĩnh viễn */
  duration?: number;
  /** Delay trước khi hover (ms) */
  delay?: number;
  /** Scroll element vào view trước khi hover */
  scrollIntoView?: boolean;
  /** Timeout chờ element (ms) */
  timeout?: number;
}

const DEFAULT_OPTIONS: HoverOptions = {
  duration: 1000,
  delay: 100,
  scrollIntoView: true,
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
 * Perform hover action
 */
export async function hoverAction(
  selector: ElementSelector,
  options: HoverOptions = {}
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
      await sleep(300);
    }

    // Delay trước khi hover
    if (opts.delay) {
      await sleep(opts.delay);
    }

    const htmlElement = element as HTMLElement;
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    // Tạo mouse event options
    const eventOptions: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: centerX,
      clientY: centerY,
    };

    // Dispatch hover events
    htmlElement.dispatchEvent(new MouseEvent('mouseenter', eventOptions));
    htmlElement.dispatchEvent(new MouseEvent('mouseover', eventOptions));
    htmlElement.dispatchEvent(new MouseEvent('mousemove', eventOptions));

    // Trigger :hover pseudo-class effect
    // Note: Không thể trigger CSS :hover trực tiếp bằng JS, nhưng có thể trigger các event handlers

    // Giữ hover trong khoảng thời gian duration
    if (opts.duration && opts.duration > 0) {
      await sleep(opts.duration);

      // Mouse leave sau khi hết duration
      htmlElement.dispatchEvent(new MouseEvent('mouseleave', eventOptions));
      htmlElement.dispatchEvent(new MouseEvent('mouseout', eventOptions));
    }

    return {
      success: true,
      message: `Hovered on element: ${selector.type}="${selector.value}"`,
      data: {
        tagName: element.tagName.toLowerCase(),
        text: element.textContent?.substring(0, 50),
        position: { x: centerX, y: centerY },
        duration: opts.duration,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Hover failed: ${String(error)}`,
    };
  }
}

/**
 * Leave hover state - gọi khi cần cancel hover
 */
export async function leaveHoverAction(
  selector: ElementSelector
): Promise<ActionResult> {
  try {
    const element = findElement(selector);

    if (!element) {
      return {
        success: false,
        message: `Element not found: ${selector.type}="${selector.value}"`,
      };
    }

    const htmlElement = element as HTMLElement;
    const rect = element.getBoundingClientRect();

    const eventOptions: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };

    htmlElement.dispatchEvent(new MouseEvent('mouseleave', eventOptions));
    htmlElement.dispatchEvent(new MouseEvent('mouseout', eventOptions));

    return {
      success: true,
      message: `Left hover on element: ${selector.type}="${selector.value}"`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Leave hover failed: ${String(error)}`,
    };
  }
}

export default hoverAction;
