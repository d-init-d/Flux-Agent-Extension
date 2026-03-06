import type { MessageBubbleProps } from './MessageBubble';

const noop = () => undefined;

export const MOCK_CONVERSATION: MessageBubbleProps[] = [
  {
    id: 'm1',
    variant: 'user',
    timestamp: '2026-03-06T09:41:00.000Z',
    text: 'Open the current page and extract the pricing tiers.',
  },
  {
    id: 'm2',
    variant: 'assistant',
    timestamp: '2026-03-06T09:41:04.000Z',
    markdown:
      'I found **3 pricing tiers** on the page.\n\n- Starter - Free\n- Pro - $29/mo\n- Team - Contact sales\n\nWould you like me to extract them into JSON?',
    actions: [
      { id: 'copy-json', label: 'Extract JSON', buttonVariant: 'primary', onClick: noop },
      { id: 'show-steps', label: 'Show steps', buttonVariant: 'secondary', onClick: noop },
    ],
  },
  {
    id: 'm3',
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
    onCancel: noop,
  },
  {
    id: 'm4',
    variant: 'error',
    timestamp: '2026-03-06T09:41:18.000Z',
    title: 'Extraction failed',
    description: 'The page content changed before the pricing cards were captured.',
    errorCode: 'DOM_CHANGED',
    actions: [
      { id: 'retry', label: 'Retry', buttonVariant: 'primary', onClick: noop },
      { id: 'alternative', label: 'Try alternative', buttonVariant: 'secondary', onClick: noop },
      { id: 'report', label: 'Report issue', buttonVariant: 'ghost', onClick: noop },
    ],
  },
];
