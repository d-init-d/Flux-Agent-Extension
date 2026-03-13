import { create } from 'zustand';
import type { ActionLogEventEntry } from '@shared/types';
import type { ActionLogEntry } from '../components/ActionLogPanel';

function formatActionTimeLabel(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

interface ActionLogStoreState {
  entriesBySession: Record<string, ActionLogEntry[]>;
  applyProgressEvent: (payload: { sessionId: string; entry: ActionLogEventEntry }) => void;
}

function mapEventEntry(entry: ActionLogEventEntry): ActionLogEntry {
  return {
    id: entry.id,
    title: entry.title,
    detail: entry.detail,
    timeLabel: formatActionTimeLabel(entry.timestamp),
    status: entry.status,
    riskLevel: entry.riskLevel,
    riskReason: entry.riskReason,
  };
}

export const useActionLogStore = create<ActionLogStoreState>((set) => ({
  entriesBySession: {},
  applyProgressEvent: ({ sessionId, entry }) => {
    set((state) => {
      const existingEntries = state.entriesBySession[sessionId] ?? [];
      const mappedEntry = mapEventEntry(entry);
      const existingIndex = existingEntries.findIndex((item) => item.id === mappedEntry.id);
      const nextEntries = [...existingEntries];

      if (existingIndex === -1) {
        nextEntries.push(mappedEntry);
      } else {
        nextEntries[existingIndex] = mappedEntry;
      }

      return {
        entriesBySession: {
          ...state.entriesBySession,
          [sessionId]: nextEntries,
        },
      };
    });
  },
}));

export function resetActionLogStore(): void {
  useActionLogStore.setState({
    entriesBySession: {},
  });
}
