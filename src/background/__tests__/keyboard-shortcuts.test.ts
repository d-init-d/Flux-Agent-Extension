import { describe, expect, it } from 'vitest';
import {
  OPEN_SIDE_PANEL_COMMAND,
  openSidePanelForActiveTab,
  registerKeyboardShortcutHandlers,
} from '../keyboard-shortcuts';
import { Logger } from '@shared/utils';

type TabsMockApi = typeof chrome.tabs & {
  _setTabs: (tabs: chrome.tabs.Tab[]) => void;
};

type CommandsMockApi = typeof chrome.commands & {
  onCommand: typeof chrome.commands.onCommand & {
    dispatch: (command: string) => void;
  };
};

function getTabsMock(): TabsMockApi {
  return chrome.tabs as TabsMockApi;
}

function getCommandsMock(): CommandsMockApi {
  return chrome.commands as CommandsMockApi;
}

describe('background keyboard shortcuts', () => {
  it('opens the side panel for the active tab', async () => {
    await openSidePanelForActiveTab();

    expect(chrome.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(chrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 1, windowId: 1 });
  });

  it('does not attempt to open the side panel when no active tab exists', async () => {
    getTabsMock()._setTabs([]);

    await openSidePanelForActiveTab();

    expect(chrome.sidePanel.open).not.toHaveBeenCalled();
  });

  it('handles only the open side panel command', async () => {
    const logger = new Logger('FluxSW:test', 'debug');
    registerKeyboardShortcutHandlers(logger);

    getCommandsMock().onCommand.dispatch('unknown-command');
    await Promise.resolve();

    expect(chrome.sidePanel.open).not.toHaveBeenCalled();

    getCommandsMock().onCommand.dispatch(OPEN_SIDE_PANEL_COMMAND);
    await Promise.resolve();

    expect(chrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 1, windowId: 1 });
  });
});
