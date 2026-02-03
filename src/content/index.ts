/**
 * Content Script - Entry point
 * Injected into all web pages
 */

import { Message } from '@shared/types';
import { logger } from '@shared/logger';
import { domController, DOMAction } from './dom-controller';
import { ElementSelector } from './selectors';

logger.info('Flux Agent content script loaded');

// Mark that extension is injected
const MARKER_ATTR = 'data-flux-agent-injected';
if (document.documentElement.getAttribute(MARKER_ATTR)) {
  logger.warn('Content script already injected, skipping');
} else {
  document.documentElement.setAttribute(MARKER_ATTR, 'true');
}

/**
 * Parse selector from message payload
 */
function parseSelector(payload: any): ElementSelector | null {
  if (!payload?.selector) return null;
  
  // If selector is already an object
  if (typeof payload.selector === 'object') {
    return payload.selector as ElementSelector;
  }
  
  // If selector is a string, try to parse or default to CSS
  if (typeof payload.selector === 'string') {
    // Check for prefixes like "text:", "aria:", "id:"
    const prefixes = ['css:', 'xpath:', 'text:', 'aria:', 'id:', 'testid:'];
    for (const prefix of prefixes) {
      if (payload.selector.startsWith(prefix)) {
        return {
          type: prefix.slice(0, -1) as ElementSelector['type'],
          value: payload.selector.slice(prefix.length),
          index: payload.index || 0,
        };
      }
    }
    
    // Default to CSS selector
    return {
      type: 'css',
      value: payload.selector,
      index: payload.index || 0,
    };
  }
  
  return null;
}

/**
 * Handle DOM action request
 */
async function handleDOMAction(payload: any): Promise<any> {
  const action: DOMAction = {
    type: payload.action || payload.type,
    selector: parseSelector(payload) || undefined,
    options: payload.options || {},
    text: payload.text,
  };

  logger.info('Handling DOM action:', action);
  
  const result = await domController.executeAction(action);
  
  return {
    ...result,
    action: action.type,
  };
}

/**
 * Message listener
 */
chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  logger.debug('Content script received message:', message.type);

  // Use async IIFE to handle async operations
  (async () => {
    try {
      switch (message.type) {
        case 'PAGE_CONTEXT_REQUEST':
          const context = domController.getPageContext();
          sendResponse({
            type: 'PAGE_CONTEXT_RESULT',
            payload: context,
            timestamp: Date.now(),
            id: message.id,
          });
          break;

        case 'DOM_ACTION':
          const result = await handleDOMAction(message.payload);
          sendResponse({
            type: 'DOM_ACTION_RESULT',
            payload: result,
            timestamp: Date.now(),
            id: message.id,
          });
          break;

        case 'SCREENSHOT_REQUEST':
          // Screenshot sẽ được xử lý bởi background script
          sendResponse({
            success: true,
            message: 'Screenshot request acknowledged',
          });
          break;

        // Quick actions - shortcuts cho các actions phổ biến
        case 'CLICK':
          const selector = parseSelector(message.payload);
          if (!selector) {
            sendResponse({ type: 'CLICK_RESULT', payload: { success: false, message: 'Invalid selector' } });
            break;
          }
          const clickResult = await domController.click(selector, (message.payload as any).options);
          sendResponse({ type: 'CLICK_RESULT', payload: clickResult });
          break;

        case 'TYPE':
          const typeSelector = parseSelector(message.payload);
          if (!typeSelector) {
            sendResponse({ type: 'TYPE_RESULT', payload: { success: false, message: 'Invalid selector' } });
            break;
          }
          const typeResult = await domController.type(
            typeSelector,
            (message.payload as any).text,
            (message.payload as any).options
          );
          sendResponse({ type: 'TYPE_RESULT', payload: typeResult });
          break;

        case 'SCROLL':
          const scrollResult = await domController.scroll((message.payload as any)?.options);
          sendResponse({ type: 'SCROLL_RESULT', payload: scrollResult });
          break;

        case 'SCROLL_TO':
          const scrollToSelector = parseSelector(message.payload);
          if (!scrollToSelector) {
            sendResponse({ type: 'SCROLL_TO_RESULT', payload: { success: false, message: 'Invalid selector' } });
            break;
          }
          const scrollToResult = await domController.scrollTo(
            scrollToSelector,
            (message.payload as any).options
          );
          sendResponse({ type: 'SCROLL_TO_RESULT', payload: scrollToResult });
          break;

        case 'HOVER':
          const hoverSelector = parseSelector(message.payload);
          if (!hoverSelector) {
            sendResponse({ type: 'HOVER_RESULT', payload: { success: false, message: 'Invalid selector' } });
            break;
          }
          const hoverResult = await domController.hover(
            hoverSelector,
            (message.payload as any).options
          );
          sendResponse({ type: 'HOVER_RESULT', payload: hoverResult });
          break;

        case 'EXTRACT_TEXT':
          const extractSelector = parseSelector(message.payload);
          if (!extractSelector) {
            sendResponse({ type: 'EXTRACT_TEXT_RESULT', payload: { success: false, message: 'Invalid selector' } });
            break;
          }
          const extractResult = domController.extractText(extractSelector);
          sendResponse({ type: 'EXTRACT_TEXT_RESULT', payload: extractResult });
          break;

        case 'EXTRACT_TABLE':
          const tableSelector = parseSelector(message.payload);
          if (!tableSelector) {
            sendResponse({ type: 'EXTRACT_TABLE_RESULT', payload: { success: false, message: 'Invalid selector' } });
            break;
          }
          const tableResult = domController.extractTable(tableSelector);
          sendResponse({ type: 'EXTRACT_TABLE_RESULT', payload: tableResult });
          break;

        case 'EXTRACT_LINKS':
          const linksSelector = parseSelector(message.payload);
          const linksResult = domController.extractLinks(linksSelector || undefined);
          sendResponse({ type: 'EXTRACT_LINKS_RESULT', payload: linksResult });
          break;

        case 'HIGHLIGHT':
          const highlightSelector = parseSelector(message.payload);
          if (highlightSelector) {
            domController.highlight(highlightSelector, (message.payload as any).action);
          }
          sendResponse({ success: true });
          break;

        case 'REMOVE_HIGHLIGHT':
          domController.removeHighlight();
          sendResponse({ success: true });
          break;

        default:
          logger.warn('Unknown message type:', message.type);
          sendResponse({ error: 'Unknown message type' });
      }
    } catch (error) {
      logger.error('Error handling message:', error);
      sendResponse({ error: String(error) });
    }
  })();

  return true; // Keep channel open for async response
});

// Expose domController to window for debugging
if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
  (window as any).__fluxAgent = {
    domController,
    logger,
  };
}

logger.info('Content script ready with DOM Controller');
