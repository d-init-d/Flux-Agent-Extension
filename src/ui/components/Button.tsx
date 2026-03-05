import React from 'react';
import { Spinner } from './Spinner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual variant */
  variant?: ButtonVariant;
  /** Size preset */
  size?: ButtonSize;
  /** Show loading spinner and disable interaction */
  loading?: boolean;
  /** Icon element rendered before children */
  iconLeft?: React.ReactNode;
  /** Icon element rendered after children */
  iconRight?: React.ReactNode;
  /** Render as full-width block */
  fullWidth?: boolean;
}

// ---------------------------------------------------------------------------
// Style Maps
// ---------------------------------------------------------------------------

const BASE_CLASSES = [
  'inline-flex items-center justify-center gap-2',
  'font-medium leading-snug tracking-tight',
  'rounded-lg',
  'transition-all duration-fast',
  'select-none',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2',
  'disabled:pointer-events-none disabled:opacity-50',
  'active:scale-[0.97]',
].join(' ');

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: [
    'bg-primary-600 text-white',
    'hover:bg-primary-700',
    'active:bg-primary-800',
    'shadow-sm hover:shadow-md',
  ].join(' '),

  secondary: [
    'bg-surface-secondary text-content-primary',
    'border border-border',
    'hover:bg-primary-50 hover:border-primary-200 hover:text-primary-700',
    '[data-theme="dark"]_&:hover:bg-primary-900/20 [data-theme="dark"]_&:hover:border-primary-800',
  ].join(' '),

  ghost: [
    'text-content-secondary',
    'hover:bg-surface-secondary hover:text-content-primary',
  ].join(' '),

  danger: [
    'bg-error-600 text-white',
    'hover:bg-error-700',
    'active:bg-error-700',
    'shadow-sm hover:shadow-md',
    'focus-visible:ring-error-500',
  ].join(' '),

  outline: [
    'border border-border text-content-primary',
    'hover:bg-surface-secondary',
    'active:bg-surface-secondary',
  ].join(' '),
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
  lg: 'h-11 px-6 text-base',
};

const ICON_SIZE: Record<ButtonSize, string> = {
  sm: '[&_svg]:h-3.5 [&_svg]:w-3.5',
  md: '[&_svg]:h-4 [&_svg]:w-4',
  lg: '[&_svg]:h-5 [&_svg]:w-5',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      iconLeft,
      iconRight,
      fullWidth = false,
      disabled,
      className = '',
      children,
      ...rest
    },
    ref,
  ) => {
    const isDisabled = disabled || loading;

    const spinnerColor =
      variant === 'primary' || variant === 'danger' ? 'white' : 'current';

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        className={`
          ${BASE_CLASSES}
          ${VARIANT_CLASSES[variant]}
          ${SIZE_CLASSES[size]}
          ${ICON_SIZE[size]}
          ${fullWidth ? 'w-full' : ''}
          ${className}
        `.trim()}
        {...rest}
      >
        {loading ? (
          <Spinner
            size={size === 'lg' ? 'sm' : 'xs'}
            color={spinnerColor}
            label="Loading"
          />
        ) : iconLeft ? (
          <span className="shrink-0">{iconLeft}</span>
        ) : null}

        {children && <span className={loading ? 'opacity-70' : ''}>{children}</span>}

        {!loading && iconRight && <span className="shrink-0">{iconRight}</span>}
      </button>
    );
  },
);

Button.displayName = 'Button';

export { Button };
export type { ButtonProps, ButtonVariant, ButtonSize };
