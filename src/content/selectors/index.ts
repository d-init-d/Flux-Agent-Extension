/**
 * Element Selector Types and Utilities
 * Các cách tìm element trên trang web
 */

export interface ElementSelector {
  type: 'css' | 'xpath' | 'text' | 'aria' | 'id' | 'testid';
  value: string;
  index?: number; // Nếu có nhiều matches, chọn theo index
}

export interface FoundElement {
  element: Element;
  selector: ElementSelector;
  rect: DOMRect;
  isVisible: boolean;
  isInteractive: boolean;
}

/**
 * Find element by CSS selector
 */
export function findByCSS(selector: string, index = 0): Element | null {
  const elements = document.querySelectorAll(selector);
  return elements[index] || null;
}

/**
 * Find element by XPath
 */
export function findByXPath(xpath: string, index = 0): Element | null {
  const result = document.evaluate(
    xpath,
    document,
    null,
    XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
    null
  );
  return result.snapshotItem(index) as Element | null;
}

/**
 * Find element by text content
 */
export function findByText(text: string, index = 0): Element | null {
  const normalizedText = text.toLowerCase().trim();
  
  // Tìm trong các interactive elements trước
  const interactiveSelectors = 'button, a, input, select, textarea, [role="button"], [role="link"]';
  const interactiveElements = Array.from(document.querySelectorAll(interactiveSelectors));
  
  const found = interactiveElements.filter(el => {
    const content = (el.textContent || '').toLowerCase().trim();
    const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase().trim();
    const placeholder = (el.getAttribute('placeholder') || '').toLowerCase().trim();
    const title = (el.getAttribute('title') || '').toLowerCase().trim();
    
    return content.includes(normalizedText) ||
           ariaLabel.includes(normalizedText) ||
           placeholder.includes(normalizedText) ||
           title.includes(normalizedText);
  });

  if (found[index]) return found[index];

  // Fallback: tìm trong tất cả elements
  const allElements = Array.from(document.querySelectorAll('*'));
  const allFound = allElements.filter(el => {
    const content = (el.textContent || '').toLowerCase().trim();
    return content.includes(normalizedText) && el.children.length === 0;
  });

  return allFound[index] || null;
}

/**
 * Find element by ARIA role/label
 */
export function findByAria(value: string, index = 0): Element | null {
  const normalizedValue = value.toLowerCase().trim();
  
  // Try by role first
  let elements = document.querySelectorAll(`[role="${value}"]`);
  if (elements[index]) return elements[index];

  // Try by aria-label
  elements = document.querySelectorAll(`[aria-label*="${value}" i]`);
  if (elements[index]) return elements[index];

  // Try by aria-labelledby (get the referenced element's text)
  const allWithLabelledby = document.querySelectorAll('[aria-labelledby]');
  const found = Array.from(allWithLabelledby).filter(el => {
    const labelId = el.getAttribute('aria-labelledby');
    if (!labelId) return false;
    const labelEl = document.getElementById(labelId);
    return labelEl?.textContent?.toLowerCase().includes(normalizedValue);
  });

  return found[index] || null;
}

/**
 * Find element by ID
 */
export function findById(id: string): Element | null {
  return document.getElementById(id);
}

/**
 * Find element by test ID (data-testid attribute)
 */
export function findByTestId(testId: string): Element | null {
  return document.querySelector(`[data-testid="${testId}"]`) ||
         document.querySelector(`[data-test-id="${testId}"]`) ||
         document.querySelector(`[data-test="${testId}"]`);
}

/**
 * Main function to find element by selector
 */
export function findElement(selector: ElementSelector): Element | null {
  const { type, value, index = 0 } = selector;

  switch (type) {
    case 'css':
      return findByCSS(value, index);
    case 'xpath':
      return findByXPath(value, index);
    case 'text':
      return findByText(value, index);
    case 'aria':
      return findByAria(value, index);
    case 'id':
      return findById(value);
    case 'testid':
      return findByTestId(value);
    default:
      return null;
  }
}

/**
 * Find multiple elements
 */
export function findElements(selector: ElementSelector, limit = 10): Element[] {
  const elements: Element[] = [];
  
  for (let i = 0; i < limit; i++) {
    const el = findElement({ ...selector, index: i });
    if (el) {
      elements.push(el);
    } else {
      break;
    }
  }

  return elements;
}

/**
 * Check if element is visible
 */
export function isElementVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);

  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0'
  );
}

/**
 * Check if element is interactive (clickable, typable, etc.)
 */
export function isElementInteractive(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();
  const role = element.getAttribute('role');

  const interactiveTags = ['button', 'a', 'input', 'select', 'textarea', 'details', 'summary'];
  const interactiveRoles = ['button', 'link', 'checkbox', 'radio', 'textbox', 'combobox', 'menuitem', 'tab'];

  return (
    interactiveTags.includes(tagName) ||
    interactiveRoles.includes(role || '') ||
    element.hasAttribute('onclick') ||
    element.hasAttribute('tabindex') ||
    (element as HTMLElement).isContentEditable
  );
}

/**
 * Get element info for debugging
 */
export function getElementInfo(element: Element): FoundElement {
  const rect = element.getBoundingClientRect();
  
  // Try to generate a selector for this element
  let selector: ElementSelector = { type: 'css', value: '' };
  
  if (element.id) {
    selector = { type: 'id', value: element.id };
  } else {
    // Generate CSS selector
    const tag = element.tagName.toLowerCase();
    const classes = Array.from(element.classList).slice(0, 2).join('.');
    selector = { type: 'css', value: classes ? `${tag}.${classes}` : tag };
  }

  return {
    element,
    selector,
    rect,
    isVisible: isElementVisible(element),
    isInteractive: isElementInteractive(element),
  };
}
