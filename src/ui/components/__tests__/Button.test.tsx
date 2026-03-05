import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { Button } from '../Button';

describe('Button', () => {
  // -------------------------------------------------------------------------
  // Basic rendering
  // -------------------------------------------------------------------------

  it('renders children text', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: /click me/i })).toBeInTheDocument();
  });

  it('forwards ref to the button element', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Ref test</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    expect(ref.current?.textContent).toContain('Ref test');
  });

  // -------------------------------------------------------------------------
  // Variant classes
  // -------------------------------------------------------------------------

  it.each([
    ['primary', 'bg-primary-600'],
    ['secondary', 'bg-surface-secondary'],
    ['ghost', 'text-content-secondary'],
    ['danger', 'bg-error-600'],
    ['outline', 'border-border'],
  ] as const)('applies variant class for variant="%s"', (variant, expected) => {
    render(<Button variant={variant}>V</Button>);
    expect(screen.getByRole('button').className).toContain(expected);
  });

  // -------------------------------------------------------------------------
  // Size classes
  // -------------------------------------------------------------------------

  it.each([
    ['sm', 'h-8'],
    ['md', 'h-9'],
    ['lg', 'h-11'],
  ] as const)('applies size class for size="%s"', (size, expected) => {
    render(<Button size={size}>S</Button>);
    expect(screen.getByRole('button').className).toContain(expected);
  });

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  it('shows Spinner when loading=true', () => {
    render(<Button loading>Loading</Button>);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('sets aria-busy when loading', () => {
    render(<Button loading>Loading</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
  });

  it('disables the button when loading', () => {
    render(<Button loading>Loading</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('does not set aria-busy when not loading', () => {
    render(<Button>Normal</Button>);
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-busy');
  });

  it('hides iconLeft and iconRight when loading', () => {
    const leftIcon = <span data-testid="icon-left">L</span>;
    const rightIcon = <span data-testid="icon-right">R</span>;
    render(
      <Button loading iconLeft={leftIcon} iconRight={rightIcon}>
        Text
      </Button>,
    );
    expect(screen.queryByTestId('icon-left')).not.toBeInTheDocument();
    expect(screen.queryByTestId('icon-right')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Disabled state
  // -------------------------------------------------------------------------

  it('sets disabled attribute when disabled', () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('does not fire onClick when disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Disabled
      </Button>,
    );
    await user.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // fullWidth
  // -------------------------------------------------------------------------

  it('adds w-full class when fullWidth=true', () => {
    render(<Button fullWidth>Full</Button>);
    expect(screen.getByRole('button').className).toContain('w-full');
  });

  it('does not add w-full class when fullWidth is false', () => {
    render(<Button>Normal</Button>);
    expect(screen.getByRole('button').className).not.toContain('w-full');
  });

  // -------------------------------------------------------------------------
  // Icons
  // -------------------------------------------------------------------------

  it('renders iconLeft when not loading', () => {
    const icon = <span data-testid="icon-left">←</span>;
    render(<Button iconLeft={icon}>With icon</Button>);
    expect(screen.getByTestId('icon-left')).toBeInTheDocument();
  });

  it('renders iconRight when not loading', () => {
    const icon = <span data-testid="icon-right">→</span>;
    render(<Button iconRight={icon}>With icon</Button>);
    expect(screen.getByTestId('icon-right')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Custom className
  // -------------------------------------------------------------------------

  it('merges custom className', () => {
    render(<Button className="extra-class">Styled</Button>);
    expect(screen.getByRole('button').className).toContain('extra-class');
  });

  // -------------------------------------------------------------------------
  // Click handler
  // -------------------------------------------------------------------------

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Clickable</Button>);
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Default props
  // -------------------------------------------------------------------------

  it('defaults to variant=primary, size=md', () => {
    render(<Button>Default</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('bg-primary-600');
    expect(btn.className).toContain('h-9');
  });
});
