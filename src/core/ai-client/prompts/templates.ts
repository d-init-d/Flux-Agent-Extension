/**
 * @module ai-client/prompts/templates
 * @description Context injection templates for enriching AI requests.
 *
 * These templates inject runtime context (page state, session history,
 * element info, error context) into user messages so the AI has the
 * information it needs to generate accurate actions.
 *
 * Design: Templates are pure functions that take structured data and return
 * formatted strings. No side effects, no I/O.
 */

import type { ActionType, ElementSelector } from '@shared/types';

// ---------------------------------------------------------------------------
// Types for template inputs
// ---------------------------------------------------------------------------

/** Page context injected before the user's message. */
export interface PageContext {
  /** Current page URL. */
  url: string;
  /** Page title. */
  title: string;
  /** Simplified DOM summary (e.g., interactive elements list). */
  domSummary?: string;
  /** Visible text excerpt (truncated). */
  visibleText?: string;
  /** Active/focused element description. */
  focusedElement?: string;
  /** Page dimensions. */
  viewport?: { width: number; height: number };
  /** Number of iframes on the page. */
  iframeCount?: number;
}

/** Result of a previously executed action. */
export interface ActionResult {
  /** Action type that was executed. */
  type: ActionType;
  /** Whether it succeeded. */
  success: boolean;
  /** Description of what happened. */
  description: string;
  /** Error message if failed. */
  error?: string;
  /** Extracted data (for extract/screenshot actions). */
  data?: string;
  /** Duration in ms. */
  durationMs?: number;
}

/** Session history for multi-turn context. */
export interface SessionContext {
  /** Session ID. */
  sessionId: string;
  /** How many turns have elapsed. */
  turnCount: number;
  /** Actions executed in this session so far. */
  recentActions: ActionResult[];
  /** High-level goal (if stated by user). */
  goal?: string;
}

/** Error context for retry/recovery prompts. */
export interface ErrorContext {
  /** The action that failed. */
  failedAction: {
    type: ActionType;
    params: Record<string, unknown>;
    description?: string;
  };
  /** Error message. */
  errorMessage: string;
  /** Number of retry attempts so far. */
  retryCount: number;
  /** Suggestions from the system (e.g., "element not found, try different selector"). */
  suggestions?: string[];
}

// ---------------------------------------------------------------------------
// Template Functions
// ---------------------------------------------------------------------------

/**
 * Inject current page context before the user's message.
 *
 * This gives the AI awareness of the current page state so it can
 * generate accurate selectors and appropriate actions.
 */
export function buildPageContextBlock(context: PageContext): string {
  const lines: string[] = [
    '## Current Page State',
    `- **URL**: ${context.url}`,
    `- **Title**: ${context.title}`,
  ];

  if (context.viewport) {
    lines.push(`- **Viewport**: ${context.viewport.width}×${context.viewport.height}`);
  }

  if (context.focusedElement) {
    lines.push(`- **Focused Element**: ${context.focusedElement}`);
  }

  if (context.iframeCount !== undefined && context.iframeCount > 0) {
    lines.push(`- **Iframes**: ${context.iframeCount}`);
  }

  if (context.domSummary) {
    lines.push('', '### Interactive Elements', context.domSummary);
  }

  if (context.visibleText) {
    const truncated =
      context.visibleText.length > 2000
        ? context.visibleText.slice(0, 2000) + '\n... (truncated)'
        : context.visibleText;
    lines.push('', '### Visible Text', truncated);
  }

  return lines.join('\n');
}

/**
 * Build session context block showing recent action history.
 *
 * This enables the AI to understand what has already been done in the
 * current session and avoid repeating actions or making contradictory ones.
 */
export function buildSessionContextBlock(session: SessionContext): string {
  const lines: string[] = [
    '## Session Context',
    `- **Session**: ${session.sessionId}`,
    `- **Turn**: ${session.turnCount}`,
  ];

  if (session.goal) {
    lines.push(`- **Goal**: ${session.goal}`);
  }

  if (session.recentActions.length > 0) {
    lines.push('', '### Recent Actions');

    // Show last 10 actions to keep context manageable
    const recent = session.recentActions.slice(-10);
    for (const action of recent) {
      const status = action.success ? '✓' : '✗';
      const duration = action.durationMs !== undefined ? ` (${action.durationMs}ms)` : '';
      const errorSuffix = action.error ? ` — Error: ${action.error}` : '';
      lines.push(`${status} \`${action.type}\`: ${action.description}${duration}${errorSuffix}`);

      if (action.data) {
        const truncatedData =
          action.data.length > 200 ? action.data.slice(0, 200) + '...' : action.data;
        lines.push(`  → Data: ${truncatedData}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Build error recovery prompt when an action fails.
 *
 * Gives the AI enough context to suggest an alternative approach,
 * a different selector, or to ask the user for help.
 */
export function buildErrorRecoveryBlock(error: ErrorContext): string {
  const lines: string[] = [
    '## Action Failed — Recovery Needed',
    '',
    `The following action failed after ${error.retryCount} attempt(s):`,
    '',
    '```json',
    JSON.stringify(error.failedAction, null, 2),
    '```',
    '',
    `**Error**: ${error.errorMessage}`,
  ];

  if (error.suggestions && error.suggestions.length > 0) {
    lines.push('', '**System Suggestions**:');
    for (const suggestion of error.suggestions) {
      lines.push(`- ${suggestion}`);
    }
  }

  lines.push(
    '',
    'Please analyze the failure and respond with:',
    '1. An alternative approach (different selector, different action sequence), OR',
    '2. A request for more information from the user if the page state is unclear',
  );

  return lines.join('\n');
}

/**
 * Build a user message that combines the user's raw input with
 * injected context blocks.
 *
 * @param userMessage - The user's original message text
 * @param pageContext - Current page state (optional)
 * @param sessionContext - Session history (optional)
 * @param errorContext - Error recovery context (optional)
 * @returns Combined message string
 */
export function buildEnrichedUserMessage(
  userMessage: string,
  pageContext?: PageContext,
  sessionContext?: SessionContext,
  errorContext?: ErrorContext,
): string {
  const blocks: string[] = [];

  if (sessionContext) {
    blocks.push(buildSessionContextBlock(sessionContext));
  }

  if (pageContext) {
    blocks.push(buildPageContextBlock(pageContext));
  }

  if (errorContext) {
    blocks.push(buildErrorRecoveryBlock(errorContext));
  }

  // User's message comes last
  blocks.push(`## User Request\n${userMessage}`);

  return blocks.join('\n\n---\n\n');
}

/**
 * Build a follow-up prompt for multi-step task continuation.
 *
 * Used when the AI returns partial actions and the extension needs
 * to ask it to continue with updated context.
 */
export function buildContinuationPrompt(
  completedActions: ActionResult[],
  remainingGoal: string,
  pageContext: PageContext,
): string {
  const actionSummary = completedActions
    .map((a) => {
      const status = a.success ? '✓' : '✗';
      return `${status} ${a.type}: ${a.description}`;
    })
    .join('\n');

  return [
    '## Continuation — Previous Actions Completed',
    '',
    actionSummary,
    '',
    buildPageContextBlock(pageContext),
    '',
    `## Remaining Goal`,
    remainingGoal,
    '',
    'Generate the next set of actions to continue toward the goal.',
  ].join('\n');
}

/**
 * Build a confirmation prompt for high-sensitivity actions.
 *
 * When the AI generates actions classified as HIGH or CRITICAL sensitivity,
 * the extension shows this to the user for explicit confirmation.
 */
export function buildConfirmationPrompt(
  actions: Array<{ type: ActionType; description: string; sensitivityLevel: string }>,
): string {
  const lines: string[] = [
    '## Confirmation Required',
    '',
    'The following actions require your explicit approval before execution:',
    '',
  ];

  for (const action of actions) {
    lines.push(`- **${action.type}** [${action.sensitivityLevel}]: ${action.description}`);
  }

  lines.push('', 'Reply "yes" or "confirm" to proceed, or describe what changes you\'d like.');

  return lines.join('\n');
}

/**
 * Build a focused prompt for extracting table data from the current page.
 *
 * Used by the sidepanel slash command flow as a ready-to-edit extraction prompt
 * without changing the message payload contract.
 */
export function buildExtractTableDataPrompt(): string {
  return [
    'Extract the most relevant table data from the current page.',
    'Return a structured result with:',
    '- selected table name or context if clear',
    '- original headers, units, and important text kept exactly as shown',
    '- rows as structured data',
    'Choose the single best matching table.',
    'Do not invent or fill missing values.',
    'If no table is present, say clearly: No table found.',
  ].join('\n');
}

/**
 * Format an element selector for human-readable display.
 */
export function formatSelector(selector: ElementSelector): string {
  const parts: string[] = [];

  if (selector.testId) parts.push(`[data-testid="${selector.testId}"]`);
  if (selector.ariaLabel) parts.push(`[aria-label="${selector.ariaLabel}"]`);
  if (selector.role) parts.push(`[role="${selector.role}"]`);
  if (selector.css) parts.push(selector.css);
  if (selector.xpath) parts.push(`xpath: ${selector.xpath}`);
  if (selector.text) parts.push(`text≈"${selector.text}"`);
  if (selector.textExact) parts.push(`text="${selector.textExact}"`);
  if (selector.placeholder) parts.push(`[placeholder="${selector.placeholder}"]`);
  if (selector.nearText) parts.push(`near "${selector.nearText}"`);
  if (selector.nth !== undefined) parts.push(`[${selector.nth}]`);

  return parts.join(' ') || '(empty selector)';
}
