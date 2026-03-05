import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Badge } from '../Badge';

describe('Badge', () => {
  // -------------------------------------------------------------------------
  // Basic rendering
  // -------------------------------------------------------------------------

  it('renders children text', () => {
    render(<Badge>Active</Badge>);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Variant classes
  // -------------------------------------------------------------------------

  it.each([
    ['default', 'bg-surface-secondary'],
    ['success', 'bg-success-50'],
    ['warning', 'bg-warning-50'],
    ['error', 'bg-error-50'],
    ['info', 'bg-info-50'],
  ] as const)('applies variant class for variant="%s"', (variant, expected) => {
    const { container } = render(<Badge variant={variant}>V</Badge>);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.className).toContain(expected);
  });

  // -------------------------------------------------------------------------
  // Size classes
  // -------------------------------------------------------------------------

  it.each([
    ['sm', 'px-1.5'],
    ['md', 'px-2'],
  ] as const)('applies size class for size="%s"', (size, expected) => {
    const { container } = render(<Badge size={size}>S</Badge>);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.className).toContain(expected);
  });

  // -------------------------------------------------------------------------
  // Dot indicator
  // -------------------------------------------------------------------------

  it('shows a dot when dot=true', () => {
    const { container } = render(<Badge dot>With dot</Badge>);
    const dot = container.querySelector('[aria-hidden="true"]');
    expect(dot).toBeInTheDocument();
    expect(dot?.className).toContain('rounded-full');
    expect(dot?.className).toContain('h-1.5');
  });

  it('does not show dot when dot=false (default)', () => {
    const { container } = render(<Badge>No dot</Badge>);
    const dot = container.querySelector('[aria-hidden="true"]');
    expect(dot).toBeNull();
  });

  it('applies correct dot color class for variant', () => {
    const { container } = render(
      <Badge variant="success" dot>
        OK
      </Badge>,
    );
    const dot = container.querySelector('[aria-hidden="true"]');
    expect(dot?.className).toContain('bg-success-500');
  });

  // -------------------------------------------------------------------------
  // Remove button
  // -------------------------------------------------------------------------

  it('shows remove button with aria-label when onRemove is provided', () => {
    const onRemove = vi.fn();
    render(<Badge onRemove={onRemove}>Removable</Badge>);
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('calls onRemove when X button is clicked', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(<Badge onRemove={onRemove}>Tag</Badge>);

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('does not show remove button when onRemove is not provided', () => {
    render(<Badge>Simple</Badge>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Custom className
  // -------------------------------------------------------------------------

  it('merges custom className', () => {
    const { container } = render(<Badge className="extra">Styled</Badge>);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.className).toContain('extra');
  });

  // -------------------------------------------------------------------------
  // Defaults
  // -------------------------------------------------------------------------

  it('defaults to variant=default, size=sm', () => {
    const { container } = render(<Badge>Default</Badge>);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.className).toContain('bg-surface-secondary');
    expect(badge.className).toContain('px-1.5');
  });
});
