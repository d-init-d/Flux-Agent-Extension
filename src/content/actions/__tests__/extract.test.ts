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

  it('extracts specific attribute from element', async () => {
    document.body.innerHTML =
      '<a id="link" href="https://example.com" data-custom="custom-val">Link</a>';

    const action: ExtractAction = {
      id: 'extract-attr',
      type: 'extract',
      selector: { css: '#link' },
      attribute: 'href',
    };

    const result = await executeExtractAction(action, selectorEngine);

    expect(result.success).toBe(true);
    expect((result.data as { value: string }).value).toContain('example.com');
  });

  it('extracts innerHTML from element', async () => {
    document.body.innerHTML = '<div id="content"><strong>Bold</strong></div>';

    const action: ExtractAction = {
      id: 'extract-inner',
      type: 'extract',
      selector: { css: '#content' },
      attribute: 'innerHTML',
    };

    const result = await executeExtractAction(action, selectorEngine);

    expect(result.success).toBe(true);
    expect((result.data as { value: string }).value).toContain('<strong>Bold</strong>');
  });

  it('extracts outerHTML from element', async () => {
    document.body.innerHTML = '<span id="tag">Text</span>';

    const action: ExtractAction = {
      id: 'extract-outer',
      type: 'extract',
      selector: { css: '#tag' },
      attribute: 'outerHTML',
    };

    const result = await executeExtractAction(action, selectorEngine);

    expect(result.success).toBe(true);
    expect((result.data as { value: string }).value).toContain('<span');
  });

  it('extracts getAttribute fallback for unknown attributes', async () => {
    document.body.innerHTML = '<div id="el" data-foo="bar">Content</div>';

    const action: ExtractAction = {
      id: 'extract-data',
      type: 'extract',
      selector: { css: '#el' },
      attribute: 'data-foo',
    };

    const result = await executeExtractAction(action, selectorEngine);

    expect(result.success).toBe(true);
    expect((result.data as { value: string }).value).toBe('bar');
  });

  it('returns ELEMENT_NOT_FOUND when extractAll finds no matches', async () => {
    const action: ExtractAllAction = {
      id: 'extractall-missing',
      type: 'extractAll',
      selector: { css: '.nonexistent' },
      attributes: ['textContent'],
    };

    const result = await executeExtractAction(action, selectorEngine);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.ELEMENT_NOT_FOUND);
  });

  it('extractAll defaults to textContent when attributes is empty', async () => {
    document.body.innerHTML = '<span class="item">A</span><span class="item">B</span>';

    const action: ExtractAllAction = {
      id: 'extractall-default',
      type: 'extractAll',
      selector: { css: '.item' },
      attributes: [],
    };

    const result = await executeExtractAction(action, selectorEngine);
    const items = (result.data as { items: Array<Record<string, unknown>> }).items;

    expect(result.success).toBe(true);
    expect(items[0]?.textContent).toBe('A');
  });

  it('extractAll respects limit', async () => {
    document.body.innerHTML =
      '<span class="item">A</span><span class="item">B</span><span class="item">C</span>';

    const action: ExtractAllAction = {
      id: 'extractall-limit',
      type: 'extractAll',
      selector: { css: '.item' },
      attributes: ['textContent'],
      limit: 2,
    };

    const result = await executeExtractAction(action, selectorEngine);
    const items = (result.data as { items: Array<Record<string, unknown>> }).items;

    expect(result.success).toBe(true);
    expect(items).toHaveLength(2);
  });

  it('takes screenshot of body when no selector provided', async () => {
    document.body.innerHTML = '<div>Content</div>';

    const action: ScreenshotAction = {
      id: 'shot-body',
      type: 'screenshot',
    };

    const result = await executeExtractAction(action, selectorEngine);

    expect(result.success).toBe(true);
    const payload = result.data as { image: string; mimeType: string };
    expect(payload.mimeType).toBe('image/svg+xml');
  });

  it('returns ELEMENT_NOT_FOUND when screenshot selector is missing', async () => {
    const action: ScreenshotAction = {
      id: 'shot-missing',
      type: 'screenshot',
      selector: { css: '#missing' },
    };

    const result = await executeExtractAction(action, selectorEngine);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.ELEMENT_NOT_FOUND);
  });

  it('handles fullPageScreenshot action', async () => {
    const action = {
      id: 'full-page',
      type: 'fullPageScreenshot' as const,
    };

    const result = await executeExtractAction(action as ExtractAction, selectorEngine);

    expect(result.success).toBe(true);
    const payload = result.data as { image: string; mimeType: string };
    expect(payload.mimeType).toBe('image/svg+xml');
  });
});
