import { ErrorCode, ExtensionError } from '@shared/errors';

import { TabManager } from './tab-manager';

const DEBUGGER_PROTOCOL_VERSION = '1.3';

type CDPParams = Record<string, unknown>;

export type DispatchMouseEventParams = {
  type: string;
  x: number;
  y: number;
  button?: 'none' | 'left' | 'middle' | 'right' | 'back' | 'forward';
  clickCount?: number;
} & CDPParams;

export type DispatchKeyEventParams = {
  type: string;
  key?: string;
  code?: string;
  text?: string;
  unmodifiedText?: string;
  windowsVirtualKeyCode?: number;
  nativeVirtualKeyCode?: number;
} & CDPParams;

export type CaptureScreenshotParams = {
  format?: 'jpeg' | 'png' | 'webp';
  quality?: number;
  fromSurface?: boolean;
  captureBeyondViewport?: boolean;
} & CDPParams;

export type FetchRequestPattern = {
  urlPattern?: string;
  resourceType?: string;
  requestStage?: 'Request' | 'Response';
};

export type FulfillRequestHeader = {
  name: string;
  value: string;
};

export type FulfillRequestParams = {
  responseCode: number;
  responseHeaders?: FulfillRequestHeader[];
  body?: string;
  responsePhrase?: string;
} & CDPParams;

export type DeviceMetricsOverrideParams = {
  width: number;
  height: number;
  deviceScaleFactor: number;
  mobile: boolean;
  screenOrientation?: {
    type: 'portraitPrimary' | 'portraitSecondary' | 'landscapePrimary' | 'landscapeSecondary';
    angle: number;
  };
} & CDPParams;

export type UserAgentOverrideParams = {
  userAgent: string;
  platform?: string;
  acceptLanguage?: string;
} & CDPParams;

export type TouchEmulationParams = {
  enabled: boolean;
  maxTouchPoints?: number;
} & CDPParams;

export type GeolocationOverrideParams = {
  latitude: number;
  longitude: number;
  accuracy?: number;
} & CDPParams;

export type SetFileInputFilesParams = {
  files: string[];
  nodeId?: number;
  backendNodeId?: number;
  objectId?: string;
} & CDPParams;

export type PrintToPDFParams = {
  landscape?: boolean;
  displayHeaderFooter?: boolean;
  printBackground?: boolean;
  scale?: number;
  paperWidth?: number;
  paperHeight?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  pageRanges?: string;
  headerTemplate?: string;
  footerTemplate?: string;
  preferCSSPageSize?: boolean;
  transferMode?: 'ReturnAsBase64' | 'ReturnAsStream';
} & CDPParams;

export type DebuggerEvent = {
  tabId: number;
  method: string;
  params?: CDPParams;
};

export type DebuggerEventListener = (event: DebuggerEvent) => void;
export type DebuggerDetachListener = (tabId: number, reason: string) => void;

export type EvaluateOptions = {
  objectGroup?: string;
  includeCommandLineAPI?: boolean;
  silent?: boolean;
  contextId?: number;
  returnByValue?: boolean;
  generatePreview?: boolean;
  userGesture?: boolean;
  awaitPromise?: boolean;
  timeout?: number;
};

type RuntimeEvaluateResult = {
  result: CDPParams;
  exceptionDetails?: CDPParams;
};

type DomGetDocumentResult = {
  root: CDPParams;
};

type DomQuerySelectorResult = {
  nodeId: number;
};

export class DebuggerAdapter {
  private readonly attachedTabIds = new Set<number>();

  constructor(private readonly tabManager: TabManager = new TabManager()) {
    chrome.debugger.onDetach.addListener(this.handleDetachEvent);
  }

  async attach(tabId: number): Promise<void> {
    this.ensureValidTabId(tabId);

    if (this.attachedTabIds.has(tabId)) {
      return;
    }

    await this.tabManager.ensureTabExists(tabId);

    try {
      await chrome.debugger.attach({ tabId }, DEBUGGER_PROTOCOL_VERSION);
      this.attachedTabIds.add(tabId);
    } catch (error: unknown) {
      throw this.mapDebuggerError(error, tabId, 'attach debugger');
    }
  }

  async detach(tabId: number): Promise<void> {
    this.ensureValidTabId(tabId);

    if (!this.attachedTabIds.has(tabId)) {
      return;
    }

    try {
      await chrome.debugger.detach({ tabId });
      this.attachedTabIds.delete(tabId);
    } catch (error: unknown) {
      if (this.isNotAttachedError(error)) {
        this.attachedTabIds.delete(tabId);
        return;
      }

      const mapped = this.mapDebuggerError(error, tabId, 'detach debugger');
      if (mapped.code === ErrorCode.TAB_NOT_FOUND || mapped.code === ErrorCode.TAB_CLOSED) {
        this.attachedTabIds.delete(tabId);
      }

      throw mapped;
    }
  }

  async sendCommand<TParams extends CDPParams | undefined = CDPParams, TResult = CDPParams>(
    tabId: number,
    method: string,
    params?: TParams,
  ): Promise<TResult> {
    this.ensureValidTabId(tabId);

    if (!this.attachedTabIds.has(tabId)) {
      await this.attach(tabId);
    }

    try {
      const response = await chrome.debugger.sendCommand({ tabId }, method, params);
      return response as TResult;
    } catch (error: unknown) {
      throw this.mapDebuggerError(error, tabId, `send debugger command "${method}"`);
    }
  }

  isAttached(tabId: number): boolean {
    this.ensureValidTabId(tabId);
    return this.attachedTabIds.has(tabId);
  }

  async dispatchMouseEvent(tabId: number, params: DispatchMouseEventParams): Promise<void> {
    await this.sendCommand(tabId, 'Input.dispatchMouseEvent', params);
  }

  async dispatchKeyEvent(tabId: number, params: DispatchKeyEventParams): Promise<void> {
    await this.sendCommand(tabId, 'Input.dispatchKeyEvent', params);
  }

  async captureScreenshot(tabId: number, params?: CaptureScreenshotParams): Promise<string> {
    const result = await this.sendCommand<CaptureScreenshotParams | undefined, { data?: unknown }>(
      tabId,
      'Page.captureScreenshot',
      params,
    );

    if (typeof result.data !== 'string' || result.data.length === 0) {
      throw new ExtensionError(
        ErrorCode.ACTION_FAILED,
        `Failed to capture screenshot for tab ${tabId}: response did not include base64 image data`,
        false,
      );
    }

    return result.data;
  }

  async evaluate(
    tabId: number,
    expression: string,
    options?: EvaluateOptions,
  ): Promise<RuntimeEvaluateResult> {
    return this.sendCommand(tabId, 'Runtime.evaluate', {
      expression,
      ...options,
    });
  }

  async getDocument(
    tabId: number,
    depth?: number,
    pierce?: boolean,
  ): Promise<DomGetDocumentResult> {
    return this.sendCommand(tabId, 'DOM.getDocument', {
      depth,
      pierce,
    });
  }

  async querySelector(
    tabId: number,
    nodeId: number,
    selector: string,
  ): Promise<DomQuerySelectorResult> {
    return this.sendCommand(tabId, 'DOM.querySelector', {
      nodeId,
      selector,
    });
  }

  async enableFetchInterception(tabId: number, patterns?: FetchRequestPattern[]): Promise<void> {
    await this.sendCommand(tabId, 'Fetch.enable', patterns ? { patterns } : undefined);
  }

  async disableFetchInterception(tabId: number): Promise<void> {
    await this.sendCommand(tabId, 'Fetch.disable');
  }

  async continueInterceptedRequest(tabId: number, requestId: string): Promise<void> {
    await this.sendCommand(tabId, 'Fetch.continueRequest', { requestId });
  }

  async failInterceptedRequest(
    tabId: number,
    requestId: string,
    errorReason: string = 'BlockedByClient',
  ): Promise<void> {
    await this.sendCommand(tabId, 'Fetch.failRequest', { requestId, errorReason });
  }

  async fulfillInterceptedRequest(
    tabId: number,
    requestId: string,
    response: FulfillRequestParams,
  ): Promise<void> {
    await this.sendCommand(tabId, 'Fetch.fulfillRequest', {
      requestId,
      ...response,
    });
  }

  async setDeviceMetricsOverride(
    tabId: number,
    params: DeviceMetricsOverrideParams,
  ): Promise<void> {
    await this.sendCommand(tabId, 'Emulation.setDeviceMetricsOverride', params);
  }

  async clearDeviceMetricsOverride(tabId: number): Promise<void> {
    await this.sendCommand(tabId, 'Emulation.clearDeviceMetricsOverride');
  }

  async setUserAgentOverride(tabId: number, params: UserAgentOverrideParams): Promise<void> {
    await this.sendCommand(tabId, 'Emulation.setUserAgentOverride', params);
  }

  async setTouchEmulationEnabled(tabId: number, params: TouchEmulationParams): Promise<void> {
    await this.sendCommand(tabId, 'Emulation.setTouchEmulationEnabled', params);
  }

  async setGeolocationOverride(tabId: number, params: GeolocationOverrideParams): Promise<void> {
    await this.sendCommand(tabId, 'Emulation.setGeolocationOverride', params);
  }

  async clearGeolocationOverride(tabId: number): Promise<void> {
    await this.sendCommand(tabId, 'Emulation.clearGeolocationOverride');
  }

  async setFileInputFiles(tabId: number, params: SetFileInputFilesParams): Promise<void> {
    await this.sendCommand(tabId, 'DOM.setFileInputFiles', params);
  }

  async printToPDF(tabId: number, params?: PrintToPDFParams): Promise<string> {
    const result = await this.sendCommand<PrintToPDFParams | undefined, { data?: unknown }>(
      tabId,
      'Page.printToPDF',
      params,
    );

    if (typeof result.data !== 'string' || result.data.length === 0) {
      throw new ExtensionError(
        ErrorCode.ACTION_FAILED,
        `Failed to generate PDF for tab ${tabId}: response did not include base64 PDF data`,
        false,
      );
    }

    return result.data;
  }

  onEvent(listener: DebuggerEventListener): () => void {
    const handleEvent: Parameters<typeof chrome.debugger.onEvent.addListener>[0] = (
      source,
      method,
      params,
    ) => {
      if (typeof source.tabId !== 'number') {
        return;
      }

      listener({
        tabId: source.tabId,
        method,
        params: params as CDPParams | undefined,
      });
    };

    chrome.debugger.onEvent.addListener(handleEvent);
    return () => {
      chrome.debugger.onEvent.removeListener(handleEvent);
    };
  }

  onDetach(listener: DebuggerDetachListener): () => void {
    const handleDetach: Parameters<typeof chrome.debugger.onDetach.addListener>[0] = (
      source,
      reason,
    ) => {
      if (typeof source.tabId !== 'number') {
        return;
      }

      listener(source.tabId, reason);
    };

    chrome.debugger.onDetach.addListener(handleDetach);
    return () => {
      chrome.debugger.onDetach.removeListener(handleDetach);
    };
  }

  private readonly handleDetachEvent = (source: chrome.debugger.Debuggee): void => {
    if (typeof source.tabId === 'number') {
      this.attachedTabIds.delete(source.tabId);
    }
  };

  private ensureValidTabId(tabId: number): void {
    if (!Number.isInteger(tabId) || tabId <= 0) {
      throw new ExtensionError(ErrorCode.TAB_NOT_FOUND, `Invalid tab id "${tabId}"`, true);
    }
  }

  private isNotAttachedError(error: unknown): boolean {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    return message.includes('debugger is not attached') || message.includes('not attached');
  }

  private mapDebuggerError(error: unknown, tabId: number, action: string): ExtensionError {
    if (ExtensionError.isExtensionError(error)) {
      return error;
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown chrome.debugger error';
    const normalized = errorMessage.toLowerCase();

    if (
      normalized.includes('permission') ||
      normalized.includes('not allowed') ||
      normalized.includes('cannot access') ||
      normalized.includes('access denied') ||
      normalized.includes('host permission')
    ) {
      return new ExtensionError(
        ErrorCode.TAB_PERMISSION_DENIED,
        `Failed to ${action} for tab ${tabId}: ${errorMessage}`,
        true,
      );
    }

    if (
      normalized.includes('no tab with id') ||
      normalized.includes('tab not found') ||
      normalized.includes('invalid tab id') ||
      normalized.includes('no target with given id') ||
      normalized.includes('cannot find tab')
    ) {
      return new ExtensionError(
        ErrorCode.TAB_NOT_FOUND,
        `Failed to ${action} for tab ${tabId}: ${errorMessage}`,
        true,
      );
    }

    if (
      normalized.includes('closed') ||
      normalized.includes('target closed') ||
      normalized.includes('detached') ||
      normalized.includes('canceled_by_user')
    ) {
      return new ExtensionError(
        ErrorCode.TAB_CLOSED,
        `Failed to ${action} for tab ${tabId}: ${errorMessage}`,
        true,
      );
    }

    return new ExtensionError(
      ErrorCode.ACTION_FAILED,
      `Failed to ${action} for tab ${tabId}: ${errorMessage}`,
      false,
    );
  }
}
