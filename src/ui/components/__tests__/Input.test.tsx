import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { Input } from '../Input';

describe('Input', () => {
  // -------------------------------------------------------------------------
  // Basic rendering
  // -------------------------------------------------------------------------

  it('renders an input element', () => {
    render(<Input placeholder="Enter text" />);
    expect(screen.getByPlaceholderText('Enter text')).toBeInTheDocument();
  });

  it('forwards ref to the input element', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  // -------------------------------------------------------------------------
  // Label
  // -------------------------------------------------------------------------

  it('renders a label with htmlFor when label prop is provided', () => {
    render(<Input label="Email" id="email-input" />);
    const label = screen.getByText('Email');
    expect(label.tagName).toBe('LABEL');
    expect(label).toHaveAttribute('for', 'email-input');
  });

  it('connects label to input via auto-generated id when no id is given', () => {
    render(<Input label="Name" />);
    const label = screen.getByText('Name');
    const input = screen.getByRole('textbox');
    expect(label).toHaveAttribute('for', input.id);
  });

  it('does not render a label when label is not provided', () => {
    const { container } = render(<Input />);
    expect(container.querySelector('label')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Error message
  // -------------------------------------------------------------------------

  it('displays error message with role="alert" when errorMessage is set', () => {
    render(<Input errorMessage="Required field" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Required field');
  });

  it('forces error variant when errorMessage is provided', () => {
    render(<Input errorMessage="Oops" variant="default" />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('hides helperText when errorMessage is present', () => {
    render(<Input errorMessage="Bad input" helperText="This should be hidden" />);
    expect(screen.queryByText('This should be hidden')).not.toBeInTheDocument();
    expect(screen.getByText('Bad input')).toBeInTheDocument();
  });

  it('sets aria-describedby to error id when errorMessage exists', () => {
    render(<Input errorMessage="Error here" id="test-input" />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('aria-describedby', 'test-input-error');
  });

  // -------------------------------------------------------------------------
  // Helper text
  // -------------------------------------------------------------------------

  it('displays helperText when no errorMessage is present', () => {
    render(<Input helperText="Hint text" />);
    expect(screen.getByText('Hint text')).toBeInTheDocument();
  });

  it('sets aria-describedby to helper id when helperText exists (no error)', () => {
    render(<Input helperText="Some help" id="help-input" />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('aria-describedby', 'help-input-helper');
  });

  it('does not set aria-describedby when neither error nor helper exist', () => {
    render(<Input id="plain-input" />);
    const input = screen.getByRole('textbox');
    expect(input).not.toHaveAttribute('aria-describedby');
  });

  // -------------------------------------------------------------------------
  // aria-invalid
  // -------------------------------------------------------------------------

  it('sets aria-invalid when variant is error', () => {
    render(<Input variant="error" />);
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
  });

  it('does not set aria-invalid for default variant', () => {
    render(<Input variant="default" />);
    expect(screen.getByRole('textbox')).not.toHaveAttribute('aria-invalid');
  });

  // -------------------------------------------------------------------------
  // Password toggle
  // -------------------------------------------------------------------------

  it('renders as password input by default when type="password"', () => {
    render(<Input type="password" showPasswordToggle />);
    // password inputs don't have a textbox role, find by display value or by container
    const input = document.querySelector('input[type="password"]');
    expect(input).toBeInTheDocument();
  });

  it('shows toggle button with "Show password" label for password input', () => {
    render(<Input type="password" showPasswordToggle />);
    expect(screen.getByLabelText('Show password')).toBeInTheDocument();
  });

  it('toggles password visibility when toggle button is clicked', async () => {
    const user = userEvent.setup();
    render(<Input type="password" showPasswordToggle />);

    const toggleBtn = screen.getByLabelText('Show password');
    const input = document.querySelector('input') as HTMLInputElement;

    expect(input.type).toBe('password');

    await user.click(toggleBtn);
    expect(input.type).toBe('text');
    expect(screen.getByLabelText('Hide password')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Hide password'));
    expect(input.type).toBe('password');
  });

  it('does not show toggle for non-password inputs', () => {
    render(<Input type="text" showPasswordToggle />);
    expect(screen.queryByLabelText('Show password')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Icons
  // -------------------------------------------------------------------------

  it('renders iconLeft', () => {
    const icon = <span data-testid="left-icon">🔍</span>;
    render(<Input iconLeft={icon} />);
    expect(screen.getByTestId('left-icon')).toBeInTheDocument();
  });

  it('renders iconRight', () => {
    const icon = <span data-testid="right-icon">✓</span>;
    render(<Input iconRight={icon} />);
    expect(screen.getByTestId('right-icon')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Size classes
  // -------------------------------------------------------------------------

  it.each([
    ['sm', 'h-8'],
    ['md', 'h-9'],
    ['lg', 'h-11'],
  ] as const)('applies size class for inputSize="%s"', (inputSize, expected) => {
    render(<Input inputSize={inputSize} />);
    expect(screen.getByRole('textbox').className).toContain(expected);
  });

  // -------------------------------------------------------------------------
  // Disabled
  // -------------------------------------------------------------------------

  it('disables the input when disabled prop is set', () => {
    render(<Input disabled />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  // -------------------------------------------------------------------------
  // Wrapper className
  // -------------------------------------------------------------------------

  it('applies wrapperClassName to the outer div', () => {
    const { container } = render(<Input wrapperClassName="my-wrapper" />);
    expect(container.firstElementChild?.className).toContain('my-wrapper');
  });

  // -------------------------------------------------------------------------
  // Custom className on input
  // -------------------------------------------------------------------------

  it('merges custom className on the input element', () => {
    render(<Input className="custom-input" />);
    expect(screen.getByRole('textbox').className).toContain('custom-input');
  });
});
