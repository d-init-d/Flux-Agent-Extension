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
    uploadFile: { id: 'a13', type: 'uploadFile', selector: { css: '#resume' }, fileIds: ['file-1'] },
    select: { id: 'a14', type: 'select', selector: { css: '#country' }, option: 'US' },
    check: { id: 'a15', type: 'check', selector: { css: '#agree' } },
    uncheck: { id: 'a16', type: 'uncheck', selector: { css: '#agree' } },
    press: { id: 'a17', type: 'press', key: 'Enter' },
    hotkey: { id: 'a18', type: 'hotkey', keys: ['ctrl', 'a'] },
    scroll: { id: 'a19', type: 'scroll', direction: 'down' },
    scrollIntoView: { id: 'a20', type: 'scrollIntoView', selector: { textExact: 'Footer' } },
    wait: { id: 'a21', type: 'wait', duration: 500 },
    waitForElement: { id: 'a22', type: 'waitForElement', selector: { role: 'button' } },
    waitForNavigation: { id: 'a23', type: 'waitForNavigation' },
    waitForNetwork: { id: 'a24', type: 'waitForNetwork', state: 'idle' },
    extract: { id: 'a25', type: 'extract', selector: { css: '.title' } },
    extractAll: { id: 'a26', type: 'extractAll', selector: { css: '.row' } },
    screenshot: { id: 'a27', type: 'screenshot' },
    fullPageScreenshot: { id: 'a28', type: 'fullPageScreenshot' },
    newTab: { id: 'a29', type: 'newTab' },
    closeTab: { id: 'a30', type: 'closeTab' },
    switchTab: { id: 'a31', type: 'switchTab', tabIndex: 0 },
    evaluate: { id: 'a32', type: 'evaluate', script: 'return document.title;' },
    emulateDevice: { id: 'a33', type: 'emulateDevice', preset: 'iphone', orientation: 'portrait' },
    interceptNetwork: {
      id: 'a34',
      type: 'interceptNetwork',
      urlPatterns: ['https://api.example.com/*'],
      operation: 'block',
      resourceTypes: ['XHR'],
    },
    mockResponse: {
      id: 'a35',
      type: 'mockResponse',
      urlPatterns: ['https://api.example.com/users/*'],
      response: {
        status: 200,
        body: '{"ok":true}',
        contentType: 'application/json',
      },
    },
    mockGeolocation: {
      id: 'a36',
      type: 'mockGeolocation',
      latitude: 37.7749,
      longitude: -122.4194,
      accuracy: 25,
    },
    savePdf: { id: 'a37', type: 'savePdf' },
  };

  it('covers and validates all action types', () => {
    expect(ACTION_TYPES).toHaveLength(37);

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

  it('requires urlPatterns for network interception actions', () => {
    const interceptResult = validateActionSchema({ id: 'x5', type: 'interceptNetwork', operation: 'block' });
    const mockResult = validateActionSchema({
      id: 'x6',
      type: 'mockResponse',
      response: { status: 200, body: 'ok' },
    });

    expect(interceptResult.valid).toBe(false);
    expect(interceptResult.errors?.[0]).toContain('urlPatterns');
    expect(mockResult.valid).toBe(false);
    expect(mockResult.errors?.[0]).toContain('urlPatterns');
  });

  it('requires at least one staged file id for upload actions', () => {
    const result = validateActionSchema({ id: 'x-upload', type: 'uploadFile', selector: { css: '#resume' }, fileIds: [] });

    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toContain('fileIds');
  });

  it('accepts frame targeting inside selectors for iframe interactions', () => {
    const result = validateActionSchema({
      id: 'x-frame',
      type: 'click',
      selector: {
        textExact: 'Pay now',
        frame: {
          mode: 'url',
          urlPattern: 'https://pay.example.com/*',
        },
      },
    });

    expect(result.valid).toBe(true);
  });

  it('requires a valid mock response payload', () => {
    const missingResponse = validateActionSchema({
      id: 'x7',
      type: 'mockResponse',
      urlPatterns: ['https://api.example.com/*'],
    });
    const invalidStatus = validateActionSchema({
      id: 'x8',
      type: 'mockResponse',
      urlPatterns: ['https://api.example.com/*'],
      response: { status: 99, body: 'ok' },
    });

    expect(missingResponse.valid).toBe(false);
    expect(missingResponse.errors?.[0]).toContain('response');
    expect(invalidStatus.valid).toBe(false);
    expect(invalidStatus.errors?.[0]).toContain('response.status');
  });

  it('rejects invalid geolocation coordinates', () => {
    const invalidLatitude = validateActionSchema({
      id: 'x9',
      type: 'mockGeolocation',
      latitude: 91,
      longitude: -122.4194,
    });

    expect(invalidLatitude.valid).toBe(false);
    expect(invalidLatitude.errors?.[0]).toContain('latitude');
  });

  it('accepts savePdf with all optional parameters', () => {
    const result = validateActionSchema({
      id: 'pdf-full',
      type: 'savePdf',
      filename: 'report.pdf',
      landscape: true,
      printBackground: true,
      scale: 0.8,
      paperWidth: 8.5,
      paperHeight: 11,
      marginTop: 0.5,
      marginRight: 0.5,
      marginBottom: 0.5,
      marginLeft: 0.5,
      pageRanges: '1-3',
      headerTemplate: '<span>Header</span>',
      footerTemplate: '<span>Footer</span>',
      displayHeaderFooter: true,
      preferCSSPageSize: false,
    });

    expect(result.valid).toBe(true);
  });

  it('accepts savePdf with no optional parameters', () => {
    const result = validateActionSchema({ id: 'pdf-minimal', type: 'savePdf' });

    expect(result.valid).toBe(true);
  });
});
