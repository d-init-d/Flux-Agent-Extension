import { ErrorCode, ExtensionError } from '@shared/errors';
import type { TabState } from '@shared/types';

const DEFAULT_TAB_URL = 'chrome://newtab';
const DEFAULT_TAB_TITLE = 'Untitled';

/**
 * Maps a Chrome Tab object into internal TabState.
 */
export function mapChromeTabToTabState(tab: chrome.tabs.Tab): TabState {
  if (tab.id === undefined) {
    throw new ExtensionError(ErrorCode.TAB_NOT_FOUND, 'Cannot map tab without id', false, { tab });
  }

  return {
    id: tab.id,
    url: tab.url ?? DEFAULT_TAB_URL,
    title: tab.title ?? DEFAULT_TAB_TITLE,
    status: tab.status === 'loading' ? 'loading' : 'complete',
    isActive: tab.active ?? false,
    contentScriptReady: false,
    lastUpdated: Date.now(),
  };
}

export class TabManager {
  async createTab(url?: string, active: boolean = true): Promise<TabState> {
    try {
      const tab = await chrome.tabs.create({ url, active });
      return this.mapChromeTab(tab);
    } catch (error: unknown) {
      throw this.mapTabsError(
        error,
        ErrorCode.NAVIGATION_FAILED,
        `Failed to create tab${url ? ` for URL "${url}"` : ''}`,
      );
    }
  }

  async closeTab(tabId?: number): Promise<void> {
    let idToClose = tabId;

    if (idToClose === undefined) {
      const activeTab = await this.getActiveTab();
      idToClose = activeTab.id;
    }

    await this.ensureTabExists(idToClose);

    try {
      await chrome.tabs.remove(idToClose);
    } catch (error: unknown) {
      throw this.mapTabsError(error, ErrorCode.TAB_CLOSED, `Failed to close tab ${idToClose}`);
    }
  }

  async switchTab(tabId: number): Promise<TabState> {
    await this.ensureTabExists(tabId);

    try {
      const tab = await chrome.tabs.update(tabId, { active: true });
      if (!tab) {
        throw new ExtensionError(
          ErrorCode.TAB_CLOSED,
          `Tab ${tabId} became unavailable while switching`,
          true,
        );
      }
      return this.mapChromeTab(tab);
    } catch (error: unknown) {
      throw this.mapTabsError(error, ErrorCode.TAB_CLOSED, `Failed to switch to tab ${tabId}`);
    }
  }

  async listTabs(): Promise<TabState[]> {
    try {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      return tabs
        .filter((tab) => tab.id !== undefined)
        .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
        .map((tab) => this.mapChromeTab(tab));
    } catch (error: unknown) {
      throw this.mapTabsError(error, ErrorCode.TAB_PERMISSION_DENIED, 'Failed to list tabs');
    }
  }

  async getTab(tabId: number): Promise<TabState> {
    const tab = await this.ensureTabExists(tabId);
    return this.mapChromeTab(tab);
  }

  async getActiveTab(): Promise<TabState> {
    let tabs: chrome.tabs.Tab[];
    try {
      tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    } catch (error: unknown) {
      throw this.mapTabsError(
        error,
        ErrorCode.TAB_PERMISSION_DENIED,
        'Failed to resolve active tab',
      );
    }

    const activeTab = tabs.find((tab) => tab.id !== undefined);
    if (!activeTab) {
      throw new ExtensionError(
        ErrorCode.TAB_NOT_FOUND,
        'No active tab found in current window',
        true,
      );
    }

    return this.mapChromeTab(activeTab);
  }

  async ensureTabExists(tabId: number): Promise<chrome.tabs.Tab> {
    try {
      return await chrome.tabs.get(tabId);
    } catch (error: unknown) {
      throw this.mapTabsError(error, ErrorCode.TAB_NOT_FOUND, `Tab ${tabId} was not found`);
    }
  }

  mapChromeTab(tab: chrome.tabs.Tab): TabState {
    return mapChromeTabToTabState(tab);
  }

  private mapTabsError(error: unknown, fallbackCode: ErrorCode, message: string): ExtensionError {
    if (ExtensionError.isExtensionError(error)) {
      return error;
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown chrome.tabs error';
    const normalized = errorMessage.toLowerCase();

    if (
      normalized.includes('permission') ||
      normalized.includes('not allowed') ||
      normalized.includes('cannot access')
    ) {
      return new ExtensionError(
        ErrorCode.TAB_PERMISSION_DENIED,
        `${message}: ${errorMessage}`,
        true,
      );
    }

    if (normalized.includes('no tab with id') || normalized.includes('tab not found')) {
      return new ExtensionError(ErrorCode.TAB_NOT_FOUND, `${message}: ${errorMessage}`, true);
    }

    if (normalized.includes('closed')) {
      return new ExtensionError(ErrorCode.TAB_CLOSED, `${message}: ${errorMessage}`, true);
    }

    return new ExtensionError(
      fallbackCode,
      `${message}: ${errorMessage}`,
      fallbackCode !== ErrorCode.NAVIGATION_FAILED,
    );
  }
}
