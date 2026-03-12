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
import { generateId, Logger } from '@shared/utils';
import { SelectorEngine } from './dom/selector-engine';
import type { DOMInspector } from './dom/inspector';
import type { AutoWaitEngine } from './dom/auto-wait-engine';
import type { ActionStatusOverlay } from './action-status-overlay';
import type {
  ExecuteActionPayload,
  ActionResultPayload,
  FillAction,
  GetPageContextPayload,
  PageContextPayload,
  HighlightPayload,
  SetRecordingStatePayload,
  RecordedClickPayload,
  RecordedInputPayload,
  RecordedNavigationPayload,
  ClickAction,
  HoverAction,
  FocusAction,
  TypeAction,
  ClearAction,
  UploadFileAction,
  SelectAction,
  CheckAction,
  ScrollAction,
  ScrollIntoViewAction,
  ExtractAction,
  ExtractAllAction,
  ScreenshotAction,
  WaitAction,
  WaitForElementAction,
  WaitForNavigationAction,
  WaitForNetworkAction,
  SerializedFileUpload,
  ElementSelector,
  NavigateAction,
} from '@shared/types';

type InteractionActionModule = typeof import('./actions/interaction');
type InputActionModule = typeof import('./actions/input');
type ScrollActionModule = typeof import('./actions/scroll');
type ExtractActionModule = typeof import('./actions/extract');
type WaitActionModule = typeof import('./actions/wait');
type InteractionExecutionAction = ClickAction | HoverAction | FocusAction;
type InputExecutionAction =
  | FillAction
  | TypeAction
  | ClearAction
  | UploadFileAction
  | SelectAction
  | CheckAction;
type ScrollExecutionAction = ScrollAction | ScrollIntoViewAction;
type ExtractExecutionAction = ExtractAction | ExtractAllAction | ScreenshotAction;
type WaitExecutionAction =
  | WaitAction
  | WaitForElementAction
  | WaitForNavigationAction
  | WaitForNetworkAction;

// ============================================================================
// Double-injection guard
// ============================================================================

declare global {
  interface Window {
    __FLUX_AGENT_CS_INITIALIZED__?: boolean;
  }
}

if (window.__FLUX_AGENT_CS_INITIALIZED__) {
  new Logger('ContentScript').warn('Content script already injected — skipping re-initialization');
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
const RECORDED_INPUT_DEBOUNCE_MS = 600;
const NAVIGATION_ACTIVITY_EVENT_NAME = '__flux_navigation_activity__';
const RECORDABLE_CLICK_SELECTOR = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  'label',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[data-testid]',
  '[aria-label]',
].join(', ');
const RECORDABLE_TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'number']);
const SENSITIVE_INPUT_AUTOCOMPLETE_TOKENS = new Set([
  'current-password',
  'new-password',
  'one-time-code',
]);
const SENSITIVE_INPUT_HINT_PATTERN =
  /\b(?:password|passcode|otp|one[\s_-]*time[\s_-]*code|token|secret|api[\s_-]*key)\b/i;

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
  private domInspector: DOMInspector | null = null;
  private domInspectorPromise: Promise<DOMInspector> | null = null;
  private autoWaitEngine: AutoWaitEngine | null = null;
  private autoWaitEnginePromise: Promise<AutoWaitEngine> | null = null;
  private actionStatusOverlay: ActionStatusOverlay | null = null;
  private actionStatusOverlayPromise: Promise<ActionStatusOverlay | null> | null = null;
  private interactionActionModulePromise: Promise<InteractionActionModule> | null = null;
  private inputActionModulePromise: Promise<InputActionModule> | null = null;
  private scrollActionModulePromise: Promise<ScrollActionModule> | null = null;
  private extractActionModulePromise: Promise<ExtractActionModule> | null = null;
  private waitActionModulePromise: Promise<WaitActionModule> | null = null;
  private mutationObserver: MutationObserver | null = null;
  private activeHighlights: ActiveHighlight[] = [];
  private highlightAnimationFrame: number | null = null;
  private readonly boundHighlightReposition = () => {
    this.updateHighlightPositions();
  };
  private latestActionRunId = 0;
  private isDestroyed = false;

  private mutationDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingMutationAdded = 0;
  private pendingMutationRemoved = 0;

  private unloadHandler: (() => void) | null = null;
  private commandUnsubscribers: (() => void)[] = [];
  private recordingActive = false;
  private readonly pendingRecordedInputTimers = new Map<
    HTMLElement,
    ReturnType<typeof setTimeout>
  >();
  private readonly lastRecordedInputValues = new Map<HTMLElement, string>();
  private readonly boundClickCapture = (event: MouseEvent) => {
    this.handleRecordedClick(event);
  };
  private readonly boundInputCapture = (event: Event) => {
    this.handleRecordedInputEvent(event);
  };
  private readonly boundInputCommitCapture = (event: Event) => {
    this.commitRecordedInputEvent(event);
  };
  private readonly boundNavigationActivityCapture = (event: Event) => {
    this.handleRecordedNavigationEvent(event);
  };

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
    this.isDestroyed = false;
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
    this.isDestroyed = true;

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
    this.actionStatusOverlay?.destroy();
    this.actionStatusOverlay = null;

    // Remove beforeunload listener
    if (this.unloadHandler !== null) {
      window.removeEventListener('beforeunload', this.unloadHandler);
      this.unloadHandler = null;
    }

    if (this.recordingActive) {
      this.teardownRecordingListeners();
    }

    this.autoWaitEngine?.destroy();
    this.autoWaitEngine = null;

    this.bridge.destroy();
    this.logger.info('ContentScriptManager destroyed');
  }

  // --------------------------------------------------------------------------
  // Command Registration
  // --------------------------------------------------------------------------

  private registerCommandHandlers(): void {
    this.commandUnsubscribers.push(
      this.bridge.onCommand<ExecuteActionPayload>('EXECUTE_ACTION', (payload) =>
        this.handleExecuteAction(payload),
      ),
    );

    this.commandUnsubscribers.push(
      this.bridge.onCommand<GetPageContextPayload | undefined>('GET_PAGE_CONTEXT', (payload) =>
        this.handleGetPageContext(payload),
      ),
    );

    this.commandUnsubscribers.push(
      this.bridge.onCommand<HighlightPayload>('HIGHLIGHT_ELEMENT', (payload) =>
        this.handleHighlightElement(payload),
      ),
    );

    this.commandUnsubscribers.push(
      this.bridge.onCommand<undefined>('CLEAR_HIGHLIGHTS', () => this.handleClearHighlights()),
    );

    this.commandUnsubscribers.push(
      this.bridge.onCommand<SetRecordingStatePayload>('SET_RECORDING_STATE', (payload) =>
        this.handleSetRecordingState(payload),
      ),
    );
  }

  // --------------------------------------------------------------------------
  // EXECUTE_ACTION (C-15: interaction actions)
  // --------------------------------------------------------------------------

  private async handleExecuteAction(payload: ExecuteActionPayload): Promise<ActionResultPayload> {
    const { action } = payload;
    this.logger.debug('EXECUTE_ACTION received', { actionType: action.type });

    const actionRunId = ++this.latestActionRunId;
    const showFloatingBar = await this.shouldShowFloatingBar();

    if (showFloatingBar && !this.isDestroyed) {
      await this.showActionRunning(action);
    } else if (!showFloatingBar) {
      this.destroyActionStatusOverlay();
    }

    try {
      const result = await this.executeAction(payload);

      if (this.shouldUpdateActionOverlay(actionRunId, showFloatingBar)) {
        await this.showActionResult(action, result);
      }

      return result;
    } catch (error) {
      if (this.shouldUpdateActionOverlay(actionRunId, showFloatingBar)) {
        await this.showActionError(action, error);
      }

      throw error;
    }
  }

  private shouldUpdateActionOverlay(actionRunId: number, showFloatingBar: boolean): boolean {
    return showFloatingBar && !this.isDestroyed && this.latestActionRunId === actionRunId;
  }

  private async executeAction(payload: ExecuteActionPayload): Promise<ActionResultPayload> {
    const { action } = payload;

    switch (action.type) {
      case 'click':
      case 'doubleClick':
      case 'rightClick':
      case 'hover':
      case 'focus':
        return this.executeInteractionAction(action);
      case 'fill':
      case 'type':
      case 'clear':
      case 'uploadFile':
      case 'select':
      case 'check':
      case 'uncheck':
        return this.executeInputAction(action, payload.context.uploads ?? []);
      case 'scroll':
      case 'scrollIntoView':
        return this.executeScrollAction(action);
      case 'extract':
      case 'extractAll':
      case 'screenshot':
      case 'fullPageScreenshot':
        return this.executeExtractAction(action);
      case 'wait':
      case 'waitForElement':
      case 'waitForNavigation':
      case 'waitForNetwork':
        return this.executeWaitAction(action);
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

  private async shouldShowFloatingBar(): Promise<boolean> {
    if (typeof chrome === 'undefined' || !chrome.storage?.local?.get) {
      return true;
    }

    try {
      const stored = await chrome.storage.local.get({
        settings: { showFloatingBar: true },
      });

      const settings = stored.settings as { showFloatingBar?: boolean } | undefined;
      return settings?.showFloatingBar !== false;
    } catch (error) {
      this.logger.warn('Failed to read floating bar setting, defaulting to enabled', error);
      return true;
    }
  }

  // --------------------------------------------------------------------------
  // GET_PAGE_CONTEXT (Full implementation)
  // --------------------------------------------------------------------------

  private async handleGetPageContext(
    _payload?: GetPageContextPayload,
  ): Promise<PageContextPayload> {
    this.logger.debug('GET_PAGE_CONTEXT received');
    const domInspector = await this.getDOMInspector();
    return { context: domInspector.buildPageContext() };
  }

  private async executeInteractionAction(
    action: InteractionExecutionAction,
  ): Promise<ActionResultPayload> {
    const { executeInteractionAction } = await this.loadInteractionActionModule();
    return executeInteractionAction(action, this.selectorEngine);
  }

  private async executeInputAction(
    action: InputExecutionAction,
    uploads: SerializedFileUpload[],
  ): Promise<ActionResultPayload> {
    const { executeInputAction } = await this.loadInputActionModule();
    return executeInputAction(action, this.selectorEngine, uploads);
  }

  private async executeScrollAction(action: ScrollExecutionAction): Promise<ActionResultPayload> {
    const { executeScrollAction } = await this.loadScrollActionModule();
    return executeScrollAction(action, this.selectorEngine);
  }

  private async executeExtractAction(action: ExtractExecutionAction): Promise<ActionResultPayload> {
    const { executeExtractAction } = await this.loadExtractActionModule();
    return executeExtractAction(action, this.selectorEngine);
  }

  private async executeWaitAction(action: WaitExecutionAction): Promise<ActionResultPayload> {
    const [{ executeWaitAction }, autoWaitEngine] = await Promise.all([
      this.loadWaitActionModule(),
      this.getAutoWaitEngine(),
    ]);
    return executeWaitAction(action, autoWaitEngine);
  }

  private async showActionRunning(action: ExecuteActionPayload['action']): Promise<void> {
    const actionStatusOverlay = await this.getActionStatusOverlay();
    actionStatusOverlay?.showRunning(action);
  }

  private async showActionResult(
    action: ExecuteActionPayload['action'],
    result: ActionResultPayload,
  ): Promise<void> {
    const actionStatusOverlay = await this.getActionStatusOverlay();
    actionStatusOverlay?.showResult(action, result);
  }

  private async showActionError(
    action: ExecuteActionPayload['action'],
    error: unknown,
  ): Promise<void> {
    const actionStatusOverlay = await this.getActionStatusOverlay();
    actionStatusOverlay?.showError(action, error);
  }

  private async getDOMInspector(): Promise<DOMInspector> {
    if (this.domInspector) {
      return this.domInspector;
    }

    if (!this.domInspectorPromise) {
      this.domInspectorPromise = import('./dom/inspector').then(({ DOMInspector }) => {
        const domInspector = new DOMInspector(this.logger);
        this.domInspector = domInspector;
        return domInspector;
      });
    }

    return this.domInspectorPromise;
  }

  private async getAutoWaitEngine(): Promise<AutoWaitEngine> {
    if (this.autoWaitEngine) {
      return this.autoWaitEngine;
    }

    if (!this.autoWaitEnginePromise) {
      this.autoWaitEnginePromise = import('./dom/auto-wait-engine').then(({ AutoWaitEngine }) => {
        const autoWaitEngine = new AutoWaitEngine(this.selectorEngine);
        if (this.isDestroyed) {
          autoWaitEngine.destroy();
        } else {
          this.autoWaitEngine = autoWaitEngine;
        }
        return autoWaitEngine;
      });
    }

    return this.autoWaitEnginePromise;
  }

  private async getActionStatusOverlay(): Promise<ActionStatusOverlay | null> {
    if (this.isDestroyed) {
      return null;
    }

    if (this.actionStatusOverlay) {
      return this.actionStatusOverlay;
    }

    if (!this.actionStatusOverlayPromise) {
      this.actionStatusOverlayPromise = import('./action-status-overlay').then(
        ({ ActionStatusOverlay }) => {
          const actionStatusOverlay = new ActionStatusOverlay();
          if (this.isDestroyed) {
            actionStatusOverlay.destroy();
            return null;
          }

          this.actionStatusOverlay = actionStatusOverlay;
          return actionStatusOverlay;
        },
      );
    }

    return this.actionStatusOverlayPromise;
  }

  private destroyActionStatusOverlay(): void {
    this.actionStatusOverlay?.destroy();
    this.actionStatusOverlay = null;
  }

  private loadInteractionActionModule(): Promise<InteractionActionModule> {
    if (!this.interactionActionModulePromise) {
      this.interactionActionModulePromise = import('./actions/interaction');
    }

    return this.interactionActionModulePromise;
  }

  private loadInputActionModule(): Promise<InputActionModule> {
    if (!this.inputActionModulePromise) {
      this.inputActionModulePromise = import('./actions/input');
    }

    return this.inputActionModulePromise;
  }

  private loadScrollActionModule(): Promise<ScrollActionModule> {
    if (!this.scrollActionModulePromise) {
      this.scrollActionModulePromise = import('./actions/scroll');
    }

    return this.scrollActionModulePromise;
  }

  private loadExtractActionModule(): Promise<ExtractActionModule> {
    if (!this.extractActionModulePromise) {
      this.extractActionModulePromise = import('./actions/extract');
    }

    return this.extractActionModulePromise;
  }

  private loadWaitActionModule(): Promise<WaitActionModule> {
    if (!this.waitActionModulePromise) {
      this.waitActionModulePromise = import('./actions/wait');
    }

    return this.waitActionModulePromise;
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

  private async handleSetRecordingState(
    payload: SetRecordingStatePayload,
  ): Promise<{ active: boolean }> {
    const active = payload.active === true;
    if (active === this.recordingActive) {
      return { active };
    }

    this.recordingActive = active;

    if (active) {
      this.setupRecordingListeners();
    } else {
      this.teardownRecordingListeners();
    }

    this.logger.debug('Recording state updated', { active });
    return { active };
  }

  private handleRecordedClick(event: MouseEvent): void {
    if (!this.recordingActive || !event.isTrusted) {
      return;
    }

    const action = this.buildRecordedClickAction(event);
    if (!action) {
      return;
    }

    this.bridge.emit('RECORDED_CLICK', { action } satisfies RecordedClickPayload);
  }

  private handleRecordedInputEvent(event: Event): void {
    if (!this.recordingActive || !event.isTrusted) {
      return;
    }

    const target = this.resolveRecordedInputTarget(event);
    if (!target) {
      return;
    }

    const existingTimer = this.pendingRecordedInputTimers.get(target);
    if (existingTimer !== undefined) {
      clearTimeout(existingTimer);
    }

    const timeoutId = window.setTimeout(() => {
      this.pendingRecordedInputTimers.delete(target);
      this.emitRecordedInputAction(target);
    }, RECORDED_INPUT_DEBOUNCE_MS);

    this.pendingRecordedInputTimers.set(target, timeoutId);
  }

  private commitRecordedInputEvent(event: Event): void {
    if (!this.recordingActive || !event.isTrusted) {
      return;
    }

    const target = this.resolveRecordedInputTarget(event);
    if (!target) {
      return;
    }

    const existingTimer = this.pendingRecordedInputTimers.get(target);
    if (existingTimer !== undefined) {
      clearTimeout(existingTimer);
      this.pendingRecordedInputTimers.delete(target);
    }

    this.emitRecordedInputAction(target);
  }

  private emitRecordedInputAction(target: HTMLElement): void {
    const action = this.buildRecordedInputAction(target);
    if (!action) {
      return;
    }

    const currentValue = this.getRecordableInputValue(target);
    if (currentValue === null || this.lastRecordedInputValues.get(target) === currentValue) {
      return;
    }

    this.lastRecordedInputValues.set(target, currentValue);
    this.bridge.emit('RECORDED_INPUT', { action } satisfies RecordedInputPayload);
  }

  private buildRecordedClickAction(event: MouseEvent): ClickAction | null {
    const element = this.resolveRecordedClickElement(event);
    if (!element) {
      return null;
    }

    const selector = this.buildRecordedSelector(element);
    if (!selector) {
      return null;
    }

    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    return {
      id: `recorded-click-${generateId(10)}`,
      type: 'click',
      selector,
      position: {
        x: Math.round(event.clientX - centerX),
        y: Math.round(event.clientY - centerY),
      },
    };
  }

  private resolveRecordedClickElement(event: MouseEvent): HTMLElement | null {
    for (const candidate of event.composedPath()) {
      if (!(candidate instanceof Element)) {
        continue;
      }

      const resolved = candidate.closest(RECORDABLE_CLICK_SELECTOR) ?? candidate;
      if (resolved instanceof HTMLElement) {
        return resolved;
      }
    }

    return event.target instanceof HTMLElement ? event.target : null;
  }

  private resolveRecordedInputTarget(event: Event): HTMLElement | null {
    for (const candidate of event.composedPath()) {
      if (!(candidate instanceof HTMLElement)) {
        continue;
      }

      if (this.isRecordableInputTarget(candidate)) {
        return candidate;
      }
    }

    return event.target instanceof HTMLElement && this.isRecordableInputTarget(event.target)
      ? event.target
      : null;
  }

  private isRecordableInputTarget(element: HTMLElement): boolean {
    if (element instanceof HTMLTextAreaElement) {
      return (
        !element.disabled && !element.readOnly && !this.isSensitiveRecordedInputTarget(element)
      );
    }

    if (element instanceof HTMLInputElement) {
      const type = (element.type || 'text').toLowerCase();
      return (
        !element.disabled &&
        !element.readOnly &&
        RECORDABLE_TEXT_INPUT_TYPES.has(type) &&
        !this.isSensitiveRecordedInputTarget(element)
      );
    }

    return element.isContentEditable && !this.isSensitiveRecordedInputTarget(element);
  }

  private isSensitiveRecordedInputTarget(element: HTMLElement): boolean {
    if (element instanceof HTMLInputElement && element.type.toLowerCase() === 'password') {
      return true;
    }

    const autocomplete = element.getAttribute('autocomplete');
    if (autocomplete) {
      const autocompleteTokens = autocomplete
        .toLowerCase()
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 0);

      if (autocompleteTokens.some((token) => SENSITIVE_INPUT_AUTOCOMPLETE_TOKENS.has(token))) {
        return true;
      }
    }

    const hintCandidates = [
      element.getAttribute('name'),
      element.getAttribute('id'),
      element.getAttribute('aria-label'),
      element.getAttribute('placeholder'),
    ];

    return hintCandidates.some(
      (candidate) => typeof candidate === 'string' && SENSITIVE_INPUT_HINT_PATTERN.test(candidate),
    );
  }

  private buildRecordedInputAction(target: HTMLElement): FillAction | null {
    if (!this.isRecordableInputTarget(target)) {
      return null;
    }

    const selector = this.buildRecordedSelector(target);
    const value = this.getRecordableInputValue(target);
    if (!selector || value === null) {
      return null;
    }

    return {
      id: `recorded-input-${generateId(10)}`,
      type: 'fill',
      selector,
      value,
    };
  }

  private getRecordableInputValue(target: HTMLElement): string | null {
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return target.value ?? '';
    }

    if (target.isContentEditable) {
      return target.textContent ?? '';
    }

    return null;
  }

  private setupRecordingListeners(): void {
    document.addEventListener('click', this.boundClickCapture, true);
    document.addEventListener('input', this.boundInputCapture, true);
    document.addEventListener('change', this.boundInputCommitCapture, true);
    document.addEventListener('blur', this.boundInputCommitCapture, true);
    window.addEventListener(NAVIGATION_ACTIVITY_EVENT_NAME, this.boundNavigationActivityCapture);
  }

  private teardownRecordingListeners(): void {
    document.removeEventListener('click', this.boundClickCapture, true);
    document.removeEventListener('input', this.boundInputCapture, true);
    document.removeEventListener('change', this.boundInputCommitCapture, true);
    document.removeEventListener('blur', this.boundInputCommitCapture, true);
    window.removeEventListener(NAVIGATION_ACTIVITY_EVENT_NAME, this.boundNavigationActivityCapture);

    this.flushPendingRecordedInputs();

    for (const timer of this.pendingRecordedInputTimers.values()) {
      clearTimeout(timer);
    }

    this.pendingRecordedInputTimers.clear();
    this.lastRecordedInputValues.clear();
    this.recordingActive = false;
  }

  private handleRecordedNavigationEvent(_event: Event): void {
    if (!this.recordingActive || window.top !== window) {
      return;
    }

    const action = this.buildRecordedNavigationAction();
    if (!action) {
      return;
    }

    this.bridge.emit('RECORDED_NAVIGATION', { action } satisfies RecordedNavigationPayload);
  }

  private buildRecordedNavigationAction(): NavigateAction | null {
    const url = this.extractRecordedNavigationUrl();
    if (!url) {
      return null;
    }

    return {
      id: `recorded-navigation-${generateId(10)}`,
      type: 'navigate',
      url,
    };
  }

  private extractRecordedNavigationUrl(): string | null {
    return location.href || null;
  }

  private flushPendingRecordedInputs(): void {
    const pendingTargets = Array.from(this.pendingRecordedInputTimers.keys());
    for (const target of pendingTargets) {
      const timer = this.pendingRecordedInputTimers.get(target);
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      this.pendingRecordedInputTimers.delete(target);
      this.emitRecordedInputAction(target);
    }
  }

  private buildRecordedSelector(element: HTMLElement): ElementSelector | null {
    const testId = element.getAttribute('data-testid')?.trim();
    if (testId) {
      const selector = { testId } satisfies ElementSelector;
      if (this.isUniqueRecordedSelector(selector, element)) {
        return selector;
      }
    }

    const id = element.id.trim();
    if (id) {
      const selector = { css: `#${CSS.escape(id)}` } satisfies ElementSelector;
      if (this.isUniqueRecordedSelector(selector, element)) {
        return selector;
      }
    }

    const ariaLabel = element.getAttribute('aria-label')?.trim();
    if (ariaLabel) {
      const selector = { ariaLabel } satisfies ElementSelector;
      if (this.isUniqueRecordedSelector(selector, element)) {
        return selector;
      }
    }

    const placeholder = element.getAttribute('placeholder')?.trim();
    if (placeholder) {
      const selector = { placeholder } satisfies ElementSelector;
      if (this.isUniqueRecordedSelector(selector, element)) {
        return selector;
      }
    }

    const textExact = this.getRecordedElementText(element);
    if (textExact) {
      const selector = { textExact } satisfies ElementSelector;
      if (this.isUniqueRecordedSelector(selector, element)) {
        return selector;
      }
    }

    const css = this.buildCssPath(element);
    return css ? { css } : null;
  }

  private isUniqueRecordedSelector(selector: ElementSelector, element: HTMLElement): boolean {
    const matches = this.selectorEngine.findElements(selector);
    return matches.length === 1 && matches[0] === element;
  }

  private getRecordedElementText(element: HTMLElement): string | null {
    const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text.length === 0 || text.length > 120) {
      return null;
    }

    return text;
  }

  private buildCssPath(element: HTMLElement): string | null {
    const segments: string[] = [];
    let current: HTMLElement | null = element;

    while (current && current !== document.body && segments.length < 6) {
      const tag = current.tagName.toLowerCase();
      if (!tag) {
        break;
      }

      const className = this.getStableClassName(current);
      const segmentBase = className ? `${tag}.${className}` : tag;
      const parent: HTMLElement | null = current.parentElement;
      const currentTagName = current.tagName;

      if (!parent) {
        segments.unshift(segmentBase);
        break;
      }

      const siblings = Array.from(parent.children).filter(
        (candidate: Element) => candidate.tagName === currentTagName,
      );
      const siblingIndex = siblings.indexOf(current) + 1;
      segments.unshift(
        siblings.length > 1 ? `${segmentBase}:nth-of-type(${siblingIndex})` : segmentBase,
      );

      const selector = segments.join(' > ');
      try {
        if (document.querySelectorAll(selector).length === 1) {
          return selector;
        }
      } catch {
        break;
      }

      current = parent;
    }

    return segments.length > 0 ? segments.join(' > ') : null;
  }

  private getStableClassName(element: HTMLElement): string | null {
    for (const token of Array.from(element.classList)) {
      const trimmed = token.trim();
      if (!trimmed || /(^ng-|^ember-|^css-|^jsx-|^react-)|\d{4,}/i.test(trimmed)) {
        continue;
      }

      return CSS.escape(trimmed);
    }

    return null;
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
      /* overlay already removed */
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
