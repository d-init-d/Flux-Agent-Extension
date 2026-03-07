import { useSessionStore } from '../store/sessionStore';

export function useSession() {
  return useSessionStore();
}
