/**
 * @module security
 * @description Security primitives for the Flux Agent Extension.
 * Provides input sanitization, URL validation, PII detection, and action classification.
 */

// Sanitization
export { sanitizeHtml, sanitizeSelector, sanitizeScript, escapeRegExp } from './sanitizer';

// URL Validation
export { validateUrl, isSafeUrl } from './url-validator';
export type { UrlRiskLevel, UrlValidationResult, UrlValidatorOptions } from './url-validator';

// PII Detection
export { detectPII, redactPII } from './pii-detector';
export type { PIIType, PIIFinding, PIIDetectionResult } from './pii-detector';

// Action Classification
export { classifyAction, requiresConfirmation, getActionSensitivity } from './action-classifier';
export type { SensitivityLevel, ClassificationResult } from './action-classifier';
