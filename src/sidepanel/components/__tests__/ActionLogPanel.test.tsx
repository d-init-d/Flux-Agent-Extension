import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ActionLogPanel, MOCK_ACTION_LOG } from '../ActionLogPanel';
import type { ActionLogEntry } from '../mockActionLog';

const STATUS_ACTIONS: ActionLogEntry[] = [
  {
    id: 'pending-action',
    title: 'Pending step',
    detail: 'Waiting for an available worker slot.',
    timeLabel: '10:00',
    status: 'pending',
  },
  {
    id: 'running-action',
    title: 'Running step',
    detail: 'Capturing the current page state.',
    timeLabel: '10:01',
    status: 'running',
  },
  {
    id: 'done-action',
    title: 'Done step',
    detail: 'Saved the extracted metadata.',
    timeLabel: '10:02',
    status: 'done',
  },
  {
    id: 'failed-action',
    title: 'Failed step',
    detail: 'The page blocked one follow-up request.',
    timeLabel: '10:03',
    status: 'failed',
  },
];

describe('ActionLogPanel', () => {
  it('renders a collapsed summary by default', () => {
    render(<ActionLogPanel actions={MOCK_ACTION_LOG} />);

    const toggle = screen.getByRole('button', { name: 'Expand action log' });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText(/4 recent actions/i)).toBeInTheDocument();
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

  it('renders distinct timeline icons for pending, running, done, and failed states', () => {
    render(<ActionLogPanel actions={STATUS_ACTIONS} initiallyExpanded />);

    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();

    expect(screen.getByTestId('action-timeline-icon-pending-action')).toHaveAttribute('data-status', 'pending');
    expect(screen.getByTestId('action-timeline-icon-running-action')).toHaveAttribute('data-status', 'running');
    expect(screen.getByTestId('action-timeline-icon-done-action')).toHaveAttribute('data-status', 'done');
    expect(screen.getByTestId('action-timeline-icon-failed-action')).toHaveAttribute('data-status', 'failed');
  });
});
