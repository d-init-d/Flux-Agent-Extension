import { ContentScriptBridge } from '../content-script-bridge';
import { ServiceWorkerBridge } from '../service-worker-bridge';

function runtimeOnMessageMock() {
  return chrome.runtime.onMessage as unknown as {
    dispatch: (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => void;
  };
}

describe('ServiceWorker <-> ContentScript round-trip', () => {
  it('delivers EXECUTE_ACTION from SW to CS and returns ACTION_RESULT payload', async () => {
    const contentBridge = new ContentScriptBridge();
    const serviceBridge = new ServiceWorkerBridge();

    contentBridge.onCommand<{ actionId: string }>('EXECUTE_ACTION', async (payload) => {
      return {
        actionId: payload.actionId,
        success: true,
        duration: 12,
      };
    });
    contentBridge.initialize();

    const onMessage = runtimeOnMessageMock();

    const tabsSendMessage = chrome.tabs.sendMessage as ReturnType<typeof vi.fn>;
    tabsSendMessage.mockImplementation(
      (_tabId: number, message: unknown): Promise<unknown> => {
        return new Promise<unknown>((resolve) => {
          const sender: chrome.runtime.MessageSender = {
            id: chrome.runtime.id,
          };

          onMessage.dispatch(message, sender, (response?: unknown) => {
            resolve(response);
          });
        });
      },
    );

    const response = await serviceBridge.send<{ actionId: string }, { actionId: string; success: boolean; duration: number }>(
      1,
      'EXECUTE_ACTION',
      { actionId: 'action-1' },
    );

    expect(response).toEqual({
      actionId: 'action-1',
      success: true,
      duration: 12,
    });

    contentBridge.destroy();
    serviceBridge.destroy();
  });
});
