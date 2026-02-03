/**
 * Background Service Worker - Entry point
 */

import { messageHub } from './message-hub';
import { logger } from '@shared/logger';
import { Message } from '@shared/types';

logger.info('Background service worker initialized');

// Set up message listener
chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  logger.debug('Message received in background:', message);

  // Handle message asynchronously
  messageHub
    .handle(message, sender)
    .then(response => {
      sendResponse(response);
    })
    .catch(error => {
      logger.error('Error in message handler:', error);
      sendResponse({ error: String(error) });
    });

  // Return true to indicate we'll send response asynchronously
  return true;
});

// Handle extension icon click - open sidebar
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
    logger.info('Sidebar opened');
  } catch (error) {
    logger.error('Failed to open sidebar:', error);
  }
});

// Handle extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    logger.info('Extension installed');
  } else if (details.reason === 'update') {
    logger.info('Extension updated');
  }
});

// Example message handlers
messageHub.on('CHAT_SEND', async (message) => {
  logger.info('Chat message received:', message.payload);
  
  // TODO: Send to AI provider
  // For now, just echo back
  return {
    type: 'CHAT_RESPONSE',
    payload: {
      id: Date.now().toString(),
      role: 'assistant',
      content: `Echo: ${JSON.stringify(message.payload)}`,
      timestamp: Date.now(),
    },
  };
});

messageHub.on('PAGE_CONTEXT_REQUEST', async (message, sender) => {
  if (!sender.tab?.id) {
    throw new Error('No tab ID in sender');
  }

  // Forward to content script
  return messageHub.sendToTab(sender.tab.id, {
    type: 'PAGE_CONTEXT_REQUEST',
    payload: {},
    timestamp: Date.now(),
    id: message.id,
  });
});

logger.info('Background service worker ready');
