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
