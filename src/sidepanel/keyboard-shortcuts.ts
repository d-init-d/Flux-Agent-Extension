import { useEffect } from 'react';
import type { ExtensionMessage } from '@shared/types';
import { generateId } from '@shared/utils';

export function createAbortShortcutMessage(): ExtensionMessage<{ sessionId?: string }> {
  return {
    id: generateId(),
    channel: 'sidePanel',
    type: 'ACTION_ABORT',
    payload: {},
    timestamp: Date.now(),
  };
}

export async function dispatchAbortShortcut(): Promise<void> {
  await chrome.runtime.sendMessage(createAbortShortcutMessage());
}

function shouldHandleEscapeShortcut(event: KeyboardEvent): boolean {
  return (
    event.key === 'Escape' &&
    !event.repeat &&
    !event.defaultPrevented &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  );
}

export function useEscapeToStopShortcut(): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!shouldHandleEscapeShortcut(event)) {
        return;
      }

      event.preventDefault();

      void dispatchAbortShortcut().catch((error: unknown) => {
        console.warn('[Flux Agent] Failed to dispatch abort shortcut', error);
      });
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);
}
