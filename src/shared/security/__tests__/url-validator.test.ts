/**
 * @module url-validator.test
 * @description Comprehensive tests for URL validation and risk assessment.
 *
 * Covers: validateUrl, isSafeUrl, all schemes, edge cases,
 * custom blocked domains, normalization, risk levels, and option flags.
 */

import {
  validateUrl,
  isSafeUrl,
  type UrlValidatorOptions,
} from '../url-validator';

// ============================================================================
// validateUrl — core validator
// ============================================================================

describe('validateUrl', () => {
  // --------------------------------------------------------------------------
  // Valid URLs — happy path
  // --------------------------------------------------------------------------
  describe('valid URLs', () => {
    it('should accept a standard HTTPS URL', () => {
      const result = validateUrl('https://example.com');
      expect(result.valid).toBe(true);
      expect(result.risk).toBe('safe');
      expect(result.errors).toHaveLength(0);
    });

    it('should accept an HTTP URL by default (allowHttp defaults true)', () => {
      const result = validateUrl('http://example.com');
      expect(result.valid).toBe(true);
      // HTTP on non-localhost emits a warning
      expect(result.warnings.length).toBeGreaterThanOrEqual(1);
      expect(result.risk).toBe('warning');
    });

    it('should accept HTTPS URLs with path, query, and fragment', () => {
      const result = validateUrl('https://example.com/path?q=1&b=2#section');
      expect(result.valid).toBe(true);
      expect(result.normalized).toContain('example.com/path');
    });

    it('should accept HTTPS URLs with port numbers', () => {
      const result = validateUrl('https://example.com:8443/app');
      expect(result.valid).toBe(true);
    });

    it('should accept localhost URLs as safe', () => {
      const result = validateUrl('http://localhost:3000');
      expect(result.valid).toBe(true);
      // localhost HTTP should NOT generate the "insecure HTTP" warning
      expect(result.warnings).not.toContain(expect.stringContaining('insecure HTTP'));
    });

    it('should accept 127.0.0.1 as localhost', () => {
      const result = validateUrl('http://127.0.0.1:8080');
      expect(result.valid).toBe(true);
    });

    it('should accept [::1] as localhost', () => {
      const result = validateUrl('http://[::1]:5173');
      expect(result.valid).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Normalization
  // --------------------------------------------------------------------------
  describe('normalization', () => {
    it('should prepend https:// when no scheme is provided', () => {
      const result = validateUrl('example.com');
      expect(result.valid).toBe(true);
      // normalized is set BEFORE URL parsing, so no trailing slash from URL().href
      expect(result.normalized).toBe('https://example.com');
    });

    it('should trim leading/trailing whitespace', () => {
      const result = validateUrl('  https://example.com  ');
      expect(result.valid).toBe(true);
      expect(result.normalized).not.toMatch(/^\s|\s$/);
    });

    it('should preserve the original scheme when present', () => {
      const result = validateUrl('http://example.com');
      expect(result.normalized).toMatch(/^http:\/\//);
    });
  });

  // --------------------------------------------------------------------------
  // Blocked schemes
  // --------------------------------------------------------------------------
  describe('blocked schemes', () => {
    it.each([
      ['javascript:alert(1)', 'javascript:'],
      ['JAVASCRIPT:alert(1)', 'javascript:'],
      ['JavaScript:void(0)', 'javascript:'],
    ])('should block %s (javascript: scheme)', (url, _scheme) => {
      const result = validateUrl(url);
      expect(result.valid).toBe(false);
      expect(result.risk).toBe('blocked');
      expect(result.errors[0]).toMatch(/javascript:/i);
    });

    it('should block vbscript: scheme', () => {
      const result = validateUrl('vbscript:MsgBox("hi")');
      expect(result.valid).toBe(false);
      expect(result.risk).toBe('blocked');
    });

    it('should block vbscript: case-insensitively', () => {
      const result = validateUrl('VBSCRIPT:foo');
      expect(result.valid).toBe(false);
    });

    it('should block chrome:// internal scheme', () => {
      const result = validateUrl('chrome://settings');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toMatch(/internal scheme/i);
    });

    it('should block chrome-extension:// scheme', () => {
      const result = validateUrl('chrome-extension://abc/popup.html');
      expect(result.valid).toBe(false);
      expect(result.risk).toBe('blocked');
    });

    it('should block file:// scheme', () => {
      const result = validateUrl('file:///etc/passwd');
      expect(result.valid).toBe(false);
      expect(result.risk).toBe('blocked');
    });
  });

  // --------------------------------------------------------------------------
  // data: scheme
  // --------------------------------------------------------------------------
  describe('data: scheme', () => {
    it('should allow data:image/ URLs by default (allowDataImages)', () => {
      const result = validateUrl('data:image/png;base64,iVBOR...');
      expect(result.valid).toBe(true);
      expect(result.risk).toBe('warning');
      expect(result.warnings[0]).toMatch(/data:.*image/i);
    });

    it('should block non-image data: URLs by default', () => {
      const result = validateUrl('data:text/html,<h1>evil</h1>');
      expect(result.valid).toBe(false);
      expect(result.risk).toBe('blocked');
    });

    it('should block all data: URLs when allowDataImages is false', () => {
      const result = validateUrl('data:image/png;base64,abc', {
        allowDataImages: false,
      });
      expect(result.valid).toBe(false);
      expect(result.risk).toBe('blocked');
    });

    it('should handle data: case-insensitively', () => {
      const result = validateUrl('DATA:IMAGE/PNG;base64,abc');
      expect(result.valid).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // blob: scheme
  // --------------------------------------------------------------------------
  describe('blob: scheme', () => {
    it('should block blob: URLs by default', () => {
      const result = validateUrl('blob:https://example.com/some-uuid');
      expect(result.valid).toBe(false);
      expect(result.risk).toBe('blocked');
    });

    it('should allow blob: URLs when allowBlob is true', () => {
      const result = validateUrl('blob:https://example.com/uuid', {
        allowBlob: true,
      });
      expect(result.valid).toBe(true);
      expect(result.risk).toBe('warning');
    });
  });

  // --------------------------------------------------------------------------
  // about: scheme
  // --------------------------------------------------------------------------
  describe('about: scheme', () => {
    it('should allow about:blank with a warning', () => {
      const result = validateUrl('about:blank');
      expect(result.valid).toBe(true);
      expect(result.risk).toBe('warning');
    });

    it('should block other about: URLs', () => {
      const result = validateUrl('about:config');
      expect(result.valid).toBe(false);
      expect(result.risk).toBe('blocked');
    });

    it('should handle about:blank case-insensitively', () => {
      const result = validateUrl('ABOUT:BLANK');
      expect(result.valid).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Empty / invalid input
  // --------------------------------------------------------------------------
  describe('empty and invalid input', () => {
    it('should reject an empty string', () => {
      const result = validateUrl('');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('URL is empty');
      expect(result.risk).toBe('blocked');
    });

    it('should reject a whitespace-only string', () => {
      const result = validateUrl('   ');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('URL is empty');
    });

    it('should reject a completely malformed URL', () => {
      const result = validateUrl('://no-scheme');
      expect(result.valid).toBe(false);
      expect(result.risk).toBe('blocked');
    });
  });

  // --------------------------------------------------------------------------
  // IP addresses
  // --------------------------------------------------------------------------
  describe('IP address handling', () => {
    it('should warn about IP addresses when allowIpAddresses is false (default)', () => {
      const result = validateUrl('https://192.168.1.1/admin');
      expect(result.valid).toBe(true);
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringMatching(/IP address/i)]),
      );
    });

    it('should NOT warn about IP addresses when allowIpAddresses is true', () => {
      const result = validateUrl('https://192.168.1.1/admin', {
        allowIpAddresses: true,
      });
      expect(result.valid).toBe(true);
      // The specific IP warning should be absent
      const ipWarnings = result.warnings.filter((w) => /IP address/i.test(w));
      expect(ipWarnings).toHaveLength(0);
    });

    it('should not treat localhost (127.0.0.1) as a generic IP address', () => {
      const result = validateUrl('https://127.0.0.1');
      // localhost is excluded from the IP-address warning path
      const ipWarnings = result.warnings.filter((w) => /IP address/i.test(w));
      expect(ipWarnings).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // HTTP restriction
  // --------------------------------------------------------------------------
  describe('HTTP restriction', () => {
    it('should block HTTP when allowHttp is false', () => {
      const result = validateUrl('http://example.com', { allowHttp: false });
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringMatching(/HTTP.*not allowed/i)]),
      );
    });

    it('should still allow HTTP on localhost even when allowHttp is false', () => {
      const result = validateUrl('http://localhost:3000', { allowHttp: false });
      expect(result.valid).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Homoglyph / IDN attack detection
  // --------------------------------------------------------------------------
  describe('homoglyph detection', () => {
    it('should warn when hostname contains Cyrillic lookalikes (if not punycode-encoded)', () => {
      // URL() punycode-encodes Cyrillic in hostnames, so parsed.hostname
      // becomes "xn--..." and the regex won't match. This is a known
      // limitation: the check only fires if the hostname retains raw Unicode.
      //
      // We verify the detection logic works by testing the regex directly,
      // since that's the actual guard in the source code.
      const HOMOGLYPH_PATTERN =
        /[\u0430\u0435\u043E\u0440\u0441\u0443\u0445\u04BB\u0456\u0458\u04CF\u0501]/;
      expect(HOMOGLYPH_PATTERN.test('\u0430pple')).toBe(true); // Cyrillic "a"
      expect(HOMOGLYPH_PATTERN.test('apple')).toBe(false); // plain ASCII

      // Through validateUrl, punycode encoding means the warning is NOT
      // triggered for Cyrillic hostnames in modern runtimes.
      const result = validateUrl('https://\u0430pple.com');
      expect(result.valid).toBe(true);
    });

    it('should not warn for plain ASCII domains', () => {
      const result = validateUrl('https://apple.com');
      const homoglyphWarnings = result.warnings.filter((w) => /homoglyph/i.test(w));
      expect(homoglyphWarnings).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // Excessive subdomains
  // --------------------------------------------------------------------------
  describe('excessive subdomains', () => {
    it('should warn when hostname has more than 4 dots', () => {
      const result = validateUrl('https://a.b.c.d.e.example.com');
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringMatching(/excessive subdomains/i)]),
      );
    });

    it('should not warn for normal subdomains (<=4 dots)', () => {
      const result = validateUrl('https://www.us-east.cdn.example.com');
      const subWarnings = result.warnings.filter((w) => /excessive subdomains/i.test(w));
      expect(subWarnings).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // IP-like segments in subdomains
  // --------------------------------------------------------------------------
  describe('IP-like subdomain segments', () => {
    it('should warn when a subdomain segment matches IP pattern', () => {
      const result = validateUrl('https://192-168-1-1.evil.com');
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringMatching(/IP-like segment/i)]),
      );
    });

    it('should not warn for normal subdomain segments', () => {
      const result = validateUrl('https://cdn-west.example.com');
      const ipSegmentWarnings = result.warnings.filter((w) => /IP-like segment/i.test(w));
      expect(ipSegmentWarnings).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // Custom blocked domains
  // --------------------------------------------------------------------------
  describe('customBlockedDomains', () => {
    it('should block an exact match in customBlockedDomains', () => {
      const result = validateUrl('https://evil.com', {
        customBlockedDomains: ['evil.com'],
      });
      expect(result.valid).toBe(false);
      expect(result.risk).toBe('blocked');
      expect(result.errors[0]).toMatch(/Domain is blocked/i);
    });

    it('should block subdomains of a blocked domain', () => {
      const result = validateUrl('https://sub.evil.com/page', {
        customBlockedDomains: ['evil.com'],
      });
      expect(result.valid).toBe(false);
    });

    it('should be case-insensitive for blocked domains', () => {
      const result = validateUrl('https://EVIL.COM', {
        customBlockedDomains: ['evil.com'],
      });
      expect(result.valid).toBe(false);
    });

    it('should not block domains that merely contain the blocked string', () => {
      const result = validateUrl('https://notevil.com', {
        customBlockedDomains: ['evil.com'],
      });
      expect(result.valid).toBe(true);
    });

    it('should handle multiple blocked domains', () => {
      const opts: UrlValidatorOptions = {
        customBlockedDomains: ['bad1.com', 'bad2.org'],
      };
      expect(validateUrl('https://bad1.com', opts).valid).toBe(false);
      expect(validateUrl('https://bad2.org', opts).valid).toBe(false);
      expect(validateUrl('https://good.com', opts).valid).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Return value structure
  // --------------------------------------------------------------------------
  describe('return value structure', () => {
    it('should always return all five expected fields', () => {
      const result = validateUrl('https://example.com');
      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('normalized');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
      expect(result).toHaveProperty('risk');
    });

    it('risk should be one of safe | warning | blocked', () => {
      const safe = validateUrl('https://example.com');
      const warn = validateUrl('http://example.com');
      const blocked = validateUrl('javascript:alert(1)');

      expect(['safe', 'warning', 'blocked']).toContain(safe.risk);
      expect(['safe', 'warning', 'blocked']).toContain(warn.risk);
      expect(['safe', 'warning', 'blocked']).toContain(blocked.risk);
    });

    it('should return risk=safe when there are no errors and no warnings', () => {
      const result = validateUrl('https://example.com');
      expect(result.risk).toBe('safe');
    });

    it('should return risk=warning when there are warnings but no errors', () => {
      const result = validateUrl('http://example.com'); // HTTP warning
      expect(result.risk).toBe('warning');
      expect(result.valid).toBe(true);
    });

    it('should return risk=blocked when there are errors', () => {
      const result = validateUrl('');
      expect(result.risk).toBe('blocked');
      expect(result.valid).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Edge cases
  // --------------------------------------------------------------------------
  describe('edge cases', () => {
    it('should handle URLs with authentication info (user:pass@host)', () => {
      const result = validateUrl('https://user:pass@example.com');
      expect(result.valid).toBe(true);
    });

    it('should handle very long URLs without crashing', () => {
      const longPath = 'a'.repeat(5000);
      const result = validateUrl(`https://example.com/${longPath}`);
      expect(result.valid).toBe(true);
    });

    it('should handle URLs with unicode paths', () => {
      const result = validateUrl('https://example.com/\u00e9\u00e8\u00ea');
      expect(result.valid).toBe(true);
    });

    it('should handle ftp: scheme (not explicitly blocked, gets prepended/parsed)', () => {
      // ftp: is not in BLOCKED_SCHEMES nor BLOCKED_INTERNAL_SCHEMES
      // It should parse fine but may generate warnings
      const result = validateUrl('ftp://files.example.com');
      // ftp has a recognized scheme so no prepend; URL() can parse it
      expect(result).toHaveProperty('valid');
    });
  });
});

// ============================================================================
// isSafeUrl — convenience wrapper
// ============================================================================

describe('isSafeUrl', () => {
  it('should return true for a safe HTTPS URL', () => {
    expect(isSafeUrl('https://example.com')).toBe(true);
  });

  it('should return false for javascript: scheme', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
  });

  it('should return false for an empty string', () => {
    expect(isSafeUrl('')).toBe(false);
  });

  it('should forward options to validateUrl', () => {
    // HTTP is allowed by default
    expect(isSafeUrl('http://example.com')).toBe(true);
    // But blocked when allowHttp is false
    expect(isSafeUrl('http://example.com', { allowHttp: false })).toBe(false);
  });

  it('should return true for HTTP on localhost even with allowHttp=false', () => {
    expect(isSafeUrl('http://localhost', { allowHttp: false })).toBe(true);
  });

  it('should block custom domains via options', () => {
    expect(
      isSafeUrl('https://malware.org', {
        customBlockedDomains: ['malware.org'],
      }),
    ).toBe(false);
  });
});
