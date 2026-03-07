import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, beforeEach } from 'vitest';
import { ThemeProvider } from '../ThemeProvider';
import { ThemeToggle } from '../ThemeToggle';

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('renders light, dark, and system choices as an accessible radio group', () => {
    render(
      <ThemeProvider defaultMode="system">
        <ThemeToggle />
      </ThemeProvider>,
    );

    expect(screen.getByRole('radiogroup', { name: 'Theme mode' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Use light theme' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('radio', { name: 'Use dark theme' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('radio', { name: 'Use system theme' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('switches mode and persists the selected theme', async () => {
    const user = userEvent.setup();

    render(
      <ThemeProvider defaultMode="light">
        <ThemeToggle />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole('radio', { name: 'Use dark theme' }));

    expect(screen.getByRole('radio', { name: 'Use dark theme' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(localStorage.getItem('flux-agent-theme')).toBe('dark');

    await user.click(screen.getByRole('radio', { name: 'Use system theme' }));

    expect(screen.getByRole('radio', { name: 'Use system theme' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(localStorage.getItem('flux-agent-theme')).toBe('system');
  });
});
