import React from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg';
type SpinnerColor = 'primary' | 'white' | 'current';

interface SpinnerProps {
  /** Visual size of the spinner */
  size?: SpinnerSize;
  /** Color variant */
  color?: SpinnerColor;
  /** Accessible label for screen readers */
  label?: string;
  /** Additional CSS class names */
  className?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SIZE_CLASSES: Record<SpinnerSize, string> = {
  xs: 'h-3 w-3',
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-8 w-8',
};

const BORDER_SIZE: Record<SpinnerSize, string> = {
  xs: 'border',
  sm: 'border-2',
  md: 'border-2',
  lg: 'border-[3px]',
};

const COLOR_CLASSES: Record<SpinnerColor, string> = {
  primary: 'border-primary-500/30 border-t-primary-500',
  white: 'border-white/30 border-t-white',
  current: 'border-current/30 border-t-current',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const Spinner: React.FC<SpinnerProps> = ({
  size = 'md',
  color = 'primary',
  label = 'Loading',
  className = '',
}) => {
  return (
    <span
      role="status"
      aria-label={label}
      className={`
        inline-block rounded-full animate-spin
        ${SIZE_CLASSES[size]}
        ${BORDER_SIZE[size]}
        ${COLOR_CLASSES[color]}
        ${className}
      `.trim()}
    >
      <span className="sr-only">{label}</span>
    </span>
  );
};

// Screen reader only utility (if not provided by Tailwind)
// Tailwind includes .sr-only by default, so we rely on that.

export { Spinner };
export type { SpinnerProps, SpinnerSize, SpinnerColor };
