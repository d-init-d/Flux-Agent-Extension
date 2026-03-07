import { useChatStore } from '../store/chatStore';

export function useChat() {
  return useChatStore();
}
