import type {
  RecordedSessionAction,
  SavedWorkflow,
  SavedWorkflowCollection,
  SavedWorkflowSource,
} from '@shared/types';

import { redactPII } from '@shared/security';
import { generateId } from '@shared/utils/id';

export const SAVED_WORKFLOWS_STORAGE_KEY = 'savedWorkflows' as const;
export const SAVED_WORKFLOWS_VERSION = 1;

const DEFAULT_WORKFLOW_NAME = 'Untitled workflow';

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const tags = value
    .map((tag) => normalizeString(tag))
    .filter((tag): tag is string => tag !== undefined);

  return Array.from(new Set(tags));
}

function isRecordedWorkflowAction(value: unknown): value is RecordedSessionAction['action'] {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<RecordedSessionAction['action']>;

  return (
    typeof candidate.id === 'string' &&
    candidate.id.trim().length > 0 &&
    typeof candidate.type === 'string' &&
    candidate.type.trim().length > 0
  );
}

function normalizeRecordedSessionAction(value: unknown): RecordedSessionAction | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<RecordedSessionAction>;

  if (!isRecordedWorkflowAction(candidate.action)) {
    return null;
  }

  if (typeof candidate.timestamp !== 'number' || !Number.isFinite(candidate.timestamp)) {
    return null;
  }

  return {
    action: JSON.parse(
      redactPII(JSON.stringify(candidate.action)),
    ) as RecordedSessionAction['action'],
    timestamp: Math.trunc(candidate.timestamp),
  };
}

function normalizeWorkflowSource(value: unknown): SavedWorkflowSource | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<SavedWorkflowSource>;
  const sessionId = normalizeString(candidate.sessionId);
  const sessionName = normalizeString(candidate.sessionName);
  const recordedAt =
    typeof candidate.recordedAt === 'number' && Number.isFinite(candidate.recordedAt)
      ? Math.trunc(candidate.recordedAt)
      : undefined;

  if (!sessionId && !sessionName && recordedAt === undefined) {
    return undefined;
  }

  return {
    sessionId,
    sessionName,
    recordedAt,
  };
}

function normalizeSavedWorkflow(value: unknown, index = 0): SavedWorkflow | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<SavedWorkflow>;
  const now = Date.now();
  const createdAt = normalizeTimestamp(candidate.createdAt, now);
  const updatedAt = normalizeTimestamp(candidate.updatedAt, createdAt);
  const actions = Array.isArray(candidate.actions)
    ? candidate.actions
        .map((action) => normalizeRecordedSessionAction(action))
        .filter((action): action is RecordedSessionAction => action !== null)
    : [];

  return {
    id: normalizeString(candidate.id) ?? generateId(),
    name:
      normalizeString(candidate.name) ??
      `${DEFAULT_WORKFLOW_NAME}${index > 0 ? ` ${index + 1}` : ''}`,
    description: normalizeString(candidate.description),
    actions,
    tags: normalizeTags(candidate.tags),
    createdAt,
    updatedAt,
    source: normalizeWorkflowSource(candidate.source),
  };
}

export function createDefaultSavedWorkflowCollection(): SavedWorkflowCollection {
  return {
    version: SAVED_WORKFLOWS_VERSION,
    items: [],
  };
}

export function normalizeSavedWorkflowCollection(value: unknown): SavedWorkflowCollection {
  const defaults = createDefaultSavedWorkflowCollection();

  if (!value || typeof value !== 'object') {
    return defaults;
  }

  const candidate = value as Partial<SavedWorkflowCollection>;
  const items = Array.isArray(candidate.items)
    ? candidate.items
        .map((item, index) => normalizeSavedWorkflow(item, index))
        .filter((item): item is SavedWorkflow => item !== null)
    : defaults.items;

  return {
    version:
      typeof candidate.version === 'number' ? Math.trunc(candidate.version) : defaults.version,
    items,
  };
}

export async function getSavedWorkflowCollection(): Promise<SavedWorkflowCollection> {
  const defaults = createDefaultSavedWorkflowCollection();
  const stored = await chrome.storage.local.get({
    [SAVED_WORKFLOWS_STORAGE_KEY]: defaults,
  });

  return normalizeSavedWorkflowCollection(stored[SAVED_WORKFLOWS_STORAGE_KEY]);
}

export async function setSavedWorkflowCollection(
  value: SavedWorkflowCollection,
): Promise<SavedWorkflowCollection> {
  const normalized = normalizeSavedWorkflowCollection(value);

  await chrome.storage.local.set({
    [SAVED_WORKFLOWS_STORAGE_KEY]: normalized,
  });

  return normalized;
}

export async function getSavedWorkflows(): Promise<SavedWorkflow[]> {
  const collection = await getSavedWorkflowCollection();
  return collection.items;
}

export async function setSavedWorkflows(items: SavedWorkflow[]): Promise<SavedWorkflowCollection> {
  return setSavedWorkflowCollection({
    version: SAVED_WORKFLOWS_VERSION,
    items,
  });
}
