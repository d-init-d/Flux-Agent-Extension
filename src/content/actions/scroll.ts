/**
 * Scroll Action
 * Scroll trang hoặc scroll đến element cụ thể
 */

import { ElementSelector, findElement } from '../selectors';
import { ActionResult } from '@shared/types';
import { sleep } from '@shared/utils';

export interface ScrollOptions {
  /** Hướng scroll */
  direction?: 'up' | 'down' | 'left' | 'right' | 'top' | 'bottom';
  /** Số pixel để scroll (cho up/down/left/right) */
  amount?: number;
  /** Scroll behavior */
  behavior?: 'smooth' | 'instant';
  /** Scroll container selector (mặc định là window) */
  container?: ElementSelector;
}

export interface ScrollToElementOptions {
  /** Vị trí element trong viewport */
  block?: 'start' | 'center' | 'end' | 'nearest';
  /** Vị trí horizontal */
  inline?: 'start' | 'center' | 'end' | 'nearest';
  /** Scroll behavior */
  behavior?: 'smooth' | 'instant';
  /** Offset từ vị trí element (pixels) */
  offset?: { top?: number; left?: number };
}

const DEFAULT_SCROLL_OPTIONS: ScrollOptions = {
  direction: 'down',
  amount: 300,
  behavior: 'smooth',
};

const DEFAULT_SCROLL_TO_OPTIONS: ScrollToElementOptions = {
  block: 'center',
  inline: 'nearest',
  behavior: 'smooth',
};

/**
 * Scroll page theo hướng
 */
export async function scrollAction(
  options: ScrollOptions = {}
): Promise<ActionResult> {
  const opts = { ...DEFAULT_SCROLL_OPTIONS, ...options };

  try {
    // Lấy container để scroll
    let container: Element | Window = window;
    if (opts.container) {
      const containerEl = findElement(opts.container);
      if (containerEl) {
        container = containerEl;
      }
    }

    const scrollOptions: ScrollToOptions = {
      behavior: opts.behavior,
    };

    // Lấy current scroll position
    const isWindow = container === window;
    const currentScrollTop = isWindow ? window.scrollY : (container as Element).scrollTop;
    const currentScrollLeft = isWindow ? window.scrollX : (container as Element).scrollLeft;
    const maxScrollTop = isWindow
      ? document.documentElement.scrollHeight - window.innerHeight
      : (container as Element).scrollHeight - (container as Element).clientHeight;
    const maxScrollLeft = isWindow
      ? document.documentElement.scrollWidth - window.innerWidth
      : (container as Element).scrollWidth - (container as Element).clientWidth;

    switch (opts.direction) {
      case 'up':
        scrollOptions.top = Math.max(0, currentScrollTop - opts.amount!);
        break;
      case 'down':
        scrollOptions.top = Math.min(maxScrollTop, currentScrollTop + opts.amount!);
        break;
      case 'left':
        scrollOptions.left = Math.max(0, currentScrollLeft - opts.amount!);
        break;
      case 'right':
        scrollOptions.left = Math.min(maxScrollLeft, currentScrollLeft + opts.amount!);
        break;
      case 'top':
        scrollOptions.top = 0;
        break;
      case 'bottom':
        scrollOptions.top = maxScrollTop;
        break;
    }

    // Perform scroll
    if (isWindow) {
      window.scrollTo(scrollOptions);
    } else {
      (container as Element).scrollTo(scrollOptions);
    }

    // Wait for scroll animation
    await sleep(opts.behavior === 'smooth' ? 500 : 50);

    // Calculate new position
    const newScrollTop = isWindow ? window.scrollY : (container as Element).scrollTop;
    const newScrollLeft = isWindow ? window.scrollX : (container as Element).scrollLeft;

    return {
      success: true,
      message: `Scrolled ${opts.direction}`,
      data: {
        direction: opts.direction,
        amount: opts.amount,
        previousPosition: { top: currentScrollTop, left: currentScrollLeft },
        newPosition: { top: newScrollTop, left: newScrollLeft },
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Scroll failed: ${String(error)}`,
    };
  }
}

/**
 * Scroll đến một element cụ thể
 */
export async function scrollToElementAction(
  selector: ElementSelector,
  options: ScrollToElementOptions = {}
): Promise<ActionResult> {
  const opts = { ...DEFAULT_SCROLL_TO_OPTIONS, ...options };

  try {
    const element = findElement(selector);

    if (!element) {
      return {
        success: false,
        message: `Element not found: ${selector.type}="${selector.value}"`,
      };
    }

    // Scroll element into view
    element.scrollIntoView({
      behavior: opts.behavior,
      block: opts.block,
      inline: opts.inline,
    });

    // Apply offset nếu có
    if (opts.offset) {
      await sleep(opts.behavior === 'smooth' ? 500 : 50);
      window.scrollBy({
        top: opts.offset.top || 0,
        left: opts.offset.left || 0,
        behavior: opts.behavior,
      });
    }

    // Wait for scroll animation
    await sleep(opts.behavior === 'smooth' ? 300 : 50);

    const rect = element.getBoundingClientRect();

    return {
      success: true,
      message: `Scrolled to element: ${selector.type}="${selector.value}"`,
      data: {
        tagName: element.tagName.toLowerCase(),
        text: element.textContent?.substring(0, 50),
        position: {
          top: rect.top,
          left: rect.left,
          bottom: rect.bottom,
          right: rect.right,
        },
        isInViewport: rect.top >= 0 && rect.top <= window.innerHeight,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Scroll to element failed: ${String(error)}`,
    };
  }
}

export default scrollAction;
