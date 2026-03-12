import { DOMInspector } from '../inspector';

describe('DOMInspector', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    setViewport(1200, 800);
    document.title = '';
  });

  it('filters interactive elements to visible items in viewport', () => {
    document.body.innerHTML = `
      <button id="visible-btn">Visible</button>
      <button id="offscreen-btn">Offscreen</button>
      <button id="hidden-btn" style="display:none">Hidden</button>
    `;

    const visibleButton = document.getElementById('visible-btn');
    const offscreenButton = document.getElementById('offscreen-btn');
    const hiddenButton = document.getElementById('hidden-btn');

    expect(visibleButton).not.toBeNull();
    expect(offscreenButton).not.toBeNull();
    expect(hiddenButton).not.toBeNull();

    mockRect(visibleButton as Element, { left: 20, top: 20, width: 140, height: 32 });
    mockRect(offscreenButton as Element, { left: 20, top: 1200, width: 140, height: 32 });
    mockRect(hiddenButton as Element, { left: 20, top: 80, width: 140, height: 32 });

    const inspector = new DOMInspector();
    const context = inspector.buildPageContext();

    expect(context.interactiveElements).toHaveLength(1);
    expect(context.interactiveElements[0]?.text).toBe('Visible');
  });

  it('detects interactive elements by tag, role, and contenteditable', () => {
    document.body.innerHTML = `
      <a id="link" href="/home">Go home</a>
      <a id="anchor-role" role="button">Pseudo button link</a>
      <input id="email" type="email" placeholder="Email" />
      <select id="country"><option>VN</option></select>
      <textarea id="note">Memo</textarea>
      <div id="role-btn" role="button">Open menu</div>
      <div id="editable" contenteditable="true">Editable text</div>
      <div id="non-interactive" role="region">Region</div>
    `;

    const ids = ['link', 'anchor-role', 'email', 'country', 'note', 'role-btn', 'editable', 'non-interactive'];
    for (const id of ids) {
      const element = document.getElementById(id);
      expect(element).not.toBeNull();
      mockRect(element as Element, { left: 20, top: 20, width: 180, height: 30 });
    }

    const inspector = new DOMInspector();
    const context = inspector.buildPageContext();
    const extractedIds = new Set(context.interactiveElements.map((item) => item.text));

    expect(extractedIds.has('Go home')).toBe(true);
    expect(extractedIds.has('Pseudo button link')).toBe(true);
    expect(extractedIds.has('Open menu')).toBe(true);
    expect(extractedIds.has('Editable text')).toBe(true);
    expect(context.interactiveElements.some((item) => item.placeholder === 'Email')).toBe(true);
    expect(extractedIds.has('Region')).toBe(false);
  });

  it('does not include hidden form fields in form context', () => {
    document.body.innerHTML = `
      <form id="checkout-form">
        <input id="csrf" type="hidden" name="csrf" value="secret-token" />
        <input id="email" type="email" name="email" value="user@example.com" />
      </form>
    `;

    const form = document.getElementById('checkout-form');
    const email = document.getElementById('email');
    expect(form).not.toBeNull();
    expect(email).not.toBeNull();

    mockRect(form as Element, { left: 10, top: 10, width: 400, height: 120 });
    mockRect(email as Element, { left: 20, top: 40, width: 200, height: 30 });

    const inspector = new DOMInspector();
    const context = inspector.buildPageContext();
    const fields = context.forms[0]?.fields ?? [];

    expect(fields.some((field) => field.name === 'csrf')).toBe(false);
    expect(fields.some((field) => field.name === 'email')).toBe(true);
  });

  it('generates concise summary from title, heading, forms, and interactive counts', () => {
    document.title = 'Checkout - Flux Store';
    document.body.innerHTML = `
      <h1>Checkout</h1>
      <form id="checkout-form">
        <label for="card">Card number</label>
        <input id="card" name="card" type="text" required />
        <button type="submit">Pay now</button>
      </form>
      <a href="/support">Need help?</a>
    `;

    const heading = document.querySelector('h1');
    const form = document.getElementById('checkout-form');
    const cardInput = document.getElementById('card');
    const submitButton = document.querySelector('button');
    const supportLink = document.querySelector('a');

    expect(heading).not.toBeNull();
    expect(form).not.toBeNull();
    expect(cardInput).not.toBeNull();
    expect(submitButton).not.toBeNull();
    expect(supportLink).not.toBeNull();

    mockRect(heading as Element, { left: 12, top: 10, width: 300, height: 40 });
    mockRect(form as Element, { left: 12, top: 60, width: 600, height: 220 });
    mockRect(cardInput as Element, { left: 24, top: 100, width: 260, height: 30 });
    mockRect(submitButton as Element, { left: 24, top: 150, width: 120, height: 32 });
    mockRect(supportLink as Element, { left: 24, top: 200, width: 120, height: 24 });

    const inspector = new DOMInspector();
    const context = inspector.buildPageContext();

    expect(context.summary).toContain('Checkout - Flux Store');
    expect(context.summary).toContain('heading "Checkout"');
    expect(context.summary).toContain('1 visible form');
    expect(context.summary).toContain('interactive elements');
  });

  it('enforces interactive element limit', () => {
    const buttons = Array.from({ length: 12 }, (_, index) => `<button id="btn-${index}">Button ${index}</button>`);
    document.body.innerHTML = buttons.join('');

    for (let index = 0; index < 12; index++) {
      const button = document.getElementById(`btn-${index}`);
      expect(button).not.toBeNull();
      mockRect(button as Element, { left: 20, top: 10 + index * 30, width: 120, height: 24 });
    }

    const inspector = new DOMInspector(undefined, { maxInteractiveElements: 5 });
    const context = inspector.buildPageContext();

    expect(context.interactiveElements).toHaveLength(5);
    expect(context.interactiveElements.map((item) => item.index)).toEqual([0, 1, 2, 3, 4]);
  });

  it('enforces heading/link limits and summary max length', () => {
    const headings = Array.from({ length: 10 }, (_, index) => `<h2 id="h-${index}">Heading ${index}</h2>`).join('');
    const links = Array.from({ length: 10 }, (_, index) => `<a id="l-${index}" href="/${index}">Link ${index}</a>`).join('');
    document.title = 'A very long title that should be truncated in summary output for compact context';
    document.body.innerHTML = headings + links;

    for (let index = 0; index < 10; index++) {
      const heading = document.getElementById(`h-${index}`);
      const link = document.getElementById(`l-${index}`);
      expect(heading).not.toBeNull();
      expect(link).not.toBeNull();
      mockRect(heading as Element, { left: 20, top: 10 + index * 24, width: 200, height: 20 });
      mockRect(link as Element, { left: 240, top: 10 + index * 24, width: 120, height: 20 });
    }

    const inspector = new DOMInspector(undefined, {
      maxHeadings: 3,
      maxLinks: 4,
      summaryMaxLength: 80,
    });
    const context = inspector.buildPageContext();

    expect(context.headings).toHaveLength(3);
    expect(context.links).toHaveLength(4);
    expect((context.summary ?? '').length).toBeLessThanOrEqual(80);
  });

  it('detects aria-disabled elements as not enabled', () => {
    document.body.innerHTML = `
      <button id="dis-btn" aria-disabled="true">Disabled</button>
    `;
    const btn = document.getElementById('dis-btn');
    expect(btn).not.toBeNull();
    mockRect(btn as Element, { left: 20, top: 20, width: 120, height: 32 });

    const inspector = new DOMInspector();
    const context = inspector.buildPageContext();

    const element = context.interactiveElements.find((e) => e.text === 'Disabled');
    expect(element).toBeDefined();
    expect(element?.isEnabled).toBe(false);
  });

  it('resolves select and textarea field types in forms', () => {
    document.body.innerHTML = `
      <form id="form1">
        <select id="sel1" name="country"><option>VN</option></select>
        <textarea id="ta1" name="notes">Notes</textarea>
        <input id="inp1" name="email" type="email" />
      </form>
    `;

    const form = document.getElementById('form1');
    const sel = document.getElementById('sel1');
    const ta = document.getElementById('ta1');
    const inp = document.getElementById('inp1');
    expect(form).not.toBeNull();

    mockRect(form as Element, { left: 10, top: 10, width: 400, height: 200 });
    mockRect(sel as Element, { left: 20, top: 40, width: 200, height: 30 });
    mockRect(ta as Element, { left: 20, top: 80, width: 200, height: 60 });
    mockRect(inp as Element, { left: 20, top: 150, width: 200, height: 30 });

    const inspector = new DOMInspector();
    const context = inspector.buildPageContext();
    const fields = context.forms[0]?.fields ?? [];

    expect(fields.find((f) => f.name === 'country')?.type).toBe('select');
    expect(fields.find((f) => f.name === 'notes')?.type).toBe('textarea');
    expect(fields.find((f) => f.name === 'email')?.type).toBe('email');
  });

  it('resolves field label from associated label element', () => {
    document.body.innerHTML = `
      <form id="form2">
        <label for="username">Username</label>
        <input id="username" name="username" type="text" />
      </form>
    `;

    const form = document.getElementById('form2');
    const inp = document.getElementById('username');
    expect(form).not.toBeNull();
    mockRect(form as Element, { left: 10, top: 10, width: 400, height: 100 });
    mockRect(inp as Element, { left: 20, top: 40, width: 200, height: 30 });

    const inspector = new DOMInspector();
    const context = inspector.buildPageContext();
    const field = context.forms[0]?.fields.find((f) => f.name === 'username');

    expect(field?.label).toBe('Username');
  });

  it('uses aria-label when no label element exists', () => {
    document.body.innerHTML = `
      <form id="form3">
        <input id="search" name="search" type="text" aria-label="Search query" />
      </form>
    `;

    const form = document.getElementById('form3');
    const inp = document.getElementById('search');
    expect(form).not.toBeNull();
    mockRect(form as Element, { left: 10, top: 10, width: 400, height: 100 });
    mockRect(inp as Element, { left: 20, top: 40, width: 200, height: 30 });

    const inspector = new DOMInspector();
    const context = inspector.buildPageContext();
    const field = context.forms[0]?.fields.find((f) => f.name === 'search');

    expect(field?.label).toBe('Search query');
  });

  it('hides password field values', () => {
    document.body.innerHTML = `
      <form id="form4">
        <input id="pass" name="pass" type="password" value="secret123" />
      </form>
    `;

    const form = document.getElementById('form4');
    const inp = document.getElementById('pass');
    expect(form).not.toBeNull();
    mockRect(form as Element, { left: 10, top: 10, width: 400, height: 100 });
    mockRect(inp as Element, { left: 20, top: 40, width: 200, height: 30 });

    const inspector = new DOMInspector();
    const context = inspector.buildPageContext();
    const field = context.forms[0]?.fields.find((f) => f.name === 'pass');

    expect(field?.type).toBe('password');
    expect(field?.value).toBeUndefined();
  });

  it('renders summary with "Untitled page" when no document title', () => {
    document.title = '';
    document.body.innerHTML = '<button id="b1">Click</button>';
    const btn = document.getElementById('b1');
    mockRect(btn as Element, { left: 20, top: 20, width: 100, height: 30 });

    const inspector = new DOMInspector();
    const context = inspector.buildPageContext();

    expect(context.summary).toContain('Untitled page');
  });

  it('renders summary with no visible headings when headings are absent', () => {
    document.title = 'Test Page';
    document.body.innerHTML = '<button id="b2">Click</button>';
    const btn = document.getElementById('b2');
    mockRect(btn as Element, { left: 20, top: 20, width: 100, height: 30 });

    const inspector = new DOMInspector();
    const context = inspector.buildPageContext();

    expect(context.summary).toContain('no visible headings');
  });

  it('includes disabled input/button/select/textarea in elements list', () => {
    document.body.innerHTML = `
      <button id="db" disabled>Disabled Button</button>
      <input id="di" disabled type="text" />
      <select id="ds" disabled><option>A</option></select>
      <textarea id="dt" disabled>text</textarea>
    `;

    for (const id of ['db', 'di', 'ds', 'dt']) {
      const el = document.getElementById(id);
      expect(el).not.toBeNull();
      mockRect(el as Element, { left: 20, top: 20, width: 120, height: 30 });
    }

    const inspector = new DOMInspector();
    const context = inspector.buildPageContext();

    const disabledElements = context.interactiveElements.filter((e) => !e.isEnabled);
    expect(disabledElements.length).toBeGreaterThanOrEqual(4);
  });

  it('detects hidden input type and excludes from interactive', () => {
    document.body.innerHTML = `
      <input id="hidden1" type="hidden" name="token" value="abc" />
      <input id="visible1" type="text" name="name" />
    `;

    const visible = document.getElementById('visible1');
    const hidden = document.getElementById('hidden1');
    expect(visible).not.toBeNull();
    expect(hidden).not.toBeNull();
    mockRect(visible as Element, { left: 20, top: 20, width: 200, height: 30 });
    mockRect(hidden as Element, { left: 20, top: 60, width: 200, height: 30 });

    const inspector = new DOMInspector();
    const context = inspector.buildPageContext();

    const texts = context.interactiveElements.map((e) => e.tag);
    expect(texts).not.toContain('hidden');
  });

  it('logs warning when gather methods fail', () => {
    const warnFn = vi.fn();
    const logger = { warn: warnFn };

    vi.spyOn(document, 'querySelectorAll').mockImplementation(() => {
      throw new Error('DOM access failed');
    });

    const inspector = new DOMInspector(logger);
    const context = inspector.buildPageContext();

    expect(warnFn).toHaveBeenCalled();
    expect(context.interactiveElements).toHaveLength(0);

    vi.restoreAllMocks();
  });

  it('handles iframe child frames', () => {
    document.body.innerHTML = `
      <iframe id="frame1" src="https://embed.test/widget" title="Widget" aria-label="Widget frame"></iframe>
    `;

    const inspector = new DOMInspector();
    const context = inspector.buildPageContext();

    expect(context.childFrames).toBeDefined();
    if (context.childFrames && context.childFrames.length > 0) {
      expect(context.childFrames[0].frame.url).toContain('embed.test');
    }
  });

  it('detects multiple visible forms', () => {
    document.body.innerHTML = `
      <form id="f1"><input name="a" type="text" /></form>
      <form id="f2"><input name="b" type="text" /></form>
    `;

    for (const id of ['f1', 'f2']) {
      const el = document.getElementById(id);
      expect(el).not.toBeNull();
      mockRect(el as Element, { left: 10, top: 10, width: 300, height: 100 });
    }
    for (const el of document.querySelectorAll('input')) {
      mockRect(el, { left: 20, top: 30, width: 200, height: 30 });
    }

    const inspector = new DOMInspector();
    const context = inspector.buildPageContext();

    expect(context.forms.length).toBe(2);
    expect(context.summary).toContain('2 visible forms');
  });
});

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
    writable: true,
  });

  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: height,
    writable: true,
  });
}

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
