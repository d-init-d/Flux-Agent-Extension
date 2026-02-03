/**
 * DOM Controller
 * Main controller class để điều khiển DOM
 */

import { 
  ElementSelector, 
  findElement, 
  findElements, 
  isElementVisible, 
  isElementInteractive,
  getElementInfo 
} from './selectors';
import { 
  clickAction, ClickOptions,
  typeAction, TypeOptions,
  scrollAction, ScrollOptions,
  scrollToElementAction, ScrollToElementOptions,
  hoverAction, HoverOptions,
  leaveHoverAction
} from './actions';
import { highlighter } from './highlighter';
import { ActionResult, PageContext } from '@shared/types';
import { logger } from '@shared/logger';

export interface DOMAction {
  type: 'click' | 'type' | 'scroll' | 'scrollToElement' | 'hover' | 'leaveHover' | 'extract' | 'screenshot';
  selector?: ElementSelector;
  options?: Record<string, unknown>;
  text?: string; // For type action
}

export class DOMController {
  private showHighlights: boolean = true;

  constructor(options?: { showHighlights?: boolean }) {
    this.showHighlights = options?.showHighlights ?? true;
    logger.info('DOMController initialized');
  }

  /**
   * Execute một DOM action
   */
  async executeAction(action: DOMAction): Promise<ActionResult> {
    logger.info('Executing action:', action.type, action);

    try {
      // Highlight element trước khi thực hiện action
      if (this.showHighlights && action.selector) {
        highlighter.highlight(action.selector, action.type as any, `Performing ${action.type}...`);
      }

      let result: ActionResult;

      switch (action.type) {
        case 'click':
          if (!action.selector) {
            return { success: false, message: 'Selector required for click action' };
          }
          result = await clickAction(action.selector, action.options as ClickOptions);
          break;

        case 'type':
          if (!action.selector) {
            return { success: false, message: 'Selector required for type action' };
          }
          if (!action.text) {
            return { success: false, message: 'Text required for type action' };
          }
          result = await typeAction(action.selector, action.text, action.options as TypeOptions);
          break;

        case 'scroll':
          result = await scrollAction(action.options as ScrollOptions);
          break;

        case 'scrollToElement':
          if (!action.selector) {
            return { success: false, message: 'Selector required for scrollToElement action' };
          }
          result = await scrollToElementAction(action.selector, action.options as ScrollToElementOptions);
          break;

        case 'hover':
          if (!action.selector) {
            return { success: false, message: 'Selector required for hover action' };
          }
          result = await hoverAction(action.selector, action.options as HoverOptions);
          break;

        case 'leaveHover':
          if (!action.selector) {
            return { success: false, message: 'Selector required for leaveHover action' };
          }
          result = await leaveHoverAction(action.selector);
          break;

        case 'extract':
          if (!action.selector) {
            return { success: false, message: 'Selector required for extract action' };
          }
          result = this.extractText(action.selector);
          break;

        default:
          result = { success: false, message: `Unknown action type: ${action.type}` };
      }

      // Remove highlight sau khi action xong
      if (this.showHighlights) {
        setTimeout(() => highlighter.remove(), 500);
      }

      return result;
    } catch (error) {
      logger.error('Action execution error:', error);
      highlighter.remove();
      return { success: false, message: String(error) };
    }
  }

  /**
   * Find element
   */
  find(selector: ElementSelector): Element | null {
    return findElement(selector);
  }

  /**
   * Find multiple elements
   */
  findAll(selector: ElementSelector, limit = 10): Element[] {
    return findElements(selector, limit);
  }

  /**
   * Click element
   */
  async click(selector: ElementSelector, options?: ClickOptions): Promise<ActionResult> {
    return this.executeAction({ type: 'click', selector, options });
  }

  /**
   * Type text into element
   */
  async type(selector: ElementSelector, text: string, options?: TypeOptions): Promise<ActionResult> {
    return this.executeAction({ type: 'type', selector, text, options });
  }

  /**
   * Scroll page
   */
  async scroll(options?: ScrollOptions): Promise<ActionResult> {
    return this.executeAction({ type: 'scroll', options });
  }

  /**
   * Scroll to element
   */
  async scrollTo(selector: ElementSelector, options?: ScrollToElementOptions): Promise<ActionResult> {
    return this.executeAction({ type: 'scrollToElement', selector, options });
  }

  /**
   * Hover element
   */
  async hover(selector: ElementSelector, options?: HoverOptions): Promise<ActionResult> {
    return this.executeAction({ type: 'hover', selector, options });
  }

  /**
   * Extract text from element
   */
  extractText(selector: ElementSelector): ActionResult {
    const element = findElement(selector);
    if (!element) {
      return { success: false, message: `Element not found: ${selector.type}="${selector.value}"` };
    }

    const text = element.textContent?.trim() || '';
    return {
      success: true,
      message: `Extracted ${text.length} characters`,
      data: { text, length: text.length },
    };
  }

  /**
   * Extract HTML from element
   */
  extractHTML(selector: ElementSelector): ActionResult {
    const element = findElement(selector);
    if (!element) {
      return { success: false, message: `Element not found: ${selector.type}="${selector.value}"` };
    }

    const html = element.innerHTML;
    return {
      success: true,
      message: `Extracted HTML (${html.length} chars)`,
      data: { html, length: html.length },
    };
  }

  /**
   * Extract attribute from element
   */
  extractAttribute(selector: ElementSelector, attribute: string): ActionResult {
    const element = findElement(selector);
    if (!element) {
      return { success: false, message: `Element not found: ${selector.type}="${selector.value}"` };
    }

    const value = element.getAttribute(attribute);
    return {
      success: true,
      message: `Extracted attribute "${attribute}"`,
      data: { attribute, value },
    };
  }

  /**
   * Extract table data
   */
  extractTable(selector: ElementSelector): ActionResult {
    const element = findElement(selector);
    if (!element || element.tagName.toLowerCase() !== 'table') {
      return { success: false, message: 'Table element not found' };
    }

    const table = element as HTMLTableElement;
    const headers: string[] = [];
    const rows: string[][] = [];

    // Extract headers
    const headerRow = table.querySelector('thead tr, tr:first-child');
    if (headerRow) {
      headerRow.querySelectorAll('th, td').forEach(cell => {
        headers.push(cell.textContent?.trim() || '');
      });
    }

    // Extract rows
    table.querySelectorAll('tbody tr, tr').forEach((row, index) => {
      if (index === 0 && headers.length > 0) return; // Skip header row
      
      const cells: string[] = [];
      row.querySelectorAll('td, th').forEach(cell => {
        cells.push(cell.textContent?.trim() || '');
      });
      
      if (cells.length > 0) {
        rows.push(cells);
      }
    });

    return {
      success: true,
      message: `Extracted table with ${rows.length} rows`,
      data: { headers, rows, rowCount: rows.length, columnCount: headers.length },
    };
  }

  /**
   * Extract all links from page or element
   */
  extractLinks(selector?: ElementSelector): ActionResult {
    const container = selector ? findElement(selector) : document.body;
    if (!container) {
      return { success: false, message: 'Container not found' };
    }

    const links = Array.from(container.querySelectorAll('a[href]')).map(a => ({
      href: (a as HTMLAnchorElement).href,
      text: a.textContent?.trim() || '',
      title: a.getAttribute('title') || undefined,
    }));

    return {
      success: true,
      message: `Found ${links.length} links`,
      data: { links, count: links.length },
    };
  }

  /**
   * Get page context (for AI)
   */
  getPageContext(): PageContext {
    const url = window.location.href;
    const title = document.title;
    const description = document.querySelector('meta[name="description"]')?.getAttribute('content') || undefined;

    // Extract headings
    const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
      .slice(0, 10)
      .map(h => h.textContent?.trim())
      .filter(Boolean) as string[];

    // Extract forms
    const forms = Array.from(document.querySelectorAll('form')).slice(0, 5).map(form => ({
      id: form.id || undefined,
      name: form.getAttribute('name') || undefined,
      action: form.action || undefined,
      method: form.method || undefined,
      fields: Array.from(form.querySelectorAll('input, select, textarea')).slice(0, 10).map(field => ({
        name: field.getAttribute('name') || '',
        type: field.getAttribute('type') || field.tagName.toLowerCase(),
        label: field.getAttribute('aria-label') || 
               document.querySelector(`label[for="${field.id}"]`)?.textContent?.trim() || 
               undefined,
        placeholder: field.getAttribute('placeholder') || undefined,
        required: field.hasAttribute('required'),
      })),
    }));

    // Extract visible links
    const links = Array.from(document.querySelectorAll('a[href]'))
      .filter(a => isElementVisible(a))
      .slice(0, 20)
      .map(a => ({
        href: (a as HTMLAnchorElement).href,
        text: a.textContent?.trim() || '',
      }));

    // Extract interactive elements
    const interactiveElements = Array.from(
      document.querySelectorAll('button, a[href], input, select, [role="button"]')
    )
      .filter(el => isElementVisible(el))
      .slice(0, 30)
      .map(el => {
        let type: 'button' | 'link' | 'input' | 'select' = 'button';
        if (el.tagName === 'A') type = 'link';
        else if (el.tagName === 'INPUT') type = 'input';
        else if (el.tagName === 'SELECT') type = 'select';

        const info = getElementInfo(el);
        return {
          type,
          text: el.textContent?.trim().substring(0, 50) || '',
          selector: `${info.selector.type}:${info.selector.value}`,
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
   * Highlight element (for debugging/feedback)
   */
  highlight(selector: ElementSelector, action?: string): void {
    highlighter.highlight(selector, action as any);
  }

  /**
   * Remove highlight
   */
  removeHighlight(): void {
    highlighter.remove();
  }

  /**
   * Enable/disable highlights
   */
  setShowHighlights(show: boolean): void {
    this.showHighlights = show;
  }
}

// Export singleton instance
export const domController = new DOMController();

export default domController;
