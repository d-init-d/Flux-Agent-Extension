import type { ActionRecord, PageContext, SessionConfig } from '@shared/types';
import { ErrorCode, ExtensionError } from '@shared/errors';
import { SessionManager } from '../manager';

function createSessionConfig(id = 'session-1'): SessionConfig {
  return {
    id,
    name: 'Test Session',
    provider: 'openai',
    model: 'gpt-5-mini',
  };
}

function createPageContext(overrides: Partial<PageContext> = {}): PageContext {
  return {
    url: 'https://example.com',
    title: 'Example',
    summary: 'Sample page',
    interactiveElements: [
      {
        index: 0,
        tag: 'button',
        role: 'button',
        text: 'Submit',
        isVisible: true,
        isEnabled: true,
        boundingBox: { x: 0, y: 0, width: 100, height: 32 },
      },
    ],
    headings: [{ level: 1, text: 'Hello' }],
    links: [{ text: 'Home', href: '/' }],
    forms: [],
    viewport: {
      width: 1200,
      height: 800,
      scrollX: 0,
      scrollY: 0,
      scrollHeight: 1800,
    },
    ...overrides,
  };
}

function createActionRecord(id = 'action-1'): ActionRecord {
  return {
    action: {
      id,
      type: 'wait',
      duration: 250,
    },
    result: {
      actionId: id,
      success: true,
      duration: 42,
    },
    timestamp: Date.now(),
  };
}

describe('SessionManager', () => {
  it('creates session and returns it from getSession/getActiveSessions', async () => {
    const manager = new SessionManager();
    const created = await manager.createSession(createSessionConfig('s1'), 101);

    expect(created.config.id).toBe('s1');
    expect(manager.getSession('s1')).toBe(created);
    expect(manager.getActiveSessions().map((session) => session.config.id)).toContain('s1');
  });

  it('handles start -> pause -> resume lifecycle and emits session events', async () => {
    const manager = new SessionManager();
    await manager.createSession(createSessionConfig('s2'), 102);

    const events: string[] = [];
    manager.subscribe('s2', (event) => {
      events.push(event.type);
    });

    await manager.start('s2', 'Open the account page');
    manager.pause('s2');
    manager.resume('s2');

    const session = manager.getSession('s2');
    expect(session?.status).toBe('running');
    expect(session?.messages.at(-1)).toMatchObject({ role: 'user', content: 'Open the account page' });
    expect(events).toEqual(['started', 'paused', 'resumed']);
  });

  it('supports sendMessage, action history, undo and getHistory', async () => {
    const manager = new SessionManager();
    await manager.createSession(createSessionConfig('s3'), 103);

    await manager.sendMessage('s3', 'first');
    manager.pushActionRecord('s3', createActionRecord('a-1'));
    manager.pushActionRecord('s3', createActionRecord('a-2'));

    expect(manager.getHistory('s3').map((record) => record.action.id)).toEqual(['a-1', 'a-2']);

    await manager.undo('s3', 1);

    expect(manager.getHistory('s3').map((record) => record.action.id)).toEqual(['a-1']);
  });

  it('builds context with provided page context and includes expected sections', async () => {
    const manager = new SessionManager();
    await manager.createSession(createSessionConfig('s4'), 104);
    manager.setPageContext('s4', createPageContext());
    manager.pushActionRecord('s4', createActionRecord('a-1'));
    await manager.sendMessage('s4', 'Check this page');
    manager.addAIResponse('s4', 'I can click submit');

    const context = await manager.buildContext('s4');

    expect(context).toContain('## Page Context');
    expect(context).toContain('## Session State');
    expect(context).toContain('## Recent Messages');
    expect(context).toContain('## Action History');
    expect(context).toContain('https://example.com');
  });

  it('aborts session and unsubscribes handlers', async () => {
    const manager = new SessionManager();
    await manager.createSession(createSessionConfig('s5'), 105);

    const events: string[] = [];
    manager.subscribe('s5', (event) => {
      events.push(event.type);
    });

    manager.abort('s5');

    expect(events).toEqual(['aborted']);
    expect(manager.getSession('s5')).toBeNull();
  });

  it('throws SESSION_NOT_FOUND for unknown session operations', async () => {
    const manager = new SessionManager();

    await expect(manager.start('missing')).rejects.toMatchObject({
      code: ErrorCode.SESSION_NOT_FOUND,
    } satisfies Partial<ExtensionError>);
    await expect(manager.sendMessage('missing', 'hello')).rejects.toThrowError(ExtensionError);
  });
});
