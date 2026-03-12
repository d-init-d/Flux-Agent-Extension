import { DebuggerAdapter } from '@core/browser-controller';
import { Logger } from '@shared/utils';
import { DeviceEmulationManager } from '../device-emulation-manager';

describe('DeviceEmulationManager', () => {
  let manager: DeviceEmulationManager;

  beforeEach(() => {
    manager = new DeviceEmulationManager({
      debuggerAdapter: new DebuggerAdapter(),
      logger: new Logger('FluxSW:test', 'debug'),
    });
  });

  it('applies the iPhone preset with portrait metrics, user agent, and touch', async () => {
    const sendSpy = vi.spyOn(chrome.debugger, 'sendCommand');

    const applied = await manager.applyAction('session-1', 1, {
      id: 'emu-1',
      type: 'emulateDevice',
      preset: 'iphone',
      orientation: 'portrait',
    });

    expect(applied).toMatchObject({
      sessionId: 'session-1',
      tabId: 1,
      preset: 'iphone',
      orientation: 'portrait',
      viewport: {
        width: 390,
        height: 844,
        deviceScaleFactor: 3,
        mobile: true,
      },
      touchEnabled: true,
    });
    expect(sendSpy).toHaveBeenNthCalledWith(1, { tabId: 1 }, 'Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
      screenOrientation: { type: 'portraitPrimary', angle: 0 },
    });
    expect(sendSpy).toHaveBeenNthCalledWith(2, { tabId: 1 }, 'Emulation.setUserAgentOverride', {
      userAgent: expect.stringContaining('iPhone'),
      platform: 'iPhone',
    });
    expect(sendSpy).toHaveBeenNthCalledWith(3, { tabId: 1 }, 'Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: 5,
    });
  });

  it('swaps width and height for landscape presets', async () => {
    const applied = await manager.applyAction('session-2', 1, {
      id: 'emu-2',
      type: 'emulateDevice',
      preset: 'ipad',
      orientation: 'landscape',
    });

    expect(applied.viewport).toEqual({
      width: 1180,
      height: 820,
      deviceScaleFactor: 2,
      mobile: true,
    });
    expect(applied.orientation).toBe('landscape');
  });

  it('defaults to portrait orientation when none is provided', async () => {
    const applied = await manager.applyAction('session-portrait', 1, {
      id: 'emu-default',
      type: 'emulateDevice',
      preset: 'pixel',
    });

    expect(applied.orientation).toBe('portrait');
    expect(applied.viewport).toEqual({
      width: 412,
      height: 915,
      deviceScaleFactor: 2.625,
      mobile: true,
    });
  });

  it('clears session emulation and restores desktop defaults', async () => {
    const sendSpy = vi.spyOn(chrome.debugger, 'sendCommand');

    await manager.applyAction('session-3', 1, {
      id: 'emu-3',
      type: 'emulateDevice',
      preset: 'pixel',
      orientation: 'portrait',
    });

    sendSpy.mockClear();
    await manager.clearSession('session-3');

    expect(sendSpy).toHaveBeenNthCalledWith(
      1,
      { tabId: 1 },
      'Emulation.clearDeviceMetricsOverride',
      undefined,
    );
    expect(sendSpy).toHaveBeenNthCalledWith(2, { tabId: 1 }, 'Emulation.setUserAgentOverride', {
      userAgent: expect.any(String),
      platform: expect.any(String),
    });
    expect(sendSpy).toHaveBeenNthCalledWith(3, { tabId: 1 }, 'Emulation.setTouchEmulationEnabled', {
      enabled: false,
      maxTouchPoints: 0,
    });
  });
});
