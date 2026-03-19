import { act, render, screen, waitFor, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../ui/theme';
import { App } from '../App';
import { resetActionLogStore } from '../store/actionLogStore';
import { resetChatStore } from '../store/chatStore';
import { resetWorkflowUIStore } from '../store/workflowUIStore';
import { resetSessionStore } from '../store/sessionStore';
import { createDefaultProviderConfigs } from '../../shared/config';

import type { ExtensionMessage, SavedWorkflow, Session } from '../../shared/types';

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

function createSavedWorkflow(id: string, overrides: Partial<SavedWorkflow> = {}): SavedWorkflow {
  return {
    id,
    name: 'Checkout smoke test',
    description: 'Replays the checkout journey up to payment confirmation.',
    actions: [
      {
        action: { id: `${id}-navigate`, type: 'navigate', url: 'https://example.com/checkout' },
        timestamp: Date.now() - 3000,
      },
      {
        action: { id: `${id}-click`, type: 'click', selector: { css: '[data-testid="continue"]' } },
        timestamp: Date.now() - 2000,
      },
    ],
    tags: ['qa', 'checkout'],
    createdAt: Date.now() - 4000,
    updatedAt: Date.now() - 1000,
    source: {
      sessionId: 'session-1',
      sessionName: 'Regression pass',
      recordedAt: Date.now() - 1000,
    },
    ...overrides,
  };
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
        case 'SETTINGS_GET':
          return {
            settings: {
              language: 'en',
              theme: 'system',
              defaultProvider: 'openai',
              streamResponses: true,
              includeScreenshotsInContext: true,
              maxContextLength: 12,
              defaultTimeout: 30000,
              autoRetryOnFailure: true,
              maxRetries: 2,
              screenshotOnError: true,
              allowCustomScripts: false,
              debugMode: false,
              showFloatingBar: true,
              highlightElements: true,
              soundNotifications: false,
            },
            providers: createDefaultProviderConfigs(),
            activeProvider: 'openai',
            onboarding: {
              version: 1,
              completed: true,
              lastStep: 3,
              completedAt: Date.now(),
              providerReady: true,
              configuredProvider: 'openai',
              validatedProvider: 'openai',
            },
            vault: {
              version: 1,
              initialized: true,
              lockState: 'unlocked',
              hasLegacySecrets: false,
              credentials: {
                openai: {
                  version: 1,
                  provider: 'openai',
                  providerFamily: 'default',
                  authFamily: 'api-key',
                  authKind: 'api-key',
                  maskedValue: 'sk-****sidepanel',
                  updatedAt: Date.now(),
                  validatedAt: Date.now(),
                },
              },
              accounts: {},
              activeAccounts: {},
            },
          };
        case 'SESSION_CREATE':
          return { session: createSession('session-2') };
        case 'SESSION_SEND_MESSAGE':
          return undefined;
        case 'WORKFLOW_LIST':
          return { workflows: [] };
        default:
          return undefined;
      }
    });
  });

  afterEach(() => {
    resetSessionStore();
    resetChatStore();
    resetActionLogStore();
    resetWorkflowUIStore();
  });

  it('renders the connected layout and bootstraps a session selector', async () => {
    await renderApp();

    const header = screen.getByTestId('sidepanel-header');
    expect(
      within(header).getByRole('heading', { level: 1, name: 'Flux Agent' }),
    ).toBeInTheDocument();
    expect(within(header).getByRole('radiogroup', { name: 'Theme mode' })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Active session' })).toHaveValue('session-1');
    });

    expect(screen.getByRole('button', { name: 'Start recording' })).toBeInTheDocument();
    expect(screen.getByText('Playback recorded actions')).toBeInTheDocument();
    expect(
      screen.getByText('Playback is unavailable until this session has recorded actions.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Saved workflows' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save workflow' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'New session' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(
      screen.getByText(
        'Create or switch a session, then send a prompt to start a streamed response.',
      ),
    ).toBeInTheDocument();
  });

  it('shows actionable codex account guidance when the active session needs a fresh artifact', async () => {
    sendExtensionRequest.mockImplementation(async (type: string) => {
      switch (type) {
        case 'SESSION_LIST':
          return {
            sessions: [
              createSession('session-codex', {
                config: {
                  id: 'session-codex',
                  provider: 'codex',
                  model: 'codex-mini-latest',
                  name: 'Codex troubleshooting',
                },
              }),
            ],
          };
        case 'SESSION_CREATE':
          return { session: createSession('session-2') };
        case 'SESSION_SEND_MESSAGE':
          return undefined;
        case 'WORKFLOW_LIST':
          return { workflows: [] };
        case 'ACCOUNT_AUTH_STATUS_GET':
          return {
            provider: 'codex',
            authFamily: 'account-backed',
            status: 'ready',
            availableTransports: ['artifact-import'],
            activeAccountId: 'acct_codex_primary',
            accounts: [
              {
                version: 1,
                provider: 'codex',
                providerFamily: 'chatgpt-account',
                authFamily: 'account-backed',
                accountId: 'acct_codex_primary',
                label: 'Codex Primary',
                maskedIdentifier: 'primary@example.com',
                status: 'active',
                isActive: true,
                updatedAt: Date.now(),
                metadata: {
                  session: {
                    authKind: 'session-token',
                    status: 'refresh-required',
                    observedAt: Date.now(),
                  },
                },
              },
            ],
            vault: {
              version: 1,
              initialized: true,
              lockState: 'unlocked',
              hasLegacySecrets: false,
              credentials: {},
              accounts: {},
              activeAccounts: {},
            },
          };
        default:
          return undefined;
      }
    });

    await renderApp();

    expect(await screen.findByText('Codex needs a fresh artifact')).toBeInTheDocument();
    expect(screen.getByText('Reconnect required')).toBeInTheDocument();
    expect(screen.getByText(/re-import a fresh official artifact in options, then validate the account again/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open provider settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('shows OpenAI browser-account helper-missing guidance and blocks send', async () => {
    const observedAt = Date.UTC(2026, 2, 19, 11, 0, 0);

    sendExtensionRequest.mockImplementation(async (type: string, payload?: { provider?: string }) => {
      switch (type) {
        case 'SESSION_LIST':
          return {
            sessions: [
              createSession('session-openai-browser', {
                config: {
                  id: 'session-openai-browser',
                  provider: 'openai',
                  model: 'codex-mini-latest',
                  name: 'OpenAI browser lane',
                },
              }),
            ],
          };
        case 'SETTINGS_GET': {
          const providers = createDefaultProviderConfigs();
          providers.openai.authChoiceId = 'browser-account';
          providers.openai.model = 'codex-mini-latest';

          return {
            settings: {
              language: 'en',
              theme: 'system',
              defaultProvider: 'openai',
              streamResponses: true,
              includeScreenshotsInContext: true,
              maxContextLength: 12,
              defaultTimeout: 30000,
              autoRetryOnFailure: true,
              maxRetries: 2,
              screenshotOnError: true,
              allowCustomScripts: false,
              debugMode: false,
              showFloatingBar: true,
              highlightElements: true,
              soundNotifications: false,
            },
            providers,
            activeProvider: 'openai',
            onboarding: {
              version: 1,
              completed: true,
              lastStep: 3,
              completedAt: Date.now(),
              providerReady: false,
              configuredProvider: 'openai',
            },
            vault: {
              version: 1,
              initialized: true,
              lockState: 'unlocked',
              hasLegacySecrets: false,
              credentials: {},
              accounts: {},
              activeAccounts: {},
            },
          };
        }
        case 'ACCOUNT_AUTH_STATUS_GET':
          expect(payload).toEqual({ provider: 'openai' });
          return {
            provider: 'openai',
            authFamily: 'account-backed',
            status: 'needs-auth',
            availableTransports: ['browser-helper'],
            browserLogin: {
              authMethod: 'browser-account',
              status: 'helper-missing',
              updatedAt: observedAt,
              lastAttemptAt: observedAt,
              retryable: true,
            },
            accounts: [],
            vault: {
              version: 1,
              initialized: true,
              lockState: 'unlocked',
              hasLegacySecrets: false,
              credentials: {},
              accounts: {},
              activeAccounts: {},
            },
          };
        case 'SESSION_CREATE':
          return { session: createSession('session-2') };
        case 'SESSION_SEND_MESSAGE':
          return undefined;
        case 'WORKFLOW_LIST':
          return { workflows: [] };
        default:
          return undefined;
      }
    });

    await renderApp();

    expect(await screen.findByText('OpenAI browser helper is unavailable')).toBeInTheDocument();
    expect(screen.getByText('Helper unavailable')).toBeInTheDocument();
    expect(screen.getByText(/use the api-key lane or install the helper/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('surfaces a bridged legacy codex session as OpenAI browser-account', async () => {
    const observedAt = Date.UTC(2026, 2, 19, 11, 30, 0);

    sendExtensionRequest.mockImplementation(async (type: string, payload?: { provider?: string }) => {
      switch (type) {
        case 'SESSION_LIST':
          return {
            sessions: [
              createSession('session-codex-bridge', {
                config: {
                  id: 'session-codex-bridge',
                  provider: 'codex',
                  model: 'codex-latest',
                  name: 'Legacy bridge session',
                },
              }),
            ],
          };
        case 'SETTINGS_GET': {
          const providers = createDefaultProviderConfigs();
          providers.openai.authChoiceId = 'browser-account';
          providers.openai.model = 'codex-latest';

          return {
            settings: {
              language: 'en',
              theme: 'system',
              defaultProvider: 'openai',
              streamResponses: true,
              includeScreenshotsInContext: true,
              maxContextLength: 12,
              defaultTimeout: 30000,
              autoRetryOnFailure: true,
              maxRetries: 2,
              screenshotOnError: true,
              allowCustomScripts: false,
              debugMode: false,
              showFloatingBar: true,
              highlightElements: true,
              soundNotifications: false,
            },
            providers,
            activeProvider: 'openai',
            onboarding: {
              version: 1,
              completed: true,
              lastStep: 3,
              completedAt: Date.now(),
              providerReady: true,
              configuredProvider: 'openai',
              validatedProvider: 'openai',
            },
            vault: {
              version: 1,
              initialized: true,
              lockState: 'unlocked',
              hasLegacySecrets: false,
              credentials: {},
              accounts: {},
              activeAccounts: {},
            },
          };
        }
        case 'ACCOUNT_AUTH_STATUS_GET':
          expect(payload).toEqual({ provider: 'openai' });
          return {
            provider: 'openai',
            authFamily: 'account-backed',
            status: 'ready',
            availableTransports: ['browser-helper'],
            browserLogin: {
              authMethod: 'browser-account',
              status: 'success',
              updatedAt: observedAt,
              lastAttemptAt: observedAt,
              lastCompletedAt: observedAt,
              accountId: 'acct_sidepanel_bridge',
              accountLabel: 'Legacy Sidepanel Bridge',
              retryable: false,
            },
            activeAccountId: 'acct_sidepanel_bridge',
            accounts: [
              {
                version: 1,
                provider: 'openai',
                providerFamily: 'default',
                authFamily: 'account-backed',
                accountId: 'acct_sidepanel_bridge',
                label: 'Legacy Sidepanel Bridge',
                maskedIdentifier: 'legacy-sidepanel@example.com',
                status: 'active',
                isActive: true,
                updatedAt: observedAt,
                validatedAt: observedAt,
              },
            ],
            vault: {
              version: 1,
              initialized: true,
              lockState: 'unlocked',
              hasLegacySecrets: false,
              credentials: {},
              accounts: {},
              activeAccounts: {},
            },
          };
        case 'SESSION_CREATE':
          return { session: createSession('session-2') };
        case 'SESSION_SEND_MESSAGE':
          return undefined;
        case 'WORKFLOW_LIST':
          return { workflows: [] };
        default:
          return undefined;
      }
    });

    await renderApp();

    expect(await screen.findByText('OpenAI browser-account is ready')).toBeInTheDocument();
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
    expect(screen.queryByText('ChatGPT Plus / Codex (Experimental)')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('shows vault unlock guidance for codex sessions when the account store is locked', async () => {
    sendExtensionRequest.mockImplementation(async (type: string) => {
      switch (type) {
        case 'SESSION_LIST':
          return {
            sessions: [
              createSession('session-codex-locked', {
                config: {
                  id: 'session-codex-locked',
                  provider: 'codex',
                  model: 'codex-mini-latest',
                  name: 'Codex locked session',
                },
              }),
            ],
          };
        case 'SESSION_CREATE':
          return { session: createSession('session-2') };
        case 'SESSION_SEND_MESSAGE':
          return undefined;
        case 'WORKFLOW_LIST':
          return { workflows: [] };
        case 'ACCOUNT_AUTH_STATUS_GET':
          return {
            provider: 'codex',
            authFamily: 'account-backed',
            status: 'vault-locked',
            availableTransports: ['artifact-import'],
            activeAccountId: 'acct_codex_locked',
            accounts: [
              {
                version: 1,
                provider: 'codex',
                providerFamily: 'chatgpt-account',
                authFamily: 'account-backed',
                accountId: 'acct_codex_locked',
                label: 'Locked Codex Account',
                maskedIdentifier: 'locked@example.com',
                status: 'active',
                isActive: true,
                updatedAt: Date.now(),
              },
            ],
            vault: {
              version: 1,
              initialized: true,
              lockState: 'locked',
              hasLegacySecrets: false,
              credentials: {},
              accounts: {},
              activeAccounts: {},
            },
          };
        default:
          return undefined;
      }
    });

    await renderApp();

    expect(await screen.findByText('Reconnect Codex account')).toBeInTheDocument();
    expect(screen.getByText('Stored credential unavailable')).toBeInTheDocument();
    expect(
      screen.getByText(/import or reconnect an account in options, then validate the active account again if needed/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('shows CLIProxyAPI readiness guidance and blocks send until validation passes', async () => {
    sendExtensionRequest.mockImplementation(async (type: string) => {
      switch (type) {
        case 'SESSION_LIST':
          return {
            sessions: [
              createSession('session-cliproxyapi', {
                config: {
                  id: 'session-cliproxyapi',
                  provider: 'cliproxyapi',
                  model: 'gpt-5',
                  name: 'CLIProxyAPI troubleshooting',
                },
              }),
            ],
          };
        case 'SETTINGS_GET': {
          const providers = createDefaultProviderConfigs();
          providers.cliproxyapi.customEndpoint = 'http://127.0.0.1:8317/v1';

          return {
            settings: {
              language: 'en',
              theme: 'system',
              defaultProvider: 'cliproxyapi',
              streamResponses: true,
              includeScreenshotsInContext: true,
              maxContextLength: 12,
              defaultTimeout: 30000,
              autoRetryOnFailure: true,
              maxRetries: 2,
              screenshotOnError: true,
              allowCustomScripts: false,
              debugMode: false,
              showFloatingBar: true,
              highlightElements: true,
              soundNotifications: false,
            },
            providers,
            activeProvider: 'cliproxyapi',
            onboarding: {
              version: 1,
              completed: true,
              lastStep: 3,
              completedAt: Date.now(),
              providerReady: false,
              configuredProvider: 'cliproxyapi',
            },
            vault: {
              version: 1,
              initialized: true,
              lockState: 'unlocked',
              hasLegacySecrets: false,
              credentials: {
                cliproxyapi: {
                  version: 1,
                  provider: 'cliproxyapi',
                  providerFamily: 'default',
                  authFamily: 'api-key',
                  authKind: 'api-key',
                  maskedValue: '••••••••••••',
                  updatedAt: Date.now(),
                },
              },
              accounts: {},
              activeAccounts: {},
            },
          };
        }
        case 'SESSION_CREATE':
          return { session: createSession('session-2') };
        case 'SESSION_SEND_MESSAGE':
          return undefined;
        case 'WORKFLOW_LIST':
          return { workflows: [] };
        default:
          return undefined;
      }
    });

    await renderApp();

    expect(await screen.findByText('CLIProxyAPI endpoint saved but unvalidated')).toBeInTheDocument();
    expect(screen.getByText('Test connection')).toBeInTheDocument();
    expect(
      screen.getByText(/keep the saved endpoint, then run test connection/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('opens the saved workflows library and renders stored workflow metadata with a view toggle', async () => {
    const user = userEvent.setup();

    sendExtensionRequest.mockImplementation(async (type: string) => {
      switch (type) {
        case 'SESSION_LIST':
          return { sessions: [createSession('session-1')] };
        case 'SESSION_CREATE':
          return { session: createSession('session-2') };
        case 'SESSION_SEND_MESSAGE':
          return undefined;
        case 'WORKFLOW_LIST':
          return { workflows: [createSavedWorkflow('workflow-1')] };
        default:
          return undefined;
      }
    });

    await renderApp();

    await user.click(screen.getByRole('button', { name: 'Saved workflows' }));

    const dialog = await screen.findByRole('dialog', { name: 'Saved workflows' });
    expect(within(dialog).getAllByText('Checkout smoke test')).toHaveLength(2);
    expect(
      within(dialog).getAllByText('Replays the checkout journey up to payment confirmation.'),
    ).toHaveLength(2);
    expect(within(dialog).getAllByText('qa')).toHaveLength(2);
    expect(within(dialog).getAllByText('checkout')).toHaveLength(2);
    expect(within(dialog).getByText('From Regression pass')).toBeInTheDocument();

    const listToggle = within(dialog).getByRole('button', { name: 'List' });
    expect(listToggle).toHaveAttribute('aria-pressed', 'false');

    await user.click(listToggle);

    expect(listToggle).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByRole('button', { name: 'Run' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Edit' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeEnabled();
  });

  it('opens the save workflow modal and persists a saved workflow from recorded actions', async () => {
    const user = userEvent.setup();
    const createdWorkflow = createSavedWorkflow('workflow-created', {
      name: 'Checkout happy path',
      description: 'Covers cart review through confirmation.',
      tags: ['qa', 'smoke'],
      source: {
        sessionId: 'session-1',
        sessionName: 'Checkout recorder',
        recordedAt: Date.now() - 2000,
      },
    });

    sendExtensionRequest.mockImplementation(async (type: string) => {
      switch (type) {
        case 'SESSION_LIST':
          return {
            sessions: [
              createSession('session-1', {
                config: {
                  id: 'session-1',
                  provider: 'openai',
                  model: 'gpt-4o-mini',
                  name: 'Checkout recorder',
                },
                recording: {
                  status: 'idle',
                  actions: [
                    {
                      action: {
                        id: 'recorded-nav',
                        type: 'navigate',
                        url: 'https://example.com/cart',
                      },
                      timestamp: Date.now() - 4000,
                    },
                    {
                      action: {
                        id: 'recorded-click',
                        type: 'click',
                        selector: { css: '#checkout' },
                      },
                      timestamp: Date.now() - 2000,
                    },
                  ],
                  startedAt: Date.now() - 5000,
                  updatedAt: Date.now() - 2000,
                },
              }),
            ],
          };
        case 'SESSION_CREATE':
          return { session: createSession('session-2') };
        case 'SESSION_SEND_MESSAGE':
          return undefined;
        case 'WORKFLOW_LIST':
          return { workflows: [] };
        case 'WORKFLOW_CREATE':
          return { workflow: createdWorkflow };
        default:
          return undefined;
      }
    });

    await renderApp();

    const saveButton = await screen.findByRole('button', { name: 'Save workflow' });
    expect(saveButton).toBeEnabled();

    await user.click(saveButton);

    const dialog = await screen.findByRole('dialog', { name: 'Save workflow' });
    const nameInput = within(dialog).getByLabelText('Workflow name');
    const descriptionInput = within(dialog).getByLabelText('Description');
    const tagsInput = within(dialog).getByLabelText('Tags');

    expect(nameInput).toHaveValue('Checkout recorder workflow');

    fireEvent.change(nameInput, { target: { value: 'Checkout happy path' } });
    fireEvent.change(descriptionInput, {
      target: { value: 'Covers cart review through confirmation.' },
    });
    fireEvent.change(tagsInput, { target: { value: 'qa, smoke' } });
    await user.click(within(dialog).getByRole('button', { name: 'Save workflow' }));

    await waitFor(() => {
      expect(sendExtensionRequest).toHaveBeenCalledWith('WORKFLOW_CREATE', {
        name: 'Checkout happy path',
        description: 'Covers cart review through confirmation.',
        tags: ['qa', 'smoke'],
        actions: expect.arrayContaining([
          expect.objectContaining({ action: expect.objectContaining({ type: 'navigate' }) }),
          expect.objectContaining({ action: expect.objectContaining({ type: 'click' }) }),
        ]),
        source: expect.objectContaining({
          sessionId: 'session-1',
          sessionName: 'Checkout recorder',
        }),
      });
    });

    const libraryDialog = await screen.findByRole('dialog', { name: 'Saved workflows' });
    expect(within(libraryDialog).getAllByText('Checkout happy path')).toHaveLength(2);
    expect(
      within(libraryDialog).getAllByText('Covers cart review through confirmation.'),
    ).toHaveLength(2);
    expect(within(libraryDialog).getAllByText('smoke')).toHaveLength(2);
  });

  it('runs a saved workflow against the active session from the library', async () => {
    const user = userEvent.setup();

    sendExtensionRequest.mockImplementation(async (type: string) => {
      switch (type) {
        case 'SESSION_LIST':
          return { sessions: [createSession('session-1')] };
        case 'SESSION_CREATE':
          return { session: createSession('session-2') };
        case 'SESSION_SEND_MESSAGE':
          return undefined;
        case 'WORKFLOW_LIST':
          return { workflows: [createSavedWorkflow('workflow-1')] };
        case 'WORKFLOW_RUN':
          return {
            workflow: createSavedWorkflow('workflow-1'),
            session: createSession('session-1', {
              recording: {
                status: 'idle',
                actions: createSavedWorkflow('workflow-1').actions,
                startedAt: null,
                updatedAt: Date.now(),
              },
              playback: {
                status: 'playing',
                nextActionIndex: 0,
                speed: 1,
                startedAt: Date.now(),
                updatedAt: Date.now(),
                lastCompletedAt: null,
                lastError: null,
              },
            }),
          };
        default:
          return undefined;
      }
    });

    await renderApp();

    await user.click(screen.getByRole('button', { name: 'Saved workflows' }));
    const dialog = await screen.findByRole('dialog', { name: 'Saved workflows' });

    await user.click(within(dialog).getByRole('button', { name: 'Run' }));

    await waitFor(() => {
      expect(sendExtensionRequest).toHaveBeenCalledWith('WORKFLOW_RUN', {
        workflowId: 'workflow-1',
        sessionId: 'session-1',
      });
    });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Saved workflows' })).not.toBeInTheDocument();
    });
  });

  it('reuses the save modal to edit workflow metadata', async () => {
    const user = userEvent.setup();
    const updatedWorkflow = createSavedWorkflow('workflow-1', {
      name: 'Checkout recovery path',
      description: 'Covers retries before payment confirmation.',
      tags: ['qa', 'recovery'],
    });

    sendExtensionRequest.mockImplementation(async (type: string) => {
      switch (type) {
        case 'SESSION_LIST':
          return { sessions: [createSession('session-1')] };
        case 'SESSION_CREATE':
          return { session: createSession('session-2') };
        case 'SESSION_SEND_MESSAGE':
          return undefined;
        case 'WORKFLOW_LIST':
          return { workflows: [createSavedWorkflow('workflow-1')] };
        case 'WORKFLOW_UPDATE':
          return { workflow: updatedWorkflow };
        default:
          return undefined;
      }
    });

    await renderApp();

    await user.click(screen.getByRole('button', { name: 'Saved workflows' }));
    const libraryDialog = await screen.findByRole('dialog', { name: 'Saved workflows' });

    await user.click(within(libraryDialog).getByRole('button', { name: 'Edit' }));

    const editDialog = await screen.findByRole('dialog', { name: 'Edit workflow' });
    expect(within(editDialog).getByRole('button', { name: 'Save changes' })).toBeInTheDocument();

    fireEvent.change(within(editDialog).getByLabelText('Workflow name'), {
      target: { value: 'Checkout recovery path' },
    });
    fireEvent.change(within(editDialog).getByLabelText('Description'), {
      target: { value: 'Covers retries before payment confirmation.' },
    });
    fireEvent.change(within(editDialog).getByLabelText('Tags'), {
      target: { value: 'qa, recovery' },
    });
    await user.click(within(editDialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(sendExtensionRequest).toHaveBeenCalledWith('WORKFLOW_UPDATE', {
        workflowId: 'workflow-1',
        updates: {
          name: 'Checkout recovery path',
          description: 'Covers retries before payment confirmation.',
          tags: ['qa', 'recovery'],
        },
      });
    });

    const updatedLibrary = await screen.findByRole('dialog', { name: 'Saved workflows' });
    expect(within(updatedLibrary).getAllByText('Checkout recovery path')).toHaveLength(2);
    expect(
      within(updatedLibrary).getAllByText('Covers retries before payment confirmation.'),
    ).toHaveLength(2);
    expect(within(updatedLibrary).getAllByText('recovery')).toHaveLength(2);
  });

  it('deletes a workflow and keeps selection on the remaining item', async () => {
    const user = userEvent.setup();

    sendExtensionRequest.mockImplementation(async (type: string) => {
      switch (type) {
        case 'SESSION_LIST':
          return { sessions: [createSession('session-1')] };
        case 'SESSION_CREATE':
          return { session: createSession('session-2') };
        case 'SESSION_SEND_MESSAGE':
          return undefined;
        case 'WORKFLOW_LIST':
          return {
            workflows: [
              createSavedWorkflow('workflow-1'),
              createSavedWorkflow('workflow-2', {
                name: 'Billing retry',
                description: 'Retries the declined-card path.',
                tags: ['billing'],
              }),
            ],
          };
        case 'WORKFLOW_DELETE':
          return { workflowId: 'workflow-1' };
        default:
          return undefined;
      }
    });

    await renderApp();

    await user.click(screen.getByRole('button', { name: 'Saved workflows' }));
    const libraryDialog = await screen.findByRole('dialog', { name: 'Saved workflows' });

    await user.click(within(libraryDialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(sendExtensionRequest).toHaveBeenCalledWith('WORKFLOW_DELETE', {
        workflowId: 'workflow-1',
      });
    });

    await waitFor(() => {
      expect(screen.queryByText('Checkout smoke test')).not.toBeInTheDocument();
    });

    const updatedLibrary = await screen.findByRole('dialog', { name: 'Saved workflows' });
    expect(within(updatedLibrary).getAllByText('Billing retry')).toHaveLength(2);
    expect(within(updatedLibrary).getByRole('button', { name: 'Run' })).toBeEnabled();
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
                      action: {
                        id: 'recorded-click',
                        type: 'click',
                        selector: { css: '#open-menu' },
                      },
                      timestamp: Date.now() - 3000,
                    },
                    {
                      action: {
                        id: 'recorded-type',
                        type: 'type',
                        selector: { css: '#query' },
                        text: 'Flux',
                      },
                      timestamp: Date.now() - 2000,
                    },
                    {
                      action: {
                        id: 'recorded-submit',
                        type: 'click',
                        selector: { css: '#submit' },
                      },
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

    expect(
      await screen.findByText('Ready to replay 3 actions from the start.'),
    ).toBeInTheDocument();
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
                      action: {
                        id: 'recorded-click',
                        type: 'click',
                        selector: { css: '#start-button' },
                      },
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
    expect(
      screen.getByText(
        '1 action captured so far. New browser steps will keep syncing into this session.',
      ),
    ).toBeInTheDocument();
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
                      action: {
                        id: 'recorded-click',
                        type: 'click',
                        selector: { css: '#pause-button' },
                      },
                      timestamp: Date.now(),
                    },
                    {
                      action: {
                        id: 'recorded-type',
                        type: 'type',
                        selector: { css: '#input' },
                        text: 'hello',
                      },
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
    expect(
      screen.getByText('2 actions captured. Resume when you want to keep collecting steps.'),
    ).toBeInTheDocument();
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
                      action: {
                        id: 'recorded-type',
                        type: 'type',
                        selector: { css: '#field' },
                        text: 'ok',
                      },
                      timestamp: Date.now() - 3000,
                    },
                    {
                      action: {
                        id: 'recorded-submit',
                        type: 'click',
                        selector: { css: '#submit' },
                      },
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
                      action: {
                        id: 'recorded-submit',
                        type: 'click',
                        selector: { css: '#second' },
                      },
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
    expect(
      screen.getByText('Playback issue: Element #second was not found in the current page state.'),
    ).toBeInTheDocument();
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
                      action: {
                        id: 'recorded-submit',
                        type: 'click',
                        selector: { css: '#finish' },
                      },
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
    expect(
      screen.getByText('Playback finished for 2 actions. You can replay it from the start.'),
    ).toBeInTheDocument();
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
                      action: {
                        id: 'recorded-click',
                        type: 'click',
                        selector: { testId: 'submit' },
                      },
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

    const recordingStartCalls = sendExtensionRequest.mock.calls.filter(
      ([type]) => type === 'SESSION_RECORDING_START',
    );
    expect(recordingStartCalls).toHaveLength(1);
    expect(recordingStartCalls[0]).toEqual([
      'SESSION_RECORDING_START',
      {
        sessionId: 'session-1',
      },
    ]);

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
    const file = new File(['hello'], 'note.txt', {
      type: 'text/plain',
      lastModified: 1700000000000,
    });

    await user.upload(fileInput, file);
    fireEvent.change(textbox, { target: { value: 'Run extraction' } });
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
