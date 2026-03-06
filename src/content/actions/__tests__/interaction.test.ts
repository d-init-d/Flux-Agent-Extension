import { ErrorCode } from '@shared/errors';
import type { ClickAction, FocusAction, HoverAction } from '@shared/types';
import { SelectorEngine } from '../../dom/selector-engine';
import { executeInteractionAction } from '../interaction';

describe('executeInteractionAction', () => {
  let selectorEngine: SelectorEngine;

  beforeEach(() => {
    document.body.innerHTML = '';
    selectorEngine = new SelectorEngine();
  });

  it('executes click action successfully', async () => {
    document.body.innerHTML = '<button id="target">Click me</button>';
    const button = document.getElementById('target') as HTMLButtonElement;
    const clickSpy = vi.spyOn(button, 'click');

    const action: ClickAction = {
      id: 'a-click',
      type: 'click',
      selector: { css: '#target' },
    };

    const result = await executeInteractionAction(action, selectorEngine);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('executes doubleClick action successfully', async () => {
    document.body.innerHTML = '<button id="target">Double</button>';
    const button = document.getElementById('target') as HTMLButtonElement;
    const dblClickListener = vi.fn();
    button.addEventListener('dblclick', dblClickListener);

    const action: ClickAction = {
      id: 'a-double-click',
      type: 'doubleClick',
      selector: { css: '#target' },
    };

    const result = await executeInteractionAction(action, selectorEngine);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(dblClickListener).toHaveBeenCalledTimes(1);
  });

  it('executes rightClick action successfully', async () => {
    document.body.innerHTML = '<button id="target">Right</button>';
    const button = document.getElementById('target') as HTMLButtonElement;
    const contextMenuListener = vi.fn((event: MouseEvent) => event.button);
    button.addEventListener('contextmenu', contextMenuListener);

    const action: ClickAction = {
      id: 'a-right-click',
      type: 'rightClick',
      selector: { css: '#target' },
    };

    const result = await executeInteractionAction(action, selectorEngine);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(contextMenuListener).toHaveBeenCalledTimes(1);
    expect(contextMenuListener.mock.calls[0]?.[0]).toBeInstanceOf(MouseEvent);
    expect((contextMenuListener.mock.calls[0]?.[0] as MouseEvent).button).toBe(2);
  });

  it('executes hover action successfully', async () => {
    document.body.innerHTML = '<button id="target">Hover</button>';
    const button = document.getElementById('target') as HTMLButtonElement;
    const mouseOverListener = vi.fn();
    button.addEventListener('mouseover', mouseOverListener);

    const action: HoverAction = {
      id: 'a-hover',
      type: 'hover',
      selector: { css: '#target' },
    };

    const result = await executeInteractionAction(action, selectorEngine);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(mouseOverListener).toHaveBeenCalledTimes(1);
  });

  it('executes focus action successfully', async () => {
    document.body.innerHTML = '<input id="target" />';

    const action: FocusAction = {
      id: 'a-focus',
      type: 'focus',
      selector: { css: '#target' },
    };

    const result = await executeInteractionAction(action, selectorEngine);
    const input = document.getElementById('target') as HTMLInputElement;

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(document.activeElement).toBe(input);
  });

  it('returns ELEMENT_NOT_FOUND when selector resolves no element', async () => {
    const action: HoverAction = {
      id: 'a-not-found',
      type: 'hover',
      selector: { css: '#missing' },
    };

    const result = await executeInteractionAction(action, selectorEngine);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.ELEMENT_NOT_FOUND);
    expect(result.error?.message).toContain('Element not found');
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });
});
