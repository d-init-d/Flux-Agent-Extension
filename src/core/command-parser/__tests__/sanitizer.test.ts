import { ErrorCode, ExtensionError } from '@shared/errors';
import { sanitizeCommandAction } from '../sanitizer';

describe('sanitizeCommandAction', () => {
  const defaultConfig = {
    strictMode: true,
    allowEvaluate: false,
    allowedDomains: [] as string[],
    blockedSelectors: [] as string[],
  };

  it('normalizes scheme-less navigate URLs and trims description', () => {
    const sanitized = sanitizeCommandAction(
      {
        id: 'a1',
        type: 'navigate',
        description: '  open site  ',
        url: 'localhost/docs',
      },
      defaultConfig,
    );

    expect(sanitized).toMatchObject({
      type: 'navigate',
      description: 'open site',
      url: 'https://localhost/docs',
    });
  });

  it('requires confirmation for high-risk actions in strict mode', () => {
    try {
      sanitizeCommandAction(
        {
          id: 'a1b',
          type: 'navigate',
          url: 'https://example.com/account',
        },
        defaultConfig,
      );
      throw new Error('Expected sanitizer to throw');
    } catch (error) {
      expect((error as ExtensionError).code).toBe(ErrorCode.ACTION_BLOCKED);
      expect((error as ExtensionError).message).toContain('requires explicit user confirmation');
    }
  });

  it('sanitizes selector fields', () => {
    const sanitized = sanitizeCommandAction(
      {
        id: 'a2',
        type: 'click',
        selector: {
          text: '  Submit  ',
          css: '  #login-button  ',
        },
      },
      defaultConfig,
    );

    expect(sanitized).toMatchObject({
      type: 'click',
      selector: {
        text: 'Submit',
        css: '#login-button',
      },
    });
  });

  it('blocks URL outside allowedDomains', () => {
    expect(() =>
      sanitizeCommandAction(
        {
          id: 'a3',
          type: 'navigate',
          url: 'https://example.com',
        },
        { ...defaultConfig, allowedDomains: ['internal.test'] },
      ),
    ).toThrowError(ExtensionError);

    try {
      sanitizeCommandAction(
        {
          id: 'a3',
          type: 'navigate',
          url: 'https://example.com',
        },
        { ...defaultConfig, allowedDomains: ['internal.test'] },
      );
    } catch (error) {
      expect((error as ExtensionError).code).toBe(ErrorCode.ACTION_BLOCKED);
    }
  });

  it('rejects blocked selector patterns from sanitizer', () => {
    try {
      sanitizeCommandAction(
        {
          id: 'a4',
          type: 'click',
          selector: {
            css: 'div[url(javascript:alert(1))]',
          },
        },
        defaultConfig,
      );
      throw new Error('Expected sanitizer to throw');
    } catch (error) {
      expect((error as ExtensionError).code).toBe(ErrorCode.ACTION_INVALID);
    }
  });

  it('blocks configured blockedSelectors values', () => {
    try {
      sanitizeCommandAction(
        {
          id: 'a5',
          type: 'click',
          selector: {
            text: 'Delete account',
          },
        },
        { ...defaultConfig, blockedSelectors: ['delete account'] },
      );
      throw new Error('Expected sanitizer to throw');
    } catch (error) {
      expect((error as ExtensionError).code).toBe(ErrorCode.ACTION_BLOCKED);
    }
  });

  it('blocks dangerous evaluate script when evaluate is enabled', () => {
    try {
      sanitizeCommandAction(
        {
          id: 'a6',
          type: 'evaluate',
          script: 'fetch("https://evil.test")',
        },
        { ...defaultConfig, allowEvaluate: true },
      );
      throw new Error('Expected sanitizer to throw');
    } catch (error) {
      expect((error as ExtensionError).code).toBe(ErrorCode.ACTION_BLOCKED);
    }
  });

  it('blocks action classified as blocked', () => {
    try {
      sanitizeCommandAction(
        {
          id: 'a7',
          type: 'click',
          selector: {
            text: 'chrome://extensions',
          },
        },
        defaultConfig,
      );
      throw new Error('Expected sanitizer to throw');
    } catch (error) {
      expect((error as ExtensionError).code).toBe(ErrorCode.ACTION_BLOCKED);
    }
  });

  it('passes through non-navigate/newTab actions without URL validation', () => {
    const sanitized = sanitizeCommandAction(
      { id: 'c1', type: 'click', selector: { css: '#btn' } },
      defaultConfig,
    );
    expect(sanitized.type).toBe('click');
  });

  it('skips URL validation when url property is not a string', () => {
    const sanitized = sanitizeCommandAction(
      { id: 'n1', type: 'navigate', url: undefined } as never,
      { ...defaultConfig, strictMode: false },
    );
    expect(sanitized.type).toBe('navigate');
  });

  it('blocks evaluate action when allowEvaluate is false', () => {
    expect(() =>
      sanitizeCommandAction(
        { id: 'e1', type: 'evaluate', script: 'return 1' },
        { ...defaultConfig, allowEvaluate: false },
      ),
    ).toThrowError(ExtensionError);
  });

  it('allows evaluate action when allowEvaluate is true and script is safe', () => {
    const sanitized = sanitizeCommandAction(
      { id: 'e2', type: 'evaluate', script: 'return document.title' },
      { ...defaultConfig, strictMode: false, allowEvaluate: true },
    );
    expect(sanitized.type).toBe('evaluate');
  });

  it('allows subdomain of an allowed domain', () => {
    const sanitized = sanitizeCommandAction(
      { id: 'sd1', type: 'navigate', url: 'https://sub.internal.test/path' },
      { ...defaultConfig, strictMode: false, allowedDomains: ['internal.test'] },
    );
    expect(sanitized.url).toContain('sub.internal.test');
  });

  it('ignores empty strings in allowedDomains list', () => {
    expect(() =>
      sanitizeCommandAction(
        { id: 'sd2', type: 'navigate', url: 'https://evil.com' },
        { ...defaultConfig, strictMode: false, allowedDomains: ['', '  ', 'safe.test'] },
      ),
    ).toThrowError(ExtensionError);
  });

  it('does not throw for actions without a selector field', () => {
    const sanitized = sanitizeCommandAction(
      { id: 'w1', type: 'wait', duration: 500 },
      defaultConfig,
    );
    expect(sanitized.type).toBe('wait');
  });

  it('skips non-string selector fields', () => {
    const sanitized = sanitizeCommandAction(
      { id: 's1', type: 'click', selector: { css: '#btn', nth: 2 } } as never,
      defaultConfig,
    );
    expect((sanitized as { selector: { css: string } }).selector.css).toBe('#btn');
  });

  it('allows newTab action with valid URL', () => {
    const sanitized = sanitizeCommandAction(
      { id: 'nt1', type: 'newTab', url: 'https://example.com/page' },
      { ...defaultConfig, strictMode: false },
    );
    expect(sanitized.url).toContain('example.com');
  });

  it('blocks URL with warning risk in strict mode', () => {
    try {
      sanitizeCommandAction(
        { id: 'sm1', type: 'navigate', url: 'https://example.com/login' },
        { ...defaultConfig, strictMode: true },
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ExtensionError);
    }
  });

  it('passes through no blockedSelectors gracefully', () => {
    const sanitized = sanitizeCommandAction(
      { id: 'bs1', type: 'click', selector: { text: 'Submit' } },
      { ...defaultConfig, blockedSelectors: [] },
    );
    expect((sanitized as { selector: { text: string } }).selector.text).toBe('Submit');
  });

  it('trims description on action with description', () => {
    const sanitized = sanitizeCommandAction(
      { id: 'd1', type: 'wait', duration: 100, description: '  trimmed  ' },
      defaultConfig,
    );
    expect(sanitized.description).toBe('trimmed');
  });
});
