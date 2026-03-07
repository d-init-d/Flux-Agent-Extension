import React from 'react';

interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, className = '', disabled, type = 'button', ...rest }, ref) => {
    return (
      <button
        {...rest}
        ref={ref}
        type={type}
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        data-state={checked ? 'checked' : 'unchecked'}
        onClick={(event) => {
          rest.onClick?.(event);

          if (!event.defaultPrevented && !disabled) {
            onCheckedChange?.(!checked);
          }
        }}
        className={[
          'inline-flex h-11 w-16 shrink-0 items-center rounded-full border transition-all duration-fast',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          checked
            ? 'border-primary-600 bg-primary-600 justify-end'
            : 'border-border bg-surface-secondary justify-start',
          className,
        ].join(' ')}
      >
        <span
          aria-hidden="true"
          className="mx-1 h-7 w-7 rounded-full bg-white shadow-sm transition-transform duration-fast"
        />
      </button>
    );
  },
);

Switch.displayName = 'Switch';

export { Switch };
export type { SwitchProps };
