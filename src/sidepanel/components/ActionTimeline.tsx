import { Badge } from '@/ui/components';
import type { ActionLogEntry, ActionLogStatus } from './mockActionLog';

interface ActionTimelineProps {
  actions: ActionLogEntry[];
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
      return 'Pending';
  }
}

function getStatusIconClasses(status: ActionLogStatus): string {
  switch (status) {
    case 'running':
      return 'border-[rgb(var(--color-info-500)/0.25)] bg-[rgb(var(--color-info-50))] text-[rgb(var(--color-info-700))]';
    case 'done':
      return 'border-[rgb(var(--color-success-500)/0.25)] bg-[rgb(var(--color-success-50))] text-[rgb(var(--color-success-700))]';
    case 'failed':
      return 'border-[rgb(var(--color-error-500)/0.25)] bg-[rgb(var(--color-error-50))] text-[rgb(var(--color-error-700))]';
    default:
      return 'border-[rgb(var(--color-border-default))] bg-[rgb(var(--color-bg-primary))] text-[rgb(var(--color-text-tertiary))]';
  }
}

function StatusIcon({ status }: { status: ActionLogStatus }) {
  switch (status) {
    case 'running':
      return (
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="h-3.5 w-3.5"
        >
          <path d="M10 3.25a6.75 6.75 0 1 0 6.53 8.5" strokeLinecap="round" />
          <path d="M10 6.5v3.8l2.65 1.55" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'done':
      return (
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="h-3.5 w-3.5"
        >
          <path d="m5.75 10.25 2.5 2.5 6-6.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'failed':
      return (
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="h-3.5 w-3.5"
        >
          <path d="m6.25 6.25 7.5 7.5" strokeLinecap="round" />
          <path d="m13.75 6.25-7.5 7.5" strokeLinecap="round" />
        </svg>
      );
    default:
      return (
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="h-3.5 w-3.5"
        >
          <circle cx="10" cy="10" r="5.5" />
          <path d="M10 7.5v2.8l1.9 1.1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
  }
}

export function ActionTimeline({ actions }: ActionTimelineProps) {
  return (
    <ol aria-label="Executed actions timeline" className="space-y-3">
      {actions.map((action, index) => {
        const isLast = index === actions.length - 1;
        const statusLabel = getStatusLabel(action.status);

        return (
          <li
            key={action.id}
            className="relative pl-8"
            data-testid={`action-timeline-item-${action.id}`}
          >
            {!isLast ? (
              <span
                className="absolute left-[0.7rem] top-7 h-[calc(100%-0.75rem)] w-px bg-[rgb(var(--color-border-default))]"
                aria-hidden="true"
              />
            ) : null}

            <span
              className={`absolute left-0 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border shadow-sm ${getStatusIconClasses(action.status)}`}
              aria-hidden="true"
              data-status={action.status}
              data-testid={`action-timeline-icon-${action.id}`}
            >
              <StatusIcon status={action.status} />
            </span>

            <div className="rounded-2xl border border-[rgb(var(--color-border-default)/0.75)] bg-[rgb(var(--color-bg-secondary))] px-4 py-3 shadow-sm transition-shadow duration-200 hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold leading-snug tracking-tight text-[rgb(var(--color-text-primary))]">
                      {action.title}
                    </p>
                    {action.riskLevel === 'high' ? (
                      <Badge variant="error" size="sm">
                        High risk
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-[rgb(var(--color-text-secondary))]">
                    {action.detail}
                  </p>
                  {action.riskLevel === 'high' && action.riskReason ? (
                    <p className="mt-1 text-xs leading-relaxed text-[rgb(var(--color-error-700))]">
                      {action.riskReason}
                    </p>
                  ) : null}
                </div>

                <Badge variant={getStatusBadgeVariant(action.status)} size="md" dot>
                  {statusLabel}
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
  );
}

export { getStatusLabel };
export type { ActionTimelineProps };
