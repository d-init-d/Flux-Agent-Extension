import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SavedWorkflow } from '@shared/types';
import { WorkflowLibraryModal, SaveWorkflowModal } from '../WorkflowModals';

function createWorkflow(id: string, overrides: Partial<SavedWorkflow> = {}): SavedWorkflow {
  return {
    id,
    name: `Workflow ${id}`,
    description: 'Test description',
    actions: [
      {
        action: { id: `${id}-nav`, type: 'navigate', url: 'https://example.com' },
        timestamp: Date.now() - 2000,
      },
    ],
    tags: ['test'],
    createdAt: Date.now() - 5000,
    updatedAt: Date.now() - 1000,
    ...overrides,
  };
}

const defaultLibraryProps = {
  open: true,
  workflows: [] as SavedWorkflow[],
  isHydrating: false,
  viewMode: 'grid' as const,
  selectedWorkflowId: null as string | null,
  canSaveCurrentSession: true,
  canRunSelectedWorkflow: true,
  isRunningSelectedWorkflow: false,
  isDeletingSelectedWorkflow: false,
  error: null as string | null,
  onClose: vi.fn(),
  onOpenSaveWorkflow: vi.fn(),
  onRunWorkflow: vi.fn(),
  onEditWorkflow: vi.fn(),
  onDeleteWorkflow: vi.fn(),
  onSelectWorkflow: vi.fn(),
  onViewModeChange: vi.fn(),
};

const defaultSaveProps = {
  open: true,
  mode: 'create' as const,
  draft: { name: '', description: '', tags: '' },
  actionCount: 5,
  sourceSessionName: 'Session 1',
  isSaving: false,
  error: null as string | null,
  onClose: vi.fn(),
  onDraftChange: vi.fn(),
  onSave: vi.fn(),
};

describe('WorkflowLibraryModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<WorkflowLibraryModal {...defaultLibraryProps} open={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows empty state when no workflows exist', () => {
    render(<WorkflowLibraryModal {...defaultLibraryProps} workflows={[]} />);
    expect(screen.getByText('Your workflow library is empty')).toBeInTheDocument();
    expect(screen.getByText(/No saved workflows yet/)).toBeInTheDocument();
  });

  it('shows loading state when hydrating', () => {
    render(<WorkflowLibraryModal {...defaultLibraryProps} isHydrating={true} />);
    expect(screen.getByText('Loading saved workflows...')).toBeInTheDocument();
  });

  it('shows error banner when error is present', () => {
    render(<WorkflowLibraryModal {...defaultLibraryProps} error="Something went wrong" />);
    expect(screen.getByRole('status')).toHaveTextContent('Something went wrong');
  });

  it('renders workflow cards in grid view', () => {
    const workflows = [createWorkflow('w1'), createWorkflow('w2')];
    render(
      <WorkflowLibraryModal
        {...defaultLibraryProps}
        workflows={workflows}
        selectedWorkflowId="w1"
      />,
    );
    expect(screen.getAllByText('Workflow w1').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Workflow w2').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/2 saved workflows ready to review/)).toBeInTheDocument();
  });

  it('renders workflow cards in list view', () => {
    const workflows = [createWorkflow('w1')];
    render(
      <WorkflowLibraryModal
        {...defaultLibraryProps}
        workflows={workflows}
        selectedWorkflowId="w1"
        viewMode="list"
      />,
    );
    expect(screen.getAllByText('Workflow w1').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/1 saved workflow ready to review/)).toBeInTheDocument();
  });

  it('shows workflow description or no-description placeholder', () => {
    const workflows = [
      createWorkflow('w1', { description: 'A detailed description' }),
      createWorkflow('w2', { description: undefined }),
    ];
    render(
      <WorkflowLibraryModal
        {...defaultLibraryProps}
        workflows={workflows}
        selectedWorkflowId="w1"
      />,
    );
    expect(screen.getAllByText('A detailed description').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('No description added yet.')).toBeInTheDocument();
  });

  it('shows tags on workflow cards or No tags placeholder', () => {
    const workflows = [
      createWorkflow('w1', { tags: ['qa', 'smoke'] }),
      createWorkflow('w2', { tags: [] }),
    ];
    render(
      <WorkflowLibraryModal
        {...defaultLibraryProps}
        workflows={workflows}
        selectedWorkflowId="w1"
      />,
    );
    expect(screen.getAllByText('qa').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('smoke').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('No tags').length).toBeGreaterThanOrEqual(1);
  });

  it('shows selected workflow detail panel', () => {
    const workflows = [
      createWorkflow('w1', {
        name: 'My Workflow',
        description: 'Detailed desc',
        tags: ['tag1'],
        actions: [
          { action: { id: 'a1', type: 'click', selector: {} }, timestamp: Date.now() },
          {
            action: { id: 'a2', type: 'navigate', url: 'https://test.com' },
            timestamp: Date.now(),
          },
        ],
      }),
    ];
    render(
      <WorkflowLibraryModal
        {...defaultLibraryProps}
        workflows={workflows}
        selectedWorkflowId="w1"
      />,
    );
    expect(screen.getByText('Selected workflow')).toBeInTheDocument();
    expect(screen.getAllByText('My Workflow').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Detailed desc').length).toBeGreaterThanOrEqual(1);
  });

  it('shows "This workflow is saved without a description." for workflow without description in detail', () => {
    const workflows = [createWorkflow('w1', { description: undefined })];
    render(
      <WorkflowLibraryModal
        {...defaultLibraryProps}
        workflows={workflows}
        selectedWorkflowId="w1"
      />,
    );
    expect(screen.getByText('This workflow is saved without a description.')).toBeInTheDocument();
  });

  it('shows No tags badge in detail panel for workflow without tags', () => {
    const workflows = [createWorkflow('w1', { tags: [] })];
    render(
      <WorkflowLibraryModal
        {...defaultLibraryProps}
        workflows={workflows}
        selectedWorkflowId="w1"
      />,
    );
    expect(screen.getAllByText('No tags').length).toBeGreaterThanOrEqual(1);
  });

  it('shows "+N more saved steps" when workflow has more than 5 actions', () => {
    const actions = Array.from({ length: 8 }, (_, i) => ({
      action: { id: `a${i}`, type: 'click', selector: {} },
      timestamp: Date.now() + i,
    }));
    const workflows = [createWorkflow('w1', { actions })];
    render(
      <WorkflowLibraryModal
        {...defaultLibraryProps}
        workflows={workflows}
        selectedWorkflowId="w1"
      />,
    );
    expect(screen.getByText('+3 more saved steps')).toBeInTheDocument();
  });

  it('does not show "+N more" when workflow has 5 or fewer actions', () => {
    const actions = Array.from({ length: 3 }, (_, i) => ({
      action: { id: `a${i}`, type: 'click', selector: {} },
      timestamp: Date.now() + i,
    }));
    const workflows = [createWorkflow('w1', { actions })];
    render(
      <WorkflowLibraryModal
        {...defaultLibraryProps}
        workflows={workflows}
        selectedWorkflowId="w1"
      />,
    );
    expect(screen.queryByText(/more saved steps/)).not.toBeInTheDocument();
  });

  it('displays source label from sessionName', () => {
    const workflows = [
      createWorkflow('w1', {
        source: { sessionId: 's1', sessionName: 'Demo Session', recordedAt: Date.now() },
      }),
    ];
    render(
      <WorkflowLibraryModal
        {...defaultLibraryProps}
        workflows={workflows}
        selectedWorkflowId="w1"
      />,
    );
    expect(screen.getAllByText(/Demo Session/).length).toBeGreaterThanOrEqual(1);
  });

  it('displays source label from sessionId when sessionName is absent', () => {
    const workflows = [
      createWorkflow('w1', {
        source: { sessionId: 's123' },
      }),
    ];
    render(
      <WorkflowLibraryModal
        {...defaultLibraryProps}
        workflows={workflows}
        selectedWorkflowId="w1"
      />,
    );
    expect(screen.getAllByText(/Session s123/).length).toBeGreaterThanOrEqual(1);
  });

  it('displays "Manual save" when no source exists in detail panel', () => {
    const workflows = [createWorkflow('w1', { source: undefined })];
    render(
      <WorkflowLibraryModal
        {...defaultLibraryProps}
        workflows={workflows}
        selectedWorkflowId="w1"
      />,
    );
    expect(screen.getByText('Manual save')).toBeInTheDocument();
  });

  it('calls onSelectWorkflow when a card is clicked', async () => {
    const user = userEvent.setup();
    const onSelectWorkflow = vi.fn();
    const workflows = [createWorkflow('w1'), createWorkflow('w2')];
    render(
      <WorkflowLibraryModal
        {...defaultLibraryProps}
        workflows={workflows}
        selectedWorkflowId="w1"
        onSelectWorkflow={onSelectWorkflow}
      />,
    );
    await user.click(screen.getByText('Workflow w2'));
    expect(onSelectWorkflow).toHaveBeenCalledWith('w2');
  });

  it('calls onViewModeChange when toggle buttons are clicked', async () => {
    const user = userEvent.setup();
    const onViewModeChange = vi.fn();
    render(
      <WorkflowLibraryModal
        {...defaultLibraryProps}
        workflows={[createWorkflow('w1')]}
        selectedWorkflowId="w1"
        onViewModeChange={onViewModeChange}
      />,
    );
    await user.click(screen.getByText('List'));
    expect(onViewModeChange).toHaveBeenCalledWith('list');

    await user.click(screen.getByText('Grid'));
    expect(onViewModeChange).toHaveBeenCalledWith('grid');
  });

  it('calls onRunWorkflow, onEditWorkflow, onDeleteWorkflow from detail panel', async () => {
    const user = userEvent.setup();
    const onRunWorkflow = vi.fn();
    const onEditWorkflow = vi.fn();
    const onDeleteWorkflow = vi.fn();
    const workflows = [createWorkflow('w1')];
    render(
      <WorkflowLibraryModal
        {...defaultLibraryProps}
        workflows={workflows}
        selectedWorkflowId="w1"
        onRunWorkflow={onRunWorkflow}
        onEditWorkflow={onEditWorkflow}
        onDeleteWorkflow={onDeleteWorkflow}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Run' }));
    expect(onRunWorkflow).toHaveBeenCalledWith('w1');

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(onEditWorkflow).toHaveBeenCalledWith('w1');

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDeleteWorkflow).toHaveBeenCalledWith('w1');
  });

  it('disables save button when canSaveCurrentSession is false', () => {
    render(<WorkflowLibraryModal {...defaultLibraryProps} canSaveCurrentSession={false} />);
    const buttons = screen.getAllByRole('button', { name: /save/i });
    buttons.forEach((btn) => expect(btn).toBeDisabled());
  });

  it('disables Run button when canRunSelectedWorkflow is false', () => {
    const workflows = [createWorkflow('w1')];
    render(
      <WorkflowLibraryModal
        {...defaultLibraryProps}
        workflows={workflows}
        selectedWorkflowId="w1"
        canRunSelectedWorkflow={false}
      />,
    );
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  });

  it('disables Edit and Delete buttons when running', () => {
    const workflows = [createWorkflow('w1')];
    render(
      <WorkflowLibraryModal
        {...defaultLibraryProps}
        workflows={workflows}
        selectedWorkflowId="w1"
        isRunningSelectedWorkflow={true}
      />,
    );
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });

  it('disables Edit and Run buttons when deleting', () => {
    const workflows = [createWorkflow('w1')];
    render(
      <WorkflowLibraryModal
        {...defaultLibraryProps}
        workflows={workflows}
        selectedWorkflowId="w1"
        isDeletingSelectedWorkflow={true}
      />,
    );
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  });

  it('falls back to first workflow when selectedWorkflowId is not in list', () => {
    const workflows = [createWorkflow('w1', { name: 'First Workflow' })];
    render(
      <WorkflowLibraryModal
        {...defaultLibraryProps}
        workflows={workflows}
        selectedWorkflowId="nonexistent"
      />,
    );
    expect(screen.getAllByText('First Workflow').length).toBeGreaterThanOrEqual(1);
  });

  it('shows relative time labels correctly', () => {
    const now = Date.now();
    const workflows = [
      createWorkflow('w1', { updatedAt: now - 30_000 }),
      createWorkflow('w2', { updatedAt: now - 120_000 }),
      createWorkflow('w3', { updatedAt: now - 3_600_000 }),
      createWorkflow('w4', { updatedAt: now - 90_000_000 }),
    ];
    render(
      <WorkflowLibraryModal
        {...defaultLibraryProps}
        workflows={workflows}
        selectedWorkflowId="w1"
      />,
    );
    expect(screen.getByText('Updated just now')).toBeInTheDocument();
    expect(screen.getByText('Updated 2 minutes ago')).toBeInTheDocument();
    expect(screen.getByText('Updated 1 hour ago')).toBeInTheDocument();
    expect(screen.getByText('Updated 1 day ago')).toBeInTheDocument();
  });

  it('shows singular action count for single action', () => {
    const workflows = [
      createWorkflow('w1', {
        actions: [{ action: { id: 'a1', type: 'click', selector: {} }, timestamp: Date.now() }],
      }),
    ];
    render(
      <WorkflowLibraryModal
        {...defaultLibraryProps}
        workflows={workflows}
        selectedWorkflowId="w1"
      />,
    );
    expect(screen.getAllByText('1 action').length).toBeGreaterThanOrEqual(1);
  });

  it('calls onOpenSaveWorkflow when save button is clicked in empty state', async () => {
    const user = userEvent.setup();
    const onOpenSaveWorkflow = vi.fn();
    render(
      <WorkflowLibraryModal
        {...defaultLibraryProps}
        workflows={[]}
        onOpenSaveWorkflow={onOpenSaveWorkflow}
      />,
    );
    const saveButtons = screen.getAllByRole('button', { name: /save/i });
    await user.click(saveButtons[saveButtons.length - 1]);
    expect(onOpenSaveWorkflow).toHaveBeenCalled();
  });

  it('shows 1 minute ago correctly', () => {
    const workflows = [createWorkflow('w1', { updatedAt: Date.now() - 60_000 })];
    render(
      <WorkflowLibraryModal
        {...defaultLibraryProps}
        workflows={workflows}
        selectedWorkflowId="w1"
      />,
    );
    expect(screen.getByText('Updated 1 minute ago')).toBeInTheDocument();
  });

  it('shows hours correctly', () => {
    const workflows = [createWorkflow('w1', { updatedAt: Date.now() - 7_200_000 })];
    render(
      <WorkflowLibraryModal
        {...defaultLibraryProps}
        workflows={workflows}
        selectedWorkflowId="w1"
      />,
    );
    expect(screen.getByText('Updated 2 hours ago')).toBeInTheDocument();
  });

  it('shows days correctly', () => {
    const workflows = [createWorkflow('w1', { updatedAt: Date.now() - 172_800_000 })];
    render(
      <WorkflowLibraryModal
        {...defaultLibraryProps}
        workflows={workflows}
        selectedWorkflowId="w1"
      />,
    );
    expect(screen.getByText('Updated 2 days ago')).toBeInTheDocument();
  });
});

describe('SaveWorkflowModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<SaveWorkflowModal {...defaultSaveProps} open={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders in create mode', () => {
    render(<SaveWorkflowModal {...defaultSaveProps} mode="create" />);
    expect(screen.getAllByText(/save workflow/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('5 actions')).toBeInTheDocument();
    expect(screen.getByText('Session 1')).toBeInTheDocument();
  });

  it('renders in edit mode', () => {
    render(<SaveWorkflowModal {...defaultSaveProps} mode="edit" />);
    expect(screen.getByText('Edit workflow')).toBeInTheDocument();
    expect(screen.getByText('Save changes')).toBeInTheDocument();
    expect(screen.getByText(/updates the saved workflow metadata/i)).toBeInTheDocument();
  });

  it('shows create mode description', () => {
    render(<SaveWorkflowModal {...defaultSaveProps} mode="create" />);
    expect(
      screen.getByText(/current recording snapshot becomes a saved workflow/i),
    ).toBeInTheDocument();
  });

  it('displays action count with singular form', () => {
    render(<SaveWorkflowModal {...defaultSaveProps} actionCount={1} />);
    expect(screen.getByText('1 action')).toBeInTheDocument();
  });

  it('shows name validation error inline', () => {
    render(<SaveWorkflowModal {...defaultSaveProps} error="Workflow name is required." />);
    expect(screen.getByText('Workflow name is required.')).toBeInTheDocument();
  });

  it('shows generic error as separate message', () => {
    render(<SaveWorkflowModal {...defaultSaveProps} error="Failed to save workflow" />);
    expect(screen.getByRole('status')).toHaveTextContent('Failed to save workflow');
  });

  it('does not show error banner for name validation error', () => {
    render(<SaveWorkflowModal {...defaultSaveProps} error="Workflow name is required." />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('calls onDraftChange when inputs change', async () => {
    const user = userEvent.setup();
    const onDraftChange = vi.fn();
    render(
      <SaveWorkflowModal
        {...defaultSaveProps}
        draft={{ name: '', description: '', tags: '' }}
        onDraftChange={onDraftChange}
      />,
    );

    const nameInput = screen.getByPlaceholderText('Checkout smoke test');
    await user.type(nameInput, 'a');
    expect(onDraftChange).toHaveBeenCalledWith({ name: 'a' });
  });

  it('calls onSave when save button is clicked', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<SaveWorkflowModal {...defaultSaveProps} onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: /save workflow/i }));
    expect(onSave).toHaveBeenCalled();
  });

  it('calls onClose when cancel button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SaveWorkflowModal {...defaultSaveProps} onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows no error banner when error is null', () => {
    render(<SaveWorkflowModal {...defaultSaveProps} error={null} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
