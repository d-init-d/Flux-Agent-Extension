import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { Switch } from '../Switch';

describe('Switch', () => {
  it('renders with role switch and checked state', () => {
    render(<Switch checked aria-label="Test switch" />);

    expect(screen.getByRole('switch', { name: /test switch/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('forwards ref to the button element', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Switch ref={ref} checked={false} aria-label="Ref switch" />);

    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it('calls onCheckedChange with the next value when clicked', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();

    render(<Switch checked={false} onCheckedChange={onCheckedChange} aria-label="Toggle" />);

    await user.click(screen.getByRole('switch', { name: /toggle/i }));

    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('does not call onCheckedChange when disabled', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();

    render(<Switch checked={false} disabled onCheckedChange={onCheckedChange} aria-label="Disabled toggle" />);

    await user.click(screen.getByRole('switch', { name: /disabled toggle/i }));

    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
