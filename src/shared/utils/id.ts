import { nanoid } from 'nanoid';

/**
 * Generate a unique, URL-safe ID.
 * @param size Character length (default 21, nanoid default).
 */
export function generateId(size?: number): string {
  return nanoid(size);
}
