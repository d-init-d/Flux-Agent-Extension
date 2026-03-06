import { ErrorCode } from '@shared/errors';
import type { ScrollAction, ScrollIntoViewAction } from '@shared/types';
import { SelectorEngine } from '../../dom/selector-engine';
import { executeScrollAction } from '../scroll';

describe('executeScrollAction', () => {
  let selectorEngine: SelectorEngine;

  beforeEach(() => {
    document.body.innerHTML = '';
    selectorEngine = new SelectorEngine();
  });

  it('scrolls window down by default amount', async () => {
    const scrollBySpy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);

    const action: ScrollAction = {
      id: 'scroll-1',
      type: 'scroll',
      direction: 'down',
    };

    const result = await executeScrollAction(action, selectorEngine);

    expect(result.success).toBe(true);
    expect(scrollBySpy).toHaveBeenCalledWith({ left: 0, top: 500, behavior: 'auto' });
    scrollBySpy.mockRestore();
  });

  it('scrolls target element by amount', async () => {
    document.body.innerHTML = '<div id="panel" style="overflow: auto; height: 100px"></div>';
    const panel = document.getElementById('panel') as HTMLDivElement;
    const scrollBySpy = vi.fn();
    (panel as HTMLElement & { scrollBy: typeof scrollBySpy }).scrollBy = scrollBySpy;

    const action: ScrollAction = {
      id: 'scroll-2',
      type: 'scroll',
      direction: 'right',
      amount: 120,
      selector: { css: '#panel' },
    };

    const result = await executeScrollAction(action, selectorEngine);

    expect(result.success).toBe(true);
    expect(scrollBySpy).toHaveBeenCalledWith({ left: 120, top: 0, behavior: 'auto' });
  });

  it('scrolls element into view', async () => {
    document.body.innerHTML = '<button id="target">Target</button>';
    const button = document.getElementById('target') as HTMLButtonElement;
    const scrollIntoViewSpy = vi.fn();
    (button as HTMLElement & { scrollIntoView: typeof scrollIntoViewSpy }).scrollIntoView = scrollIntoViewSpy;

    const action: ScrollIntoViewAction = {
      id: 'scroll-into-view',
      type: 'scrollIntoView',
      selector: { css: '#target' },
      block: 'end',
    };

    const result = await executeScrollAction(action, selectorEngine);

    expect(result.success).toBe(true);
    expect(scrollIntoViewSpy).toHaveBeenCalledWith({ block: 'end', inline: 'nearest', behavior: 'auto' });
  });

  it('returns ELEMENT_NOT_FOUND when scroll target is missing', async () => {
    const action: ScrollIntoViewAction = {
      id: 'missing',
      type: 'scrollIntoView',
      selector: { css: '#missing' },
    };

    const result = await executeScrollAction(action, selectorEngine);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.ELEMENT_NOT_FOUND);
  });
});
