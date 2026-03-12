import { ErrorCode, ExtensionError } from '@shared/errors';

import { DebuggerAdapter } from '../debugger-adapter';

type DebuggerOnDetachMock = {
  dispatch: (source: chrome.debugger.Debuggee, reason: string) => void;
};

describe('DebuggerAdapter', () => {
  let adapter: DebuggerAdapter;

  beforeEach(() => {
    adapter = new DebuggerAdapter();
  });

  it('attaches idempotently and tracks attachment state', async () => {
    await adapter.attach(1);
    await adapter.attach(1);

    expect(adapter.isAttached(1)).toBe(true);
    expect(chrome.tabs.get).toHaveBeenCalledWith(1);
    expect(chrome.debugger.attach).toHaveBeenCalledTimes(1);
    expect(chrome.debugger.attach).toHaveBeenCalledWith({ tabId: 1 }, '1.3');
  });

  it('detaches idempotently and clears attachment state', async () => {
    await adapter.attach(1);

    await adapter.detach(1);
    await adapter.detach(1);

    expect(adapter.isAttached(1)).toBe(false);
    expect(chrome.debugger.detach).toHaveBeenCalledTimes(1);
    expect(chrome.debugger.detach).toHaveBeenCalledWith({ tabId: 1 });
  });

  it('sends command successfully after attaching', async () => {
    vi.spyOn(chrome.debugger, 'sendCommand').mockResolvedValueOnce({ nodeId: 88 });

    const result = await adapter.sendCommand(1, 'DOM.querySelector', {
      nodeId: 1,
      selector: '#submit',
    });

    expect(result).toEqual({ nodeId: 88 });
    expect(chrome.debugger.attach).toHaveBeenCalledWith({ tabId: 1 }, '1.3');
    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith({ tabId: 1 }, 'DOM.querySelector', {
      nodeId: 1,
      selector: '#submit',
    });
  });

  it('handles detach event and updates attached state', async () => {
    await adapter.attach(1);

    const onDetach = chrome.debugger.onDetach as unknown as DebuggerOnDetachMock;
    onDetach.dispatch({ tabId: 1 }, 'target_closed');

    expect(adapter.isAttached(1)).toBe(false);
  });

  it('captures screenshot using CDP wrapper', async () => {
    vi.spyOn(chrome.debugger, 'sendCommand').mockResolvedValueOnce({ data: 'base64-image' });

    const image = await adapter.captureScreenshot(1, { format: 'png' });

    expect(image).toBe('base64-image');
    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 1 },
      'Page.captureScreenshot',
      { format: 'png' },
    );
  });

  it('evaluates expression using Runtime.evaluate wrapper', async () => {
    vi.spyOn(chrome.debugger, 'sendCommand').mockResolvedValueOnce({
      result: { type: 'string', value: 'ok' },
    });

    const response = await adapter.evaluate(1, 'document.title', {
      returnByValue: true,
      awaitPromise: true,
    });

    expect(response).toEqual({ result: { type: 'string', value: 'ok' } });
    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith({ tabId: 1 }, 'Runtime.evaluate', {
      expression: 'document.title',
      returnByValue: true,
      awaitPromise: true,
    });
  });

  it('provides DOM helper wrappers', async () => {
    const sendSpy = vi.spyOn(chrome.debugger, 'sendCommand');
    sendSpy.mockResolvedValueOnce({ root: { nodeId: 1 } }).mockResolvedValueOnce({ nodeId: 12 });

    const documentNode = await adapter.getDocument(1, -1, true);
    const queryResult = await adapter.querySelector(1, 1, '.cta');

    expect(documentNode).toEqual({ root: { nodeId: 1 } });
    expect(queryResult).toEqual({ nodeId: 12 });
    expect(sendSpy).toHaveBeenNthCalledWith(1, { tabId: 1 }, 'DOM.getDocument', {
      depth: -1,
      pierce: true,
    });
    expect(sendSpy).toHaveBeenNthCalledWith(2, { tabId: 1 }, 'DOM.querySelector', {
      nodeId: 1,
      selector: '.cta',
    });
  });

  it('provides Fetch interception wrappers', async () => {
    const sendSpy = vi.spyOn(chrome.debugger, 'sendCommand');

    await adapter.enableFetchInterception(1, [
      { urlPattern: 'https://api.example.com/*', requestStage: 'Request' },
    ]);
    await adapter.continueInterceptedRequest(1, 'req-1');
    await adapter.failInterceptedRequest(1, 'req-2');
    await adapter.fulfillInterceptedRequest(1, 'req-3', {
      responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      body: 'eyJvayI6dHJ1ZX0=',
    });
    await adapter.disableFetchInterception(1);

    expect(sendSpy).toHaveBeenNthCalledWith(1, { tabId: 1 }, 'Fetch.enable', {
      patterns: [{ urlPattern: 'https://api.example.com/*', requestStage: 'Request' }],
    });
    expect(sendSpy).toHaveBeenNthCalledWith(2, { tabId: 1 }, 'Fetch.continueRequest', {
      requestId: 'req-1',
    });
    expect(sendSpy).toHaveBeenNthCalledWith(3, { tabId: 1 }, 'Fetch.failRequest', {
      requestId: 'req-2',
      errorReason: 'BlockedByClient',
    });
    expect(sendSpy).toHaveBeenNthCalledWith(4, { tabId: 1 }, 'Fetch.fulfillRequest', {
      requestId: 'req-3',
      responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      body: 'eyJvayI6dHJ1ZX0=',
    });
    expect(sendSpy).toHaveBeenNthCalledWith(5, { tabId: 1 }, 'Fetch.disable', undefined);
  });

  it('provides device emulation wrappers', async () => {
    const sendSpy = vi.spyOn(chrome.debugger, 'sendCommand');

    await adapter.setDeviceMetricsOverride(1, {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
      screenOrientation: { type: 'portraitPrimary', angle: 0 },
    });
    await adapter.setUserAgentOverride(1, {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      platform: 'iPhone',
    });
    await adapter.setTouchEmulationEnabled(1, { enabled: true, maxTouchPoints: 5 });
    await adapter.setGeolocationOverride(1, {
      latitude: 37.7749,
      longitude: -122.4194,
      accuracy: 25,
    });
    await adapter.clearGeolocationOverride(1);
    await adapter.clearDeviceMetricsOverride(1);

    expect(sendSpy).toHaveBeenNthCalledWith(1, { tabId: 1 }, 'Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
      screenOrientation: { type: 'portraitPrimary', angle: 0 },
    });
    expect(sendSpy).toHaveBeenNthCalledWith(2, { tabId: 1 }, 'Emulation.setUserAgentOverride', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      platform: 'iPhone',
    });
    expect(sendSpy).toHaveBeenNthCalledWith(3, { tabId: 1 }, 'Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: 5,
    });
    expect(sendSpy).toHaveBeenNthCalledWith(4, { tabId: 1 }, 'Emulation.setGeolocationOverride', {
      latitude: 37.7749,
      longitude: -122.4194,
      accuracy: 25,
    });
    expect(sendSpy).toHaveBeenNthCalledWith(
      5,
      { tabId: 1 },
      'Emulation.clearGeolocationOverride',
      undefined,
    );
    expect(sendSpy).toHaveBeenNthCalledWith(
      6,
      { tabId: 1 },
      'Emulation.clearDeviceMetricsOverride',
      undefined,
    );
  });

  it('subscribes to debugger events with tab ids only', async () => {
    const listener = vi.fn();
    const unsubscribe = adapter.onEvent(listener);

    const onEvent = chrome.debugger.onEvent as unknown as {
      dispatch: (source: chrome.debugger.Debuggee, method: string, params?: object) => void;
    };

    onEvent.dispatch({ tabId: 1 }, 'Fetch.requestPaused', {
      requestId: 'req-1',
      request: { url: 'https://api.example.com/users' },
      resourceType: 'XHR',
    });
    onEvent.dispatch({}, 'Fetch.requestPaused', {
      requestId: 'req-2',
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      tabId: 1,
      method: 'Fetch.requestPaused',
      params: {
        requestId: 'req-1',
        request: { url: 'https://api.example.com/users' },
        resourceType: 'XHR',
      },
    });

    unsubscribe();
    onEvent.dispatch({ tabId: 1 }, 'Fetch.requestPaused', { requestId: 'req-3' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('generates PDF using CDP Page.printToPDF wrapper', async () => {
    vi.spyOn(chrome.debugger, 'sendCommand').mockResolvedValueOnce({ data: 'base64-pdf-data' });

    const pdfData = await adapter.printToPDF(1, { landscape: true, printBackground: true });

    expect(pdfData).toBe('base64-pdf-data');
    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith({ tabId: 1 }, 'Page.printToPDF', {
      landscape: true,
      printBackground: true,
    });
  });

  it('generates PDF with default params when none are provided', async () => {
    vi.spyOn(chrome.debugger, 'sendCommand').mockResolvedValueOnce({ data: 'default-pdf' });

    const pdfData = await adapter.printToPDF(1);

    expect(pdfData).toBe('default-pdf');
    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 1 },
      'Page.printToPDF',
      undefined,
    );
  });

  it('throws ACTION_FAILED when printToPDF response has no data', async () => {
    vi.spyOn(chrome.debugger, 'sendCommand').mockResolvedValueOnce({});

    await expect(adapter.printToPDF(1)).rejects.toMatchObject({
      code: ErrorCode.ACTION_FAILED,
    } satisfies Partial<ExtensionError>);
  });

  it('throws ACTION_FAILED when printToPDF response data is empty string', async () => {
    vi.spyOn(chrome.debugger, 'sendCommand').mockResolvedValueOnce({ data: '' });

    await expect(adapter.printToPDF(1)).rejects.toMatchObject({
      code: ErrorCode.ACTION_FAILED,
    } satisfies Partial<ExtensionError>);
  });

  it('maps missing tab to TAB_NOT_FOUND on attach', async () => {
    await expect(adapter.attach(9_999)).rejects.toMatchObject({
      code: ErrorCode.TAB_NOT_FOUND,
    } satisfies Partial<ExtensionError>);
  });

  it('maps permission errors to TAB_PERMISSION_DENIED', async () => {
    vi.spyOn(chrome.debugger, 'attach').mockRejectedValueOnce(new Error('Permission denied'));

    await expect(adapter.attach(1)).rejects.toMatchObject({
      code: ErrorCode.TAB_PERMISSION_DENIED,
    } satisfies Partial<ExtensionError>);
  });

  it('maps closed target failures to TAB_CLOSED', async () => {
    await adapter.attach(1);
    vi.spyOn(chrome.debugger, 'sendCommand').mockRejectedValueOnce(new Error('Target closed'));

    await expect(
      adapter.sendCommand(1, 'Runtime.evaluate', { expression: '1+1' }),
    ).rejects.toMatchObject({
      code: ErrorCode.TAB_CLOSED,
    } satisfies Partial<ExtensionError>);
  });

  it('maps unknown debugger failures to ACTION_FAILED', async () => {
    await adapter.attach(1);
    vi.spyOn(chrome.debugger, 'sendCommand').mockRejectedValueOnce(
      new Error('Something unexpected happened'),
    );

    await expect(
      adapter.sendCommand(1, 'Runtime.evaluate', { expression: '2+2' }),
    ).rejects.toMatchObject({
      code: ErrorCode.ACTION_FAILED,
    } satisfies Partial<ExtensionError>);
  });
});
