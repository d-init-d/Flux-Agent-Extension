import { ReactNode } from 'react';
import DOMPurify from 'dompurify';
import { isValid } from 'date-fns';
import { marked } from 'marked';
import { Badge, Button, type ButtonVariant } from '@/ui/components';

const SAFE_MARKDOWN_TAGS = ['a', 'blockquote', 'br', 'code', 'em', 'li', 'ol', 'p', 'pre', 'strong', 'ul'];
const SAFE_MARKDOWN_ATTRS = ['href', 'title'];
const SAFE_HREF_PATTERN = /^(?:https?:|mailto:|#|\/(?!\/))/i;

type MessageVariant = 'user' | 'assistant' | 'action' | 'error';
type ActionStepStatus = 'pending' | 'running' | 'completed' | 'failed';
type ActionBubbleStatus = 'running' | 'completed' | 'failed';

interface MessageAction {
  id: string;
  label: string;
  icon?: ReactNode;
  buttonVariant?: Extract<ButtonVariant, 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'>;
  disabled?: boolean;
  ariaLabel?: string;
  onClick?: () => void;
}

interface ActionStep {
  id: string;
  label: string;
  status: ActionStepStatus;
}

interface BaseMessageBubbleProps {
  id: string;
  variant: MessageVariant;
  timestamp: string;
}

interface UserMessageBubbleProps extends BaseMessageBubbleProps {
  variant: 'user';
  text: string;
}

interface AssistantMessageBubbleProps extends BaseMessageBubbleProps {
  variant: 'assistant';
  markdown: string;
  actions?: MessageAction[];
  isStreaming?: boolean;
}

interface ActionMessageBubbleProps extends BaseMessageBubbleProps {
  variant: 'action';
  title: string;
  detail?: string;
  progress: number;
  currentStep: number;
  totalSteps: number;
  steps: ActionStep[];
  status: ActionBubbleStatus;
  onCancel?: () => void;
}

interface ErrorMessageBubbleProps extends BaseMessageBubbleProps {
  variant: 'error';
  title: string;
  description: string;
  errorCode?: string;
  actions: MessageAction[];
}

export type MessageBubbleProps =
  | UserMessageBubbleProps
  | AssistantMessageBubbleProps
  | ActionMessageBubbleProps
  | ErrorMessageBubbleProps;

function formatMessageTimestamp(timestamp: string): string {
  const date = new Date(timestamp);

  if (!isValid(date)) {
    return timestamp;
  }

  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

function renderMarkdown(markdown: string): string {
  const parsed = marked.parse(markdown, {
    async: false,
    breaks: true,
    gfm: true,
  });

  const sanitized = DOMPurify.sanitize(parsed, {
    ALLOWED_TAGS: SAFE_MARKDOWN_TAGS,
    ALLOWED_ATTR: SAFE_MARKDOWN_ATTRS,
    FORBID_TAGS: ['embed', 'form', 'iframe', 'img', 'input', 'math', 'object', 'style', 'svg', 'video'],
    FORBID_ATTR: ['srcset'],
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[#/])/i,
  });

  const template = document.createElement('template');
  template.innerHTML = sanitized;

  for (const anchor of template.content.querySelectorAll('a')) {
    const href = anchor.getAttribute('href')?.trim() ?? '';

    if (!SAFE_HREF_PATTERN.test(href)) {
      anchor.removeAttribute('href');
    } else {
      anchor.setAttribute('rel', 'noopener noreferrer nofollow');
      anchor.setAttribute('target', '_blank');
    }
  }

  return template.innerHTML;
}

function getActionStepBadgeVariant(status: ActionStepStatus): 'default' | 'info' | 'success' | 'error' {
  switch (status) {
    case 'running':
      return 'info';
    case 'completed':
      return 'success';
    case 'failed':
      return 'error';
    default:
      return 'default';
  }
}

function getActionStatusBadgeVariant(status: ActionBubbleStatus): 'info' | 'success' | 'error' {
  switch (status) {
    case 'completed':
      return 'success';
    case 'failed':
      return 'error';
    default:
      return 'info';
  }
}

function getBubbleSurfaceClasses(variant: MessageVariant): string {
  switch (variant) {
    case 'user':
      return 'border border-[rgb(var(--color-primary-700)/0.3)] bg-[rgb(var(--color-primary-600))] text-[rgb(var(--color-text-inverse))] shadow-sm';
    case 'assistant':
      return 'border border-[rgb(var(--color-border-default))] bg-[rgb(var(--color-bg-secondary))] text-[rgb(var(--color-text-primary))] shadow-sm';
    case 'action':
      return 'border border-[rgb(var(--color-border-default))] bg-[rgb(var(--color-bg-secondary))] text-[rgb(var(--color-text-primary))] shadow-sm';
    case 'error':
      return 'border border-[rgb(var(--color-error-500)/0.2)] bg-[rgb(var(--color-error-50))] text-[rgb(var(--color-error-700))] shadow-sm';
  }
}

function MessageTimestamp({ timestamp, align = 'left' }: { timestamp: string; align?: 'left' | 'right' }) {
  return (
    <time
      dateTime={timestamp}
      className={`mt-2 block text-[11px] font-medium tracking-tight ${
        align === 'right' ? 'text-right text-white/75' : 'text-[rgb(var(--color-text-tertiary))]'
      }`}
    >
      {formatMessageTimestamp(timestamp)}
    </time>
  );
}

function MessageActions({ actions }: { actions: MessageAction[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {actions.map((action) => (
        <Button
          key={action.id}
          type="button"
          size="md"
          variant={action.buttonVariant ?? 'secondary'}
          disabled={action.disabled}
          aria-label={action.ariaLabel}
          className="min-h-11"
          onClick={action.onClick}
        >
          {action.icon}
          {action.label}
        </Button>
      ))}
    </div>
  );
}

function MarkdownContent({ markdown }: { markdown: string }) {
  return (
    <div
      className="space-y-3 text-sm leading-relaxed tracking-tight [&_a]:font-medium [&_a]:text-[rgb(var(--color-text-link))] [&_code]:rounded [&_code]:bg-black/5 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] [&_li]:ml-4 [&_li]:list-disc [&_li]:pl-1 [&_ol]:space-y-1 [&_ol]:pl-5 [&_p]:m-0 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-slate-950 [&_pre]:p-3 [&_pre]:text-slate-100 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:space-y-1 [&_ul]:pl-5"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
    />
  );
}

function ActionBubbleContent({ message }: { message: ActionMessageBubbleProps }) {
  const isRunning = message.status === 'running';

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold tracking-tight">{message.title}</p>
          {message.detail ? (
            <p className="mt-1 text-sm leading-snug text-[rgb(var(--color-text-secondary))]">{message.detail}</p>
          ) : null}
        </div>

        <Badge variant={getActionStatusBadgeVariant(message.status)} size="md" dot>
          {message.status}
        </Badge>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between gap-3 text-xs font-medium tracking-tight text-[rgb(var(--color-text-secondary))]">
          <span>{`Step ${message.currentStep} of ${message.totalSteps}`}</span>
          <span>{`${message.progress}%`}</span>
        </div>

        <div
          className="h-2 overflow-hidden rounded-full bg-[rgb(var(--color-border-default)/0.35)]"
          role="progressbar"
          aria-label="Action progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={message.progress}
        >
          <div
            className="h-full rounded-full bg-[rgb(var(--color-primary-600))] transition-all duration-300"
            style={{ width: `${Math.max(0, Math.min(message.progress, 100))}%` }}
          />
        </div>
      </div>

      <ol className="mt-4 space-y-2">
        {message.steps.map((step) => (
          <li
            key={step.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-[rgb(var(--color-border-default)/0.55)] bg-[rgb(var(--color-bg-primary))] px-3 py-2"
          >
            <span className="text-sm leading-snug tracking-tight">{step.label}</span>
            <Badge variant={getActionStepBadgeVariant(step.status)} dot>
              {step.status}
            </Badge>
          </li>
        ))}
      </ol>

      <div className="mt-4 flex justify-end">
        <Button
          type="button"
          size="md"
          variant="ghost"
          className="min-h-11"
          onClick={message.onCancel}
          disabled={!isRunning}
        >
          Cancel
        </Button>
      </div>
    </>
  );
}

function ErrorBubbleContent({ message }: { message: ErrorMessageBubbleProps }) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold tracking-tight">{message.title}</p>
          <p className="mt-1 text-sm leading-snug text-[rgb(var(--color-error-700)/0.82)]">
            {message.description}
          </p>
        </div>

        {message.errorCode ? (
          <Badge variant="error" size="md">
            {message.errorCode}
          </Badge>
        ) : null}
      </div>

      <MessageActions actions={message.actions} />
    </>
  );
}

export function MessageBubble(message: MessageBubbleProps) {
  const isUser = message.variant === 'user';

  return (
    <div
      className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}
      data-testid={`message-row-${message.variant}`}
    >
      <article
        className={`w-full max-w-[88%] rounded-2xl px-4 py-3 sm:max-w-[78%] ${getBubbleSurfaceClasses(message.variant)} [animation:slide-in-from-bottom_220ms_ease-out_both]`}
        data-testid={`message-bubble-${message.variant}`}
        role={message.variant === 'error' ? 'alert' : undefined}
      >
        {message.variant === 'user' ? (
          <>
            <p className="m-0 text-sm leading-relaxed tracking-tight text-white">{message.text}</p>
            <MessageTimestamp timestamp={message.timestamp} align="right" />
          </>
        ) : null}

        {message.variant === 'assistant' ? (
          <>
            <MarkdownContent markdown={message.markdown} />
            {message.actions?.length ? <MessageActions actions={message.actions} /> : null}
            <MessageTimestamp timestamp={message.timestamp} />
          </>
        ) : null}

        {message.variant === 'action' ? (
          <>
            <ActionBubbleContent message={message} />
            <MessageTimestamp timestamp={message.timestamp} />
          </>
        ) : null}

        {message.variant === 'error' ? (
          <>
            <ErrorBubbleContent message={message} />
            <MessageTimestamp timestamp={message.timestamp} />
          </>
        ) : null}
      </article>
    </div>
  );
}

export type { MessageAction, ActionStep, ActionStepStatus, MessageVariant, ActionBubbleStatus };
