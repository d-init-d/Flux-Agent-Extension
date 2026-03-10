import { act, render, screen, waitFor, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../ui/theme';
import { App } from '../App';
import { resetActionLogStore } from '../store/actionLogStore';
import { resetChatStore } from '../store/chatStore';
import { resetSessionStore } from '../store/sessionStore';

import type { ExtensionMessage, Session } from '@shared/types';

const listeners = new Set<(message: unknown) => void>();

const sendExtensionRequest = vi.fn();

vi.mock('../lib/extension-client', () => ({
  sendExtensionRequest: (...args: unknown[]) => sendExtensionRequest(...args),
  subscribeToExtensionEvents: (handler: (message: unknown) => void) => {
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  },
}));

function createSession(id: string, overrides: Partial<Session> = {}): Session {
  return {
    config: {
      id,
      provider: 'openai',
      model: 'gpt-4o-mini',
      ...overrides.config,
    },
    status: 'idle',
    targetTabId: 1,
    tabSnapshot: [],
    recording: {
      status: 'idle',
      actions: [],
      startedAt: null,
      updatedAt: null,
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
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
    errorCount: 0,
    ...overrides,
  };
}

function emitExtensionEvent(message: ExtensionMessage): void {
  for (const listener of listeners) {
    listener(message);
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

async function settleReactUpdates(iterations = 1): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function renderApp() {
  await act(async () => {
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );
  });

  await settleReactUpdates(2);
}

describe('Side panel App (U-15 integration)', () => {
  beforeEach(() => {
    sendExtensionRequest.mockReset();
    listeners.clear();

    sendExtensionRequest.mockImplementation(async (type: string) => {
      switch (type) {
        case 'SESSION_LIST':
          return { sessions: [createSession('session-1')] };
        case 'SESSION_CREATE':
          return { session: createSession('session-2') };
        case 'SESSION_SEND_MESSAGE':
          return undefined;
        default:
          return undefined;
      }
    });
  });

  afterEach(() => {
    resetSessionStore();
    resetChatStore();
    resetActionLogStore();
  });

  it('renders the connected layout and bootstraps a session selector', async () => {
    await renderApp();

    const header = screen.getByTestId('sidepanel-header');
    expect(within(header).getByRole('heading', { level: 1, name: 'Flux Agent' })).toBeInTheDocument();
    expect(within(header).getByRole('radiogroup', { name: 'Theme mode' })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Active session' })).toHaveValue('session-1');
    });

    expect(screen.getByRole('button', { name: 'Start recording' })).toBeInTheDocument();
    expect(screen.getByText('Playback recorded actions')).toBeInTheDocument();
    expect(screen.getByText('Playback is unavailable until this session has recorded actions.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'New session' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByText('Create or switch a session, then send a prompt to start a streamed response.')).toBeInTheDocument();
  });

  it('uses the latest selected speed for playback start before session updates arrive', async () => {
    const user = userEvent.setup();

    sendExtensionRequest.mockImplementation(async (type: string) => {
      switch (type) {
        case 'SESSION_LIST':
          return {
            sessions: [
              createSession('session-1', {
                recording: {
                  status: 'idle',
                  actions: [
                    {
                      action: { id: 'recorded-click', type: 'click', selector: { css: '#open-menu' } },
                      timestamp: Date.now() - 3000,
                    },
                    {
                      action: { id: 'recorded-type', type: 'type', selector: { css: '#query' }, text: 'Flux' },
                      timestamp: Date.now() - 2000,
                    },
                    {
                      action: { id: 'recorded-submit', type: 'click', selector: { css: '#submit' } },
                      timestamp: Date.now() - 1000,
                    },
                  ],
                  startedAt: Date.now() - 5000,
                  updatedAt: Date.now() - 1000,
                },
              }),
            ],
          };
        case 'SESSION_CREATE':
          return { session: createSession('session-2') };
        case 'SESSION_SEND_MESSAGE':
          return undefined;
        default:
          return undefined;
      }
    });

    await renderApp();

    expect(await screen.findByText('Ready to replay 3 actions from the start.')).toBeInTheDocument();
    expect(screen.getByText('0 / 3 actions')).toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Playback speed' }), '2');

    await waitFor(() => {
      expect(sendExtensionRequest).toHaveBeenCalledWith('SESSION_PLAYBACK_SET_SPEED', {
        sessionId: 'session-1',
        speed: 2,
      });
    });

    await user.click(screen.getByRole('button', { name: 'Play' }));

    await waitFor(() => {
      expect(sendExtensionRequest).toHaveBeenCalledWith('SESSION_PLAYBACK_START', {
        sessionId: 'session-1',
        speed: 2,
      });
    });
  });

  it('starts recording from an idle session', async () => {
    const user = userEvent.setup();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Active session' })).toHaveValue('session-1');
    });

    await user.click(screen.getByRole('button', { name: 'Start recording' }));

    await waitFor(() => {
      expect(sendExtensionRequest).toHaveBeenCalledWith('SESSION_RECORDING_START', {
        sessionId: 'session-1',
      });
    });
  });

  it('shows live recording controls for an active recording session', async () => {
    sendExtensionRequest.mockImplementation(async (type: string) => {
      switch (type) {
        case 'SESSION_LIST':
          return {
            sessions: [
              createSession('session-1', {
                recording: {
                  status: 'recording',
                  actions: [
                    {
                      action: { id: 'recorded-click', type: 'click', selector: { css: '#start-button' } },
                      timestamp: Date.now(),
                    },
                  ],
                  startedAt: Date.now() - 5000,
                  updatedAt: Date.now(),
                },
              }),
            ],
          };
        case 'SESSION_CREATE':
          return { session: createSession('session-2') };
        case 'SESSION_SEND_MESSAGE':
          return undefined;
        default:
          return undefined;
      }
    });

    await renderApp();

    expect(await screen.findByTestId('recording-live-indicator')).toHaveTextContent('Live');
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(screen.getByText('1 action captured so far. New browser steps will keep syncing into this session.')).toBeInTheDocument();
  });

  it('shows paused recording controls without the live indicator', async () => {
    sendExtensionRequest.mockImplementation(async (type: string) => {
      switch (type) {
        case 'SESSION_LIST':
          return {
            sessions: [
              createSession('session-1', {
                recording: {
                  status: 'paused',
                  actions: [
                    {
                      action: { id: 'recorded-click', type: 'click', selector: { css: '#pause-button' } },
                      timestamp: Date.now(),
                    },
                    {
                      action: { id: 'recorded-type', type: 'type', selector: { css: '#input' }, text: 'hello' },
                      timestamp: Date.now(),
                    },
                  ],
                  startedAt: Date.now() - 10000,
                  updatedAt: Date.now(),
                },
              }),
            ],
          };
        case 'SESSION_CREATE':
          return { session: createSession('session-2') };
        case 'SESSION_SEND_MESSAGE':
          return undefined;
        default:
          return undefined;
      }
    });

    await renderApp();

    expect(screen.queryByTestId('recording-live-indicator')).not.toBeInTheDocument();
    expect(await screen.findByText('Paused')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(screen.getByText('2 actions captured. Resume when you want to keep collecting steps.')).toBeInTheDocument();
  });

  it('shows active playback controls for a playing session', async () => {
    const user = userEvent.setup();

    sendExtensionRequest.mockImplementation(async (type: string) => {
      switch (type) {
        case 'SESSION_LIST':
          return {
            sessions: [
              createSession('session-1', {
                recording: {
                  status: 'idle',
                  actions: [
                    {
                      action: { id: 'recorded-click', type: 'click', selector: { css: '#start' } },
                      timestamp: Date.now() - 4000,
                    },
                    {
                      action: { id: 'recorded-type', type: 'type', selector: { css: '#field' }, text: 'ok' },
                      timestamp: Date.now() - 3000,
                    },
                    {
                      action: { id: 'recorded-submit', type: 'click', selector: { css: '#submit' } },
                      timestamp: Date.now() - 2000,
                    },
                  ],
                  startedAt: Date.now() - 5000,
                  updatedAt: Date.now() - 2000,
                },
                playback: {
                  status: 'playing',
                  nextActionIndex: 1,
                  speed: 2,
                  startedAt: Date.now() - 1500,
                  updatedAt: Date.now() - 250,
                  lastCompletedAt: null,
                  lastError: null,
                },
              }),
            ],
          };
        case 'SESSION_CREATE':
          return { session: createSession('session-2') };
        case 'SESSION_SEND_MESSAGE':
          return undefined;
        default:
          return undefined;
      }
    });

    await renderApp();

    expect(await screen.findByText('Playing')).toBeInTheDocument();
    expect(screen.getByText('1 / 3 actions')).toBeInTheDocument();
    expect(screen.getByText('Playing step 2 of 3 at 2x.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Pause' }));

    await waitFor(() => {
      expect(sendExtensionRequest).toHaveBeenCalledWith('SESSION_PLAYBACK_PAUSE', {
        sessionId: 'session-1',
      });
    });
  });

  it('uses the latest selected speed for playback resume and shows paused errors', async () => {
    const user = userEvent.setup();

    sendExtensionRequest.mockImplementation(async (type: string) => {
      switch (type) {
        case 'SESSION_LIST':
          return {
            sessions: [
              createSession('session-1', {
                recording: {
                  status: 'idle',
                  actions: [
                    {
                      action: { id: 'recorded-click', type: 'click', selector: { css: '#first' } },
                      timestamp: Date.now() - 4000,
                    },
                    {
                      action: { id: 'recorded-submit', type: 'click', selector: { css: '#second' } },
                      timestamp: Date.now() - 2000,
                    },
                  ],
                  startedAt: Date.now() - 5000,
                  updatedAt: Date.now() - 2000,
                },
                playback: {
                  status: 'paused',
                  nextActionIndex: 1,
                  speed: 0.5,
                  startedAt: Date.now() - 2000,
                  updatedAt: Date.now() - 500,
                  lastCompletedAt: null,
                  lastError: {
                    message: 'Element #second was not found in the current page state.',
                    actionId: 'recorded-submit',
                    actionType: 'click',
                    timestamp: Date.now() - 500,
                  },
                },
              }),
            ],
          };
        case 'SESSION_CREATE':
          return { session: createSession('session-2') };
        case 'SESSION_SEND_MESSAGE':
          return undefined;
        default:
          return undefined;
      }
    });

    await renderApp();

    expect(await screen.findByText('Paused on step 2 of 2 at 0.5x.')).toBeInTheDocument();
    expect(screen.getByText('Playback issue: Element #second was not found in the current page state.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Playback speed' }), '2');

    await waitFor(() => {
      expect(sendExtensionRequest).toHaveBeenCalledWith('SESSION_PLAYBACK_SET_SPEED', {
        sessionId: 'session-1',
        speed: 2,
      });
    });

    await user.click(screen.getByRole('button', { name: 'Resume' }));

    await waitFor(() => {
      expect(sendExtensionRequest).toHaveBeenCalledWith('SESSION_PLAYBACK_RESUME', {
        sessionId: 'session-1',
        speed: 2,
      });
    });
  });

  it('shows completed playback summary when all recorded actions finished', async () => {
    sendExtensionRequest.mockImplementation(async (type: string) => {
      switch (type) {
        case 'SESSION_LIST':
          return {
            sessions: [
              createSession('session-1', {
                recording: {
                  status: 'idle',
                  actions: [
                    {
                      action: { id: 'recorded-click', type: 'click', selector: { css: '#done' } },
                      timestamp: Date.now() - 3000,
                    },
                    {
                      action: { id: 'recorded-submit', type: 'click', selector: { css: '#finish' } },
                      timestamp: Date.now() - 1000,
                    },
                  ],
                  startedAt: Date.now() - 4000,
                  updatedAt: Date.now() - 1000,
                },
                playback: {
                  status: 'idle',
                  nextActionIndex: 2,
                  speed: 1,
                  startedAt: Date.now() - 2500,
                  updatedAt: Date.now() - 250,
                  lastCompletedAt: Date.now() - 250,
                  lastError: null,
                },
              }),
            ],
          };
        case 'SESSION_CREATE':
          return { session: createSession('session-2') };
        case 'SESSION_SEND_MESSAGE':
          return undefined;
        default:
          return undefined;
      }
    });

    await renderApp();

    expect(await screen.findByText('Finished')).toBeInTheDocument();
    expect(screen.getByText('Playback finished for 2 actions. You can replay it from the start.')).toBeInTheDocument();
    expect(screen.getByText('2 / 2 actions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled();
  });

  it('exports recorded actions in each supported format from the playback card', async () => {
    const user = userEvent.setup();

    sendExtensionRequest.mockImplementation(async (type: string) => {
      switch (type) {
        case 'SESSION_LIST':
          return {
            sessions: [
              createSession('session-1', {
                recording: {
                  status: 'idle',
                  actions: [
                    {
                      action: { id: 'recorded-nav', type: 'navigate', url: 'https://example.com' },
                      timestamp: Date.now() - 2000,
                    },
                    {
                      action: { id: 'recorded-click', type: 'click', selector: { testId: 'submit' } },
                      timestamp: Date.now() - 1000,
                    },
                  ],
                  startedAt: Date.now() - 3000,
                  updatedAt: Date.now() - 1000,
                },
              }),
            ],
          };
        case 'SESSION_CREATE':
          return { session: createSession('session-2') };
        case 'SESSION_SEND_MESSAGE':
          return undefined;
        case 'SESSION_RECORDING_EXPORT':
          return { downloadId: 1, filename: 'recording-session-1.js', format: 'playwright' };
        default:
          return undefined;
      }
    });

    await renderApp();

    const exportFormat = await screen.findByRole('combobox', { name: 'Recording export format' });
    const exportButton = screen.getByRole('button', { name: 'Export' });

    await user.click(exportButton);
    await waitFor(() => {
      expect(sendExtensionRequest).toHaveBeenCalledWith('SESSION_RECORDING_EXPORT', {
        sessionId: 'session-1',
        format: 'json',
      });
    });

    await user.selectOptions(exportFormat, 'playwright');
    await user.click(exportButton);
    await waitFor(() => {
      expect(sendExtensionRequest).toHaveBeenCalledWith('SESSION_RECORDING_EXPORT', {
        sessionId: 'session-1',
        format: 'playwright',
      });
    });

    await user.selectOptions(exportFormat, 'puppeteer');
    await user.click(exportButton);
    await waitFor(() => {
      expect(sendExtensionRequest).toHaveBeenCalledWith('SESSION_RECORDING_EXPORT', {
        sessionId: 'session-1',
        format: 'puppeteer',
      });
    });
  });

  it('disables recording export when unavailable and while the export request is in flight', async () => {
    const user = userEvent.setup();
    const deferred = createDeferred<void>();

    sendExtensionRequest.mockImplementation((type: string) => {
      switch (type) {
        case 'SESSION_LIST':
          return Promise.resolve({
            sessions: [
              createSession('session-1', {
                recording: {
                  status: 'recording',
                  actions: [
                    {
                      action: { id: 'recorded-click', type: 'click', selector: { css: '#submit' } },
                      timestamp: Date.now() - 1000,
                    },
                  ],
                  startedAt: Date.now() - 2000,
                  updatedAt: Date.now() - 1000,
                },
              }),
            ],
          });
        case 'SESSION_CREATE':
          return Promise.resolve({ session: createSession('session-2') });
        case 'SESSION_SEND_MESSAGE':
          return Promise.resolve(undefined);
        case 'SESSION_RECORDING_EXPORT':
          return deferred.promise;
        default:
          return Promise.resolve(undefined);
      }
    });

    await renderApp();

    const exportFormat = await screen.findByRole('combobox', { name: 'Recording export format' });
    const exportButton = screen.getByRole('button', { name: 'Export' });

    expect(exportFormat).toBeDisabled();
    expect(exportButton).toBeDisabled();

    await act(async () => {
      emitExtensionEvent({
        id: 'evt-export-ready',
        channel: 'sidePanel',
        type: 'EVENT_SESSION_UPDATE',
        timestamp: Date.now(),
        payload: {
          sessionId: 'session-1',
          reason: 'updated',
          session: createSession('session-1', {
            recording: {
              status: 'idle',
              actions: [
                {
                  action: { id: 'recorded-click', type: 'click', selector: { css: '#submit' } },
                  timestamp: Date.now() - 1000,
                },
              ],
              startedAt: Date.now() - 2000,
              updatedAt: Date.now() - 1000,
            },
          }),
        },
      });
    });

    await waitFor(() => {
      expect(exportFormat).not.toBeDisabled();
      expect(exportButton).not.toBeDisabled();
    });

    await user.click(exportButton);

    await waitFor(() => {
      expect(exportFormat).toBeDisabled();
      expect(exportButton).toBeDisabled();
    });

    deferred.resolve(undefined);

    await waitFor(() => {
      expect(exportFormat).not.toBeDisabled();
      expect(exportButton).not.toBeDisabled();
    });
  });

  it('disables duplicate recording requests while a request is in flight', async () => {
    const user = userEvent.setup();
    const deferred = createDeferred<void>();

    sendExtensionRequest.mockImplementation((type: string) => {
      switch (type) {
        case 'SESSION_LIST':
          return Promise.resolve({ sessions: [createSession('session-1')] });
        case 'SESSION_CREATE':
          return Promise.resolve({ session: createSession('session-2') });
        case 'SESSION_SEND_MESSAGE':
          return Promise.resolve(undefined);
        case 'SESSION_RECORDING_START':
          return deferred.promise;
        default:
          return Promise.resolve(undefined);
      }
    });

    await renderApp();

    const startButton = await screen.findByRole('button', { name: 'Start recording' });
    await user.click(startButton);

    await waitFor(() => {
      expect(startButton).toBeDisabled();
    });

    await user.click(startButton);

    expect(sendExtensionRequest).toHaveBeenCalledTimes(2);
    expect(sendExtensionRequest).toHaveBeenNthCalledWith(2, 'SESSION_RECORDING_START', {
      sessionId: 'session-1',
    });

    deferred.resolve(undefined);

    await waitFor(() => {
      expect(startButton).not.toBeDisabled();
    });
  });

  it('disables playback controls while playback requests are in flight', async () => {
    const user = userEvent.setup();
    const startDeferred = createDeferred<void>();
    const speedDeferred = createDeferred<void>();

    sendExtensionRequest.mockImplementation((type: string) => {
      switch (type) {
        case 'SESSION_LIST':
          return Promise.resolve({
            sessions: [
              createSession('session-1', {
                recording: {
                  status: 'idle',
                  actions: [
                    {
                      action: { id: 'recorded-click', type: 'click', selector: { css: '#run' } },
                      timestamp: Date.now() - 1000,
                    },
                  ],
                  startedAt: Date.now() - 3000,
                  updatedAt: Date.now() - 1000,
                },
              }),
            ],
          });
        case 'SESSION_CREATE':
          return Promise.resolve({ session: createSession('session-2') });
        case 'SESSION_SEND_MESSAGE':
          return Promise.resolve(undefined);
        case 'SESSION_PLAYBACK_START':
          return startDeferred.promise;
        case 'SESSION_PLAYBACK_SET_SPEED':
          return speedDeferred.promise;
        default:
          return Promise.resolve(undefined);
      }
    });

    await renderApp();

    const playButton = await screen.findByRole('button', { name: 'Play' });
    await user.click(playButton);

    await waitFor(() => {
      expect(playButton).toBeDisabled();
    });

    startDeferred.resolve(undefined);

    await waitFor(() => {
      expect(playButton).not.toBeDisabled();
    });

    const speedSelect = screen.getByRole('combobox', { name: 'Playback speed' });
    await user.selectOptions(speedSelect, '2');

    await waitFor(() => {
      expect(speedSelect).toBeDisabled();
    });

    speedDeferred.resolve(undefined);

    await waitFor(() => {
      expect(speedSelect).not.toBeDisabled();
    });
  });

  it('updates chat and action log from service worker events', async () => {
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Active session' })).toHaveValue('session-1');
    });

    await act(async () => {
      emitExtensionEvent({
        id: 'evt-1',
        channel: 'sidePanel',
        type: 'EVENT_SESSION_UPDATE',
        timestamp: Date.now(),
        payload: {
          sessionId: 'session-1',
          reason: 'updated',
          session: createSession('session-1', {
            messages: [{ role: 'user', content: 'Extract pricing', timestamp: Date.now() }],
          }),
        },
      });

      emitExtensionEvent({
        id: 'evt-2',
        channel: 'sidePanel',
        type: 'EVENT_AI_STREAM',
        timestamp: Date.now(),
        payload: {
          sessionId: 'session-1',
          messageId: 'assistant-1',
          delta: 'Streaming reply',
          done: false,
        },
      });

      emitExtensionEvent({
        id: 'evt-3',
        channel: 'sidePanel',
        type: 'EVENT_ACTION_PROGRESS',
        timestamp: Date.now(),
        payload: {
          sessionId: 'session-1',
          entry: {
            id: 'action-1',
            title: 'Preparing extraction workflow',
            detail:
              'Publishing action progress to the side panel while the response stream is generated.',
            timestamp: Date.now(),
            status: 'running',
            progress: 35,
            currentStep: 1,
            totalSteps: 3,
          },
        },
      });
    });

    await settleReactUpdates();

    expect(await screen.findByText('Extract pricing')).toBeInTheDocument();
    expect(screen.getByText('Streaming reply')).toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: 'Expand action log' });
    await userEvent.setup().click(toggle);

    expect(screen.getByText('Preparing extraction workflow')).toBeInTheDocument();
  });

  it('sends prompts and keeps the Escape abort shortcut', async () => {
    const user = userEvent.setup();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Active session' })).toHaveValue('session-1');
    });

    const textbox = screen.getByRole('textbox', { name: 'Message input' });
    const fileInput = screen.getByLabelText('Choose files to upload');
    const file = new File(['hello'], 'note.txt', { type: 'text/plain', lastModified: 1700000000000 });

    await user.upload(fileInput, file);
    await user.type(textbox, 'Run extraction');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(sendExtensionRequest).toHaveBeenCalledWith('SESSION_SEND_MESSAGE', {
        sessionId: 'session-1',
        message: 'Run extraction',
        uploads: expect.arrayContaining([
          expect.objectContaining({
            name: 'note.txt',
            mimeType: 'text/plain',
            size: 5,
            lastModified: 1700000000000,
            base64Data: 'aGVsbG8=',
          }),
        ]),
      });
    });

    const sendMessage = vi.spyOn(chrome.runtime, 'sendMessage');
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'sidePanel',
        type: 'ACTION_ABORT',
      }),
    );
  });
});
