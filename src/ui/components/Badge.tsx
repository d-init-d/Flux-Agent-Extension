import React from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info';
type BadgeSize = 'sm' | 'md';

interface BadgeProps {
  /** Visual variant */
  variant?: BadgeVariant;
  /** Size preset */
  size?: BadgeSize;
  /** Content inside the badge */
  children: React.ReactNode;
  /** Show a small dot indicator before the text */
  dot?: boolean;
  /** Show a remove (X) button. Called when the button is clicked. */
  onRemove?: () => void;
  /** Additional CSS class names */
  className?: string;
}

// ---------------------------------------------------------------------------
// Style Maps
// ---------------------------------------------------------------------------

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default: 'bg-surface-secondary text-content-secondary border border-border',
  success: 'bg-success-50 text-success-700 border border-success-500/20',
  warning: 'bg-warning-50 text-warning-700 border border-warning-500/20',
  error: 'bg-error-50 text-error-700 border border-error-500/20',
  info: 'bg-info-50 text-info-700 border border-info-500/20',
};

const DOT_CLASSES: Record<BadgeVariant, string> = {
  default: 'bg-content-tertiary',
  success: 'bg-success-500',
  warning: 'bg-warning-500',
  error: 'bg-error-500',
  info: 'bg-info-500',
};

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: 'text-xs px-1.5 py-0.5 gap-1',
  md: 'text-xs px-2 py-0.5 gap-1.5',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const Badge: React.FC<BadgeProps> = ({
  variant = 'default',
  size = 'sm',
  children,
  dot = false,
  onRemove,
  className = '',
}) => {
  return (
    <span
      className={`
        inline-flex items-center font-medium
        rounded-full leading-none whitespace-nowrap
        ${VARIANT_CLASSES[variant]}
        ${SIZE_CLASSES[size]}
        ${className}
      `.trim()}
    >
      {/* Dot indicator */}
      {dot && (
        <span
          className={`shrink-0 h-1.5 w-1.5 rounded-full ${DOT_CLASSES[variant]}`}
          aria-hidden="true"
        />
      )}

      {/* Content */}
      <span>{children}</span>

      {/* Remove button */}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="
            shrink-0 -mr-0.5 ml-0.5
            rounded-full p-0.5
            hover:bg-black/10 transition-colors duration-fast
            focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus
          "
          aria-label="Remove"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      )}
    </span>
  );
};

export { Badge };
export type { BadgeProps, BadgeVariant, BadgeSize };
