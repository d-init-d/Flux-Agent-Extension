import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import { renderWithProviders, readStorage, seedStorage } from '../../test/helpers';

describe('Options App', () => {
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

    renderWithProviders(<App />);

    expect(await screen.findByRole('heading', { name: /configure providers and capability boundaries/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Provider')).toHaveValue('claude');
    expect(screen.getByDisplayValue('claude-3-opus-20240229')).toBeInTheDocument();
    expect(screen.getByText(/saved key metadata/i)).toBeInTheDocument();
    expect(screen.getByText(/updated/i)).toBeInTheDocument();
    await expect(readStorage('providerSessionApiKeys', 'session')).resolves.toBeUndefined();
  });

  it('saves provider configuration and keeps only masked key metadata', async () => {
    const user = userEvent.setup();

    renderWithProviders(<App />);

    await screen.findByRole('heading', { name: /configure providers and capability boundaries/i });
    await user.selectOptions(screen.getByLabelText('Provider'), 'openrouter');

    const modelInput = screen.getByLabelText('Model');
    await user.clear(modelInput);
    await user.type(modelInput, 'anthropic/claude-3.7-sonnet');

    const apiKeyInput = screen.getByLabelText('API key');
    await user.type(apiKeyInput, 'sk-test-openrouter-1234');

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
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderWithProviders(<App />);

    await screen.findByRole('heading', { name: /configure providers and capability boundaries/i });
    await user.type(screen.getByLabelText('API key'), 'sk-openai-test');
    await user.click(screen.getByRole('button', { name: /test connection/i }));

    expect(await screen.findByText(/openai responded successfully/i)).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalled();
    expect(screen.getByLabelText('API key')).toHaveValue('');
  });

  it('blocks insecure endpoint validation for custom providers', async () => {
    const user = userEvent.setup();

    renderWithProviders(<App />);

    await screen.findByRole('heading', { name: /configure providers and capability boundaries/i });
    await user.selectOptions(screen.getByLabelText('Provider'), 'custom');
    await user.clear(screen.getByLabelText('Provider endpoint'));
    await user.type(screen.getByLabelText('Provider endpoint'), 'http://example.com/v1');
    await user.click(screen.getByRole('button', { name: /test connection/i }));

    expect(await screen.findByText(/use a valid https:\/\//i)).toBeInTheDocument();
  });

  it('blocks saving insecure custom endpoints', async () => {
    const user = userEvent.setup();

    renderWithProviders(<App />);

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

    renderWithProviders(<App />);

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

    renderWithProviders(<App />);

    expect(await screen.findByRole('heading', { name: /permission toggles/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /share screenshots with ai/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: /capture screenshots on failures/i })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: /allow custom scripts/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: /show floating bar/i })).toHaveAttribute('aria-checked', 'false');
  });

  it('saves permission toggles to extension settings', async () => {
    const user = userEvent.setup();

    renderWithProviders(<App />);

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

    renderWithProviders(<App />);

    await screen.findByRole('heading', { name: /permission toggles/i });
    await user.click(screen.getByText(/share screenshots with ai/i));

    expect(screen.getByRole('switch', { name: /share screenshots with ai/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('supports keyboard toggling from the permission card control', async () => {
    const user = userEvent.setup();

    renderWithProviders(<App />);

    await screen.findByRole('heading', { name: /permission toggles/i });

    const cardButton = screen.getByRole('button', { name: /share screenshots with ai context/i });
    cardButton.focus();
    await user.keyboard('{Enter}');

    expect(screen.getByRole('switch', { name: /share screenshots with ai/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('blocks saving custom scripts until the warning is acknowledged', async () => {
    const user = userEvent.setup();

    renderWithProviders(<App />);

    await screen.findByRole('heading', { name: /permission toggles/i });
    await user.click(screen.getByRole('switch', { name: /allow custom scripts/i }));
    await user.click(screen.getByRole('button', { name: /save permissions/i }));

    expect(await screen.findByText(/acknowledge the custom script warning/i)).toBeInTheDocument();
    await expect(readStorage('settings')).resolves.toBeUndefined();
  });

  it('does not persist unsaved permission toggles when saving provider settings', async () => {
    const user = userEvent.setup();

    renderWithProviders(<App />);

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

    renderWithProviders(<App />);

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
});
