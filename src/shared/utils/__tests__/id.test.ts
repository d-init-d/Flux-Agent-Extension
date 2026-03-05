/**
 * @module id.test
 * @description Tests for the generateId utility function.
 *
 * Covers: default ID generation, custom size, uniqueness, URL-safety.
 */

import { generateId } from '../id';

describe('generateId', () => {
  it('should return a string', () => {
    const id = generateId();
    expect(typeof id).toBe('string');
  });

  it('should return a 21-character ID by default (nanoid default)', () => {
    const id = generateId();
    expect(id).toHaveLength(21);
  });

  it('should return an ID of the requested size', () => {
    const id = generateId(10);
    expect(id).toHaveLength(10);
  });

  it('should return a different ID of a small size', () => {
    const id = generateId(5);
    expect(id).toHaveLength(5);
  });

  it('should generate URL-safe characters only', () => {
    // nanoid uses A-Za-z0-9_- by default
    const urlSafePattern = /^[A-Za-z0-9_-]+$/;

    // Generate many IDs and verify all are URL-safe
    for (let i = 0; i < 100; i++) {
      const id = generateId();
      expect(id).toMatch(urlSafePattern);
    }
  });

  it('should generate unique IDs', () => {
    const ids = new Set<string>();
    const count = 1000;

    for (let i = 0; i < count; i++) {
      ids.add(generateId());
    }

    // All 1000 should be unique
    expect(ids.size).toBe(count);
  });

  it('should handle large sizes', () => {
    const id = generateId(128);
    expect(id).toHaveLength(128);
  });
});
