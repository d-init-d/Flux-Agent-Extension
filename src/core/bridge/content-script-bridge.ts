/**
 * @module content-script-bridge
 * @description Content-script side of the messaging bridge. Listens for
 * commands from the service worker, dispatches them to registered handlers,
 * and emits events back to the service worker via `chrome.runtime`.
 *
 * Security: Every inbound message is structurally validated and checked
 * against a NonceTracker to reject replayed messages.
 */

import type { IContentScriptBridge } from './interfaces';
import type { BridgeMessage, MessageType } from '@shared/types';
import { generateId } from '@shared/utils';
import { Logger } from '@shared/utils';
import { validateMessage, NonceTracker } from './message-validation';

// ============================================================================
// Types
// ============================================================================

/** Internal handler signature stored in the command map. */
type CommandHandler = (payload: unknown) => Promise<unknown>;

// ============================================================================
// ContentScriptBridge
// ============================================================================

/**
 * Content-script side of the Flux Agent messaging bridge.
 *
 * Lifecycle:
 * 1. Construct an instance.
 * 2. Register command handlers via `onCommand()`.
 * 3. Call `initialize()` to wire up the chrome.runtime listener and signal
 *    readiness to the service worker with a PAGE_LOADED event.
 * 4. Call `destroy()` on page unload to clean up.
 */
export class ContentScriptBridge implements IContentScriptBridge {
  private readonly logger = new Logger('Bridge:CS');
  private readonly nonceTracker = new NonceTracker();
  private readonly handlers = new Map<MessageType, CommandHandler>();

  /**
   * Reference to the bound listener so we can remove it in `destroy()`.
   * `null` when the bridge has not been initialized or has been destroyed.
   */
  private messageListener:
    | ((
        message: unknown,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response: unknown) => void,
      ) => boolean | undefined)
    | null = null;

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Register a handler for a specific command type.
   *
   * Only one handler may be registered per MessageType. Registering a second
   * handler for the same type silently replaces the previous one.
   *
   * @returns An unsubscribe function that removes the handler.
   */
  onCommand<T>(type: MessageType, handler: (payload: T) => Promise<unknown>): () => void {
    this.handlers.set(type, handler as CommandHandler);
    this.logger.debug(`Handler registered for "${type}"`);

    return () => {
      // Only remove if the current handler is still the one we registered.
      // Prevents removing a newer handler if the caller kept a stale unsub.
      if (this.handlers.get(type) === (handler as CommandHandler)) {
        this.handlers.delete(type);
        this.logger.debug(`Handler unregistered for "${type}"`);
      }
    };
  }

  /**
   * Emit a fire-and-forget event to the service worker.
   */
  emit<T>(type: MessageType, payload: T): void {
    const message: BridgeMessage<T> = {
      id: generateId(),
      type,
      timestamp: Date.now(),
      payload,
    };

    this.logger.debug(`Emitting "${type}"`, { id: message.id });

    // chrome.runtime.sendMessage returns a promise in MV3, but we
    // intentionally fire-and-forget. Catch to suppress "no listener" errors.
    chrome.runtime.sendMessage(message).catch((error: unknown) => {
      // "Could not establish connection" is expected when the service worker
      // is not yet active or has been terminated. Don't pollute logs.
      const msg = error instanceof Error ? error.message : String(error);
      if (!msg.includes('Could not establish connection')) {
        this.logger.warn(`Failed to emit "${type}"`, { error: msg });
      }
    });
  }

  /**
   * Wire up the main `chrome.runtime.onMessage` listener and signal
   * readiness to the service worker by emitting PAGE_LOADED.
   *
   * Must only be called once. Subsequent calls are no-ops with a warning.
   */
  initialize(): void {
    if (this.messageListener !== null) {
      this.logger.warn('Bridge already initialized — skipping');
      return;
    }

    // Register built-in PING → PONG responder.
    this.onCommand<undefined>('PING', async () => {
      return { pong: true };
    });

    // Bind the dispatcher and store the reference for later removal.
    this.messageListener = this.handleIncomingMessage.bind(this);
    chrome.runtime.onMessage.addListener(this.messageListener);

    this.logger.info('Bridge initialized');

    // Signal readiness to the service worker.
    this.emit('PAGE_LOADED', {
      url: globalThis.location.href,
      title: document.title,
      origin: globalThis.location.origin,
      name: window.name || undefined,
      isTop: window.top === window,
      timestamp: Date.now(),
    });
  }

  /**
   * Tear down the bridge: remove the chrome listener, clear all handlers,
   * and destroy the nonce tracker.
   */
  destroy(): void {
    if (this.messageListener !== null) {
      chrome.runtime.onMessage.removeListener(this.messageListener);
      this.messageListener = null;
    }

    this.handlers.clear();
    this.nonceTracker.destroy();

    this.logger.info('Bridge destroyed');
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  /**
   * Central message dispatcher.
   *
   * IMPORTANT: This function MUST return `true` synchronously when it intends
   * to call `sendResponse` asynchronously. Returning `true` keeps the
   * messaging channel open until `sendResponse` is invoked.
   */
  private handleIncomingMessage(
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ): boolean | undefined {
    // --- Structural validation ------------------------------------------
    const validation = validateMessage(message);
    if (!validation.valid) {
      this.logger.warn('Invalid message received', { reason: validation.reason });
      // Nothing to correlate against — don't send a response for malformed messages.
      return undefined;
    }

    // At this point we know the structure is valid.
    const bridgeMessage = message as BridgeMessage;

    // --- Replay protection -----------------------------------------------
    if (!this.nonceTracker.check(bridgeMessage.id)) {
      this.logger.warn('Replayed message rejected', {
        id: bridgeMessage.id,
        type: bridgeMessage.type,
      });
      sendResponse(
        this.buildErrorResponse(bridgeMessage, 'REPLAY_DETECTED', 'Duplicate message ID'),
      );
      return true;
    }

    // --- Handler lookup --------------------------------------------------
    const handler = this.handlers.get(bridgeMessage.type);
    if (handler === undefined) {
      this.logger.debug(`No handler for "${bridgeMessage.type}" — ignoring`);
      // Return undefined so other potential listeners can handle it.
      return undefined;
    }

    // --- Async dispatch (return true to keep channel open) ---------------
    this.dispatchToHandler(bridgeMessage, handler, sendResponse);
    return true;
  }

  /**
   * Invoke the handler, build a response BridgeMessage, and send it back
   * through the `sendResponse` channel.
   */
  private async dispatchToHandler(
    incomingMessage: BridgeMessage,
    handler: CommandHandler,
    sendResponse: (response: unknown) => void,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      this.logger.debug(`Dispatching "${incomingMessage.type}"`, { id: incomingMessage.id });

      const result = await handler(incomingMessage.payload);

      const responseMessage: BridgeMessage = {
        id: incomingMessage.id,
        type: this.responseTypeFor(incomingMessage.type),
        timestamp: Date.now(),
        payload: result,
      };

      this.logger.debug(
        `Handler "${incomingMessage.type}" completed in ${Date.now() - startTime}ms`,
      );

      sendResponse(responseMessage);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown handler error';

      this.logger.error(`Handler "${incomingMessage.type}" threw`, error);

      sendResponse(this.buildErrorResponse(incomingMessage, 'ACTION_FAILED', errorMessage));
    }
  }

  /**
   * Build a standardised ERROR response BridgeMessage.
   */
  private buildErrorResponse(
    incomingMessage: BridgeMessage,
    code: string,
    message: string,
  ): BridgeMessage<{ code: string; message: string }> {
    return {
      id: incomingMessage.id,
      type: 'ERROR' as MessageType,
      timestamp: Date.now(),
      payload: { code, message },
    };
  }

  /**
   * Map a command MessageType to its expected response MessageType.
   *
   * Falls back to the original type for events that don't have a dedicated
   * response type (e.g. custom handlers).
   */
  private responseTypeFor(commandType: MessageType): MessageType {
    switch (commandType) {
      case 'EXECUTE_ACTION':
        return 'ACTION_RESULT';
      case 'GET_PAGE_CONTEXT':
        return 'PAGE_CONTEXT';
      case 'PING':
        return 'PONG';
      default:
        return commandType;
    }
  }
}
