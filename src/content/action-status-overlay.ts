import type { ActionResultPayload, Action, ElementSelector } from '@shared/types';

const ACTION_STATUS_OVERLAY_ATTR = 'data-flux-action-status';
const ACTION_STATUS_STYLE_ID = 'flux-action-status-styles';
const SUCCESS_HIDE_DELAY_MS = 1400;
const FAILURE_HIDE_DELAY_MS = 2600;

type ActionOverlayState = 'running' | 'success' | 'failure';

interface OverlayParts {
  root: HTMLDivElement;
  statusLabel: HTMLSpanElement;
  typeChip: HTMLSpanElement;
  title: HTMLParagraphElement;
  detail: HTMLParagraphElement;
  message: HTMLParagraphElement;
}

export class ActionStatusOverlay {
  private parts: OverlayParts | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  showRunning(action: Action): void {
    this.render({
      state: 'running',
      action,
      message: 'Executing on this page',
    });
  }

  showResult(action: Action, result: ActionResultPayload): void {
    if (result.success) {
      this.render({
        state: 'success',
        action,
        message: 'Completed successfully',
      });
      this.scheduleHide(SUCCESS_HIDE_DELAY_MS);
      return;
    }

    this.render({
      state: 'failure',
      action,
      message: result.error?.message ?? 'Action failed',
    });
    this.scheduleHide(FAILURE_HIDE_DELAY_MS);
  }

  showError(action: Action, error: unknown): void {
    const message = error instanceof Error ? error.message : 'Action failed unexpectedly';

    this.render({
      state: 'failure',
      action,
      message,
    });
    this.scheduleHide(FAILURE_HIDE_DELAY_MS);
  }

  destroy(): void {
    this.clearHideTimer();
    this.parts?.root.remove();
    this.parts = null;
    document.getElementById(ACTION_STATUS_STYLE_ID)?.remove();
  }

  private render(config: {
    state: ActionOverlayState;
    action: Action;
    message: string;
  }): void {
    this.clearHideTimer();
    const parts = this.ensureOverlay();
    const detail = getActionDetail(config.action);

    parts.root.dataset.state = config.state;
    parts.statusLabel.textContent = getStateLabel(config.state);
    parts.typeChip.textContent = humanizeActionType(config.action.type);
    parts.title.textContent = getActionLabel(config.action);
    parts.detail.textContent = detail ?? 'Current page action';
    parts.message.textContent = truncateText(config.message, 140);
    parts.detail.hidden = false;
    parts.message.hidden = false;
  }

  private scheduleHide(delayMs: number): void {
    this.clearHideTimer();
    this.hideTimer = window.setTimeout(() => {
      this.destroy();
    }, delayMs);
  }

  private clearHideTimer(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  private ensureOverlay(): OverlayParts {
    if (this.parts && this.parts.root.isConnected) {
      return this.parts;
    }

    this.ensureStyles();

    const root = document.createElement('div');
    root.setAttribute(ACTION_STATUS_OVERLAY_ATTR, 'true');
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    root.className = 'flux-action-status-card';
    root.style.pointerEvents = 'none';

    const header = document.createElement('div');
    header.className = 'flux-action-status-header';

    const statusGroup = document.createElement('div');
    statusGroup.className = 'flux-action-status-group';

    const statusDot = document.createElement('span');
    statusDot.className = 'flux-action-status-dot';
    statusDot.setAttribute('aria-hidden', 'true');

    const statusLabel = document.createElement('span');
    statusLabel.className = 'flux-action-status-label';

    const typeChip = document.createElement('span');
    typeChip.className = 'flux-action-status-chip';

    statusGroup.append(statusDot, statusLabel);
    header.append(statusGroup, typeChip);

    const title = document.createElement('p');
    title.className = 'flux-action-status-title';

    const detail = document.createElement('p');
    detail.className = 'flux-action-status-detail';

    const message = document.createElement('p');
    message.className = 'flux-action-status-message';

    root.append(header, title, detail, message);
    (document.body || document.documentElement).appendChild(root);

    this.parts = {
      root,
      statusLabel,
      typeChip,
      title,
      detail,
      message,
    };

    return this.parts;
  }

  private ensureStyles(): void {
    if (document.getElementById(ACTION_STATUS_STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = ACTION_STATUS_STYLE_ID;
    style.textContent = `
      @keyframes flux-action-status-spin {
        to {
          transform: rotate(360deg);
        }
      }

      .flux-action-status-card {
        position: fixed;
        top: 16px;
        right: 16px;
        width: min(320px, calc(100vw - 24px));
        box-sizing: border-box;
        padding: 14px 16px;
        border-radius: 16px;
        border: 1px solid rgba(15, 23, 42, 0.12);
        background: rgba(255, 255, 255, 0.96);
        color: #0f172a;
        box-shadow: 0 16px 40px rgba(15, 23, 42, 0.18);
        backdrop-filter: blur(10px);
        z-index: 2147483647;
        pointer-events: none;
        font-family: Inter, "Segoe UI", sans-serif;
        transition: opacity 160ms ease, transform 160ms ease;
      }

      .flux-action-status-card[data-state="running"] {
        border-color: rgba(37, 99, 235, 0.18);
      }

      .flux-action-status-card[data-state="success"] {
        border-color: rgba(22, 163, 74, 0.18);
      }

      .flux-action-status-card[data-state="failure"] {
        border-color: rgba(220, 38, 38, 0.18);
      }

      .flux-action-status-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .flux-action-status-group {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }

      .flux-action-status-dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: #2563eb;
        box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.12);
        flex: 0 0 auto;
      }

      .flux-action-status-card[data-state="running"] .flux-action-status-dot {
        background: transparent;
        border: 2px solid rgba(37, 99, 235, 0.25);
        border-top-color: #2563eb;
        box-shadow: none;
        animation: flux-action-status-spin 800ms linear infinite;
      }

      .flux-action-status-card[data-state="success"] .flux-action-status-dot {
        background: #16a34a;
        box-shadow: 0 0 0 4px rgba(22, 163, 74, 0.12);
      }

      .flux-action-status-card[data-state="failure"] .flux-action-status-dot {
        background: #dc2626;
        box-shadow: 0 0 0 4px rgba(220, 38, 38, 0.12);
      }

      .flux-action-status-label {
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.01em;
      }

      .flux-action-status-chip {
        flex: 0 0 auto;
        max-width: 42%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.06);
        padding: 4px 8px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .flux-action-status-title,
      .flux-action-status-detail,
      .flux-action-status-message {
        margin: 0;
      }

      .flux-action-status-title {
        margin-top: 10px;
        font-size: 14px;
        font-weight: 700;
        line-height: 1.35;
        letter-spacing: -0.01em;
      }

      .flux-action-status-detail {
        margin-top: 6px;
        font-size: 12px;
        line-height: 1.45;
        color: rgba(15, 23, 42, 0.72);
        word-break: break-word;
      }

      .flux-action-status-message {
        margin-top: 8px;
        font-size: 12px;
        line-height: 1.4;
        color: rgba(15, 23, 42, 0.82);
      }

      @media (max-width: 640px) {
        .flux-action-status-card {
          top: 12px;
          right: 12px;
          left: 12px;
          width: auto;
          padding: 12px 14px;
        }

        .flux-action-status-chip {
          max-width: 46%;
        }
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }
}

function getStateLabel(state: ActionOverlayState): string {
  switch (state) {
    case 'running':
      return 'Running';
    case 'success':
      return 'Success';
    case 'failure':
      return 'Failed';
  }
}

function getActionLabel(action: Action): string {
  if (action.description && action.description.trim().length > 0) {
    return truncateText(action.description.trim(), 80);
  }

  switch (action.type) {
    case 'click':
      return 'Click element';
    case 'doubleClick':
      return 'Double-click element';
    case 'rightClick':
      return 'Right-click element';
    case 'hover':
      return 'Hover target';
    case 'focus':
      return 'Focus target';
    case 'fill':
      return 'Fill field';
    case 'type':
      return 'Type text';
    case 'clear':
      return 'Clear field';
    case 'select':
      return 'Select option';
    case 'check':
      return 'Check input';
    case 'uncheck':
      return 'Uncheck input';
    case 'scroll':
      return 'Scroll page';
    case 'scrollIntoView':
      return 'Scroll target into view';
    case 'extract':
      return 'Extract value';
    case 'extractAll':
      return 'Extract multiple values';
    case 'screenshot':
      return 'Capture screenshot';
    case 'fullPageScreenshot':
      return 'Capture full page screenshot';
    case 'wait':
      return 'Wait';
    case 'waitForElement':
      return 'Wait for element';
    case 'waitForNavigation':
      return 'Wait for navigation';
    case 'waitForNetwork':
      return 'Wait for network state';
    default:
      return humanizeActionType(action.type);
  }
}

function getActionDetail(action: Action): string | null {
  switch (action.type) {
    case 'fill':
      return joinParts([
        formatSelector(action.selector),
        action.value ? `Value: ${truncateText(action.value, 36)}` : null,
      ]);
    case 'type':
      return joinParts([
        formatSelector(action.selector),
        action.text ? `Text: ${truncateText(action.text, 36)}` : null,
      ]);
    case 'select':
      return joinParts([
        formatSelector(action.selector),
        `Option: ${truncateText(formatSelectOption(action.option), 36)}`,
      ]);
    case 'scroll':
      return joinParts([
        `Direction: ${action.direction}`,
        typeof action.amount === 'number' ? `${action.amount}px` : null,
        action.selector ? formatSelector(action.selector) : null,
      ]);
    case 'wait':
      return `${action.duration}ms`;
    case 'waitForNavigation':
      return action.urlPattern ? `URL pattern: ${truncateText(action.urlPattern, 60)}` : 'Navigation change';
    case 'waitForNetwork':
      return `State: ${action.state}`;
    case 'extract':
      return joinParts([
        formatSelector(action.selector),
        action.attribute ? `Attribute: ${action.attribute}` : 'Attribute: textContent',
      ]);
    case 'extractAll':
      return joinParts([
        formatSelector(action.selector),
        typeof action.limit === 'number' ? `Limit: ${action.limit}` : null,
      ]);
    case 'screenshot':
      return action.selector ? formatSelector(action.selector) : 'Visible viewport';
    case 'fullPageScreenshot':
      return 'Entire page';
    default:
      if ('selector' in action && action.selector) {
        return formatSelector(action.selector);
      }
      return null;
  }
}

function formatSelector(selector: ElementSelector): string | null {
  if (!selector) {
    return null;
  }

  const entries: Array<[string, string | number | undefined]> = [
    ['css', selector.css],
    ['xpath', selector.xpath],
    ['text', selector.textExact ?? selector.text],
    ['aria', selector.ariaLabel],
    ['placeholder', selector.placeholder],
    ['testId', selector.testId],
    ['role', selector.role],
    ['near', selector.nearText],
    ['section', selector.withinSection],
  ];

  for (const [label, value] of entries) {
    if (typeof value === 'string' && value.trim().length > 0) {
      const suffix = typeof selector.nth === 'number' ? ` (index ${selector.nth})` : '';
      return `${label}: ${truncateText(value.trim(), 52)}${suffix}`;
    }
  }

  return typeof selector.nth === 'number' ? `index ${selector.nth}` : null;
}

function formatSelectOption(option: string | { value?: string; label?: string; index?: number }): string {
  if (typeof option === 'string') {
    return option;
  }

  if (option.label) {
    return option.label;
  }

  if (option.value) {
    return option.value;
  }

  if (typeof option.index === 'number') {
    return `index ${option.index}`;
  }

  return 'selection';
}

function humanizeActionType(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (character) => character.toUpperCase());
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function joinParts(parts: Array<string | null>): string | null {
  const filtered = parts.filter((part): part is string => Boolean(part));
  return filtered.length > 0 ? filtered.join(' • ') : null;
}
