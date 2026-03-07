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

async function renderApp() {
  await act(async () => {
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );
  });
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

    expect(screen.getByRole('button', { name: 'New session' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByText('Create or switch a session, then send a prompt to start a streamed response.')).toBeInTheDocument();
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
    await user.type(textbox, 'Run extraction');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(sendExtensionRequest).toHaveBeenCalledWith('SESSION_SEND_MESSAGE', {
      sessionId: 'session-1',
      message: 'Run extraction',
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
