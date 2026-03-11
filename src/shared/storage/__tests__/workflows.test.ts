import type { RecordedSessionAction, SavedWorkflow, SavedWorkflowCollection } from '@shared/types';

import { readStorage, seedStorage } from '@/test/helpers';

import {
  createDefaultSavedWorkflowCollection,
  getSavedWorkflowCollection,
  getSavedWorkflows,
  normalizeSavedWorkflowCollection,
  SAVED_WORKFLOWS_STORAGE_KEY,
  SAVED_WORKFLOWS_VERSION,
  setSavedWorkflowCollection,
  setSavedWorkflows,
} from '../workflows';

function createRecordedAction(overrides: Partial<RecordedSessionAction> = {}): RecordedSessionAction {
  return {
    action: {
      id: 'action-1',
      type: 'navigate',
      url: 'https://example.com',
    },
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

describe('workflow storage helpers', () => {
  it('creates an empty default collection', () => {
    expect(createDefaultSavedWorkflowCollection()).toEqual({
      version: SAVED_WORKFLOWS_VERSION,
      items: [],
    });
  });

  it('normalizes invalid persisted values back to defaults', () => {
    expect(normalizeSavedWorkflowCollection(null)).toEqual({
      version: SAVED_WORKFLOWS_VERSION,
      items: [],
    });
  });

  it('normalizes stored workflows with trimmed metadata and filtered actions', () => {
    const normalized = normalizeSavedWorkflowCollection({
      version: 4.9,
      items: [
        {
          id: ' workflow-1 ',
          name: '  Checkout flow  ',
          description: '  Completes checkout  ',
          tags: [' purchase ', 'checkout', 'purchase', '', 1],
          createdAt: 123.9,
          updatedAt: 456.4,
          actions: [
            createRecordedAction(),
            { action: { id: '', type: 'click' }, timestamp: 100 },
            { action: { id: 'action-2', type: 'click' }, timestamp: '100' },
          ],
          source: {
            sessionId: ' session-1 ',
            sessionName: '  Demo session ',
            recordedAt: 789.6,
          },
        },
      ],
    });

    expect(normalized).toEqual({
      version: 4,
      items: [
        {
          id: 'workflow-1',
          name: 'Checkout flow',
          description: 'Completes checkout',
          tags: ['purchase', 'checkout'],
          createdAt: 123,
          updatedAt: 456,
          actions: [createRecordedAction()],
          source: {
            sessionId: 'session-1',
            sessionName: 'Demo session',
            recordedAt: 789,
          },
        },
      ],
    });
  });

  it('loads and normalizes the saved workflow collection from chrome.storage.local', async () => {
    await seedStorage({
      [SAVED_WORKFLOWS_STORAGE_KEY]: {
        version: 1,
        items: [
          {
            id: 'workflow-1',
            name: '  Reusable flow ',
            tags: ['tag-1', ' tag-2 '],
            actions: [createRecordedAction()],
            createdAt: 10,
            updatedAt: 20,
          },
        ],
      },
    });

    await expect(getSavedWorkflowCollection()).resolves.toEqual({
      version: 1,
      items: [
        {
          id: 'workflow-1',
          name: 'Reusable flow',
          tags: ['tag-1', 'tag-2'],
          actions: [createRecordedAction()],
          createdAt: 10,
          updatedAt: 20,
          description: undefined,
          source: undefined,
        },
      ],
    });
  });

  it('redacts sensitive workflow action data before persistence', async () => {
    const stored = await setSavedWorkflowCollection({
      version: SAVED_WORKFLOWS_VERSION,
      items: [
        {
          id: 'workflow-sensitive',
          name: 'Sensitive workflow',
          tags: ['security'],
          actions: [
            createRecordedAction({
              action: {
                id: 'navigate-sensitive',
                type: 'navigate',
                url: 'https://example.com/users/alice@example.com',
              },
            }),
            createRecordedAction({
              action: {
                id: 'fill-email',
                type: 'fill',
                selector: { placeholder: 'Email address' },
                value: 'alice@example.com',
              },
              timestamp: 1_700_000_000_100,
            }),
          ],
          createdAt: 10,
          updatedAt: 20,
        },
      ],
    });

    expect(stored.items[0]?.actions).toEqual([
      {
        action: {
          id: 'navigate-sensitive',
          type: 'navigate',
          url: 'https://example.com/users/[REDACTED_EMAIL]',
        },
        timestamp: 1_700_000_000_000,
      },
      {
        action: {
          id: 'fill-email',
          type: 'fill',
          selector: { placeholder: 'Email address' },
          value: '[REDACTED_EMAIL]',
        },
        timestamp: 1_700_000_000_100,
      },
    ]);

    await expect(readStorage(SAVED_WORKFLOWS_STORAGE_KEY)).resolves.toEqual(stored);
  });

  it('persists normalized collections under the versioned savedWorkflows key', async () => {
    const value: SavedWorkflowCollection = {
      version: SAVED_WORKFLOWS_VERSION,
      items: [
        {
          id: ' workflow-2 ',
          name: '  Form fill  ',
          description: '  ',
          tags: [' forms ', 'forms', 'automation'],
          actions: [createRecordedAction()],
          createdAt: 100.8,
          updatedAt: 200.2,
        },
      ],
    };

    const stored = await setSavedWorkflowCollection(value);

    expect(stored).toEqual({
      version: SAVED_WORKFLOWS_VERSION,
      items: [
        {
          id: 'workflow-2',
          name: 'Form fill',
          description: undefined,
          tags: ['forms', 'automation'],
          actions: [createRecordedAction()],
          createdAt: 100,
          updatedAt: 200,
          source: undefined,
        },
      ],
    });

    await expect(readStorage(SAVED_WORKFLOWS_STORAGE_KEY)).resolves.toEqual(stored);
  });

  it('exposes convenience helpers for reading and writing workflow arrays', async () => {
    const workflows: SavedWorkflow[] = [
      {
        id: 'workflow-3',
        name: 'Export data',
        tags: ['exports'],
        actions: [createRecordedAction()],
        createdAt: 300,
        updatedAt: 400,
      },
    ];

    const collection = await setSavedWorkflows(workflows);

    expect(collection).toEqual({
      version: SAVED_WORKFLOWS_VERSION,
      items: [
        {
          id: 'workflow-3',
          name: 'Export data',
          tags: ['exports'],
          actions: [createRecordedAction()],
          createdAt: 300,
          updatedAt: 400,
          description: undefined,
          source: undefined,
        },
      ],
    });

    await expect(getSavedWorkflows()).resolves.toEqual(collection.items);
  });
});
