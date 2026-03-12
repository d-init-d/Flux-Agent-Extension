import { ErrorCode, ExtensionError } from '@shared/errors';
import { classifyAction, sanitizeScript, sanitizeSelector, validateUrl } from '@shared/security';
import type { Action, ElementSelector } from '@shared/types';
import type { ParserConfig } from './interfaces';

type SelectorStringField =
  | 'css'
  | 'xpath'
  | 'text'
  | 'textExact'
  | 'ariaLabel'
  | 'placeholder'
  | 'testId'
  | 'role'
  | 'nearText'
  | 'withinSection';

const SELECTOR_STRING_FIELDS: SelectorStringField[] = [
  'css',
  'xpath',
  'text',
  'textExact',
  'ariaLabel',
  'placeholder',
  'testId',
  'role',
  'nearText',
  'withinSection',
];

export interface ParserSanitizerConfig {
  strictMode: ParserConfig['strictMode'];
  allowEvaluate: ParserConfig['allowEvaluate'];
  allowedDomains?: ParserConfig['allowedDomains'];
  blockedSelectors?: ParserConfig['blockedSelectors'];
}

export function sanitizeCommandAction(action: Action, config: ParserSanitizerConfig): Action {
  const cloned = structuredClone(action);

  if (typeof cloned.description === 'string') {
    cloned.description = cloned.description.trim();
  }

  sanitizeUrls(cloned, config);
  sanitizeActionSelectors(cloned, config);
  sanitizeEvaluate(cloned, config);
  enforceClassificationPolicy(cloned, config);

  return cloned;
}

function sanitizeUrls(action: Action, config: ParserSanitizerConfig): void {
  if (action.type !== 'navigate' && action.type !== 'newTab') {
    return;
  }

  const rawUrl = action.url;
  if (typeof rawUrl !== 'string') {
    return;
  }

  const result = validateUrl(rawUrl);

  if (!result.valid) {
    const message = result.errors[0] ?? 'Invalid URL provided';
    const isBlocked = result.risk === 'blocked';

    throw new ExtensionError(
      isBlocked ? ErrorCode.ACTION_BLOCKED : ErrorCode.ACTION_INVALID,
      message,
      true,
      { actionType: action.type, url: rawUrl, errors: result.errors },
    );
  }

  if (config.strictMode && result.risk === 'warning') {
    throw new ExtensionError(
      ErrorCode.ACTION_INVALID,
      result.warnings[0] ?? 'URL rejected in strict mode',
      true,
      { actionType: action.type, url: rawUrl, warnings: result.warnings },
    );
  }

  if (config.allowedDomains && config.allowedDomains.length > 0) {
    enforceAllowedDomain(result.normalized, config.allowedDomains);
  }

  action.url = result.normalized;
}

function enforceAllowedDomain(url: string, allowedDomains: string[]): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ExtensionError(ErrorCode.ACTION_INVALID, 'Invalid URL provided: ' + url, true);
  }

  const hostname = parsed.hostname.toLowerCase();
  const isAllowed = allowedDomains.some((domain) => {
    const normalizedDomain = domain.trim().toLowerCase();
    if (!normalizedDomain) {
      return false;
    }
    return hostname === normalizedDomain || hostname.endsWith('.' + normalizedDomain);
  });

  if (!isAllowed) {
    throw new ExtensionError(
      ErrorCode.ACTION_BLOCKED,
      'Domain is not in allowed list: ' + hostname,
      true,
      { url, allowedDomains },
    );
  }
}

function sanitizeActionSelectors(action: Action, config: ParserSanitizerConfig): void {
  if (!('selector' in action) || !action.selector) {
    return;
  }

  const selector = action.selector as ElementSelector;
  const blockedPatterns = (config.blockedSelectors ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map((value) => value.toLowerCase());

  for (const key of SELECTOR_STRING_FIELDS) {
    const value = selector[key];
    if (typeof value !== 'string') {
      continue;
    }

    const sanitized = sanitizeWithSelectorGuard(value, key);
    enforceBlockedSelectorList(sanitized, blockedPatterns, key);
    selector[key] = sanitized;
  }
}

function sanitizeWithSelectorGuard(value: string, field: SelectorStringField): string {
  try {
    return sanitizeSelector(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid selector';
    throw new ExtensionError(
      ErrorCode.ACTION_INVALID,
      'Invalid selector in ' + String(field) + ': ' + message,
      true,
      { selectorField: field, selector: value },
    );
  }
}

function enforceBlockedSelectorList(
  selector: string,
  blockedPatterns: string[],
  field: SelectorStringField,
): void {
  if (blockedPatterns.length === 0) {
    return;
  }

  const normalized = selector.toLowerCase();
  const matchedPattern = blockedPatterns.find((pattern) => normalized.includes(pattern));
  if (!matchedPattern) {
    return;
  }

  throw new ExtensionError(
    ErrorCode.ACTION_BLOCKED,
    'Selector blocked by parser configuration (' + String(field) + ')',
    true,
    { selectorField: field, selector, blockedPattern: matchedPattern },
  );
}

function sanitizeEvaluate(action: Action, config: ParserSanitizerConfig): void {
  if (action.type !== 'evaluate') {
    return;
  }

  if (!config.allowEvaluate) {
    throw new ExtensionError(
      ErrorCode.ACTION_BLOCKED,
      'Evaluate action is disabled by parser config',
      true,
    );
  }

  try {
    action.script = sanitizeScript(action.script);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid evaluate script';
    throw new ExtensionError(ErrorCode.ACTION_BLOCKED, message, true, { script: action.script });
  }
}

function enforceClassificationPolicy(action: Action, config: ParserSanitizerConfig): void {
  const classification = classifyAction(action);

  if (classification.level === 'blocked') {
    throw new ExtensionError(ErrorCode.ACTION_BLOCKED, classification.reason, true, {
      actionType: action.type,
      classification,
    });
  }

  if (config.strictMode && classification.requiresConfirmation) {
    throw new ExtensionError(
      ErrorCode.ACTION_BLOCKED,
      'Action requires explicit user confirmation: ' + classification.reason,
      true,
      { actionType: action.type, classification, requiresConfirmation: true },
    );
  }
}
