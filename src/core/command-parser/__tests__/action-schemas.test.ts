import type { ActionType } from '@shared/types';
import { ACTION_TYPES, validateActionSchema } from '../schemas';

describe('action schemas', () => {
  const validActionsByType: Record<ActionType, Record<string, unknown>> = {
    navigate: { id: 'a1', type: 'navigate', url: 'https://example.com' },
    goBack: { id: 'a2', type: 'goBack' },
    goForward: { id: 'a3', type: 'goForward' },
    reload: { id: 'a4', type: 'reload' },
    click: { id: 'a5', type: 'click', selector: { text: 'Submit' } },
    doubleClick: { id: 'a6', type: 'doubleClick', selector: { css: '#item' } },
    rightClick: { id: 'a7', type: 'rightClick', selector: { testId: 'menu' } },
    hover: { id: 'a8', type: 'hover', selector: { ariaLabel: 'Profile' } },
    focus: { id: 'a9', type: 'focus', selector: { placeholder: 'Search' } },
    fill: { id: 'a10', type: 'fill', selector: { css: '#email' }, value: 'user@example.com' },
    type: { id: 'a11', type: 'type', selector: { css: '#code' }, text: '123456' },
    clear: { id: 'a12', type: 'clear', selector: { css: '#input' } },
    select: { id: 'a13', type: 'select', selector: { css: '#country' }, option: 'US' },
    check: { id: 'a14', type: 'check', selector: { css: '#agree' } },
    uncheck: { id: 'a15', type: 'uncheck', selector: { css: '#agree' } },
    press: { id: 'a16', type: 'press', key: 'Enter' },
    hotkey: { id: 'a17', type: 'hotkey', keys: ['ctrl', 'a'] },
    scroll: { id: 'a18', type: 'scroll', direction: 'down' },
    scrollIntoView: { id: 'a19', type: 'scrollIntoView', selector: { textExact: 'Footer' } },
    wait: { id: 'a20', type: 'wait', duration: 500 },
    waitForElement: { id: 'a21', type: 'waitForElement', selector: { role: 'button' } },
    waitForNavigation: { id: 'a22', type: 'waitForNavigation' },
    waitForNetwork: { id: 'a23', type: 'waitForNetwork', state: 'idle' },
    extract: { id: 'a24', type: 'extract', selector: { css: '.title' } },
    extractAll: { id: 'a25', type: 'extractAll', selector: { css: '.row' } },
    screenshot: { id: 'a26', type: 'screenshot' },
    fullPageScreenshot: { id: 'a27', type: 'fullPageScreenshot' },
    newTab: { id: 'a28', type: 'newTab' },
    closeTab: { id: 'a29', type: 'closeTab' },
    switchTab: { id: 'a30', type: 'switchTab', tabIndex: 0 },
    evaluate: { id: 'a31', type: 'evaluate', script: 'return document.title;' },
    interceptNetwork: { id: 'a32', type: 'interceptNetwork' },
    mockResponse: { id: 'a33', type: 'mockResponse' },
  };

  it('covers and validates all action types', () => {
    expect(ACTION_TYPES).toHaveLength(33);

    for (const type of ACTION_TYPES) {
      const result = validateActionSchema(validActionsByType[type]);
      expect(result.valid).toBe(true);
    }
  });

  it('rejects unknown action type', () => {
    const result = validateActionSchema({ id: 'x1', type: 'not-real' });

    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toContain('type');
  });

  it('enforces selector requirements for selector-based actions', () => {
    const missingSelector = validateActionSchema({ id: 'x2', type: 'click' });
    const emptySelector = validateActionSchema({ id: 'x3', type: 'click', selector: {} });

    expect(missingSelector.valid).toBe(false);
    expect(missingSelector.errors?.[0]).toContain('selector');
    expect(emptySelector.valid).toBe(false);
    expect(emptySelector.errors?.[0]).toContain('selector must include at least one selector strategy');
  });

  it('rejects invalid action payload shape', () => {
    const result = validateActionSchema({ id: 'x4', type: 'navigate' });

    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toContain('url');
  });
});
