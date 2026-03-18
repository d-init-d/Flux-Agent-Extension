import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultProviderConfigs } from '../../shared/config';
import type { AIProviderType, ExtensionMessage, VaultState } from '../../shared/types';
import { ThemeProvider } from '../../ui/theme';
import { createDefaultOnboardingState } from '../../shared/storage/onboarding';
import { readStorage, seedStorage } from '../../test/helpers';
import { App } from '../App';

type TabsMockApi = typeof chrome.tabs & {
  _setTabs: (tabs: chrome.tabs.Tab[]) => void;
};

function getTabsMock(): TabsMockApi {
  return chrome.tabs as TabsMockApi;
}

function createMockTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id: 1,
    index: 0,
    windowId: 1,
    highlighted: true,
    active: true,
    selected: true,
    pinned: false,
    incognito: false,
    url: 'https://example.com',
    title: 'Example Page',
    status: 'complete',
    discarded: false,
    frozen: false,
    autoDiscardable: true,
    groupId: -1,
    ...overrides,
  };
}

function renderApp() {
  return render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
}

function createVaultState(overrides: Partial<VaultState> = {}): VaultState {
  return {
    version: 1,
    initialized: true,
    lockState: 'unlocked',
    hasLegacySecrets: false,
    credentials: {},
    accounts: {},
    activeAccounts: {},
    ...overrides,
  };
}

function mockPopupRuntime(options?: {
  activeProvider?: 'openai' | 'codex' | 'cliproxyapi';
  vault?: VaultState;
  accountAuthStatus?: Record<string, unknown>;
  sessions?: Array<Record<string, unknown>>;
  providerConfigs?: Partial<Record<AIProviderType, Record<string, unknown>>>;
}): void {
  const vault = options?.vault ?? createVaultState();
  const providerConfigs = createDefaultProviderConfigs();
  for (const [provider, config] of Object.entries(options?.providerConfigs ?? {})) {
    Object.assign(providerConfigs[provider as AIProviderType], config);
  }
  const settingsResponse = {
    settings: {
      language: 'en',
      theme: 'system',
      defaultProvider: options?.activeProvider ?? 'openai',
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
    providers: providerConfigs,
    activeProvider: options?.activeProvider ?? 'openai',
    onboarding: {
      version: 1,
      completed: true,
      lastStep: 3,
      completedAt: Date.UTC(2026, 2, 7, 10, 0),
      providerReady: true,
      configuredProvider: options?.activeProvider ?? 'openai',
      validatedProvider: options?.activeProvider ?? 'openai',
    },
    vault,
  };

  vi.mocked(chrome.runtime.sendMessage).mockImplementation(
    async (message: unknown): Promise<unknown> => {
      const request = message as ExtensionMessage;

      switch (request.type) {
        case 'SETTINGS_GET':
          return { success: true, data: settingsResponse };
        case 'ACCOUNT_AUTH_STATUS_GET':
          return {
            success: true,
            data:
              options?.accountAuthStatus ?? {
                provider: 'codex',
                authFamily: 'account-backed',
                status: 'needs-auth',
                availableTransports: ['artifact-import'],
                accounts: [],
                activeAccountId: undefined,
                vault,
              },
          };
        case 'SESSION_LIST':
          return { success: true, data: { sessions: options?.sessions ?? [] } };
        case 'SESSION_CREATE':
          return {
            success: true,
            data: {
              session: {
                config: {
                  id: 'popup-session-1',
                  provider: options?.activeProvider ?? 'openai',
                  model: 'gpt-4o-mini',
                  name: 'Popup quick action session',
                },
                status: 'idle',
                targetTabId: 1,
                tabSnapshot: [],
                recording: { status: 'idle', actions: [], startedAt: null, updatedAt: null },
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
              },
            },
          };
        case 'SESSION_SEND_MESSAGE':
        case 'SESSION_PLAYBACK_START':
          return { success: true, data: undefined };
        default:
          return { success: true, data: undefined };
      }
    },
  );
}

describe('Popup App (U-06 quick actions + page info)', () => {
  beforeEach(async () => {
    await seedStorage({
      onboarding: {
        version: 1,
        completed: true,
        lastStep: 3,
        completedAt: Date.UTC(2026, 2, 7, 10, 0),
      },
    });
    mockPopupRuntime();
  });

  it('renders a popup-sized layout with live current page details', async () => {
    getTabsMock()._setTabs([
      createMockTab({
        title: 'Flux Agent Extension Roadmap | Notion',
        url: 'https://workspace.notion.site/flux-agent-extension-roadmap',
        status: 'complete',
      }),
    ]);

    renderApp();

    const root = screen.getByTestId('popup-root');
    expect(root).toHaveClass('h-[480px]');
    expect(root).toHaveClass('w-[360px]');

    await waitFor(() => {
      expect(chrome.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    });

    const pageCard = screen.getByTestId('popup-page-card');
    expect(within(pageCard).getByText('Current page')).toBeInTheDocument();
    expect(
      await within(pageCard).findByRole('heading', {
        level: 2,
        name: 'Flux Agent Extension Roadmap | Notion',
      }),
    ).toBeInTheDocument();
    expect(within(pageCard).getByText('workspace.notion.site')).toBeInTheDocument();
    expect(
      within(pageCard).getByText('workspace.notion.site/flux-agent-extension-roadmap'),
    ).toBeInTheDocument();
    expect(within(pageCard).getByText('Ready for quick actions')).toBeInTheDocument();
    expect(screen.getByText('Ready for live actions')).toBeInTheDocument();
  });

  it('renders exactly four quick action controls', async () => {
    renderApp();

    await waitFor(() => {
      expect(chrome.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    });

    const actions = screen.getByTestId('popup-quick-actions');
    const buttons = within(actions).getAllByRole('button');

    expect(buttons).toHaveLength(4);
    expect(within(actions).getByRole('button', { name: /summarize page/i })).toBeInTheDocument();
    expect(within(actions).getByRole('button', { name: /extract data/i })).toBeInTheDocument();
    expect(within(actions).getByRole('button', { name: /inspect elements/i })).toBeInTheDocument();
    expect(within(actions).getByRole('button', { name: /replay last run/i })).toBeInTheDocument();
  });

  it('shows the codex empty state and keeps quick actions locked until an account is imported', async () => {
    mockPopupRuntime({ activeProvider: 'codex' });

    renderApp();

    const providerCard = await screen.findByTestId('popup-provider-card');
    expect(within(providerCard).getByText('ChatGPT Plus / Codex (Experimental)')).toBeInTheDocument();
    expect(within(providerCard).getByText('Account missing')).toBeInTheDocument();
    expect(within(providerCard).getByText('Import a Codex account')).toBeInTheDocument();
    expect(
      within(providerCard).getByText(/no official auth artifact is available for the active codex provider yet/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /summarize page/i })).toBeDisabled();
    expect(
      within(providerCard).getByText(/import an official artifact in options, then run validation/i),
    ).toBeInTheDocument();
  });

  it('surfaces a refresh-required codex account state in the popup footer', async () => {
    const observedAt = Date.UTC(2026, 2, 17, 9, 0, 0);

    mockPopupRuntime({
      activeProvider: 'codex',
      vault: createVaultState({
        credentials: {
          codex: {
            version: 1,
            provider: 'codex',
            providerFamily: 'chatgpt-account',
            authFamily: 'account-backed',
            authKind: 'account-artifact',
            maskedValue: 'acct_****1234',
            updatedAt: observedAt,
          },
        },
        accounts: {
          codex: [
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
              updatedAt: observedAt,
              metadata: {
                session: {
                  authKind: 'session-token',
                  status: 'refresh-required',
                  observedAt,
                },
              },
            },
          ],
        },
        activeAccounts: {
          codex: 'acct_codex_primary',
        },
      }),
      accountAuthStatus: {
        provider: 'codex',
        authFamily: 'account-backed',
        status: 'ready',
        availableTransports: ['artifact-import'],
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
            updatedAt: observedAt,
            metadata: {
              session: {
                authKind: 'session-token',
                status: 'refresh-required',
                observedAt,
              },
            },
          },
        ],
        activeAccountId: 'acct_codex_primary',
        vault: createVaultState(),
      },
    });

    renderApp();

    const providerCard = await screen.findByTestId('popup-provider-card');
    expect((await screen.findAllByText('Refresh required')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /extract data/i })).toBeDisabled();
    expect(screen.getByText('Codex needs a fresh artifact')).toBeInTheDocument();
    expect(
      within(providerCard).getByText(/re-import a fresh official artifact in options, then validate the account again/i),
    ).toBeInTheDocument();
  });

  it('surfaces a vault-locked codex state without hiding the provider guidance', async () => {
    const observedAt = Date.UTC(2026, 2, 17, 9, 0, 0);

    mockPopupRuntime({
      activeProvider: 'codex',
      vault: createVaultState({
        lockState: 'locked',
        credentials: {
          codex: {
            version: 1,
            provider: 'codex',
            providerFamily: 'chatgpt-account',
            authFamily: 'account-backed',
            authKind: 'account-artifact',
            maskedValue: 'chatgpt:lo***@example.com',
            updatedAt: observedAt,
          },
        },
        accounts: {
          codex: [
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
              updatedAt: observedAt,
            },
          ],
        },
        activeAccounts: {
          codex: 'acct_codex_locked',
        },
      }),
      accountAuthStatus: {
        provider: 'codex',
        authFamily: 'account-backed',
        status: 'vault-locked',
        availableTransports: ['artifact-import'],
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
            updatedAt: observedAt,
          },
        ],
        activeAccountId: 'acct_codex_locked',
        vault: createVaultState({ lockState: 'locked' }),
      },
    });

    renderApp();

    const providerCard = await screen.findByTestId('popup-provider-card');
    expect(within(providerCard).getByText('Vault locked')).toBeInTheDocument();
    expect(within(providerCard).getByText('Unlock the vault for Codex')).toBeInTheDocument();
    expect(
      within(providerCard).getByText(/unlock the vault in options, then validate the active account again if needed/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /summarize page/i })).toBeDisabled();
  });

  it('shows a missing-endpoint readiness state for cliproxyapi', async () => {
    mockPopupRuntime({
      activeProvider: 'cliproxyapi',
      vault: createVaultState({
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
      }),
    });

    renderApp();

    const providerCard = await screen.findByTestId('popup-provider-card');
    expect(within(providerCard).getByText('CLIProxyAPI')).toBeInTheDocument();
    expect(within(providerCard).getByText('Endpoint required')).toBeInTheDocument();
    expect(within(providerCard).getByText('Add a CLIProxyAPI endpoint')).toBeInTheDocument();
    expect(
      within(providerCard).getByText(/cliproxyapi is endpoint-driven/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /summarize page/i })).toBeDisabled();
  });

  it('shows an unvalidated readiness state for cliproxyapi after the endpoint is saved', async () => {
    mockPopupRuntime({
      activeProvider: 'cliproxyapi',
      providerConfigs: {
        cliproxyapi: {
          customEndpoint: 'http://127.0.0.1:8317/v1',
        },
      },
      vault: createVaultState({
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
      }),
    });

    renderApp();

    const providerCard = await screen.findByTestId('popup-provider-card');
    expect(within(providerCard).getByText('Test connection')).toBeInTheDocument();
    expect(within(providerCard).getByText('CLIProxyAPI endpoint saved but unvalidated')).toBeInTheDocument();
    expect(
      within(providerCard).getByText(/saved cliproxyapi endpoint and vault-backed api key/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /extract data/i })).toBeDisabled();
  });

  it('shows cliproxyapi as ready only after endpoint validation has passed', async () => {
    const validatedAt = Date.now();
    mockPopupRuntime({
      activeProvider: 'cliproxyapi',
      providerConfigs: {
        cliproxyapi: {
          customEndpoint: 'http://127.0.0.1:8317/v1',
        },
      },
      vault: createVaultState({
        credentials: {
          cliproxyapi: {
            version: 1,
            provider: 'cliproxyapi',
            providerFamily: 'default',
            authFamily: 'api-key',
            authKind: 'api-key',
            maskedValue: '••••••••••••',
            updatedAt: validatedAt,
            validatedAt,
          },
        },
      }),
    });

    renderApp();

    const providerCard = await screen.findByTestId('popup-provider-card');
    expect(within(providerCard).getByText('Ready')).toBeInTheDocument();
    expect(within(providerCard).getByText('CLIProxyAPI is ready')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /summarize page/i })).toBeEnabled();
  });

  it('falls back gracefully when tab access fails', async () => {
    vi.spyOn(chrome.tabs, 'query').mockRejectedValueOnce(new Error('Permission denied'));

    renderApp();

    expect(await screen.findByText('Active tab unavailable')).toBeInTheDocument();
    expect(
      screen.getAllByText('Quick actions need an accessible active tab before they can run.'),
    ).toHaveLength(2);
  });

  it('blocks quick actions on Chrome internal pages and explains why', async () => {
    getTabsMock()._setTabs([
      createMockTab({
        title: 'The moi',
        url: 'chrome://newtab',
        status: 'complete',
      }),
    ]);

    renderApp();

    const pageCard = screen.getByTestId('popup-page-card');

    expect(await within(pageCard).findByText('Open a website tab')).toBeInTheDocument();
    expect(within(pageCard).getByText('chrome page')).toBeInTheDocument();
    expect(within(pageCard).getByText('chrome://newtab')).toBeInTheDocument();
    expect(
      within(pageCard).getByText(
        'Flux only runs quick actions on regular website tabs (http/https). Chrome internal pages, extension pages, and blank tabs are not supported.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /summarize page/i })).toBeDisabled();
  });

  it('exposes the theme toggle and applies a persisted selection', async () => {
    const user = userEvent.setup();

    renderApp();

    const themeToggle = screen.getByRole('radiogroup', { name: 'Theme mode' });
    expect(within(themeToggle).getByRole('radio', { name: 'Use light theme' })).toBeInTheDocument();
    expect(within(themeToggle).getByRole('radio', { name: 'Use dark theme' })).toBeInTheDocument();
    expect(
      within(themeToggle).getByRole('radio', { name: 'Use system theme' }),
    ).toBeInTheDocument();

    await user.click(within(themeToggle).getByRole('radio', { name: 'Use dark theme' }));

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(localStorage.getItem('flux-agent-theme')).toBe('dark');
  });

  it('shows an open guided setup CTA when onboarding is incomplete', async () => {
    const user = userEvent.setup();

    await seedStorage({
      onboarding: createDefaultOnboardingState(),
    });

    renderApp();

    expect(screen.getByRole('button', { name: /summarize page/i })).toBeDisabled();

    expect(await screen.findByRole('button', { name: /open guided setup/i })).toBeInTheDocument();
    const cta = screen.getByRole('button', { name: /finish setup/i });
    expect(screen.getByText('Guided setup')).toBeInTheDocument();
    expect(screen.getByText(/complete guided setup to unlock live quick actions/i)).toBeInTheDocument();

    await user.click(cta);

    await waitFor(() => {
      expect(chrome.runtime.openOptionsPage).toHaveBeenCalledTimes(1);
    });

    await expect(readStorage('onboarding')).resolves.toEqual(
      expect.objectContaining({
        completed: false,
        resumeRequestedAt: expect.any(Number),
      }),
    );
  });

  it('defaults to guided setup when onboarding state is missing', async () => {
    await chrome.storage.local.remove('onboarding');

    renderApp();

    expect(screen.getByRole('button', { name: /summarize page/i })).toBeDisabled();

    expect(await screen.findByRole('button', { name: /open guided setup/i })).toBeInTheDocument();
  });

  it('defaults to guided setup when onboarding state loading fails', async () => {
    vi.spyOn(chrome.storage.local, 'get').mockImplementation(
      async (keys: string | string[] | Record<string, unknown> | null | undefined) => {
        if (keys === 'onboarding') {
          throw new Error('storage unavailable');
        }

        if (typeof keys === 'string') {
        return {};
      }

      if (Array.isArray(keys)) {
          return Object.fromEntries(keys.map((key) => [key, undefined]));
        }

        if (!keys) {
          return {};
        }

        return { ...keys };
      },
    );

    renderApp();

    expect(screen.getByRole('button', { name: /summarize page/i })).toBeDisabled();

    expect(await screen.findByRole('button', { name: /open guided setup/i })).toBeInTheDocument();
  });

  it('unlocks quick actions when onboarding is already completed', async () => {
    renderApp();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /summarize page/i })).toBeEnabled();
    });

    expect(screen.queryByRole('button', { name: /open guided setup/i })).not.toBeInTheDocument();
  });

  it('reacts to onboarding storage changes while the popup stays open', async () => {
    renderApp();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /summarize page/i })).toBeEnabled();
    });

    await act(async () => {
      await seedStorage({
        onboarding: createDefaultOnboardingState(),
      });
      (
        chrome.storage.onChanged as typeof chrome.storage.onChanged & {
          dispatch: (
            changes: Record<string, chrome.storage.StorageChange>,
            areaName: string,
          ) => void;
        }
      ).dispatch(
        {
          onboarding: {
            oldValue: {
              version: 1,
              completed: true,
              lastStep: 3,
              completedAt: Date.UTC(2026, 2, 7, 10, 0),
            },
            newValue: createDefaultOnboardingState(),
          },
        },
        'local',
      );
    });

    expect(await screen.findByRole('button', { name: /open guided setup/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /summarize page/i })).toBeDisabled();
  });
});
