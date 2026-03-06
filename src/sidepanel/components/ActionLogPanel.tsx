import { useId, useState } from 'react';
import { Button } from '@/ui/components';
import { ActionTimeline } from './ActionTimeline';
import { MOCK_ACTION_LOG, type ActionLogEntry } from './mockActionLog';

interface ActionLogPanelProps {
  actions?: ActionLogEntry[];
  initiallyExpanded?: boolean;
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
                <ActionTimeline actions={actions} />
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
