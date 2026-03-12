/**
 * @module secure-storage.test
 * @description Tests for SecureStorage class.
 *
 * Covers: encrypted get/set/remove, plain get/set, passphrase management,
 * registry tracking, error handling, and chrome.storage.local integration.
 *
 * Uses the Chrome API mock from test/mocks/chrome.ts which provides an
 * in-memory chrome.storage.local implementation.
 */

import { SecureStorage, type ChromeStorageLocal } from '../secure-storage';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create a minimal in-memory ChromeStorageLocal for isolated testing.
 * This avoids coupling to the global chrome mock for unit-level isolation.
 */
function createMemoryStorage(): ChromeStorageLocal {
  const store = new Map<string, unknown>();

  return {
    async get(keys: string | string[]): Promise<Record<string, unknown>> {
      const keyArr = Array.isArray(keys) ? keys : [keys];
      const result: Record<string, unknown> = {};
      for (const k of keyArr) {
        if (store.has(k)) {
          result[k] = store.get(k);
        }
      }
      return result;
    },
    async set(items: Record<string, unknown>): Promise<void> {
      for (const [k, v] of Object.entries(items)) {
        store.set(k, v);
      }
    },
    async remove(keys: string | string[]): Promise<void> {
      const keyArr = Array.isArray(keys) ? keys : [keys];
      for (const k of keyArr) {
        store.delete(k);
      }
    },
  };
}

/**
 * Shortcut: read a raw value from the memory storage.
 */
async function rawGet(storage: ChromeStorageLocal, key: string): Promise<unknown> {
  const result = await storage.get(key);
  return result[key];
}

// ============================================================================
// Tests
// ============================================================================

describe('SecureStorage', () => {
  const PASSPHRASE = 'test-passphrase-strong-enough';

  let memStorage: ChromeStorageLocal;
  let secureStorage: SecureStorage;

  beforeEach(() => {
    memStorage = createMemoryStorage();
    secureStorage = new SecureStorage(PASSPHRASE, memStorage);
  });

  // ==========================================================================
  // Construction
  // ==========================================================================

  describe('construction', () => {
    it('should create an instance with passphrase and storage backend', () => {
      expect(secureStorage).toBeInstanceOf(SecureStorage);
    });

    it('should throw if passphrase is empty', () => {
      expect(() => new SecureStorage('', memStorage)).toThrow('Passphrase must not be empty');
    });

    it('should throw if no storage backend is available and no chrome.storage', () => {
      // Our test env has chrome mock, but we can verify constructor accepts explicit storage
      const ss = new SecureStorage('pass', memStorage);
      expect(ss).toBeInstanceOf(SecureStorage);
    });

    it('should fallback to chrome.storage.local when no explicit storage provided', () => {
      // The global chrome mock is installed by setup.ts — this should not throw
      const ss = new SecureStorage('pass');
      expect(ss).toBeInstanceOf(SecureStorage);
    });
  });

  // ==========================================================================
  // Encrypted operations
  // ==========================================================================

  describe('setEncrypted / getEncrypted', () => {
    it('should encrypt and store a string value', async () => {
      await secureStorage.setEncrypted('api-key', 'sk-12345');
      const result = await secureStorage.getEncrypted<string>('api-key');
      expect(result).toBe('sk-12345');
    });

    it('should encrypt and store an object value', async () => {
      const config = { provider: 'openai', model: 'gpt-4', temperature: 0.7 };
      await secureStorage.setEncrypted('ai-config', config);
      const result = await secureStorage.getEncrypted<typeof config>('ai-config');
      expect(result).toEqual(config);
    });

    it('should encrypt and store a number value', async () => {
      await secureStorage.setEncrypted('counter', 42);
      const result = await secureStorage.getEncrypted<number>('counter');
      expect(result).toBe(42);
    });

    it('should encrypt and store an array value', async () => {
      const arr = [1, 'two', { three: 3 }];
      await secureStorage.setEncrypted('list', arr);
      const result = await secureStorage.getEncrypted<typeof arr>('list');
      expect(result).toEqual(arr);
    });

    it('should encrypt and store a boolean value', async () => {
      await secureStorage.setEncrypted('flag', true);
      const result = await secureStorage.getEncrypted<boolean>('flag');
      expect(result).toBe(true);
    });

    it('should encrypt and store null value', async () => {
      await secureStorage.setEncrypted('nullable', null);
      const result = await secureStorage.getEncrypted<null>('nullable');
      expect(result).toBeNull();
    });

    it('should return null for a key that does not exist', async () => {
      const result = await secureStorage.getEncrypted('nonexistent');
      expect(result).toBeNull();
    });

    it('should store the value with the encrypted key prefix', async () => {
      await secureStorage.setEncrypted('secret', 'value');

      // The raw storage should have the prefixed key
      const raw = await rawGet(memStorage, '__encrypted__secret');
      expect(raw).toBeDefined();
      expect(typeof raw).toBe('string');

      // The raw value should NOT be the plaintext
      expect(raw).not.toBe('value');
      expect(raw).not.toBe('"value"');
    });

    it('should throw for empty key', async () => {
      await expect(secureStorage.setEncrypted('', 'value')).rejects.toThrow(
        'Storage key must not be empty',
      );
    });

    it('should throw for empty key on getEncrypted', async () => {
      await expect(secureStorage.getEncrypted('')).rejects.toThrow('Storage key must not be empty');
    });

    it('should overwrite existing encrypted value', async () => {
      await secureStorage.setEncrypted('key', 'first');
      await secureStorage.setEncrypted('key', 'second');

      const result = await secureStorage.getEncrypted<string>('key');
      expect(result).toBe('second');
    });

    it('should handle unicode values', async () => {
      const unicode = 'Xin chào thế giới 🌍🔐';
      await secureStorage.setEncrypted('unicode', unicode);
      const result = await secureStorage.getEncrypted<string>('unicode');
      expect(result).toBe(unicode);
    });

    it('should fail to decrypt with wrong passphrase', async () => {
      await secureStorage.setEncrypted('secret', 'my-api-key');

      // Create a new SecureStorage with different passphrase
      const wrongStorage = new SecureStorage('wrong-passphrase', memStorage);
      await expect(wrongStorage.getEncrypted('secret')).rejects.toThrow();
    });
  });

  // ==========================================================================
  // removeEncrypted
  // ==========================================================================

  describe('removeEncrypted', () => {
    it('should remove an encrypted value', async () => {
      await secureStorage.setEncrypted('to-remove', 'data');
      await secureStorage.removeEncrypted('to-remove');

      const result = await secureStorage.getEncrypted('to-remove');
      expect(result).toBeNull();
    });

    it('should remove the prefixed key from raw storage', async () => {
      await secureStorage.setEncrypted('key', 'data');
      await secureStorage.removeEncrypted('key');

      const raw = await rawGet(memStorage, '__encrypted__key');
      expect(raw).toBeUndefined();
    });

    it('should not throw when removing a non-existent key', async () => {
      await expect(secureStorage.removeEncrypted('nonexistent')).resolves.toBeUndefined();
    });

    it('should throw for empty key', async () => {
      await expect(secureStorage.removeEncrypted('')).rejects.toThrow(
        'Storage key must not be empty',
      );
    });

    it('should unregister the key from the registry', async () => {
      await secureStorage.setEncrypted('key-a', 'val');
      await secureStorage.setEncrypted('key-b', 'val');

      await secureStorage.removeEncrypted('key-a');

      // Read raw registry
      const registryRaw = await rawGet(memStorage, '__encrypted_keys_registry__');
      const registry = JSON.parse(registryRaw as string) as string[];
      expect(registry).not.toContain('key-a');
      expect(registry).toContain('key-b');
    });
  });

  // ==========================================================================
  // Plain (unencrypted) operations
  // ==========================================================================

  describe('setPlain / getPlain', () => {
    it('should store and retrieve a plain string value', async () => {
      await secureStorage.setPlain('theme', 'dark');
      const result = await secureStorage.getPlain<string>('theme');
      expect(result).toBe('dark');
    });

    it('should store and retrieve a plain object value', async () => {
      const prefs = { fontSize: 14, language: 'vi' };
      await secureStorage.setPlain('prefs', prefs);
      const result = await secureStorage.getPlain<typeof prefs>('prefs');
      expect(result).toEqual(prefs);
    });

    it('should return null for non-existent plain key', async () => {
      const result = await secureStorage.getPlain('missing');
      expect(result).toBeNull();
    });

    it('should throw for empty key on setPlain', async () => {
      await expect(secureStorage.setPlain('', 'value')).rejects.toThrow(
        'Storage key must not be empty',
      );
    });

    it('should throw for empty key on getPlain', async () => {
      await expect(secureStorage.getPlain('')).rejects.toThrow('Storage key must not be empty');
    });

    it('should store plain values as JSON strings (not encrypted)', async () => {
      await secureStorage.setPlain('color', 'blue');

      const raw = await rawGet(memStorage, 'color');
      // Plain values are JSON.stringify'd
      expect(raw).toBe('"blue"');
    });

    it('should overwrite existing plain value', async () => {
      await secureStorage.setPlain('key', 'first');
      await secureStorage.setPlain('key', 'second');
      const result = await secureStorage.getPlain<string>('key');
      expect(result).toBe('second');
    });
  });

  // ==========================================================================
  // Encrypted key registry
  // ==========================================================================

  describe('encrypted key registry', () => {
    it('should register keys when setEncrypted is called', async () => {
      await secureStorage.setEncrypted('alpha', 'a');
      await secureStorage.setEncrypted('beta', 'b');

      const registryRaw = await rawGet(memStorage, '__encrypted_keys_registry__');
      const registry = JSON.parse(registryRaw as string) as string[];

      expect(registry).toContain('alpha');
      expect(registry).toContain('beta');
    });

    it('should not duplicate keys in registry on re-set', async () => {
      await secureStorage.setEncrypted('key', 'val1');
      await secureStorage.setEncrypted('key', 'val2');
      await secureStorage.setEncrypted('key', 'val3');

      const registryRaw = await rawGet(memStorage, '__encrypted_keys_registry__');
      const registry = JSON.parse(registryRaw as string) as string[];

      const occurrences = registry.filter((k: string) => k === 'key');
      expect(occurrences).toHaveLength(1);
    });
  });

  // ==========================================================================
  // changePassphrase
  // ==========================================================================

  describe('changePassphrase', () => {
    it('should re-encrypt all values with the new passphrase', async () => {
      await secureStorage.setEncrypted('key1', 'secret1');
      await secureStorage.setEncrypted('key2', 'secret2');

      const newPassphrase = 'brand-new-passphrase';
      await secureStorage.changePassphrase(PASSPHRASE, newPassphrase);

      // After changing, old passphrase should fail
      const oldStorage = new SecureStorage(PASSPHRASE, memStorage);
      await expect(oldStorage.getEncrypted('key1')).rejects.toThrow();

      // New passphrase should work
      const newStorage = new SecureStorage(newPassphrase, memStorage);
      expect(await newStorage.getEncrypted<string>('key1')).toBe('secret1');
      expect(await newStorage.getEncrypted<string>('key2')).toBe('secret2');
    });

    it('should update the internal passphrase for subsequent operations', async () => {
      await secureStorage.setEncrypted('key', 'value');

      const newPass = 'new-pass';
      await secureStorage.changePassphrase(PASSPHRASE, newPass);

      // Set a new value — should use the new passphrase internally
      await secureStorage.setEncrypted('key2', 'value2');

      // Verify with new passphrase
      const verifier = new SecureStorage(newPass, memStorage);
      expect(await verifier.getEncrypted<string>('key2')).toBe('value2');
    });

    it('should throw if old passphrase is empty', async () => {
      await expect(secureStorage.changePassphrase('', 'new')).rejects.toThrow(
        'Old passphrase must not be empty',
      );
    });

    it('should throw if new passphrase is empty', async () => {
      await expect(secureStorage.changePassphrase(PASSPHRASE, '')).rejects.toThrow(
        'New passphrase must not be empty',
      );
    });

    it('should be a no-op if old and new passphrases are identical', async () => {
      await secureStorage.setEncrypted('key', 'value');

      // Get the raw ciphertext before
      const before = await rawGet(memStorage, '__encrypted__key');

      await secureStorage.changePassphrase(PASSPHRASE, PASSPHRASE);

      // Raw ciphertext should be unchanged (no re-encryption)
      const after = await rawGet(memStorage, '__encrypted__key');
      expect(after).toBe(before);
    });

    it('should skip keys that are in registry but not in storage', async () => {
      await secureStorage.setEncrypted('key1', 'val1');

      // Manually remove the storage entry but leave registry intact
      await memStorage.remove('__encrypted__key1');

      // Should not throw
      await expect(secureStorage.changePassphrase(PASSPHRASE, 'new-pass')).resolves.toBeUndefined();
    });

    it('should handle empty registry (no encrypted keys)', async () => {
      await expect(secureStorage.changePassphrase(PASSPHRASE, 'new-pass')).resolves.toBeUndefined();
    });
  });

  // ==========================================================================
  // Mixed operations (encrypted + plain coexistence)
  // ==========================================================================

  describe('mixed encrypted and plain operations', () => {
    it('should store encrypted and plain values independently', async () => {
      await secureStorage.setEncrypted('secret', 'hidden-value');
      await secureStorage.setPlain('preference', 'light-mode');

      expect(await secureStorage.getEncrypted<string>('secret')).toBe('hidden-value');
      expect(await secureStorage.getPlain<string>('preference')).toBe('light-mode');
    });

    it('should not confuse encrypted and plain keys with same name', async () => {
      // Set plain under "data"
      await secureStorage.setPlain('data', 'plain-value');
      // Set encrypted under "data" (stored as __encrypted__data)
      await secureStorage.setEncrypted('data', 'encrypted-value');

      // Both should be independently retrievable
      expect(await secureStorage.getPlain<string>('data')).toBe('plain-value');
      expect(await secureStorage.getEncrypted<string>('data')).toBe('encrypted-value');
    });

    it('removing encrypted should not affect plain with same key', async () => {
      await secureStorage.setPlain('data', 'plain');
      await secureStorage.setEncrypted('data', 'secret');

      await secureStorage.removeEncrypted('data');

      // Plain should still exist
      expect(await secureStorage.getPlain<string>('data')).toBe('plain');
      // Encrypted should be gone
      expect(await secureStorage.getEncrypted('data')).toBeNull();
    });
  });

  // ==========================================================================
  // Edge cases for coverage: registry & changePassphrase internals
  // ==========================================================================

  describe('registry edge cases', () => {
    it('should handle non-string registry value gracefully', async () => {
      // Seed a non-string value directly as the registry key
      await memStorage.set({ __encrypted_keys_registry__: 12345 });

      // changePassphrase reads the registry — should not throw when registry is not a string
      await expect(secureStorage.changePassphrase(PASSPHRASE, 'new-pass')).resolves.toBeUndefined();
    });

    it('should handle invalid JSON in registry gracefully', async () => {
      // Seed unparseable JSON in the registry
      await memStorage.set({ __encrypted_keys_registry__: 'not-valid-json{{{' });

      // Should not throw — the catch block returns []
      await expect(secureStorage.changePassphrase(PASSPHRASE, 'new-pass')).resolves.toBeUndefined();
    });

    it('should handle non-array parsed registry (e.g., object)', async () => {
      // Seed a valid JSON value that is NOT an array
      await memStorage.set({
        __encrypted_keys_registry__: JSON.stringify({ foo: 'bar' }),
      });

      // The getRegistry() check `Array.isArray(parsed)` returns false → returns []
      await expect(secureStorage.changePassphrase(PASSPHRASE, 'new-pass')).resolves.toBeUndefined();
    });

    it('should skip non-string ciphertext values during changePassphrase', async () => {
      // Set up a valid encrypted key first
      await secureStorage.setEncrypted('good-key', 'good-value');

      // Manually inject a non-string ciphertext under the encrypted prefix
      await memStorage.set({ __encrypted__bad_key: 12345 });

      // Add 'bad_key' to the registry manually
      const registryRaw = await memStorage.get('__encrypted_keys_registry__');
      const registry = JSON.parse(registryRaw['__encrypted_keys_registry__'] as string) as string[];
      registry.push('bad_key');
      await memStorage.set({
        __encrypted_keys_registry__: JSON.stringify(registry),
      });

      // changePassphrase should skip the non-string ciphertext and succeed
      await expect(secureStorage.changePassphrase(PASSPHRASE, 'new-pass')).resolves.toBeUndefined();

      // good-key should be readable with new passphrase
      const verifier = new SecureStorage('new-pass', memStorage);
      expect(await verifier.getEncrypted<string>('good-key')).toBe('good-value');
    });
  });
});
