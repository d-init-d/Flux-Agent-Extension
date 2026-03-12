import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { Select } from '../Select';

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

describe('Select', () => {
  it('renders all options', () => {
    render(<Select options={OPTIONS} aria-label="Test" />);
    expect(screen.getByRole('combobox', { name: 'Test' })).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('Gamma')).toBeInTheDocument();
  });

  it('renders with label', () => {
    render(<Select options={OPTIONS} label="Choose one" />);
    expect(screen.getByText('Choose one')).toBeInTheDocument();
    expect(screen.getByLabelText('Choose one')).toBeInTheDocument();
  });

  it('renders without label', () => {
    render(<Select options={OPTIONS} aria-label="Test" />);
    expect(screen.queryByRole('label')).not.toBeInTheDocument();
  });

  it('renders with errorMessage', () => {
    render(
      <Select options={OPTIONS} label="Pick" errorMessage="Required field" />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Required field');
    expect(screen.getByLabelText('Pick')).toHaveAttribute('aria-invalid', 'true');
  });

  it('renders with helperText when no error', () => {
    render(
      <Select options={OPTIONS} label="Pick" helperText="Choose wisely" />,
    );
    expect(screen.getByText('Choose wisely')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows error instead of helper text when both are present', () => {
    render(
      <Select
        options={OPTIONS}
        label="Pick"
        errorMessage="Bad choice"
        helperText="Choose wisely"
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Bad choice');
    expect(screen.queryByText('Choose wisely')).not.toBeInTheDocument();
  });

  it('forwards ref to the select element', () => {
    const ref = createRef<HTMLSelectElement>();
    render(<Select ref={ref} options={OPTIONS} aria-label="Ref test" />);
    expect(ref.current).toBeInstanceOf(HTMLSelectElement);
  });

  it('passes disabled prop', () => {
    render(<Select options={OPTIONS} label="Pick" disabled />);
    expect(screen.getByLabelText('Pick')).toBeDisabled();
  });

  it('uses external id when provided', () => {
    render(<Select options={OPTIONS} id="my-select" label="Pick" />);
    expect(screen.getByLabelText('Pick')).toHaveAttribute('id', 'my-select');
  });

  it('generates auto id when not provided', () => {
    render(<Select options={OPTIONS} label="Auto" />);
    const select = screen.getByLabelText('Auto');
    expect(select.id).toBeTruthy();
  });

  it('handles onChange events', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Select options={OPTIONS} label="Pick" onChange={onChange} />,
    );
    await user.selectOptions(screen.getByLabelText('Pick'), 'b');
    expect(onChange).toHaveBeenCalled();
  });

  it('applies wrapperClassName', () => {
    const { container } = render(
      <Select options={OPTIONS} wrapperClassName="my-class" aria-label="Test" />,
    );
    expect(container.firstChild).toHaveClass('my-class');
  });

  it('applies custom className to select element', () => {
    render(
      <Select options={OPTIONS} className="custom-select" aria-label="Test" />,
    );
    expect(screen.getByRole('combobox')).toHaveClass('custom-select');
  });

  it('sets aria-describedby to error id when errorMessage exists', () => {
    render(
      <Select options={OPTIONS} id="sel" errorMessage="Err" aria-label="Test" />,
    );
    expect(screen.getByRole('combobox')).toHaveAttribute(
      'aria-describedby',
      'sel-error',
    );
  });

  it('sets aria-describedby to helper id when helperText exists and no error', () => {
    render(
      <Select options={OPTIONS} id="sel" helperText="Help" aria-label="Test" />,
    );
    expect(screen.getByRole('combobox')).toHaveAttribute(
      'aria-describedby',
      'sel-helper',
    );
  });

  it('sets no aria-describedby when neither error nor helper', () => {
    render(<Select options={OPTIONS} aria-label="Test" />);
    expect(screen.getByRole('combobox')).not.toHaveAttribute('aria-describedby');
  });

  it('does not set aria-invalid when no error', () => {
    render(<Select options={OPTIONS} aria-label="Test" />);
    expect(screen.getByRole('combobox')).not.toHaveAttribute('aria-invalid');
  });
});
