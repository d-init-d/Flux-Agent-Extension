import { ErrorCode, ExtensionError } from '@shared/errors';

import { ScriptingAdapter } from '../scripting-adapter';

describe('ScriptingAdapter', () => {
  let adapter: ScriptingAdapter;

  beforeEach(() => {
    adapter = new ScriptingAdapter();
  });

  it('executes an inline function script successfully', async () => {
    const result = await adapter.executeScript(
      1,
      (prefix: string, value: number) => `${prefix}-${value}`,
      ['ok', 42],
    );

    expect(result).toEqual([
      {
        documentId: 'mock-doc-id',
        frameId: 0,
        result: undefined,
      },
    ]);
    expect(chrome.tabs.get).toHaveBeenCalledWith(1);
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 1 },
        args: ['ok', 42],
      }),
    );
  });

  it('executes file injection successfully', async () => {
    await adapter.executeFile(1, ['content-script.js']);

    expect(chrome.tabs.get).toHaveBeenCalledWith(1);
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 1 },
      files: ['content-script.js'],
    });
  });

  it('inserts and removes CSS successfully', async () => {
    const css = 'body { background: #fff; }';

    await adapter.insertCSS(1, css);
    await adapter.removeCSS(1, css);

    expect(chrome.scripting.insertCSS).toHaveBeenCalledWith({
      target: { tabId: 1 },
      css,
    });
    expect(chrome.scripting.removeCSS).toHaveBeenCalledWith({
      target: { tabId: 1 },
      css,
    });
  });

  it('throws TAB_NOT_FOUND for invalid tab id', async () => {
    await expect(adapter.executeScript(0, () => true)).rejects.toMatchObject({
      code: ErrorCode.TAB_NOT_FOUND,
    } satisfies Partial<ExtensionError>);
  });

  it('maps permission failures to TAB_PERMISSION_DENIED', async () => {
    vi.spyOn(chrome.scripting, 'executeScript').mockRejectedValueOnce(
      new Error('Cannot access contents of url "https://example.com"'),
    );

    await expect(adapter.executeScript(1, () => 'x')).rejects.toMatchObject({
      code: ErrorCode.TAB_PERMISSION_DENIED,
    } satisfies Partial<ExtensionError>);
  });

  it('maps closed tab failures to TAB_CLOSED', async () => {
    vi.spyOn(chrome.scripting, 'insertCSS').mockRejectedValueOnce(
      new Error('Tab closed before insertCSS'),
    );

    await expect(adapter.insertCSS(1, 'body { color: #111; }')).rejects.toMatchObject({
      code: ErrorCode.TAB_CLOSED,
    } satisfies Partial<ExtensionError>);
  });

  it('maps generic scripting failures to CONTENT_SCRIPT_INJECTION_FAILED', async () => {
    vi.spyOn(chrome.scripting, 'removeCSS').mockRejectedValueOnce(new Error('Injection pipeline crashed'));

    await expect(adapter.removeCSS(1, 'body { color: #111; }')).rejects.toMatchObject({
      code: ErrorCode.CONTENT_SCRIPT_INJECTION_FAILED,
    } satisfies Partial<ExtensionError>);
  });

  it('propagates TAB_NOT_FOUND when tab existence check fails', async () => {
    await expect(adapter.executeFile(99_999, ['content-script.js'])).rejects.toMatchObject({
      code: ErrorCode.TAB_NOT_FOUND,
    } satisfies Partial<ExtensionError>);
  });
});
