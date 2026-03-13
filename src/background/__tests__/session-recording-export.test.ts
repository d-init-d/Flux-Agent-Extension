import { describe, expect, it } from 'vitest';
import { buildSessionRecordingExportArtifact } from '../session-recording-export';
import type { Session } from '@shared/types';

function createSessionWithRecordedAction(action: Session['recording']['actions'][number]['action']): Session {
  const timestamp = Date.UTC(2026, 2, 13, 6, 30);

  return {
    config: {
      id: 'session-export-risk',
      name: 'Risk Audit',
      provider: 'openai',
      model: 'gpt-4o-mini',
    },
    status: 'idle',
    targetTabId: 1,
    tabSnapshot: [],
    recording: {
      status: 'idle',
      actions: [
        {
          action,
          timestamp,
        },
      ],
      startedAt: timestamp,
      updatedAt: timestamp,
    },
    playback: {
      status: 'idle',
      nextActionIndex: 0,
      speed: 1,
      startedAt: null,
      updatedAt: null,
      lastCompletedAt: null,
      lastError: null,
    },
    messages: [],
    currentTurn: 0,
    actionHistory: [],
    variables: {},
    startedAt: timestamp,
    lastActivityAt: timestamp,
    errorCount: 0,
  };
}

describe('session recording export risk metadata', () => {
  it('marks evaluate actions as high risk in json exports', () => {
    const session = createSessionWithRecordedAction({
      id: 'eval-1',
      type: 'evaluate',
      script: 'return args[0] + 1;',
      args: [1],
    });

    const artifact = buildSessionRecordingExportArtifact(session, 'json', new Date('2026-03-13T06:30:00.000Z'));
    const payload = JSON.parse(artifact.content);

    expect(payload.actions[0]).toEqual(
      expect.objectContaining({
        riskLevel: 'high',
        riskReason: expect.stringContaining('Runs arbitrary page script'),
      }),
    );
  });

  it('emits explicit evaluate warnings in playwright and puppeteer exports', () => {
    const session = createSessionWithRecordedAction({
      id: 'eval-2',
      type: 'evaluate',
      script: 'return document.title;',
      args: [],
    });

    const playwright = buildSessionRecordingExportArtifact(session, 'playwright', new Date('2026-03-13T06:31:00.000Z'));
    expect(playwright.content).toContain('High-risk evaluate action in recording export');
    expect(playwright.content).toContain('await page.evaluate(');

    const puppeteer = buildSessionRecordingExportArtifact(session, 'puppeteer', new Date('2026-03-13T06:31:00.000Z'));
    expect(puppeteer.content).toContain('High-risk evaluate action in recording export');
    expect(puppeteer.content).toContain('await page.evaluate(');
  });
});
