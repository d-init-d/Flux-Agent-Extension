import { create } from 'zustand';
import { ChatMessage } from '@shared/types';
import { createMessage, generateId } from '@shared/utils';
import { logger } from '@shared/logger';

interface ChatStore {
  // State
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;

  // Actions
  sendMessage: (content: string) => Promise<void>;
  addMessage: (message: ChatMessage) => void;
  clearMessages: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  // Initial state
  messages: [],
  isLoading: false,
  error: null,

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
    }));

    try {
      logger.info('Sending message to background:', content);

      // Send to background service worker
      const response = await chrome.runtime.sendMessage(
        createMessage('CHAT_SEND', {
          messages: [...get().messages, userMessage],
        })
      );

      logger.info('Received response from background:', response);

      // Add assistant response
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
        content: `Error: ${String(error)}`,
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
    set({ messages: [], error: null });
  },

  setLoading: (loading) => {
    set({ isLoading: loading });
  },

  setError: (error) => {
    set({ error });
  },
}));
