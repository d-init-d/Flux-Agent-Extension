import { DebuggerAdapter } from '@core/browser-controller';
import { Logger } from '@shared/utils';
import { GeolocationMockManager } from '../geolocation-mock-manager';

type DebuggerOnDetachMock = {
  dispatch: (source: chrome.debugger.Debuggee, reason: string) => void;
};

type TabsOnRemovedMock = {
  dispatch: (tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) => void;
};

describe('GeolocationMockManager', () => {
  let manager: GeolocationMockManager;

  beforeEach(() => {
    manager = new GeolocationMockManager({
      debuggerAdapter: new DebuggerAdapter(),
      logger: new Logger('FluxSW:test', 'debug'),
    });
  });

  afterEach(() => {
    manager.dispose();
  });

  it('applies geolocation override and returns the applied state', async () => {
    const sendSpy = vi.spyOn(chrome.debugger, 'sendCommand');

    const applied = await manager.applyAction('session-1', 1, {
      id: 'geo-1',
      type: 'mockGeolocation',
      latitude: 37.7749,
      longitude: -122.4194,
      accuracy: 25,
    });

    expect(applied).toEqual({
      sessionId: 'session-1',
      tabId: 1,
      latitude: 37.7749,
      longitude: -122.4194,
      accuracy: 25,
    });
    expect(sendSpy).toHaveBeenCalledWith({ tabId: 1 }, 'Emulation.setGeolocationOverride', {
      latitude: 37.7749,
      longitude: -122.4194,
      accuracy: 25,
    });
  });

  it('clears session geolocation overrides through Emulation.clearGeolocationOverride', async () => {
    const sendSpy = vi.spyOn(chrome.debugger, 'sendCommand');

    await manager.applyAction('session-2', 1, {
      id: 'geo-2',
      type: 'mockGeolocation',
      latitude: 40.7128,
      longitude: -74.006,
    });

    sendSpy.mockClear();
    await manager.clearSession('session-2');

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(
      { tabId: 1 },
      'Emulation.clearGeolocationOverride',
      undefined,
    );
  });

  it('clears the previous tab override when a different session activates the same tab', async () => {
    const sendSpy = vi.spyOn(chrome.debugger, 'sendCommand');

    await manager.applyAction('session-3', 1, {
      id: 'geo-3',
      type: 'mockGeolocation',
      latitude: 48.8566,
      longitude: 2.3522,
    });

    sendSpy.mockClear();
    manager.activateSession('session-4', 1);
    await vi.waitFor(() => {
      expect(sendSpy).toHaveBeenCalledTimes(1);
    });

    expect(sendSpy).toHaveBeenCalledWith(
      { tabId: 1 },
      'Emulation.clearGeolocationOverride',
      undefined,
    );
  });

  it('drops state on debugger detach without throwing during later cleanup', async () => {
    const sendSpy = vi.spyOn(chrome.debugger, 'sendCommand');

    await manager.applyAction('session-5', 1, {
      id: 'geo-5',
      type: 'mockGeolocation',
      latitude: 51.5074,
      longitude: -0.1278,
    });

    sendSpy.mockClear();
    const onDetach = chrome.debugger.onDetach as unknown as DebuggerOnDetachMock;
    onDetach.dispatch({ tabId: 1 }, 'target_closed');

    await expect(manager.clearSession('session-5')).resolves.toBeUndefined();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('drops state on tab removal without throwing during later cleanup', async () => {
    const sendSpy = vi.spyOn(chrome.debugger, 'sendCommand');

    await manager.applyAction('session-6', 1, {
      id: 'geo-6',
      type: 'mockGeolocation',
      latitude: 35.6762,
      longitude: 139.6503,
      accuracy: 15,
    });

    sendSpy.mockClear();
    const onRemoved = chrome.tabs.onRemoved as unknown as TabsOnRemovedMock;
    onRemoved.dispatch(1, { windowId: 1, isWindowClosing: false });

    await expect(manager.clearSession('session-6')).resolves.toBeUndefined();
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
