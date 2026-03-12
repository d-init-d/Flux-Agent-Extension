import React from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CardVariant = 'default' | 'bordered' | 'elevated';
type CardPadding = 'none' | 'sm' | 'md' | 'lg';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Visual variant */
  variant?: CardVariant;
  /** Padding preset */
  padding?: CardPadding;
}

type CardHeaderProps = React.HTMLAttributes<HTMLDivElement>;
interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Heading level for semantics */
  as?: 'h2' | 'h3' | 'h4';
}
type CardDescriptionProps = React.HTMLAttributes<HTMLParagraphElement>;
type CardContentProps = React.HTMLAttributes<HTMLDivElement>;
type CardFooterProps = React.HTMLAttributes<HTMLDivElement>;

// ---------------------------------------------------------------------------
// Style Maps
// ---------------------------------------------------------------------------

const VARIANT_CLASSES: Record<CardVariant, string> = {
  default: 'bg-surface-elevated border border-border',
  bordered: 'bg-surface-elevated border-2 border-border',
  elevated: 'bg-surface-elevated shadow-md hover:shadow-lg transition-shadow duration-normal',
};

const PADDING_CLASSES: Record<CardPadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ variant = 'default', padding = 'none', className = '', children, ...rest }, ref) => {
    return (
      <div
        ref={ref}
        className={`
          rounded-xl overflow-hidden
          ${VARIANT_CLASSES[variant]}
          ${PADDING_CLASSES[padding]}
          ${className}
        `.trim()}
        {...rest}
      >
        {children}
      </div>
    );
  },
);
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ className = '', children, ...rest }, ref) => {
    return (
      <div
        ref={ref}
        className={`flex flex-col gap-1.5 px-5 pt-5 pb-2 ${className}`}
        {...rest}
      >
        {children}
      </div>
    );
  },
);
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<HTMLHeadingElement, CardTitleProps>(
  ({ as: Tag = 'h3', className = '', children, ...rest }, ref) => {
    return (
      <Tag
        ref={ref}
        className={`text-lg font-semibold tracking-tight text-content-primary leading-snug ${className}`}
        {...rest}
      >
        {children}
      </Tag>
    );
  },
);
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<HTMLParagraphElement, CardDescriptionProps>(
  ({ className = '', children, ...rest }, ref) => {
    return (
      <p
        ref={ref}
        className={`text-sm text-content-secondary leading-relaxed ${className}`}
        {...rest}
      >
        {children}
      </p>
    );
  },
);
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<HTMLDivElement, CardContentProps>(
  ({ className = '', children, ...rest }, ref) => {
    return (
      <div ref={ref} className={`px-5 py-3 ${className}`} {...rest}>
        {children}
      </div>
    );
  },
);
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<HTMLDivElement, CardFooterProps>(
  ({ className = '', children, ...rest }, ref) => {
    return (
      <div
        ref={ref}
        className={`flex items-center gap-2 px-5 pt-2 pb-5 ${className}`}
        {...rest}
      >
        {children}
      </div>
    );
  },
);
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
export type {
  CardProps,
  CardVariant,
  CardPadding,
  CardHeaderProps,
  CardTitleProps,
  CardDescriptionProps,
  CardContentProps,
  CardFooterProps,
};
