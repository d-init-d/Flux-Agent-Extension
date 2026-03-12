import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SavedWorkflow } from '@shared/types';
import { useWorkflowUIStore, resetWorkflowUIStore } from '../workflowUIStore';

const sendExtensionRequest = vi.fn();

vi.mock('../../lib/extension-client', () => ({
  sendExtensionRequest: (...args: unknown[]) => sendExtensionRequest(...args),
}));

function createWorkflow(id: string, overrides: Partial<SavedWorkflow> = {}): SavedWorkflow {
  return {
    id,
    name: `Workflow ${id}`,
    description: 'Test workflow',
    actions: [
      {
        action: { id: `${id}-nav`, type: 'navigate', url: 'https://example.com' },
        timestamp: Date.now() - 2000,
      },
    ],
    tags: ['test'],
    createdAt: Date.now() - 5000,
    updatedAt: Date.now() - 1000,
    ...overrides,
  };
}

describe('workflowUIStore', () => {
  beforeEach(() => {
    sendExtensionRequest.mockReset();
    resetWorkflowUIStore();
  });

  afterEach(() => {
    resetWorkflowUIStore();
  });

  describe('initial state', () => {
    it('should have default values', () => {
      const state = useWorkflowUIStore.getState();
      expect(state.activeModal).toBeNull();
      expect(state.viewMode).toBe('grid');
      expect(state.saveMode).toBe('create');
      expect(state.editingWorkflowId).toBeNull();
      expect(state.isHydrating).toBe(false);
      expect(state.isSaving).toBe(false);
      expect(state.isRunningWorkflowId).toBeNull();
      expect(state.isDeletingWorkflowId).toBeNull();
      expect(state.error).toBeNull();
      expect(state.items).toEqual([]);
      expect(state.selectedWorkflowId).toBeNull();
    });
  });

  describe('hydrate', () => {
    it('should fetch and sort workflows by updatedAt descending', async () => {
      const w1 = createWorkflow('w1', { updatedAt: 1000 });
      const w2 = createWorkflow('w2', { updatedAt: 2000 });
      sendExtensionRequest.mockResolvedValueOnce({ workflows: [w1, w2] });

      await useWorkflowUIStore.getState().hydrate();

      const { items, isHydrating } = useWorkflowUIStore.getState();
      expect(items[0].id).toBe('w2');
      expect(items[1].id).toBe('w1');
      expect(isHydrating).toBe(false);
    });

    it('should select first workflow when no prior selection', async () => {
      sendExtensionRequest.mockResolvedValueOnce({
        workflows: [createWorkflow('w1')],
      });

      await useWorkflowUIStore.getState().hydrate();
      expect(useWorkflowUIStore.getState().selectedWorkflowId).toBe('w1');
    });

    it('should preserve selectedWorkflowId if it exists in new list', async () => {
      useWorkflowUIStore.setState({ selectedWorkflowId: 'w2' });
      sendExtensionRequest.mockResolvedValueOnce({
        workflows: [createWorkflow('w1'), createWorkflow('w2')],
      });

      await useWorkflowUIStore.getState().hydrate();
      expect(useWorkflowUIStore.getState().selectedWorkflowId).toBe('w2');
    });

    it('should fallback to first when selectedWorkflowId is gone', async () => {
      useWorkflowUIStore.setState({ selectedWorkflowId: 'w-gone' });
      sendExtensionRequest.mockResolvedValueOnce({
        workflows: [createWorkflow('w1')],
      });

      await useWorkflowUIStore.getState().hydrate();
      expect(useWorkflowUIStore.getState().selectedWorkflowId).toBe('w1');
    });

    it('should set null when list is empty', async () => {
      sendExtensionRequest.mockResolvedValueOnce({ workflows: [] });

      await useWorkflowUIStore.getState().hydrate();
      expect(useWorkflowUIStore.getState().selectedWorkflowId).toBeNull();
    });

    it('should handle Error on failure', async () => {
      sendExtensionRequest.mockRejectedValueOnce(new Error('Load failed'));

      await useWorkflowUIStore.getState().hydrate();

      expect(useWorkflowUIStore.getState().error).toBe('Load failed');
      expect(useWorkflowUIStore.getState().isHydrating).toBe(false);
    });

    it('should handle non-Error on failure', async () => {
      sendExtensionRequest.mockRejectedValueOnce('string error');

      await useWorkflowUIStore.getState().hydrate();

      expect(useWorkflowUIStore.getState().error).toBe('Failed to load saved workflows');
    });
  });

  describe('openLibrary', () => {
    it('should open library modal and select first item if none selected', () => {
      useWorkflowUIStore.setState({
        items: [createWorkflow('w1')],
        selectedWorkflowId: null,
      });

      useWorkflowUIStore.getState().openLibrary();

      expect(useWorkflowUIStore.getState().activeModal).toBe('library');
      expect(useWorkflowUIStore.getState().selectedWorkflowId).toBe('w1');
      expect(useWorkflowUIStore.getState().error).toBeNull();
    });

    it('should preserve existing selection', () => {
      useWorkflowUIStore.setState({
        items: [createWorkflow('w1'), createWorkflow('w2')],
        selectedWorkflowId: 'w2',
      });

      useWorkflowUIStore.getState().openLibrary();
      expect(useWorkflowUIStore.getState().selectedWorkflowId).toBe('w2');
    });

    it('should set null when items list is empty', () => {
      useWorkflowUIStore.setState({ items: [], selectedWorkflowId: null });

      useWorkflowUIStore.getState().openLibrary();
      expect(useWorkflowUIStore.getState().selectedWorkflowId).toBeNull();
    });
  });

  describe('openSaveModal', () => {
    it('should open save modal in create mode with given draft', () => {
      useWorkflowUIStore.getState().openSaveModal({
        name: 'My workflow',
        description: 'desc',
        tags: 'a, b',
      });

      const state = useWorkflowUIStore.getState();
      expect(state.activeModal).toBe('save');
      expect(state.saveMode).toBe('create');
      expect(state.editingWorkflowId).toBeNull();
      expect(state.saveDraft.name).toBe('My workflow');
    });
  });

  describe('openEditModal', () => {
    it('should open save modal in edit mode with workflow data', () => {
      const w = createWorkflow('w1', {
        name: 'Edit me',
        description: 'desc',
        tags: ['a', 'b'],
      });
      useWorkflowUIStore.setState({ items: [w] });

      useWorkflowUIStore.getState().openEditModal('w1');

      const state = useWorkflowUIStore.getState();
      expect(state.activeModal).toBe('save');
      expect(state.saveMode).toBe('edit');
      expect(state.editingWorkflowId).toBe('w1');
      expect(state.selectedWorkflowId).toBe('w1');
      expect(state.saveDraft.name).toBe('Edit me');
      expect(state.saveDraft.tags).toBe('a, b');
    });

    it('should be a no-op if workflow not found', () => {
      useWorkflowUIStore.setState({ items: [] });

      useWorkflowUIStore.getState().openEditModal('nonexistent');

      expect(useWorkflowUIStore.getState().activeModal).toBeNull();
    });

    it('should handle workflow without description', () => {
      const w = createWorkflow('w1', { description: undefined });
      useWorkflowUIStore.setState({ items: [w] });

      useWorkflowUIStore.getState().openEditModal('w1');
      expect(useWorkflowUIStore.getState().saveDraft.description).toBe('');
    });
  });

  describe('closeModal', () => {
    it('should reset modal state', () => {
      useWorkflowUIStore.setState({
        activeModal: 'save',
        saveMode: 'edit',
        editingWorkflowId: 'w1',
        saveDraft: { name: 'test', description: 'desc', tags: 'a' },
        error: 'some error',
      });

      useWorkflowUIStore.getState().closeModal();

      const state = useWorkflowUIStore.getState();
      expect(state.activeModal).toBeNull();
      expect(state.saveMode).toBe('create');
      expect(state.editingWorkflowId).toBeNull();
      expect(state.saveDraft.name).toBe('');
      expect(state.error).toBeNull();
    });
  });

  describe('setViewMode', () => {
    it('should update view mode', () => {
      useWorkflowUIStore.getState().setViewMode('list');
      expect(useWorkflowUIStore.getState().viewMode).toBe('list');
    });
  });

  describe('updateSaveDraft', () => {
    it('should merge partial updates and clear error', () => {
      useWorkflowUIStore.setState({
        saveDraft: { name: 'old', description: 'old desc', tags: '' },
        error: 'validation error',
      });

      useWorkflowUIStore.getState().updateSaveDraft({ name: 'new' });

      const state = useWorkflowUIStore.getState();
      expect(state.saveDraft.name).toBe('new');
      expect(state.saveDraft.description).toBe('old desc');
      expect(state.error).toBeNull();
    });
  });

  describe('selectWorkflow', () => {
    it('should update selectedWorkflowId', () => {
      useWorkflowUIStore.getState().selectWorkflow('w1');
      expect(useWorkflowUIStore.getState().selectedWorkflowId).toBe('w1');
    });
  });

  describe('saveWorkflow', () => {
    it('should return null if already saving', async () => {
      useWorkflowUIStore.setState({
        isSaving: true,
        saveDraft: { name: 'test', description: '', tags: '' },
      });

      const result = await useWorkflowUIStore.getState().saveWorkflow();
      expect(result).toBeNull();
    });

    it('should set error if name is empty', async () => {
      useWorkflowUIStore.setState({
        saveDraft: { name: '   ', description: '', tags: '' },
      });

      const result = await useWorkflowUIStore.getState().saveWorkflow();

      expect(result).toBeNull();
      expect(useWorkflowUIStore.getState().error).toBe('Workflow name is required.');
    });

    it('should create a new workflow in create mode', async () => {
      const created = createWorkflow('w-new');
      sendExtensionRequest.mockResolvedValueOnce({ workflow: created });

      useWorkflowUIStore.setState({
        saveDraft: { name: 'New workflow', description: 'desc', tags: 'a, b' },
        saveMode: 'create',
      });

      const payload = {
        actions: [{ action: { id: 'a1', type: 'click' }, timestamp: 100 }],
        source: { sessionId: 's1' },
      };
      const result = await useWorkflowUIStore.getState().saveWorkflow(payload);

      expect(result).toBe(created);
      expect(sendExtensionRequest).toHaveBeenCalledWith(
        'WORKFLOW_CREATE',
        expect.objectContaining({
          name: 'New workflow',
          tags: ['a', 'b'],
        }),
      );
      expect(useWorkflowUIStore.getState().isSaving).toBe(false);
      expect(useWorkflowUIStore.getState().activeModal).toBe('library');
      expect(useWorkflowUIStore.getState().selectedWorkflowId).toBe('w-new');
    });

    it('should throw if create mode has no payload', async () => {
      useWorkflowUIStore.setState({
        saveDraft: { name: 'Test', description: '', tags: '' },
        saveMode: 'create',
      });

      const result = await useWorkflowUIStore.getState().saveWorkflow();

      expect(result).toBeNull();
      expect(useWorkflowUIStore.getState().error).toBe('Workflow save requires recorded actions');
    });

    it('should throw if create mode has empty actions', async () => {
      useWorkflowUIStore.setState({
        saveDraft: { name: 'Test', description: '', tags: '' },
        saveMode: 'create',
      });

      const result = await useWorkflowUIStore.getState().saveWorkflow({ actions: [] });

      expect(result).toBeNull();
      expect(useWorkflowUIStore.getState().error).toBe('Workflow save requires recorded actions');
    });

    it('should update an existing workflow in edit mode', async () => {
      const updated = createWorkflow('w1', { name: 'Updated' });
      sendExtensionRequest.mockResolvedValueOnce({ workflow: updated });

      useWorkflowUIStore.setState({
        saveDraft: { name: 'Updated', description: '', tags: '' },
        saveMode: 'edit',
        editingWorkflowId: 'w1',
        items: [createWorkflow('w1')],
      });

      const result = await useWorkflowUIStore.getState().saveWorkflow();

      expect(result).toBe(updated);
      expect(sendExtensionRequest).toHaveBeenCalledWith('WORKFLOW_UPDATE', {
        workflowId: 'w1',
        updates: expect.objectContaining({ name: 'Updated' }),
      });
      expect(useWorkflowUIStore.getState().activeModal).toBe('library');
    });

    it('should error if edit mode has no editingWorkflowId', async () => {
      useWorkflowUIStore.setState({
        saveDraft: { name: 'Test', description: '', tags: '' },
        saveMode: 'edit',
        editingWorkflowId: null,
      });

      const result = await useWorkflowUIStore.getState().saveWorkflow();

      expect(result).toBeNull();
      expect(useWorkflowUIStore.getState().error).toBe('No workflow selected for editing');
    });

    it('should handle API error in create mode', async () => {
      sendExtensionRequest.mockRejectedValueOnce(new Error('API down'));

      useWorkflowUIStore.setState({
        saveDraft: { name: 'Test', description: '', tags: '' },
        saveMode: 'create',
      });

      const result = await useWorkflowUIStore.getState().saveWorkflow({
        actions: [{ action: { id: 'a1', type: 'click' }, timestamp: 100 }],
      });

      expect(result).toBeNull();
      expect(useWorkflowUIStore.getState().error).toBe('API down');
      expect(useWorkflowUIStore.getState().isSaving).toBe(false);
    });

    it('should handle non-Error thrown during save', async () => {
      sendExtensionRequest.mockRejectedValueOnce('raw string');

      useWorkflowUIStore.setState({
        saveDraft: { name: 'Test', description: '', tags: '' },
        saveMode: 'create',
      });

      const result = await useWorkflowUIStore.getState().saveWorkflow({
        actions: [{ action: { id: 'a1', type: 'click' }, timestamp: 100 }],
      });

      expect(result).toBeNull();
      expect(useWorkflowUIStore.getState().error).toBe('Failed to save workflow');
    });

    it('should trim description to undefined if blank', async () => {
      const created = createWorkflow('w-new');
      sendExtensionRequest.mockResolvedValueOnce({ workflow: created });

      useWorkflowUIStore.setState({
        saveDraft: { name: 'Test', description: '   ', tags: '' },
        saveMode: 'create',
      });

      await useWorkflowUIStore.getState().saveWorkflow({
        actions: [{ action: { id: 'a1', type: 'click' }, timestamp: 100 }],
      });

      expect(sendExtensionRequest).toHaveBeenCalledWith(
        'WORKFLOW_CREATE',
        expect.objectContaining({
          description: undefined,
        }),
      );
    });

    it('should parse and deduplicate tags', async () => {
      const created = createWorkflow('w-new');
      sendExtensionRequest.mockResolvedValueOnce({ workflow: created });

      useWorkflowUIStore.setState({
        saveDraft: { name: 'Test', description: '', tags: ' a , b, a, , c ' },
        saveMode: 'create',
      });

      await useWorkflowUIStore.getState().saveWorkflow({
        actions: [{ action: { id: 'a1', type: 'click' }, timestamp: 100 }],
      });

      expect(sendExtensionRequest).toHaveBeenCalledWith(
        'WORKFLOW_CREATE',
        expect.objectContaining({
          tags: ['a', 'b', 'c'],
        }),
      );
    });
  });

  describe('deleteWorkflow', () => {
    it('should return false if already deleting', async () => {
      useWorkflowUIStore.setState({ isDeletingWorkflowId: 'w-other' });

      const result = await useWorkflowUIStore.getState().deleteWorkflow('w1');
      expect(result).toBe(false);
    });

    it('should delete a workflow and select the next one', async () => {
      sendExtensionRequest.mockResolvedValueOnce({ workflowId: 'w1' });
      const w1 = createWorkflow('w1', { updatedAt: 2000 });
      const w2 = createWorkflow('w2', { updatedAt: 1000 });
      useWorkflowUIStore.setState({
        items: [w1, w2],
        selectedWorkflowId: 'w1',
      });

      const result = await useWorkflowUIStore.getState().deleteWorkflow('w1');

      expect(result).toBe(true);
      expect(useWorkflowUIStore.getState().items).toHaveLength(1);
      expect(useWorkflowUIStore.getState().selectedWorkflowId).toBe('w2');
      expect(useWorkflowUIStore.getState().isDeletingWorkflowId).toBeNull();
    });

    it('should set null when deleting last workflow', async () => {
      sendExtensionRequest.mockResolvedValueOnce({ workflowId: 'w1' });
      useWorkflowUIStore.setState({
        items: [createWorkflow('w1')],
        selectedWorkflowId: 'w1',
      });

      await useWorkflowUIStore.getState().deleteWorkflow('w1');

      expect(useWorkflowUIStore.getState().selectedWorkflowId).toBeNull();
    });

    it('should preserve selection when deleting a non-selected workflow', async () => {
      sendExtensionRequest.mockResolvedValueOnce({ workflowId: 'w2' });
      useWorkflowUIStore.setState({
        items: [createWorkflow('w1'), createWorkflow('w2')],
        selectedWorkflowId: 'w1',
      });

      await useWorkflowUIStore.getState().deleteWorkflow('w2');

      expect(useWorkflowUIStore.getState().selectedWorkflowId).toBe('w1');
    });

    it('should handle delete error with Error instance', async () => {
      sendExtensionRequest.mockRejectedValueOnce(new Error('Delete fail'));
      useWorkflowUIStore.setState({
        items: [createWorkflow('w1')],
        selectedWorkflowId: 'w1',
      });

      const result = await useWorkflowUIStore.getState().deleteWorkflow('w1');

      expect(result).toBe(false);
      expect(useWorkflowUIStore.getState().error).toBe('Delete fail');
      expect(useWorkflowUIStore.getState().isDeletingWorkflowId).toBeNull();
    });

    it('should handle delete error with non-Error', async () => {
      sendExtensionRequest.mockRejectedValueOnce('raw');
      useWorkflowUIStore.setState({
        items: [createWorkflow('w1')],
        selectedWorkflowId: 'w1',
      });

      const result = await useWorkflowUIStore.getState().deleteWorkflow('w1');

      expect(result).toBe(false);
      expect(useWorkflowUIStore.getState().error).toBe('Failed to delete workflow');
    });

    it('should select the item at the same index after deletion', async () => {
      sendExtensionRequest.mockResolvedValueOnce({});
      const w1 = createWorkflow('w1', { updatedAt: 3000 });
      const w2 = createWorkflow('w2', { updatedAt: 2000 });
      const w3 = createWorkflow('w3', { updatedAt: 1000 });
      useWorkflowUIStore.setState({
        items: [w1, w2, w3],
        selectedWorkflowId: 'w2',
      });

      await useWorkflowUIStore.getState().deleteWorkflow('w2');

      expect(useWorkflowUIStore.getState().selectedWorkflowId).toBe('w3');
    });

    it('should select previous item when deleted item was last in list', async () => {
      sendExtensionRequest.mockResolvedValueOnce({});
      const w1 = createWorkflow('w1', { updatedAt: 2000 });
      const w2 = createWorkflow('w2', { updatedAt: 1000 });
      useWorkflowUIStore.setState({
        items: [w1, w2],
        selectedWorkflowId: 'w2',
      });

      await useWorkflowUIStore.getState().deleteWorkflow('w2');

      expect(useWorkflowUIStore.getState().selectedWorkflowId).toBe('w1');
    });
  });

  describe('runWorkflow', () => {
    it('should return false if already running', async () => {
      useWorkflowUIStore.setState({ isRunningWorkflowId: 'w-other' });

      const result = await useWorkflowUIStore.getState().runWorkflow('w1', 's1');
      expect(result).toBe(false);
    });

    it('should run a workflow and close the modal', async () => {
      sendExtensionRequest.mockResolvedValueOnce({});

      const result = await useWorkflowUIStore.getState().runWorkflow('w1', 's1');

      expect(result).toBe(true);
      expect(sendExtensionRequest).toHaveBeenCalledWith('WORKFLOW_RUN', {
        workflowId: 'w1',
        sessionId: 's1',
      });
      expect(useWorkflowUIStore.getState().isRunningWorkflowId).toBeNull();
      expect(useWorkflowUIStore.getState().activeModal).toBeNull();
    });

    it('should handle run error with Error instance', async () => {
      sendExtensionRequest.mockRejectedValueOnce(new Error('Run failed'));

      const result = await useWorkflowUIStore.getState().runWorkflow('w1', 's1');

      expect(result).toBe(false);
      expect(useWorkflowUIStore.getState().error).toBe('Run failed');
      expect(useWorkflowUIStore.getState().isRunningWorkflowId).toBeNull();
    });

    it('should handle run error with non-Error', async () => {
      sendExtensionRequest.mockRejectedValueOnce(42);

      const result = await useWorkflowUIStore.getState().runWorkflow('w1', 's1');

      expect(result).toBe(false);
      expect(useWorkflowUIStore.getState().error).toBe('Failed to run workflow');
    });
  });

  describe('saveWorkflow — edit mode error branches', () => {
    it('should handle API error in edit mode (Error instance)', async () => {
      sendExtensionRequest.mockRejectedValueOnce(new Error('Update fail'));

      useWorkflowUIStore.setState({
        saveDraft: { name: 'Test', description: '', tags: '' },
        saveMode: 'edit',
        editingWorkflowId: 'w1',
        items: [createWorkflow('w1')],
      });

      const result = await useWorkflowUIStore.getState().saveWorkflow();

      expect(result).toBeNull();
      expect(useWorkflowUIStore.getState().error).toBe('Update fail');
      expect(useWorkflowUIStore.getState().isSaving).toBe(false);
    });

    it('should handle API error in edit mode (non-Error)', async () => {
      sendExtensionRequest.mockRejectedValueOnce(42);

      useWorkflowUIStore.setState({
        saveDraft: { name: 'Test', description: '', tags: '' },
        saveMode: 'edit',
        editingWorkflowId: 'w1',
        items: [createWorkflow('w1')],
      });

      const result = await useWorkflowUIStore.getState().saveWorkflow();

      expect(result).toBeNull();
      expect(useWorkflowUIStore.getState().error).toBe('Failed to save workflow');
    });
  });

  describe('saveWorkflow — edit mode description and tags', () => {
    it('should pass trimmed description and parsed tags in edit mode', async () => {
      const updated = createWorkflow('w1', { name: 'Edited' });
      sendExtensionRequest.mockResolvedValueOnce({ workflow: updated });

      useWorkflowUIStore.setState({
        saveDraft: { name: 'Edited', description: '  A description  ', tags: ' x, y, x ' },
        saveMode: 'edit',
        editingWorkflowId: 'w1',
        items: [createWorkflow('w1')],
      });

      await useWorkflowUIStore.getState().saveWorkflow();

      expect(sendExtensionRequest).toHaveBeenCalledWith('WORKFLOW_UPDATE', {
        workflowId: 'w1',
        updates: {
          name: 'Edited',
          description: 'A description',
          tags: ['x', 'y'],
        },
      });
    });
  });

  describe('hydrate — isHydrating flag', () => {
    it('should set isHydrating to true before API call', async () => {
      let resolveRequest: (value: { workflows: SavedWorkflow[] }) => void;
      sendExtensionRequest.mockReturnValueOnce(
        new Promise<{ workflows: SavedWorkflow[] }>((resolve) => {
          resolveRequest = resolve;
        }),
      );

      const promise = useWorkflowUIStore.getState().hydrate();
      expect(useWorkflowUIStore.getState().isHydrating).toBe(true);
      expect(useWorkflowUIStore.getState().error).toBeNull();

      resolveRequest!({ workflows: [] });
      await promise;

      expect(useWorkflowUIStore.getState().isHydrating).toBe(false);
    });
  });

  describe('deleteWorkflow — getNextSelectedWorkflowId edge cases', () => {
    it('should fallback to first item when deleted id is not in previousItems', async () => {
      sendExtensionRequest.mockResolvedValueOnce({});
      const w1 = createWorkflow('w1', { updatedAt: 2000 });
      const w2 = createWorkflow('w2', { updatedAt: 1000 });
      useWorkflowUIStore.setState({
        items: [w1, w2],
        selectedWorkflowId: 'w-phantom',
      });

      await useWorkflowUIStore.getState().deleteWorkflow('w-phantom');

      expect(useWorkflowUIStore.getState().items).toHaveLength(2);
      expect(useWorkflowUIStore.getState().selectedWorkflowId).toBe('w1');
    });

    it('should keep current selection when it differs from deleted and exists in next', async () => {
      sendExtensionRequest.mockResolvedValueOnce({});
      const w1 = createWorkflow('w1', { updatedAt: 3000 });
      const w2 = createWorkflow('w2', { updatedAt: 2000 });
      const w3 = createWorkflow('w3', { updatedAt: 1000 });
      useWorkflowUIStore.setState({
        items: [w1, w2, w3],
        selectedWorkflowId: 'w3',
      });

      await useWorkflowUIStore.getState().deleteWorkflow('w1');

      expect(useWorkflowUIStore.getState().selectedWorkflowId).toBe('w3');
    });
  });

  describe('saveWorkflow — create mode with source', () => {
    it('should pass source to WORKFLOW_CREATE when provided', async () => {
      const created = createWorkflow('w-new');
      sendExtensionRequest.mockResolvedValueOnce({ workflow: created });

      useWorkflowUIStore.setState({
        saveDraft: { name: 'From session', description: '', tags: '' },
        saveMode: 'create',
      });

      await useWorkflowUIStore.getState().saveWorkflow({
        actions: [{ action: { id: 'a1', type: 'click' }, timestamp: 100 }],
        source: { sessionId: 's1', sessionName: 'Demo' },
      });

      expect(sendExtensionRequest).toHaveBeenCalledWith(
        'WORKFLOW_CREATE',
        expect.objectContaining({ source: { sessionId: 's1', sessionName: 'Demo' } }),
      );
    });
  });

  describe('resetWorkflowUIStore', () => {
    it('should reset all state to defaults', () => {
      useWorkflowUIStore.setState({
        activeModal: 'library',
        viewMode: 'list',
        items: [createWorkflow('w1')],
        error: 'err',
        isSaving: true,
      });

      resetWorkflowUIStore();

      const state = useWorkflowUIStore.getState();
      expect(state.activeModal).toBeNull();
      expect(state.viewMode).toBe('grid');
      expect(state.items).toEqual([]);
      expect(state.error).toBeNull();
      expect(state.isSaving).toBe(false);
    });
  });
});
