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
const HIGHLIGHT_STYLE_ID = 'flux-highlight-styles';

interface ActiveHighlight {
  element: HTMLElement;
  overlay: HTMLElement;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

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
  private activeHighlights: ActiveHighlight[] = [];
  private highlightAnimationFrame: number | null = null;
  private readonly boundHighlightReposition = () => {
    this.updateHighlightPositions();
  };

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
      const color = payload.color || DEFAULT_HIGHLIGHT_COLOR;
      const target = element as HTMLElement;

      this.ensureHighlightStyles();

      const overlay = document.createElement('div');
      overlay.setAttribute(HIGHLIGHT_DATA_ATTR, 'true');
      overlay.className = 'flux-highlight-overlay';
      overlay.style.setProperty('--flux-highlight-color', color);
      overlay.style.setProperty('--flux-highlight-color-soft', hexToRgba(color, 0.16));
      overlay.style.setProperty('--flux-highlight-color-glow', hexToRgba(color, 0.28));
      overlay.style.zIndex = HIGHLIGHT_Z_INDEX;
      overlay.style.pointerEvents = 'none';

      document.body.appendChild(overlay);

      const activeHighlight: ActiveHighlight = {
        element: target,
        overlay,
        timeoutId: null,
      };

      this.activeHighlights.push(activeHighlight);
      this.updateSingleHighlightPosition(activeHighlight);
      this.startHighlightTracking();

      if (payload.duration && payload.duration > 0) {
        activeHighlight.timeoutId = window.setTimeout(() => {
          this.removeSingleHighlight(activeHighlight.overlay);
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
      for (const highlight of this.activeHighlights) {
        if (highlight.timeoutId !== null) {
          clearTimeout(highlight.timeoutId);
        }
      }

      const existing = document.querySelectorAll(`[${HIGHLIGHT_DATA_ATTR}="true"]`);
      for (const el of existing) {
        el.remove();
        count++;
      }
    } catch (error) {
      this.logger.warn('Failed to clear highlights from DOM', error);
    }
    this.activeHighlights = [];
    this.stopHighlightTracking();
    this.removeHighlightStyles();
    return count;
  }

  /**
   * Remove a single overlay from the DOM and the tracking array.
   */
  private removeSingleHighlight(overlay: HTMLElement): void {
    const highlight = this.activeHighlights.find((entry) => entry.overlay === overlay);

    if (highlight && highlight.timeoutId !== null) {
      clearTimeout(highlight.timeoutId);
    }

    try {
      overlay.remove();
    } catch {
    }

    const idx = this.activeHighlights.findIndex((entry) => entry.overlay === overlay);
    if (idx !== -1) {
      this.activeHighlights.splice(idx, 1);
    }

    if (this.activeHighlights.length === 0) {
      this.stopHighlightTracking();
      this.removeHighlightStyles();
    }
  }

  private ensureHighlightStyles(): void {
    if (document.getElementById(HIGHLIGHT_STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = HIGHLIGHT_STYLE_ID;
    style.textContent = `
      @keyframes flux-highlight-pulse {
        0% {
          opacity: 0.72;
          box-shadow: 0 0 0 0 var(--flux-highlight-color-soft);
          transform: scale(0.995);
        }
        70% {
          opacity: 1;
          box-shadow: 0 0 0 8px rgba(255, 255, 255, 0);
          transform: scale(1.005);
        }
        100% {
          opacity: 0.88;
          box-shadow: 0 0 0 0 rgba(255, 255, 255, 0);
          transform: scale(1);
        }
      }

      .flux-highlight-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 0;
        height: 0;
        box-sizing: border-box;
        border: 2px solid var(--flux-highlight-color);
        border-radius: 8px;
        background: transparent;
          box-shadow:
            0 0 0 3px var(--flux-highlight-color-soft),
            0 12px 32px var(--flux-highlight-color-glow);
        animation: flux-highlight-pulse 1.35s ease-in-out infinite;
        will-change: transform, width, height, top, left, opacity;
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  private removeHighlightStyles(): void {
    document.getElementById(HIGHLIGHT_STYLE_ID)?.remove();
  }

  private startHighlightTracking(): void {
    if (this.highlightAnimationFrame !== null) {
      return;
    }

    window.addEventListener('scroll', this.boundHighlightReposition, true);
    window.addEventListener('resize', this.boundHighlightReposition);

    const tick = () => {
      if (this.activeHighlights.length === 0) {
        this.highlightAnimationFrame = null;
        return;
      }

      this.updateHighlightPositions();
      this.highlightAnimationFrame = window.requestAnimationFrame(tick);
    };

    this.highlightAnimationFrame = window.requestAnimationFrame(tick);
  }

  private stopHighlightTracking(): void {
    if (this.highlightAnimationFrame !== null) {
      window.cancelAnimationFrame(this.highlightAnimationFrame);
      this.highlightAnimationFrame = null;
    }

    window.removeEventListener('scroll', this.boundHighlightReposition, true);
    window.removeEventListener('resize', this.boundHighlightReposition);
  }

  private updateHighlightPositions(): void {
    for (const highlight of [...this.activeHighlights]) {
      this.updateSingleHighlightPosition(highlight);
    }
  }

  private updateSingleHighlightPosition(highlight: ActiveHighlight): void {
    if (!highlight.element.isConnected) {
      this.removeSingleHighlight(highlight.overlay);
      return;
    }

    const rect = highlight.element.getBoundingClientRect();
    const visible = rect.width > 0 && rect.height > 0;

    highlight.overlay.style.opacity = visible ? '1' : '0';
    highlight.overlay.style.top = `${rect.top}px`;
    highlight.overlay.style.left = `${rect.left}px`;
    highlight.overlay.style.width = `${rect.width}px`;
    highlight.overlay.style.height = `${rect.height}px`;
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
