import type { ElementSelector } from '@shared/types';
import { SelectorEngine } from '../selector-engine';

describe('SelectorEngine', () => {
  let engine: SelectorEngine;

  beforeEach(() => {
    document.body.innerHTML = '';
    engine = new SelectorEngine();
  });

  it('resolves css and nth selectors', () => {
    document.body.innerHTML = `
      <div class="target">First</div>
      <div class="target">Second</div>
      <div class="target">Third</div>
    `;

    const selector: ElementSelector = { css: '.target', nth: 1 };
    const match = engine.findElement(selector);

    expect(match).not.toBeNull();
    expect(match?.textContent).toBe('Second');
    expect(engine.findElements(selector)).toHaveLength(1);
  });

  it('resolves xpath selectors', () => {
    document.body.innerHTML = `
      <section>
        <button id="go">Go</button>
      </section>
    `;

    const match = engine.findElement({ xpath: '//*[@id="go"]' });

    expect(match).toBeInstanceOf(HTMLButtonElement);
    expect((match as HTMLButtonElement).id).toBe('go');
  });

  it('resolves text and textExact selectors', () => {
    document.body.innerHTML = `
      <button id="submit-btn">Submit Order</button>
      <button id="cancel-btn">Cancel</button>
    `;

    const containsMatch = engine.findElement({ text: 'Submit' });
    const exactMatch = engine.findElement({ textExact: 'Cancel' });

    expect((containsMatch as HTMLButtonElement).id).toBe('submit-btn');
    expect((exactMatch as HTMLButtonElement).id).toBe('cancel-btn');
  });

  it('resolves ariaLabel, placeholder, role, and testId selectors', () => {
    document.body.innerHTML = `
      <input id="email" aria-label="Email address" placeholder="Enter email" />
      <button id="open-menu" data-testid="menu-trigger">Menu</button>
      <button id="implicit-role">Continue</button>
    `;

    const ariaMatch = engine.findElement({ ariaLabel: 'Email address' });
    const placeholderMatch = engine.findElement({ placeholder: 'Enter email' });
    const testIdMatch = engine.findElement({ testId: 'menu-trigger' });
    const roleMatch = engine.findElement({ role: 'button', nth: 1 });

    expect((ariaMatch as HTMLInputElement).id).toBe('email');
    expect((placeholderMatch as HTMLInputElement).id).toBe('email');
    expect((testIdMatch as HTMLButtonElement).id).toBe('open-menu');
    expect((roleMatch as HTMLButtonElement).id).toBe('implicit-role');
  });

  it('applies withinSection filtering after strategy resolution', () => {
    document.body.innerHTML = `
      <section id="account">
        <h2>Account</h2>
        <button data-testid="save-action">Save</button>
      </section>
      <section id="billing">
        <h2>Billing</h2>
        <button data-testid="save-action">Save</button>
      </section>
    `;

    const match = engine.findElement({
      testId: 'save-action',
      withinSection: 'Billing',
    });

    expect(match).not.toBeNull();
    expect(match?.closest('section')?.id).toBe('billing');
  });

  it('returns null for non-matching selector', () => {
    document.body.innerHTML = '<div>nothing here</div>';
    expect(engine.findElement({ css: '.nonexistent' })).toBeNull();
    expect(engine.findElements({ css: '.nonexistent' })).toEqual([]);
  });

  it('handles invalid css selector gracefully', () => {
    document.body.innerHTML = '<div>test</div>';
    expect(engine.findElement({ css: '!!invalid' })).toBeNull();
  });

  it('handles invalid xpath selector gracefully', () => {
    document.body.innerHTML = '<div>test</div>';
    expect(engine.findElement({ xpath: '!!invalid' })).toBeNull();
  });

  it('skips empty string selectors', () => {
    document.body.innerHTML = '<div>test</div>';
    expect(engine.findElement({ css: '', text: '' })).toBeNull();
    expect(engine.findElement({ css: '   ' })).toBeNull();
  });

  it('resolves implicit link role', () => {
    document.body.innerHTML = '<a href="/test" id="link">Link</a>';
    const match = engine.findElement({ role: 'link' });
    expect((match as HTMLElement).id).toBe('link');
  });

  it('resolves implicit textbox role', () => {
    document.body.innerHTML = '<input id="input1" type="text" /><textarea id="ta"></textarea>';
    const matches = engine.findElements({ role: 'textbox' });
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('resolves implicit checkbox role', () => {
    document.body.innerHTML = '<input type="checkbox" id="cb" />';
    const match = engine.findElement({ role: 'checkbox' });
    expect((match as HTMLElement).id).toBe('cb');
  });

  it('resolves implicit radio role', () => {
    document.body.innerHTML = '<input type="radio" id="radio1" />';
    const match = engine.findElement({ role: 'radio' });
    expect((match as HTMLElement).id).toBe('radio1');
  });

  it('returns empty for unknown implicit role', () => {
    document.body.innerHTML = '<div>test</div>';
    expect(engine.findElement({ role: 'nonexistent' })).toBeNull();
  });

  it('applyNth with negative nth returns all elements', () => {
    document.body.innerHTML = '<div class="t">A</div><div class="t">B</div>';
    const matches = engine.findElements({ css: '.t', nth: -1 });
    expect(matches).toHaveLength(2);
  });

  it('applyNth with out-of-range nth returns empty', () => {
    document.body.innerHTML = '<div class="t">A</div>';
    const matches = engine.findElements({ css: '.t', nth: 5 });
    expect(matches).toHaveLength(0);
  });

  it('withinSection returns empty when no section matches', () => {
    document.body.innerHTML = `
      <section><h2>Account</h2><button id="btn">Click</button></section>
    `;
    const match = engine.findElement({ css: '#btn', withinSection: 'Nonexistent' });
    expect(match).toBeNull();
  });

  it('withinSection with empty string is ignored', () => {
    document.body.innerHTML = '<button id="btn">Click</button>';
    const match = engine.findElement({ css: '#btn', withinSection: '' });
    expect((match as HTMLElement).id).toBe('btn');
  });

  it('findElements with root element parameter', () => {
    document.body.innerHTML = `
      <div id="container"><span class="item">Inside</span></div>
      <span class="item">Outside</span>
    `;
    const container = document.getElementById('container')!;
    const matches = engine.findElements({ css: '.item' }, container);
    expect(matches).toHaveLength(1);
    expect(matches[0].textContent).toBe('Inside');
  });

  it('findByTextPredicate with non-Document root', () => {
    document.body.innerHTML = `
      <div id="root"><button>Click Me</button></div>
      <button>Outside</button>
    `;
    const root = document.getElementById('root')!;
    const match = engine.findElement({ text: 'Click Me' }, root);
    expect(match).not.toBeNull();
  });

  it('deduplicates elements in results', () => {
    document.body.innerHTML = '<button id="btn" role="button">Click</button>';
    const matches = engine.findElements({ role: 'button' });
    const ids = matches.map(el => (el as HTMLElement).id);
    const uniqueIds = [...new Set(ids)];
    expect(ids.length).toBe(uniqueIds.length);
  });

  it('nearText with no interactive candidates returns empty', () => {
    document.body.innerHTML = '<div>Some label text</div><p>Just text</p>';
    const match = engine.findElement({ nearText: 'Some label' });
    expect(match).toBeNull();
  });

  it('nearText with no matching anchor text returns empty', () => {
    document.body.innerHTML = '<div>Label</div><button>Click</button>';
    const match = engine.findElement({ nearText: 'Nonexistent' });
    expect(match).toBeNull();
  });

  it('findSectionRoots with heading element uses parentElement', () => {
    document.body.innerHTML = `
      <div id="parent">
        <h2>Settings</h2>
        <button id="target">Save</button>
      </div>
    `;
    const match = engine.findElement({ css: '#target', withinSection: 'Settings' });
    expect(match).not.toBeNull();
    expect((match as HTMLElement).id).toBe('target');
  });

  it('resolves nearText using label-for mapping and proximity fallback', () => {
    document.body.innerHTML = `
      <label for="email-input">Email</label>
      <input id="email-input" />

      <div id="username-label">Username</div>
      <button id="username-near">Pick username</button>
      <button id="username-far">Other action</button>
    `;

    const usernameAnchor = document.getElementById('username-label');
    const nearButton = document.getElementById('username-near');
    const farButton = document.getElementById('username-far');

    expect(usernameAnchor).not.toBeNull();
    expect(nearButton).not.toBeNull();
    expect(farButton).not.toBeNull();

    mockRect(usernameAnchor as Element, { left: 100, top: 100, width: 100, height: 24 });
    mockRect(nearButton as Element, { left: 120, top: 136, width: 140, height: 30 });
    mockRect(farButton as Element, { left: 520, top: 520, width: 140, height: 30 });

    const labelLinkedMatch = engine.findElement({ nearText: 'Email' });
    const proximityMatch = engine.findElement({ nearText: 'Username' });

    expect((labelLinkedMatch as HTMLInputElement).id).toBe('email-input');
    expect((proximityMatch as HTMLButtonElement).id).toBe('username-near');
  });
});

function mockRect(
  element: Element,
  rect: Partial<Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>>,
): void {
  const left = rect.left ?? 0;
  const top = rect.top ?? 0;
  const width = rect.width ?? 1;
  const height = rect.height ?? 1;

  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: (): DOMRect => {
      const right = left + width;
      const bottom = top + height;
      return {
        x: left,
        y: top,
        left,
        top,
        width,
        height,
        right,
        bottom,
        toJSON: () => ({}),
      } as DOMRect;
    },
  });
}
