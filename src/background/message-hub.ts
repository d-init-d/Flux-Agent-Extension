/**
 * Message Hub - Central message routing system
 */

import { Message, MessageType } from '@shared/types';
import { logger } from '@shared/logger';

type MessageHandler = (message: Message, sender: chrome.runtime.MessageSender) => Promise<any> | any;

class MessageHub {
  private handlers = new Map<MessageType, MessageHandler[]>();

  /**
   * Register a handler for a specific message type
   */
  on(type: MessageType, handler: MessageHandler): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, []);
    }
    this.handlers.get(type)!.push(handler);
    logger.debug(`Registered handler for ${type}`);
  }

  /**
   * Handle incoming message
   */
  async handle(
    message: Message,
    sender: chrome.runtime.MessageSender
  ): Promise<any> {
    logger.debug('Received message:', message.type, message);

    const handlers = this.handlers.get(message.type);
    if (!handlers || handlers.length === 0) {
      logger.warn(`No handler for message type: ${message.type}`);
      return { error: 'No handler found' };
    }

    try {
      // Execute all handlers for this message type
      const results = await Promise.all(
        handlers.map(handler => handler(message, sender))
      );
      
      // Return the first non-null result
      return results.find(r => r !== null && r !== undefined) || { success: true };
    } catch (error) {
      logger.error('Error handling message:', error);
      return { error: String(error) };
    }
  }

  /**
   * Send message to content script in specific tab
   */
  async sendToTab(tabId: number, message: Message): Promise<any> {
    try {
      logger.debug(`Sending to tab ${tabId}:`, message.type);
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
      logger.error(`Failed to send to tab ${tabId}:`, error);
      throw error;
    }
  }

  /**
   * Send message to active tab
   */
  async sendToActiveTab(message: Message): Promise<any> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error('No active tab found');
    }
    return this.sendToTab(tab.id, message);
  }

  /**
   * Broadcast message to all tabs
   */
  async broadcast(message: Message): Promise<void> {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs.map(tab => {
        if (tab.id) {
          return this.sendToTab(tab.id, message).catch(() => {
            // Ignore errors for tabs that can't receive messages
          });
        }
      })
    );
  }
}

export const messageHub = new MessageHub();
