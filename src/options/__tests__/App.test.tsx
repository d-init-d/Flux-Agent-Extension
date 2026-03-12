import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createDefaultOnboardingState } from '../../shared/storage/onboarding';
import { App } from '../App';
import { renderWithProviders, readStorage, seedStorage } from '../../test/helpers';
import { ThemeProvider } from '../../ui/theme';
import * as providerLoader from '../../core/ai-client/provider-loader';
import type { IAIProvider } from '../../core/ai-client/interfaces';

function renderOptionsApp() {
  return renderWithProviders(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
}

function mockSuccessfulProviderValidation() {
  const initialize = vi.fn().mockResolvedValue(undefined);
  const validateApiKey = vi.fn().mockResolvedValue(true);
  const provider: IAIProvider = {
    name: 'openai',
    supportsVision: true,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    initialize,
    validateApiKey,
    chat: async function* () {
      return;
    },
    abort: vi.fn(),
  };
  const createProviderSpy = vi.spyOn(providerLoader, 'createProvider').mockResolvedValue(provider);

  return {
    createProviderSpy,
    initialize,
    validateApiKey,
  };
}

function mockPendingProviderValidation() {
  const initialize = vi.fn().mockResolvedValue(undefined);
  let resolveValidation: ((value: boolean) => void) | undefined;
  const validateApiKey = vi.fn().mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        resolveValidation = resolve;
      }),
  );
  const provider: IAIProvider = {
    name: 'openai',
    supportsVision: true,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    initialize,
    validateApiKey,
    chat: async function* () {
      return;
    },
    abort: vi.fn(),
  };

  vi.spyOn(providerLoader, 'createProvider').mockResolvedValue(provider);

  return {
    initialize,
    validateApiKey,
    resolveValidation: () => resolveValidation?.(true),
  };
}

describe('Options App', () => {
  beforeEach(async () => {
    await seedStorage({
      onboarding: {
        version: 1,
        completed: true,
        lastStep: 3,
        completedAt: Date.UTC(2026, 2, 7, 10, 0),
      },
    });
  });

  it('loads stored provider settings and masked key metadata', async () => {
    await seedStorage({
      activeProvider: 'claude',
      providers: {
        claude: {
          enabled: true,
          model: 'claude-3-opus-20240229',
          maxTokens: 4096,
          temperature: 0.2,
        },
      },
      providerKeyMetadata: {
        claude: {
          maskedValue: 'sk-aaaa••••bbbb',
          updatedAt: Date.UTC(2026, 2, 7, 9, 30),
        },
      },
      settings: {
        defaultProvider: 'claude',
      },
    });
    await seedStorage(
      {
        providerSessionApiKeys: {
          claude: 'sk-live-claude',
        },
      },
      'session',
    );

    renderOptionsApp();

    expect(await screen.findByRole('heading', { name: /configure providers and capability boundaries/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Provider')).toHaveValue('claude');
    expect(screen.getByDisplayValue('claude-3-opus-20240229')).toBeInTheDocument();
    expect(screen.getByText(/saved key metadata/i)).toBeInTheDocument();
    expect(screen.getByText(/updated/i)).toBeInTheDocument();
    await expect(readStorage('providerSessionApiKeys', 'session')).resolves.toBeUndefined();
  });

  it('saves provider configuration and keeps only masked key metadata', async () => {
    const user = userEvent.setup();

    renderOptionsApp();

    await screen.findByRole('heading', { name: /configure providers and capability boundaries/i });
    await user.selectOptions(screen.getByLabelText('Provider'), 'openrouter');

    const modelInput = screen.getByLabelText('Model');
    fireEvent.change(modelInput, { target: { value: 'anthropic/claude-3.7-sonnet' } });

    const apiKeyInput = screen.getByLabelText('API key');
    fireEvent.change(apiKeyInput, { target: { value: 'sk-test-openrouter-1234' } });

    await user.click(screen.getByRole('button', { name: /save provider/i }));

    await waitFor(async () => {
      await expect(readStorage('activeProvider')).resolves.toBe('openrouter');
    });

    await expect(readStorage('providerKeyMetadata')).resolves.toEqual({
      openrouter: expect.objectContaining({
        maskedValue: '••••••••••••',
      }),
    });

    await expect(readStorage('providerSessionApiKeys', 'session')).resolves.toBeUndefined();

    expect(await screen.findByText(/provider settings saved/i)).toBeInTheDocument();
    expect(screen.getByLabelText('API key')).toHaveValue('');
  });

  it('validates the selected provider connection', async () => {
    const user = userEvent.setup();
    const initialize = vi.fn().mockResolvedValue(undefined);
    const validateApiKey = vi.fn().mockResolvedValue(true);
    const provider: IAIProvider = {
      name: 'openai',
      supportsVision: true,
      supportsStreaming: true,
      supportsFunctionCalling: true,
      initialize,
      validateApiKey,
      chat: async function* () {
        return;
      },
      abort: vi.fn(),
    };
    const createProviderSpy = vi.spyOn(providerLoader, 'createProvider').mockResolvedValue(provider);

    renderOptionsApp();

    await screen.findByRole('heading', { name: /configure providers and capability boundaries/i });
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-openai-test' } });
    await user.click(screen.getByRole('button', { name: /test connection/i }));

    expect(await screen.findByText(/openai responded successfully/i)).toBeInTheDocument();
    expect(createProviderSpy).toHaveBeenCalledWith('openai');
    expect(initialize).toHaveBeenCalledOnce();
    expect(validateApiKey).toHaveBeenCalledWith('sk-openai-test');
    expect(screen.getByLabelText('API key')).toHaveValue('');
  });

  it('validates Gemini without putting the raw key in the request URL', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ models: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderOptionsApp();

    await screen.findByRole('heading', { name: /configure providers and capability boundaries/i });
    await user.selectOptions(screen.getByLabelText('Provider'), 'gemini');
    await user.type(screen.getByLabelText('API key'), 'gemini-secret-key');
    await user.click(screen.getByRole('button', { name: /test connection/i }));

    expect(await screen.findByText(/gemini responded successfully/i)).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ 'x-goog-api-key': 'gemini-secret-key' }),
      }),
    );
    expect(fetchSpy.mock.calls[0]?.[0]).not.toContain('gemini-secret-key');
    expect(screen.getByLabelText('API key')).toHaveValue('');
  });

  it('clears raw API key input after a blocked test connection attempt', async () => {
    const user = userEvent.setup();

    renderOptionsApp();

    await screen.findByRole('heading', { name: /configure providers and capability boundaries/i });
    await user.clear(screen.getByLabelText('Base URL override'));
    await user.type(screen.getByLabelText('Base URL override'), 'http://example.com/v1');

    const apiKeyInput = screen.getByLabelText('API key');
    await user.type(apiKeyInput, 'sk-openai-should-clear');
    await user.click(screen.getByRole('button', { name: /test connection/i }));

    expect(await screen.findByText(/use a valid https:\/\//i)).toBeInTheDocument();
    expect(apiKeyInput).toHaveValue('');
  });

  it('clears raw API key input on pagehide', async () => {
    const user = userEvent.setup();
    renderOptionsApp();

    await screen.findByRole('heading', { name: /configure providers and capability boundaries/i });

    const apiKeyInput = screen.getByLabelText('API key');
    await user.type(apiKeyInput, 'sk-ephemeral-secret');
    expect(apiKeyInput).toHaveValue('sk-ephemeral-secret');

    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    expect(apiKeyInput).toHaveValue('');
  });

  it('clears raw API key input after a blocked save attempt', async () => {
    const user = userEvent.setup();

    renderOptionsApp();

    await screen.findByRole('heading', { name: /configure providers and capability boundaries/i });
    await user.selectOptions(screen.getByLabelText('Provider'), 'openai');

    const endpointInput = screen.getByLabelText('Base URL override');
    await user.clear(endpointInput);
    await user.type(endpointInput, 'http://example.com/v1');

    const apiKeyInput = screen.getByLabelText('API key');
    await user.type(apiKeyInput, 'sk-should-clear');
    await user.click(screen.getByRole('button', { name: /save provider/i }));

    expect(await screen.findByText(/save blocked: remote provider endpoints must use https/i)).toBeInTheDocument();
    expect(apiKeyInput).toHaveValue('');
  });

  it('blocks insecure endpoint validation for custom providers', async () => {
    const user = userEvent.setup();

    renderOptionsApp();

    await screen.findByRole('heading', { name: /configure providers and capability boundaries/i });
    await user.selectOptions(screen.getByLabelText('Provider'), 'custom');
    await user.clear(screen.getByLabelText('Provider endpoint'));
    await user.type(screen.getByLabelText('Provider endpoint'), 'http://example.com/v1');
    await user.click(screen.getByRole('button', { name: /test connection/i }));

    expect(await screen.findByText(/use a valid https:\/\//i)).toBeInTheDocument();
  });

  it('blocks saving insecure custom endpoints', async () => {
    const user = userEvent.setup();

    renderOptionsApp();

    await screen.findByRole('heading', { name: /configure providers and capability boundaries/i });
    await user.selectOptions(screen.getByLabelText('Provider'), 'custom');
    await user.clear(screen.getByLabelText('Provider endpoint'));
    await user.type(screen.getByLabelText('Provider endpoint'), 'http://example.com/v1');
    await user.click(screen.getByRole('button', { name: /save provider/i }));

    expect(await screen.findByText(/save blocked: remote provider endpoints must use https/i)).toBeInTheDocument();
    await expect(readStorage('activeProvider')).resolves.toBeUndefined();
  });

  it('keeps legacy insecure endpoints blocked after load', async () => {
    const user = userEvent.setup();

    await seedStorage({
      activeProvider: 'custom',
      providers: {
        custom: {
          enabled: true,
          model: 'custom-model',
          maxTokens: 4096,
          temperature: 0.3,
          customEndpoint: 'http://legacy.example.com/v1',
        },
      },
      settings: {
        defaultProvider: 'custom',
      },
    });

    renderOptionsApp();

    expect(await screen.findByDisplayValue('http://legacy.example.com/v1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /test connection/i }));

    expect(await screen.findByText(/use a valid https:\/\//i)).toBeInTheDocument();
  });

  it('loads saved permission toggle states', async () => {
    await seedStorage({
      settings: {
        defaultProvider: 'openai',
        includeScreenshotsInContext: true,
        screenshotOnError: false,
        allowCustomScripts: true,
        showFloatingBar: false,
        highlightElements: true,
        soundNotifications: true,
      },
    });

    renderOptionsApp();

    expect(await screen.findByRole('heading', { name: /permission toggles/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /share screenshots with ai/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: /capture screenshots on failures/i })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: /allow custom scripts/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: /show floating bar/i })).toHaveAttribute('aria-checked', 'false');
  });

  it('saves permission toggles to extension settings', async () => {
    const user = userEvent.setup();

    renderOptionsApp();

    await screen.findByRole('heading', { name: /permission toggles/i });

    await user.click(screen.getByRole('switch', { name: /share screenshots with ai/i }));
    await user.click(screen.getByRole('switch', { name: /allow custom scripts/i }));
    await user.click(screen.getByRole('checkbox', { name: /i understand the risk/i }));
    await user.click(screen.getByRole('switch', { name: /show floating bar/i }));
    await user.click(screen.getByRole('button', { name: /save permissions/i }));

    await waitFor(async () => {
      await expect(readStorage('settings')).resolves.toEqual(
        expect.objectContaining({
          includeScreenshotsInContext: true,
          allowCustomScripts: true,
          showFloatingBar: false,
          highlightElements: true,
          defaultProvider: 'openai',
        }),
      );
    });

    expect(await screen.findByText(/permission toggles saved/i)).toBeInTheDocument();
  });

  it('toggles a permission when the card body is clicked', async () => {
    const user = userEvent.setup();

    renderOptionsApp();

    await screen.findByRole('heading', { name: /permission toggles/i });
    await user.click(screen.getByText(/share screenshots with ai/i));

    expect(screen.getByRole('switch', { name: /share screenshots with ai/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('exposes a single keyboard focus stop for each permission toggle', async () => {
    renderOptionsApp();

    await screen.findByRole('heading', { name: /permission toggles/i });

    const screenshotToggle = screen.getByRole('switch', { name: /share screenshots with ai/i });
    expect(screen.queryByRole('button', { name: /share screenshots with ai context/i })).not.toBeInTheDocument();
    expect(screenshotToggle).toHaveAccessibleDescription(/attach page captures as additional context/i);
  });

  it('loads appearance settings from stored preferences', async () => {
    await seedStorage({
      settings: {
        defaultProvider: 'openai',
        theme: 'dark',
        language: 'vi',
      },
    });

    renderOptionsApp();

    await screen.findByRole('heading', { name: /appearance settings/i });
    expect(screen.getByLabelText('Language')).toHaveValue('vi');
    expect(screen.getByRole('radio', { name: /use dark theme/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('saves appearance settings to extension settings', async () => {
    const user = userEvent.setup();

    renderOptionsApp();

    await screen.findByRole('heading', { name: /appearance settings/i });
    await user.click(screen.getByRole('radio', { name: /use dark theme/i }));
    await user.selectOptions(screen.getByLabelText('Language'), 'vi');
    expect(localStorage.getItem('flux-agent-theme')).toBe('system');
    await user.click(screen.getByRole('button', { name: /save appearance/i }));

    await waitFor(async () => {
      await expect(readStorage('settings')).resolves.toEqual(
        expect.objectContaining({
          theme: 'dark',
          language: 'vi',
          defaultProvider: 'openai',
        }),
      );
    });

    expect(await screen.findByText(/appearance settings saved/i)).toBeInTheDocument();
  });

  it('does not persist unsaved appearance changes when saving permissions', async () => {
    const user = userEvent.setup();

    renderOptionsApp();

    await screen.findByRole('heading', { name: /appearance settings/i });
    await user.click(screen.getByRole('radio', { name: /use dark theme/i }));
    await user.selectOptions(screen.getByLabelText('Language'), 'vi');
    await user.click(screen.getByRole('switch', { name: /share screenshots with ai/i }));
    await user.click(screen.getByRole('button', { name: /save permissions/i }));

    await waitFor(async () => {
      await expect(readStorage('settings')).resolves.toEqual(
        expect.objectContaining({
          theme: 'system',
          language: 'auto',
          includeScreenshotsInContext: true,
        }),
      );
    });
  });

  it('does not persist unsaved provider changes when saving appearance settings', async () => {
    const user = userEvent.setup();

    renderOptionsApp();

    await screen.findByRole('heading', { name: /configure providers and capability boundaries/i });
    await user.selectOptions(screen.getByLabelText('Provider'), 'openrouter');
    await user.click(screen.getByRole('radio', { name: /use dark theme/i }));
    await user.selectOptions(screen.getByLabelText('Language'), 'vi');
    await user.click(screen.getByRole('button', { name: /save appearance/i }));

    await waitFor(async () => {
      await expect(readStorage('settings')).resolves.toEqual(
        expect.objectContaining({
          defaultProvider: 'openai',
          theme: 'dark',
          language: 'vi',
        }),
      );
    });

    await expect(readStorage('activeProvider')).resolves.toBeUndefined();
  });

  it('does not persist unsaved permission changes when saving appearance settings', async () => {
    const user = userEvent.setup();

    renderOptionsApp();

    await screen.findByRole('heading', { name: /appearance settings/i });
    await user.click(screen.getByRole('switch', { name: /share screenshots with ai/i }));
    await user.click(screen.getByRole('radio', { name: /use dark theme/i }));
    await user.selectOptions(screen.getByLabelText('Language'), 'vi');
    await user.click(screen.getByRole('button', { name: /save appearance/i }));

    await waitFor(async () => {
      await expect(readStorage('settings')).resolves.toEqual(
        expect.objectContaining({
          includeScreenshotsInContext: false,
          theme: 'dark',
          language: 'vi',
        }),
      );
    });
  });

  it('supports keyboard toggling from the permission switch', async () => {
    const user = userEvent.setup();

    renderOptionsApp();

    await screen.findByRole('heading', { name: /permission toggles/i });

    const permissionSwitch = screen.getByRole('switch', { name: /share screenshots with ai/i });
    permissionSwitch.focus();
    await user.keyboard('{Enter}');

    expect(screen.getByRole('switch', { name: /share screenshots with ai/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('blocks saving custom scripts until the warning is acknowledged', async () => {
    const user = userEvent.setup();

    renderOptionsApp();

    await screen.findByRole('heading', { name: /permission toggles/i });
    await user.click(screen.getByRole('switch', { name: /allow custom scripts/i }));
    await user.click(screen.getByRole('button', { name: /save permissions/i }));

    expect(await screen.findByText(/acknowledge the custom script warning/i)).toBeInTheDocument();
    await expect(readStorage('settings')).resolves.toBeUndefined();
  });

  it('does not persist unsaved permission toggles when saving provider settings', async () => {
    const user = userEvent.setup();

    renderOptionsApp();

    await screen.findByRole('heading', { name: /configure providers and capability boundaries/i });
    await user.click(screen.getByRole('switch', { name: /share screenshots with ai/i }));
    await user.selectOptions(screen.getByLabelText('Provider'), 'openrouter');
    await user.type(screen.getByLabelText('API key'), 'sk-test-openrouter-1234');
    await user.click(screen.getByRole('button', { name: /save provider/i }));

    await waitFor(async () => {
      await expect(readStorage('settings')).resolves.toEqual(
        expect.objectContaining({
          defaultProvider: 'openrouter',
          includeScreenshotsInContext: false,
        }),
      );
    });
  });

  it('does not persist unsaved provider changes when saving permissions', async () => {
    const user = userEvent.setup();

    renderOptionsApp();

    await screen.findByRole('heading', { name: /configure providers and capability boundaries/i });
    await user.selectOptions(screen.getByLabelText('Provider'), 'openrouter');
    await user.click(screen.getByRole('switch', { name: /share screenshots with ai/i }));
    await user.click(screen.getByRole('button', { name: /save permissions/i }));

    await waitFor(async () => {
      await expect(readStorage('settings')).resolves.toEqual(
        expect.objectContaining({
          defaultProvider: 'openai',
          includeScreenshotsInContext: true,
        }),
      );
    });

    await expect(readStorage('activeProvider')).resolves.toBeUndefined();
  });

  it('shows the onboarding gate when setup is incomplete and supports resuming after skip', async () => {
    const user = userEvent.setup();

    await seedStorage({
      onboarding: createDefaultOnboardingState(),
    });

    renderOptionsApp();

    expect(await screen.findByTestId('onboarding-root')).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-step-welcome')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /skip for now/i }));

    expect(await screen.findByRole('heading', { name: /configure providers and capability boundaries/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /resume onboarding/i }));

    expect(await screen.findByTestId('onboarding-root')).toBeInTheDocument();
  });

  it('restores the saved onboarding step on first load', async () => {
    await seedStorage({
      onboarding: {
        version: 1,
        completed: false,
        lastStep: 2,
        providerReady: false,
      },
    });

    renderOptionsApp();

    expect(await screen.findByTestId('onboarding-step-permissions')).toBeInTheDocument();
  });

  it('resumes onboarding from the persisted step after skip', async () => {
    const user = userEvent.setup();

    await seedStorage({
      onboarding: {
        version: 1,
        completed: false,
        lastStep: 2,
        providerReady: false,
      },
    });

    renderOptionsApp();

    expect(await screen.findByTestId('onboarding-step-permissions')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /skip for now/i }));
    expect(await screen.findByRole('heading', { name: /configure providers and capability boundaries/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /resume onboarding/i }));

    expect(await screen.findByTestId('onboarding-step-permissions')).toBeInTheDocument();
  });

  it('persists onboarding completion and returns to the dashboard', async () => {
    const user = userEvent.setup();
    const { createProviderSpy, initialize, validateApiKey } = mockSuccessfulProviderValidation();

    await seedStorage({
      onboarding: createDefaultOnboardingState(),
    });

    renderOptionsApp();

    expect(await screen.findByTestId('onboarding-root')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(await screen.findByTestId('onboarding-step-connect')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(await screen.findByTestId('onboarding-step-permissions')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(await screen.findByTestId('onboarding-step-ready')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: /finish setup/i })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /back/i }));
    expect(await screen.findByTestId('onboarding-step-permissions')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /back/i }));
    expect(await screen.findByTestId('onboarding-step-connect')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-openai-test' } });
    await user.click(screen.getByRole('button', { name: /save provider/i }));
    expect(await screen.findByText(/provider settings saved/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-openai-test' } });
    await user.click(screen.getByRole('button', { name: /test connection/i }));
    expect(await screen.findByText(/openai responded successfully/i)).toBeInTheDocument();
    expect(createProviderSpy).toHaveBeenCalledWith('openai');
    expect(initialize).toHaveBeenCalledOnce();
    expect(validateApiKey).toHaveBeenCalledWith('sk-openai-test');

    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(await screen.findByTestId('onboarding-step-permissions')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(await screen.findByTestId('onboarding-step-ready')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /finish setup/i })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: /finish setup/i }));

    await waitFor(async () => {
      await expect(readStorage('onboarding')).resolves.toEqual(
        expect.objectContaining({
          version: 1,
          completed: true,
          lastStep: 3,
          completedAt: expect.any(Number),
        }),
      );
    });

    expect(await screen.findByRole('heading', { name: /configure providers and capability boundaries/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /restart onboarding/i })).toBeInTheDocument();
  });

  it('keeps onboarding completion locked when a key-based provider is only saved without validation', async () => {
    const user = userEvent.setup();

    await seedStorage({
      onboarding: createDefaultOnboardingState(),
    });

    renderOptionsApp();

    expect(await screen.findByTestId('onboarding-root')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(await screen.findByTestId('onboarding-step-connect')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /save provider/i }));
    expect(await screen.findByText(/provider settings saved/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(await screen.findByTestId('onboarding-step-ready')).toBeInTheDocument();
    expect(screen.getByText(/almost ready for the full flux workspace/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /finish setup/i })).toBeDisabled();
  });

  it('keeps onboarding completion locked when a key-based provider is only validated without saving', async () => {
    const user = userEvent.setup();
    const { createProviderSpy, initialize, validateApiKey } = mockSuccessfulProviderValidation();

    await seedStorage({
      onboarding: createDefaultOnboardingState(),
    });

    renderOptionsApp();

    expect(await screen.findByTestId('onboarding-root')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(await screen.findByTestId('onboarding-step-connect')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-openai-test' } });
    await user.click(screen.getByRole('button', { name: /test connection/i }));
    expect(await screen.findByText(/openai responded successfully/i)).toBeInTheDocument();
    expect(createProviderSpy).toHaveBeenCalledWith('openai');
    expect(initialize).toHaveBeenCalledOnce();
    expect(validateApiKey).toHaveBeenCalledWith('sk-openai-test');

    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(await screen.findByTestId('onboarding-step-ready')).toBeInTheDocument();
    expect(screen.getByText(/almost ready for the full flux workspace/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /finish setup/i })).toBeDisabled();
  });

  it('locks onboarding navigation while provider validation is in progress', async () => {
    const user = userEvent.setup();
    const { initialize, validateApiKey, resolveValidation } = mockPendingProviderValidation();

    await seedStorage({
      onboarding: createDefaultOnboardingState(),
    });

    renderOptionsApp();

    expect(await screen.findByTestId('onboarding-root')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(await screen.findByTestId('onboarding-step-connect')).toBeInTheDocument();

    await user.type(screen.getByLabelText('API key'), 'sk-openai-test');
    await user.click(screen.getByRole('button', { name: /test connection/i }));

    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /back/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /skip for now/i })).toBeDisabled();
    expect(initialize).toHaveBeenCalledOnce();
    expect(validateApiKey).toHaveBeenCalledWith('sk-openai-test');

    resolveValidation();

    expect(await screen.findByText(/openai responded successfully/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
  });

  it('re-locks onboarding when a validated provider config is edited', async () => {
    const user = userEvent.setup();

    await seedStorage({
      onboarding: {
        version: 1,
        completed: false,
        lastStep: 3,
        providerReady: true,
        configuredProvider: 'openai',
        validatedProvider: 'openai',
      },
      providerKeyMetadata: {
        openai: {
          maskedValue: '••••••••••••',
          updatedAt: Date.UTC(2026, 2, 7, 12, 0),
        },
      },
    });

    renderOptionsApp();

    expect(await screen.findByTestId('onboarding-step-ready')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /finish setup/i })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: /back/i }));
    await user.click(screen.getByRole('button', { name: /back/i }));
    expect(await screen.findByTestId('onboarding-step-connect')).toBeInTheDocument();

    const modelInput = screen.getByLabelText('Model');
    await user.clear(modelInput);
    await user.type(modelInput, 'gpt-4.1-mini');

    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByTestId('onboarding-step-ready')).toBeInTheDocument();
    expect(screen.getByText(/almost ready for the full flux workspace/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /finish setup/i })).toBeDisabled();
    await expect(readStorage('onboarding')).resolves.toEqual(
      expect.objectContaining({
        completed: false,
        configuredProvider: undefined,
        validatedProvider: undefined,
      }),
    );
  });

  it('does not unlock onboarding when switching to a different key-based provider with stale saved metadata', async () => {
    const user = userEvent.setup();

    await seedStorage({
      onboarding: {
        version: 1,
        completed: false,
        lastStep: 3,
        providerReady: true,
        configuredProvider: 'openai',
        validatedProvider: 'openai',
      },
      providerKeyMetadata: {
        claude: {
          maskedValue: '••••••••••••',
          updatedAt: Date.UTC(2026, 2, 7, 12, 0),
        },
      },
    });

    renderOptionsApp();

    expect(await screen.findByTestId('onboarding-step-ready')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /finish setup/i })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: /back/i }));
    await user.click(screen.getByRole('button', { name: /back/i }));
    expect(await screen.findByTestId('onboarding-step-connect')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Provider'), 'claude');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByTestId('onboarding-step-ready')).toBeInTheDocument();
    expect(screen.getByText(/almost ready for the full flux workspace/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /finish setup/i })).toBeDisabled();
  });

  it('keeps onboarding completion locked for legacy invalid custom endpoint state', async () => {
    await seedStorage({
      activeProvider: 'custom',
      providers: {
        custom: {
          enabled: true,
          model: 'custom-model',
          maxTokens: 4096,
          temperature: 0.3,
          customEndpoint: 'http://legacy.example.com/v1',
        },
      },
      settings: {
        defaultProvider: 'custom',
      },
      onboarding: {
        version: 1,
        completed: false,
        lastStep: 3,
        configuredProvider: 'custom',
      },
    });

    renderOptionsApp();

    expect(await screen.findByTestId('onboarding-step-ready')).toBeInTheDocument();
    expect(screen.getByText(/almost ready for the full flux workspace/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /finish setup/i })).toBeDisabled();
  });
});
