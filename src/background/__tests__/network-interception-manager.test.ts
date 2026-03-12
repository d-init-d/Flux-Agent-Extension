import { DebuggerAdapter } from '@core/browser-controller';
import { Logger } from '@shared/utils';
import { NetworkInterceptionManager } from '../network-interception-manager';

type DebuggerOnEventMock = {
  dispatch: (source: chrome.debugger.Debuggee, method: string, params?: object) => void;
};

function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function encodeUtf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

describe('NetworkInterceptionManager', () => {
  let manager: NetworkInterceptionManager;

  beforeEach(() => {
    manager = new NetworkInterceptionManager({
      debuggerAdapter: new DebuggerAdapter(),
      logger: new Logger('FluxSW:test', 'debug'),
    });
  });

  it('enables Fetch interception and blocks matching requests', async () => {
    const sendSpy = vi.spyOn(chrome.debugger, 'sendCommand');

    await manager.registerAction('session-1', 1, {
      id: 'rule-block',
      type: 'interceptNetwork',
      urlPatterns: ['https://ads.example.com/*'],
      operation: 'block',
      resourceTypes: ['XHR'],
    });

    const onEvent = chrome.debugger.onEvent as unknown as DebuggerOnEventMock;
    onEvent.dispatch({ tabId: 1 }, 'Fetch.requestPaused', {
      requestId: 'req-1',
      request: { url: 'https://ads.example.com/tracker.js' },
      resourceType: 'XHR',
    });

    await flushAsyncWork();

    expect(sendSpy).toHaveBeenCalledWith({ tabId: 1 }, 'Fetch.enable', {
      patterns: [
        { urlPattern: 'https://ads.example.com/*', resourceType: 'XHR', requestStage: 'Request' },
      ],
    });
    expect(sendSpy).toHaveBeenCalledWith({ tabId: 1 }, 'Fetch.failRequest', {
      requestId: 'req-1',
      errorReason: 'BlockedByClient',
    });
  });

  it('fulfills matching requests with mocked responses', async () => {
    const sendSpy = vi.spyOn(chrome.debugger, 'sendCommand');

    await manager.registerAction('session-2', 1, {
      id: 'rule-mock',
      type: 'mockResponse',
      urlPatterns: ['https://api.example.com/users/*'],
      response: {
        status: 200,
        body: '{"ok":true}',
        contentType: 'application/json',
      },
    });

    const onEvent = chrome.debugger.onEvent as unknown as DebuggerOnEventMock;
    onEvent.dispatch({ tabId: 1 }, 'Fetch.requestPaused', {
      requestId: 'req-2',
      request: { url: 'https://api.example.com/users/42' },
      resourceType: 'XHR',
    });

    await flushAsyncWork();

    expect(sendSpy).toHaveBeenCalledWith({ tabId: 1 }, 'Fetch.fulfillRequest', {
      requestId: 'req-2',
      responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      body: encodeUtf8ToBase64('{"ok":true}'),
    });
  });

  it('lets the latest matching rule win', async () => {
    const sendSpy = vi.spyOn(chrome.debugger, 'sendCommand');

    await manager.registerAction('session-4', 1, {
      id: 'rule-block-all',
      type: 'interceptNetwork',
      urlPatterns: ['https://api.example.com/*'],
      operation: 'block',
      resourceTypes: ['XHR'],
    });
    await manager.registerAction('session-4', 1, {
      id: 'rule-allow-users',
      type: 'interceptNetwork',
      urlPatterns: ['https://api.example.com/users/*'],
      operation: 'continue',
      resourceTypes: ['XHR'],
    });

    const onEvent = chrome.debugger.onEvent as unknown as DebuggerOnEventMock;
    onEvent.dispatch({ tabId: 1 }, 'Fetch.requestPaused', {
      requestId: 'req-3',
      request: { url: 'https://api.example.com/users/42' },
      resourceType: 'XHR',
    });

    await flushAsyncWork();

    expect(sendSpy).toHaveBeenCalledWith({ tabId: 1 }, 'Fetch.continueRequest', {
      requestId: 'req-3',
    });
  });

  it('applies only the active session rules for a shared tab', async () => {
    const sendSpy = vi.spyOn(chrome.debugger, 'sendCommand');

    await manager.registerAction('session-1', 1, {
      id: 'rule-block-session-1',
      type: 'interceptNetwork',
      urlPatterns: ['https://api.example.com/*'],
      operation: 'block',
      resourceTypes: ['XHR'],
    });
    await manager.registerAction('session-2', 1, {
      id: 'rule-continue-session-2',
      type: 'interceptNetwork',
      urlPatterns: ['https://api.example.com/*'],
      operation: 'continue',
      resourceTypes: ['XHR'],
    });

    const onEvent = chrome.debugger.onEvent as unknown as DebuggerOnEventMock;

    manager.activateSession('session-1', 1);
    onEvent.dispatch({ tabId: 1 }, 'Fetch.requestPaused', {
      requestId: 'req-session-1',
      request: { url: 'https://api.example.com/orders' },
      resourceType: 'XHR',
    });

    await flushAsyncWork();

    expect(sendSpy).toHaveBeenCalledWith({ tabId: 1 }, 'Fetch.failRequest', {
      requestId: 'req-session-1',
      errorReason: 'BlockedByClient',
    });

    sendSpy.mockClear();

    manager.activateSession('session-2', 1);
    onEvent.dispatch({ tabId: 1 }, 'Fetch.requestPaused', {
      requestId: 'req-session-2',
      request: { url: 'https://api.example.com/orders' },
      resourceType: 'XHR',
    });

    await flushAsyncWork();

    expect(sendSpy).toHaveBeenCalledWith({ tabId: 1 }, 'Fetch.continueRequest', {
      requestId: 'req-session-2',
    });
  });

  it('rejects non-XHR and non-Fetch resource types', async () => {
    await expect(
      manager.registerAction('session-5', 1, {
        id: 'rule-document-response',
        type: 'mockResponse',
        urlPatterns: ['https://app.example.com/*'],
        resourceTypes: ['Document'],
        response: {
          status: 200,
          body: 'ok',
        },
      }),
    ).rejects.toMatchObject({
      code: 'ACTION_BLOCKED',
    });
  });

  it('rejects authentication endpoint patterns', async () => {
    await expect(
      manager.registerAction('session-5', 1, {
        id: 'rule-auth-endpoint',
        type: 'interceptNetwork',
        urlPatterns: ['https://accounts.example.com/oauth/token'],
        operation: 'block',
        resourceTypes: ['XHR'],
      }),
    ).rejects.toMatchObject({
      code: 'ACTION_BLOCKED',
    });
  });

  it('rejects sensitive response headers in mock responses', async () => {
    await expect(
      manager.registerAction('session-5', 1, {
        id: 'rule-sensitive-header',
        type: 'mockResponse',
        urlPatterns: ['https://api.example.com/users/*'],
        response: {
          status: 200,
          body: 'ok',
          headers: {
            'Set-Cookie': 'session=abc123',
          },
        },
      }),
    ).rejects.toMatchObject({
      code: 'ACTION_BLOCKED',
    });
  });

  it('disables Fetch interception when the last session rule is cleared', async () => {
    const sendSpy = vi.spyOn(chrome.debugger, 'sendCommand');

    await manager.registerAction('session-3', 1, {
      id: 'rule-continue',
      type: 'interceptNetwork',
      urlPatterns: ['https://api.example.com/*'],
      operation: 'continue',
    });

    await manager.clearSession('session-3');

    expect(sendSpy).toHaveBeenCalledWith({ tabId: 1 }, 'Fetch.disable', undefined);
  });
});
