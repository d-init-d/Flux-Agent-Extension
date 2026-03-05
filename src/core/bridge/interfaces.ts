import type { MessageType } from '@shared/types';

/**
 * Service Worker side of the bridge.
 * Sends commands to content scripts and listens for events.
 */
export interface IServiceWorkerBridge {
  /** Send command to content script and wait for response */
  send<T, R>(tabId: number, type: MessageType, payload: T): Promise<R>;

  /** Send command without waiting for response */
  sendOneWay<T>(tabId: number, type: MessageType, payload: T): void;

  /** Listen for events from content scripts */
  onEvent(
    type: MessageType,
    handler: (tabId: number, payload: unknown) => void,
  ): () => void;

  /** Check if content script is ready */
  isReady(tabId: number): Promise<boolean>;

  /** Inject content script if not present */
  ensureContentScript(tabId: number): Promise<void>;
}

/**
 * Content Script side of the bridge.
 * Listens for commands and emits events to the service worker.
 */
export interface IContentScriptBridge {
  /** Listen for commands from service worker */
  onCommand<T>(
    type: MessageType,
    handler: (payload: T) => Promise<unknown>,
  ): () => void;

  /** Send event to service worker */
  emit<T>(type: MessageType, payload: T): void;

  /** Initialize bridge and signal readiness */
  initialize(): void;
}
