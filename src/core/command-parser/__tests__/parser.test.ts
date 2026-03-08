import { ErrorCode, ExtensionError } from '@shared/errors';
import type { Action } from '@shared/types';
import { CommandParser } from '../parser';

describe('CommandParser', () => {
  it('parses direct JSON object with actions', () => {
    const parser = new CommandParser();

    const result = parser.parse(
      JSON.stringify({
        thinking: 'Need two steps',
        actions: [
          { type: 'navigate', url: 'https://localhost/dashboard' },
          { type: 'click', selector: { text: 'Login' } },
        ],
        summary: 'Navigate and click login',
      }),
    );

    expect(result.thinking).toBe('Need two steps');
    expect(result.summary).toBe('Navigate and click login');
    expect(result.actions).toHaveLength(2);
    expect(result.actions[0]).toMatchObject({ type: 'navigate', url: 'https://localhost/dashboard' });
    expect(result.actions[0].id).toBeTypeOf('string');
    expect(result.actions[1]).toMatchObject({ type: 'click', selector: { text: 'Login' } });
  });

  it('extracts JSON from markdown code block', () => {
    const parser = new CommandParser();
    const response = [
      'I will do this:',
      '```json',
      '{"actions":[{"type":"navigate","url":"https://localhost/docs"}]}',
      '```',
    ].join('\n');

    const result = parser.parse(response);

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({ type: 'navigate', url: 'https://localhost/docs' });
  });

  it('normalizes prompt-style actions that use params and message aliases', () => {
    const parser = new CommandParser();

    const result = parser.parse(
      JSON.stringify({
        thinking: 'Need two steps',
        message: 'Open docs and click sign in',
        actions: [
          {
            type: 'navigate',
            params: { url: 'https://localhost/docs' },
            description: 'Open the docs page',
          },
          {
            type: 'click',
            params: { selector: { role: 'button', textExact: 'Sign in' } },
            description: 'Click sign in',
          },
        ],
      }),
    );

    expect(result.summary).toBe('Open docs and click sign in');
    expect(result.actions).toEqual([
      expect.objectContaining({ type: 'navigate', url: 'https://localhost/docs' }),
      expect.objectContaining({
        type: 'click',
        selector: { role: 'button', textExact: 'Sign in' },
      }),
    ]);
  });

  it('extracts balanced JSON object from surrounding text', () => {
    const parser = new CommandParser();

    const result = parser.parse(
      'Sure. First I plan carefully. {"actions":[{"type":"wait","duration":500}]} Done.',
    );

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({ type: 'wait', duration: 500 });
  });

  it('supports top-level array payload', () => {
    const parser = new CommandParser();
    const result = parser.parse('[{"type":"goBack"},{"type":"goForward"}]');

    expect(result.actions).toHaveLength(2);
    expect(result.actions[0]).toMatchObject({ type: 'goBack' });
    expect(result.actions[1]).toMatchObject({ type: 'goForward' });
  });

  it('returns empty actions when payload only asks for more info', () => {
    const parser = new CommandParser();
    const result = parser.parse(
      JSON.stringify({
        needsMoreInfo: {
          question: 'Which account should I use?',
          context: 'Multiple accounts are visible',
        },
      }),
    );

    expect(result.actions).toEqual([]);
    expect(result.needsMoreInfo?.question).toContain('Which account');
  });

  it('rejects evaluate action in strict mode when allowEvaluate=false', () => {
    const parser = new CommandParser();

    try {
      parser.parse(
        JSON.stringify({ actions: [{ type: 'evaluate', script: 'return document.title' }] }),
      );
      throw new Error('Expected parse to throw');
    } catch (error) {
      expect((error as ExtensionError).code).toBe(ErrorCode.ACTION_BLOCKED);
    }
  });

  it('rejects evaluate action even when strictMode=false', () => {
    const parser = new CommandParser({ strictMode: false, allowEvaluate: false });

    try {
      parser.parse(
        JSON.stringify({ actions: [{ type: 'evaluate', script: 'return document.title' }] }),
      );
      throw new Error('Expected parse to throw');
    } catch (error) {
      expect((error as ExtensionError).code).toBe(ErrorCode.ACTION_BLOCKED);
    }
  });

  it('throws ACTION_INVALID for invalid payload in strict mode', () => {
    const parser = new CommandParser();

    try {
      parser.parse(JSON.stringify({ actions: [{ type: 'navigate' }] }));
      throw new Error('Expected parse to throw');
    } catch (error) {
      expect((error as ExtensionError).code).toBe(ErrorCode.ACTION_INVALID);
    }
  });

  it('throws ACTION_INVALID when selector payload is empty', () => {
    const parser = new CommandParser();

    try {
      parser.parse(JSON.stringify({ actions: [{ type: 'click', selector: {} }] }));
      throw new Error('Expected parse to throw');
    } catch (error) {
      expect((error as ExtensionError).code).toBe(ErrorCode.ACTION_INVALID);
    }
  });

  it('accepts evaluate action when explicitly enabled', () => {
    const parser = new CommandParser({ strictMode: false, allowEvaluate: true });
    const result = parser.parse(
      JSON.stringify({ actions: [{ type: 'evaluate', script: 'return document.title' }] }),
    );

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({ type: 'evaluate' });
  });

  it('normalizes legacy aliases for type, select, and tab index fields', () => {
    const parser = new CommandParser({ strictMode: false, allowEvaluate: true });
    const result = parser.parse(
      JSON.stringify({
        actions: [
          {
            type: 'type',
            params: {
              selector: { placeholder: 'Email' },
              value: 'user@example.com',
            },
          },
          {
            type: 'select',
            params: {
              selector: { textExact: 'Country' },
              value: 'Canada',
            },
          },
          {
            type: 'switchTab',
            params: { index: 2 },
          },
        ],
      }),
    );

    expect(result.actions[0]).toMatchObject({
      type: 'type',
      text: 'user@example.com',
      selector: { placeholder: 'Email' },
    });
    expect(result.actions[1]).toMatchObject({
      type: 'select',
      option: 'Canada',
      selector: { textExact: 'Country' },
    });
    expect(result.actions[2]).toMatchObject({ type: 'switchTab', tabIndex: 2 });
  });

  it('accepts the current prompt field names for type, select, switchTab, and closeTab', () => {
    const parser = new CommandParser({ strictMode: false, allowEvaluate: true });
    const result = parser.parse(
      JSON.stringify({
        summary: 'Use documented field names',
        actions: [
          {
            type: 'type',
            selector: { placeholder: 'Email' },
            text: 'user@example.com',
          },
          {
            type: 'select',
            selector: { textExact: 'Country' },
            option: { label: 'Canada' },
          },
          {
            type: 'switchTab',
            tabIndex: 2,
          },
          {
            type: 'closeTab',
            tabIndex: 1,
          },
        ],
      }),
    );

    expect(result.actions).toEqual([
      expect.objectContaining({
        type: 'type',
        text: 'user@example.com',
        selector: { placeholder: 'Email' },
      }),
      expect.objectContaining({
        type: 'select',
        option: { label: 'Canada' },
        selector: { textExact: 'Country' },
      }),
      expect.objectContaining({ type: 'switchTab', tabIndex: 2 }),
      expect.objectContaining({ type: 'closeTab', tabIndex: 1 }),
    ]);
  });

  it('throws AI_PARSE_ERROR when no JSON can be found', () => {
    const parser = new CommandParser();

    expect(() => parser.parse('No actionable response')).toThrowError(ExtensionError);

    try {
      parser.parse('No actionable response');
    } catch (error) {
      expect((error as ExtensionError).code).toBe(ErrorCode.AI_PARSE_ERROR);
    }
  });

  it('validate() reports missing selector for selector-based action', () => {
    const parser = new CommandParser();
    const invalidClick = { id: 'a1', type: 'click' } as unknown as Action;
    const result = parser.validate(invalidClick);

    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toContain('selector');
  });

  it('validate() reports empty selector as invalid', () => {
    const parser = new CommandParser();
    const invalidClick = { id: 'a1', type: 'click', selector: {} } as unknown as Action;
    const result = parser.validate(invalidClick);

    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toContain('selector must include at least one selector strategy');
  });

  it('validate() rejects blocked URL protocols', () => {
    const parser = new CommandParser({ allowEvaluate: true });
    const result = parser.validate({
      id: 'a-url-1',
      type: 'navigate',
      url: 'javascript:alert(1)',
    });

    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toContain('Blocked scheme');
  });

  it('validate() enforces allowedDomains policy', () => {
    const parser = new CommandParser({
      allowEvaluate: true,
      allowedDomains: ['internal.test'],
    });

    const result = parser.validate({
      id: 'a-url-2',
      type: 'navigate',
      url: 'https://example.com',
    });

    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toContain('Domain is not in allowed list');
  });

  it('validate() enforces blockedSelectors policy', () => {
    const parser = new CommandParser({
      allowEvaluate: true,
      blockedSelectors: ['delete account'],
    });

    const result = parser.validate({
      id: 'a-sel-1',
      type: 'click',
      selector: { text: 'Delete account' },
    } as unknown as Action);

    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toContain('Selector blocked by parser configuration');
  });

  it('blocks non-http URL protocols for navigate actions', () => {
    const parser = new CommandParser({ allowEvaluate: true });

    try {
      parser.parse(JSON.stringify({ actions: [{ type: 'navigate', url: 'javascript:alert(1)' }] }));
      throw new Error('Expected parse to throw');
    } catch (error) {
      expect((error as ExtensionError).code).toBe(ErrorCode.ACTION_BLOCKED);
    }
  });

  it('normalizes scheme-less URLs to https', () => {
    const parser = new CommandParser({ strictMode: false, allowEvaluate: true });
    const result = parser.parse(JSON.stringify({ actions: [{ type: 'navigate', url: 'example.com/path' }] }));

    expect(result.actions[0]).toMatchObject({
      type: 'navigate',
      url: 'https://example.com/path',
    });
  });

  it('strips unknown action fields through schema parsing', () => {
    const parser = new CommandParser({ strictMode: false, allowEvaluate: true });
    const result = parser.parse(
      JSON.stringify({
        actions: [{ type: 'navigate', url: 'https://example.com/path', injected: 'drop-me' }],
      }),
    );

    const action = result.actions[0] as unknown as Record<string, unknown>;
    expect(action.injected).toBeUndefined();
  });

  it('rejects unsafe selector content during parser sanitization', () => {
    const parser = new CommandParser({ allowEvaluate: true });

    try {
      parser.parse(
        JSON.stringify({
          actions: [{ type: 'click', selector: { css: 'div[url(javascript:alert(1))]' } }],
        }),
      );
      throw new Error('Expected parse to throw');
    } catch (error) {
      expect((error as ExtensionError).code).toBe(ErrorCode.ACTION_INVALID);
    }
  });

  it('rejects unsafe evaluate script during parser sanitization', () => {
    const parser = new CommandParser({ allowEvaluate: true });

    try {
      parser.parse(
        JSON.stringify({
          actions: [{ type: 'evaluate', script: 'fetch(\"https://evil.test\")' }],
        }),
      );
      throw new Error('Expected parse to throw');
    } catch (error) {
      expect((error as ExtensionError).code).toBe(ErrorCode.ACTION_BLOCKED);
    }
  });

  it('blocks action when classifier marks it as blocked', () => {
    const parser = new CommandParser({ allowEvaluate: true });

    try {
      parser.parse(
        JSON.stringify({
          actions: [{ type: 'click', selector: { text: 'chrome://extensions' } }],
        }),
      );
      throw new Error('Expected parse to throw');
    } catch (error) {
      expect((error as ExtensionError).code).toBe(ErrorCode.ACTION_BLOCKED);
    }
  });

  it('sanitize() trims description and navigate URL', () => {
    const parser = new CommandParser();
    const sanitized = parser.sanitize({
      id: 'a1',
      type: 'navigate',
      description: '  go to site  ',
      url: '   https://localhost/path  ',
    });

    expect(sanitized.description).toBe('go to site');
    expect(sanitized.url).toBe('https://localhost/path');
  });
});
