import React, { useId } from 'react';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  helperText?: string;
  errorMessage?: string;
  wrapperClassName?: string;
  options: SelectOption[];
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      label,
      helperText,
      errorMessage,
      wrapperClassName = '',
      className = '',
      options,
      id: externalId,
      disabled,
      ...rest
    },
    ref,
  ) => {
    const autoId = useId();
    const selectId = externalId || autoId;
    const helperId = `${selectId}-helper`;
    const errorId = `${selectId}-error`;
    const borderClass = errorMessage
      ? 'border-error-500 focus:border-error-500 focus:ring-error-500/20'
      : 'border-border focus:border-primary-500 focus:ring-primary-500/20';

    return (
      <div className={`flex flex-col gap-1.5 ${wrapperClassName}`}>
        {label ? (
          <label htmlFor={selectId} className="text-sm font-medium text-content-primary">
            {label}
          </label>
        ) : null}

        <select
          ref={ref}
          id={selectId}
          disabled={disabled}
          aria-invalid={Boolean(errorMessage) || undefined}
          aria-describedby={errorMessage ? errorId : helperText ? helperId : undefined}
          className={`h-9 w-full rounded-lg border bg-surface-primary px-3 text-sm text-content-primary shadow-sm transition-all duration-fast focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${borderClass} ${className}`.trim()}
          {...rest}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {errorMessage ? (
          <p id={errorId} role="alert" className="text-xs text-error-500 leading-snug">
            {errorMessage}
          </p>
        ) : null}

        {!errorMessage && helperText ? (
          <p id={helperId} className="text-xs text-content-tertiary leading-snug">
            {helperText}
          </p>
        ) : null}
      </div>
    );
  },
);

Select.displayName = 'Select';

export { Select };
export type { SelectProps, SelectOption };
