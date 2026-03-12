import type { PageContext, Session } from '@shared/types';
import { ContextBuilder } from '../context-builder';

function createPageContext(count = 3): PageContext {
  return {
    url: 'https://app.example.com/dashboard',
    title: 'Dashboard',
    summary: 'Main dashboard with widgets',
    frame: {
      frameId: 0,
      parentFrameId: null,
      url: 'https://app.example.com/dashboard',
      origin: 'https://app.example.com',
      isTop: true,
    },
    interactiveElements: Array.from({ length: count }, (_, index) => ({
      index,
      tag: 'button',
      role: 'button',
      text: `Action ${index}`,
      isVisible: true,
      isEnabled: true,
      boundingBox: { x: index * 10, y: index * 20, width: 100, height: 32 },
    })),
    headings: [
      { level: 1, text: 'Dashboard' },
      { level: 2, text: 'Overview' },
    ],
    links: [{ text: 'Settings', href: '/settings' }],
    forms: [
      {
        action: '/search',
        method: 'post',
        fields: [{ name: 'query', type: 'text', required: true }],
      },
    ],
    viewport: {
      width: 1440,
      height: 900,
      scrollX: 0,
      scrollY: 120,
      scrollHeight: 2400,
    },
    screenshot: 'data:image/png;base64,' + 'x'.repeat(900),
  };
}

function createSession(): Session {
  const now = Date.now();

  return {
    config: {
      id: 'session-ctx',
      name: 'Context Session',
      provider: 'claude',
      model: 'claude-sonnet',
    },
    status: 'running',
    targetTabId: 12,
    recording: {
      status: 'idle',
      actions: [],
      startedAt: null,
      updatedAt: null,
    },
    tabSnapshot: [
      {
        tabIndex: 0,
        id: 12,
        url: 'https://app.example.com/dashboard?token=secret#billing',
        title: 'Dashboard - Internal Workspace Alpha',
        status: 'complete',
        isActive: true,
        isTarget: true,
      },
      {
        tabIndex: 1,
        id: 18,
        url: 'https://docs.example.com/guide?draft=phoenix#private-notes',
        title: 'Guide | Confidential Project Phoenix',
        status: 'loading',
        isActive: false,
        isTarget: false,
      },
    ],
    messages: [
      { role: 'user', content: 'Open dashboard', timestamp: now - 3_000 },
      { role: 'assistant', content: 'Dashboard is open', timestamp: now - 2_000 },
    ],
    currentTurn: 2,
    actionHistory: [
      {
        action: { id: 'act-1', type: 'wait', duration: 200 },
        result: { actionId: 'act-1', success: true, duration: 50 },
        timestamp: now - 1_000,
      },
    ],
    variables: {
      selectedWorkspace: 'alpha',
      network: [{ method: 'GET', url: '/api/workspaces' }],
    },
    startedAt: now - 10_000,
    lastActivityAt: now,
    errorCount: 0,
  };
}

describe('ContextBuilder', () => {
  it('builds context with page, session, messages and history sections', () => {
    const builder = new ContextBuilder();
    const context = builder.buildContext(createPageContext(), createSession());

    expect(context).toContain('## Page Context');
    expect(context).toContain('## Session State');
    expect(context).toContain('## Tabs');
    expect(context).toContain('## Recent Messages');
    expect(context).toContain('## Action History');
    expect(context).toContain('## DOM Snapshot');
  });

  it('renders synchronized tab mappings with zero-based tabIndex markers', () => {
    const builder = new ContextBuilder();
    const context = builder.buildContext(createPageContext(), createSession(), {
      includeDOM: false,
    });

    expect(context).toContain('Target Tab: 12 (tabIndex 0)');
    expect(context).toContain('Use these zero-based tabIndex values for switchTab and closeTab.');
    expect(context).toContain('[0] id=12 markers=target, active, complete');
    expect(context).toContain('[1] id=18 markers=loading');
  });

  it('never exposes raw tab titles and only keeps redacted tab locations in the AI tabs block', () => {
    const builder = new ContextBuilder();
    const context = builder.buildContext(createPageContext(), createSession(), {
      includeDOM: false,
    });

    expect(context).toContain('location="app.example.com/dashboard"');
    expect(context).toContain('location="docs.example.com/guide"');
    expect(context).not.toContain('label="');
    expect(context).not.toContain('token=secret');
    expect(context).not.toContain('#billing');
    expect(context).not.toContain('Dashboard - Internal Workspace Alpha');
    expect(context).not.toContain('Guide | Confidential Project Phoenix');
    expect(context).not.toContain('Confidential Project Phoenix');
    expect(context).not.toContain('Internal Workspace Alpha');
  });

  it('respects includeDOM/includeScreenshot/includeNetwork options', () => {
    const builder = new ContextBuilder();
    const context = builder.buildContext(createPageContext(), createSession(), {
      includeDOM: false,
      includeScreenshot: false,
      includeNetwork: false,
    });

    expect(context).not.toContain('## DOM Snapshot');
    expect(context).not.toContain('## Screenshot');
    expect(context).not.toContain('## Network');
  });

  it('limits number of rendered interactive elements by maxElements', () => {
    const builder = new ContextBuilder();
    const context = builder.buildContext(createPageContext(10), createSession(), {
      maxElements: 2,
      includeDOM: true,
    });

    expect(context).toContain('0. <button> text="Action 0"');
    expect(context).toContain('1. <button> text="Action 1"');
    expect(context).not.toContain('2. <button> text="Action 2"');
  });

  it('truncates output when maxContextLength is exceeded', () => {
    const builder = new ContextBuilder();
    const session = createSession();
    session.messages.push({ role: 'user', content: 'y'.repeat(5_000), timestamp: Date.now() });

    const context = builder.buildContext(
      createPageContext(30),
      session,
      {
        includeScreenshot: true,
        includeDOM: true,
        includeNetwork: true,
      },
      { maxContextLength: 600 },
    );

    expect(context.length).toBeGreaterThanOrEqual(600);
    expect(context).toContain('truncated');
  });

  it('sanitizes control characters in rendered strings', () => {
    const builder = new ContextBuilder();
    const page = createPageContext();
    page.title = 'Dashboard\u0000\u0001\nTitle';

    const context = builder.buildContext(page, createSession(), {
      includeDOM: false,
    });

    expect(context).toContain('Title: Dashboard Title');
  });

  it('handles message content as array with image and unknown blocks', () => {
    const builder = new ContextBuilder();
    const session = createSession();
    session.messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Look at this' },
          { type: 'image', image_url: { url: 'data:image/png;base64,abc' } },
          { type: 'image' },
          { type: 'video' } as never,
        ],
        timestamp: Date.now(),
      },
    ];

    const context = builder.buildContext(createPageContext(), session, { includeDOM: false });

    expect(context).toContain('Look at this');
    expect(context).toContain('[image:attached]');
    expect(context).toContain('[image:missing-url]');
    expect(context).toContain('[unknown-content]');
  });

  it('renders network section when includeNetwork is enabled', () => {
    const builder = new ContextBuilder();
    const context = builder.buildContext(createPageContext(), createSession(), {
      includeDOM: false,
      includeNetwork: true,
    });

    expect(context).toContain('## Network');
    expect(context).toContain('/api/workspaces');
  });

  it('renders network not-available when network data is undefined', () => {
    const builder = new ContextBuilder();
    const session = createSession();
    session.variables = {};

    const context = builder.buildContext(createPageContext(), session, {
      includeDOM: false,
      includeNetwork: true,
    });

    expect(context).toContain('## Network');
    expect(context).toContain('not available');
  });

  it('handles circular reference in variables via safeStringify', () => {
    const builder = new ContextBuilder();
    const session = createSession();
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    session.variables = circular;

    const context = builder.buildContext(createPageContext(), session, { includeDOM: false });

    expect(context).toContain('## Variables');
    expect(context).toContain('[Circular]');
  });

  it('shows childFrames count as 0 when undefined', () => {
    const builder = new ContextBuilder();
    const page = createPageContext();
    delete (page as Partial<PageContext>).childFrames;

    const context = builder.buildContext(page, createSession(), { includeDOM: false });

    expect(context).toContain('Child Frames: 0');
  });

  it('renders screenshot section when includeScreenshot and screenshot present', () => {
    const builder = new ContextBuilder();
    const context = builder.buildContext(createPageContext(), createSession(), {
      includeDOM: false,
      includeScreenshot: true,
    });

    expect(context).toContain('## Screenshot');
  });

  it('omits screenshot section when pageContext has no screenshot', () => {
    const builder = new ContextBuilder();
    const page = createPageContext();
    page.screenshot = undefined;

    const context = builder.buildContext(page, createSession(), {
      includeDOM: false,
      includeScreenshot: true,
    });

    expect(context).not.toContain('## Screenshot');
  });

  it('renders empty tabs section when tabSnapshot is empty', () => {
    const builder = new ContextBuilder();
    const session = createSession();
    session.tabSnapshot = [];
    session.targetTabId = undefined;

    const context = builder.buildContext(createPageContext(), session, { includeDOM: false });

    expect(context).toContain('## Tabs');
    expect(context).toContain('(none)');
    expect(context).toContain('Target Tab: none');
  });

  it('renders empty messages section when no messages', () => {
    const builder = new ContextBuilder();
    const session = createSession();
    session.messages = [];

    const context = builder.buildContext(createPageContext(), session, { includeDOM: false });

    expect(context).toContain('## Recent Messages');
    expect(context).toContain('(none)');
  });

  it('renders empty action history section when no actions', () => {
    const builder = new ContextBuilder();
    const session = createSession();
    session.actionHistory = [];

    const context = builder.buildContext(createPageContext(), session, { includeDOM: false });

    expect(context).toContain('## Action History');
    expect(context).toContain('(none)');
  });

  it('renders empty variables section when no variables', () => {
    const builder = new ContextBuilder();
    const session = createSession();
    session.variables = {};

    const context = builder.buildContext(createPageContext(), session, { includeDOM: false });

    expect(context).toContain('## Variables');
    expect(context).toContain('(none)');
  });

  it('normalizes invalid maxElements to default', () => {
    const builder = new ContextBuilder();
    const context = builder.buildContext(createPageContext(5), createSession(), {
      maxElements: -1,
      includeDOM: true,
    });

    expect(context).toContain('## DOM Snapshot');
    expect(context).toContain('0. <button>');
  });

  it('renders DOM section with no interactive elements', () => {
    const builder = new ContextBuilder();
    const page = createPageContext(0);
    page.headings = [];
    page.links = [];
    page.forms = [];

    const context = builder.buildContext(page, createSession(), { includeDOM: true });

    expect(context).toContain('Interactive Elements: (none)');
  });

  it('renders child frames in DOM section', () => {
    const builder = new ContextBuilder();
    const page = createPageContext(0);
    page.childFrames = [
      {
        frame: {
          frameId: 1,
          parentFrameId: 0,
          url: 'https://embed.test/widget',
          origin: 'https://embed.test',
          isTop: false,
        },
        title: 'Widget Frame',
        interactiveElementCount: 3,
      },
    ];

    const context = builder.buildContext(page, createSession(), { includeDOM: true });

    expect(context).toContain('Child Frames:');
    expect(context).toContain('embed.test/widget');
  });

  it('renders action history with error messages', () => {
    const builder = new ContextBuilder();
    const session = createSession();
    const now = Date.now();
    session.actionHistory = [
      {
        action: { id: 'fail-1', type: 'click' },
        result: {
          actionId: 'fail-1',
          success: false,
          duration: 100,
          error: { message: 'Element not found' },
        },
        timestamp: now,
      },
    ];

    const context = builder.buildContext(createPageContext(), session, { includeDOM: false });

    expect(context).toContain('failed');
    expect(context).toContain('Element not found');
  });

  it('handles page in iframe (non-top frame)', () => {
    const builder = new ContextBuilder();
    const page = createPageContext();
    page.frame = {
      frameId: 5,
      parentFrameId: 0,
      url: 'https://iframe.test',
      origin: 'https://iframe.test',
      isTop: false,
    };

    const context = builder.buildContext(page, createSession(), { includeDOM: false });

    expect(context).toContain('iframe 5');
  });

  it('handles summary as null/undefined', () => {
    const builder = new ContextBuilder();
    const page = createPageContext();
    page.summary = undefined;

    const context = builder.buildContext(page, createSession(), { includeDOM: false });

    expect(context).toContain('Summary: (none)');
  });

  it('handles message without timestamp', () => {
    const builder = new ContextBuilder();
    const session = createSession();
    session.messages = [
      { role: 'user', content: 'Test', timestamp: undefined as unknown as number },
    ];

    const context = builder.buildContext(createPageContext(), session, { includeDOM: false });

    expect(context).toContain('[user]');
  });

  it('renders session name as (unnamed) when null', () => {
    const builder = new ContextBuilder();
    const session = createSession();
    session.config.name = undefined;

    const context = builder.buildContext(createPageContext(), session, { includeDOM: false });

    expect(context).toContain('Name: (unnamed)');
  });

  it('summarizeTabLocation handles empty URL', () => {
    const builder = new ContextBuilder();
    const session = createSession();
    session.tabSnapshot = [
      {
        tabIndex: 0,
        id: 1,
        url: '',
        title: '',
        status: 'complete',
        isActive: true,
        isTarget: true,
      },
    ];

    const context = builder.buildContext(createPageContext(), session, { includeDOM: false });

    expect(context).toContain('(unknown)');
  });

  it('summarizeTabLocation handles unparseable URL', () => {
    const builder = new ContextBuilder();
    const session = createSession();
    session.tabSnapshot = [
      {
        tabIndex: 0,
        id: 1,
        url: ':::invalid',
        title: '',
        status: 'complete',
        isActive: false,
        isTarget: false,
      },
    ];

    const context = builder.buildContext(createPageContext(), session, { includeDOM: false });

    expect(context).toContain('location=":::invalid"');
  });

  it('renders DOM interactive elements with type, placeholder, and ariaLabel', () => {
    const builder = new ContextBuilder();
    const page = createPageContext(0);
    page.interactiveElements = [
      {
        index: 0,
        tag: 'input',
        type: 'email',
        text: '',
        placeholder: 'Enter email',
        ariaLabel: 'Email input',
        role: 'textbox',
        isVisible: true,
        isEnabled: true,
        boundingBox: { x: 0, y: 0, width: 100, height: 32 },
      },
    ];

    const context = builder.buildContext(page, createSession(), { includeDOM: true });

    expect(context).toContain('type=email');
    expect(context).toContain('placeholder="Enter email"');
    expect(context).toContain('aria="Email input"');
    expect(context).toContain('role=textbox');
  });

  it('renders omitted count when interactive elements exceed maxElements', () => {
    const builder = new ContextBuilder();
    const page = createPageContext(50);

    const context = builder.buildContext(page, createSession(), {
      includeDOM: true,
      maxElements: 3,
    });

    expect(context).toContain('47 more interactive element(s) omitted');
  });

  it('text block with missing text defaults to empty', () => {
    const builder = new ContextBuilder();
    const session = createSession();
    session.messages = [
      {
        role: 'user',
        content: [{ type: 'text' }] as never,
        timestamp: Date.now(),
      },
    ];

    const context = builder.buildContext(createPageContext(), session, { includeDOM: false });

    expect(context).toContain('[user]');
  });
});
