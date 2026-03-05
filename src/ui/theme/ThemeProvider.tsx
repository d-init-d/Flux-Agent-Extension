import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ThemeMode = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  /** Current theme mode (includes "system") */
  mode: ThemeMode;
  /** The actually applied theme after resolving "system" */
  resolvedTheme: ResolvedTheme;
  /** Switch to a different mode */
  setMode: (mode: ThemeMode) => void;
  /** Toggle between light and dark (ignoring system) */
  toggle: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'flux-agent-theme';
const THEME_ATTRIBUTE = 'data-theme';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ThemeContext = createContext<ThemeContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface ThemeProviderProps {
  /** Initial theme mode override (default: reads from localStorage or "system") */
  defaultMode?: ThemeMode;
  /** The DOM element to apply data-theme to (default: document.documentElement) */
  targetElement?: HTMLElement;
  children: React.ReactNode;
}

const ThemeProvider: React.FC<ThemeProviderProps> = ({
  defaultMode,
  targetElement,
  children,
}) => {
  // -----------------------------------------------------------------------
  // State: read persisted preference or fall back to default
  // -----------------------------------------------------------------------
  const [mode, setModeState] = useState<ThemeMode>(() => {
    if (defaultMode) return defaultMode;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        return stored;
      }
    } catch {
      // localStorage may be unavailable in some contexts
    }
    return 'system';
  });

  // -----------------------------------------------------------------------
  // Detect system preference
  // -----------------------------------------------------------------------
  const [systemPreference, setSystemPreference] = useState<ResolvedTheme>(() => {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handler = (e: MediaQueryListEvent) => {
      setSystemPreference(e.matches ? 'dark' : 'light');
    };

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  // -----------------------------------------------------------------------
  // Resolved theme
  // -----------------------------------------------------------------------
  const resolvedTheme: ResolvedTheme = mode === 'system' ? systemPreference : mode;

  // -----------------------------------------------------------------------
  // Apply theme attribute to DOM
  // -----------------------------------------------------------------------
  useEffect(() => {
    const target = targetElement || document.documentElement;
    target.setAttribute(THEME_ATTRIBUTE, resolvedTheme);
  }, [resolvedTheme, targetElement]);

  // -----------------------------------------------------------------------
  // Persist preference
  // -----------------------------------------------------------------------
  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode);
    try {
      localStorage.setItem(STORAGE_KEY, newMode);
    } catch {
      // Ignore storage errors
    }
  }, []);

  const toggle = useCallback(() => {
    setMode(resolvedTheme === 'light' ? 'dark' : 'light');
  }, [resolvedTheme, setMode]);

  // -----------------------------------------------------------------------
  // Context value (memoized to prevent unnecessary re-renders)
  // -----------------------------------------------------------------------
  const value = useMemo<ThemeContextValue>(
    () => ({ mode, resolvedTheme, setMode, toggle }),
    [mode, resolvedTheme, setMode, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a <ThemeProvider>');
  }
  return context;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { ThemeProvider, useTheme };
export type { ThemeMode, ResolvedTheme, ThemeContextValue, ThemeProviderProps };
