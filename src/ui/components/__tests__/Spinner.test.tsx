import { render, screen } from '@testing-library/react';
import { Spinner } from '../Spinner';

describe('Spinner', () => {
  // -------------------------------------------------------------------------
  // Defaults & accessibility
  // -------------------------------------------------------------------------

  it('renders with role="status"', () => {
    render(<Spinner />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has default aria-label "Loading"', () => {
    render(<Spinner />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Loading');
  });

  it('renders sr-only text with the label', () => {
    render(<Spinner label="Please wait" />);
    const spinner = screen.getByRole('status');
    expect(spinner).toHaveAttribute('aria-label', 'Please wait');
    expect(spinner).toHaveTextContent('Please wait');
  });

  // -------------------------------------------------------------------------
  // Size classes
  // -------------------------------------------------------------------------

  it.each([
    ['xs', 'h-3'],
    ['sm', 'h-4'],
    ['md', 'h-5'],
    ['lg', 'h-8'],
  ] as const)('applies correct size class for size="%s"', (size, expected) => {
    render(<Spinner size={size} />);
    expect(screen.getByRole('status').className).toContain(expected);
  });

  // -------------------------------------------------------------------------
  // Color classes
  // -------------------------------------------------------------------------

  it.each([
    ['primary', 'border-t-primary-500'],
    ['white', 'border-t-white'],
    ['current', 'border-t-current'],
  ] as const)('applies correct color class for color="%s"', (color, expected) => {
    render(<Spinner color={color} />);
    expect(screen.getByRole('status').className).toContain(expected);
  });

  // -------------------------------------------------------------------------
  // Animation
  // -------------------------------------------------------------------------

  it('includes animate-spin class', () => {
    render(<Spinner />);
    expect(screen.getByRole('status').className).toContain('animate-spin');
  });

  // -------------------------------------------------------------------------
  // Custom className
  // -------------------------------------------------------------------------

  it('merges custom className', () => {
    render(<Spinner className="my-custom-class" />);
    expect(screen.getByRole('status').className).toContain('my-custom-class');
  });
});
