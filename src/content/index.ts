/**
 * @module content/index
 * @description Flux Agent content script entry point.
 *
 * Runs in every page matching `<all_urls>`. Responsibilities:
 * - Instantiate and initialize the ContentScriptBridge
 * - Register command handlers (EXECUTE_ACTION, GET_PAGE_CONTEXT, HIGHLIGHT_ELEMENT, CLEAR_HIGHLIGHTS)
 * - Observe DOM mutations and relay summaries to the service worker
 * - Clean up on page unload
 *
 * Guards against double-injection via a window sentinel property.
 */

import { ContentScriptBridge } from '@core/bridge';
import { Logger } from '@shared/utils';
import { SelectorEngine } from './dom/selector-engine';
import { executeInteractionAction } from './actions/interaction';
import { executeInputAction } from './actions/input';
import type {
  ExecuteActionPayload,
  ActionResultPayload,
  PageContextPayload,
  HighlightPayload,
  InteractiveElement,
  FormInfo,
  PageContext,
} from '@shared/types';

// ============================================================================
// Double-injection guard
// ============================================================================

declare global {
  interface Window {
    __FLUX_AGENT_CS_INITIALIZED__?: boolean;
  }
}

if (window.__FLUX_AGENT_CS_INITIALIZED__) {
  new Logger('ContentScript').warn(
    'Content script already injected — skipping re-initialization',
  );
} else {
  window.__FLUX_AGENT_CS_INITIALIZED__ = true;
  bootstrapContentScript();
}

// ============================================================================
// Constants
// ============================================================================

const INTERACTIVE_SELECTORS = [
  'button',
  'a',
  'input',
  'select',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[contenteditable="true"]',
].join(', ');

const MAX_INTERACTIVE_ELEMENTS = 200;
const MAX_LINKS = 100;
const TEXT_TRUNCATE_SHORT = 100;
const TEXT_TRUNCATE_LONG = 200;
const MUTATION_DEBOUNCE_MS = 500;
const HIGHLIGHT_Z_INDEX = '2147483647';
const DEFAULT_HIGHLIGHT_COLOR = '#FF6B35';
const HIGHLIGHT_DATA_ATTR = 'data-flux-highlight';

// ============================================================================
// ContentScriptManager
// ============================================================================

export class ContentScriptManager {
  private readonly bridge: ContentScriptBridge;
  private readonly logger: Logger;
  private readonly selectorEngine: SelectorEngine;
  private mutationObserver: MutationObserver | null = null;
  private highlightOverlays: HTMLElement[] = [];

  private mutationDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingMutationAdded = 0;
  private pendingMutationRemoved = 0;

  private unloadHandler: (() => void) | null = null;
  private commandUnsubscribers: (() => void)[] = [];

  constructor() {
    this.bridge = new ContentScriptBridge();
    this.logger = new Logger('ContentScript');
    this.selectorEngine = new SelectorEngine();
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Full initialization sequence:
   * 1. Register command handlers on the bridge
   * 2. Initialize the bridge (wires chrome.runtime.onMessage, emits PAGE_LOADED)
   * 3. Set up DOM mutation observer (waits for document.body if needed)
   * 4. Set up beforeunload handler
   */
  initialize(): void {
    this.registerCommandHandlers();
    this.bridge.initialize();
    this.setupMutationObserver();
    this.setupUnloadHandler();
    this.logger.info('ContentScriptManager initialized', { url: location.href });
  }

  /**
   * Tear down everything: disconnect observer, remove event listeners,
   * clear highlights, destroy bridge.
   */
  destroy(): void {
    if (this.mutationDebounceTimer !== null) {
      clearTimeout(this.mutationDebounceTimer);
      this.mutationDebounceTimer = null;
    }

    if (this.mutationObserver !== null) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }

    // Remove registered command handlers
    for (const unsub of this.commandUnsubscribers) {
      unsub();
    }
    this.commandUnsubscribers = [];

    // Clean up highlight overlays from the DOM
    this.removeAllHighlights();

    // Remove beforeunload listener
    if (this.unloadHandler !== null) {
      window.removeEventListener('beforeunload', this.unloadHandler);
      this.unloadHandler = null;
    }

    this.bridge.destroy();
    this.logger.info('ContentScriptManager destroyed');
  }

  // --------------------------------------------------------------------------
  // Command Registration
  // --------------------------------------------------------------------------

  private registerCommandHandlers(): void {
    this.commandUnsubscribers.push(
      this.bridge.onCommand<ExecuteActionPayload>(
        'EXECUTE_ACTION',
        (payload) => this.handleExecuteAction(payload),
      ),
    );

    this.commandUnsubscribers.push(
      this.bridge.onCommand<undefined>(
        'GET_PAGE_CONTEXT',
        () => this.handleGetPageContext(),
      ),
    );

    this.commandUnsubscribers.push(
      this.bridge.onCommand<HighlightPayload>(
        'HIGHLIGHT_ELEMENT',
        (payload) => this.handleHighlightElement(payload),
      ),
    );

    this.commandUnsubscribers.push(
      this.bridge.onCommand<undefined>(
        'CLEAR_HIGHLIGHTS',
        () => this.handleClearHighlights(),
      ),
    );
  }

  // --------------------------------------------------------------------------
  // EXECUTE_ACTION (C-15: interaction actions)
  // --------------------------------------------------------------------------

  private async handleExecuteAction(
    payload: ExecuteActionPayload,
  ): Promise<ActionResultPayload> {
    const { action } = payload;
    this.logger.debug('EXECUTE_ACTION received', { actionType: action.type });

    switch (action.type) {
      case 'click':
      case 'doubleClick':
      case 'rightClick':
      case 'hover':
      case 'focus':
        return executeInteractionAction(action, this.selectorEngine);
      case 'fill':
      case 'type':
      case 'clear':
      case 'select':
      case 'check':
      case 'uncheck':
        return executeInputAction(action, this.selectorEngine);
      default:
        break;
    }

    return {
      actionId: action.id,
      success: false,
      data: null,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: `Action type "${action.type}" is not implemented yet`,
      },
      duration: 0,
    };
  }

  // --------------------------------------------------------------------------
  // GET_PAGE_CONTEXT (Full implementation)
  // --------------------------------------------------------------------------

  private async handleGetPageContext(): Promise<PageContextPayload> {
    this.logger.debug('GET_PAGE_CONTEXT received');

    const context: PageContext = {
      url: location.href,
      title: document.title,
      interactiveElements: this.gatherInteractiveElements(),
      headings: this.gatherHeadings(),
      links: this.gatherLinks(),
      forms: this.gatherForms(),
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        scrollHeight: document.documentElement.scrollHeight,
      },
    };

    return { context };
  }

  private gatherInteractiveElements(): InteractiveElement[] {
    const elements: InteractiveElement[] = [];
    try {
      const nodes = document.querySelectorAll(INTERACTIVE_SELECTORS);
      let index = 0;
      for (const node of nodes) {
        if (index >= MAX_INTERACTIVE_ELEMENTS) break;

        const el = node as HTMLElement;
        const rect = el.getBoundingClientRect();

        elements.push({
          index,
          tag: el.tagName.toLowerCase(),
          type: (el as HTMLInputElement).type || undefined,
          role: el.getAttribute('role') || undefined,
          text: truncate((el.innerText || '').trim(), TEXT_TRUNCATE_SHORT),
          placeholder: (el as HTMLInputElement).placeholder || undefined,
          ariaLabel: el.getAttribute('aria-label') || undefined,
          isVisible: this.isElementVisible(el),
          isEnabled: !(el as HTMLInputElement | HTMLButtonElement).disabled,
          boundingBox: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
        });
        index++;
      }
    } catch (error) {
      this.logger.warn('Failed to gather interactive elements', error);
    }
    return elements;
  }

  private gatherHeadings(): { level: number; text: string }[] {
    const headings: { level: number; text: string }[] = [];
    try {
      const nodes = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      for (const node of nodes) {
        const el = node as HTMLElement;
        const level = parseInt(el.tagName.charAt(1), 10);
        headings.push({
          level,
          text: truncate((el.innerText || '').trim(), TEXT_TRUNCATE_LONG),
        });
      }
    } catch (error) {
      this.logger.warn('Failed to gather headings', error);
    }
    return headings;
  }

  private gatherLinks(): { text: string; href: string }[] {
    const links: { text: string; href: string }[] = [];
    try {
      const nodes = document.querySelectorAll('a[href]');
      let count = 0;
      for (const node of nodes) {
        if (count >= MAX_LINKS) break;
        const anchor = node as HTMLAnchorElement;
        links.push({
          text: truncate((anchor.innerText || '').trim(), TEXT_TRUNCATE_SHORT),
          href: anchor.href,
        });
        count++;
      }
    } catch (error) {
      this.logger.warn('Failed to gather links', error);
    }
    return links;
  }

  private gatherForms(): FormInfo[] {
    const forms: FormInfo[] = [];
    try {
      const formNodes = document.querySelectorAll('form');
      for (const formEl of formNodes) {
        const form = formEl as HTMLFormElement;
        const fields: FormInfo['fields'] = [];

        const inputs = form.querySelectorAll('input, select, textarea');
        for (const inputNode of inputs) {
          const input = inputNode as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
          const name = input.name || input.id || '';
          const type =
            input.tagName.toLowerCase() === 'select'
              ? 'select'
              : input.tagName.toLowerCase() === 'textarea'
                ? 'textarea'
                : (input as HTMLInputElement).type || 'text';

          // Resolve label: associated <label>, then aria-label
          let label: string | undefined;
          if (input.id) {
            const labelEl = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
            if (labelEl) {
              label = (labelEl as HTMLElement).innerText?.trim();
            }
          }
          if (!label) {
            label = input.getAttribute('aria-label') || undefined;
          }

          // Don't leak password values
          const isPassword = type === 'password';
          const value = isPassword ? undefined : input.value || undefined;

          fields.push({
            name,
            type,
            label,
            required: input.required,
            value,
          });
        }

        forms.push({
          action: form.action || '',
          method: (form.method || 'get').toUpperCase(),
          fields,
        });
      }
    } catch (error) {
      this.logger.warn('Failed to gather forms', error);
    }
    return forms;
  }

  // --------------------------------------------------------------------------
  // HIGHLIGHT_ELEMENT (Full implementation)
  // --------------------------------------------------------------------------

  private async handleHighlightElement(
    payload: HighlightPayload,
  ): Promise<{ highlighted: boolean }> {
    this.logger.debug('HIGHLIGHT_ELEMENT received', { selector: payload.selector });

    const element = this.selectorEngine.findElement(payload.selector);
    if (!element) {
      this.logger.warn('Element not found for highlight', { selector: payload.selector });
      return { highlighted: false };
    }

    try {
      const rect = element.getBoundingClientRect();
      const color = payload.color || DEFAULT_HIGHLIGHT_COLOR;
      const rgbaBackground = hexToRgba(color, 0.1);

      const overlay = document.createElement('div');
      overlay.setAttribute(HIGHLIGHT_DATA_ATTR, 'true');
      overlay.style.cssText = [
        'position: absolute',
        `top: ${rect.top + window.scrollY}px`,
        `left: ${rect.left + window.scrollX}px`,
        `width: ${rect.width}px`,
        `height: ${rect.height}px`,
        `border: 2px solid ${color}`,
        `background: ${rgbaBackground}`,
        `z-index: ${HIGHLIGHT_Z_INDEX}`,
        'pointer-events: none',
        'box-sizing: border-box',
        'border-radius: 2px',
        'transition: opacity 0.2s ease-out',
      ].join('; ');

      document.body.appendChild(overlay);
      this.highlightOverlays.push(overlay);

      // Auto-remove after duration
      if (payload.duration && payload.duration > 0) {
        setTimeout(() => {
          this.removeSingleHighlight(overlay);
        }, payload.duration);
      }

      return { highlighted: true };
    } catch (error) {
      this.logger.warn('Failed to create highlight overlay', error);
      return { highlighted: false };
    }
  }

  // --------------------------------------------------------------------------
  // CLEAR_HIGHLIGHTS
  // --------------------------------------------------------------------------

  private async handleClearHighlights(): Promise<{ cleared: number }> {
    this.logger.debug('CLEAR_HIGHLIGHTS received');
    const cleared = this.removeAllHighlights();
    return { cleared };
  }

  /**
   * Remove all highlight overlays from the DOM and clear the tracking array.
   * Returns the number of overlays removed.
   */
  private removeAllHighlights(): number {
    let count = 0;
    try {
      // Remove everything with the data attribute (catches any stale refs too)
      const existing = document.querySelectorAll(`[${HIGHLIGHT_DATA_ATTR}="true"]`);
      for (const el of existing) {
        el.remove();
        count++;
      }
    } catch (error) {
      this.logger.warn('Failed to clear highlights from DOM', error);
    }
    this.highlightOverlays = [];
    return count;
  }

  /**
   * Remove a single overlay from the DOM and the tracking array.
   */
  private removeSingleHighlight(overlay: HTMLElement): void {
    try {
      overlay.remove();
    } catch {
      // Element may already be removed
    }
    const idx = this.highlightOverlays.indexOf(overlay);
    if (idx !== -1) {
      this.highlightOverlays.splice(idx, 1);
    }
  }

  // --------------------------------------------------------------------------
  // Visibility Check
  // --------------------------------------------------------------------------

  /**
   * Determine whether an element is visually rendered on the page.
   * Checks: offsetParent (non-fixed), computed display/visibility/opacity,
   * and bounding box dimensions.
   */
  private isElementVisible(el: Element): boolean {
    try {
      const htmlEl = el as HTMLElement;

      // offsetParent is null for hidden elements, except for fixed-position
      const computedStyle = window.getComputedStyle(htmlEl);
      if (computedStyle.position !== 'fixed' && htmlEl.offsetParent === null) {
        return false;
      }

      if (computedStyle.display === 'none') return false;
      if (computedStyle.visibility === 'hidden') return false;
      if (parseFloat(computedStyle.opacity) <= 0) return false;

      const rect = htmlEl.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;

      return true;
    } catch {
      return false;
    }
  }

  // --------------------------------------------------------------------------
  // MutationObserver
  // --------------------------------------------------------------------------

  /**
   * Set up a MutationObserver on document.body. If body is not yet available
   * (rare edge case), waits for it via a polling interval.
   */
  private setupMutationObserver(): void {
    if (document.body) {
      this.attachMutationObserver(document.body);
    } else {
      // Body not ready — wait for it
      const waitInterval = setInterval(() => {
        if (document.body) {
          clearInterval(waitInterval);
          this.attachMutationObserver(document.body);
        }
      }, 50);

      // Safety timeout: stop waiting after 10s
      setTimeout(() => {
        clearInterval(waitInterval);
        if (!this.mutationObserver && document.body) {
          this.attachMutationObserver(document.body);
        }
      }, 10_000);
    }
  }

  private attachMutationObserver(target: Node): void {
    this.mutationObserver = new MutationObserver((mutations) => {
      let added = 0;
      let removed = 0;

      for (const mutation of mutations) {
        added += mutation.addedNodes.length;
        removed += mutation.removedNodes.length;
      }

      this.pendingMutationAdded += added;
      this.pendingMutationRemoved += removed;

      // Debounce: only emit after 500ms of silence
      if (this.mutationDebounceTimer !== null) {
        clearTimeout(this.mutationDebounceTimer);
      }

      this.mutationDebounceTimer = setTimeout(() => {
        this.bridge.emit('DOM_MUTATION', {
          added: this.pendingMutationAdded,
          removed: this.pendingMutationRemoved,
          timestamp: Date.now(),
        });

        this.pendingMutationAdded = 0;
        this.pendingMutationRemoved = 0;
        this.mutationDebounceTimer = null;
      }, MUTATION_DEBOUNCE_MS);
    });

    this.mutationObserver.observe(target, {
      childList: true,
      subtree: true,
    });

    this.logger.debug('MutationObserver attached');
  }

  // --------------------------------------------------------------------------
  // Unload Handler
  // --------------------------------------------------------------------------

  private setupUnloadHandler(): void {
    this.unloadHandler = () => {
      this.bridge.emit('PAGE_UNLOAD', {
        url: location.href,
        timestamp: Date.now(),
      });
      this.destroy();
    };

    window.addEventListener('beforeunload', this.unloadHandler);
  }
}

// ============================================================================
// Utility functions (module-private — no global scope pollution)
// ============================================================================

/**
 * Truncate a string to a maximum length, appending an ellipsis if truncated.
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + '\u2026';
}

/**
 * Convert a hex colour string to an rgba() string.
 * Handles 3-char, 6-char, and 8-char hex (with or without leading #).
 */
function hexToRgba(hex: string, alpha: number): string {
  let cleaned = hex.replace(/^#/, '');

  // Expand 3-char hex → 6-char
  if (cleaned.length === 3) {
    cleaned = cleaned[0] + cleaned[0] + cleaned[1] + cleaned[1] + cleaned[2] + cleaned[2];
  }

  // Take only first 6 chars (ignore alpha channel if 8-char)
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);

  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    return `rgba(255, 107, 53, ${alpha})`; // fallback to default color
  }

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ============================================================================
// Bootstrap
// ============================================================================

/**
 * Entry point: create the manager and initialize.
 * Extracted into a function so the double-injection guard can call it
 * conditionally.
 */
function bootstrapContentScript(): void {
  const manager = new ContentScriptManager();
  manager.initialize();
}
