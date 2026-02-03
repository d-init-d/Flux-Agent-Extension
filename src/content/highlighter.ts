/**
 * Element Highlighter
 * Tạo visual feedback khi AI đang tương tác với elements
 */

import { ElementSelector, findElement } from './selectors';
import { sleep } from '@shared/utils';

// Style constants
const HIGHLIGHT_CLASS = 'flux-agent-highlight';
const TOOLTIP_CLASS = 'flux-agent-tooltip';
const OVERLAY_ID = 'flux-agent-overlay';

// Inject styles vào page
function injectStyles(): void {
  if (document.getElementById('flux-agent-styles')) return;

  const styles = document.createElement('style');
  styles.id = 'flux-agent-styles';
  styles.textContent = `
    .${HIGHLIGHT_CLASS} {
      outline: 3px solid #3b82f6 !important;
      outline-offset: 2px !important;
      box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.3) !important;
      transition: outline 0.2s ease, box-shadow 0.2s ease !important;
      position: relative !important;
      z-index: 10000 !important;
    }

    .${HIGHLIGHT_CLASS}::before {
      content: '';
      position: absolute;
      inset: -6px;
      background: rgba(59, 130, 246, 0.1);
      border-radius: 4px;
      pointer-events: none;
      animation: flux-pulse 1.5s ease-in-out infinite;
    }

    @keyframes flux-pulse {
      0%, 100% { opacity: 0.5; }
      50% { opacity: 1; }
    }

    .${TOOLTIP_CLASS} {
      position: fixed;
      background: #1e293b;
      color: #f1f5f9;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      z-index: 10001;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      pointer-events: none;
      max-width: 250px;
      word-wrap: break-word;
    }

    .${TOOLTIP_CLASS}::before {
      content: '🤖 Flux Agent';
      display: block;
      font-weight: 600;
      color: #3b82f6;
      margin-bottom: 4px;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .${TOOLTIP_CLASS}.action-click::after { content: '👆 Clicking...'; }
    .${TOOLTIP_CLASS}.action-type::after { content: '⌨️ Typing...'; }
    .${TOOLTIP_CLASS}.action-scroll::after { content: '📜 Scrolling...'; }
    .${TOOLTIP_CLASS}.action-hover::after { content: '👀 Hovering...'; }
    .${TOOLTIP_CLASS}.action-extract::after { content: '📋 Extracting...'; }

    #${OVERLAY_ID} {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.3);
      z-index: 9999;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.3s ease;
    }

    #${OVERLAY_ID}.active {
      opacity: 1;
    }
  `;
  document.head.appendChild(styles);
}

// Current highlighted element
let currentHighlight: {
  element: Element;
  tooltip: HTMLElement | null;
} | null = null;

/**
 * Highlight một element trên trang
 */
export function highlightElement(
  selector: ElementSelector,
  action?: 'click' | 'type' | 'scroll' | 'hover' | 'extract',
  message?: string
): boolean {
  injectStyles();

  // Remove previous highlight
  removeHighlight();

  const element = findElement(selector);
  if (!element) return false;

  // Add highlight class
  element.classList.add(HIGHLIGHT_CLASS);

  // Create tooltip
  const tooltip = document.createElement('div');
  tooltip.className = `${TOOLTIP_CLASS}${action ? ` action-${action}` : ''}`;
  if (message) {
    tooltip.textContent = message;
  }

  // Position tooltip
  const rect = element.getBoundingClientRect();
  tooltip.style.top = `${Math.max(10, rect.top - 50)}px`;
  tooltip.style.left = `${Math.max(10, rect.left)}px`;

  document.body.appendChild(tooltip);

  currentHighlight = { element, tooltip };
  return true;
}

/**
 * Highlight element trực tiếp (không cần selector)
 */
export function highlightElementDirect(
  element: Element,
  action?: 'click' | 'type' | 'scroll' | 'hover' | 'extract',
  message?: string
): void {
  injectStyles();
  removeHighlight();

  element.classList.add(HIGHLIGHT_CLASS);

  const tooltip = document.createElement('div');
  tooltip.className = `${TOOLTIP_CLASS}${action ? ` action-${action}` : ''}`;
  if (message) {
    tooltip.textContent = message;
  }

  const rect = element.getBoundingClientRect();
  tooltip.style.top = `${Math.max(10, rect.top - 50)}px`;
  tooltip.style.left = `${Math.max(10, rect.left)}px`;

  document.body.appendChild(tooltip);

  currentHighlight = { element, tooltip };
}

/**
 * Remove highlight hiện tại
 */
export function removeHighlight(): void {
  if (currentHighlight) {
    currentHighlight.element.classList.remove(HIGHLIGHT_CLASS);
    currentHighlight.tooltip?.remove();
    currentHighlight = null;
  }

  // Cleanup any orphan tooltips
  document.querySelectorAll(`.${TOOLTIP_CLASS}`).forEach(el => el.remove());
}

/**
 * Flash highlight - highlight rồi tự động remove
 */
export async function flashHighlight(
  selector: ElementSelector,
  action?: 'click' | 'type' | 'scroll' | 'hover' | 'extract',
  message?: string,
  duration = 1500
): Promise<void> {
  highlightElement(selector, action, message);
  await sleep(duration);
  removeHighlight();
}

/**
 * Flash highlight cho element trực tiếp
 */
export async function flashHighlightDirect(
  element: Element,
  action?: 'click' | 'type' | 'scroll' | 'hover' | 'extract',
  message?: string,
  duration = 1500
): Promise<void> {
  highlightElementDirect(element, action, message);
  await sleep(duration);
  removeHighlight();
}

/**
 * Show overlay toàn trang (khi đang thực hiện action)
 */
export function showOverlay(): void {
  injectStyles();
  
  let overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    document.body.appendChild(overlay);
  }
  
  // Force reflow để animation hoạt động
  overlay.offsetHeight;
  overlay.classList.add('active');
}

/**
 * Hide overlay
 */
export function hideOverlay(): void {
  const overlay = document.getElementById(OVERLAY_ID);
  if (overlay) {
    overlay.classList.remove('active');
  }
}

/**
 * Highlight multiple elements
 */
export function highlightElements(
  selectors: ElementSelector[],
  action?: 'click' | 'type' | 'scroll' | 'hover' | 'extract'
): Element[] {
  injectStyles();
  removeHighlight();

  const elements: Element[] = [];
  
  selectors.forEach((selector, index) => {
    const element = findElement(selector);
    if (element) {
      element.classList.add(HIGHLIGHT_CLASS);
      elements.push(element);

      // Add number indicator
      const indicator = document.createElement('div');
      indicator.className = TOOLTIP_CLASS;
      indicator.textContent = `Element ${index + 1}`;
      
      const rect = element.getBoundingClientRect();
      indicator.style.top = `${Math.max(10, rect.top - 30)}px`;
      indicator.style.left = `${Math.max(10, rect.left)}px`;
      
      document.body.appendChild(indicator);
    }
  });

  return elements;
}

/**
 * Remove all highlights
 */
export function removeAllHighlights(): void {
  document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach(el => {
    el.classList.remove(HIGHLIGHT_CLASS);
  });
  document.querySelectorAll(`.${TOOLTIP_CLASS}`).forEach(el => el.remove());
  hideOverlay();
}

// Export highlighter object
export const highlighter = {
  highlight: highlightElement,
  highlightDirect: highlightElementDirect,
  remove: removeHighlight,
  flash: flashHighlight,
  flashDirect: flashHighlightDirect,
  showOverlay,
  hideOverlay,
  highlightMultiple: highlightElements,
  removeAll: removeAllHighlights,
};

export default highlighter;
