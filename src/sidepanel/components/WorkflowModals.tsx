import { Badge, Button, Input, Modal } from '@/ui/components';
import type { SavedWorkflow } from '@shared/types';
import type { WorkflowSaveDraft, WorkflowSaveMode, WorkflowViewMode } from '../store/workflowUIStore';

interface WorkflowLibraryModalProps {
  open: boolean;
  workflows: SavedWorkflow[];
  isHydrating: boolean;
  viewMode: WorkflowViewMode;
  selectedWorkflowId: string | null;
  canSaveCurrentSession: boolean;
  canRunSelectedWorkflow: boolean;
  isRunningSelectedWorkflow: boolean;
  isDeletingSelectedWorkflow: boolean;
  error: string | null;
  onClose: () => void;
  onOpenSaveWorkflow: () => void;
  onRunWorkflow: (workflowId: string) => void;
  onEditWorkflow: (workflowId: string) => void;
  onDeleteWorkflow: (workflowId: string) => void;
  onSelectWorkflow: (workflowId: string) => void;
  onViewModeChange: (mode: WorkflowViewMode) => void;
}

interface SaveWorkflowModalProps {
  open: boolean;
  mode: WorkflowSaveMode;
  draft: WorkflowSaveDraft;
  actionCount: number;
  sourceSessionName: string;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onDraftChange: (patch: Partial<WorkflowSaveDraft>) => void;
  onSave: () => void;
}

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp);
}

function getRelativeTimeLabel(timestamp: number): string {
  const diff = Date.now() - timestamp;

  if (diff < 60_000) {
    return 'Updated just now';
  }

  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) {
    return `Updated ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `Updated ${hours} hour${hours === 1 ? '' : 's'} ago`;
  }

  const days = Math.floor(hours / 24);
  return `Updated ${days} day${days === 1 ? '' : 's'} ago`;
}

function formatActionCount(actionCount: number): string {
  return `${actionCount} action${actionCount === 1 ? '' : 's'}`;
}

function getWorkflowSourceLabel(workflow: SavedWorkflow): string | null {
  if (workflow.source?.sessionName) {
    return workflow.source.sessionName;
  }

  if (workflow.source?.sessionId) {
    return `Session ${workflow.source.sessionId}`;
  }

  return null;
}

function ViewToggleButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={[
        'min-h-11 rounded-lg border px-3 text-sm font-medium transition-colors duration-fast',
        active
          ? 'border-primary-500 bg-primary-50 text-primary-700'
          : 'border-border bg-surface-primary text-content-secondary hover:border-primary-200 hover:text-content-primary',
      ].join(' ')}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function WorkflowCard({
  workflow,
  selected,
  viewMode,
  onSelect,
}: {
  workflow: SavedWorkflow;
  selected: boolean;
  viewMode: WorkflowViewMode;
  onSelect: () => void;
}) {
  const sourceLabel = getWorkflowSourceLabel(workflow);

  return (
    <button
      type="button"
      className={[
        'w-full rounded-2xl border p-4 text-left transition-all duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
        selected
          ? 'border-primary-500 bg-primary-50/60 shadow-sm'
          : 'border-border bg-surface-primary hover:border-primary-200 hover:shadow-lg',
        viewMode === 'list'
          ? 'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'
          : 'flex h-full flex-col gap-3',
      ].join(' ')}
      onClick={onSelect}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold leading-snug tracking-tight text-content-primary">
            {workflow.name}
          </h3>
          <Badge size="sm" variant="info">
            {formatActionCount(workflow.actions.length)}
          </Badge>
        </div>
        {workflow.description ? (
          <p className="mt-2 text-sm leading-relaxed text-content-secondary">{workflow.description}</p>
        ) : (
          <p className="mt-2 text-sm leading-relaxed text-content-tertiary">
            No description added yet.
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-content-tertiary">
          <span>{getRelativeTimeLabel(workflow.updatedAt)}</span>
          <span aria-hidden="true">•</span>
          <span title={formatTimestamp(workflow.updatedAt)}>{formatTimestamp(workflow.updatedAt)}</span>
          {sourceLabel ? (
            <>
              <span aria-hidden="true">•</span>
              <span>From {sourceLabel}</span>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:items-end">
        <div className="flex flex-wrap gap-2">
          {workflow.tags.length > 0 ? (
            workflow.tags.map((tag) => (
              <Badge key={tag} size="sm">
                {tag}
              </Badge>
            ))
          ) : (
            <Badge size="sm">No tags</Badge>
          )}
        </div>
      </div>
    </button>
  );
}

export function WorkflowLibraryModal({
  open,
  workflows,
  isHydrating,
  viewMode,
  selectedWorkflowId,
  canSaveCurrentSession,
  canRunSelectedWorkflow,
  isRunningSelectedWorkflow,
  isDeletingSelectedWorkflow,
  error,
  onClose,
  onOpenSaveWorkflow,
  onRunWorkflow,
  onEditWorkflow,
  onDeleteWorkflow,
  onSelectWorkflow,
  onViewModeChange,
}: WorkflowLibraryModalProps) {
  const selectedWorkflow = workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? workflows[0] ?? null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Saved workflows"
      description="Browse reusable recorded workflows, scan their metadata, and run or refine them from one place."
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface-secondary/60 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold tracking-tight text-content-primary">Workflow library</p>
            <p className="mt-1 text-sm leading-relaxed text-content-secondary">
              {workflows.length === 0
                ? 'No saved workflows yet. Capture a recording and save it here to start building a reusable library.'
                : `${workflows.length} saved workflow${workflows.length === 1 ? '' : 's'} ready to review.`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <ViewToggleButton
              label="Grid"
              active={viewMode === 'grid'}
              onClick={() => onViewModeChange('grid')}
            />
            <ViewToggleButton
              label="List"
              active={viewMode === 'list'}
              onClick={() => onViewModeChange('list')}
            />
            <Button
              type="button"
              variant="primary"
              size="md"
              className="min-h-11 px-4"
              disabled={!canSaveCurrentSession}
              onClick={onOpenSaveWorkflow}
            >
              Save current workflow
            </Button>
          </div>
        </div>

        {error ? (
          <div className="rounded-2xl border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-500" role="status">
            {error}
          </div>
        ) : null}

        {isHydrating ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface-primary px-4 py-10 text-center text-sm text-content-secondary">
            Loading saved workflows...
          </div>
        ) : workflows.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border bg-surface-primary px-6 py-10 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-50 text-primary-700">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
            </div>
            <h3 className="mt-4 text-base font-semibold tracking-tight text-content-primary">
              Your workflow library is empty
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-content-secondary">
              Save a recorded session to create a reusable workflow card with tags, action counts, and session context.
            </p>
            <div className="mt-5">
              <Button
                type="button"
                variant="primary"
                size="md"
                className="min-h-11 px-4"
                disabled={!canSaveCurrentSession}
                onClick={onOpenSaveWorkflow}
              >
                Save workflow
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)]">
            <div
              className={['grid gap-3', viewMode === 'grid' ? 'sm:grid-cols-2' : 'grid-cols-1'].join(' ')}
            >
              {workflows.map((workflow) => (
                <WorkflowCard
                  key={workflow.id}
                  workflow={workflow}
                  selected={workflow.id === selectedWorkflow?.id}
                  viewMode={viewMode}
                  onSelect={() => onSelectWorkflow(workflow.id)}
                />
              ))}
            </div>

            <aside className="rounded-2xl border border-border bg-surface-primary p-4 shadow-sm">
              {selectedWorkflow ? (
                <div className="flex h-full flex-col gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-content-tertiary">
                      Selected workflow
                    </p>
                    <h3 className="mt-2 text-lg font-semibold tracking-tight text-content-primary">
                      {selectedWorkflow.name}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-content-secondary">
                      {selectedWorkflow.description || 'This workflow is saved without a description.'}
                    </p>
                  </div>

                  <div className="grid gap-3 rounded-2xl bg-surface-secondary/70 p-3 text-sm text-content-secondary">
                    <div className="flex items-center justify-between gap-3">
                      <span>Actions</span>
                      <span className="font-medium text-content-primary">
                        {formatActionCount(selectedWorkflow.actions.length)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Updated</span>
                      <span className="font-medium text-content-primary">
                        {formatTimestamp(selectedWorkflow.updatedAt)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Source</span>
                      <span className="text-right font-medium text-content-primary">
                        {getWorkflowSourceLabel(selectedWorkflow) || 'Manual save'}
                      </span>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-content-tertiary">Tags</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {selectedWorkflow.tags.length > 0 ? (
                        selectedWorkflow.tags.map((tag) => (
                          <Badge key={tag} size="sm">
                            {tag}
                          </Badge>
                        ))
                      ) : (
                        <Badge size="sm">No tags</Badge>
                      )}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-content-tertiary">
                      Recorded steps preview
                    </p>
                    <ul className="mt-3 space-y-2 text-sm text-content-secondary">
                      {selectedWorkflow.actions.slice(0, 5).map((entry, index) => (
                        <li
                          key={entry.action.id}
                          className="flex items-start gap-3 rounded-xl border border-border bg-surface-secondary/50 px-3 py-2"
                        >
                          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-surface-primary text-xs font-semibold text-content-primary">
                            {index + 1}
                          </span>
                          <span className="min-w-0 break-words">{entry.action.type}</span>
                        </li>
                      ))}
                    </ul>
                    {selectedWorkflow.actions.length > 5 ? (
                      <p className="mt-3 text-xs text-content-tertiary">
                        +{selectedWorkflow.actions.length - 5} more saved steps
                      </p>
                    ) : null}
                  </div>

                  <div className="mt-auto rounded-2xl border border-border bg-surface-secondary/60 p-3">
                    <p className="text-sm font-medium text-content-primary">Use this workflow in the current session</p>
                    <p className="mt-1 text-sm leading-relaxed text-content-secondary">
                      Run loads these recorded steps into the selected session and starts playback immediately.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="md"
                        disabled={!canRunSelectedWorkflow || isDeletingSelectedWorkflow}
                        loading={isRunningSelectedWorkflow}
                        onClick={() => onRunWorkflow(selectedWorkflow.id)}
                      >
                        Run
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="md"
                        disabled={isRunningSelectedWorkflow || isDeletingSelectedWorkflow}
                        onClick={() => onEditWorkflow(selectedWorkflow.id)}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        size="md"
                        disabled={isRunningSelectedWorkflow || isDeletingSelectedWorkflow}
                        loading={isDeletingSelectedWorkflow}
                        onClick={() => onDeleteWorkflow(selectedWorkflow.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
            </aside>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function SaveWorkflowModal({
  open,
  mode,
  draft,
  actionCount,
  sourceSessionName,
  isSaving,
  error,
  onClose,
  onDraftChange,
  onSave,
}: SaveWorkflowModalProps) {
  const isEditing = mode === 'edit';

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={isEditing ? 'Edit workflow' : 'Save workflow'}
      description={
        isEditing
          ? 'Update the workflow name, description, and tags while keeping the recorded steps intact.'
          : 'Turn the current recorded session into a reusable saved workflow card for the library.'
      }
      footer={
        <>
          <Button type="button" variant="ghost" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="primary" size="md" loading={isSaving} onClick={onSave}>
            {isEditing ? 'Save changes' : 'Save workflow'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-2xl border border-border bg-surface-secondary/70 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge size="sm" variant="info">
              {formatActionCount(actionCount)}
            </Badge>
            <Badge size="sm">{sourceSessionName}</Badge>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-content-secondary">
            {isEditing
              ? 'This updates the saved workflow metadata in place without replacing its recorded action sequence.'
              : 'The current recording snapshot becomes a saved workflow entry. You can review it in grid or list mode right after saving.'}
          </p>
        </div>

        <Input
          label="Workflow name"
          value={draft.name}
          inputSize="lg"
          placeholder="Checkout smoke test"
          errorMessage={error === 'Workflow name is required.' ? error : undefined}
          onChange={(event) => onDraftChange({ name: event.target.value })}
        />

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-content-primary">Description</span>
          <textarea
            value={draft.description}
            rows={4}
            className="w-full rounded-lg border border-border bg-surface-primary px-3 py-3 text-sm leading-relaxed text-content-primary placeholder:text-content-tertiary focus:outline-none focus:ring-2 focus:ring-border-focus"
            placeholder="What this workflow helps you automate"
            onChange={(event) => onDraftChange({ description: event.target.value })}
          />
        </label>

        <Input
          label="Tags"
          value={draft.tags}
          inputSize="lg"
          placeholder="qa, onboarding, billing"
          helperText="Separate tags with commas to create quick filters later."
          onChange={(event) => onDraftChange({ tags: event.target.value })}
        />

        {error && error !== 'Workflow name is required.' ? (
          <p role="status" className="text-sm text-error-500">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
