import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ActionTimeline } from '../ActionTimeline';
import type { ActionLogEntry } from '../mockActionLog';

const TIMELINE_ACTIONS: ActionLogEntry[] = [
  {
    id: 'pending-action',
    title: 'Pending step',
    detail: 'Waiting for execution slot.',
    timeLabel: '10:00',
    status: 'pending',
  },
  {
    id: 'running-action',
    title: 'Running step',
    detail: 'Collecting current page data.',
    timeLabel: '10:01',
    status: 'running',
  },
  {
    id: 'done-action',
    title: 'Done step',
    detail: 'Saved extracted result.',
    timeLabel: '10:02',
    status: 'done',
  },
  {
    id: 'failed-action',
    title: 'Failed step',
    detail: 'One follow-up action was blocked.',
    timeLabel: '10:03',
    status: 'failed',
  },
];

describe('ActionTimeline', () => {
  it('renders timeline items with distinct status markers', () => {
    render(<ActionTimeline actions={TIMELINE_ACTIONS} />);

    expect(screen.getByRole('list', { name: 'Executed actions timeline' })).toBeInTheDocument();
    expect(screen.getByTestId('action-timeline-icon-pending-action')).toHaveAttribute(
      'data-status',
      'pending',
    );
    expect(screen.getByTestId('action-timeline-icon-running-action')).toHaveAttribute(
      'data-status',
      'running',
    );
    expect(screen.getByTestId('action-timeline-icon-done-action')).toHaveAttribute(
      'data-status',
      'done',
    );
    expect(screen.getByTestId('action-timeline-icon-failed-action')).toHaveAttribute(
      'data-status',
      'failed',
    );
  });
});
