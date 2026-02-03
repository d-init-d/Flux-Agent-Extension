/**
 * Background Service Worker - Entry point
 */

import { messageHub } from './message-hub';
import { initProviderHandlers } from './provider-handlers';
import { providerManager } from '../providers';
import { logger } from '@shared/logger';
import { Message } from '@shared/types';
import { generateId } from '@shared/utils';

logger.info('Background service worker initialized');

// Initialize provider handlers
initProviderHandlers();

// Load provider config
providerManager.loadFromStorage().catch(err => {
  logger.error('Failed to load provider config:', err);
});

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

/**
 * Helper to get active tab ID
 */
async function getActiveTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id || null;
}

/**
 * Forward message to content script of active tab
 */
async function forwardToActiveTab(message: Message): Promise<any> {
  const tabId = await getActiveTabId();
  if (!tabId) {
    throw new Error('No active tab found');
  }
  return chrome.tabs.sendMessage(tabId, message);
}

// ==================== Message Handlers ====================

// Chat message handler
messageHub.on('CHAT_SEND', async (message) => {
  logger.info('Chat message received:', message.payload);
  
  // Try to use AI provider
  const provider = providerManager.getCurrentProvider();
  
  if (provider && provider.isReady()) {
    try {
      const messages = (message.payload as any)?.messages || [];
      const response = await provider.chat(messages, {
        systemPrompt: `You are Flux Agent, an AI assistant integrated into a Chrome browser extension.
You can see and interact with web pages. When the user asks you to do something on a webpage,
explain what you would do. You have access to tools like click, type, scroll, and extract data.
Be helpful, concise, and explain your actions clearly.`,
      });
      
      return {
        type: 'CHAT_RESPONSE',
        payload: {
          id: generateId(),
          role: 'assistant',
          content: response.content,
          timestamp: Date.now(),
        },
      };
    } catch (error) {
      logger.error('AI chat error:', error);
    }
  }
  
  // Fallback if no provider configured
  const userContent = (message.payload as any)?.messages?.slice(-1)?.[0]?.content || 'Hello';
  
  return {
    type: 'CHAT_RESPONSE',
    payload: {
      id: generateId(),
      role: 'assistant',
      content: `I received your message: "${userContent}"\n\n⚠️ No AI provider configured. Please click the settings button to add an API key for Claude, OpenAI, or Gemini.\n\nOnce configured, I can help you:\n• Navigate and interact with web pages\n• Fill out forms automatically\n• Extract data from websites\n• And much more!`,
      timestamp: Date.now(),
    },
  };
});

// Page context request - forward to content script
messageHub.on('PAGE_CONTEXT_REQUEST', async (message) => {
  return forwardToActiveTab({
    type: 'PAGE_CONTEXT_REQUEST',
    payload: {},
    timestamp: Date.now(),
    id: message.id,
  });
});

// DOM Action - forward to content script
messageHub.on('DOM_ACTION', async (message) => {
  logger.info('DOM action requested:', message.payload);
  return forwardToActiveTab({
    type: 'DOM_ACTION',
    payload: message.payload,
    timestamp: Date.now(),
    id: message.id,
  });
});

// Screenshot request - use chrome.tabs.captureVisibleTab
messageHub.on('SCREENSHOT_REQUEST', async (message) => {
  const tabId = await getActiveTabId();
  if (!tabId) {
    return { success: false, message: 'No active tab found' };
  }

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });
    return {
      success: true,
      data: {
        screenshot: dataUrl,
        timestamp: Date.now(),
      },
    };
  } catch (error) {
    logger.error('Screenshot failed:', error);
    return { success: false, message: String(error) };
  }
});

// Quick action handlers - forward to content script
const quickActionTypes = [
  'CLICK', 'TYPE', 'SCROLL', 'SCROLL_TO', 'HOVER',
  'EXTRACT_TEXT', 'EXTRACT_TABLE', 'EXTRACT_LINKS',
  'HIGHLIGHT', 'REMOVE_HIGHLIGHT'
] as const;

quickActionTypes.forEach(actionType => {
  messageHub.on(actionType as any, async (message) => {
    logger.info(`${actionType} action requested:`, message.payload);
    return forwardToActiveTab({
      type: actionType as any,
      payload: message.payload,
      timestamp: Date.now(),
      id: message.id,
    });
  });
});

logger.info('Background service worker ready with DOM action handlers');
