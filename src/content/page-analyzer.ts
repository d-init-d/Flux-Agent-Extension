/**
 * Page Analyzer
 * Phân tích trang web và convert thành text cho AI đọc
 */

import { ElementSelector, findElement, isElementVisible } from '../selectors';

export interface PageAnalysis {
  /** URL của trang */
  url: string;
  /** Title của trang */
  title: string;
  /** Meta description */
  description?: string;
  /** Main content text */
  mainContent: string;
  /** Headings structure */
  headings: HeadingInfo[];
  /** Interactive elements */
  interactiveElements: InteractiveInfo[];
  /** Forms on page */
  forms: FormAnalysis[];
  /** Images with alt text */
  images: ImageInfo[];
  /** Links */
  links: LinkInfo[];
  /** Tables */
  tables: TableInfo[];
  /** Accessibility tree (simplified) */
  accessibilityTree: AccessibilityNode[];
  /** Page statistics */
  stats: PageStats;
}

export interface HeadingInfo {
  level: number;
  text: string;
  id?: string;
}

export interface InteractiveInfo {
  type: 'button' | 'link' | 'input' | 'select' | 'checkbox' | 'radio' | 'textarea';
  text: string;
  selector: string;
  attributes: Record<string, string>;
  isVisible: boolean;
  isEnabled: boolean;
}

export interface FormAnalysis {
  id?: string;
  name?: string;
  action?: string;
  method: string;
  fields: FormFieldInfo[];
}

export interface FormFieldInfo {
  type: string;
  name?: string;
  id?: string;
  label?: string;
  placeholder?: string;
  value?: string;
  required: boolean;
  selector: string;
}

export interface ImageInfo {
  src: string;
  alt?: string;
  title?: string;
  width?: number;
  height?: number;
}

export interface LinkInfo {
  href: string;
  text: string;
  isExternal: boolean;
  selector: string;
}

export interface TableInfo {
  headers: string[];
  rows: string[][];
  selector: string;
  caption?: string;
}

export interface AccessibilityNode {
  role: string;
  name: string;
  description?: string;
  children?: AccessibilityNode[];
  selector?: string;
}

export interface PageStats {
  wordCount: number;
  linkCount: number;
  imageCount: number;
  formCount: number;
  headingCount: number;
  interactiveCount: number;
}

/**
 * Analyze entire page
 */
export function analyzePage(): PageAnalysis {
  const url = window.location.href;
  const title = document.title;
  const description = document.querySelector('meta[name="description"]')?.getAttribute('content') || undefined;

  const headings = extractHeadings();
  const interactiveElements = extractInteractiveElements();
  const forms = extractForms();
  const images = extractImages();
  const links = extractLinks();
  const tables = extractTables();
  const mainContent = extractMainContent();
  const accessibilityTree = buildAccessibilityTree();

  const stats: PageStats = {
    wordCount: mainContent.split(/\s+/).filter(Boolean).length,
    linkCount: links.length,
    imageCount: images.length,
    formCount: forms.length,
    headingCount: headings.length,
    interactiveCount: interactiveElements.length,
  };

  return {
    url,
    title,
    description,
    mainContent,
    headings,
    interactiveElements,
    forms,
    images,
    links,
    tables,
    accessibilityTree,
    stats,
  };
}

/**
 * Extract headings with hierarchy
 */
function extractHeadings(): HeadingInfo[] {
  const headings: HeadingInfo[] = [];
  
  document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(heading => {
    if (!isElementVisible(heading)) return;
    
    const level = parseInt(heading.tagName.charAt(1));
    headings.push({
      level,
      text: heading.textContent?.trim() || '',
      id: heading.id || undefined,
    });
  });

  return headings;
}

/**
 * Extract interactive elements
 */
function extractInteractiveElements(): InteractiveInfo[] {
  const elements: InteractiveInfo[] = [];
  const seen = new Set<Element>();

  const selectors = [
    'button',
    'a[href]',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[onclick]',
    '[tabindex]:not([tabindex="-1"])',
  ];

  document.querySelectorAll(selectors.join(', ')).forEach(el => {
    if (seen.has(el) || !isElementVisible(el)) return;
    seen.add(el);

    const tagName = el.tagName.toLowerCase();
    let type: InteractiveInfo['type'] = 'button';

    if (tagName === 'a') type = 'link';
    else if (tagName === 'input') {
      const inputType = (el as HTMLInputElement).type.toLowerCase();
      if (inputType === 'checkbox') type = 'checkbox';
      else if (inputType === 'radio') type = 'radio';
      else type = 'input';
    }
    else if (tagName === 'select') type = 'select';
    else if (tagName === 'textarea') type = 'textarea';

    // Generate selector
    let selector = tagName;
    if (el.id) {
      selector = `#${el.id}`;
    } else if (el.className && typeof el.className === 'string') {
      const firstClass = el.className.split(' ').filter(Boolean)[0];
      if (firstClass) selector = `${tagName}.${firstClass}`;
    }

    // Get attributes
    const attributes: Record<string, string> = {};
    ['id', 'name', 'type', 'value', 'placeholder', 'aria-label', 'title'].forEach(attr => {
      const val = el.getAttribute(attr);
      if (val) attributes[attr] = val;
    });

    elements.push({
      type,
      text: el.textContent?.trim().substring(0, 100) || el.getAttribute('aria-label') || '',
      selector,
      attributes,
      isVisible: true,
      isEnabled: !(el as HTMLButtonElement).disabled,
    });
  });

  return elements.slice(0, 50); // Limit to 50 elements
}

/**
 * Extract forms with fields
 */
function extractForms(): FormAnalysis[] {
  const forms: FormAnalysis[] = [];

  document.querySelectorAll('form').forEach((form, formIndex) => {
    const fields: FormFieldInfo[] = [];

    form.querySelectorAll('input, select, textarea').forEach((field, fieldIndex) => {
      const el = field as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      if (el.type === 'hidden') return;

      // Find label
      let label = '';
      if (el.id) {
        const labelEl = document.querySelector(`label[for="${el.id}"]`);
        label = labelEl?.textContent?.trim() || '';
      }
      if (!label) {
        const parentLabel = el.closest('label');
        label = parentLabel?.textContent?.trim() || '';
      }
      if (!label) {
        label = el.getAttribute('aria-label') || el.placeholder || '';
      }

      fields.push({
        type: el.type || el.tagName.toLowerCase(),
        name: el.name || undefined,
        id: el.id || undefined,
        label: label || undefined,
        placeholder: el.placeholder || undefined,
        value: el.value || undefined,
        required: el.required,
        selector: el.id ? `#${el.id}` : `form:nth-of-type(${formIndex + 1}) ${el.tagName.toLowerCase()}:nth-of-type(${fieldIndex + 1})`,
      });
    });

    forms.push({
      id: form.id || undefined,
      name: form.getAttribute('name') || undefined,
      action: form.action || undefined,
      method: form.method || 'get',
      fields,
    });
  });

  return forms;
}

/**
 * Extract images
 */
function extractImages(): ImageInfo[] {
  const images: ImageInfo[] = [];

  document.querySelectorAll('img').forEach(img => {
    if (!isElementVisible(img)) return;

    images.push({
      src: img.src,
      alt: img.alt || undefined,
      title: img.title || undefined,
      width: img.naturalWidth || undefined,
      height: img.naturalHeight || undefined,
    });
  });

  return images.slice(0, 20);
}

/**
 * Extract links
 */
function extractLinks(): LinkInfo[] {
  const links: LinkInfo[] = [];
  const currentHost = window.location.host;

  document.querySelectorAll('a[href]').forEach((a, index) => {
    if (!isElementVisible(a)) return;

    const href = (a as HTMLAnchorElement).href;
    const isExternal = !href.includes(currentHost) && !href.startsWith('/') && !href.startsWith('#');

    let selector = 'a';
    if (a.id) selector = `#${a.id}`;
    else if (a.className && typeof a.className === 'string') {
      const firstClass = a.className.split(' ').filter(Boolean)[0];
      if (firstClass) selector = `a.${firstClass}`;
    }

    links.push({
      href,
      text: a.textContent?.trim().substring(0, 100) || '',
      isExternal,
      selector,
    });
  });

  return links.slice(0, 30);
}

/**
 * Extract tables
 */
function extractTables(): TableInfo[] {
  const tables: TableInfo[] = [];

  document.querySelectorAll('table').forEach((table, index) => {
    const headers: string[] = [];
    const rows: string[][] = [];

    // Get headers
    table.querySelectorAll('thead th, tr:first-child th').forEach(th => {
      headers.push(th.textContent?.trim() || '');
    });

    // Get rows
    table.querySelectorAll('tbody tr, tr').forEach((tr, rowIndex) => {
      if (rowIndex === 0 && headers.length > 0) return; // Skip header row

      const cells: string[] = [];
      tr.querySelectorAll('td, th').forEach(cell => {
        cells.push(cell.textContent?.trim() || '');
      });

      if (cells.length > 0) {
        rows.push(cells);
      }
    });

    if (rows.length > 0) {
      tables.push({
        headers,
        rows: rows.slice(0, 20), // Limit rows
        selector: table.id ? `#${table.id}` : `table:nth-of-type(${index + 1})`,
        caption: table.querySelector('caption')?.textContent?.trim(),
      });
    }
  });

  return tables;
}

/**
 * Extract main content text
 */
function extractMainContent(): string {
  // Try to find main content area
  const mainSelectors = ['main', 'article', '[role="main"]', '#content', '.content', '#main', '.main'];
  
  let mainElement: Element | null = null;
  for (const selector of mainSelectors) {
    mainElement = document.querySelector(selector);
    if (mainElement) break;
  }

  // Fallback to body
  if (!mainElement) {
    mainElement = document.body;
  }

  // Extract text, excluding scripts, styles, nav, footer, etc.
  const excludeSelectors = ['script', 'style', 'nav', 'footer', 'header', 'aside', '.sidebar', '.menu', '.navigation'];
  
  const clone = mainElement.cloneNode(true) as Element;
  excludeSelectors.forEach(selector => {
    clone.querySelectorAll(selector).forEach(el => el.remove());
  });

  // Clean up text
  let text = clone.textContent || '';
  text = text.replace(/\s+/g, ' ').trim();
  
  // Limit length
  if (text.length > 5000) {
    text = text.substring(0, 5000) + '...';
  }

  return text;
}

/**
 * Build simplified accessibility tree
 */
function buildAccessibilityTree(): AccessibilityNode[] {
  const nodes: AccessibilityNode[] = [];

  // Get landmark regions
  const landmarks = [
    { selector: 'header, [role="banner"]', role: 'banner' },
    { selector: 'nav, [role="navigation"]', role: 'navigation' },
    { selector: 'main, [role="main"]', role: 'main' },
    { selector: 'aside, [role="complementary"]', role: 'complementary' },
    { selector: 'footer, [role="contentinfo"]', role: 'contentinfo' },
  ];

  landmarks.forEach(({ selector, role }) => {
    document.querySelectorAll(selector).forEach(el => {
      nodes.push({
        role,
        name: el.getAttribute('aria-label') || el.id || role,
        description: `Contains ${el.querySelectorAll('a, button, input').length} interactive elements`,
        selector,
      });
    });
  });

  return nodes;
}

/**
 * Convert page analysis to text format for AI
 */
export function pageAnalysisToText(analysis: PageAnalysis): string {
  const lines: string[] = [];

  lines.push(`# ${analysis.title}`);
  lines.push(`URL: ${analysis.url}`);
  if (analysis.description) {
    lines.push(`Description: ${analysis.description}`);
  }
  lines.push('');

  // Stats
  lines.push(`## Page Statistics`);
  lines.push(`- Words: ${analysis.stats.wordCount}`);
  lines.push(`- Links: ${analysis.stats.linkCount}`);
  lines.push(`- Images: ${analysis.stats.imageCount}`);
  lines.push(`- Forms: ${analysis.stats.formCount}`);
  lines.push(`- Interactive elements: ${analysis.stats.interactiveCount}`);
  lines.push('');

  // Headings
  if (analysis.headings.length > 0) {
    lines.push(`## Page Structure`);
    analysis.headings.forEach(h => {
      lines.push(`${'  '.repeat(h.level - 1)}- ${h.text}`);
    });
    lines.push('');
  }

  // Interactive elements
  if (analysis.interactiveElements.length > 0) {
    lines.push(`## Interactive Elements`);
    analysis.interactiveElements.slice(0, 20).forEach((el, i) => {
      lines.push(`${i + 1}. [${el.type.toUpperCase()}] "${el.text}" (${el.selector})`);
    });
    lines.push('');
  }

  // Forms
  if (analysis.forms.length > 0) {
    lines.push(`## Forms`);
    analysis.forms.forEach((form, i) => {
      lines.push(`### Form ${i + 1}${form.name ? `: ${form.name}` : ''}`);
      form.fields.forEach(field => {
        const required = field.required ? ' *' : '';
        lines.push(`  - [${field.type}] ${field.label || field.name || 'unnamed'}${required}`);
      });
    });
    lines.push('');
  }

  // Main content (truncated)
  lines.push(`## Main Content`);
  lines.push(analysis.mainContent.substring(0, 1000));
  if (analysis.mainContent.length > 1000) {
    lines.push('...(truncated)');
  }

  return lines.join('\n');
}

export const pageAnalyzer = {
  analyze: analyzePage,
  toText: pageAnalysisToText,
};

export default pageAnalyzer;
