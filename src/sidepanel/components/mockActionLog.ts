export type ActionLogStatus = 'pending' | 'running' | 'done' | 'failed';

export interface ActionLogEntry {
  id: string;
  title: string;
  detail: string;
  timeLabel: string;
  status: ActionLogStatus;
}

export const MOCK_ACTION_LOG: ActionLogEntry[] = [
  {
    id: 'log-1',
    title: 'Opened active tab context',
    detail: 'Connected to the current Chrome tab and collected page metadata.',
    timeLabel: '09:41',
    status: 'done',
  },
  {
    id: 'log-2',
    title: 'Scanned pricing cards',
    detail: 'Detected visible card groups before extraction started.',
    timeLabel: '09:42',
    status: 'failed',
  },
  {
    id: 'log-3',
    title: 'Formatting extracted output',
    detail: 'Preparing a structured response for the side panel conversation.',
    timeLabel: '09:43',
    status: 'running',
  },
  {
    id: 'log-4',
    title: 'Preparing handoff summary',
    detail: 'Queued to publish the next update after the current response completes.',
    timeLabel: '09:44',
    status: 'pending',
  },
];
