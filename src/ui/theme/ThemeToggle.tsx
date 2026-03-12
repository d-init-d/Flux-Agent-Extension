import { LaptopMinimal, Moon, SunMedium } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { KeyboardEvent, useId, useRef } from 'react';
import { useTheme } from './ThemeProvider';

type ThemeOption = {
  mode: 'light' | 'dark' | 'system';
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
};

interface ThemeToggleProps {
  className?: string;
  onModeChange?: (mode: ThemeOption['mode']) => void;
  persistOnSelect?: boolean;
}

const THEME_OPTIONS: ThemeOption[] = [
  { mode: 'light', label: 'Light', icon: SunMedium },
  { mode: 'dark', label: 'Dark', icon: Moon },
  { mode: 'system', label: 'System', icon: LaptopMinimal },
];

export function ThemeToggle({
  className = '',
  onModeChange,
  persistOnSelect = true,
}: ThemeToggleProps) {
  const { mode, resolvedTheme, setMode } = useTheme();
  const groupLabelId = useId();
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const activeIndex = THEME_OPTIONS.findIndex((option) => option.mode === mode);

  const selectMode = (nextMode: ThemeOption['mode']) => {
    setMode(nextMode, { persist: persistOnSelect });
    onModeChange?.(nextMode);
  };

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    const horizontalStep = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const verticalStep = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    const step = horizontalStep || verticalStep;

    if (step === 0) {
      return;
    }

    event.preventDefault();

    const nextIndex = (currentIndex + step + THEME_OPTIONS.length) % THEME_OPTIONS.length;
    const nextOption = THEME_OPTIONS[nextIndex];

    selectMode(nextOption.mode);
    optionRefs.current[nextIndex]?.focus();
  };

  return (
    <div className={className}>
      <div className="sr-only" id={groupLabelId}>
        Theme mode
      </div>

      <div
        role="radiogroup"
        aria-labelledby={groupLabelId}
        className="inline-flex min-h-11 items-center rounded-2xl border border-[rgb(var(--color-border-default))] bg-[rgb(var(--color-bg-primary))] p-1 shadow-sm"
        data-testid="theme-toggle"
      >
        {THEME_OPTIONS.map((option) => {
          const Icon = option.icon;
          const isSelected = mode === option.mode;
          const stateLabel = option.mode === 'system' ? `System (${resolvedTheme})` : option.label;

          return (
            <button
              key={option.mode}
              ref={(element) => {
                optionRefs.current[THEME_OPTIONS.findIndex((item) => item.mode === option.mode)] =
                  element;
              }}
              type="button"
              role="radio"
              tabIndex={isSelected ? 0 : -1}
              aria-checked={isSelected}
              aria-label={`Use ${option.label.toLowerCase()} theme`}
              title={stateLabel}
              onKeyDown={(event) =>
                handleOptionKeyDown(event, activeIndex === -1 ? 0 : activeIndex)
              }
              onClick={() => {
                selectMode(option.mode);
              }}
              className={[
                'flex min-h-9 min-w-0 items-center gap-1.5 rounded-xl px-3 text-xs font-medium tracking-tight transition-all duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--color-border-focus))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--color-bg-primary))]',
                'active:scale-95',
                isSelected
                  ? 'bg-[rgb(var(--color-primary-50))] text-[rgb(var(--color-primary-700))] shadow-sm'
                  : 'text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-bg-secondary))] hover:text-[rgb(var(--color-text-primary))]',
              ].join(' ')}
              data-testid={`theme-toggle-${option.mode}`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="leading-none">{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export type { ThemeToggleProps };
