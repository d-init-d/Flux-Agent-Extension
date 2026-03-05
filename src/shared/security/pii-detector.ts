/**
 * @module pii-detector
 * @description Personal Identifiable Information (PII) detection and redaction.
 * Identifies SSN, credit card numbers, email addresses, phone numbers,
 * IP addresses, and API keys in text. Provides confidence scoring and redaction.
 * All functions are pure with zero external dependencies.
 */

// ============================================================================
// Types
// ============================================================================

/** Supported PII types */
export type PIIType = 'SSN' | 'CREDIT_CARD' | 'EMAIL' | 'PHONE' | 'IP_ADDRESS' | 'API_KEY';

/** A single PII finding with location and confidence */
export interface PIIFinding {
  type: PIIType;
  value: string;
  start: number;
  end: number;
  confidence: number; // 0-1
}

/** Result of PII detection on a text string */
export interface PIIDetectionResult {
  hasPII: boolean;
  findings: PIIFinding[];
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate SSN area number.
 * Valid range: 001-899, excluding 666.
 */
function isValidSSNArea(area: number): boolean {
  return area >= 1 && area <= 899 && area !== 666;
}

/**
 * Luhn algorithm for credit card number validation.
 * @param digits - String of digits only (no separators).
 * @returns true if the digit sequence passes the Luhn check.
 */
function passesLuhnCheck(digits: string): boolean {
  let sum = 0;
  let alternate = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (isNaN(n)) return false;

    if (alternate) {
      n *= 2;
      if (n > 9) {
        n -= 9;
      }
    }
    sum += n;
    alternate = !alternate;
  }

  return sum > 0 && sum % 10 === 0;
}

// ============================================================================
// Pattern Definitions
// ============================================================================

interface PIIPatternDef {
  type: PIIType;
  regex: RegExp;
  validate?: (match: string) => boolean;
  baseConfidence: number;
  contextBoostWords: RegExp;
  contextBoostAmount: number;
}

const PII_PATTERNS: readonly PIIPatternDef[] = [
  // SSN: ###-##-#### with area/group/serial validation
  {
    type: 'SSN',
    regex: /\b(\d{3})-(\d{2})-(\d{4})\b/g,
    validate: (match: string): boolean => {
      const parts = match.split('-');
      const area = parseInt(parts[0], 10);
      const group = parseInt(parts[1], 10);
      const serial = parseInt(parts[2], 10);
      return isValidSSNArea(area) && group >= 1 && group <= 99 && serial >= 1 && serial <= 9999;
    },
    baseConfidence: 0.9,
    contextBoostWords: /ssn|social\s*security|tax\s*id/i,
    contextBoostAmount: 0.1,
  },

  // Credit Card: 13-19 digits, optionally separated by spaces or hyphens
  {
    type: 'CREDIT_CARD',
    regex: /\b(\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{1,7}|\d{13,19})\b/g,
    validate: (match: string): boolean => {
      const digits = match.replace(/[\s-]/g, '');
      if (digits.length < 13 || digits.length > 19) return false;
      return passesLuhnCheck(digits);
    },
    baseConfidence: 0.85,
    contextBoostWords: /card|credit|debit|visa|master|amex|payment/i,
    contextBoostAmount: 0.1,
  },

  // Email: RFC 5322 simplified
  {
    type: 'EMAIL',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    baseConfidence: 0.95,
    contextBoostWords: /email|e-mail|mail|contact/i,
    contextBoostAmount: 0.05,
  },

  // US Phone: various formats including +1, (xxx), xxx-xxxx, xxx.xxxx
  {
    type: 'PHONE',
    regex: /\b(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g,
    validate: (match: string): boolean => {
      const digits = match.replace(/[^\d]/g, '');
      return digits.length === 10 || (digits.length === 11 && digits[0] === '1');
    },
    baseConfidence: 0.7,
    contextBoostWords: /phone|call|tel|mobile|fax|contact|cell/i,
    contextBoostAmount: 0.15,
  },

  // IPv4 Address with range validation
  {
    type: 'IP_ADDRESS',
    regex: /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g,
    validate: (match: string): boolean => {
      const octets = match.split('.').map((o) => parseInt(o, 10));
      if (octets.some((o) => o < 0 || o > 255)) return false;
      const first = octets[0];
      // Skip loopback (127.x.x.x)
      if (first === 127) return false;
      // Skip link-local (169.254.x.x)
      if (first === 169 && octets[1] === 254) return false;
      // Skip broadcast (255.255.255.255)
      if (octets.every((o) => o === 255)) return false;
      // Skip unspecified (0.0.0.0)
      if (octets.every((o) => o === 0)) return false;
      return true;
    },
    baseConfidence: 0.6,
    contextBoostWords: /ip|address|server|host|client|network/i,
    contextBoostAmount: 0.2,
  },

  // API Keys: common prefixed patterns (sk-, pk-, key-, token-)
  {
    type: 'API_KEY',
    regex: /\b(?:sk-|pk-|key-|token-)[a-zA-Z0-9]{20,}\b/g,
    baseConfidence: 0.9,
    contextBoostWords: /api|key|secret|token|auth/i,
    contextBoostAmount: 0.1,
  },
];

// ============================================================================
// Detection
// ============================================================================

/** Context window size (characters) for confidence boosting */
const CONTEXT_WINDOW = 30;

/**
 * Detect PII in a text string.
 *
 * Scans for SSN, credit card numbers, email addresses, phone numbers,
 * IP addresses, and API keys. Each finding includes the type, matched value,
 * position, and confidence score (0-1).
 *
 * Confidence is boosted when surrounding text contains type-relevant keywords
 * (e.g., "SSN" near a ###-##-#### pattern).
 *
 * @param text - The text to scan for PII.
 * @returns Detection result with boolean flag and array of findings.
 */
export function detectPII(text: string): PIIDetectionResult {
  if (!text || typeof text !== 'string') {
    return { hasPII: false, findings: [] };
  }

  const findings: PIIFinding[] = [];

  for (const pattern of PII_PATTERNS) {
    // Create fresh regex to reset lastIndex for global patterns
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);

    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const value = match[0];

      // Run optional validation (e.g., Luhn for CC, area check for SSN)
      if (pattern.validate && !pattern.validate(value)) {
        continue;
      }

      // Calculate confidence: start from base, boost by surrounding context
      let confidence = pattern.baseConfidence;

      const contextStart = Math.max(0, match.index - CONTEXT_WINDOW);
      const contextEnd = Math.min(text.length, match.index + value.length + CONTEXT_WINDOW);
      const contextBefore = text.slice(contextStart, match.index).toLowerCase();
      const contextAfter = text.slice(match.index + value.length, contextEnd).toLowerCase();
      const context = contextBefore + ' ' + contextAfter;

      if (pattern.contextBoostWords.test(context)) {
        confidence = Math.min(1.0, confidence + pattern.contextBoostAmount);
      }

      findings.push({
        type: pattern.type,
        value,
        start: match.index,
        end: match.index + value.length,
        confidence,
      });
    }
  }

  // Sort findings by position in text
  findings.sort((a, b) => a.start - b.start);

  return {
    hasPII: findings.length > 0,
    findings,
  };
}

// ============================================================================
// Redaction
// ============================================================================

/** Redaction placeholder for each PII type */
const REDACTION_LABELS: Record<PIIType, string> = {
  SSN: '[REDACTED_SSN]',
  CREDIT_CARD: '[REDACTED_CC]',
  EMAIL: '[REDACTED_EMAIL]',
  PHONE: '[REDACTED_PHONE]',
  IP_ADDRESS: '[REDACTED_IP]',
  API_KEY: '[REDACTED_API_KEY]',
};

/**
 * Detect and replace all PII in a text string with redaction placeholders.
 *
 * Each PII type is replaced with a corresponding label such as
 * "[REDACTED_SSN]", "[REDACTED_CC]", "[REDACTED_EMAIL]", etc.
 *
 * Replacements are processed from end to start to preserve string positions.
 *
 * @param text - The text containing potential PII.
 * @returns The text with all detected PII replaced by redaction labels.
 */
export function redactPII(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  const result = detectPII(text);
  if (!result.hasPII) {
    return text;
  }

  // Process from end to start so earlier indices remain valid
  let redacted = text;
  const sortedFindings = [...result.findings].sort((a, b) => b.start - a.start);

  for (const finding of sortedFindings) {
    const label = REDACTION_LABELS[finding.type];
    redacted = redacted.slice(0, finding.start) + label + redacted.slice(finding.end);
  }

  return redacted;
}
