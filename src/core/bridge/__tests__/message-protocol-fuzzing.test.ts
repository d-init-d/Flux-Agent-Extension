import { ContentScriptBridge } from '../content-script-bridge';
import { validateMessage } from '../message-validation';
import { ServiceWorkerBridge } from '../service-worker-bridge';

function getRuntimeOnMessage() {
  return chrome.runtime.onMessage as unknown as {
    addListener: ReturnType<typeof vi.fn>;
    dispatch: (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => void;
  };
}

function getTabsSendMessage() {
  return chrome.tabs.sendMessage as ReturnType<typeof vi.fn>;
}

function validMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fuzz-msg-1',
    type: 'EXECUTE_ACTION',
    timestamp: Date.now(),
    payload: { action: 'click' },
    ...overrides,
  };
}

function makeThrowingGetterObject(property: string) {
  const target: Record<string, unknown> = {};
  Object.defineProperty(target, property, {
    get() {
      throw new Error(`getter exploded for ${property}`);
    },
    enumerable: true,
  });
  return target;
}

function malformedMatrix(): unknown[] {
  const circularPayload: { nested?: unknown } = {};
  circularPayload.nested = circularPayload;

  return [
    null,
    undefined,
    'not-an-object',
    42,
    true,
    Symbol('bridge-message'),
    [1, 2, 3],
    {},
    { id: '', type: 'PING', timestamp: Date.now(), payload: null },
    { id: 'missing-type', timestamp: Date.now(), payload: null },
    { id: 'bad-type', type: 'NOPE', timestamp: Date.now(), payload: null },
    { id: 'bad-timestamp', type: 'PING', timestamp: 'later', payload: null },
    { id: 'stale', type: 'PING', timestamp: Date.now() - 120_000, payload: null },
    { id: 'future', type: 'PING', timestamp: Date.now() + 10_000, payload: null },
    { id: 'missing-payload', type: 'PING', timestamp: Date.now() },
    validMessage({ payload: circularPayload }),
    makeThrowingGetterObject('id'),
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'id') {
            throw new Error('proxy trap exploded');
          }
          return undefined;
        },
      },
    ),
    {
      id: 'evil-type',
      get type() {
        throw new Error('type getter exploded');
      },
      timestamp: Date.now(),
      payload: null,
    },
    {
      id: 'evil-payload',
      type: 'PAGE_LOADED',
      timestamp: Date.now(),
      get payload() {
        throw new Error('payload getter exploded');
      },
    },
    {
      id: 'big-payload',
      type: 'PAGE_LOADED',
      timestamp: Date.now(),
      payload: {
        blob: 'x'.repeat(250_000),
        nested: Array.from({ length: 100 }, (_value, index) => ({ index, value: `v-${index}` })),
      },
    },
  ];
}

describe('message protocol fuzzing', () => {
  describe('validateMessage hardening', () => {
    it('never throws across malformed or hostile message shapes', () => {
      for (const candidate of malformedMatrix()) {
        expect(() => validateMessage(candidate)).not.toThrow();
      }
    });

    it('rejects hostile getter and proxy-backed inputs instead of crashing', () => {
      const hostileInputs = [
        makeThrowingGetterObject('id'),
        new Proxy(
          {},
          {
            get() {
              throw new Error('trap exploded');
            },
          },
        ),
      ];

      for (const input of hostileInputs) {
        expect(validateMessage(input)).toEqual(expect.objectContaining({ valid: false }));
      }
    });
  });

  describe('ContentScriptBridge malformed inbound survival', () => {
    let bridge: ContentScriptBridge;

    beforeEach(() => {
      Object.defineProperty(globalThis, 'location', {
        value: {
          href: 'https://example.com/fuzz',
          origin: 'https://example.com',
        },
        writable: true,
        configurable: true,
      });

      bridge = new ContentScriptBridge();
      bridge.initialize();
    });

    afterEach(() => {
      bridge.destroy();
    });

    it('survives a malformed-message barrage and still handles the next valid command', async () => {
      const handler = vi.fn(async (payload: unknown) => ({ ok: true, payload }));
      bridge.onCommand('EXECUTE_ACTION', handler);

      const sender: chrome.runtime.MessageSender = { id: chrome.runtime.id };

      for (const message of malformedMatrix()) {
        const sendResponse = vi.fn();
        expect(() => {
          getRuntimeOnMessage().dispatch(message, sender, sendResponse);
        }).not.toThrow();
      }

      const validResponse = vi.fn();
      getRuntimeOnMessage().dispatch(
        validMessage({ id: 'after-barrage', payload: { action: 'recover' } }),
        sender,
        validResponse,
      );

      await vi.waitFor(() => {
        expect(validResponse).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'after-barrage',
            type: 'ACTION_RESULT',
            payload: { ok: true, payload: { action: 'recover' } },
          }),
        );
      });

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('rejects replayed ids while continuing to process fresh messages', async () => {
      const handler = vi.fn(async (payload: unknown) => ({ accepted: payload }));
      bridge.onCommand('EXECUTE_ACTION', handler);

      const sender: chrome.runtime.MessageSender = { id: chrome.runtime.id };

      const firstResponse = vi.fn();
      getRuntimeOnMessage().dispatch(
        validMessage({ id: 'replayed-id', payload: { step: 1 } }),
        sender,
        firstResponse,
      );

      await vi.waitFor(() => {
        expect(firstResponse).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'ACTION_RESULT' }),
        );
      });

      const replayResponse = vi.fn();
      getRuntimeOnMessage().dispatch(
        validMessage({ id: 'replayed-id', payload: { step: 2 } }),
        sender,
        replayResponse,
      );

      await vi.waitFor(() => {
        expect(replayResponse).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'ERROR',
            payload: expect.objectContaining({ code: 'REPLAY_DETECTED' }),
          }),
        );
      });

      const freshResponse = vi.fn();
      getRuntimeOnMessage().dispatch(
        validMessage({ id: 'fresh-id', payload: { step: 3 } }),
        sender,
        freshResponse,
      );

      await vi.waitFor(() => {
        expect(freshResponse).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'ACTION_RESULT' }),
        );
      });

      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  describe('ServiceWorkerBridge malformed inbound survival', () => {
    let bridge: ServiceWorkerBridge;

    beforeEach(() => {
      vi.useFakeTimers();
      bridge = new ServiceWorkerBridge();
    });

    afterEach(() => {
      bridge.destroy();
      vi.useRealTimers();
    });

    it('ignores malformed sender messages without crashing and still delivers later events', () => {
      const handler = vi.fn();
      bridge.onEvent('PAGE_LOADED', handler);

      const sender: chrome.runtime.MessageSender = {
        tab: {
          id: 1,
          index: 0,
          windowId: 1,
          highlighted: true,
          active: true,
          pinned: false,
          incognito: false,
          discarded: false,
          autoDiscardable: true,
          groupId: -1,
        },
      };

      for (const message of malformedMatrix()) {
        expect(() => {
          getRuntimeOnMessage().dispatch(message, sender, vi.fn());
        }).not.toThrow();
      }

      getRuntimeOnMessage().dispatch(
        {
          id: 'valid-event',
          type: 'PAGE_LOADED',
          timestamp: Date.now(),
          payload: { url: 'https://example.com/recovered' },
        },
        sender,
        vi.fn(),
      );

      expect(handler).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ url: 'https://example.com/recovered' }),
        { url: 'https://example.com/recovered' },
      );
    });

    it('keeps pending requests alive through malformed responses and resolves on the next valid one', async () => {
      let sentMessageId = '';
      getTabsSendMessage().mockImplementation(
        async (_tabId: number, message: Record<string, unknown>) => {
          sentMessageId = message.id as string;
          return undefined;
        },
      );

      const sendPromise = bridge.send(1, 'GET_PAGE_CONTEXT', null);
      void sendPromise.catch(() => undefined);

      await vi.advanceTimersByTimeAsync(0);

      const sender: chrome.runtime.MessageSender = {
        tab: {
          id: 1,
          index: 0,
          windowId: 1,
          highlighted: true,
          active: true,
          pinned: false,
          incognito: false,
          discarded: false,
          autoDiscardable: true,
          groupId: -1,
        },
      };

      const malformedResponses = [
        null,
        { id: sentMessageId, type: 'PAGE_CONTEXT', timestamp: 'bad', payload: {} },
        {
          id: sentMessageId,
          type: 'PAGE_CONTEXT',
          timestamp: Date.now() + 10_000,
          payload: {},
        },
        {
          id: sentMessageId,
          get type() {
            throw new Error('response type getter exploded');
          },
          timestamp: Date.now(),
          payload: {},
        },
      ];

      for (const response of malformedResponses) {
        expect(() => {
          getRuntimeOnMessage().dispatch(response, sender, vi.fn());
        }).not.toThrow();
      }

      let settled = false;
      void sendPromise.then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);

      getRuntimeOnMessage().dispatch(
        {
          id: sentMessageId,
          type: 'PAGE_CONTEXT',
          timestamp: Date.now(),
          payload: { url: 'https://example.com/ok' },
        },
        sender,
        vi.fn(),
      );

      await expect(sendPromise).resolves.toEqual({ url: 'https://example.com/ok' });
    });
  });
});
