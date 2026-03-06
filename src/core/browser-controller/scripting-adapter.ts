import { ErrorCode, ExtensionError } from '@shared/errors';

import { TabManager } from './tab-manager';

type ScriptInjectionConfig = Omit<chrome.scripting.ScriptInjection, 'target' | 'files'>;

export class ScriptingAdapter {
  constructor(private readonly tabManager: TabManager = new TabManager()) {}

  async executeScript<TArgs extends unknown[] = unknown[], TResult = unknown>(
    tabId: number,
    script: ((...args: TArgs) => TResult) | ScriptInjectionConfig,
    args?: TArgs,
  ): Promise<chrome.scripting.InjectionResult[]> {
    await this.ensureUsableTabId(tabId);

    const injection: chrome.scripting.ScriptInjection =
      typeof script === 'function'
        ? {
            target: { tabId },
            func: script,
            args,
          }
        : {
            ...script,
            target: { tabId },
          };

    try {
      return await chrome.scripting.executeScript(injection);
    } catch (error: unknown) {
      throw this.mapScriptingError(error, tabId, 'executeScript');
    }
  }

  async executeFile(
    tabId: number,
    files: string[],
  ): Promise<chrome.scripting.InjectionResult[]> {
    await this.ensureUsableTabId(tabId);

    if (files.length === 0) {
      throw new ExtensionError(
        ErrorCode.CONTENT_SCRIPT_INJECTION_FAILED,
        'Cannot execute file without at least one script path',
        false,
      );
    }

    try {
      return await chrome.scripting.executeScript({
        target: { tabId },
        files,
      });
    } catch (error: unknown) {
      throw this.mapScriptingError(error, tabId, 'executeFile');
    }
  }

  async insertCSS(tabId: number, css: string): Promise<void> {
    await this.ensureUsableTabId(tabId);

    if (css.trim().length === 0) {
      throw new ExtensionError(
        ErrorCode.CONTENT_SCRIPT_INJECTION_FAILED,
        'Cannot insert empty CSS content',
        false,
      );
    }

    try {
      await chrome.scripting.insertCSS({
        target: { tabId },
        css,
      });
    } catch (error: unknown) {
      throw this.mapScriptingError(error, tabId, 'insertCSS');
    }
  }

  async removeCSS(tabId: number, css: string): Promise<void> {
    await this.ensureUsableTabId(tabId);

    if (css.trim().length === 0) {
      throw new ExtensionError(
        ErrorCode.CONTENT_SCRIPT_INJECTION_FAILED,
        'Cannot remove empty CSS content',
        false,
      );
    }

    try {
      await chrome.scripting.removeCSS({
        target: { tabId },
        css,
      });
    } catch (error: unknown) {
      throw this.mapScriptingError(error, tabId, 'removeCSS');
    }
  }

  private async ensureUsableTabId(tabId: number): Promise<void> {
    if (!Number.isInteger(tabId) || tabId <= 0) {
      throw new ExtensionError(
        ErrorCode.TAB_NOT_FOUND,
        `Invalid tab id "${tabId}"`,
        true,
      );
    }

    await this.tabManager.ensureTabExists(tabId);
  }

  private mapScriptingError(
    error: unknown,
    tabId: number,
    operation: 'executeScript' | 'executeFile' | 'insertCSS' | 'removeCSS',
  ): ExtensionError {
    if (ExtensionError.isExtensionError(error)) {
      return error;
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown chrome.scripting error';
    const normalizedMessage = errorMessage.toLowerCase();

    if (
      normalizedMessage.includes('permission') ||
      normalizedMessage.includes('not allowed') ||
      normalizedMessage.includes('cannot access') ||
      normalizedMessage.includes('access denied') ||
      normalizedMessage.includes('host permission')
    ) {
      return new ExtensionError(
        ErrorCode.TAB_PERMISSION_DENIED,
        `Failed to ${operation} on tab ${tabId}: ${errorMessage}`,
        true,
      );
    }

    if (
      normalizedMessage.includes('no tab with id') ||
      normalizedMessage.includes('tab not found') ||
      normalizedMessage.includes('invalid tab id')
    ) {
      return new ExtensionError(
        ErrorCode.TAB_NOT_FOUND,
        `Failed to ${operation} on tab ${tabId}: ${errorMessage}`,
        true,
      );
    }

    if (
      normalizedMessage.includes('tab closed') ||
      normalizedMessage.includes('closed') ||
      normalizedMessage.includes('discarded')
    ) {
      return new ExtensionError(
        ErrorCode.TAB_CLOSED,
        `Failed to ${operation} on tab ${tabId}: ${errorMessage}`,
        true,
      );
    }

    return new ExtensionError(
      ErrorCode.CONTENT_SCRIPT_INJECTION_FAILED,
      `Failed to ${operation} on tab ${tabId}: ${errorMessage}`,
      false,
    );
  }
}
