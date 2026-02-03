import { create } from 'zustand';
import { ChatMessage } from '@shared/types';
import { createMessage, generateId } from '@shared/utils';
import { logger } from '@shared/logger';
import type { AgentPlan } from '../../agent/types';

interface ChatStore {
  // State
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
  currentPlan: AgentPlan | null;
  isAgentMode: boolean;

  // Actions
  sendMessage: (content: string) => Promise<void>;
  addMessage: (message: ChatMessage) => void;
  clearMessages: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setPlan: (plan: AgentPlan | null) => void;
  clearPlan: () => void;
  toggleAgentMode: () => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  // Initial state
  messages: [],
  isLoading: false,
  error: null,
  currentPlan: null,
  isAgentMode: true, // Default to agent mode

  // Send message to background
  sendMessage: async (content: string) => {
    const userMessage: ChatMessage = {
      id: generateId(),
      role: 'user',
      content,
      timestamp: Date.now(),
    };

    // Add user message immediately
    set(state => ({
      messages: [...state.messages, userMessage],
      isLoading: true,
      error: null,
      currentPlan: null,
    }));

    try {
      logger.info('Sending message to background:', content);

      if (get().isAgentMode) {
        // Agent mode - use AGENT_CHAT
        const response = await chrome.runtime.sendMessage({
          type: 'AGENT_CHAT',
          payload: {
            content,
            messages: [...get().messages, userMessage],
          },
          timestamp: Date.now(),
          id: generateId(),
        });

        logger.info('Agent chat response:', response);

        if (response?.success) {
          // Add assistant response
          const assistantMessage: ChatMessage = {
            id: generateId(),
            role: 'assistant',
            content: response.response,
            timestamp: Date.now(),
          };

          set(state => ({
            messages: [...state.messages, assistantMessage],
            isLoading: false,
            currentPlan: response.plan || null,
          }));
        } else {
          throw new Error(response?.error || 'Agent chat failed');
        }
      } else {
        // Regular chat mode
        const response = await chrome.runtime.sendMessage(
          createMessage('CHAT_SEND', {
            messages: [...get().messages, userMessage],
          })
        );

        logger.info('Received response from background:', response);

        if (response && response.payload) {
          const assistantMessage: ChatMessage = {
            id: response.payload.id || generateId(),
            role: 'assistant',
            content: response.payload.content,
            timestamp: response.payload.timestamp || Date.now(),
          };

          set(state => ({
            messages: [...state.messages, assistantMessage],
            isLoading: false,
          }));
        } else {
          throw new Error('Invalid response from background');
        }
      }
    } catch (error) {
      logger.error('Error sending message:', error);
      set({
        isLoading: false,
        error: String(error),
      });

      // Add error message
      const errorMessage: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: `❌ Error: ${String(error)}`,
        timestamp: Date.now(),
      };

      set(state => ({
        messages: [...state.messages, errorMessage],
      }));
    }
  },

  addMessage: (message) => {
    set(state => ({
      messages: [...state.messages, message],
    }));
  },

  clearMessages: () => {
    set({ messages: [], error: null, currentPlan: null });
  },

  setLoading: (loading) => {
    set({ isLoading: loading });
  },

  setError: (error) => {
    set({ error });
  },

  setPlan: (plan) => {
    set({ currentPlan: plan });
  },

  clearPlan: () => {
    set({ currentPlan: null });
  },

  toggleAgentMode: () => {
    set(state => ({ isAgentMode: !state.isAgentMode }));
  },
}));

export default useChatStore;
