/**
 * @module service-worker-bridge.test
 * @description Tests for ServiceWorkerBridge.
 *
 * Covers: send/response lifecycle, sendOneWay, onEvent, isReady, ensureContentScript,
 * destroy, timeout handling, replay protection, and error paths.
 */

import { ServiceWorkerBridge } from '../service-worker-bridge';
import { ErrorCode } from '@shared/errors';
import { ExtensionError } from '@shared/errors';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get the chrome mock's runtime.onMessage so we can dispatch
 * simulated messages from content scripts.
 */
function getRuntimeOnMessage() {
  return chrome.runtime.onMessage as unknown as {
    addListener: ReturnType<typeof vi.fn>;
    removeListener: ReturnType<typeof vi.fn>;
    dispatch: (...args: unknown[]) => void;
    listenerCount: () => number;
  };
}

/**
 * Get the chrome mock's tabs.sendMessage mock.
 */
function getTabsSendMessage() {
  return chrome.tabs.sendMessage as ReturnType<typeof vi.fn>;
}

/**
 * Get the chrome mock's scripting.executeScript mock.
 */
function getScriptingExecuteScript() {
  return chrome.scripting.executeScript as ReturnType<typeof vi.fn>;
}

/**
 * Simulate a content script sending a response message to the service worker
 * via chrome.runtime.onMessage.
 */
function simulateIncomingMessage(
  message: Record<string, unknown>,
  senderTabId: number = 1,
) {
  const sender: chrome.runtime.MessageSender = {
    tab: {
      id: senderTabId,
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

  const sendResponse = vi.fn();
  getRuntimeOnMessage().dispatch(message, sender, sendResponse);
  return sendResponse;
}

// ============================================================================
// Tests
// ============================================================================

describe('ServiceWorkerBridge', () => {
  let bridge: ServiceWorkerBridge;

  beforeEach(() => {
    vi.useFakeTimers();
    bridge = new ServiceWorkerBridge();
  });

  afterEach(() => {
    bridge.destroy();
    vi.useRealTimers();
  });

  // --------------------------------------------------------------------------
  // Constructor / Lifecycle
  // --------------------------------------------------------------------------

  describe('constructor', () => {
    it('should register a chrome.runtime.onMessage listener', () => {
      expect(getRuntimeOnMessage().addListener).toHaveBeenCalledTimes(1);
    });
  });

  describe('destroy()', () => {
    it('should remove the chrome.runtime.onMessage listener', () => {
      bridge.destroy();
      expect(getRuntimeOnMessage().removeListener).toHaveBeenCalledTimes(1);
    });

    it('should reject all pending requests with ABORTED', async () => {
      // Set up tabs.sendMessage to never resolve (simulate a pending request)
      getTabsSendMessage().mockReturnValue(new Promise(() => {}));

      const sendPromise = bridge.send(1, 'PING', null);
      void sendPromise.catch(() => undefined);

      bridge.destroy();

      await expect(sendPromise).rejects.toMatchObject({
        code: ErrorCode.ABORTED,
      });
    });

    it('should be safe to call destroy multiple times', () => {
      bridge.destroy();
      expect(() => bridge.destroy()).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // send()
  // --------------------------------------------------------------------------

  describe('send()', () => {
    it('should send a BridgeMessage via chrome.tabs.sendMessage', async () => {
      getTabsSendMessage().mockImplementation((_tabId: number, message: Record<string, unknown>) => {
        return Promise.resolve({
          id: message.id,
          type: 'ACTION_RESULT',
          timestamp: Date.now(),
          payload: { ok: true },
        });
      });

      await bridge.send(1, 'EXECUTE_ACTION', { action: 'click' });

      expect(getTabsSendMessage()).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          type: 'EXECUTE_ACTION',
          payload: { action: 'click' },
        }),
        undefined,
      );
    });

    it('should resolve when tabs.sendMessage returns a BridgeMessage response', async () => {
      getTabsSendMessage().mockImplementation((_tabId: number, message: Record<string, unknown>) => {
        return Promise.resolve({
          id: message.id,
          type: 'ACTION_RESULT',
          timestamp: Date.now(),
          payload: { success: true },
        });
      });

      const result = await bridge.send(1, 'EXECUTE_ACTION', { action: 'click' });
      expect(result).toEqual({ success: true });
    });

    it('should resolve when response arrives via onMessage listener', async () => {
      // tabs.sendMessage returns undefined (content script uses async sendResponse)
      let sentMessageId: string | null = null;
      getTabsSendMessage().mockImplementation((_tabId: number, message: Record<string, unknown>) => {
        sentMessageId = message.id as string;
        return Promise.resolve(undefined);
      });

      const sendPromise = bridge.send(1, 'GET_PAGE_CONTEXT', null);

      // Wait for the send to execute
      await vi.advanceTimersByTimeAsync(0);

      // Simulate response from content script via onMessage
      simulateIncomingMessage({
        id: sentMessageId!,
        type: 'PAGE_CONTEXT',
        timestamp: Date.now(),
        payload: { url: 'https://example.com' },
      });

      const result = await sendPromise;
      expect(result).toEqual({ url: 'https://example.com' });
    });

    it('should reject with TIMEOUT when no response arrives', async () => {
      getTabsSendMessage().mockReturnValue(new Promise(() => {}));

      const sendPromise = bridge.send(1, 'PING', null);
      void sendPromise.catch(() => undefined);

      // Advance past the 10s default timeout
      vi.advanceTimersByTime(11_000);

      await expect(sendPromise).rejects.toMatchObject({
        code: ErrorCode.TIMEOUT,
      });
    });

    it('should reject with CONTENT_SCRIPT_NOT_READY when tabs.sendMessage fails', async () => {
      getTabsSendMessage().mockRejectedValue(
        new Error('Could not establish connection'),
      );

      const sendPromise = bridge.send(1, 'PING', null);
      void sendPromise.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(0);

      await expect(sendPromise).rejects.toMatchObject({
        code: ErrorCode.CONTENT_SCRIPT_NOT_READY,
      });
    });

    it('should reject with ACTION_FAILED when content script returns ERROR type', async () => {
      let sentMessageId: string | null = null;
      getTabsSendMessage().mockImplementation((_tabId: number, message: Record<string, unknown>) => {
        sentMessageId = message.id as string;
        return Promise.resolve(undefined);
      });

      const sendPromise = bridge.send(1, 'EXECUTE_ACTION', { action: 'click' });
      void sendPromise.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(0);

      simulateIncomingMessage({
        id: sentMessageId!,
        type: 'ERROR',
        timestamp: Date.now(),
        payload: { code: 'ACTION_FAILED', message: 'Element not found' },
      });

      await expect(sendPromise).rejects.toMatchObject({
        code: ErrorCode.ACTION_FAILED,
      });
    });
  });

  // --------------------------------------------------------------------------
  // sendOneWay()
  // --------------------------------------------------------------------------

  describe('sendOneWay()', () => {
    it('should send a message via chrome.tabs.sendMessage', () => {
      getTabsSendMessage().mockResolvedValue(undefined);

      bridge.sendOneWay(1, 'CLEAR_HIGHLIGHTS', null);

      expect(getTabsSendMessage()).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          type: 'CLEAR_HIGHLIGHTS',
          payload: null,
        }),
        undefined,
      );
    });

    it('should not throw when tabs.sendMessage rejects', () => {
      getTabsSendMessage().mockRejectedValue(new Error('No listener'));

      // Should not throw synchronously
      expect(() => bridge.sendOneWay(1, 'CLEAR_HIGHLIGHTS', null)).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // onEvent()
  // --------------------------------------------------------------------------

  describe('onEvent()', () => {
    it('should invoke handler when matching event arrives from a content script', () => {
      const handler = vi.fn();
      bridge.onEvent('PAGE_LOADED', handler);

      simulateIncomingMessage(
        {
          id: 'event-1',
          type: 'PAGE_LOADED',
          timestamp: Date.now(),
          payload: { url: 'https://example.com' },
        },
        1,
      );

      expect(handler).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          frameId: 0,
          isTop: true,
          url: 'https://example.com',
        }),
        { url: 'https://example.com' },
      );
    });

    it('should not invoke handler for non-matching event type', () => {
      const handler = vi.fn();
      bridge.onEvent('PAGE_LOADED', handler);

      simulateIncomingMessage({
        id: 'event-2',
        type: 'DOM_MUTATION',
        timestamp: Date.now(),
        payload: { changes: [] },
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should support multiple handlers for the same event type', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      bridge.onEvent('PAGE_LOADED', handler1);
      bridge.onEvent('PAGE_LOADED', handler2);

      simulateIncomingMessage({
        id: 'event-3',
        type: 'PAGE_LOADED',
        timestamp: Date.now(),
        payload: { url: 'https://test.com' },
      });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should return an unsubscribe function that removes the handler', () => {
      const handler = vi.fn();
      const unsub = bridge.onEvent('PAGE_LOADED', handler);

      unsub();

      simulateIncomingMessage({
        id: 'event-4',
        type: 'PAGE_LOADED',
        timestamp: Date.now(),
        payload: {},
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should reject replayed event messages', () => {
      const handler = vi.fn();
      bridge.onEvent('PAGE_LOADED', handler);

      const eventMsg = {
        id: 'event-replay',
        type: 'PAGE_LOADED',
        timestamp: Date.now(),
        payload: { url: 'https://example.com' },
      };

      simulateIncomingMessage(eventMsg);
      simulateIncomingMessage(eventMsg); // replay

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should ignore messages without a sender tab (not from content script)', () => {
      const handler = vi.fn();
      bridge.onEvent('PAGE_LOADED', handler);

      // Dispatch with no tab in sender
      const sender: chrome.runtime.MessageSender = {};
      const sendResponse = vi.fn();
      getRuntimeOnMessage().dispatch(
        {
          id: 'no-tab',
          type: 'PAGE_LOADED',
          timestamp: Date.now(),
          payload: {},
        },
        sender,
        sendResponse,
      );

      expect(handler).not.toHaveBeenCalled();
    });

    it('should not crash when event handler throws', () => {
      const throwingHandler = vi.fn(() => {
        throw new Error('handler boom');
      });
      const goodHandler = vi.fn();

      bridge.onEvent('PAGE_LOADED', throwingHandler);
      bridge.onEvent('PAGE_LOADED', goodHandler);

      simulateIncomingMessage({
        id: 'event-err',
        type: 'PAGE_LOADED',
        timestamp: Date.now(),
        payload: {},
      });

      // The good handler should still be called
      expect(goodHandler).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  // isReady()
  // --------------------------------------------------------------------------

  describe('isReady()', () => {
    it('should return true when content script responds to PING', async () => {
      getTabsSendMessage().mockImplementation((_tabId: number, message: Record<string, unknown>) => {
        return Promise.resolve({
          id: message.id,
          type: 'PONG',
          timestamp: Date.now(),
          payload: { pong: true },
        });
      });

      const ready = await bridge.isReady(1);
      expect(ready).toBe(true);
    });

    it('should return false when PING times out', async () => {
      getTabsSendMessage().mockReturnValue(new Promise(() => {}));

      const readyPromise = bridge.isReady(1);

      // Advance past the 2s PING timeout
      vi.advanceTimersByTime(3_000);

      const ready = await readyPromise;
      expect(ready).toBe(false);
    });

    it('should return false when tabs.sendMessage rejects', async () => {
      getTabsSendMessage().mockRejectedValue(new Error('No connection'));

      const readyPromise = bridge.isReady(1);
      await vi.advanceTimersByTimeAsync(0);

      const ready = await readyPromise;
      expect(ready).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // ensureContentScript()
  // --------------------------------------------------------------------------

  describe('ensureContentScript()', () => {
    it('should skip injection if content script is already ready', async () => {
      getTabsSendMessage().mockImplementation((_tabId: number, message: Record<string, unknown>) => {
        return Promise.resolve({
          id: message.id,
          type: 'PONG',
          timestamp: Date.now(),
          payload: { pong: true },
        });
      });

      await bridge.ensureContentScript(1);

      expect(getScriptingExecuteScript()).not.toHaveBeenCalled();
    });

    it('should inject and retry when content script is not ready initially', async () => {
      let callCount = 0;

      getTabsSendMessage().mockImplementation((_tabId: number, message: Record<string, unknown>) => {
        callCount++;
        if (callCount <= 1) {
          // First call (isReady check) — fails
          return Promise.reject(new Error('No connection'));
        }
        // Subsequent calls (retry after injection) — succeeds
        return Promise.resolve({
          id: message.id,
          type: 'PONG',
          timestamp: Date.now(),
          payload: { pong: true },
        });
      });

      const ensurePromise = bridge.ensureContentScript(1);

      // Advance through the retry delay (500ms)
      await vi.advanceTimersByTimeAsync(600);

      await ensurePromise;

      expect(getScriptingExecuteScript()).toHaveBeenCalledWith(
        expect.objectContaining({
          target: { tabId: 1, allFrames: true },
          files: ['content/index.js'],
        }),
      );
    });

    it('should throw CONTENT_SCRIPT_INJECTION_FAILED when executeScript fails', async () => {
      getTabsSendMessage().mockRejectedValue(new Error('No connection'));
      getScriptingExecuteScript().mockRejectedValue(
        new Error('Cannot access chrome:// URLs'),
      );

      const ensurePromise = bridge.ensureContentScript(1);
      void ensurePromise.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(0);

      await expect(ensurePromise).rejects.toMatchObject({
        code: ErrorCode.CONTENT_SCRIPT_INJECTION_FAILED,
      });
    });

    it('should throw CONTENT_SCRIPT_INJECTION_FAILED after all retries fail', async () => {
      // isReady always returns false
      getTabsSendMessage().mockRejectedValue(new Error('No connection'));
      // But injection itself succeeds
      getScriptingExecuteScript().mockResolvedValue([
        { documentId: 'doc', frameId: 0, result: undefined },
      ]);

      const ensurePromise = bridge.ensureContentScript(1);
      void ensurePromise.catch(() => undefined);

      // Advance through 3 retries × 500ms each + some buffer
      await vi.advanceTimersByTimeAsync(5_000);

      await expect(ensurePromise).rejects.toMatchObject({
        code: ErrorCode.CONTENT_SCRIPT_INJECTION_FAILED,
      });
    });
  });

  // --------------------------------------------------------------------------
  // Message validation (incoming messages)
  // --------------------------------------------------------------------------

  describe('incoming message validation', () => {
    it('should ignore structurally invalid messages', () => {
      const handler = vi.fn();
      bridge.onEvent('PAGE_LOADED', handler);

      // Send a message with no id field
      simulateIncomingMessage({
        type: 'PAGE_LOADED',
        timestamp: Date.now(),
        payload: {},
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should ignore messages with unknown type', () => {
      const handler = vi.fn();
      bridge.onEvent('PAGE_LOADED', handler);

      simulateIncomingMessage({
        id: 'bad-type',
        type: 'COMPLETELY_UNKNOWN',
        timestamp: Date.now(),
        payload: {},
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });
});
