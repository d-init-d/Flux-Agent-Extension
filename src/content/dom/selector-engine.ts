import type { ElementSelector } from '@shared/types';

const INTERACTIVE_SELECTOR = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[contenteditable="true"]',
].join(', ');

const SECTION_CONTAINER_SELECTOR = 'section, article, main, aside, nav, form, [role="region"], [role="form"]';

const TEXTUAL_SELECTOR_KEYS: Array<keyof ElementSelector> = [
  'css',
  'xpath',
  'textExact',
  'text',
  'ariaLabel',
  'placeholder',
  'testId',
  'role',
  'nearText',
];

export class SelectorEngine {
  findElement(selector: ElementSelector, root?: Document | Element): Element | null {
    return this.findElements(selector, root)[0] ?? null;
  }

  findElements(selector: ElementSelector, root?: Document | Element): Element[] {
    const scope = root ?? document;
    const matches = this.resolveByStrategy(selector, scope);
    if (matches.length === 0) {
      return [];
    }

    const withinSection = this.filterWithinSection(matches, selector.withinSection, scope);
    return this.applyNth(withinSection, selector.nth);
  }

  private resolveByStrategy(selector: ElementSelector, root: Document | Element): Element[] {
    for (const key of TEXTUAL_SELECTOR_KEYS) {
      const value = selector[key];
      if (typeof value !== 'string' || value.trim().length === 0) {
        continue;
      }

      const query = value.trim();
      let matches: Element[] = [];

      switch (key) {
        case 'css':
          matches = this.findByCss(query, root);
          break;
        case 'xpath':
          matches = this.findByXpath(query, root);
          break;
        case 'textExact':
          matches = this.findByTextExact(query, root);
          break;
        case 'text':
          matches = this.findByTextContains(query, root);
          break;
        case 'ariaLabel':
          matches = this.findByAttribute('aria-label', query, root);
          break;
        case 'placeholder':
          matches = this.findByAttribute('placeholder', query, root);
          break;
        case 'testId':
          matches = this.findByAttribute('data-testid', query, root);
          break;
        case 'role':
          matches = this.findByRole(query, root);
          break;
        case 'nearText':
          matches = this.findNearText(query, root);
          break;
        default:
          matches = [];
      }

      const uniqueMatches = this.uniqueElements(matches);
      if (uniqueMatches.length > 0) {
        return uniqueMatches;
      }
    }

    return [];
  }

  private findByCss(css: string, root: Document | Element): Element[] {
    try {
      return Array.from(root.querySelectorAll(css));
    } catch {
      return [];
    }
  }

  private findByXpath(xpath: string, root: Document | Element): Element[] {
    const results: Element[] = [];
    const doc = root instanceof Document ? root : root.ownerDocument;
    if (!doc) {
      return [];
    }

    const contextNode = root instanceof Document ? doc : root;
    try {
      const snapshot = doc.evaluate(
        xpath,
        contextNode,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null,
      );
      for (let i = 0; i < snapshot.snapshotLength; i++) {
        const item = snapshot.snapshotItem(i);
        if (item instanceof Element) {
          results.push(item);
        }
      }
    } catch {
      return [];
    }

    return results;
  }

  private findByTextExact(text: string, root: Document | Element): Element[] {
    return this.findByTextPredicate(root, (candidateText) => candidateText === text);
  }

  private findByTextContains(text: string, root: Document | Element): Element[] {
    const lower = text.toLowerCase();
    return this.findByTextPredicate(root, (candidateText) =>
      candidateText.toLowerCase().includes(lower),
    );
  }

  private findByTextPredicate(
    root: Document | Element,
    predicate: (normalizedText: string) => boolean,
  ): Element[] {
    const nodes =
      root instanceof Document
        ? Array.from(root.querySelectorAll('*'))
        : [root, ...Array.from(root.querySelectorAll('*'))];
    const results: Element[] = [];

    for (const node of nodes) {
      const text = this.getElementText(node);
      if (text.length === 0) {
        continue;
      }
      if (predicate(text)) {
        const hasMatchingChild = Array.from(node.children).some((child) => {
          const childText = this.getElementText(child);
          return childText.length > 0 && predicate(childText);
        });

        if (hasMatchingChild) {
          continue;
        }

        results.push(node);
      }
    }

    return results;
  }

  private findByAttribute(attr: string, value: string, root: Document | Element): Element[] {
    try {
      return Array.from(root.querySelectorAll(`[${CSS.escape(attr)}="${CSS.escape(value)}"]`));
    } catch {
      return [];
    }
  }

  private findByRole(role: string, root: Document | Element): Element[] {
    const explicit = this.findByAttribute('role', role, root);
    const implicit = this.findByImplicitRole(role, root);
    return this.uniqueElements([...explicit, ...implicit]);
  }

  private findByImplicitRole(role: string, root: Document | Element): Element[] {
    const normalized = role.toLowerCase();
    switch (normalized) {
      case 'button':
        return Array.from(root.querySelectorAll('button, input[type="button"], input[type="submit"], input[type="reset"]'));
      case 'link':
        return Array.from(root.querySelectorAll('a[href]'));
      case 'textbox':
        return Array.from(root.querySelectorAll('input:not([type]), input[type="text"], input[type="email"], input[type="password"], input[type="search"], input[type="url"], input[type="tel"], textarea'));
      case 'checkbox':
        return Array.from(root.querySelectorAll('input[type="checkbox"]'));
      case 'radio':
        return Array.from(root.querySelectorAll('input[type="radio"]'));
      default:
        return [];
    }
  }

  private findNearText(text: string, root: Document | Element): Element[] {
    const anchors = this.findByTextContains(text, root);
    if (anchors.length === 0) {
      return [];
    }

    const candidates = Array.from(root.querySelectorAll(INTERACTIVE_SELECTOR));
    if (candidates.length === 0) {
      return [];
    }

    const scored: Array<{ element: Element; score: number }> = [];

    for (const anchor of anchors) {
      const labelTarget = this.findElementLinkedByLabel(anchor, root);
      if (labelTarget) {
        scored.push({ element: labelTarget, score: -1 });
      }

      const anchorCenter = this.getRectCenter(anchor.getBoundingClientRect());
      for (const candidate of candidates) {
        if (candidate === anchor) {
          continue;
        }
        if (anchor.contains(candidate) || candidate.contains(anchor)) {
          continue;
        }

        const candidateCenter = this.getRectCenter(candidate.getBoundingClientRect());
        const dx = candidateCenter.x - anchorCenter.x;
        const dy = candidateCenter.y - anchorCenter.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const directionalPenalty = dy < 0 ? 15 : 0;
        scored.push({ element: candidate, score: distance + directionalPenalty });
      }
    }

    scored.sort((a, b) => a.score - b.score);
    return this.uniqueElements(scored.map((item) => item.element));
  }

  private findElementLinkedByLabel(anchor: Element, root: Document | Element): Element | null {
    if (!(anchor instanceof HTMLLabelElement) || !anchor.htmlFor) {
      return null;
    }

    const doc = root instanceof Document ? root : root.ownerDocument;
    if (!doc) {
      return null;
    }

    const target = doc.getElementById(anchor.htmlFor);
    if (!target) {
      return null;
    }

    if (root instanceof Element && !root.contains(target)) {
      return null;
    }

    return target;
  }

  private filterWithinSection(
    elements: Element[],
    sectionName: string | undefined,
    root: Document | Element,
  ): Element[] {
    if (typeof sectionName !== 'string' || sectionName.trim().length === 0) {
      return elements;
    }

    const sectionRoots = this.findSectionRoots(sectionName.trim(), root);
    if (sectionRoots.length === 0) {
      return [];
    }

    return elements.filter((element) => sectionRoots.some((sectionRoot) => sectionRoot.contains(element)));
  }

  private findSectionRoots(sectionName: string, root: Document | Element): Element[] {
    const nameLower = sectionName.toLowerCase();
    const sectionSearchSelector =
      'h1, h2, h3, h4, h5, h6, section, article, main, aside, nav, form, [role="region"], [role="form"], [aria-label]';
    const scopeElements =
      root instanceof Document
        ? Array.from(root.querySelectorAll(sectionSearchSelector))
        : root.matches(sectionSearchSelector)
          ? [root, ...Array.from(root.querySelectorAll(sectionSearchSelector))]
          : Array.from(root.querySelectorAll(sectionSearchSelector));
    const sectionRoots: Element[] = [];

    for (const element of scopeElements) {
      const text = this.getElementText(element).toLowerCase();
      if (!text.includes(nameLower)) {
        continue;
      }

      const candidateRoot =
        element.closest(SECTION_CONTAINER_SELECTOR) ??
        (this.isHeadingElement(element) ? element.parentElement : null) ??
        element;

      sectionRoots.push(candidateRoot);
    }

    return this.uniqueElements(sectionRoots);
  }

  private applyNth(elements: Element[], nth: number | undefined): Element[] {
    if (typeof nth !== 'number' || nth < 0) {
      return elements;
    }

    const item = elements[nth];
    return item ? [item] : [];
  }

  private uniqueElements(elements: Element[]): Element[] {
    const seen = new Set<Element>();
    const unique: Element[] = [];

    for (const element of elements) {
      if (seen.has(element)) {
        continue;
      }
      seen.add(element);
      unique.push(element);
    }

    return unique;
  }

  private getElementText(element: Element): string {
    return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  private isHeadingElement(element: Element): boolean {
    const tag = element.tagName.toUpperCase();
    return tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4' || tag === 'H5' || tag === 'H6';
  }

  private getRectCenter(rect: DOMRect | DOMRectReadOnly): { x: number; y: number } {
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }
}
