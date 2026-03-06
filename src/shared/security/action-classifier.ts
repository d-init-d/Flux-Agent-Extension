/**
 * @module action-classifier
 * @description Classifies browser automation actions by sensitivity level.
 * Determines whether an action is safe, requires user confirmation, or
 * should be blocked entirely. Used to enforce security policies before
 * executing AI-generated browser commands.
 * All functions are pure with zero external dependencies beyond local types.
 */

import type { Action, ActionType } from '../types/actions';

// ============================================================================
// Types
// ============================================================================

/**
 * Sensitivity levels for browser actions.
 *
 * - safe:     Read-only or passive actions (no confirmation needed)
 * - low:      Minor interactions (click, navigate to known-safe URLs)
 * - medium:   Input/form actions (fill, type, select, tab management)
 * - high:     Sensitive operations (password fields, unknown URLs, evaluate)
 * - critical: Dangerous operations (DOM manipulation, network interception)
 * - blocked:  Actions that must never execute (chrome://, extension APIs)
 */
export type SensitivityLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical' | 'blocked';

/** Result of classifying an action */
export interface ClassificationResult {
  level: SensitivityLevel;
  reason: string;
  requiresConfirmation: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/** Base sensitivity for each action type (without context analysis) */
const BASE_SENSITIVITY: Record<ActionType, SensitivityLevel> = {
  // SAFE: read-only / passive
  extract: 'safe',
  extractAll: 'safe',
  screenshot: 'safe',
  fullPageScreenshot: 'safe',
  scroll: 'safe',
  scrollIntoView: 'safe',
  wait: 'safe',
  waitForElement: 'safe',
  waitForNavigation: 'safe',
  waitForNetwork: 'safe',
  hover: 'safe',
  goBack: 'safe',
  goForward: 'safe',
  reload: 'safe',

  // LOW: minor interactions
  click: 'low',
  doubleClick: 'low',
  rightClick: 'low',
  focus: 'low',
  navigate: 'low',
  press: 'low',
  hotkey: 'low',

  // MEDIUM: input / tab management
  fill: 'medium',
  type: 'medium',
  clear: 'medium',
  select: 'medium',
  check: 'medium',
  uncheck: 'medium',
  newTab: 'medium',
  closeTab: 'medium',
  switchTab: 'medium',

  // HIGH: advanced / code execution
  evaluate: 'high',

  // CRITICAL: network interception
  interceptNetwork: 'critical',
  mockResponse: 'critical',
};

/** URL schemes that are always blocked */
const BLOCKED_URL_SCHEMES = ['chrome://', 'chrome-extension://', 'javascript:', 'file://'] as const;

/** Localhost patterns considered safe for navigation */
const SAFE_NAVIGATE_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?(\/|$)/i,
  /^https?:\/\/127\.0\.0\.1(:\d+)?(\/|$)/i,
  /^https?:\/\/\[::1\](:\d+)?(\/|$)/i,
] as const;

/**
 * Dangerous DOM manipulation patterns in evaluate scripts.
 * These elevate an evaluate action to CRITICAL.
 */
const CRITICAL_SCRIPT_PATTERNS = [
  /document\.write\s*\(/i,
  /\.innerHTML\s*=/i,
  /\.outerHTML\s*=/i,
  /\.insertAdjacentHTML\s*\(/i,
  /createElement\s*\(\s*['"]script['"]\s*\)/i,
] as const;

/**
 * Patterns in evaluate scripts that cause the action to be BLOCKED.
 */
const BLOCKED_SCRIPT_PATTERNS = [
  /\bchrome\s*\.\s*\w+/i,
  /\bwindow\s*\.\s*chrome\s*\.\s*\w+/i,
] as const;

const DESTRUCTIVE_INTENT_PATTERNS = [
  /\bdelete\b/i,
  /\bremove\b/i,
  /\bdestroy\b/i,
  /\berase\b/i,
  /\btruncate\b/i,
  /\bwipe\b/i,
  /\bdeactivate\b/i,
  /\bcancel\s+subscription\b/i,
  /\bclose\s+account\b/i,
  /\btransfer\b/i,
  /\bwire\b/i,
  /\bpay\b/i,
  /\bpurchase\b/i,
  /\bplace\s+order\b/i,
  /\bcheckout\b/i,
  /\bsubmit\s+payment\b/i,
  /\bconfirm\b/i,
] as const;

// ============================================================================
// Private Helpers
// ============================================================================

/**
 * Check if a selector targets a password field.
 */
function isPasswordField(action: Action): boolean {
  if (!('selector' in action) || !action.selector) return false;

  const sel = action.selector;

  // Check CSS selector for password indicators
  if (sel.css) {
    const lower = sel.css.toLowerCase();
    if (
      lower.includes('type="password"') ||
      lower.includes("type='password'") ||
      lower.includes('[type=password]') ||
      lower.includes('input[type="password"]') ||
      lower.includes("input[type='password']")
    ) {
      return true;
    }
  }

  // Check placeholder for password indicators
  if (sel.placeholder) {
    const lower = sel.placeholder.toLowerCase();
    if (lower.includes('password') || lower.includes('passcode') || lower.includes('pin')) {
      return true;
    }
  }

  // Check aria-label
  if (sel.ariaLabel) {
    const lower = sel.ariaLabel.toLowerCase();
    if (lower.includes('password')) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a selector references blocked internal URLs or extensions.
 */
function hasBlockedSelector(action: Action): boolean {
  if (!('selector' in action) || !action.selector) return false;

  const sel = action.selector;

  const fieldsToCheck: (string | undefined)[] = [
    sel.css,
    sel.xpath,
    sel.text,
    sel.textExact,
    sel.ariaLabel,
    sel.nearText,
    sel.withinSection,
  ];

  for (const field of fieldsToCheck) {
    if (!field) continue;
    const lower = field.toLowerCase();
    if (lower.includes('chrome://') || lower.includes('chrome-extension://')) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a URL should be blocked.
 */
function isBlockedUrl(url: string): boolean {
  const lower = url.toLowerCase().trim();
  for (const scheme of BLOCKED_URL_SCHEMES) {
    if (lower.startsWith(scheme)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a URL matches a safe/known pattern (localhost).
 */
function isSafeNavigateUrl(url: string): boolean {
  for (const pattern of SAFE_NAVIGATE_PATTERNS) {
    if (pattern.test(url)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if an evaluate script contains critical DOM manipulation patterns.
 */
function hasCriticalScript(script: string): boolean {
  for (const pattern of CRITICAL_SCRIPT_PATTERNS) {
    if (pattern.test(script)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if an evaluate script accesses blocked APIs (chrome.*).
 */
function hasDangerousScript(script: string): boolean {
  for (const pattern of BLOCKED_SCRIPT_PATTERNS) {
    if (pattern.test(script)) {
      return true;
    }
  }
  return false;
}

function hasDestructiveIntent(action: Action): boolean {
  const probeValues: string[] = [];

  if ('selector' in action && action.selector) {
    const selector = action.selector;
    const selectorValues: Array<string | undefined> = [
      selector.css,
      selector.xpath,
      selector.text,
      selector.textExact,
      selector.ariaLabel,
      selector.placeholder,
      selector.nearText,
      selector.withinSection,
    ];

    for (const value of selectorValues) {
      if (typeof value === 'string' && value.trim().length > 0) {
        probeValues.push(value);
      }
    }
  }

  if ('value' in action) {
    const value = action.value;
    if (typeof value === 'string' && value.trim().length > 0) {
      probeValues.push(value);
    }
  }

  if ('keys' in action && Array.isArray(action.keys)) {
    probeValues.push(action.keys.join('+'));
  }

  for (const candidate of probeValues) {
    for (const pattern of DESTRUCTIVE_INTENT_PATTERNS) {
      if (pattern.test(candidate)) {
        return true;
      }
    }
  }

  return false;
}

// ============================================================================
// Main Classifier
// ============================================================================

/**
 * Classify a browser action by sensitivity level.
 *
 * Analyzes the action type and its parameters (URL targets, selectors,
 * script content) to determine the appropriate sensitivity level.
 *
 * @param action - The action to classify.
 * @returns Classification result with level, reason, and confirmation requirement.
 */
export function classifyAction(action: Action): ClassificationResult {
  // Check for blocked selectors first (applies to any action with a selector)
  if (hasBlockedSelector(action)) {
    return {
      level: 'blocked',
      reason: 'Action targets a blocked internal URL (chrome:// or chrome-extension://)',
      requiresConfirmation: true,
    };
  }

  // Type-specific classification with context analysis
  switch (action.type) {
    case 'navigate': {
      const url = action.url || '';
      if (isBlockedUrl(url)) {
        const schemePart = url.indexOf(':') >= 0 ? url.substring(0, url.indexOf(':') + 1) : 'unknown:';
        return {
          level: 'blocked',
          reason: 'Navigation to blocked URL scheme: ' + schemePart,
          requiresConfirmation: true,
        };
      }
      if (isSafeNavigateUrl(url)) {
        return {
          level: 'low',
          reason: 'Navigation to known safe URL (localhost)',
          requiresConfirmation: false,
        };
      }
      return {
        level: 'high',
        reason: 'Navigation to unknown external URL',
        requiresConfirmation: true,
      };
    }

    case 'fill':
    case 'type': {
      if (hasDestructiveIntent(action)) {
        return {
          level: 'high',
          reason: 'Input action contains destructive or financial intent',
          requiresConfirmation: true,
        };
      }

      if (isPasswordField(action)) {
        return {
          level: 'high',
          reason: 'Input action targeting a password field',
          requiresConfirmation: true,
        };
      }
      return {
        level: 'medium',
        reason: 'Form input action',
        requiresConfirmation: false,
      };
    }

    case 'click':
    case 'doubleClick':
    case 'rightClick':
    case 'focus':
    case 'press':
    case 'hotkey':
    case 'select':
    case 'check':
    case 'uncheck': {
      if (hasDestructiveIntent(action)) {
        return {
          level: 'high',
          reason: 'Interaction action contains destructive or financial intent',
          requiresConfirmation: true,
        };
      }

      const base = BASE_SENSITIVITY[action.type];
      return {
        level: base,
        reason: 'Default classification for action type: ' + action.type,
        requiresConfirmation: requiresConfirmation(base),
      };
    }

    case 'evaluate': {
      const script = action.script || '';

      if (hasDangerousScript(script)) {
        return {
          level: 'blocked',
          reason: 'Evaluate script accesses chrome.* APIs',
          requiresConfirmation: true,
        };
      }

      if (hasCriticalScript(script)) {
        return {
          level: 'critical',
          reason: 'Evaluate script contains dangerous DOM manipulation',
          requiresConfirmation: true,
        };
      }

      return {
        level: 'high',
        reason: 'Custom JavaScript evaluation',
        requiresConfirmation: true,
      };
    }

    default: {
      const base = BASE_SENSITIVITY[action.type];
      return {
        level: base,
        reason: 'Default classification for action type: ' + action.type,
        requiresConfirmation: requiresConfirmation(base),
      };
    }
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Determine whether a sensitivity level requires user confirmation.
 *
 * @param level - The sensitivity level to check.
 * @returns true for 'high', 'critical', and 'blocked' levels.
 */
export function requiresConfirmation(level: SensitivityLevel): boolean {
  return level === 'high' || level === 'critical' || level === 'blocked';
}

/**
 * Get the base sensitivity level for an action type without context analysis.
 *
 * This returns the default sensitivity before examining URLs, selectors,
 * or script content. Useful for quick filtering or UI display.
 *
 * @param actionType - The action type to look up.
 * @returns The base sensitivity level.
 */
export function getActionSensitivity(actionType: ActionType): SensitivityLevel {
  return BASE_SENSITIVITY[actionType];
}
