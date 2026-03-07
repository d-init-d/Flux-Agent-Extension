import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceWorkerBridge } from '@core/bridge';
import { Logger } from '@shared/utils';
import type { ExtensionMessage, RequestPayloadMap } from '@shared/types';
import { UISessionRuntime } from '../ui-session-runtime';

function createExtensionMessage<T extends keyof RequestPayloadMap>(
  type: T,
  payload: RequestPayloadMap[T],
): ExtensionMessage<RequestPayloadMap[T]> {
  return {
    id: `msg-${type}`,
    channel: 'sidePanel',
    type,
    payload,
    timestamp: Date.now(),
  };
}

describe('UI session runtime', () => {
  const bridge = {
    ensureContentScript: vi.fn(async () => undefined),
    sendOneWay: vi.fn(),
  } as unknown as ServiceWorkerBridge;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(chrome.runtime, 'sendMessage').mockResolvedValue(undefined);
    vi.mocked(bridge.ensureContentScript).mockClear();
    vi.mocked(bridge.sendOneWay).mockClear();
  });

  it('creates and lists sessions through the runtime', async () => {
    const runtime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:test', 'debug'),
    });

    const createResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_CREATE', {
        config: { provider: 'openai', model: 'gpt-4o-mini' },
      }),
    );

    expect(createResponse.success).toBe(true);
    expect(createResponse.data?.session.config.id).toBeTruthy();

    const listResponse = await runtime.handleMessage(createExtensionMessage('SESSION_LIST', undefined));
    expect(listResponse.success).toBe(true);
    expect(listResponse.data?.sessions).toHaveLength(1);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'EVENT_SESSION_UPDATE',
        payload: expect.objectContaining({ reason: 'created' }),
      }),
    );
  });

  it('streams chat updates, action progress, and overlay highlight events', async () => {
    const runtime = new UISessionRuntime({
      bridge,
      logger: new Logger('FluxSW:test', 'debug'),
    });

    const createResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_CREATE', {
        config: { provider: 'openai', model: 'gpt-4o-mini' },
      }),
    );
    const sessionId = createResponse.data?.session.config.id;
    expect(sessionId).toBeTruthy();

    const sendPromise = runtime.handleMessage(
      createExtensionMessage('SESSION_SEND_MESSAGE', {
        sessionId: sessionId!,
        message: 'Click the "Submit" button',
      }),
    );

    await vi.runAllTimersAsync();
    const sendResponse = await sendPromise;

    expect(sendResponse.success).toBe(true);
    expect(bridge.ensureContentScript).toHaveBeenCalled();
    expect(bridge.sendOneWay).toHaveBeenCalledWith(
      1,
      'HIGHLIGHT_ELEMENT',
      expect.objectContaining({
        selector: expect.objectContaining({ role: 'button', textExact: 'Submit' }),
      }),
    );
    expect(bridge.sendOneWay).toHaveBeenCalledWith(1, 'CLEAR_HIGHLIGHTS', undefined);

    const broadcastCalls = vi.mocked(chrome.runtime.sendMessage).mock.calls.map(([message]) => message);
    expect(broadcastCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'EVENT_ACTION_PROGRESS' }),
        expect.objectContaining({ type: 'EVENT_AI_STREAM' }),
        expect.objectContaining({ type: 'EVENT_SESSION_UPDATE' }),
      ]),
    );

    const stateResponse = await runtime.handleMessage(
      createExtensionMessage('SESSION_GET_STATE', { sessionId: sessionId! }),
    );

    expect(stateResponse.data?.session?.messages).toHaveLength(2);
    expect(stateResponse.data?.session?.messages[1]).toEqual(
      expect.objectContaining({ role: 'assistant' }),
    );
  });
});
