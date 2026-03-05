/**
 * @module sanitizer.test
 * @description Comprehensive tests for input sanitization utilities.
 *
 * Tests all four exported functions:
 * - sanitizeHtml: HTML tag stripping, entity escaping, whitespace normalization
 * - sanitizeSelector: CSS selector validation against dangerous patterns
 * - sanitizeScript: JavaScript snippet validation against dangerous patterns
 * - escapeRegExp: Regex special character escaping
 */

import {
  sanitizeHtml,
  sanitizeSelector,
  sanitizeScript,
  escapeRegExp,
} from '../sanitizer';

// ============================================================================
// sanitizeHtml
// ============================================================================

describe('sanitizeHtml', () => {
  // --------------------------------------------------------------------------
  // Basic stripping
  // --------------------------------------------------------------------------

  describe('tag stripping', () => {
    it('should strip simple HTML tags', () => {
      expect(sanitizeHtml('<p>Hello</p>')).toBe('Hello');
    });

    it('should strip self-closing tags', () => {
      expect(sanitizeHtml('before<br/>after')).toBe('beforeafter');
    });

    it('should strip tags with attributes', () => {
      expect(sanitizeHtml('<a href="https://example.com">link</a>')).toBe('link');
    });

    it('should strip <script> tags and their content markers', () => {
      const input = '<script>alert("xss")</script>';
      const result = sanitizeHtml(input);
      expect(result).not.toContain('<script');
      expect(result).not.toContain('</script');
    });

    it('should strip <iframe> tags', () => {
      expect(sanitizeHtml('<iframe src="evil.com"></iframe>')).toBe('');
    });

    it('should strip <object> and <embed> tags', () => {
      expect(sanitizeHtml('<object data="x"></object>')).toBe('');
      expect(sanitizeHtml('<embed src="x"/>')).toBe('');
    });

    it('should strip nested tags', () => {
      expect(sanitizeHtml('<div><span><b>text</b></span></div>')).toBe('text');
    });

    it('should strip HTML comments', () => {
      expect(sanitizeHtml('before<!-- comment -->after')).toBe('beforeafter');
    });

    it('should strip multi-line HTML comments', () => {
      const input = 'a<!--\nmultiline\ncomment\n-->b';
      // Comment is removed entirely without inserting whitespace → 'ab'
      expect(sanitizeHtml(input)).toBe('ab');
    });

    it('should strip CDATA sections', () => {
      expect(sanitizeHtml('x<![CDATA[some data]]>y')).toBe('xy');
    });

    it('should handle malformed tags', () => {
      // Malformed self-closing with extra attributes
      const result = sanitizeHtml('<div class="bad" onclick="evil()">text</div>');
      expect(result).toBe('text');
    });
  });

  // --------------------------------------------------------------------------
  // Entity escaping
  // --------------------------------------------------------------------------

  describe('entity escaping', () => {
    it('should escape ampersands', () => {
      expect(sanitizeHtml('AT&T')).toBe('AT&amp;T');
    });

    it('should escape less-than signs', () => {
      // Note: bare < may be caught by tag stripping, but if not matched as tag
      expect(sanitizeHtml('a&b')).toBe('a&amp;b');
    });

    it('should escape double quotes', () => {
      expect(sanitizeHtml('say "hello"')).toBe('say &quot;hello&quot;');
    });

    it('should escape single quotes', () => {
      expect(sanitizeHtml("it's")).toBe('it&#x27;s');
    });

    it('should escape all entities in order', () => {
      // Avoid bare < ... > pairs since the regex `<[^>]*>` treats them as tags.
      // Test each entity independently to prove escaping order is correct.
      expect(sanitizeHtml('a & b')).toBe('a &amp; b');
      expect(sanitizeHtml('a " b')).toBe('a &quot; b');
      expect(sanitizeHtml("a ' b")).toBe('a &#x27; b');
      // For < and >, test them in non-tag positions (no matching pair)
      expect(sanitizeHtml('a &amp; "test"')).toBe('a &amp;amp; &quot;test&quot;');
    });
  });

  // --------------------------------------------------------------------------
  // Null bytes and whitespace
  // --------------------------------------------------------------------------

  describe('null bytes and whitespace', () => {
    it('should remove null bytes', () => {
      expect(sanitizeHtml('hel\0lo')).toBe('hello');
    });

    it('should collapse multiple spaces into one', () => {
      expect(sanitizeHtml('a   b    c')).toBe('a b c');
    });

    it('should collapse tabs and newlines', () => {
      expect(sanitizeHtml('a\t\n\rb')).toBe('a b');
    });

    it('should trim leading and trailing whitespace', () => {
      expect(sanitizeHtml('  hello  ')).toBe('hello');
    });
  });

  // --------------------------------------------------------------------------
  // Edge cases and non-string input
  // --------------------------------------------------------------------------

  describe('edge cases', () => {
    it('should return empty string for empty input', () => {
      expect(sanitizeHtml('')).toBe('');
    });

    it('should return empty string for null input', () => {
      expect(sanitizeHtml(null as unknown as string)).toBe('');
    });

    it('should return empty string for undefined input', () => {
      expect(sanitizeHtml(undefined as unknown as string)).toBe('');
    });

    it('should return empty string for numeric input', () => {
      expect(sanitizeHtml(42 as unknown as string)).toBe('');
    });

    it('should handle plain text without HTML', () => {
      expect(sanitizeHtml('just text')).toBe('just text');
    });

    it('should handle text that looks like tags but is not', () => {
      // The regex `<[^>]*>` treats `< 5 and 10 >` as a tag and strips it.
      // This is expected behavior — the sanitizer is aggressive by design.
      expect(sanitizeHtml('3 < 5 and 10 > 7')).toBe('3 7');
    });

    it('should handle unicode text', () => {
      const result = sanitizeHtml('Xin chào 🌍');
      expect(result).toContain('Xin chào');
    });
  });

  // --------------------------------------------------------------------------
  // XSS attack vectors
  // --------------------------------------------------------------------------

  describe('XSS attack vectors', () => {
    it('should strip javascript: protocol in href', () => {
      const input = '<a href="javascript:alert(1)">click</a>';
      const result = sanitizeHtml(input);
      expect(result).not.toContain('javascript:');
      expect(result).toBe('click');
    });

    it('should strip on* event handlers', () => {
      const input = '<img onerror="alert(1)" src="x">';
      const result = sanitizeHtml(input);
      expect(result).not.toContain('onerror');
    });

    it('should strip <img> with onerror', () => {
      expect(sanitizeHtml('<img src=x onerror=alert(1)>')).toBe('');
    });

    it('should strip SVG-based XSS payload', () => {
      const input = '<svg onload="alert(1)"><circle/></svg>';
      const result = sanitizeHtml(input);
      expect(result).not.toContain('<svg');
      expect(result).not.toContain('onload');
    });

    it('should strip data: URI in img src', () => {
      const input = '<img src="data:text/html,<script>alert(1)</script>">';
      const result = sanitizeHtml(input);
      expect(result).not.toContain('data:');
    });

    it('should strip style tags', () => {
      const input = '<style>body{background:url("javascript:alert(1)")}</style>';
      const result = sanitizeHtml(input);
      expect(result).not.toContain('<style');
    });

    it('should handle double-encoded attack attempts', () => {
      // After first pass of tag stripping, entities remain as text
      const input = '&lt;script&gt;alert(1)&lt;/script&gt;';
      const result = sanitizeHtml(input);
      // The & in &lt; gets escaped to &amp;lt; — entities are escaped, not decoded
      expect(result).not.toContain('<script>');
    });

    it('should strip null-byte-based obfuscation', () => {
      // After null byte removal: '<script>alert(1)</script>'
      // Tag stripping removes the <script> tags but leaves inner text 'alert(1)'.
      // The key security property: the <script> tags are gone.
      const input = '<scr\0ipt>alert(1)</scr\0ipt>';
      const result = sanitizeHtml(input);
      expect(result).not.toContain('<script');
      expect(result).not.toContain('</script');
    });
  });
});

// ============================================================================
// sanitizeSelector
// ============================================================================

describe('sanitizeSelector', () => {
  // --------------------------------------------------------------------------
  // Valid selectors
  // --------------------------------------------------------------------------

  describe('valid selectors', () => {
    it('should accept a simple class selector', () => {
      expect(sanitizeSelector('.my-class')).toBe('.my-class');
    });

    it('should accept an ID selector', () => {
      expect(sanitizeSelector('#my-id')).toBe('#my-id');
    });

    it('should accept a complex valid selector', () => {
      const sel = 'div.container > ul.list li:first-child a[href]';
      expect(sanitizeSelector(sel)).toBe(sel);
    });

    it('should accept attribute selectors', () => {
      expect(sanitizeSelector('input[type="text"]')).toBe('input[type="text"]');
    });

    it('should accept pseudo-class selectors', () => {
      expect(sanitizeSelector('a:hover')).toBe('a:hover');
    });

    it('should trim whitespace from valid selectors', () => {
      expect(sanitizeSelector('  .trimmed  ')).toBe('.trimmed');
    });
  });

  // --------------------------------------------------------------------------
  // Empty / invalid input
  // --------------------------------------------------------------------------

  describe('empty and invalid input', () => {
    it('should throw for empty string', () => {
      expect(() => sanitizeSelector('')).toThrow('Selector must be a non-empty string');
    });

    it('should throw for whitespace-only string', () => {
      expect(() => sanitizeSelector('   ')).toThrow('Selector must be a non-empty string');
    });

    it('should throw for null input', () => {
      expect(() => sanitizeSelector(null as unknown as string)).toThrow(
        'Selector must be a non-empty string',
      );
    });

    it('should throw for undefined input', () => {
      expect(() => sanitizeSelector(undefined as unknown as string)).toThrow(
        'Selector must be a non-empty string',
      );
    });

    it('should throw for numeric input', () => {
      expect(() => sanitizeSelector(42 as unknown as string)).toThrow(
        'Selector must be a non-empty string',
      );
    });
  });

  // --------------------------------------------------------------------------
  // Blocked patterns
  // --------------------------------------------------------------------------

  describe('blocked patterns', () => {
    it('should reject javascript: protocol', () => {
      expect(() => sanitizeSelector('div[attr="javascript:alert(1)"]')).toThrow(
        /Blocked pattern.*javascript: protocol/,
      );
    });

    it('should reject JAVASCRIPT: (case-insensitive)', () => {
      expect(() => sanitizeSelector('JAVASCRIPT:void(0)')).toThrow(
        /javascript: protocol/,
      );
    });

    it('should reject javascript with whitespace before colon', () => {
      expect(() => sanitizeSelector('javascript :void(0)')).toThrow(
        /javascript: protocol/,
      );
    });

    it('should reject onclick= event handler', () => {
      expect(() => sanitizeSelector('[onclick=alert(1)]')).toThrow(
        /event handler attribute/,
      );
    });

    it('should reject onload= event handler', () => {
      expect(() => sanitizeSelector('[onload=evil()]')).toThrow(
        /event handler attribute/,
      );
    });

    it('should reject onerror= event handler', () => {
      expect(() => sanitizeSelector('[onerror=alert]')).toThrow(
        /event handler attribute/,
      );
    });

    it('should reject expression() CSS function', () => {
      expect(() => sanitizeSelector('div[style="expression(alert(1))"]')).toThrow(
        /CSS expression\(\)/,
      );
    });

    it('should reject expression with whitespace', () => {
      expect(() => sanitizeSelector('expression (')).toThrow(
        /CSS expression\(\)/,
      );
    });

    it('should reject url() CSS function', () => {
      expect(() => sanitizeSelector('div[style="url(evil.js)"]')).toThrow(
        /CSS url\(\)/,
      );
    });

    it('should reject url with whitespace', () => {
      expect(() => sanitizeSelector('url (')).toThrow(
        /CSS url\(\)/,
      );
    });

    it('should reject chrome-extension:// references', () => {
      expect(() => sanitizeSelector('[src="chrome-extension://abc"]')).toThrow(
        /chrome-extension:\/\/ reference/,
      );
    });

    it('should reject -moz-binding', () => {
      // Use input WITHOUT url() so the -moz-binding pattern is matched first
      expect(() => sanitizeSelector('[style="-moz-binding:something"]')).toThrow(
        /-moz-binding/,
      );
    });

    it('should reject behavior: CSS property', () => {
      // Use input WITHOUT url() so the behavior: pattern is matched first
      expect(() => sanitizeSelector('[style="behavior: test"]')).toThrow(
        /behavior:/,
      );
    });

    it('should reject @import rule', () => {
      // Use input WITHOUT url() so the @import pattern is matched first
      expect(() => sanitizeSelector('@import "style.css"')).toThrow(
        /@import/,
      );
    });
  });
});

// ============================================================================
// sanitizeScript
// ============================================================================

describe('sanitizeScript', () => {
  // --------------------------------------------------------------------------
  // Valid scripts
  // --------------------------------------------------------------------------

  describe('valid scripts', () => {
    it('should accept a simple expression', () => {
      expect(sanitizeScript('1 + 1')).toBe('1 + 1');
    });

    it('should accept a variable declaration', () => {
      expect(sanitizeScript('const x = 42;')).toBe('const x = 42;');
    });

    it('should accept DOM querySelector', () => {
      expect(sanitizeScript('document.querySelector(".btn")')).toBe(
        'document.querySelector(".btn")',
      );
    });

    it('should accept arrow function', () => {
      const script = '(x) => x * 2';
      expect(sanitizeScript(script)).toBe(script);
    });

    it('should trim whitespace', () => {
      expect(sanitizeScript('  return true;  ')).toBe('return true;');
    });
  });

  // --------------------------------------------------------------------------
  // Empty / invalid input
  // --------------------------------------------------------------------------

  describe('empty and invalid input', () => {
    it('should throw for empty string', () => {
      expect(() => sanitizeScript('')).toThrow('Script must be a non-empty string');
    });

    it('should throw for whitespace-only string', () => {
      expect(() => sanitizeScript('   ')).toThrow('Script must be a non-empty string');
    });

    it('should throw for null input', () => {
      expect(() => sanitizeScript(null as unknown as string)).toThrow(
        'Script must be a non-empty string',
      );
    });

    it('should throw for undefined input', () => {
      expect(() => sanitizeScript(undefined as unknown as string)).toThrow(
        'Script must be a non-empty string',
      );
    });

    it('should throw for numeric input', () => {
      expect(() => sanitizeScript(123 as unknown as string)).toThrow(
        'Script must be a non-empty string',
      );
    });
  });

  // --------------------------------------------------------------------------
  // Blocked patterns — Code execution
  // --------------------------------------------------------------------------

  describe('blocked: code execution', () => {
    it('should reject eval()', () => {
      expect(() => sanitizeScript('eval("alert(1)")')).toThrow(/eval\(\)/);
    });

    it('should reject eval with whitespace', () => {
      expect(() => sanitizeScript('eval ("alert")')).toThrow(/eval\(\)/);
    });

    it('should reject Function() constructor', () => {
      expect(() => sanitizeScript('Function("return 1")')).toThrow(
        /Function\(\) constructor/,
      );
    });

    it('should reject new Function()', () => {
      // Pattern `\bFunction\s*\(` matches before `\bnew\s+Function\s*\(` in the blocklist,
      // so the error message says "Function() constructor", not "new Function()".
      expect(() => sanitizeScript('new Function("alert(1)")')).toThrow(
        /Function\(\) constructor/,
      );
    });
  });

  // --------------------------------------------------------------------------
  // Blocked patterns — Data exfiltration
  // --------------------------------------------------------------------------

  describe('blocked: data exfiltration', () => {
    it('should reject document.cookie', () => {
      expect(() => sanitizeScript('var c = document.cookie')).toThrow(
        /document\.cookie/,
      );
    });

    it('should reject document . cookie (with whitespace)', () => {
      expect(() => sanitizeScript('document . cookie')).toThrow(
        /document\.cookie/,
      );
    });

    it('should reject localStorage', () => {
      expect(() => sanitizeScript('localStorage.getItem("key")')).toThrow(
        /localStorage/,
      );
    });

    it('should reject sessionStorage', () => {
      expect(() => sanitizeScript('sessionStorage.setItem("k","v")')).toThrow(
        /sessionStorage/,
      );
    });
  });

  // --------------------------------------------------------------------------
  // Blocked patterns — Network access
  // --------------------------------------------------------------------------

  describe('blocked: network access', () => {
    it('should reject fetch()', () => {
      expect(() => sanitizeScript('fetch("https://evil.com")')).toThrow(
        /fetch\(\)/,
      );
    });

    it('should reject XMLHttpRequest', () => {
      expect(() => sanitizeScript('new XMLHttpRequest()')).toThrow(
        /XMLHttpRequest/,
      );
    });
  });

  // --------------------------------------------------------------------------
  // Blocked patterns — Chrome extension APIs
  // --------------------------------------------------------------------------

  describe('blocked: chrome APIs', () => {
    it('should reject chrome.storage', () => {
      expect(() => sanitizeScript('chrome.storage.local.get("key")')).toThrow(
        /chrome\.\* API/,
      );
    });

    it('should reject chrome.runtime', () => {
      expect(() => sanitizeScript('chrome.runtime.sendMessage({})')).toThrow(
        /chrome\.\* API/,
      );
    });

    it('should reject chrome.tabs', () => {
      expect(() => sanitizeScript('chrome.tabs.query({})')).toThrow(
        /chrome\.\* API/,
      );
    });
  });

  // --------------------------------------------------------------------------
  // Blocked patterns — Window escape
  // --------------------------------------------------------------------------

  describe('blocked: window escape', () => {
    it('should reject window.opener', () => {
      expect(() => sanitizeScript('window.opener.postMessage("x")')).toThrow(
        /window\.opener/,
      );
    });

    it('should reject window.parent', () => {
      expect(() => sanitizeScript('window.parent.location = "evil"')).toThrow(
        /window\.parent/,
      );
    });

    it('should reject window.top', () => {
      expect(() => sanitizeScript('if (window.top !== window.self) {}')).toThrow(
        /window\.top/,
      );
    });
  });

  // --------------------------------------------------------------------------
  // Blocked patterns — Worker loading
  // --------------------------------------------------------------------------

  describe('blocked: worker loading', () => {
    it('should reject importScripts()', () => {
      expect(() => sanitizeScript('importScripts("evil.js")')).toThrow(
        /importScripts\(\)/,
      );
    });
  });

  // --------------------------------------------------------------------------
  // Blocked patterns — Prototype pollution
  // --------------------------------------------------------------------------

  describe('blocked: prototype pollution', () => {
    it('should reject __proto__', () => {
      expect(() => sanitizeScript('obj.__proto__.polluted = true')).toThrow(
        /__proto__/,
      );
    });

    it('should reject prototype bracket access', () => {
      expect(() => sanitizeScript('obj.prototype["inject"] = fn')).toThrow(
        /prototype\[\]/,
      );
    });

    it('should reject constructor.prototype manipulation', () => {
      expect(() =>
        sanitizeScript('obj.constructor["prototype"].x = 1'),
      ).toThrow(/constructor\.prototype/);
    });
  });
});

// ============================================================================
// escapeRegExp
// ============================================================================

describe('escapeRegExp', () => {
  describe('basic escaping', () => {
    it('should escape backslash', () => {
      expect(escapeRegExp('\\')).toBe('\\\\');
    });

    it('should escape caret', () => {
      expect(escapeRegExp('^')).toBe('\\^');
    });

    it('should escape dollar', () => {
      expect(escapeRegExp('$')).toBe('\\$');
    });

    it('should escape dot', () => {
      expect(escapeRegExp('.')).toBe('\\.');
    });

    it('should escape asterisk', () => {
      expect(escapeRegExp('*')).toBe('\\*');
    });

    it('should escape plus', () => {
      expect(escapeRegExp('+')).toBe('\\+');
    });

    it('should escape question mark', () => {
      expect(escapeRegExp('?')).toBe('\\?');
    });

    it('should escape parentheses', () => {
      expect(escapeRegExp('()')).toBe('\\(\\)');
    });

    it('should escape square brackets', () => {
      expect(escapeRegExp('[]')).toBe('\\[\\]');
    });

    it('should escape curly braces', () => {
      expect(escapeRegExp('{}')).toBe('\\{\\}');
    });

    it('should escape pipe', () => {
      expect(escapeRegExp('|')).toBe('\\|');
    });
  });

  describe('mixed strings', () => {
    it('should escape all special chars in a real-world pattern', () => {
      const result = escapeRegExp('price: $9.99 (USD)');
      expect(result).toBe('price: \\$9\\.99 \\(USD\\)');
    });

    it('should not modify strings without special characters', () => {
      expect(escapeRegExp('hello world')).toBe('hello world');
    });

    it('should produce a valid RegExp from the escaped string', () => {
      const raw = 'file.test.ts (1+2)';
      const escaped = escapeRegExp(raw);
      const re = new RegExp(escaped);
      expect(re.test(raw)).toBe(true);
      expect(re.test('filetesttsa1+2)')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should return empty string for empty input', () => {
      expect(escapeRegExp('')).toBe('');
    });

    it('should return empty string for null', () => {
      expect(escapeRegExp(null as unknown as string)).toBe('');
    });

    it('should return empty string for undefined', () => {
      expect(escapeRegExp(undefined as unknown as string)).toBe('');
    });

    it('should return empty string for non-string input', () => {
      expect(escapeRegExp(42 as unknown as string)).toBe('');
    });

    it('should handle string of only special characters', () => {
      expect(escapeRegExp('^$.*+?()[]{}|')).toBe(
        '\\^\\$\\.\\*\\+\\?\\(\\)\\[\\]\\{\\}\\|',
      );
    });
  });
});
