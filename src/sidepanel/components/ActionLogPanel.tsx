import { useId, useState } from 'react';
import { Badge, Button } from '@/ui/components';
import { MOCK_ACTION_LOG, type ActionLogEntry, type ActionLogStatus } from './mockActionLog';

interface ActionLogPanelProps {
  actions?: ActionLogEntry[];
  initiallyExpanded?: boolean;
}

function getStatusBadgeVariant(status: ActionLogStatus): 'default' | 'info' | 'success' | 'error' {
  switch (status) {
    case 'running':
      return 'info';
    case 'done':
      return 'success';
    case 'failed':
      return 'error';
    default:
      return 'default';
  }
}

function getStatusLabel(status: ActionLogStatus): string {
  switch (status) {
    case 'done':
      return 'Completed';
    case 'running':
      return 'Running';
    case 'failed':
      return 'Failed';
    default:
      return 'Queued';
  }
}

function getCollapsedSummary(actions: ActionLogEntry[]): string {
  if (actions.length === 0) {
    return 'No actions yet. Executed steps will appear here once a workflow runs.';
  }

  const latestAction = actions[actions.length - 1];
  const runningCount = actions.filter((action) => action.status === 'running').length;

  if (runningCount > 0) {
    return `${actions.length} recent actions, ${runningCount} still running. Latest: ${latestAction.title}.`;
  }

  return `${actions.length} recent actions. Latest: ${latestAction.title}.`;
}

function ToggleIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={`h-4 w-4 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
      aria-hidden="true"
    >
      <path d="m5 8 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ActionLogPanel({
  actions = MOCK_ACTION_LOG,
  initiallyExpanded = false,
}: ActionLogPanelProps) {
  const [isExpanded, setIsExpanded] = useState(initiallyExpanded);
  const panelId = useId();

  return (
    <section
      aria-label="Action log"
      className="border-b border-[rgb(var(--color-border-default))] bg-[rgb(var(--color-bg-secondary)/0.82)] px-4 py-3 sm:px-6"
      data-testid="sidepanel-action-log"
    >
      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-2xl border border-[rgb(var(--color-border-default)/0.8)] bg-[rgb(var(--color-bg-primary))] shadow-sm">
          <div className="flex items-start justify-between gap-3 px-4 py-4 sm:px-5">
            <div>
              <p className="text-sm font-semibold leading-snug tracking-tight text-[rgb(var(--color-text-primary))]">
                Action log
              </p>
              <p className="mt-1 text-xs leading-snug text-[rgb(var(--color-text-secondary))]">
                Timeline of executed workflow steps in this session.
              </p>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="md"
              className="min-h-11 shrink-0 px-3"
              aria-expanded={isExpanded}
              aria-controls={panelId}
              aria-label={isExpanded ? 'Collapse action log' : 'Expand action log'}
              iconRight={<ToggleIcon expanded={isExpanded} />}
              onClick={() => setIsExpanded((current) => !current)}
            >
              {isExpanded ? 'Hide log' : 'Show log'}
            </Button>
          </div>

          {isExpanded ? (
            <div id={panelId} className="border-t border-[rgb(var(--color-border-default)/0.8)] px-4 py-4 sm:px-5">
              {actions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[rgb(var(--color-border-default))] bg-[rgb(var(--color-bg-secondary))] px-5 py-8 text-center">
                  <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[rgb(var(--color-primary-100))] text-[rgb(var(--color-primary-700))]">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      className="h-5 w-5"
                      aria-hidden="true"
                    >
                      <path d="M6.75 4.75h10.5a2 2 0 0 1 2 2v10.5a2 2 0 0 1-2 2H6.75a2 2 0 0 1-2-2V6.75a2 2 0 0 1 2-2Z" />
                      <path d="M8.5 9.25h7" strokeLinecap="round" />
                      <path d="M8.5 12h7" strokeLinecap="round" />
                      <path d="M8.5 14.75h4.5" strokeLinecap="round" />
                    </svg>
                  </div>
                  <h2 className="mt-4 text-base font-semibold leading-snug tracking-tight text-[rgb(var(--color-text-primary))]">
                    No actions yet
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-[rgb(var(--color-text-secondary))]">
                    Executed actions will appear here as a readable timeline once the agent starts working.
                  </p>
                </div>
              ) : (
                <ol aria-label="Executed actions timeline" className="space-y-3">
                  {actions.map((action, index) => {
                    const isLast = index === actions.length - 1;

                    return (
                      <li key={action.id} className="relative pl-8">
                        {!isLast ? (
                          <span
                            className="absolute left-[0.7rem] top-7 h-[calc(100%-0.75rem)] w-px bg-[rgb(var(--color-border-default))]"
                            aria-hidden="true"
                          />
                        ) : null}

                        <span
                          className="absolute left-0 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-[rgb(var(--color-border-default))] bg-[rgb(var(--color-bg-primary))]"
                          aria-hidden="true"
                        >
                          <span className="h-2.5 w-2.5 rounded-full bg-[rgb(var(--color-primary-600))]" />
                        </span>

                        <div className="rounded-2xl border border-[rgb(var(--color-border-default)/0.75)] bg-[rgb(var(--color-bg-secondary))] px-4 py-3 shadow-sm transition-shadow duration-200 hover:shadow-md">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold leading-snug tracking-tight text-[rgb(var(--color-text-primary))]">
                                {action.title}
                              </p>
                              <p className="mt-1 text-sm leading-relaxed text-[rgb(var(--color-text-secondary))]">
                                {action.detail}
                              </p>
                            </div>

                            <Badge variant={getStatusBadgeVariant(action.status)} size="md" dot>
                              {getStatusLabel(action.status)}
                            </Badge>
                          </div>

                          <p className="mt-3 text-xs font-medium tracking-tight text-[rgb(var(--color-text-tertiary))]">
                            {action.timeLabel}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          ) : (
            <div
              id={panelId}
              hidden
              className="border-t border-[rgb(var(--color-border-default)/0.8)] px-4 py-4 sm:px-5"
            />
          )}

          {!isExpanded ? (
            <div className="border-t border-[rgb(var(--color-border-default)/0.8)] px-4 py-3 sm:px-5">
              <p className="text-sm leading-relaxed text-[rgb(var(--color-text-secondary))]">
                {getCollapsedSummary(actions)}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export { MOCK_ACTION_LOG };
export type { ActionLogEntry, ActionLogPanelProps };
