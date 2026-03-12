import { create } from 'zustand';
import type { RecordedSessionAction, SavedWorkflow, SavedWorkflowSource } from '@shared/types';
import { sendExtensionRequest } from '../lib/extension-client';

export type WorkflowModalState = 'library' | 'save' | null;
export type WorkflowViewMode = 'grid' | 'list';
export type WorkflowSaveMode = 'create' | 'edit';

export interface WorkflowSaveDraft {
  name: string;
  description: string;
  tags: string;
}

interface SaveWorkflowPayload {
  actions: RecordedSessionAction[];
  source?: SavedWorkflowSource;
}

interface WorkflowUIStoreState {
  activeModal: WorkflowModalState;
  viewMode: WorkflowViewMode;
  saveMode: WorkflowSaveMode;
  editingWorkflowId: string | null;
  isHydrating: boolean;
  isSaving: boolean;
  isRunningWorkflowId: string | null;
  isDeletingWorkflowId: string | null;
  error: string | null;
  items: SavedWorkflow[];
  saveDraft: WorkflowSaveDraft;
  selectedWorkflowId: string | null;
  hydrate: () => Promise<void>;
  openLibrary: () => void;
  openSaveModal: (draft: WorkflowSaveDraft) => void;
  openEditModal: (workflowId: string) => void;
  closeModal: () => void;
  setViewMode: (mode: WorkflowViewMode) => void;
  updateSaveDraft: (patch: Partial<WorkflowSaveDraft>) => void;
  selectWorkflow: (workflowId: string) => void;
  saveWorkflow: (payload?: SaveWorkflowPayload) => Promise<SavedWorkflow | null>;
  deleteWorkflow: (workflowId: string) => Promise<boolean>;
  runWorkflow: (workflowId: string, sessionId: string) => Promise<boolean>;
}

const DEFAULT_SAVE_DRAFT: WorkflowSaveDraft = {
  name: '',
  description: '',
  tags: '',
};

function sortWorkflows(items: SavedWorkflow[]): SavedWorkflow[] {
  return [...items].sort((left, right) => right.updatedAt - left.updatedAt);
}

function parseTags(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0),
    ),
  );
}

function toDraft(workflow: SavedWorkflow): WorkflowSaveDraft {
  return {
    name: workflow.name,
    description: workflow.description ?? '',
    tags: workflow.tags.join(', '),
  };
}

function getNextSelectedWorkflowId(
  previousItems: SavedWorkflow[],
  nextItems: SavedWorkflow[],
  deletedWorkflowId: string,
  currentSelection: string | null,
): string | null {
  if (nextItems.length === 0) {
    return null;
  }

  if (
    currentSelection !== deletedWorkflowId &&
    currentSelection &&
    nextItems.some((item) => item.id === currentSelection)
  ) {
    return currentSelection;
  }

  const deletedIndex = previousItems.findIndex((item) => item.id === deletedWorkflowId);
  if (deletedIndex === -1) {
    return nextItems[0]?.id ?? null;
  }

  return nextItems[deletedIndex]?.id ?? nextItems[deletedIndex - 1]?.id ?? nextItems[0]?.id ?? null;
}

export const useWorkflowUIStore = create<WorkflowUIStoreState>((set, get) => ({
  activeModal: null,
  viewMode: 'grid',
  saveMode: 'create',
  editingWorkflowId: null,
  isHydrating: false,
  isSaving: false,
  isRunningWorkflowId: null,
  isDeletingWorkflowId: null,
  error: null,
  items: [],
  saveDraft: DEFAULT_SAVE_DRAFT,
  selectedWorkflowId: null,
  hydrate: async () => {
    set({ isHydrating: true, error: null });

    try {
      const response = await sendExtensionRequest('WORKFLOW_LIST', undefined);
      const items = sortWorkflows(response.workflows);
      set((state) => ({
        items,
        isHydrating: false,
        selectedWorkflowId:
          state.selectedWorkflowId && items.some((item) => item.id === state.selectedWorkflowId)
            ? state.selectedWorkflowId
            : (items[0]?.id ?? null),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load saved workflows';
      set({ isHydrating: false, error: message });
    }
  },
  openLibrary: () => {
    set((state) => ({
      activeModal: 'library',
      error: null,
      selectedWorkflowId: state.selectedWorkflowId ?? state.items[0]?.id ?? null,
    }));
  },
  openSaveModal: (draft) => {
    set({
      activeModal: 'save',
      saveMode: 'create',
      editingWorkflowId: null,
      error: null,
      saveDraft: {
        name: draft.name,
        description: draft.description,
        tags: draft.tags,
      },
    });
  },
  openEditModal: (workflowId) => {
    const workflow = get().items.find((item) => item.id === workflowId);
    if (!workflow) {
      return;
    }

    set({
      activeModal: 'save',
      saveMode: 'edit',
      editingWorkflowId: workflowId,
      selectedWorkflowId: workflowId,
      error: null,
      saveDraft: toDraft(workflow),
    });
  },
  closeModal: () => {
    set({
      activeModal: null,
      error: null,
      saveMode: 'create',
      editingWorkflowId: null,
      saveDraft: DEFAULT_SAVE_DRAFT,
    });
  },
  setViewMode: (mode) => {
    set({ viewMode: mode });
  },
  updateSaveDraft: (patch) => {
    set((state) => ({
      saveDraft: {
        ...state.saveDraft,
        ...patch,
      },
      error: null,
    }));
  },
  selectWorkflow: (workflowId) => {
    set({ selectedWorkflowId: workflowId });
  },
  saveWorkflow: async (payload) => {
    const { isSaving, saveDraft, saveMode, editingWorkflowId, items } = get();

    if (isSaving) {
      return null;
    }

    const name = saveDraft.name.trim();
    if (!name) {
      set({ error: 'Workflow name is required.' });
      return null;
    }

    const description = saveDraft.description.trim() || undefined;
    const tags = parseTags(saveDraft.tags);

    set({ isSaving: true, error: null });

    try {
      if (saveMode === 'edit') {
        if (!editingWorkflowId) {
          throw new Error('No workflow selected for editing');
        }

        const response = await sendExtensionRequest('WORKFLOW_UPDATE', {
          workflowId: editingWorkflowId,
          updates: {
            name,
            description,
            tags,
          },
        });
        const updatedWorkflow = response.workflow;
        const nextItems = sortWorkflows([
          updatedWorkflow,
          ...items.filter((item) => item.id !== updatedWorkflow.id),
        ]);
        set({
          items: nextItems,
          isSaving: false,
          activeModal: 'library',
          saveMode: 'create',
          editingWorkflowId: null,
          selectedWorkflowId: updatedWorkflow.id,
          saveDraft: DEFAULT_SAVE_DRAFT,
        });
        return updatedWorkflow;
      }

      if (!payload || payload.actions.length === 0) {
        throw new Error('Workflow save requires recorded actions');
      }

      const response = await sendExtensionRequest('WORKFLOW_CREATE', {
        name,
        description,
        tags,
        actions: JSON.parse(JSON.stringify(payload.actions)) as RecordedSessionAction[],
        source: payload.source,
      });
      const nextWorkflow = response.workflow;
      const nextItems = sortWorkflows([
        nextWorkflow,
        ...items.filter((item) => item.id !== nextWorkflow.id),
      ]);
      set({
        items: nextItems,
        isSaving: false,
        activeModal: 'library',
        saveMode: 'create',
        editingWorkflowId: null,
        selectedWorkflowId: nextWorkflow.id,
        saveDraft: DEFAULT_SAVE_DRAFT,
      });
      return nextWorkflow;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save workflow';
      set({ isSaving: false, error: message });
      return null;
    }
  },
  deleteWorkflow: async (workflowId) => {
    const { isDeletingWorkflowId, items, selectedWorkflowId } = get();
    if (isDeletingWorkflowId) {
      return false;
    }

    set({ isDeletingWorkflowId: workflowId, error: null });

    try {
      await sendExtensionRequest('WORKFLOW_DELETE', { workflowId });
      const nextItems = items.filter((item) => item.id !== workflowId);
      set({
        items: nextItems,
        isDeletingWorkflowId: null,
        selectedWorkflowId: getNextSelectedWorkflowId(
          items,
          nextItems,
          workflowId,
          selectedWorkflowId,
        ),
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete workflow';
      set({ isDeletingWorkflowId: null, error: message });
      return false;
    }
  },
  runWorkflow: async (workflowId, sessionId) => {
    const { isRunningWorkflowId } = get();
    if (isRunningWorkflowId) {
      return false;
    }

    set({ isRunningWorkflowId: workflowId, error: null });

    try {
      await sendExtensionRequest('WORKFLOW_RUN', { workflowId, sessionId });
      set({ isRunningWorkflowId: null, activeModal: null });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to run workflow';
      set({ isRunningWorkflowId: null, error: message });
      return false;
    }
  },
}));

export function resetWorkflowUIStore(): void {
  useWorkflowUIStore.setState({
    activeModal: null,
    viewMode: 'grid',
    saveMode: 'create',
    editingWorkflowId: null,
    isHydrating: false,
    isSaving: false,
    isRunningWorkflowId: null,
    isDeletingWorkflowId: null,
    error: null,
    items: [],
    saveDraft: DEFAULT_SAVE_DRAFT,
    selectedWorkflowId: null,
  });
}
