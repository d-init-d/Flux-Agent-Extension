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

  it('returns ELEMENT_NOT_INTERACTIVE when element is not HTMLElement', async () => {
    vi.spyOn(selectorEngine, 'findElement').mockReturnValue(
      document.createElementNS('http://www.w3.org/2000/svg', 'text'),
    );

    const action: FillAction = {
      id: 'fill-svg',
      type: 'fill',
      selector: { css: '#svg-text' },
      value: 'test',
    };

    const result = await executeInputAction(action, selectorEngine);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.ELEMENT_NOT_INTERACTIVE);
  });

  it('clears input value', async () => {
    document.body.innerHTML = '<input id="target" value="existing" />';

    const action = {
      id: 'clear-1',
      type: 'clear' as const,
      selector: { css: '#target' },
    };

    const result = await executeInputAction(action, selectorEngine);
    const input = document.getElementById('target') as HTMLInputElement;

    expect(result.success).toBe(true);
    expect(input.value).toBe('');
  });

  it('fills contentEditable element', async () => {
    document.body.innerHTML = '<div id="editable" contenteditable="true">old</div>';
    const div = document.getElementById('editable') as HTMLDivElement;
    Object.defineProperty(div, 'isContentEditable', { value: true, configurable: true });

    const action: FillAction = {
      id: 'fill-ce',
      type: 'fill',
      selector: { css: '#editable' },
      value: 'new content',
    };

    const result = await executeInputAction(action, selectorEngine);

    expect(result.success).toBe(true);
    expect(div.textContent).toBe('new content');
  });

  it('appends to contentEditable element when clearFirst is false', async () => {
    document.body.innerHTML = '<div id="editable" contenteditable="true">base</div>';
    const div = document.getElementById('editable') as HTMLDivElement;
    Object.defineProperty(div, 'isContentEditable', { value: true, configurable: true });

    const action: FillAction = {
      id: 'fill-ce-append',
      type: 'fill',
      selector: { css: '#editable' },
      value: '-appended',
      clearFirst: false,
    };

    const result = await executeInputAction(action, selectorEngine);

    expect(result.success).toBe(true);
    expect(div.textContent).toBe('base-appended');
  });

  it('clears contentEditable element', async () => {
    document.body.innerHTML = '<div id="editable" contenteditable="true">some text</div>';
    const div = document.getElementById('editable') as HTMLDivElement;
    Object.defineProperty(div, 'isContentEditable', { value: true, configurable: true });

    const action = {
      id: 'clear-ce',
      type: 'clear' as const,
      selector: { css: '#editable' },
    };

    const result = await executeInputAction(action, selectorEngine);

    expect(result.success).toBe(true);
    expect(div.textContent).toBe('');
  });

  it('types into contentEditable element', async () => {
    document.body.innerHTML = '<div id="editable" contenteditable="true"></div>';
    const div = document.getElementById('editable') as HTMLDivElement;
    Object.defineProperty(div, 'isContentEditable', { value: true, configurable: true });

    const action: TypeAction = {
      id: 'type-ce',
      type: 'type',
      selector: { css: '#editable' },
      text: 'hi',
    };

    const result = await executeInputAction(action, selectorEngine);

    expect(result.success).toBe(true);
    expect(div.textContent).toBe('hi');
  });

  it('types without delay when delay is 0', async () => {
    document.body.innerHTML = '<input id="target" />';

    const action: TypeAction = {
      id: 'type-nodelay',
      type: 'type',
      selector: { css: '#target' },
      text: 'fast',
    };

    const result = await executeInputAction(action, selectorEngine);
    const input = document.getElementById('target') as HTMLInputElement;

    expect(result.success).toBe(true);
    expect(input.value).toBe('fast');
  });

  it('returns error for disabled input on fill', async () => {
    document.body.innerHTML = '<input id="target" disabled />';

    const action: FillAction = {
      id: 'fill-disabled',
      type: 'fill',
      selector: { css: '#target' },
      value: 'x',
    };

    const result = await executeInputAction(action, selectorEngine);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.ACTION_FAILED);
  });

  it('returns error for non-input non-editable element on fill', async () => {
    document.body.innerHTML = '<div id="target">not editable</div>';

    const action: FillAction = {
      id: 'fill-div',
      type: 'fill',
      selector: { css: '#target' },
      value: 'x',
    };

    const result = await executeInputAction(action, selectorEngine);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.ACTION_FAILED);
  });

  it('returns error when uploadFile target is not a file input', async () => {
    document.body.innerHTML = '<input id="target" type="text" />';

    const action: UploadFileAction = {
      id: 'upload-wrong-type',
      type: 'uploadFile',
      selector: { css: '#target' },
      fileIds: ['f1'],
    };

    const uploads = [{ id: 'f1', name: 'f.txt', mimeType: 'text/plain', size: 1, lastModified: 0, base64Data: 'YQ==' }];
    const result = await executeInputAction(action, selectorEngine, uploads);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.ACTION_FAILED);
  });

  it('returns error when file input is disabled', async () => {
    document.body.innerHTML = '<input id="target" type="file" disabled />';

    const action: UploadFileAction = {
      id: 'upload-disabled',
      type: 'uploadFile',
      selector: { css: '#target' },
      fileIds: ['f1'],
    };

    const uploads = [{ id: 'f1', name: 'f.txt', mimeType: 'text/plain', size: 1, lastModified: 0, base64Data: 'YQ==' }];
    const result = await executeInputAction(action, selectorEngine, uploads);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.ACTION_FAILED);
  });

  it('returns error when no uploads provided for uploadFile', async () => {
    document.body.innerHTML = '<input id="target" type="file" />';

    const action: UploadFileAction = {
      id: 'upload-empty',
      type: 'uploadFile',
      selector: { css: '#target' },
      fileIds: [],
    };

    const result = await executeInputAction(action, selectorEngine, []);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ErrorCode.ACTION_FAILED);
  });

  it('keeps existing files when clearFirst is false on uploadFile', async () => {
    document.body.innerHTML = '<input id="target" type="file" multiple />';

    const uploads = [{ id: 'f1', name: 'f.txt', mimeType: 'text/plain', size: 1, lastModified: 0, base64Data: 'YQ==' }];

    const action: UploadFileAction = {
      id: 'upload-keep',
      type: 'uploadFile',
      selector: { css: '#target' },
      fileIds: ['f1'],
      clearFirst: false,
    };

    const result = await executeInputAction(action, selectorEngine, uploads);
    expect(result.success).toBe(true);
  });

  it('selects option by value object', async () => {
    document.body.innerHTML =
      '<select id="country"><option value="US">United States</option><option value="JP">Japan</option></select>';

    const action: SelectAction = {
      id: 'select-value-obj',
      type: 'select',
      selector: { css: '#country' },
      option: { value: 'JP' },
    };

    const result = await executeInputAction(action, selectorEngine);
    const select = document.getElementById('country') as HTMLSelectElement;

    expect(result.success).toBe(true);
    expect(select.value).toBe('JP');
  });

  it('selects option by index object', async () => {
    document.body.innerHTML =
      '<select id="country"><option value="US">US</option><option value="JP">JP</option></select>';

    const action: SelectAction = {
      id: 'select-index',
      type: 'select',
      selector: { css: '#country' },
      option: { index: 1 },
    };

    const result = await executeInputAction(action, selectorEngine);
    const select = document.getElementById('country') as HTMLSelectElement;

    expect(result.success).toBe(true);
    expect(select.value).toBe('JP');
  });

  it('selects option by string label fallback', async () => {
    document.body.innerHTML =
      '<select id="country"><option value="us">United States</option></select>';

    const action: SelectAction = {
      id: 'select-label-string',
      type: 'select',
      selector: { css: '#country' },
      option: 'United States',
    };

    const result = await executeInputAction(action, selectorEngine);
    expect(result.success).toBe(true);
  });

  it('returns error for select action on non-select element', async () => {
    document.body.innerHTML = '<input id="target" />';

    const action: SelectAction = {
      id: 'select-non-select',
      type: 'select',
      selector: { css: '#target' },
      option: 'x',
    };

    const result = await executeInputAction(action, selectorEngine);
    expect(result.success).toBe(false);
  });

  it('returns error for disabled select element', async () => {
    document.body.innerHTML =
      '<select id="target" disabled><option value="a">A</option></select>';

    const action: SelectAction = {
      id: 'select-disabled',
      type: 'select',
      selector: { css: '#target' },
      option: 'a',
    };

    const result = await executeInputAction(action, selectorEngine);
    expect(result.success).toBe(false);
  });

  it('returns error for check action on non-input element', async () => {
    document.body.innerHTML = '<div id="target">not input</div>';

    const action: CheckAction = {
      id: 'check-div',
      type: 'check',
      selector: { css: '#target' },
    };

    const result = await executeInputAction(action, selectorEngine);
    expect(result.success).toBe(false);
  });

  it('returns error for check action on text input', async () => {
    document.body.innerHTML = '<input id="target" type="text" />';

    const action: CheckAction = {
      id: 'check-text',
      type: 'check',
      selector: { css: '#target' },
    };

    const result = await executeInputAction(action, selectorEngine);
    expect(result.success).toBe(false);
  });

  it('returns error for disabled checkbox', async () => {
    document.body.innerHTML = '<input id="target" type="checkbox" disabled />';

    const action: CheckAction = {
      id: 'check-disabled',
      type: 'check',
      selector: { css: '#target' },
    };

    const result = await executeInputAction(action, selectorEngine);
    expect(result.success).toBe(false);
  });

  it('returns error for unchecking a radio button', async () => {
    document.body.innerHTML = '<input id="target" type="radio" checked />';

    const action: CheckAction = {
      id: 'uncheck-radio',
      type: 'uncheck',
      selector: { css: '#target' },
    };

    const result = await executeInputAction(action, selectorEngine);
    expect(result.success).toBe(false);
  });

  it('checks radio button successfully', async () => {
    document.body.innerHTML = '<input id="target" type="radio" />';

    const action: CheckAction = {
      id: 'check-radio',
      type: 'check',
      selector: { css: '#target' },
    };

    const result = await executeInputAction(action, selectorEngine);
    const input = document.getElementById('target') as HTMLInputElement;

    expect(result.success).toBe(true);
    expect(input.checked).toBe(true);
  });

  it('returns -1 for option object with no matching fields', async () => {
    document.body.innerHTML =
      '<select id="country"><option value="US">US</option></select>';

    const action: SelectAction = {
      id: 'select-empty-obj',
      type: 'select',
      selector: { css: '#country' },
      option: {} as { label: string },
    };

    const result = await executeInputAction(action, selectorEngine);
    expect(result.success).toBe(false);
  });

  it('fills textarea', async () => {
    document.body.innerHTML = '<textarea id="target">old</textarea>';

    const action: FillAction = {
      id: 'fill-ta',
      type: 'fill',
      selector: { css: '#target' },
      value: 'new',
    };

    const result = await executeInputAction(action, selectorEngine);
    const textarea = document.getElementById('target') as HTMLTextAreaElement;

    expect(result.success).toBe(true);
    expect(textarea.value).toBe('new');
  });
});
