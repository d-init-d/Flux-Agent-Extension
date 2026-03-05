/**
 * @module service-worker-bridge
 * @description Service Worker (background script) side of the messaging bridge.
 *
 * Provides request/response communication with content scripts via
 * `chrome.tabs.sendMessage`, fire-and-forget messaging, event subscription,
 * content script health checks, and automatic script injection.
 *
 * All incoming messages are validated structurally and checked against a
 * NonceTracker to prevent replay attacks.
 */

import type { IServiceWorkerBridge } from './interfaces';
import type { BridgeMessage, MessageType } from '@shared/types';
import { generateId } from '@shared/utils';
import { Logger } from '@shared/utils';
import { ExtensionError } from '@shared/errors';
import { ErrorCode } from '@shared/errors';
import { validateMessage, NonceTracker } from './message-validation';

// ============================================================================
// Constants
// ============================================================================

/** Default timeout for `send()` request/response pairs (10 seconds). */
const DEFAULT_SEND_TIMEOUT_MS = 10_000;

/** Timeout for `isReady()` PING/PONG health check (2 seconds). */
const PING_TIMEOUT_MS = 2_000;

/** Maximum number of `isReady()` retries in `ensureContentScript()`. */
const MAX_INJECTION_RETRIES = 3;

/** Delay between `isReady()` retries after script injection (500ms). */
const RETRY_DELAY_MS = 500;

/** Content script entry point injected by `ensureContentScript()`. */
const CONTENT_SCRIPT_PATH = 'content/index.js';

// ============================================================================
// Types (internal)
// ============================================================================

interface PendingRequest<R = unknown> {
  resolve: (value: R) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

type EventHandler = (tabId: number, payload: unknown) => void;

// ============================================================================
// ServiceWorkerBridge
// ============================================================================

export class ServiceWorkerBridge implements IServiceWorkerBridge {
  private readonly logger = new Logger('Bridge:SW');
  private readonly nonceTracker = new NonceTracker();

  /** Pending request/response pairs keyed by message ID. */
  private readonly pendingRequests = new Map<string, PendingRequest>();

  /** Event handlers keyed by MessageType. Each type can have many handlers. */
  private readonly eventHandlers = new Map<MessageType, Set<EventHandler>>();

  /** Bound reference to the onMessage listener so we can remove it later. */
  private readonly messageListener: (
    message: any,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void,
  ) => boolean | undefined;

  constructor() {
    this.messageListener = this.handleIncomingMessage.bind(this);
    chrome.runtime.onMessage.addListener(this.messageListener);
    this.logger.debug('ServiceWorkerBridge initialized');
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Send a command to a content script and wait for its response.
   *
   * Creates a BridgeMessage, sends it via `chrome.tabs.sendMessage`, and
   * returns a Promise that resolves when the content script replies with a
   * message whose `id` matches the original, or rejects on timeout / error.
   */
  send<T, R>(tabId: number, type: MessageType, payload: T): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      const message: BridgeMessage<T> = {
        id: generateId(),
        type,
        timestamp: Date.now(),
        payload,
      };

      // Set up timeout
      const timer = setTimeout(() => {
        this.pendingRequests.delete(message.id);
        reject(
          new ExtensionError(
            ErrorCode.TIMEOUT,
            `Bridge send timed out after ${DEFAULT_SEND_TIMEOUT_MS}ms for message type "${type}" to tab ${tabId}`,
            true,
          ),
        );
      }, DEFAULT_SEND_TIMEOUT_MS);

      // Register pending request BEFORE sending so the listener can find it
      this.pendingRequests.set(message.id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      // Use the Promise-based overload of chrome.tabs.sendMessage (MV3).
      // If the content script responds synchronously via sendResponse(),
      // the promise resolves with that response.
      chrome.tabs
        .sendMessage(tabId, message)
        .then((response: any) => {
          const pending = this.pendingRequests.get(message.id);
          if (!pending) {
            // Already resolved (via onMessage listener) or timed out
            return;
          }

          if (response !== undefined && response !== null) {
            clearTimeout(pending.timer);
            this.pendingRequests.delete(message.id);

            // If the response is a BridgeMessage, extract the payload
            if (this.isBridgeMessageLike(response)) {
              pending.resolve((response as BridgeMessage).payload);
            } else {
              pending.resolve(response);
            }
          }
        })
        .catch((error: unknown) => {
          const pending = this.pendingRequests.get(message.id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingRequests.delete(message.id);
            const errorMessage =
              error instanceof Error ? error.message : 'Unknown error';
            pending.reject(
              new ExtensionError(
                ErrorCode.CONTENT_SCRIPT_NOT_READY,
                `Failed to send message to tab ${tabId}: ${errorMessage}`,
                true,
              ),
            );
          }
        });

      this.logger.debug(`Sent message type="${type}" id="${message.id}" to tab ${tabId}`);
    });
  }

  /**
   * Send a command to a content script without waiting for a response.
   * Fire-and-forget: errors are logged but not thrown.
   */
  sendOneWay<T>(tabId: number, type: MessageType, payload: T): void {
    const message: BridgeMessage<T> = {
      id: generateId(),
      type,
      timestamp: Date.now(),
      payload,
    };

    // Fire and forget — swallow any errors
    chrome.tabs.sendMessage(tabId, message).catch((error: unknown) => {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`sendOneWay failed for tab ${tabId}: ${errorMessage}`);
    });

    this.logger.debug(`Sent one-way message type="${type}" id="${message.id}" to tab ${tabId}`);
  }

  /**
   * Subscribe to events of a specific type from content scripts.
   *
   * When a content script sends a message of the matching type (and the sender
   * has a `tab` property indicating it came from a content script), the handler
   * is invoked with `(tabId, payload)`.
   *
   * @returns An unsubscribe function that removes this handler.
   */
  onEvent(type: MessageType, handler: EventHandler): () => void {
    let handlers = this.eventHandlers.get(type);
    if (!handlers) {
      handlers = new Set();
      this.eventHandlers.set(type, handlers);
    }
    handlers.add(handler);

    this.logger.debug(`Registered event handler for type="${type}"`);

    return () => {
      const set = this.eventHandlers.get(type);
      if (set) {
        set.delete(handler);
        if (set.size === 0) {
          this.eventHandlers.delete(type);
        }
      }
      this.logger.debug(`Unregistered event handler for type="${type}"`);
    };
  }

  /**
   * Check if the content script in the given tab is alive and responding.
   * Sends a PING and expects a PONG within 2 seconds.
   */
  async isReady(tabId: number): Promise<boolean> {
    try {
      await this.sendWithTimeout<null, unknown>(tabId, 'PING', null, PING_TIMEOUT_MS);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensure a content script is running in the given tab.
   *
   * 1. Sends a PING to check if the script is already active.
   * 2. If not, injects the content script via `chrome.scripting.executeScript`.
   * 3. Retries `isReady()` up to MAX_INJECTION_RETRIES times with RETRY_DELAY_MS
   *    between attempts.
   * 4. Throws `ExtensionError(CONTENT_SCRIPT_INJECTION_FAILED)` if all retries fail.
   */
  async ensureContentScript(tabId: number): Promise<void> {
    // Quick check: maybe it's already running
    const alreadyReady = await this.isReady(tabId);
    if (alreadyReady) {
      this.logger.debug(`Content script already ready in tab ${tabId}`);
      return;
    }

    // Inject the content script
    this.logger.info(`Injecting content script into tab ${tabId}`);
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: [CONTENT_SCRIPT_PATH],
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown injection error';
      throw new ExtensionError(
        ErrorCode.CONTENT_SCRIPT_INJECTION_FAILED,
        `Failed to inject content script into tab ${tabId}: ${message}`,
        false,
      );
    }

    // Retry isReady() up to MAX_INJECTION_RETRIES times
    for (let attempt = 1; attempt <= MAX_INJECTION_RETRIES; attempt++) {
      await this.delay(RETRY_DELAY_MS);

      const ready = await this.isReady(tabId);
      if (ready) {
        this.logger.info(
          `Content script ready in tab ${tabId} after ${attempt} retry attempt(s)`,
        );
        return;
      }

      this.logger.debug(
        `isReady attempt ${attempt}/${MAX_INJECTION_RETRIES} failed for tab ${tabId}`,
      );
    }

    throw new ExtensionError(
      ErrorCode.CONTENT_SCRIPT_INJECTION_FAILED,
      `Content script in tab ${tabId} failed to respond after injection and ${MAX_INJECTION_RETRIES} retries`,
      false,
    );
  }

  /**
   * Tear down the bridge: remove the message listener, clear pending requests,
   * and destroy the nonce tracker.
   */
  destroy(): void {
    chrome.runtime.onMessage.removeListener(this.messageListener);

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(
        new ExtensionError(
          ErrorCode.ABORTED,
          `Bridge destroyed while request "${id}" was pending`,
          false,
        ),
      );
    }
    this.pendingRequests.clear();
    this.eventHandlers.clear();
    this.nonceTracker.destroy();

    this.logger.info('ServiceWorkerBridge destroyed');
  }

  // --------------------------------------------------------------------------
  // Private: incoming message handler
  // --------------------------------------------------------------------------

  /**
   * Central handler for all incoming chrome.runtime.onMessage events.
   *
   * Responsibilities:
   * 1. Validate the message structure.
   * 2. Check nonce for replay protection (event messages only).
   * 3. If the message ID matches a pending request, resolve/reject that request.
   * 4. Otherwise, forward to registered event handlers.
   *
   * Returns `undefined` (synchronous) since we don't use sendResponse here.
   */
  private handleIncomingMessage(
    message: any,
    sender: chrome.runtime.MessageSender,
    _sendResponse: (response?: any) => void,
  ): boolean | undefined {
    // Only process messages from content scripts (which have a tab)
    const tabId = sender.tab?.id;
    if (tabId === undefined) {
      return undefined;
    }

    // Structural validation
    const validation = validateMessage(message);
    if (!validation.valid) {
      this.logger.warn(`Invalid message from tab ${tabId}: ${validation.reason}`);
      return undefined;
    }

    const bridgeMessage = message as BridgeMessage;

    // Check if this is a response to a pending request
    const pending = this.pendingRequests.get(bridgeMessage.id);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(bridgeMessage.id);

      if (bridgeMessage.type === 'ERROR') {
        pending.reject(
          new ExtensionError(
            ErrorCode.ACTION_FAILED,
            `Content script returned error: ${JSON.stringify(bridgeMessage.payload)}`,
            true,
          ),
        );
      } else {
        pending.resolve(bridgeMessage.payload);
      }

      return undefined;
    }

    // Not a response to a pending request — treat as an event.
    // Apply nonce check to prevent replay of event messages.
    if (!this.nonceTracker.check(bridgeMessage.id)) {
      this.logger.debug(`Replayed message id="${bridgeMessage.id}" from tab ${tabId}, ignoring`);
      return undefined;
    }

    // Forward to registered event handlers
    const handlers = this.eventHandlers.get(bridgeMessage.type);
    if (handlers && handlers.size > 0) {
      for (const handler of handlers) {
        try {
          handler(tabId, bridgeMessage.payload);
        } catch (error: unknown) {
          this.logger.error(
            `Event handler error for type="${bridgeMessage.type}" from tab ${tabId}`,
            error,
          );
        }
      }
    }

    return undefined;
  }

  // --------------------------------------------------------------------------
  // Private: helpers
  // --------------------------------------------------------------------------

  /**
   * Send a message with a custom timeout. Used internally by `isReady()`.
   */
  private sendWithTimeout<T, R>(
    tabId: number,
    type: MessageType,
    payload: T,
    timeoutMs: number,
  ): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      const message: BridgeMessage<T> = {
        id: generateId(),
        type,
        timestamp: Date.now(),
        payload,
      };

      const timer = setTimeout(() => {
        this.pendingRequests.delete(message.id);
        reject(
          new ExtensionError(
            ErrorCode.TIMEOUT,
            `Ping timed out after ${timeoutMs}ms for tab ${tabId}`,
            true,
          ),
        );
      }, timeoutMs);

      this.pendingRequests.set(message.id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      chrome.tabs
        .sendMessage(tabId, message)
        .then((response: any) => {
          const pending = this.pendingRequests.get(message.id);
          if (!pending) {
            return;
          }

          if (response !== undefined && response !== null) {
            clearTimeout(pending.timer);
            this.pendingRequests.delete(message.id);

            if (this.isBridgeMessageLike(response)) {
              pending.resolve((response as BridgeMessage).payload);
            } else {
              pending.resolve(response);
            }
          }
        })
        .catch((error: unknown) => {
          const pending = this.pendingRequests.get(message.id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingRequests.delete(message.id);
            const errorMessage =
              error instanceof Error ? error.message : 'Unknown error';
            pending.reject(
              new ExtensionError(
                ErrorCode.CONTENT_SCRIPT_NOT_READY,
                `Failed to send message to tab ${tabId}: ${errorMessage}`,
                true,
              ),
            );
          }
        });
    });
  }

  /**
   * Check if a value looks like a BridgeMessage (duck typing).
   */
  private isBridgeMessageLike(value: unknown): boolean {
    if (value === null || value === undefined || typeof value !== 'object') {
      return false;
    }
    const obj = value as Record<string, unknown>;
    return (
      typeof obj['id'] === 'string' &&
      typeof obj['type'] === 'string' &&
      typeof obj['timestamp'] === 'number' &&
      'payload' in obj
    );
  }

  /**
   * Promise-based delay helper.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
