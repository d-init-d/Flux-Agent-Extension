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
          { type: 'navigate', url: 'https://example.com' },
          { type: 'click', selector: { text: 'Login' } },
        ],
        summary: 'Navigate and click login',
      }),
    );

    expect(result.thinking).toBe('Need two steps');
    expect(result.summary).toBe('Navigate and click login');
    expect(result.actions).toHaveLength(2);
    expect(result.actions[0]).toMatchObject({ type: 'navigate', url: 'https://example.com' });
    expect(result.actions[0].id).toBeTypeOf('string');
    expect(result.actions[1]).toMatchObject({ type: 'click', selector: { text: 'Login' } });
  });

  it('extracts JSON from markdown code block', () => {
    const parser = new CommandParser();
    const response = [
      'I will do this:',
      '```json',
      '{"actions":[{"type":"navigate","url":"https://github.com"}]}',
      '```',
    ].join('\n');

    const result = parser.parse(response);

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({ type: 'navigate', url: 'https://github.com' });
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

    expect(() =>
      parser.parse(
        JSON.stringify({ actions: [{ type: 'evaluate', script: 'return document.title' }] }),
      ),
    ).toThrowError(ExtensionError);
  });

  it('accepts evaluate action when explicitly enabled', () => {
    const parser = new CommandParser({ allowEvaluate: true });
    const result = parser.parse(
      JSON.stringify({ actions: [{ type: 'evaluate', script: 'return document.title' }] }),
    );

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({ type: 'evaluate' });
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
    expect(result.errors?.[0]).toContain('requires a selector');
  });

  it('sanitize() trims description and navigate URL', () => {
    const parser = new CommandParser();
    const sanitized = parser.sanitize({
      id: 'a1',
      type: 'navigate',
      description: '  go to site  ',
      url: '   https://example.com/path  ',
    });

    expect(sanitized.description).toBe('go to site');
    expect(sanitized.url).toBe('https://example.com/path');
  });
});
