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

function createRecordedAction(
  overrides: Partial<RecordedSessionAction> = {},
): RecordedSessionAction {
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

  // ==========================================================================
  // Normalization edge cases for branch coverage
  // ==========================================================================

  describe('normalizeSavedWorkflowCollection — additional edge cases', () => {
    it('should return defaults for undefined input', () => {
      expect(normalizeSavedWorkflowCollection(undefined)).toEqual({
        version: SAVED_WORKFLOWS_VERSION,
        items: [],
      });
    });

    it('should return defaults for string input', () => {
      expect(normalizeSavedWorkflowCollection('not-an-object')).toEqual({
        version: SAVED_WORKFLOWS_VERSION,
        items: [],
      });
    });

    it('should handle non-array items field', () => {
      expect(normalizeSavedWorkflowCollection({ items: 'not-array', version: 1 })).toEqual({
        version: 1,
        items: [],
      });
    });

    it('should handle non-number version field', () => {
      expect(normalizeSavedWorkflowCollection({ items: [], version: 'abc' })).toEqual({
        version: SAVED_WORKFLOWS_VERSION,
        items: [],
      });
    });

    it('should skip null items in the array', () => {
      const result = normalizeSavedWorkflowCollection({
        version: 1,
        items: [null, undefined, 'string', 42],
      });
      expect(result.items).toEqual([]);
    });

    it('should generate id when workflow has no id', () => {
      const result = normalizeSavedWorkflowCollection({
        version: 1,
        items: [
          {
            name: 'No ID workflow',
            actions: [createRecordedAction()],
            createdAt: 100,
            updatedAt: 200,
          },
        ],
      });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBeTruthy();
      expect(result.items[0].name).toBe('No ID workflow');
    });

    it('should generate default name when workflow has no name', () => {
      const result = normalizeSavedWorkflowCollection({
        version: 1,
        items: [
          {
            id: 'w1',
            actions: [],
            createdAt: 100,
            updatedAt: 200,
          },
        ],
      });
      expect(result.items[0].name).toBe('Untitled workflow');
    });

    it('should append index to default name for subsequent unnamed workflows', () => {
      const result = normalizeSavedWorkflowCollection({
        version: 1,
        items: [
          { id: 'w1', actions: [], createdAt: 100, updatedAt: 200 },
          { id: 'w2', actions: [], createdAt: 100, updatedAt: 200 },
        ],
      });
      expect(result.items[0].name).toBe('Untitled workflow');
      expect(result.items[1].name).toBe('Untitled workflow 2');
    });

    it('should handle action with missing action field', () => {
      const result = normalizeSavedWorkflowCollection({
        version: 1,
        items: [
          {
            id: 'w1',
            name: 'Test',
            actions: [
              { timestamp: 100 },
              { action: null, timestamp: 100 },
              { action: { id: 'a1', type: 'click' }, timestamp: 100 },
            ],
            createdAt: 100,
            updatedAt: 200,
          },
        ],
      });
      expect(result.items[0].actions).toHaveLength(1);
    });

    it('should handle action with non-finite timestamp', () => {
      const result = normalizeSavedWorkflowCollection({
        version: 1,
        items: [
          {
            id: 'w1',
            name: 'Test',
            actions: [
              { action: { id: 'a1', type: 'click' }, timestamp: NaN },
              { action: { id: 'a2', type: 'click' }, timestamp: Infinity },
            ],
            createdAt: 100,
            updatedAt: 200,
          },
        ],
      });
      expect(result.items[0].actions).toHaveLength(0);
    });

    it('should normalize source with only sessionId', () => {
      const result = normalizeSavedWorkflowCollection({
        version: 1,
        items: [
          {
            id: 'w1',
            name: 'Test',
            actions: [],
            createdAt: 100,
            updatedAt: 200,
            source: { sessionId: ' s1 ' },
          },
        ],
      });
      expect(result.items[0].source).toEqual({
        sessionId: 's1',
        sessionName: undefined,
        recordedAt: undefined,
      });
    });

    it('should normalize source with only recordedAt', () => {
      const result = normalizeSavedWorkflowCollection({
        version: 1,
        items: [
          {
            id: 'w1',
            name: 'Test',
            actions: [],
            createdAt: 100,
            updatedAt: 200,
            source: { recordedAt: 500.7 },
          },
        ],
      });
      expect(result.items[0].source).toEqual({
        sessionId: undefined,
        sessionName: undefined,
        recordedAt: 500,
      });
    });

    it('should return undefined source when all source fields are empty', () => {
      const result = normalizeSavedWorkflowCollection({
        version: 1,
        items: [
          {
            id: 'w1',
            name: 'Test',
            actions: [],
            createdAt: 100,
            updatedAt: 200,
            source: { sessionId: '   ', sessionName: '', recordedAt: NaN },
          },
        ],
      });
      expect(result.items[0].source).toBeUndefined();
    });

    it('should return undefined source for non-object source', () => {
      const result = normalizeSavedWorkflowCollection({
        version: 1,
        items: [
          {
            id: 'w1',
            name: 'Test',
            actions: [],
            createdAt: 100,
            updatedAt: 200,
            source: 'not-object',
          },
        ],
      });
      expect(result.items[0].source).toBeUndefined();
    });

    it('should use fallback timestamp for non-number createdAt', () => {
      const before = Date.now();
      const result = normalizeSavedWorkflowCollection({
        version: 1,
        items: [
          {
            id: 'w1',
            name: 'Test',
            actions: [],
            createdAt: 'not-a-number',
            updatedAt: 'also-not',
          },
        ],
      });
      const after = Date.now();
      expect(result.items[0].createdAt).toBeGreaterThanOrEqual(before);
      expect(result.items[0].createdAt).toBeLessThanOrEqual(after);
      expect(result.items[0].updatedAt).toBe(result.items[0].createdAt);
    });

    it('should handle tags with non-string elements', () => {
      const result = normalizeSavedWorkflowCollection({
        version: 1,
        items: [
          {
            id: 'w1',
            name: 'Test',
            actions: [],
            createdAt: 100,
            updatedAt: 200,
            tags: [1, null, undefined, true, 'valid', ' trimmed '],
          },
        ],
      });
      expect(result.items[0].tags).toEqual(['valid', 'trimmed']);
    });

    it('should handle non-array tags', () => {
      const result = normalizeSavedWorkflowCollection({
        version: 1,
        items: [
          {
            id: 'w1',
            name: 'Test',
            actions: [],
            createdAt: 100,
            updatedAt: 200,
            tags: 'not-array',
          },
        ],
      });
      expect(result.items[0].tags).toEqual([]);
    });

    it('should handle action with empty string id or type', () => {
      const result = normalizeSavedWorkflowCollection({
        version: 1,
        items: [
          {
            id: 'w1',
            name: 'Test',
            actions: [
              { action: { id: '', type: 'click' }, timestamp: 100 },
              { action: { id: 'a1', type: '' }, timestamp: 100 },
              { action: { id: '  ', type: 'click' }, timestamp: 100 },
              { action: { id: 'a2', type: '  ' }, timestamp: 100 },
            ],
            createdAt: 100,
            updatedAt: 200,
          },
        ],
      });
      expect(result.items[0].actions).toHaveLength(0);
    });

    it('should handle non-array actions field', () => {
      const result = normalizeSavedWorkflowCollection({
        version: 1,
        items: [
          {
            id: 'w1',
            name: 'Test',
            actions: 'not-array',
            createdAt: 100,
            updatedAt: 200,
          },
        ],
      });
      expect(result.items[0].actions).toEqual([]);
    });
  });
});
