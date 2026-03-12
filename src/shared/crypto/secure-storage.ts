/**
 * @module secure-storage
 * @description Wrapper around chrome.storage.local providing transparent
 * AES-256-GCM encryption for sensitive data alongside plaintext storage
 * for non-sensitive settings.
 *
 * Encrypted values are stored with a key prefix and tracked in an internal
 * registry so that changePassphrase can re-encrypt all sensitive data.
 */

import { encrypt, decrypt } from './encryption';

// ============================================================================
// Constants
// ============================================================================

/** Prefix added to storage keys for encrypted values */
const ENCRYPTED_KEY_PREFIX = '__encrypted__';

/** Storage key that holds the list of encrypted key names */
const ENCRYPTED_KEYS_REGISTRY = '__encrypted_keys_registry__';

// ============================================================================
// Types
// ============================================================================

/**
 * Abstraction over chrome.storage.local for testability.
 * In tests, provide a mock that satisfies this interface.
 */
export interface ChromeStorageLocal {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

// ============================================================================
// SecureStorage
// ============================================================================

/**
 * Provides encrypted and plaintext key-value storage backed by
 * chrome.storage.local (or any ChromeStorageLocal-compatible backend).
 *
 * Encrypted values are JSON-stringified, encrypted with AES-256-GCM via
 * the passphrase, and stored with a prefixed key. A registry tracks all
 * encrypted key names so changePassphrase can locate and re-encrypt them.
 */
export class SecureStorage {
  private passphrase: string;
  private readonly storage: ChromeStorageLocal;

  /**
   * @param passphrase - Master passphrase for encryption. Must not be empty.
   * @param storage    - Optional storage backend (defaults to chrome.storage.local).
   * @throws {Error} If passphrase is empty or no storage backend is available.
   */
  constructor(passphrase: string, storage?: ChromeStorageLocal) {
    if (!passphrase) {
      throw new Error('Passphrase must not be empty');
    }
    this.passphrase = passphrase;

    if (storage) {
      this.storage = storage;
    } else if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
      this.storage = chrome.storage.local as unknown as ChromeStorageLocal;
    } else {
      throw new Error(
        'No storage backend available. Provide a ChromeStorageLocal implementation or run in a Chrome extension context.',
      );
    }
  }

  // --------------------------------------------------------------------------
  // Encrypted operations
  // --------------------------------------------------------------------------

  /**
   * Encrypt and store a value under the given key.
   *
   * The value is JSON-stringified, encrypted with AES-256-GCM, and stored
   * with a prefixed key. The key name is added to the encrypted-keys registry.
   *
   * @param key   - Logical key name (without prefix).
   * @param value - Any JSON-serializable value.
   * @throws {Error} If key is empty.
   */
  async setEncrypted<T>(key: string, value: T): Promise<void> {
    if (!key) {
      throw new Error('Storage key must not be empty');
    }

    const plaintext = JSON.stringify(value);
    const ciphertext = await encrypt(plaintext, this.passphrase);
    const storageKey = ENCRYPTED_KEY_PREFIX + key;

    await this.storage.set({ [storageKey]: ciphertext });
    await this.registerKey(key);
  }

  /**
   * Retrieve and decrypt a value stored with {@link setEncrypted}.
   *
   * @param key - Logical key name (without prefix).
   * @returns The decrypted and parsed value, or `null` if the key does not exist.
   * @throws {Error} If key is empty or decryption fails (wrong passphrase / corrupted data).
   */
  async getEncrypted<T>(key: string): Promise<T | null> {
    if (!key) {
      throw new Error('Storage key must not be empty');
    }

    const storageKey = ENCRYPTED_KEY_PREFIX + key;
    const result = await this.storage.get(storageKey);
    const ciphertext = result[storageKey];

    if (ciphertext === undefined || ciphertext === null) {
      return null;
    }

    if (typeof ciphertext !== 'string') {
      throw new Error(`Expected encrypted value to be a string, got ${typeof ciphertext}`);
    }

    const plaintext = await decrypt(ciphertext, this.passphrase);
    return JSON.parse(plaintext) as T;
  }

  /**
   * Remove an encrypted value and unregister its key from the registry.
   *
   * @param key - Logical key name (without prefix).
   * @throws {Error} If key is empty.
   */
  async removeEncrypted(key: string): Promise<void> {
    if (!key) {
      throw new Error('Storage key must not be empty');
    }

    const storageKey = ENCRYPTED_KEY_PREFIX + key;
    await this.storage.remove(storageKey);
    await this.unregisterKey(key);
  }

  // --------------------------------------------------------------------------
  // Plain (unencrypted) operations
  // --------------------------------------------------------------------------

  /**
   * Store a value without encryption (for non-sensitive data like UI preferences).
   *
   * @param key   - Storage key.
   * @param value - Any JSON-serializable value.
   * @throws {Error} If key is empty.
   */
  async setPlain<T>(key: string, value: T): Promise<void> {
    if (!key) {
      throw new Error('Storage key must not be empty');
    }
    await this.storage.set({ [key]: JSON.stringify(value) });
  }

  /**
   * Retrieve a plaintext value stored with {@link setPlain}.
   *
   * @param key - Storage key.
   * @returns The parsed value, or `null` if the key does not exist.
   * @throws {Error} If key is empty.
   */
  async getPlain<T>(key: string): Promise<T | null> {
    if (!key) {
      throw new Error('Storage key must not be empty');
    }

    const result = await this.storage.get(key);
    const raw = result[key];

    if (raw === undefined || raw === null) {
      return null;
    }

    if (typeof raw !== 'string') {
      throw new Error(`Expected plain value to be a string, got ${typeof raw}`);
    }

    return JSON.parse(raw) as T;
  }

  // --------------------------------------------------------------------------
  // Passphrase management
  // --------------------------------------------------------------------------

  /**
   * Re-encrypt all encrypted values with a new passphrase.
   *
   * Process:
   * 1. Read the encrypted-keys registry.
   * 2. For each key: decrypt with old passphrase, re-encrypt with new passphrase.
   * 3. Update the internal passphrase on success.
   *
   * **Warning:** This operation is NOT atomic. If it fails midway, some keys
   * may be encrypted with the new passphrase and others with the old one.
   * Callers should handle this scenario (e.g., keep a backup).
   *
   * @param oldPassphrase - Current passphrase (must match stored encryption).
   * @param newPassphrase - New passphrase to use going forward.
   * @throws {Error} If either passphrase is empty or decryption fails.
   */
  async changePassphrase(oldPassphrase: string, newPassphrase: string): Promise<void> {
    if (!oldPassphrase) {
      throw new Error('Old passphrase must not be empty');
    }
    if (!newPassphrase) {
      throw new Error('New passphrase must not be empty');
    }
    if (oldPassphrase === newPassphrase) {
      return; // No-op: passphrases are identical
    }

    const keys = await this.getRegistry();

    for (const key of keys) {
      const storageKey = ENCRYPTED_KEY_PREFIX + key;
      const result = await this.storage.get(storageKey);
      const ciphertext = result[storageKey];

      if (ciphertext === undefined || ciphertext === null) {
        // Key in registry but not in storage — skip (may have been removed externally)
        continue;
      }

      if (typeof ciphertext !== 'string') {
        continue;
      }

      // Decrypt with old passphrase
      const plaintext = await decrypt(ciphertext, oldPassphrase);

      // Re-encrypt with new passphrase
      const newCiphertext = await encrypt(plaintext, newPassphrase);

      await this.storage.set({ [storageKey]: newCiphertext });
    }

    // Update internal passphrase only after all keys are successfully re-encrypted
    this.passphrase = newPassphrase;
  }

  // --------------------------------------------------------------------------
  // Registry (private helpers)
  // --------------------------------------------------------------------------

  /**
   * Get the list of key names that have encrypted values.
   */
  private async getRegistry(): Promise<string[]> {
    const result = await this.storage.get(ENCRYPTED_KEYS_REGISTRY);
    const raw = result[ENCRYPTED_KEYS_REGISTRY];

    if (raw === undefined || raw === null) {
      return [];
    }

    if (typeof raw !== 'string') {
      return [];
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === 'string');
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Add a key name to the encrypted-keys registry (idempotent).
   */
  private async registerKey(key: string): Promise<void> {
    const keys = await this.getRegistry();
    if (!keys.includes(key)) {
      keys.push(key);
      await this.updateRegistry(keys);
    }
  }

  /**
   * Remove a key name from the encrypted-keys registry.
   */
  private async unregisterKey(key: string): Promise<void> {
    const keys = await this.getRegistry();
    const filtered = keys.filter((k) => k !== key);
    if (filtered.length !== keys.length) {
      await this.updateRegistry(filtered);
    }
  }

  /**
   * Persist the encrypted-keys registry to storage.
   */
  private async updateRegistry(keys: string[]): Promise<void> {
    await this.storage.set({
      [ENCRYPTED_KEYS_REGISTRY]: JSON.stringify(keys),
    });
  }
}
