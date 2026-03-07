import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MessageBubble, type MessageBubbleProps } from '../MessageBubble';

describe('MessageBubble', () => {
  it('renders a right-aligned user bubble with timestamp', () => {
    const message: MessageBubbleProps = {
      id: 'user-1',
      variant: 'user',
      timestamp: '2026-03-06T09:41:00.000Z',
      text: 'Draft a reply for this page.',
    };

    render(<MessageBubble {...message} />);

    expect(screen.getByTestId('message-row-user')).toHaveClass('justify-end');
    expect(screen.getByTestId('message-bubble-user')).toHaveTextContent('Draft a reply for this page.');
    expect(screen.getByText('09:41')).toBeInTheDocument();
  });

  it('renders assistant markdown and invokes action buttons', async () => {
    const user = userEvent.setup();
    const onExtract = vi.fn();
    const message: MessageBubbleProps = {
      id: 'assistant-1',
      variant: 'assistant',
      timestamp: '2026-03-06T09:41:04.000Z',
      markdown: 'I found **3 tiers**.\n\n- Starter\n- Pro',
      actions: [{ id: 'extract', label: 'Extract JSON', buttonVariant: 'primary', onClick: onExtract }],
    };

    render(<MessageBubble {...message} />);

    expect(screen.getByText('3 tiers')).toBeInTheDocument();
    expect(screen.getByText('Starter')).toBeInTheDocument();
    expect(screen.getByText('Pro')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Extract JSON' }));
    expect(onExtract).toHaveBeenCalledTimes(1);
  });

  it('sanitizes javascript links and keeps safe markdown links hardened', () => {
    const message: MessageBubbleProps = {
      id: 'assistant-safe-1',
      variant: 'assistant',
      timestamp: '2026-03-06T09:41:04.000Z',
      markdown: '[Unsafe](javascript:alert(1)) [Safe](https://example.com)',
    };

    render(<MessageBubble {...message} />);

    const unsafeLink = screen.getByText('Unsafe').closest('a');
    expect(unsafeLink).not.toHaveAttribute('href');

    const safeLink = screen.getByText('Safe').closest('a');
    expect(safeLink).toHaveAttribute('href', 'https://example.com');
    expect(safeLink).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    expect(safeLink).toHaveAttribute('target', '_blank');
  });

  it('blocks protocol-relative links from assistant markdown', () => {
    const message: MessageBubbleProps = {
      id: 'assistant-safe-3',
      variant: 'assistant',
      timestamp: '2026-03-06T09:41:04.000Z',
      markdown: '[Sneaky](//evil.example)',
    };

    render(<MessageBubble {...message} />);

    const sneakyLink = screen.getByText('Sneaky').closest('a');
    expect(sneakyLink).not.toHaveAttribute('href');
  });

  it('strips embedded html and preserves safe markdown formatting', () => {
    const message: MessageBubbleProps = {
      id: 'assistant-safe-2',
      variant: 'assistant',
      timestamp: '2026-03-06T09:41:04.000Z',
      markdown: '<script>alert(1)</script><img src="https://evil.example/x.png" onerror="alert(1)" /><iframe src="https://evil.example"></iframe><svg onload="alert(1)"><circle /></svg>**Still safe**',
    };

    const { container } = render(<MessageBubble {...message} />);

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    expect(container).toHaveTextContent('Still safe');
  });

  it('renders action progress details and allows cancellation while running', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const message: MessageBubbleProps = {
      id: 'action-1',
      variant: 'action',
      timestamp: '2026-03-06T09:41:10.000Z',
      title: 'Running extraction',
      detail: 'Collecting visible pricing cards from the current tab.',
      progress: 66,
      currentStep: 2,
      totalSteps: 3,
      status: 'running',
      steps: [
        { id: 'scan', label: 'Scan visible page', status: 'completed' },
        { id: 'extract', label: 'Extract pricing blocks', status: 'running' },
        { id: 'format', label: 'Format structured output', status: 'pending' },
      ],
      onCancel,
    };

    render(<MessageBubble {...message} />);

    expect(screen.getByRole('progressbar', { name: 'Action progress' })).toHaveAttribute(
      'aria-valuenow',
      '66',
    );
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders error recovery actions inside an alert bubble', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const message: MessageBubbleProps = {
      id: 'error-1',
      variant: 'error',
      timestamp: '2026-03-06T09:41:18.000Z',
      title: 'Extraction failed',
      description: 'The page content changed before the pricing cards were captured.',
      errorCode: 'DOM_CHANGED',
      actions: [
        { id: 'retry', label: 'Retry', buttonVariant: 'primary', onClick: onRetry },
        { id: 'alternative', label: 'Try alternative', buttonVariant: 'secondary' },
        { id: 'report', label: 'Report issue', buttonVariant: 'ghost' },
      ],
    };

    render(<MessageBubble {...message} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Extraction failed');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try alternative' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Report issue' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
