import type { Action, ParsedResponse } from '@shared/types';

/**
 * Command parser — transforms raw AI response text into structured actions.
 */
export interface ICommandParser {
  /** Parse AI response text into structured actions */
  parse(response: string): ParsedResponse;

  /** Validate an action before execution */
  validate(action: Action): ValidationResult;

  /** Sanitize potentially dangerous actions */
  sanitize(action: Action): Action;
}

/**
 * Result of action validation.
 */
export interface ValidationResult {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
}

/**
 * Parser configuration.
 */
export interface ParserConfig {
  strictMode: boolean; // Fail on any validation error
  allowEvaluate: boolean; // Allow custom JS execution
  allowedDomains?: string[]; // Whitelist for navigation
  blockedSelectors?: string[]; // Dangerous selectors to block
}
