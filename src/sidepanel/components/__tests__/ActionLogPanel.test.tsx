import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ActionLogPanel, MOCK_ACTION_LOG } from '../ActionLogPanel';

describe('ActionLogPanel', () => {
  it('renders a collapsed summary by default', () => {
    render(<ActionLogPanel actions={MOCK_ACTION_LOG} />);

    const toggle = screen.getByRole('button', { name: 'Expand action log' });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText(/3 recent actions/i)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Executed actions timeline' })).not.toBeInTheDocument();
  });

  it('toggles the timeline open and closed', async () => {
    const user = userEvent.setup();
    render(<ActionLogPanel actions={MOCK_ACTION_LOG} />);

    const toggle = screen.getByRole('button', { name: 'Expand action log' });

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('list', { name: 'Executed actions timeline' })).toBeInTheDocument();
    expect(screen.getByText('Opened active tab context')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Collapse action log' }));

    expect(screen.getByRole('button', { name: 'Expand action log' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('list', { name: 'Executed actions timeline' })).not.toBeInTheDocument();
  });

  it('shows the empty state when expanded with no actions', () => {
    render(<ActionLogPanel actions={[]} initiallyExpanded />);

    expect(screen.getByText('No actions yet')).toBeInTheDocument();
    expect(
      screen.getByText(/executed actions will appear here as a readable timeline/i),
    ).toBeInTheDocument();
  });
});
