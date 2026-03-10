import type { RecordedSessionAction } from './session';

export interface SavedWorkflowSource {
  sessionId?: string;
  sessionName?: string;
  recordedAt?: number;
}

export interface SavedWorkflow {
  id: string;
  name: string;
  description?: string;
  actions: RecordedSessionAction[];
  tags: string[];
  createdAt: number;
  updatedAt: number;
  source?: SavedWorkflowSource;
}

export interface SavedWorkflowCollection {
  version: number;
  items: SavedWorkflow[];
}
