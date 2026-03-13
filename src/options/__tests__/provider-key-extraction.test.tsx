import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import { ThemeProvider } from '../../ui/theme';
import { getMockStore, readStorage, renderWithProviders, seedStorage } from '../../test/helpers';
import * as providerLoader from '../../core/ai-client/provider-loader';
import { installOptionsRuntimeMock } from './runtime-mock';

function renderOptionsApp() {
  return renderWithProviders(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
}

function expectNoRecoverableSecrets(container: HTMLElement, ...secrets: string[]): void {
  const snapshot = JSON.stringify(getMockStore());

  for (const secret of secrets) {
    expect(snapshot).not.toContain(secret);
    expect(container.textContent ?? '').not.toContain(secret);
  }
}

describe('Provider key extraction resistance', () => {
  beforeEach(async () => {
    installOptionsRuntimeMock();
    await seedStorage({
      onboarding: {
        version: 1,
        completed: true,
        lastStep: 3,
        completedAt: Date.UTC(2026, 2, 7, 10, 0),
      },
    });
  });

  it('keeps raw keys out of storage snapshots and UI after save', async () => {
    const user = userEvent.setup();
    const rawKey = 'sk-openrouter-extract-attempt-9876';
    const { container } = renderOptionsApp();

    await screen.findByRole('heading', { name: /configure providers and capability boundaries/i });
    await user.selectOptions(screen.getByLabelText('Provider'), 'openrouter');
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: rawKey } });
    await user.click(screen.getByRole('button', { name: /save provider/i }));

    expect(await screen.findByText(/credential was stored in the vault/i)).toBeInTheDocument();
    await expect(readStorage('providerKeyMetadata')).resolves.toEqual({
      openrouter: expect.objectContaining({
        maskedValue: '••••••••••••',
      }),
    });
    await expect(readStorage('providerSessionApiKeys', 'session')).resolves.toBeUndefined();
    expect(screen.getByLabelText('API key')).toHaveValue('');
    expect(screen.getByText(/vault credential/i)).toBeInTheDocument();
    expect(screen.getByText(/••••••••••••/i)).toBeInTheDocument();
    expectNoRecoverableSecrets(container, rawKey);
  });

  it('keeps raw keys out of storage snapshots and status text after a successful test', async () => {
    const user = userEvent.setup();
    const rawKey = 'sk-openai-validation-success-1234';
    const initialize = vi.fn().mockResolvedValue(undefined);
    const validateApiKey = vi.fn().mockResolvedValue(true);

    vi.spyOn(providerLoader, 'createProvider').mockResolvedValue({
      initialize,
      validateApiKey,
    } as Awaited<ReturnType<typeof providerLoader.createProvider>>);

    const { container } = renderOptionsApp();

    await screen.findByRole('heading', { name: /configure providers and capability boundaries/i });
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: rawKey } });
    await user.click(screen.getByRole('button', { name: /test connection/i }));

    expect(await screen.findByText(/openai responded successfully/i)).toBeInTheDocument();
    expect(validateApiKey).toHaveBeenCalledWith(rawKey);
    expect(screen.getByLabelText('API key')).toHaveValue('');
    await expect(readStorage('providerKeyMetadata')).resolves.toBeUndefined();
    await expect(readStorage('providerSessionApiKeys', 'session')).resolves.toBeUndefined();
    expectNoRecoverableSecrets(container, rawKey);
  });

  it('does not leave recoverable raw keys behind after a blocked save attempt', async () => {
    const user = userEvent.setup();
    const rawKey = 'sk-openai-blocked-save-4321';
    const { container } = renderOptionsApp();

    await screen.findByRole('heading', { name: /configure providers and capability boundaries/i });
    await user.clear(screen.getByLabelText('Base URL override'));
    await user.type(screen.getByLabelText('Base URL override'), 'http://example.com/v1');
    await user.type(screen.getByLabelText('API key'), rawKey);
    await user.click(screen.getByRole('button', { name: /save provider/i }));

    expect(
      await screen.findByText(/save blocked: remote provider endpoints must use https/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('API key')).toHaveValue('');
    await expect(readStorage('activeProvider')).resolves.toBeUndefined();
    await expect(readStorage('providerKeyMetadata')).resolves.toBeUndefined();
    await expect(readStorage('providerSessionApiKeys', 'session')).resolves.toBeUndefined();
    expectNoRecoverableSecrets(container, rawKey);
  });

  it('does not expose raw keys after an unexpected validation failure', async () => {
    const user = userEvent.setup();
    const rawKey = 'sk-openai-validation-failure-5555';
    const initialize = vi.fn().mockRejectedValue(new Error(`validation exploded for ${rawKey}`));

    vi.spyOn(providerLoader, 'createProvider').mockResolvedValue({
      initialize,
      validateApiKey: vi.fn(),
    } as Awaited<ReturnType<typeof providerLoader.createProvider>>);

    const { container } = renderOptionsApp();

    await screen.findByRole('heading', { name: /configure providers and capability boundaries/i });
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: rawKey } });
    await user.click(screen.getByRole('button', { name: /test connection/i }));

    expect(await screen.findByText(/connection test failed unexpectedly/i)).toBeInTheDocument();
    expect(screen.getByLabelText('API key')).toHaveValue('');
    await expect(readStorage('providerKeyMetadata')).resolves.toBeUndefined();
    await expect(readStorage('providerSessionApiKeys', 'session')).resolves.toBeUndefined();
    expectNoRecoverableSecrets(container, rawKey);
  });

  it('cleans legacy session key storage before stale raw keys can be recovered', async () => {
    const staleOpenAiKey = 'sk-stale-openai-session-1111';
    const staleClaudeKey = 'sk-stale-claude-session-2222';

    await seedStorage(
      {
        providerSessionApiKeys: {
          openai: staleOpenAiKey,
          claude: staleClaudeKey,
        },
      },
      'session',
    );
    await seedStorage({
      activeProvider: 'openai',
      providerKeyMetadata: {
        openai: {
          maskedValue: '••••••••••••',
          updatedAt: Date.UTC(2026, 2, 7, 9, 30),
        },
      },
      settings: {
        defaultProvider: 'openai',
      },
    });

    const { container } = renderOptionsApp();

    await screen.findByRole('heading', { name: /configure providers and capability boundaries/i });

    await waitFor(async () => {
      await expect(readStorage('providerSessionApiKeys', 'session')).resolves.toBeUndefined();
    });

    expect(screen.getByLabelText('API key')).toHaveValue('');
    expect(screen.getByText(/vault credential/i)).toBeInTheDocument();
    expect(screen.getByText(/••••••••••••/i)).toBeInTheDocument();
    expectNoRecoverableSecrets(container, staleOpenAiKey, staleClaudeKey);
  });

  it('retains only masked metadata across multiple provider transitions', async () => {
    const user = userEvent.setup();
    const openAiKey = 'sk-openai-transition-1000';
    const claudeKey = 'sk-claude-transition-2000';
    const { container } = renderOptionsApp();

    await screen.findByRole('heading', { name: /configure providers and capability boundaries/i });

    fireEvent.change(screen.getByLabelText('API key'), { target: { value: openAiKey } });
    await user.click(screen.getByRole('button', { name: /save provider/i }));
    expect(await screen.findByText(/credential was stored in the vault/i)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Provider'), 'claude');
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: claudeKey } });
    await user.click(screen.getByRole('button', { name: /save provider/i }));

    await expect(readStorage('providerKeyMetadata')).resolves.toEqual({
      openai: expect.objectContaining({ maskedValue: '••••••••••••' }),
      claude: expect.objectContaining({ maskedValue: '••••••••••••' }),
    });

    await user.selectOptions(screen.getByLabelText('Provider'), 'openai');
    expect(screen.getByText(/vault credential/i)).toBeInTheDocument();
    expect(screen.getByText(/••••••••••••/i)).toBeInTheDocument();
    expect(screen.getByLabelText('API key')).toHaveValue('');
    await expect(readStorage('providerSessionApiKeys', 'session')).resolves.toBeUndefined();
    expectNoRecoverableSecrets(container, openAiKey, claudeKey);
  });
});
