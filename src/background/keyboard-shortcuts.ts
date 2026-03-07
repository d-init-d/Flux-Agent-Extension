import { Logger } from '@shared/utils';

export const OPEN_SIDE_PANEL_COMMAND = 'open-side-panel';

export async function openSidePanelForActiveTab(): Promise<void> {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!activeTab) {
    return;
  }

  const target: { tabId?: number; windowId?: number } = {};

  if (typeof activeTab.id === 'number') {
    target.tabId = activeTab.id;
  }

  if (typeof activeTab.windowId === 'number') {
    target.windowId = activeTab.windowId;
  }

  await chrome.sidePanel.open(target);
}

export function registerKeyboardShortcutHandlers(logger: Logger): () => void {
  const handleCommand = (command: string) => {
    if (command !== OPEN_SIDE_PANEL_COMMAND) {
      return;
    }

    void openSidePanelForActiveTab().catch((error: unknown) => {
      logger.warn('Failed to open side panel from keyboard shortcut', error);
    });
  };

  chrome.commands.onCommand.addListener(handleCommand);

  return () => {
    chrome.commands.onCommand.removeListener(handleCommand);
  };
}
