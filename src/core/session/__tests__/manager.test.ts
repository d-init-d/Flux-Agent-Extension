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

  it('throws when creating a session with duplicate id', async () => {
    const manager = new SessionManager();
    await manager.createSession(createSessionConfig('dup'), 1);
    await expect(manager.createSession(createSessionConfig('dup'), 2)).rejects.toMatchObject({
      code: ErrorCode.SESSION_LIMIT_REACHED,
    });
  });

  it('start without initialPrompt does not send message', async () => {
    const manager = new SessionManager();
    await manager.createSession(createSessionConfig('no-prompt'), 1);
    await manager.start('no-prompt');
    const session = manager.getSession('no-prompt');
    expect(session?.status).toBe('running');
    expect(session?.messages).toHaveLength(0);
  });

  it('start with empty initialPrompt does not send message', async () => {
    const manager = new SessionManager();
    await manager.createSession(createSessionConfig('empty-prompt'), 1);
    await manager.start('empty-prompt', '   ');
    expect(manager.getSession('empty-prompt')?.messages).toHaveLength(0);
  });

  it('sendMessage rejects empty/whitespace message', async () => {
    const manager = new SessionManager();
    await manager.createSession(createSessionConfig('msg-test'), 1);
    await expect(manager.sendMessage('msg-test', '   ')).rejects.toMatchObject({
      code: ErrorCode.ACTION_INVALID,
    });
  });

  it('undo rejects invalid steps', async () => {
    const manager = new SessionManager();
    await manager.createSession(createSessionConfig('undo-test'), 1);
    manager.pushActionRecord('undo-test', createActionRecord('a-1'));
    await expect(manager.undo('undo-test', 0)).rejects.toThrow(/positive integer/);
    await expect(manager.undo('undo-test', -1)).rejects.toThrow(/positive integer/);
    await expect(manager.undo('undo-test', 1.5)).rejects.toThrow(/positive integer/);
  });

  it('undo on empty history is a no-op', async () => {
    const manager = new SessionManager();
    await manager.createSession(createSessionConfig('undo-empty'), 1);
    await manager.undo('undo-empty', 1);
    expect(manager.getHistory('undo-empty')).toEqual([]);
  });

  it('subscribe unsubscribe works and handles edge cases', async () => {
    const manager = new SessionManager();
    await manager.createSession(createSessionConfig('sub-test'), 1);

    const handler = vi.fn();
    const unsubscribe = manager.subscribe('sub-test', handler);

    manager.pause('sub-test');
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();
    manager.resume('sub-test');
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('buildContext uses fallback page context when none set', async () => {
    const manager = new SessionManager();
    await manager.createSession(createSessionConfig('ctx-fallback'), 1);
    const context = await manager.buildContext('ctx-fallback');
    expect(context).toContain('about:blank');
  });

  it('buildContext uses variables.pageContext when no stored context', async () => {
    const manager = new SessionManager();
    const session = await manager.createSession(createSessionConfig('ctx-var'), 1);
    session.variables.pageContext = createPageContext({ url: 'https://var-context.com' });
    const context = await manager.buildContext('ctx-var');
    expect(context).toContain('https://var-context.com');
  });

  it('buildContext ignores invalid variables.pageContext', async () => {
    const manager = new SessionManager();
    const session = await manager.createSession(createSessionConfig('ctx-invalid'), 1);
    session.variables.pageContext = { invalid: true };
    const context = await manager.buildContext('ctx-invalid');
    expect(context).toContain('about:blank');
  });

  it('buildContext ignores null variables.pageContext', async () => {
    const manager = new SessionManager();
    const session = await manager.createSession(createSessionConfig('ctx-null'), 1);
    session.variables.pageContext = null;
    const context = await manager.buildContext('ctx-null');
    expect(context).toContain('about:blank');
  });

  it('replaceRecordedActions replaces all actions', async () => {
    const manager = new SessionManager();
    await manager.createSession(createSessionConfig('replace'), 1);
    manager.startRecording('replace');
    manager.appendRecordedAction('replace', {
      action: { id: 'old', type: 'click', selector: { css: '#old' } },
      timestamp: 100,
    });

    manager.replaceRecordedActions('replace', [
      { action: { id: 'new1', type: 'click', selector: { css: '#new1' } }, timestamp: 200 },
      { action: { id: 'new2', type: 'fill', selector: { css: '#new2' }, value: 'x' }, timestamp: 300 },
    ]);

    const session = manager.getSession('replace');
    expect(session?.recording.actions).toHaveLength(2);
    expect(session?.recording.actions[0].action.id).toBe('new1');
    expect(session?.recording.status).toBe('idle');
    expect(session?.recording.startedAt).toBe(200);
  });

  it('replaceRecordedActions with empty array', async () => {
    const manager = new SessionManager();
    await manager.createSession(createSessionConfig('replace-empty'), 1);

    manager.replaceRecordedActions('replace-empty', []);

    const session = manager.getSession('replace-empty');
    expect(session?.recording.actions).toHaveLength(0);
    expect(session?.recording.startedAt).toBeNull();
  });

  it('setPlaybackError without timestamp uses Date.now', async () => {
    const manager = new SessionManager();
    await manager.createSession(createSessionConfig('err-test'), 1);
    manager.startPlayback('err-test');

    manager.setPlaybackError('err-test', { message: 'Failed' });
    const session = manager.getSession('err-test');
    expect(session?.playback.lastError?.message).toBe('Failed');
    expect(session?.playback.lastError?.timestamp).toBeGreaterThan(0);
  });

  it('clearPlaybackError clears the error', async () => {
    const manager = new SessionManager();
    await manager.createSession(createSessionConfig('clear-err'), 1);
    manager.startPlayback('clear-err');
    manager.setPlaybackError('clear-err', { message: 'Error' });
    manager.clearPlaybackError('clear-err');
    expect(manager.getSession('clear-err')?.playback.lastError).toBeNull();
  });

  it('resumePlayback without speed keeps existing speed', async () => {
    const manager = new SessionManager();
    await manager.createSession(createSessionConfig('resume-speed'), 1);
    manager.startPlayback('resume-speed', 2);
    manager.pausePlayback('resume-speed');
    manager.resumePlayback('resume-speed');
    expect(manager.getSession('resume-speed')?.playback.speed).toBe(2);
  });

  it('setPlaybackSpeed updates speed', async () => {
    const manager = new SessionManager();
    await manager.createSession(createSessionConfig('set-speed'), 1);
    manager.startPlayback('set-speed');
    manager.setPlaybackSpeed('set-speed', 0.5);
    expect(manager.getSession('set-speed')?.playback.speed).toBe(0.5);
  });

  it('setPlaybackNextActionIndex updates index', async () => {
    const manager = new SessionManager();
    await manager.createSession(createSessionConfig('set-index'), 1);
    manager.startPlayback('set-index');
    manager.setPlaybackNextActionIndex('set-index', 5);
    expect(manager.getSession('set-index')?.playback.nextActionIndex).toBe(5);
  });

  it('getSession returns null for unknown session', () => {
    const manager = new SessionManager();
    expect(manager.getSession('nonexistent')).toBeNull();
  });

  it('getActiveSessions excludes completed sessions', async () => {
    const manager = new SessionManager();
    const session = await manager.createSession(createSessionConfig('completed'), 1);
    session.status = 'completed';
    expect(manager.getActiveSessions()).toHaveLength(0);
  });

  it('addAIResponse emits ai_response event', async () => {
    const manager = new SessionManager();
    await manager.createSession(createSessionConfig('ai-resp'), 1);

    const events: string[] = [];
    manager.subscribe('ai-resp', (event) => events.push(event.type));
    manager.addAIResponse('ai-resp', 'AI says hello');

    expect(events).toEqual(['ai_response']);
    const session = manager.getSession('ai-resp');
    expect(session?.messages.at(-1)).toMatchObject({ role: 'assistant', content: 'AI says hello' });
  });

  it('pushActionRecord emits action_executed event', async () => {
    const manager = new SessionManager();
    await manager.createSession(createSessionConfig('push-action'), 1);

    const events: string[] = [];
    manager.subscribe('push-action', (event) => events.push(event.type));
    manager.pushActionRecord('push-action', createActionRecord('a-1'));

    expect(events).toEqual(['action_executed']);
  });
});
