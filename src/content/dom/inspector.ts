import type { FormInfo, FrameContextSummary, InteractiveElement, PageContext } from '@shared/types';

const INTERACTIVE_CANDIDATE_SELECTOR = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  '[role]',
  '[contenteditable]:not([contenteditable="false"])',
].join(', ');

const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'checkbox',
  'radio',
  'tab',
  'menuitem',
  'switch',
  'textbox',
  'combobox',
  'option',
  'slider',
  'spinbutton',
]);

const DEFAULT_OPTIONS: DOMInspectorOptions = {
  maxInteractiveElements: 200,
  maxHeadings: 12,
  maxLinks: 100,
  summaryMaxLength: 240,
  textTruncateShort: 100,
  textTruncateLong: 200,
};

interface DOMInspectorLogger {
  warn(message: string, data?: unknown): void;
}

export interface DOMInspectorOptions {
  maxInteractiveElements: number;
  maxHeadings: number;
  maxLinks: number;
  summaryMaxLength: number;
  textTruncateShort: number;
  textTruncateLong: number;
}

interface ElementCandidate {
  element: HTMLElement;
  rect: DOMRect;
  inViewport: boolean;
}

export class DOMInspector {
  private readonly options: DOMInspectorOptions;

  constructor(
    private readonly logger?: DOMInspectorLogger,
    options?: Partial<DOMInspectorOptions>,
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  buildPageContext(): PageContext {
    const interactiveElements = this.gatherInteractiveElements();
    const headings = this.gatherHeadings();
    const forms = this.gatherForms();
    const links = this.gatherLinks();

    return {
      url: location.href,
      title: document.title,
      summary: this.buildSummary(document.title, headings, forms, interactiveElements),
      frame: {
        frameId: 0,
        parentFrameId: window.top === window ? null : undefined,
        url: location.href,
        origin: location.origin,
        name: window.name || undefined,
        isTop: window.top === window,
      },
      interactiveElements,
      headings,
      links,
      forms,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        scrollHeight: document.documentElement.scrollHeight,
      },
      childFrames: this.gatherChildFrames(),
    };
  }

  private gatherChildFrames(): FrameContextSummary[] {
    if (window.top !== window) {
      return [];
    }

    const results: FrameContextSummary[] = [];

    try {
      const frames = document.querySelectorAll('iframe, frame');
      for (const [index, node] of frames.entries()) {
        if (!(node instanceof HTMLIFrameElement || node instanceof HTMLFrameElement)) {
          continue;
        }

        const rawUrl = node.src || node.getAttribute('src') || 'about:blank';
        let normalizedUrl = rawUrl;
        let origin = 'null';

        try {
          const parsed = new URL(rawUrl, location.href);
          normalizedUrl = parsed.href;
          origin = parsed.origin;
        } catch {
          // Keep best-effort values
        }

        results.push({
          frame: {
            frameId: index + 1,
            parentFrameId: 0,
            url: normalizedUrl,
            origin,
            name: node.name || undefined,
            isTop: false,
          },
          title: node.title || undefined,
          summary: node.getAttribute('aria-label') || undefined,
        });
      }
    } catch (error) {
      this.logger?.warn('Failed to gather child frames', error);
    }

    return results;
  }

  private gatherInteractiveElements(): InteractiveElement[] {
    const elements: InteractiveElement[] = [];

    try {
      const candidates: ElementCandidate[] = [];
      const nodes = document.querySelectorAll(INTERACTIVE_CANDIDATE_SELECTOR);
      for (const node of nodes) {
        if (!(node instanceof HTMLElement)) {
          continue;
        }
        if (!this.isInteractive(node)) {
          continue;
        }
        if (!this.isElementVisible(node)) {
          continue;
        }

        const rect = node.getBoundingClientRect();
        const inViewport = this.isRectInViewport(rect);
        if (!inViewport) {
          continue;
        }

        candidates.push({ element: node, rect, inViewport });
      }

      const limited = candidates.slice(0, this.options.maxInteractiveElements);
      for (const [index, candidate] of limited.entries()) {
        const htmlElement = candidate.element;
        const inputLike =
          htmlElement instanceof HTMLInputElement ||
          htmlElement instanceof HTMLTextAreaElement;

        elements.push({
          index,
          tag: htmlElement.tagName.toLowerCase(),
          type: htmlElement instanceof HTMLInputElement ? htmlElement.type || undefined : undefined,
          role: htmlElement.getAttribute('role') || undefined,
          text: this.getElementText(htmlElement, this.options.textTruncateShort),
          placeholder: inputLike ? htmlElement.placeholder || undefined : undefined,
          ariaLabel: htmlElement.getAttribute('aria-label') || undefined,
          isVisible: true,
          isEnabled: this.isElementEnabled(htmlElement),
          boundingBox: {
            x: candidate.rect.x,
            y: candidate.rect.y,
            width: candidate.rect.width,
            height: candidate.rect.height,
          },
        });
      }
    } catch (error) {
      this.logger?.warn('Failed to gather interactive elements', error);
    }

    return elements;
  }

  private gatherHeadings(): Array<{ level: number; text: string }> {
    const headings: Array<{ level: number; text: string }> = [];

    try {
      const nodes = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      for (const node of nodes) {
        if (!(node instanceof HTMLElement)) {
          continue;
        }
        if (!this.isElementVisible(node)) {
          continue;
        }

        const rect = node.getBoundingClientRect();
        if (!this.isRectInViewport(rect)) {
          continue;
        }

        const level = Number.parseInt(node.tagName.charAt(1), 10);
        headings.push({
          level,
          text: this.getElementText(node, this.options.textTruncateLong),
        });

        if (headings.length >= this.options.maxHeadings) {
          break;
        }
      }
    } catch (error) {
      this.logger?.warn('Failed to gather headings', error);
    }

    return headings;
  }

  private gatherLinks(): Array<{ text: string; href: string }> {
    const links: Array<{ text: string; href: string }> = [];

    try {
      const nodes = document.querySelectorAll('a[href]');
      for (const node of nodes) {
        if (!(node instanceof HTMLAnchorElement)) {
          continue;
        }
        if (!this.isElementVisible(node)) {
          continue;
        }

        const rect = node.getBoundingClientRect();
        if (!this.isRectInViewport(rect)) {
          continue;
        }

        links.push({
          text: this.getElementText(node, this.options.textTruncateShort),
          href: node.href,
        });

        if (links.length >= this.options.maxLinks) {
          break;
        }
      }
    } catch (error) {
      this.logger?.warn('Failed to gather links', error);
    }

    return links;
  }

  private gatherForms(): FormInfo[] {
    const forms: FormInfo[] = [];

    try {
      const formNodes = document.querySelectorAll('form');
      for (const formNode of formNodes) {
        if (!(formNode instanceof HTMLFormElement)) {
          continue;
        }
        if (!this.isElementVisible(formNode)) {
          continue;
        }

        const formRect = formNode.getBoundingClientRect();
        if (!this.isRectInViewport(formRect)) {
          continue;
        }

        const fields: FormInfo['fields'] = [];
        const inputNodes = formNode.querySelectorAll('input, select, textarea');
        for (const inputNode of inputNodes) {
          if (!this.isFieldElement(inputNode)) {
            continue;
          }

          if (inputNode instanceof HTMLInputElement && inputNode.type === 'hidden') {
            continue;
          }

          const type = this.resolveFieldType(inputNode);
          const isPassword = type === 'password';

          fields.push({
            name: inputNode.name || inputNode.id || '',
            type,
            label: this.resolveFieldLabel(inputNode),
            required: inputNode.required,
            value: isPassword ? undefined : inputNode.value || undefined,
          });
        }

        forms.push({
          action: formNode.action || '',
          method: (formNode.method || 'get').toUpperCase(),
          fields,
        });
      }
    } catch (error) {
      this.logger?.warn('Failed to gather forms', error);
    }

    return forms;
  }

  private buildSummary(
    title: string,
    headings: Array<{ level: number; text: string }>,
    forms: FormInfo[],
    interactiveElements: InteractiveElement[],
  ): string {
    const firstHeading = headings.find((heading) => heading.level === 1) ?? headings[0];
    const formCount = forms.length;
    const interactiveCount = interactiveElements.length;

    let buttonCount = 0;
    let linkCount = 0;
    let fieldCount = 0;

    for (const element of interactiveElements) {
      const role = element.role?.toLowerCase();
      if (element.tag === 'button' || role === 'button') {
        buttonCount++;
      }
      if (element.tag === 'a' || role === 'link') {
        linkCount++;
      }
      if (
        element.tag === 'input' ||
        element.tag === 'select' ||
        element.tag === 'textarea' ||
        role === 'textbox' ||
        role === 'combobox'
      ) {
        fieldCount++;
      }
    }

    const headingPart = firstHeading?.text
      ? `heading "${firstHeading.text}"`
      : 'no visible headings';
    const formPart = formCount === 0 ? 'no visible forms' : `${formCount} visible form${formCount > 1 ? 's' : ''}`;
    const interactionPart =
      `${interactiveCount} interactive elements` +
      ` (${buttonCount} buttons, ${linkCount} links, ${fieldCount} fields)`;

    const cleanTitle = title.trim().length > 0 ? title.trim() : 'Untitled page';
    return truncateText(
      `${cleanTitle}: ${headingPart}; ${formPart}; ${interactionPart}.`,
      this.options.summaryMaxLength,
    );
  }

  private isInteractive(element: HTMLElement): boolean {
    const tag = element.tagName.toLowerCase();
    if (tag === 'button' || tag === 'select' || tag === 'textarea') {
      return true;
    }

    if (tag === 'a' && element.hasAttribute('href')) {
      return true;
    }

    if (tag === 'input') {
      return (element as HTMLInputElement).type !== 'hidden';
    }

    const role = element.getAttribute('role');
    if (role && INTERACTIVE_ROLES.has(role.toLowerCase())) {
      return true;
    }

    if (element.isContentEditable) {
      return true;
    }

    const contentEditableAttr = element.getAttribute('contenteditable');
    return contentEditableAttr !== null && contentEditableAttr.toLowerCase() !== 'false';
  }

  private isElementVisible(element: HTMLElement): boolean {
    const computedStyle = window.getComputedStyle(element);
    if (computedStyle.display === 'none') return false;
    if (computedStyle.visibility === 'hidden' || computedStyle.visibility === 'collapse') return false;
    if (Number.parseFloat(computedStyle.opacity || '1') <= 0) return false;
    if (element.hasAttribute('hidden')) return false;
    if (element.getAttribute('aria-hidden') === 'true') return false;

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  private isRectInViewport(rect: DOMRect | DOMRectReadOnly): boolean {
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth
    );
  }

  private isElementEnabled(element: HTMLElement): boolean {
    if (element.getAttribute('aria-disabled') === 'true') {
      return false;
    }

    if (
      element instanceof HTMLButtonElement ||
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLOptGroupElement ||
      element instanceof HTMLOptionElement ||
      element instanceof HTMLFieldSetElement
    ) {
      return !element.disabled;
    }

    return true;
  }

  private isFieldElement(
    element: Element,
  ): element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
    return (
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement
    );
  }

  private resolveFieldType(
    input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  ): string {
    if (input instanceof HTMLSelectElement) {
      return 'select';
    }
    if (input instanceof HTMLTextAreaElement) {
      return 'textarea';
    }
    return input.type || 'text';
  }

  private resolveFieldLabel(
    input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  ): string | undefined {
    if (input.id) {
      const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (label instanceof HTMLElement) {
        const text = this.getElementText(label, this.options.textTruncateShort);
        if (text.length > 0) {
          return text;
        }
      }
    }

    return input.getAttribute('aria-label') || undefined;
  }

  private getElementText(element: HTMLElement, maxLength: number): string {
    const fromInnerText = element.innerText?.trim();
    const fallback = element.textContent?.trim();
    const text = fromInnerText && fromInnerText.length > 0 ? fromInnerText : fallback || '';
    return truncateText(text.replace(/\s+/g, ' '), maxLength);
  }
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 1) + '\u2026';
}
