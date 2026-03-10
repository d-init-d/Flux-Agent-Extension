import { create } from 'zustand';
import { getSavedWorkflows, setSavedWorkflows } from '@shared/storage/workflows';
import type { RecordedSessionAction, SavedWorkflow, SavedWorkflowSource } from '@shared/types';
import { generateId } from '@shared/utils/id';

export type WorkflowModalState = 'library' | 'save' | null;
export type WorkflowViewMode = 'grid' | 'list';

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
  isHydrating: boolean;
  isSaving: boolean;
  error: string | null;
  items: SavedWorkflow[];
  saveDraft: WorkflowSaveDraft;
  selectedWorkflowId: string | null;
  hydrate: () => Promise<void>;
  openLibrary: () => void;
  openSaveModal: (draft: WorkflowSaveDraft) => void;
  closeModal: () => void;
  setViewMode: (mode: WorkflowViewMode) => void;
  updateSaveDraft: (patch: Partial<WorkflowSaveDraft>) => void;
  selectWorkflow: (workflowId: string) => void;
  saveWorkflow: (payload: SaveWorkflowPayload) => Promise<SavedWorkflow | null>;
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
  const tags = value
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);

  return Array.from(new Set(tags));
}

function cloneActions(actions: RecordedSessionAction[]): RecordedSessionAction[] {
  return structuredClone(actions);
}

export const useWorkflowUIStore = create<WorkflowUIStoreState>((set, get) => ({
  activeModal: null,
  viewMode: 'grid',
  isHydrating: false,
  isSaving: false,
  error: null,
  items: [],
  saveDraft: DEFAULT_SAVE_DRAFT,
  selectedWorkflowId: null,
  hydrate: async () => {
    set({ isHydrating: true, error: null });

    try {
      const items = sortWorkflows(await getSavedWorkflows());
      set((state) => ({
        items,
        isHydrating: false,
        selectedWorkflowId:
          state.selectedWorkflowId && items.some((item) => item.id === state.selectedWorkflowId)
            ? state.selectedWorkflowId
            : items[0]?.id ?? null,
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
      error: null,
      saveDraft: {
        name: draft.name,
        description: draft.description,
        tags: draft.tags,
      },
    });
  },
  closeModal: () => {
    set({ activeModal: null, error: null });
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
  saveWorkflow: async ({ actions, source }) => {
    const { isSaving, items, saveDraft } = get();

    if (isSaving) {
      return null;
    }

    const name = saveDraft.name.trim();
    if (!name) {
      set({ error: 'Workflow name is required.' });
      return null;
    }

    const now = Date.now();
    const nextWorkflow: SavedWorkflow = {
      id: generateId(),
      name,
      description: saveDraft.description.trim() || undefined,
      tags: parseTags(saveDraft.tags),
      actions: cloneActions(actions),
      createdAt: now,
      updatedAt: now,
      source,
    };

    set({ isSaving: true, error: null });

    try {
      const nextItems = sortWorkflows([nextWorkflow, ...items]);
      await setSavedWorkflows(nextItems);
      set({
        items: nextItems,
        isSaving: false,
        activeModal: 'library',
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
}));

export function resetWorkflowUIStore(): void {
  useWorkflowUIStore.setState({
    activeModal: null,
    viewMode: 'grid',
    isHydrating: false,
    isSaving: false,
    error: null,
    items: [],
    saveDraft: DEFAULT_SAVE_DRAFT,
    selectedWorkflowId: null,
  });
}
