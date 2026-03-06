import { ErrorCode } from '@shared/errors';
import type { ExtractAction, ExtractAllAction, ScreenshotAction } from '@shared/types';
import { SelectorEngine } from '../../dom/selector-engine';
import { executeExtractAction } from '../extract';

describe('executeExtractAction', () => {
  let selectorEngine: SelectorEngine;

  beforeEach(() => {
    document.body.innerHTML = '';
    selectorEngine = new SelectorEngine();
  });

  it('extracts single text content', async () => {
    document.body.innerHTML = '<div id="title">Hello World</div>';

    const action: ExtractAction = {
      id: 'extract-1',
      type: 'extract',
      selector: { css: '#title' },
    };

    const result = await executeExtractAction(action, selectorEngine);

    expect(result.success).toBe(true);
    expect((result.data as { value: string }).value).toBe('Hello World');
  });

  it('extracts multiple attributes from all elements', async () => {
    document.body.innerHTML = '<a class="item" href="/a">A</a><a class="item" href="/b">B</a>';

    const action: ExtractAllAction = {
      id: 'extract-all-1',
      type: 'extractAll',
      selector: { css: '.item' },
      attributes: ['textContent', 'href'],
    };

    const result = await executeExtractAction(action, selectorEngine);
    const items = (result.data as { items: Array<Record<string, unknown>> }).items;

    expect(result.success).toBe(true);
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toBe('A');
    expect(typeof items[0]?.href).toBe('string');
  });

  it('returns svg data url for screenshot action', async () => {
    document.body.innerHTML = '<div id="card">Card</div>';

    const action: ScreenshotAction = {
      id: 'shot-1',
      type: 'screenshot',
      selector: { css: '#card' },
    };

    const result = await executeExtractAction(action, selectorEngine);
    const payload = result.data as { image: string; mimeType: string };

    expect(result.success).toBe(true);
    expect(payload.mimeType).toBe('image/svg+xml');
    expect(payload.image.startsWith('data:image/svg+xml;base64,')).toBe(true);
  });

  it('returns ELEMENT_NOT_FOUND when extraction target is missing', async () => {
    const action: ExtractAction = {
      id: 'extract-missing',
      type: 'extract',
      selector: { css: '#missing' },
    };

    const result = await executeExtractAction(action, selectorEngine);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.ELEMENT_NOT_FOUND);
  });
});
