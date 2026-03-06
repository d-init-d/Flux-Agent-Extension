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
import { DOMInspector } from './dom/inspector';
import { AutoWaitEngine } from './dom/auto-wait-engine';
import { executeInteractionAction } from './actions/interaction';
import { executeInputAction } from './actions/input';
import { executeScrollAction } from './actions/scroll';
import { executeExtractAction } from './actions/extract';
import { executeWaitAction } from './actions/wait';
import type {
  ExecuteActionPayload,
  ActionResultPayload,
  PageContextPayload,
  HighlightPayload,
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
  private readonly domInspector: DOMInspector;
  private readonly autoWaitEngine: AutoWaitEngine;
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
    this.domInspector = new DOMInspector(this.logger);
    this.autoWaitEngine = new AutoWaitEngine(this.selectorEngine);
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

    this.autoWaitEngine.destroy();

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
      case 'scroll':
      case 'scrollIntoView':
        return executeScrollAction(action, this.selectorEngine);
      case 'extract':
      case 'extractAll':
      case 'screenshot':
      case 'fullPageScreenshot':
        return executeExtractAction(action, this.selectorEngine);
      case 'wait':
      case 'waitForElement':
      case 'waitForNavigation':
      case 'waitForNetwork':
        return executeWaitAction(action, this.autoWaitEngine);
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
    return { context: this.domInspector.buildPageContext() };
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
