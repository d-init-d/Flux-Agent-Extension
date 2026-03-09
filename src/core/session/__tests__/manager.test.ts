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
    frame: {
      frameId: 0,
      parentFrameId: null,
      url: 'https://example.com',
      origin: 'https://example.com',
      isTop: true,
    },
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

  it('pauses and resumes recording without clearing prior actions or startedAt', async () => {
    const manager = new SessionManager();
    await manager.createSession(createSessionConfig('s3-recording'), 103);

    manager.startRecording('s3-recording');
    const startedAt = manager.getSession('s3-recording')?.recording.startedAt;

    manager.appendRecordedAction('s3-recording', {
      action: {
        id: 'recorded-click-1',
        type: 'click',
        selector: { testId: 'submit' },
      },
      timestamp: 100,
    });
    manager.pauseRecording('s3-recording');
    manager.resumeRecording('s3-recording');
    manager.appendRecordedAction('s3-recording', {
      action: {
        id: 'recorded-fill-1',
        type: 'fill',
        selector: { testId: 'email' },
        value: 'alice@example.com',
      },
      timestamp: 200,
    });

    const session = manager.getSession('s3-recording');
    expect(session?.recording.status).toBe('recording');
    expect(session?.recording.startedAt).toBe(startedAt);
    expect(session?.recording.actions.map((entry) => entry.action.id)).toEqual([
      'recorded-click-1',
      'recorded-fill-1',
    ]);
  });

  it('resets recorded actions on a fresh recording start', async () => {
    const manager = new SessionManager();
    await manager.createSession(createSessionConfig('s3-reset-recording'), 103);

    manager.startRecording('s3-reset-recording');
    manager.appendRecordedAction('s3-reset-recording', {
      action: {
        id: 'recorded-click-1',
        type: 'click',
        selector: { testId: 'submit' },
      },
      timestamp: 100,
    });
    manager.stopRecording('s3-reset-recording');
    manager.startRecording('s3-reset-recording');

    const session = manager.getSession('s3-reset-recording');
    expect(session?.recording.status).toBe('recording');
    expect(session?.recording.actions).toEqual([]);
  });

  it('tracks playback lifecycle, speed, progress, and reset state separately from recording', async () => {
    const manager = new SessionManager();
    await manager.createSession(createSessionConfig('s3-playback'), 103);

    manager.startRecording('s3-playback');
    manager.appendRecordedAction('s3-playback', {
      action: {
        id: 'recorded-click-1',
        type: 'click',
        selector: { testId: 'submit' },
      },
      timestamp: 100,
    });
    manager.stopRecording('s3-playback');

    manager.startPlayback('s3-playback', 2);
    manager.markPlaybackActionCompleted('s3-playback', 1, 150);
    manager.pausePlayback('s3-playback');
    manager.resumePlayback('s3-playback', 0.5);
    manager.setPlaybackError('s3-playback', {
      message: 'Playback paused after an execution failure',
      actionId: 'recorded-click-1',
      actionType: 'click',
      timestamp: 175,
    });
    manager.completePlayback('s3-playback');

    let session = manager.getSession('s3-playback');
    expect(session?.recording.status).toBe('idle');
    expect(session?.playback.status).toBe('idle');
    expect(session?.playback.nextActionIndex).toBe(1);
    expect(session?.playback.speed).toBe(0.5);
    expect(session?.playback.lastCompletedAt).not.toBeNull();
    expect(session?.playback.lastError).toBeNull();

    manager.stopPlayback('s3-playback');
    session = manager.getSession('s3-playback');
    expect(session?.playback).toEqual(
      expect.objectContaining({
        status: 'idle',
        nextActionIndex: 0,
        startedAt: null,
        lastCompletedAt: null,
        lastError: null,
      }),
    );
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
