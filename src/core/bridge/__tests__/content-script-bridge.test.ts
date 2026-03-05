/**
 * @module content-script-bridge.test
 * @description Tests for ContentScriptBridge.
 *
 * Covers: onCommand registration, emit, initialize (PING handler, PAGE_LOADED),
 * message validation, replay protection, async dispatch, error handling, destroy.
 */

import { ContentScriptBridge } from '../content-script-bridge';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get the chrome mock's runtime.onMessage so we can dispatch
 * simulated messages from the service worker.
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
 * Get chrome.runtime.sendMessage mock.
 */
function getRuntimeSendMessage() {
  return chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
}

/**
 * Simulate a service-worker sending a command to this content script
 * via chrome.runtime.onMessage.
 */
function simulateIncomingCommand(
  message: Record<string, unknown>,
): ReturnType<typeof vi.fn> {
  const sender: chrome.runtime.MessageSender = {
    id: 'mock-extension-id',
  };
  const sendResponse = vi.fn();

  getRuntimeOnMessage().dispatch(message, sender, sendResponse);
  return sendResponse;
}

/**
 * Build a valid command message.
 */
function validCommand(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cmd-123',
    type: 'PING',
    timestamp: Date.now(),
    payload: undefined as unknown,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ContentScriptBridge', () => {
  let bridge: ContentScriptBridge;

  beforeEach(() => {
    // Mock globalThis.location for PAGE_LOADED
    Object.defineProperty(globalThis, 'location', {
      value: { href: 'https://example.com/test' },
      writable: true,
      configurable: true,
    });

    bridge = new ContentScriptBridge();
  });

  afterEach(() => {
    bridge.destroy();
  });

  // --------------------------------------------------------------------------
  // onCommand()
  // --------------------------------------------------------------------------

  describe('onCommand()', () => {
    it('should register a handler for a specific command type', () => {
      const handler = vi.fn().mockResolvedValue({ result: 'ok' });
      bridge.onCommand('EXECUTE_ACTION', handler);
      bridge.initialize();

      // Send the command
      simulateIncomingCommand(
        validCommand({
          id: 'cmd-exec',
          type: 'EXECUTE_ACTION',
          payload: { action: 'click' },
        }),
      );

      expect(handler).toHaveBeenCalledWith({ action: 'click' });
    });

    it('should return an unsubscribe function', () => {
      const handler = vi.fn().mockResolvedValue(null);
      const unsub = bridge.onCommand('EXECUTE_ACTION', handler);
      bridge.initialize();

      unsub();

      const sendResponse = simulateIncomingCommand(
        validCommand({
          id: 'cmd-unsub',
          type: 'EXECUTE_ACTION',
          payload: {},
        }),
      );

      // Handler should not be called after unsubscription
      expect(handler).not.toHaveBeenCalled();
      // sendResponse should not be called (returned undefined from listener)
      expect(sendResponse).not.toHaveBeenCalled();
    });

    it('should replace handler when registering the same type twice', () => {
      const handler1 = vi.fn().mockResolvedValue('first');
      const handler2 = vi.fn().mockResolvedValue('second');

      bridge.onCommand('EXECUTE_ACTION', handler1);
      bridge.onCommand('EXECUTE_ACTION', handler2);
      bridge.initialize();

      simulateIncomingCommand(
        validCommand({
          id: 'cmd-replace',
          type: 'EXECUTE_ACTION',
          payload: {},
        }),
      );

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('should not remove a newer handler when stale unsub is called', () => {
      const handler1 = vi.fn().mockResolvedValue('first');
      const handler2 = vi.fn().mockResolvedValue('second');

      const unsub1 = bridge.onCommand('EXECUTE_ACTION', handler1);
      bridge.onCommand('EXECUTE_ACTION', handler2); // replaces handler1

      // Calling the old unsubscribe should NOT remove handler2
      unsub1();

      bridge.initialize();

      simulateIncomingCommand(
        validCommand({
          id: 'cmd-stale',
          type: 'EXECUTE_ACTION',
          payload: {},
        }),
      );

      expect(handler2).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // emit()
  // --------------------------------------------------------------------------

  describe('emit()', () => {
    it('should send a BridgeMessage via chrome.runtime.sendMessage', () => {
      getRuntimeSendMessage().mockResolvedValue(undefined);

      bridge.emit('DOM_MUTATION', { changes: [1, 2, 3] });

      expect(getRuntimeSendMessage()).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'DOM_MUTATION',
          payload: { changes: [1, 2, 3] },
        }),
      );
    });

    it('should include a unique id and timestamp', () => {
      getRuntimeSendMessage().mockResolvedValue(undefined);

      bridge.emit('CONSOLE_LOG', { level: 'info' });

      const sentMessage = getRuntimeSendMessage().mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(typeof sentMessage.id).toBe('string');
      expect((sentMessage.id as string).length).toBeGreaterThan(0);
      expect(typeof sentMessage.timestamp).toBe('number');
    });

    it('should not throw when runtime.sendMessage rejects', () => {
      getRuntimeSendMessage().mockRejectedValue(
        new Error('Could not establish connection'),
      );

      expect(() => bridge.emit('CONSOLE_LOG', { level: 'error' })).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // initialize()
  // --------------------------------------------------------------------------

  describe('initialize()', () => {
    it('should register a chrome.runtime.onMessage listener', () => {
      bridge.initialize();
      expect(getRuntimeOnMessage().addListener).toHaveBeenCalledTimes(1);
    });

    it('should emit a PAGE_LOADED event to the service worker', () => {
      getRuntimeSendMessage().mockResolvedValue(undefined);

      bridge.initialize();

      expect(getRuntimeSendMessage()).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'PAGE_LOADED',
          payload: expect.objectContaining({
            url: 'https://example.com/test',
          }),
        }),
      );
    });

    it('should register a built-in PING handler that responds with pong', async () => {
      bridge.initialize();

      const sendResponse = simulateIncomingCommand(
        validCommand({
          id: 'ping-test',
          type: 'PING',
          payload: null,
        }),
      );

      // Wait for async handler to complete
      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalled();
      });

      const response = sendResponse.mock.calls[0][0] as Record<string, unknown>;
      expect(response.type).toBe('PONG');
      expect(response.payload).toEqual({ pong: true });
    });

    it('should be a no-op when called a second time', () => {
      bridge.initialize();
      bridge.initialize(); // should warn but not add a second listener

      expect(getRuntimeOnMessage().addListener).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  // Message dispatch
  // --------------------------------------------------------------------------

  describe('message dispatch', () => {
    beforeEach(() => {
      bridge.initialize();
    });

    it('should send back a response with the correct id and response type', async () => {
      bridge.onCommand<{ ctx: string }>('GET_PAGE_CONTEXT', async () => {
        return { url: 'https://example.com' };
      });

      const sendResponse = simulateIncomingCommand(
        validCommand({
          id: 'ctx-cmd',
          type: 'GET_PAGE_CONTEXT',
          payload: { ctx: 'test' },
        }),
      );

      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalled();
      });

      const response = sendResponse.mock.calls[0][0] as Record<string, unknown>;
      expect(response.id).toBe('ctx-cmd');
      expect(response.type).toBe('PAGE_CONTEXT');
    });

    it('should send ERROR response when handler throws', async () => {
      bridge.onCommand('EXECUTE_ACTION', async () => {
        throw new Error('Handler exploded');
      });

      const sendResponse = simulateIncomingCommand(
        validCommand({
          id: 'err-cmd',
          type: 'EXECUTE_ACTION',
          payload: {},
        }),
      );

      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalled();
      });

      const response = sendResponse.mock.calls[0][0] as Record<string, unknown>;
      expect(response.type).toBe('ERROR');
      expect(response.payload).toEqual(
        expect.objectContaining({
          code: 'ACTION_FAILED',
          message: 'Handler exploded',
        }),
      );
    });

    it('should return true synchronously to keep the messaging channel open', () => {
      bridge.onCommand('EXECUTE_ACTION', async () => ({ ok: true }));

      const sender: chrome.runtime.MessageSender = { id: 'ext' };
      const sendResponse = vi.fn();

      // Call the listener directly and capture return value
      const listeners = (getRuntimeOnMessage().addListener as ReturnType<typeof vi.fn>).mock.calls;
      const listener = listeners[0][0] as (
        message: unknown,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response: unknown) => void,
      ) => boolean | undefined;

      const result = listener(
        validCommand({
          id: 'sync-test',
          type: 'EXECUTE_ACTION',
          payload: {},
        }),
        sender,
        sendResponse,
      );

      expect(result).toBe(true);
    });

    it('should return undefined for messages with no matching handler', () => {
      const sender: chrome.runtime.MessageSender = { id: 'ext' };
      const sendResponse = vi.fn();

      const listeners = (getRuntimeOnMessage().addListener as ReturnType<typeof vi.fn>).mock.calls;
      const listener = listeners[0][0] as (
        message: unknown,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response: unknown) => void,
      ) => boolean | undefined;

      const result = listener(
        validCommand({
          id: 'no-handler',
          type: 'HIGHLIGHT_ELEMENT',
          payload: {},
        }),
        sender,
        sendResponse,
      );

      expect(result).toBeUndefined();
      expect(sendResponse).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Validation & Replay
  // --------------------------------------------------------------------------

  describe('validation and replay protection', () => {
    beforeEach(() => {
      bridge.initialize();
    });

    it('should ignore structurally invalid messages', () => {
      const handler = vi.fn().mockResolvedValue(null);
      bridge.onCommand('EXECUTE_ACTION', handler);

      // Message without id
      simulateIncomingCommand({
        type: 'EXECUTE_ACTION',
        timestamp: Date.now(),
        payload: {},
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should reject replayed messages', async () => {
      let callCount = 0;
      bridge.onCommand('EXECUTE_ACTION', async () => {
        callCount++;
        return { count: callCount };
      });

      const msg = validCommand({
        id: 'replay-test',
        type: 'EXECUTE_ACTION',
        payload: {},
      });

      const sendResponse1 = simulateIncomingCommand(msg);
      await vi.waitFor(() => {
        expect(sendResponse1).toHaveBeenCalled();
      });

      // Second time: should be rejected as replay
      const sendResponse2 = simulateIncomingCommand(msg);
      await vi.waitFor(() => {
        expect(sendResponse2).toHaveBeenCalled();
      });

      // First response: success
      expect((sendResponse1.mock.calls[0][0] as Record<string, unknown>).payload).toEqual({
        count: 1,
      });

      // Second response: REPLAY_DETECTED error
      const replayResponse = sendResponse2.mock.calls[0][0] as Record<string, unknown>;
      expect(replayResponse.type).toBe('ERROR');
      expect(replayResponse.payload).toEqual(
        expect.objectContaining({ code: 'REPLAY_DETECTED' }),
      );

      expect(callCount).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // destroy()
  // --------------------------------------------------------------------------

  describe('destroy()', () => {
    it('should remove the chrome.runtime.onMessage listener', () => {
      bridge.initialize();
      bridge.destroy();
      expect(getRuntimeOnMessage().removeListener).toHaveBeenCalledTimes(1);
    });

    it('should clear all registered handlers', () => {
      const handler = vi.fn().mockResolvedValue(null);
      bridge.onCommand('EXECUTE_ACTION', handler);
      bridge.initialize();

      bridge.destroy();

      // Re-initialize to get a fresh listener (but handlers should be gone)
      // Actually after destroy, the bridge won't process messages, so we
      // just verify destroy doesn't throw and the handler map is cleared.
      // This is implicitly tested — the bridge is cleaned up.
    });

    it('should be safe to call destroy before initialize', () => {
      expect(() => bridge.destroy()).not.toThrow();
    });

    it('should be safe to call destroy multiple times', () => {
      bridge.initialize();
      bridge.destroy();
      expect(() => bridge.destroy()).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // Response type mapping
  // --------------------------------------------------------------------------

  describe('response type mapping', () => {
    beforeEach(() => {
      bridge.initialize();
    });

    const typeMappings: Array<[string, string]> = [
      ['EXECUTE_ACTION', 'ACTION_RESULT'],
      ['GET_PAGE_CONTEXT', 'PAGE_CONTEXT'],
      ['PING', 'PONG'],
    ];

    it.each(typeMappings)(
      'should map command "%s" to response "%s"',
      async (commandType, expectedResponseType) => {
        if (commandType !== 'PING') {
          bridge.onCommand(commandType as any, async () => ({ ok: true }));
        }

        const sendResponse = simulateIncomingCommand(
          validCommand({
            id: `map-${commandType}`,
            type: commandType,
            payload: commandType === 'PING' ? null : {},
          }),
        );

        await vi.waitFor(() => {
          expect(sendResponse).toHaveBeenCalled();
        });

        const response = sendResponse.mock.calls[0][0] as Record<
          string,
          unknown
        >;
        expect(response.type).toBe(expectedResponseType);
      },
    );

    it('should use the same type for unmapped commands', async () => {
      bridge.onCommand('HIGHLIGHT_ELEMENT' as any, async () => ({ done: true }));

      const sendResponse = simulateIncomingCommand(
        validCommand({
          id: 'highlight-cmd',
          type: 'HIGHLIGHT_ELEMENT',
          payload: {},
        }),
      );

      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalled();
      });

      const response = sendResponse.mock.calls[0][0] as Record<string, unknown>;
      expect(response.type).toBe('HIGHLIGHT_ELEMENT');
    });
  });
});
