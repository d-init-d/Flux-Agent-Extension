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
});
