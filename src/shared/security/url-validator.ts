/**
 * @module url-validator
 * @description URL validation and risk assessment for browser automation.
 * Blocks dangerous schemes, internal URLs, and known attack patterns.
 * All functions are pure with zero external dependencies.
 */

// ============================================================================
// Types
// ============================================================================

/** Risk level assigned to a URL after validation */
export type UrlRiskLevel = 'safe' | 'warning' | 'blocked';

/** Full result of URL validation including normalization and diagnostics */
export interface UrlValidationResult {
  valid: boolean;
  normalized: string;
  errors: string[];
  warnings: string[];
  risk: UrlRiskLevel;
}

/** Options to customize URL validation behavior */
export interface UrlValidatorOptions {
  allowIpAddresses?: boolean;
  allowHttp?: boolean;
  allowDataImages?: boolean;
  allowBlob?: boolean;
  customBlockedDomains?: string[];
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_OPTIONS: Required<UrlValidatorOptions> = {
  allowIpAddresses: false,
  allowHttp: true,
  allowDataImages: true,
  allowBlob: false,
  customBlockedDomains: [],
};

const BLOCKED_SCHEMES = ['javascript:', 'vbscript:'] as const;

const BLOCKED_INTERNAL_SCHEMES = [
  'chrome://',
  'chrome-extension://',
  'file://',
] as const;

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

const HOMOGLYPH_PATTERN = /[\u0430\u0435\u043E\u0440\u0441\u0443\u0445\u04BB\u0456\u0458\u04CF\u0501]/;

// ============================================================================
// Helpers
// ============================================================================

function startsWithCI(str: string, prefix: string): boolean {
  return str.toLowerCase().startsWith(prefix.toLowerCase());
}

function isIPv4(hostname: string): boolean {
  const match = IPV4_PATTERN.exec(hostname);
  if (!match) return false;
  return match.slice(1).every((octet) => {
    const n = parseInt(octet, 10);
    return n >= 0 && n <= 255;
  });
}

function isLocalhost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower === 'localhost' || lower === '127.0.0.1' || lower === '[::1]';
}

// ============================================================================
// Main Validator
// ============================================================================

/**
 * Validate a URL for safety in browser automation context.
 *
 * Checks blocked schemes, internal URLs, IP addresses, HTTP, homoglyphs,
 * excessive subdomains, and custom blocked domains.
 *
 * @param url     - The URL string to validate.
 * @param options - Optional configuration overrides.
 * @returns A detailed validation result with risk assessment.
 */
export function validateUrl(
  url: string,
  options?: UrlValidatorOptions,
): UrlValidationResult {
  const opts: Required<UrlValidatorOptions> = { ...DEFAULT_OPTIONS, ...options };
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!url || typeof url !== 'string' || url.trim().length === 0) {
    return { valid: false, normalized: '', errors: ['URL is empty'], warnings: [], risk: 'blocked' };
  }

  const trimmed = url.trim();

  // --- Blocked schemes ---
  for (const scheme of BLOCKED_SCHEMES) {
    if (startsWithCI(trimmed, scheme)) {
      return {
        valid: false,
        normalized: trimmed,
        errors: ['Blocked scheme: ' + scheme],
        warnings: [],
        risk: 'blocked',
      };
    }
  }

  // --- data: scheme ---
  if (startsWithCI(trimmed, 'data:')) {
    if (opts.allowDataImages && startsWithCI(trimmed, 'data:image/')) {
      warnings.push('data: URL allowed (image type)');
      return { valid: true, normalized: trimmed, errors: [], warnings, risk: 'warning' };
    }
    return {
      valid: false,
      normalized: trimmed,
      errors: ['Blocked scheme: data: (non-image or not allowed)'],
      warnings: [],
      risk: 'blocked',
    };
  }

  // --- blob: scheme ---
  if (startsWithCI(trimmed, 'blob:')) {
    if (opts.allowBlob) {
      warnings.push('blob: URL allowed by configuration');
      return { valid: true, normalized: trimmed, errors: [], warnings, risk: 'warning' };
    }
    return {
      valid: false,
      normalized: trimmed,
      errors: ['Blocked scheme: blob:'],
      warnings: [],
      risk: 'blocked',
    };
  }

  // --- Blocked internal schemes ---
  for (const scheme of BLOCKED_INTERNAL_SCHEMES) {
    if (startsWithCI(trimmed, scheme)) {
      return {
        valid: false,
        normalized: trimmed,
        errors: ['Blocked internal scheme: ' + scheme],
        warnings,
        risk: 'blocked',
      };
    }
  }

  // --- about: scheme ---
  if (startsWithCI(trimmed, 'about:')) {
    if (trimmed.toLowerCase() === 'about:blank') {
      warnings.push('about:blank is generally safe but unusual');
      return { valid: true, normalized: trimmed, errors: [], warnings, risk: 'warning' };
    }
    return {
      valid: false,
      normalized: trimmed,
      errors: ['Blocked internal scheme: about:'],
      warnings: [],
      risk: 'blocked',
    };
  }

  // --- Normalize: prepend https:// if no scheme ---
  let normalized = trimmed;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(normalized)) {
    normalized = 'https://' + normalized;
  }

  // --- Parse URL ---
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return {
      valid: false,
      normalized,
      errors: ['Invalid URL format'],
      warnings: [],
      risk: 'blocked',
    };
  }

  // --- IP address check ---
  if (isIPv4(parsed.hostname) && !isLocalhost(parsed.hostname)) {
    if (!opts.allowIpAddresses) {
      warnings.push('URL uses an IP address instead of a domain name');
    }
  }

  // --- HTTP check ---
  if (parsed.protocol === 'http:' && !isLocalhost(parsed.hostname)) {
    if (!opts.allowHttp) {
      errors.push('HTTP is not allowed -- use HTTPS');
      return { valid: false, normalized, errors, warnings, risk: 'blocked' };
    }
    warnings.push('URL uses insecure HTTP protocol');
  }

  // --- Homoglyph detection ---
  if (HOMOGLYPH_PATTERN.test(parsed.hostname)) {
    warnings.push('Hostname contains characters resembling Latin letters (possible homoglyph/IDN attack)');
  }

  // --- Excessive subdomains ---
  const dotCount = (parsed.hostname.match(/\./g) || []).length;
  if (dotCount > 4) {
    warnings.push('Hostname has excessive subdomains (possible phishing)');
  }

  // --- IP-like segments in subdomain ---
  const hostParts = parsed.hostname.split('.');
  if (hostParts.length > 2) {
    const subdomains = hostParts.slice(0, -2);
    for (const sub of subdomains) {
      if (/^\d{1,3}-\d{1,3}-\d{1,3}-\d{1,3}$/.test(sub)) {
        warnings.push('Subdomain contains IP-like segment (possible phishing)');
        break;
      }
    }
  }

  // --- Custom blocked domains ---
  if (opts.customBlockedDomains.length > 0) {
    const hostname = parsed.hostname.toLowerCase();
    for (const blocked of opts.customBlockedDomains) {
      if (hostname === blocked.toLowerCase() || hostname.endsWith('.' + blocked.toLowerCase())) {
        return {
          valid: false,
          normalized,
          errors: ['Domain is blocked: ' + blocked],
          warnings,
          risk: 'blocked',
        };
      }
    }
  }

  // --- Determine risk ---
  let risk: UrlRiskLevel = 'safe';
  if (errors.length > 0) {
    risk = 'blocked';
  } else if (warnings.length > 0) {
    risk = 'warning';
  }

  return {
    valid: errors.length === 0,
    normalized,
    errors,
    warnings,
    risk,
  };
}

// ============================================================================
// Convenience
// ============================================================================

/**
 * Quick check whether a URL is safe to navigate to.
 *
 * @param url     - The URL string to check.
 * @param options - Optional validation overrides.
 * @returns `true` when the URL passes all checks; `false` otherwise.
 */
export function isSafeUrl(
  url: string,
  options?: UrlValidatorOptions,
): boolean {
  return validateUrl(url, options).valid;
}
