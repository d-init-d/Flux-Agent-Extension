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
        url: 'example.com/docs',
      },
      defaultConfig,
    );

    expect(sanitized).toMatchObject({
      type: 'navigate',
      description: 'open site',
      url: 'https://example.com/docs',
    });
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
});
