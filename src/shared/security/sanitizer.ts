/**
 * @module sanitizer
 * @description Input sanitization utilities for HTML, CSS selectors, and scripts.
 * All functions are pure with zero external dependencies.
 */

// ============================================================================
// HTML Sanitization
// ============================================================================

/**
 * Strip all HTML tags from input, escape special characters, and normalize whitespace.
 *
 * - Removes ALL HTML tags (including self-closing, malformed, nested)
 * - Escapes HTML entities: & < > " '
 * - Removes null bytes
 * - Collapses multiple whitespace into single space
 * - Trims leading/trailing whitespace
 *
 * @param input - Raw string that may contain HTML.
 * @returns Sanitized plain-text string.
 */
export function sanitizeHtml(input: string): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  let result = input;

  // Remove null bytes
  result = result.replace(/\0/g, '');

  // Strip all HTML tags (including self-closing, malformed, comments)
  // Handle HTML comments first
  result = result.replace(/<!--[\s\S]*?-->/g, '');
  // Handle CDATA sections
  result = result.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  // Handle all tags (greedy on tag name, lazy on content)
  result = result.replace(/<\/?[a-zA-Z][^>]*\/?>/g, '');
  // Handle any remaining angle-bracket patterns that look like tags
  result = result.replace(/<[^>]*>/g, '');

  // Escape HTML entities (order matters: & must be first)
  result = result.replace(/&/g, '&amp;');
  result = result.replace(/</g, '&lt;');
  result = result.replace(/>/g, '&gt;');
  result = result.replace(/"/g, '&quot;');
  result = result.replace(/'/g, '&#x27;');

  // Collapse multiple whitespace into single space
  result = result.replace(/\s+/g, ' ');

  return result.trim();
}

// ============================================================================
// CSS Selector Sanitization
// ============================================================================

/** Patterns that are blocked in CSS selectors */
const BLOCKED_SELECTOR_PATTERNS: ReadonlyArray<{ pattern: RegExp; name: string }> = [
  { pattern: /javascript\s*:/i, name: 'javascript: protocol' },
  { pattern: /\bon\w+\s*=/i, name: 'event handler attribute' },
  { pattern: /expression\s*\(/i, name: 'CSS expression()' },
  { pattern: /url\s*\(/i, name: 'CSS url()' },
  { pattern: /chrome-extension:\/\//i, name: 'chrome-extension:// reference' },
  { pattern: /-moz-binding/i, name: '-moz-binding CSS property' },
  { pattern: /behavior\s*:/i, name: 'behavior: CSS property (IE)' },
  { pattern: /@import/i, name: '@import rule' },
];

/**
 * Validate and sanitize a CSS selector string.
 *
 * Blocks dangerous patterns including:
 * - javascript: protocol (any casing/whitespace variant)
 * - Event handlers (onclick, onload, onerror, etc.)
 * - CSS expression() and url() functions
 * - chrome-extension:// references
 * - -moz-binding
 *
 * @param selector - CSS selector string to validate.
 * @returns The trimmed selector if valid.
 * @throws {Error} If a blocked pattern is detected, with a message naming the pattern.
 */
export function sanitizeSelector(selector: string): string {
  if (!selector || typeof selector !== 'string') {
    throw new Error('Selector must be a non-empty string');
  }

  const trimmed = selector.trim();

  if (trimmed.length === 0) {
    throw new Error('Selector must be a non-empty string');
  }

  for (const { pattern, name } of BLOCKED_SELECTOR_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw new Error(`Blocked pattern detected in selector: ${name}`);
    }
  }

  return trimmed;
}

// ============================================================================
// Script Sanitization
// ============================================================================

/** Patterns that are blocked in scripts */
const BLOCKED_SCRIPT_PATTERNS: ReadonlyArray<{ pattern: RegExp; name: string }> = [
  // Code execution
  { pattern: /\beval\s*\(/i, name: 'eval()' },
  { pattern: /\bFunction\s*\(/i, name: 'Function() constructor' },
  { pattern: /\bnew\s+Function\s*\(/i, name: 'new Function()' },

  // Data exfiltration
  { pattern: /\bdocument\s*\.\s*cookie/i, name: 'document.cookie access' },
  { pattern: /\blocalStorage/i, name: 'localStorage access' },
  { pattern: /\bsessionStorage/i, name: 'sessionStorage access' },

  // Network access
  { pattern: /\bfetch\s*\(/i, name: 'fetch() call' },
  { pattern: /\bXMLHttpRequest/i, name: 'XMLHttpRequest' },

  // Chrome extension APIs
  { pattern: /\bchrome\s*\.\s*\w+/i, name: 'chrome.* API access' },

  // Window escape
  { pattern: /\bwindow\s*\.\s*opener/i, name: 'window.opener access' },
  { pattern: /\bwindow\s*\.\s*parent/i, name: 'window.parent access' },
  { pattern: /\bwindow\s*\.\s*top\b/i, name: 'window.top access' },

  // Worker/module loading
  { pattern: /\bimportScripts\s*\(/i, name: 'importScripts()' },

  // Prototype pollution
  { pattern: /__proto__/i, name: '__proto__ access' },
  { pattern: /\bprototype\s*\[/i, name: 'prototype[] bracket access' },
  {
    pattern: /constructor\s*\[\s*['"]prototype['"]\s*\]/i,
    name: 'constructor.prototype manipulation',
  },
];

/**
 * Validate a JavaScript snippet against a blocklist of dangerous patterns.
 *
 * Blocks patterns including:
 * - eval(), Function(), new Function()
 * - document.cookie, localStorage, sessionStorage
 * - fetch(), XMLHttpRequest
 * - chrome.* API access
 * - window.opener, window.parent, window.top
 * - importScripts
 * - __proto__ and prototype pollution
 *
 * @param script - JavaScript code string to validate.
 * @returns The trimmed script if valid.
 * @throws {Error} If a blocked pattern is detected, with a message naming the pattern.
 */
export function sanitizeScript(script: string): string {
  if (!script || typeof script !== 'string') {
    throw new Error('Script must be a non-empty string');
  }

  const trimmed = script.trim();

  if (trimmed.length === 0) {
    throw new Error('Script must be a non-empty string');
  }

  for (const { pattern, name } of BLOCKED_SCRIPT_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw new Error(`Blocked pattern detected in script: ${name}`);
    }
  }

  return trimmed;
}

// ============================================================================
// Regex Escaping
// ============================================================================

/**
 * Escape all regex special characters in a string so it can be used
 * safely inside a RegExp constructor.
 *
 * Escapes: \ ^ $ . * + ? ( ) [ ] { } |
 *
 * @param string - The string to escape.
 * @returns The escaped string safe for use in RegExp.
 */
export function escapeRegExp(string: string): string {
  if (!string || typeof string !== 'string') {
    return '';
  }
  return string.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}
