import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, useTheme } from '../ThemeProvider';

// ---------------------------------------------------------------------------
// Test consumer component that exposes theme context values
// ---------------------------------------------------------------------------

function ThemeConsumer() {
  const { mode, resolvedTheme, setMode, toggle } = useTheme();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <button onClick={() => setMode('light')}>Set Light</button>
      <button onClick={() => setMode('dark')}>Set Dark</button>
      <button onClick={() => setMode('system')}>Set System</button>
      <button onClick={toggle}>Toggle</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// matchMedia mock helper
// ---------------------------------------------------------------------------

function mockMatchMedia(prefersDark: boolean) {
  const listeners: Array<(e: MediaQueryListEvent) => void> = [];

  const mql = {
    matches: prefersDark,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn((_event: string, handler: (e: MediaQueryListEvent) => void) => {
      listeners.push(handler);
    }),
    removeEventListener: vi.fn((_event: string, handler: (e: MediaQueryListEvent) => void) => {
      const idx = listeners.indexOf(handler);
      if (idx >= 0) listeners.splice(idx, 1);
    }),
    dispatchEvent: vi.fn(),
  };

  const matchMediaMock = vi.fn().mockReturnValue(mql);
  vi.stubGlobal('matchMedia', matchMediaMock);

  return {
    mql,
    listeners,
    simulateChange(dark: boolean) {
      Object.defineProperty(mql, 'matches', { value: dark, configurable: true, writable: true });
      for (const l of [...listeners]) {
        l({ matches: dark } as MediaQueryListEvent);
      }
    },
  };
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    // Default: system prefers light
    mockMatchMedia(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------------
  // Basic rendering
  // -------------------------------------------------------------------------

  it('renders children', () => {
    render(
      <ThemeProvider>
        <span>Hello</span>
      </ThemeProvider>,
    );
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Default mode
  // -------------------------------------------------------------------------

  it('defaults to "system" mode when no defaultMode and no localStorage', () => {
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('system');
  });

  it('uses defaultMode when provided', () => {
    render(
      <ThemeProvider defaultMode="dark">
        <ThemeConsumer />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
  });

  it('reads persisted mode from localStorage', () => {
    localStorage.setItem('flux-agent-theme', 'dark');
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
  });

  // -------------------------------------------------------------------------
  // System mode resolution
  // -------------------------------------------------------------------------

  it('resolves to "light" when system prefers light and mode is "system"', () => {
    mockMatchMedia(false);
    render(
      <ThemeProvider defaultMode="system">
        <ThemeConsumer />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
  });

  it('resolves to "dark" when system prefers dark and mode is "system"', () => {
    mockMatchMedia(true);
    render(
      <ThemeProvider defaultMode="system">
        <ThemeConsumer />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
  });

  it('updates resolved theme when system preference changes', () => {
    const media = mockMatchMedia(false);
    render(
      <ThemeProvider defaultMode="system">
        <ThemeConsumer />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');

    act(() => {
      media.simulateChange(true);
    });
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
  });

  // -------------------------------------------------------------------------
  // setMode
  // -------------------------------------------------------------------------

  it('setMode changes the mode and persists to localStorage', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Set Dark' }));
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(localStorage.getItem('flux-agent-theme')).toBe('dark');
  });

  it('setMode to "light" updates resolved theme', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider defaultMode="dark">
        <ThemeConsumer />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Set Light' }));
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
  });

  // -------------------------------------------------------------------------
  // toggle
  // -------------------------------------------------------------------------

  it('toggle switches from light to dark', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider defaultMode="light">
        <ThemeConsumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
    await user.click(screen.getByRole('button', { name: 'Toggle' }));
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
  });

  it('toggle switches from dark to light', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider defaultMode="dark">
        <ThemeConsumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    await user.click(screen.getByRole('button', { name: 'Toggle' }));
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
  });

  // -------------------------------------------------------------------------
  // DOM attribute
  // -------------------------------------------------------------------------

  it('sets data-theme on document.documentElement', () => {
    render(
      <ThemeProvider defaultMode="dark">
        <ThemeConsumer />
      </ThemeProvider>,
    );
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('sets data-theme on custom targetElement', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);

    render(
      <ThemeProvider defaultMode="light" targetElement={target}>
        <ThemeConsumer />
      </ThemeProvider>,
    );
    expect(target.getAttribute('data-theme')).toBe('light');

    // Cleanup
    document.body.removeChild(target);
  });

  it('updates data-theme when mode changes', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider defaultMode="light">
        <ThemeConsumer />
      </ThemeProvider>,
    );

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    await user.click(screen.getByRole('button', { name: 'Set Dark' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  // -------------------------------------------------------------------------
  // localStorage persistence
  // -------------------------------------------------------------------------

  it('persists mode to localStorage with key "flux-agent-theme"', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Set Light' }));
    expect(localStorage.getItem('flux-agent-theme')).toBe('light');

    await user.click(screen.getByRole('button', { name: 'Set Dark' }));
    expect(localStorage.getItem('flux-agent-theme')).toBe('dark');

    await user.click(screen.getByRole('button', { name: 'Set System' }));
    expect(localStorage.getItem('flux-agent-theme')).toBe('system');
  });

  // -------------------------------------------------------------------------
  // useTheme hook outside provider
  // -------------------------------------------------------------------------

  it('throws an error when useTheme is used outside ThemeProvider', () => {
    // Suppress React error boundary console noise
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<ThemeConsumer />);
    }).toThrow('useTheme must be used within a <ThemeProvider>');

    consoleSpy.mockRestore();
  });
});
