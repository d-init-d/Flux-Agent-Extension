import { ErrorCode } from '@shared/errors';
import type { CheckAction, FillAction, SelectAction, SerializedFileUpload, TypeAction, UploadFileAction } from '@shared/types';
import { SelectorEngine } from '../../dom/selector-engine';
import { executeInputAction } from '../input';

describe('executeInputAction', () => {
  let selectorEngine: SelectorEngine;

  beforeEach(() => {
    document.body.innerHTML = '';
    selectorEngine = new SelectorEngine();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fills input value', async () => {
    document.body.innerHTML = '<input id="target" />';
    const action: FillAction = {
      id: 'fill-1',
      type: 'fill',
      selector: { css: '#target' },
      value: 'hello',
    };

    const result = await executeInputAction(action, selectorEngine);
    const input = document.getElementById('target') as HTMLInputElement;

    expect(result.success).toBe(true);
    expect(input.value).toBe('hello');
  });

  it('appends value when clearFirst is false', async () => {
    document.body.innerHTML = '<input id="target" value="base" />';
    const action: FillAction = {
      id: 'fill-append',
      type: 'fill',
      selector: { css: '#target' },
      value: '-next',
      clearFirst: false,
    };

    const result = await executeInputAction(action, selectorEngine);
    const input = document.getElementById('target') as HTMLInputElement;

    expect(result.success).toBe(true);
    expect(input.value).toBe('base-next');
  });

  it('types text with delay', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<input id="target" />';

    const action: TypeAction = {
      id: 'type-1',
      type: 'type',
      selector: { css: '#target' },
      text: 'abc',
      delay: 10,
    };

    const resultPromise = executeInputAction(action, selectorEngine);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    const input = document.getElementById('target') as HTMLInputElement;
    expect(result.success).toBe(true);
    expect(input.value).toBe('abc');
  });

  it('selects option by string value', async () => {
    document.body.innerHTML =
      '<select id="country"><option value="">Choose</option><option value="US">United States</option></select>';

    const action: SelectAction = {
      id: 'select-1',
      type: 'select',
      selector: { css: '#country' },
      option: 'US',
    };

    const result = await executeInputAction(action, selectorEngine);
    const select = document.getElementById('country') as HTMLSelectElement;

    expect(result.success).toBe(true);
    expect(select.value).toBe('US');
  });

  it('selects option by label object', async () => {
    document.body.innerHTML =
      '<select id="country"><option value="VN">Viet Nam</option><option value="JP">Japan</option></select>';

    const action: SelectAction = {
      id: 'select-label',
      type: 'select',
      selector: { css: '#country' },
      option: { label: 'Japan' },
    };

    const result = await executeInputAction(action, selectorEngine);
    const select = document.getElementById('country') as HTMLSelectElement;

    expect(result.success).toBe(true);
    expect(select.value).toBe('JP');
  });

  it('checks and unchecks checkbox', async () => {
    document.body.innerHTML = '<input id="flag" type="checkbox" />';

    const checkAction: CheckAction = {
      id: 'check-1',
      type: 'check',
      selector: { css: '#flag' },
    };
    const uncheckAction: CheckAction = {
      id: 'check-2',
      type: 'uncheck',
      selector: { css: '#flag' },
    };

    const checkResult = await executeInputAction(checkAction, selectorEngine);
    const input = document.getElementById('flag') as HTMLInputElement;
    expect(checkResult.success).toBe(true);
    expect(input.checked).toBe(true);

    const uncheckResult = await executeInputAction(uncheckAction, selectorEngine);
    expect(uncheckResult.success).toBe(true);
    expect(input.checked).toBe(false);
  });

  it('uploads staged files into a file input', async () => {
    document.body.innerHTML = '<input id="resume" type="file" multiple />';
    const action: UploadFileAction = {
      id: 'upload-1',
      type: 'uploadFile',
      selector: { css: '#resume' },
      fileIds: ['file-1'],
    };
    const uploads: SerializedFileUpload[] = [
      {
        id: 'file-1',
        name: 'resume.txt',
        mimeType: 'text/plain',
        size: 4,
        lastModified: 1700000000000,
        base64Data: 'dGVzdA==',
      },
    ];

    const result = await executeInputAction(action, selectorEngine, uploads);
    const input = document.getElementById('resume') as HTMLInputElement;

    expect(result.success).toBe(true);
    expect(input.files).toHaveLength(1);
    expect(input.files?.[0]?.name).toBe('resume.txt');
    expect(result.data).toEqual({ uploadedFileCount: 1, fileIds: ['file-1'] });
  });

  it('returns FILE_UPLOAD_INVALID when uploading multiple files into a single-file input', async () => {
    document.body.innerHTML = '<input id="resume" type="file" />';
    const action: UploadFileAction = {
      id: 'upload-invalid',
      type: 'uploadFile',
      selector: { css: '#resume' },
      fileIds: ['file-1', 'file-2'],
    };
    const uploads: SerializedFileUpload[] = [
      {
        id: 'file-1',
        name: 'resume.txt',
        mimeType: 'text/plain',
        size: 4,
        lastModified: 1700000000000,
        base64Data: 'dGVzdA==',
      },
      {
        id: 'file-2',
        name: 'cover.txt',
        mimeType: 'text/plain',
        size: 5,
        lastModified: 1700000000001,
        base64Data: 'aGVsbG8=',
      },
    ];

    const result = await executeInputAction(action, selectorEngine, uploads);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.ACTION_FAILED);
    expect(result.error?.message).toContain('Failed to execute action');
  });

  it('returns error for invalid select option', async () => {
    document.body.innerHTML =
      '<select id="country"><option value="US">United States</option></select>';

    const action: SelectAction = {
      id: 'select-missing',
      type: 'select',
      selector: { css: '#country' },
      option: 'VN',
    };

    const result = await executeInputAction(action, selectorEngine);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.ACTION_FAILED);
    expect(result.error?.message).toContain('Failed to execute action');
  });

  it('returns ELEMENT_NOT_FOUND when target does not exist', async () => {
    const action: FillAction = {
      id: 'missing-1',
      type: 'fill',
      selector: { css: '#missing' },
      value: 'x',
    };

    const result = await executeInputAction(action, selectorEngine);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.ELEMENT_NOT_FOUND);
  });
});
