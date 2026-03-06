import { ErrorCode, ExtensionError } from '@shared/errors';
import { TabManager, mapChromeTabToTabState } from '../tab-manager';

type TabsMockApi = chrome.tabs.TabNamespace & {
  _setTabs: (tabs: chrome.tabs.Tab[]) => void;
  _getTabs: () => chrome.tabs.Tab[];
};

function getTabsMock(): TabsMockApi {
  return chrome.tabs as TabsMockApi;
}

describe('TabManager', () => {
  let manager: TabManager;

  beforeEach(() => {
    manager = new TabManager();
  });

  it('creates a new active tab', async () => {
    const tab = await manager.createTab('https://openai.com', true);

    expect(tab.url).toBe('https://openai.com');
    expect(tab.isActive).toBe(true);
    expect(tab.status).toBe('loading');
    expect(tab.contentScriptReady).toBe(false);
  });

  it('creates a new inactive tab when active=false', async () => {
    const tab = await manager.createTab('https://example.org', false);

    expect(tab.url).toBe('https://example.org');
    expect(tab.isActive).toBe(false);
  });

  it('closes a tab by explicit id', async () => {
    const tabs = getTabsMock();
    const created = await manager.createTab('https://close-me.dev');

    await manager.closeTab(created.id);

    expect(tabs._getTabs().find((tab) => tab.id === created.id)).toBeUndefined();
  });

  it('closes active tab when id is not provided', async () => {
    const tabs = getTabsMock();
    await manager.createTab('https://active-to-close.dev', true);
    const activeBefore = await manager.getActiveTab();

    await manager.closeTab();

    expect(tabs._getTabs().find((tab) => tab.id === activeBefore.id)).toBeUndefined();
  });

  it('switches to a target tab', async () => {
    await manager.createTab('https://tab-a.dev', true);
    const tabB = await manager.createTab('https://tab-b.dev', false);

    const switched = await manager.switchTab(tabB.id);

    expect(switched.id).toBe(tabB.id);
    expect(switched.isActive).toBe(true);
  });

  it('lists tabs in current window', async () => {
    await manager.createTab('https://one.dev', false);
    await manager.createTab('https://two.dev', false);

    const tabs = await manager.listTabs();

    expect(tabs.length).toBeGreaterThanOrEqual(3);
    expect(tabs.every((tab) => typeof tab.lastUpdated === 'number')).toBe(true);
  });

  it('returns active tab', async () => {
    const active = await manager.createTab('https://active.dev', true);

    const current = await manager.getActiveTab();

    expect(current.id).toBe(active.id);
  });

  it('returns tab by id', async () => {
    const created = await manager.createTab('https://gettab.dev');

    const tab = await manager.getTab(created.id);

    expect(tab.id).toBe(created.id);
    expect(tab.url).toBe('https://gettab.dev');
  });

  it('ensureTabExists returns underlying chrome tab', async () => {
    const created = await manager.createTab('https://ensure.dev');

    const tab = await manager.ensureTabExists(created.id);

    expect(tab.id).toBe(created.id);
  });

  it('maps Chrome tab to TabState with defaults', () => {
    const mapped = mapChromeTabToTabState({
      id: 99,
      active: false,
      status: 'complete',
    });

    expect(mapped).toEqual(
      expect.objectContaining({
        id: 99,
        url: 'chrome://newtab',
        title: 'Untitled',
        status: 'complete',
        isActive: false,
        contentScriptReady: false,
      }),
    );
  });

  it('throws TAB_NOT_FOUND when getting a missing tab', async () => {
    await expect(manager.getTab(42_424)).rejects.toMatchObject({
      code: ErrorCode.TAB_NOT_FOUND,
    } satisfies Partial<ExtensionError>);
  });

  it('throws TAB_NOT_FOUND when closing without active tab', async () => {
    getTabsMock()._setTabs([]);

    await expect(manager.closeTab()).rejects.toMatchObject({
      code: ErrorCode.TAB_NOT_FOUND,
    } satisfies Partial<ExtensionError>);
  });

  it('maps permission errors to TAB_PERMISSION_DENIED when switching tab', async () => {
    const created = await manager.createTab('https://permission.dev');
    vi.spyOn(chrome.tabs, 'update').mockRejectedValueOnce(new Error('Permission denied'));

    await expect(manager.switchTab(created.id)).rejects.toMatchObject({
      code: ErrorCode.TAB_PERMISSION_DENIED,
    } satisfies Partial<ExtensionError>);
  });

  it('maps navigation failures when createTab cannot open URL', async () => {
    vi.spyOn(chrome.tabs, 'create').mockRejectedValueOnce(new Error('net::ERR_NAME_NOT_RESOLVED'));

    await expect(manager.createTab('https://does-not-resolve.invalid')).rejects.toMatchObject({
      code: ErrorCode.NAVIGATION_FAILED,
    } satisfies Partial<ExtensionError>);
  });

  it('maps close race errors to TAB_CLOSED', async () => {
    const created = await manager.createTab('https://close-race.dev');
    vi.spyOn(chrome.tabs, 'remove').mockRejectedValueOnce(new Error('Tab closed before remove'));

    await expect(manager.closeTab(created.id)).rejects.toMatchObject({
      code: ErrorCode.TAB_CLOSED,
    } satisfies Partial<ExtensionError>);
  });
});
