/**
 * Content Script - Entry point
 * Injected into all web pages
 */

import { Message, PageContext } from '@shared/types';
import { logger } from '@shared/logger';

logger.info('Flux Agent content script loaded');

// Mark that extension is injected
const MARKER_ATTR = 'data-flux-agent-injected';
if (document.documentElement.getAttribute(MARKER_ATTR)) {
  logger.warn('Content script already injected, skipping');
} else {
  document.documentElement.setAttribute(MARKER_ATTR, 'true');
}

/**
 * Extract page context information
 */
function extractPageContext(): PageContext {
  const url = window.location.href;
  const title = document.title;
  const description = document.querySelector('meta[name="description"]')?.getAttribute('content') || undefined;

  // Extract headings
  const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
    .map(h => h.textContent?.trim())
    .filter(Boolean) as string[];

  // Extract forms
  const forms = Array.from(document.querySelectorAll('form')).map(form => ({
    id: form.id || undefined,
    name: form.getAttribute('name') || undefined,
    action: form.action || undefined,
    method: form.method || undefined,
    fields: Array.from(form.querySelectorAll('input, select, textarea')).map(field => ({
      name: field.getAttribute('name') || '',
      type: field.getAttribute('type') || field.tagName.toLowerCase(),
      label: field.getAttribute('aria-label') || 
             document.querySelector(`label[for="${field.id}"]`)?.textContent?.trim() || 
             undefined,
      placeholder: field.getAttribute('placeholder') || undefined,
      required: field.hasAttribute('required'),
    })),
  }));

  // Extract links (top 20 visible links)
  const links = Array.from(document.querySelectorAll('a[href]'))
    .filter(a => {
      const rect = a.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    })
    .slice(0, 20)
    .map(a => ({
      href: (a as HTMLAnchorElement).href,
      text: a.textContent?.trim() || '',
    }));

  // Extract interactive elements
  const interactiveElements = Array.from(
    document.querySelectorAll('button, a[href], input, select')
  )
    .filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    })
    .slice(0, 30)
    .map(el => {
      let type: 'button' | 'link' | 'input' | 'select' = 'button';
      if (el.tagName === 'A') type = 'link';
      else if (el.tagName === 'INPUT') type = 'input';
      else if (el.tagName === 'SELECT') type = 'select';

      // Generate a simple selector
      let selector = el.tagName.toLowerCase();
      if (el.id) selector += `#${el.id}`;
      else if (el.className) {
        const classes = el.className.toString().split(' ').filter(Boolean);
        if (classes.length > 0) {
          selector += `.${classes[0]}`;
        }
      }

      return {
        type,
        text: el.textContent?.trim().substring(0, 50) || '',
        selector,
      };
    });

  return {
    url,
    title,
    description,
    headings,
    forms,
    links,
    interactiveElements,
  };
}

/**
 * Message listener
 */
chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  logger.debug('Content script received message:', message.type);

  try {
    switch (message.type) {
      case 'PAGE_CONTEXT_REQUEST':
        const context = extractPageContext();
        sendResponse({
          type: 'PAGE_CONTEXT_RESULT',
          payload: context,
          timestamp: Date.now(),
          id: message.id,
        });
        break;

      case 'DOM_ACTION':
        // TODO: Handle DOM actions in Phase 2
        logger.info('DOM action requested:', message.payload);
        sendResponse({
          type: 'DOM_ACTION_RESULT',
          payload: {
            success: false,
            message: 'DOM actions not implemented yet (Phase 2)',
          },
          timestamp: Date.now(),
          id: message.id,
        });
        break;

      case 'SCREENSHOT_REQUEST':
        // Screenshot will be handled by background script using chrome.tabs.captureVisibleTab
        logger.info('Screenshot requested');
        sendResponse({
          success: true,
          message: 'Screenshot request forwarded to background',
        });
        break;

      default:
        logger.warn('Unknown message type:', message.type);
        sendResponse({ error: 'Unknown message type' });
    }
  } catch (error) {
    logger.error('Error handling message:', error);
    sendResponse({ error: String(error) });
  }

  return true; // Keep channel open for async response
});

logger.info('Content script ready');
