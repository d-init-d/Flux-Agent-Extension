import React, { useState, useId } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type InputVariant = 'default' | 'error';
type InputSize = 'sm' | 'md' | 'lg';

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Visual variant */
  variant?: InputVariant;
  /** Size preset */
  inputSize?: InputSize;
  /** Label text above the input */
  label?: string;
  /** Helper text below the input */
  helperText?: string;
  /** Error message (also sets variant to error) */
  errorMessage?: string;
  /** Icon rendered inside the input on the left */
  iconLeft?: React.ReactNode;
  /** Icon rendered inside the input on the right */
  iconRight?: React.ReactNode;
  /** Show password toggle for type="password" */
  showPasswordToggle?: boolean;
  /** Additional class on the outer wrapper */
  wrapperClassName?: string;
}

// ---------------------------------------------------------------------------
// Style Maps
// ---------------------------------------------------------------------------

const SIZE_CLASSES: Record<InputSize, string> = {
  sm: 'h-8 text-xs px-2.5',
  md: 'h-9 text-sm px-3',
  lg: 'h-11 text-base px-4',
};

const LABEL_SIZE: Record<InputSize, string> = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-sm',
};

const ICON_PADDING_LEFT: Record<InputSize, string> = {
  sm: 'pl-8',
  md: 'pl-9',
  lg: 'pl-11',
};

const ICON_PADDING_RIGHT: Record<InputSize, string> = {
  sm: 'pr-8',
  md: 'pr-9',
  lg: 'pr-11',
};

const ICON_CONTAINER_SIZE: Record<InputSize, string> = {
  sm: '[&_svg]:h-3.5 [&_svg]:w-3.5',
  md: '[&_svg]:h-4 [&_svg]:w-4',
  lg: '[&_svg]:h-5 [&_svg]:w-5',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const EyeIcon: React.FC<{ open: boolean }> = ({ open }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {open ? (
      <>
        <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
        <circle cx="12" cy="12" r="3" />
      </>
    ) : (
      <>
        <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
        <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
        <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
        <path d="m2 2 20 20" />
      </>
    )}
  </svg>
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      variant = 'default',
      inputSize = 'md',
      label,
      helperText,
      errorMessage,
      iconLeft,
      iconRight,
      showPasswordToggle = false,
      wrapperClassName = '',
      className = '',
      type,
      id: externalId,
      disabled,
      ...rest
    },
    ref,
  ) => {
    const autoId = useId();
    const inputId = externalId || autoId;
    const helperId = `${inputId}-helper`;
    const errorId = `${inputId}-error`;

    const [showPassword, setShowPassword] = useState(false);

    // If errorMessage is present, force error variant
    const resolvedVariant = errorMessage ? 'error' : variant;

    const isPassword = type === 'password';
    const resolvedType = isPassword && showPassword ? 'text' : type;

    const hasRightElement = iconRight || (isPassword && showPasswordToggle);

    const borderClass =
      resolvedVariant === 'error'
        ? 'border-error-500 focus:border-error-500 focus:ring-error-500/20'
        : 'border-border focus:border-primary-500 focus:ring-primary-500/20';

    return (
      <div className={`flex flex-col gap-1.5 ${wrapperClassName}`}>
        {/* Label */}
        {label && (
          <label
            htmlFor={inputId}
            className={`
              font-medium text-content-primary
              ${LABEL_SIZE[inputSize]}
            `.trim()}
          >
            {label}
          </label>
        )}

        {/* Input container */}
        <div className="relative">
          {/* Left icon */}
          {iconLeft && (
            <span
              className={`
                absolute left-3 top-1/2 -translate-y-1/2
                text-content-tertiary pointer-events-none
                ${ICON_CONTAINER_SIZE[inputSize]}
              `.trim()}
            >
              {iconLeft}
            </span>
          )}

          {/* Input element */}
          <input
            ref={ref}
            id={inputId}
            type={resolvedType}
            disabled={disabled}
            aria-invalid={resolvedVariant === 'error' || undefined}
            aria-describedby={errorMessage ? errorId : helperText ? helperId : undefined}
            className={`
              w-full rounded-lg border
              bg-surface-primary text-content-primary
              placeholder:text-content-tertiary
              transition-all duration-fast
              focus:outline-none focus:ring-2
              disabled:opacity-50 disabled:cursor-not-allowed
              ${SIZE_CLASSES[inputSize]}
              ${iconLeft ? ICON_PADDING_LEFT[inputSize] : ''}
              ${hasRightElement ? ICON_PADDING_RIGHT[inputSize] : ''}
              ${borderClass}
              ${className}
            `.trim()}
            {...rest}
          />

          {/* Right icon or password toggle */}
          {hasRightElement && (
            <span
              className={`
                absolute right-3 top-1/2 -translate-y-1/2
                ${ICON_CONTAINER_SIZE[inputSize]}
              `.trim()}
            >
              {isPassword && showPasswordToggle ? (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="text-content-tertiary hover:text-content-secondary transition-colors duration-fast p-0.5 rounded"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  <EyeIcon open={!showPassword} />
                </button>
              ) : (
                <span className="text-content-tertiary pointer-events-none">{iconRight}</span>
              )}
            </span>
          )}
        </div>

        {/* Error message */}
        {errorMessage && (
          <p id={errorId} role="alert" className="text-xs text-error-500 leading-snug">
            {errorMessage}
          </p>
        )}

        {/* Helper text (only shown if no error) */}
        {!errorMessage && helperText && (
          <p id={helperId} className="text-xs text-content-tertiary leading-snug">
            {helperText}
          </p>
        )}
      </div>
    );
  },
);

Input.displayName = 'Input';

export { Input };
export type { InputProps, InputVariant, InputSize };
