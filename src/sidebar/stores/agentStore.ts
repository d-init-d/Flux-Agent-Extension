/**
 * Agent Store
 * Zustand store để quản lý agent state trong UI
 */

import { create } from 'zustand';
import type { AgentPlan, AgentAction, AgentEvent } from '../../agent/types';

interface AgentStoreState {
  /** Current plan */
  currentPlan: AgentPlan | null;
  /** Is executing */
  isExecuting: boolean;
  /** Show plan preview modal */
  showPlanPreview: boolean;
  /** Current action being executed */
  currentActionIndex: number;
  /** Events log */
  events: AgentEvent[];
}

interface AgentStoreActions {
  /** Set current plan */
  setPlan: (plan: AgentPlan | null) => void;
  /** Update plan status */
  updatePlan: (updates: Partial<AgentPlan>) => void;
  /** Set executing state */
  setExecuting: (executing: boolean) => void;
  /** Show/hide plan preview */
  setShowPlanPreview: (show: boolean) => void;
  /** Update action at index */
  updateAction: (index: number, updates: Partial<AgentAction>) => void;
  /** Add event */
  addEvent: (event: AgentEvent) => void;
  /** Clear events */
  clearEvents: () => void;
  /** Reset state */
  reset: () => void;
  /** Execute plan (sends message to background) */
  executePlan: () => Promise<void>;
  /** Cancel execution */
  cancelExecution: () => Promise<void>;
}

type AgentStore = AgentStoreState & AgentStoreActions;

const initialState: AgentStoreState = {
  currentPlan: null,
  isExecuting: false,
  showPlanPreview: false,
  currentActionIndex: -1,
  events: [],
};

export const useAgentStore = create<AgentStore>((set, get) => ({
  ...initialState,

  setPlan: (plan) => set({ currentPlan: plan, currentActionIndex: 0 }),

  updatePlan: (updates) => set(state => ({
    currentPlan: state.currentPlan 
      ? { ...state.currentPlan, ...updates }
      : null,
  })),

  setExecuting: (executing) => set({ isExecuting: executing }),

  setShowPlanPreview: (show) => set({ showPlanPreview: show }),

  updateAction: (index, updates) => set(state => {
    if (!state.currentPlan) return state;
    
    const actions = [...state.currentPlan.actions];
    actions[index] = { ...actions[index], ...updates };
    
    return {
      currentPlan: { ...state.currentPlan, actions },
      currentActionIndex: index,
    };
  }),

  addEvent: (event) => set(state => ({
    events: [...state.events.slice(-99), event],
  })),

  clearEvents: () => set({ events: [] }),

  reset: () => set(initialState),

  executePlan: async () => {
    const { currentPlan } = get();
    if (!currentPlan) return;

    set({ isExecuting: true });

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'EXECUTE_PLAN',
        payload: { plan: currentPlan },
        timestamp: Date.now(),
        id: crypto.randomUUID(),
      });

      if (response?.plan) {
        set({ currentPlan: response.plan });
      }
    } catch (error) {
      console.error('Failed to execute plan:', error);
    } finally {
      set({ isExecuting: false });
    }
  },

  cancelExecution: async () => {
    try {
      await chrome.runtime.sendMessage({
        type: 'CANCEL_EXECUTION',
        payload: {},
        timestamp: Date.now(),
        id: crypto.randomUUID(),
      });
    } catch (error) {
      console.error('Failed to cancel execution:', error);
    } finally {
      set({ isExecuting: false });
    }
  },
}));

export default useAgentStore;
