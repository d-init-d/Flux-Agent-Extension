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

  it('uses roving tab index and arrow keys to move between theme choices', async () => {
    const user = userEvent.setup();

    render(
      <ThemeProvider defaultMode="system">
        <ThemeToggle />
      </ThemeProvider>,
    );

    const lightRadio = screen.getByRole('radio', { name: 'Use light theme' });
    const darkRadio = screen.getByRole('radio', { name: 'Use dark theme' });
    const systemRadio = screen.getByRole('radio', { name: 'Use system theme' });

    expect(lightRadio).toHaveAttribute('tabindex', '-1');
    expect(darkRadio).toHaveAttribute('tabindex', '-1');
    expect(systemRadio).toHaveAttribute('tabindex', '0');

    systemRadio.focus();
    await user.keyboard('{ArrowRight}');

    expect(lightRadio).toHaveFocus();
    expect(lightRadio).toHaveAttribute('aria-checked', 'true');
    expect(lightRadio).toHaveAttribute('tabindex', '0');
    expect(systemRadio).toHaveAttribute('tabindex', '-1');
    expect(localStorage.getItem('flux-agent-theme')).toBe('light');

    await user.keyboard('{ArrowLeft}');

    expect(systemRadio).toHaveFocus();
    expect(systemRadio).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem('flux-agent-theme')).toBe('system');
  });

  it('can change the preview without persisting immediately', async () => {
    const user = userEvent.setup();

    render(
      <ThemeProvider defaultMode="light">
        <ThemeToggle persistOnSelect={false} />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole('radio', { name: 'Use dark theme' }));

    expect(screen.getByRole('radio', { name: 'Use dark theme' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(localStorage.getItem('flux-agent-theme')).toBeNull();
  });

  it('navigates using ArrowDown and ArrowUp keys', async () => {
    const user = userEvent.setup();

    render(
      <ThemeProvider defaultMode="light">
        <ThemeToggle />
      </ThemeProvider>,
    );

    const lightRadio = screen.getByRole('radio', { name: 'Use light theme' });
    const darkRadio = screen.getByRole('radio', { name: 'Use dark theme' });

    lightRadio.focus();
    await user.keyboard('{ArrowDown}');

    expect(darkRadio).toHaveFocus();
    expect(darkRadio).toHaveAttribute('aria-checked', 'true');

    await user.keyboard('{ArrowUp}');

    expect(lightRadio).toHaveFocus();
    expect(lightRadio).toHaveAttribute('aria-checked', 'true');
  });

  it('ignores non-arrow key presses', async () => {
    const user = userEvent.setup();

    render(
      <ThemeProvider defaultMode="light">
        <ThemeToggle />
      </ThemeProvider>,
    );

    const lightRadio = screen.getByRole('radio', { name: 'Use light theme' });
    lightRadio.focus();
    await user.keyboard('x');

    expect(lightRadio).toHaveAttribute('aria-checked', 'true');
  });

  it('wraps around from last to first with ArrowRight', async () => {
    const user = userEvent.setup();

    render(
      <ThemeProvider defaultMode="system">
        <ThemeToggle />
      </ThemeProvider>,
    );

    const systemRadio = screen.getByRole('radio', { name: 'Use system theme' });
    const lightRadio = screen.getByRole('radio', { name: 'Use light theme' });

    systemRadio.focus();
    await user.keyboard('{ArrowRight}');

    expect(lightRadio).toHaveFocus();
    expect(lightRadio).toHaveAttribute('aria-checked', 'true');
  });

  it('calls onModeChange callback when provided', async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();

    render(
      <ThemeProvider defaultMode="light">
        <ThemeToggle onModeChange={onModeChange} />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole('radio', { name: 'Use dark theme' }));
    expect(onModeChange).toHaveBeenCalledWith('dark');
  });
});
