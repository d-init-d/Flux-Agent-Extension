import { useActionLogStore } from '../store/actionLogStore';

export function useActionLog() {
  return useActionLogStore();
}
