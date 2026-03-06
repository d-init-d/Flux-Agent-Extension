import type { PageContext, Session } from '@shared/types';
import { ContextBuilder } from '../context-builder';

function createPageContext(count = 3): PageContext {
  return {
    url: 'https://app.example.com/dashboard',
    title: 'Dashboard',
    summary: 'Main dashboard with widgets',
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
    expect(context).toContain('## Recent Messages');
    expect(context).toContain('## Action History');
    expect(context).toContain('## DOM Snapshot');
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
