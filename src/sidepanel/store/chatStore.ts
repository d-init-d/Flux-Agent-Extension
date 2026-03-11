import { create } from 'zustand';
import type { Session, AIMessage, SerializedFileUpload } from '@shared/types';
import type { MessageBubbleProps } from '../components/MessageBubble';
import { sendExtensionRequest } from '../lib/extension-client';

interface ChatStoreState {
  messagesBySession: Record<string, MessageBubbleProps[]>;
  streamMessageIdsBySession: Record<string, string | null>;
  syncSession: (session: Session) => void;
  applyStreamChunk: (payload: { sessionId: string; messageId: string; delta: string; done: boolean; error?: string }) => void;
  appendError: (sessionId: string, message: string) => void;
  sendMessage: (sessionId: string, message: string, uploads?: SerializedFileUpload[]) => Promise<void>;
}

function toTimestamp(timestamp: number | undefined): string {
  return new Date(timestamp ?? Date.now()).toISOString();
}

function mapAIMessageToBubble(message: AIMessage, index: number): MessageBubbleProps {
  if (message.role === 'assistant') {
    return {
      id: `assistant-${index}`,
      variant: 'assistant',
      timestamp: toTimestamp(message.timestamp),
      markdown: typeof message.content === 'string' ? message.content : '',
    };
  }

  return {
    id: `user-${index}`,
    variant: 'user',
    timestamp: toTimestamp(message.timestamp),
    text: typeof message.content === 'string' ? message.content : '',
  };
}

function mapSessionToMessages(session: Session): MessageBubbleProps[] {
  return session.messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message, index) => mapAIMessageToBubble(message, index));
}

export const useChatStore = create<ChatStoreState>((set) => ({
  messagesBySession: {},
  streamMessageIdsBySession: {},
  syncSession: (session) => {
    set((state) => ({
      messagesBySession: {
        ...state.messagesBySession,
        [session.config.id]: mapSessionToMessages(session),
      },
      streamMessageIdsBySession: {
        ...state.streamMessageIdsBySession,
        [session.config.id]: null,
      },
    }));
  },
  applyStreamChunk: ({ sessionId, messageId, delta, done, error }) => {
    set((state) => {
      const existingMessages = state.messagesBySession[sessionId] ?? [];
      const existingIndex = existingMessages.findIndex((message) => message.id === messageId);
      const nextMessages = [...existingMessages];

      if (error) {
        if (existingIndex !== -1) {
          const currentMessage = nextMessages[existingIndex];
          if (currentMessage?.variant === 'assistant') {
            nextMessages[existingIndex] = {
              ...currentMessage,
              isStreaming: false,
            };
          }
        }

        nextMessages.push({
          id: `error-${messageId}`,
          variant: 'error',
          timestamp: new Date().toISOString(),
          title: 'Streaming failed',
          description: error,
          errorCode: 'STREAM_FAILED',
          actions: [],
        });
      } else if (existingIndex === -1) {
        nextMessages.push({
          id: messageId,
          variant: 'assistant',
          timestamp: new Date().toISOString(),
          markdown: delta,
          isStreaming: !done,
        });
      } else {
        const currentMessage = nextMessages[existingIndex];
        if (currentMessage.variant === 'assistant') {
          nextMessages[existingIndex] = {
            ...currentMessage,
            markdown: `${currentMessage.markdown}${delta}`,
            isStreaming: !done,
          };
        }
      }

      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: nextMessages,
        },
        streamMessageIdsBySession: {
          ...state.streamMessageIdsBySession,
          [sessionId]: done ? null : messageId,
        },
      };
    });
  },
  appendError: (sessionId, message) => {
    set((state) => ({
      messagesBySession: {
        ...state.messagesBySession,
        [sessionId]: [
          ...(state.messagesBySession[sessionId] ?? []),
          {
            id: `error-${Date.now()}`,
            variant: 'error',
            timestamp: new Date().toISOString(),
            title: 'Request failed',
            description: message,
            errorCode: 'REQUEST_FAILED',
            actions: [],
          },
        ],
      },
    }));
  },
  sendMessage: async (sessionId, message, uploads) => {
    await sendExtensionRequest('SESSION_SEND_MESSAGE', {
      sessionId,
      message,
      uploads,
    });
  },
}));

export function resetChatStore(): void {
  useChatStore.setState({
    messagesBySession: {},
    streamMessageIdsBySession: {},
  });
}
