import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../ui/theme';
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

describe('Popup App (U-06 quick actions + page info)', () => {
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
    expect(within(pageCard).getByText('Ready to analyze')).toBeInTheDocument();
    expect(screen.getByText('Live tab context')).toBeInTheDocument();
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

  it('falls back gracefully when tab access fails', async () => {
    vi.spyOn(chrome.tabs, 'query').mockRejectedValueOnce(new Error('Permission denied'));

    renderApp();

    expect(await screen.findByText('Active tab unavailable')).toBeInTheDocument();
    expect(screen.getByText('Preview mode')).toBeInTheDocument();
    expect(
      screen.getByText('Quick actions stay available while the popup waits for tab access.'),
    ).toBeInTheDocument();
  });

  it('exposes the theme toggle and applies a persisted selection', async () => {
    const user = userEvent.setup();

    renderApp();

    const themeToggle = screen.getByRole('radiogroup', { name: 'Theme mode' });
    expect(within(themeToggle).getByRole('radio', { name: 'Use light theme' })).toBeInTheDocument();
    expect(within(themeToggle).getByRole('radio', { name: 'Use dark theme' })).toBeInTheDocument();
    expect(within(themeToggle).getByRole('radio', { name: 'Use system theme' })).toBeInTheDocument();

    await user.click(within(themeToggle).getByRole('radio', { name: 'Use dark theme' }));

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(localStorage.getItem('flux-agent-theme')).toBe('dark');
  });
});
