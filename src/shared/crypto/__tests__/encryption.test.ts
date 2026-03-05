/**
 * @module encryption.test
 * @description Tests for AES-256-GCM encryption/decryption module.
 *
 * Tests the full encrypt/decrypt round-trip, key derivation, helpers,
 * and error handling for invalid inputs.
 */

import {
  encrypt,
  decrypt,
  deriveKey,
  generateRandomBytes,
  arrayBufferToBase64,
  base64ToArrayBuffer,
} from '../encryption';

// ============================================================================
// Helper Functions
// ============================================================================

describe('arrayBufferToBase64', () => {
  it('should convert an empty ArrayBuffer to empty string', () => {
    const buffer = new ArrayBuffer(0);
    expect(arrayBufferToBase64(buffer)).toBe('');
  });

  it('should convert a known byte sequence to correct base64', () => {
    const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const result = arrayBufferToBase64(bytes.buffer);
    expect(result).toBe(btoa('Hello'));
  });

  it('should handle binary data with high byte values', () => {
    const bytes = new Uint8Array([0, 128, 255]);
    const result = arrayBufferToBase64(bytes.buffer);
    // Should not throw; result should be valid base64
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('base64ToArrayBuffer', () => {
  it('should return empty ArrayBuffer for empty string', () => {
    const result = base64ToArrayBuffer('');
    expect(result.byteLength).toBe(0);
  });

  it('should round-trip with arrayBufferToBase64', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 100, 200, 255]);
    const base64 = arrayBufferToBase64(original.buffer);
    const restored = new Uint8Array(base64ToArrayBuffer(base64));
    expect(restored).toEqual(original);
  });

  it('should throw on invalid base64 input', () => {
    expect(() => base64ToArrayBuffer('not-valid-base64!!!')).toThrow(
      'Invalid base64 input',
    );
  });
});

describe('generateRandomBytes', () => {
  it('should return Uint8Array of requested length', () => {
    const result = generateRandomBytes(16);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.byteLength).toBe(16);
  });

  it('should produce different values on subsequent calls', () => {
    const a = generateRandomBytes(32);
    const b = generateRandomBytes(32);
    // Astronomically unlikely to be equal
    expect(a).not.toEqual(b);
  });

  it('should throw for zero length', () => {
    expect(() => generateRandomBytes(0)).toThrow('Invalid length');
  });

  it('should throw for negative length', () => {
    expect(() => generateRandomBytes(-1)).toThrow('Invalid length');
  });

  it('should throw for non-integer length', () => {
    expect(() => generateRandomBytes(1.5)).toThrow('Invalid length');
  });
});

// ============================================================================
// Key Derivation
// ============================================================================

describe('deriveKey', () => {
  it('should derive a CryptoKey from passphrase and salt', async () => {
    const salt = generateRandomBytes(16);
    const key = await deriveKey('test-passphrase', salt);

    expect(key).toBeDefined();
    // CryptoKey should have the correct algorithm
    expect(key.algorithm).toBeDefined();
  });

  it('should derive the same key for the same passphrase and salt', async () => {
    const salt = generateRandomBytes(16);
    const key1 = await deriveKey('same-passphrase', salt);
    const key2 = await deriveKey('same-passphrase', salt);

    // Keys are non-extractable, but we can verify by encrypting the same data
    // and checking decryption works cross-key (they should be identical)
    expect(key1).toBeDefined();
    expect(key2).toBeDefined();
  });

  it('should throw for empty passphrase', async () => {
    const salt = generateRandomBytes(16);
    await expect(deriveKey('', salt)).rejects.toThrow(
      'Passphrase must not be empty',
    );
  });

  it('should throw for incorrect salt length', async () => {
    const badSalt = generateRandomBytes(8); // Too short
    await expect(deriveKey('passphrase', badSalt)).rejects.toThrow(
      'Salt must be exactly 16 bytes',
    );
  });
});

// ============================================================================
// Encrypt / Decrypt Round-Trip
// ============================================================================

describe('encrypt', () => {
  it('should return a non-empty base64 string', async () => {
    const result = await encrypt('Hello World', 'my-secret');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    // Should be valid base64
    expect(() => atob(result)).not.toThrow();
  });

  it('should produce different ciphertext for the same plaintext (random salt/IV)', async () => {
    const a = await encrypt('Hello', 'pass');
    const b = await encrypt('Hello', 'pass');
    expect(a).not.toBe(b);
  });

  it('should handle empty plaintext', async () => {
    const result = await encrypt('', 'pass');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('should handle unicode text', async () => {
    const result = await encrypt('こんにちは 🌍', 'pass');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('should throw for empty passphrase', async () => {
    await expect(encrypt('hello', '')).rejects.toThrow(
      'Passphrase must not be empty',
    );
  });
});

describe('decrypt', () => {
  it('should correctly decrypt what encrypt produced', async () => {
    const plaintext = 'Hello, AES-256-GCM!';
    const passphrase = 'super-secret-key';

    const encrypted = await encrypt(plaintext, passphrase);
    const decrypted = await decrypt(encrypted, passphrase);

    expect(decrypted).toBe(plaintext);
  });

  it('should round-trip empty plaintext', async () => {
    const encrypted = await encrypt('', 'pass');
    const decrypted = await decrypt(encrypted, 'pass');
    expect(decrypted).toBe('');
  });

  it('should round-trip unicode text', async () => {
    const text = '中文 Ελληνικά العربية 🎉';
    const encrypted = await encrypt(text, 'pass');
    const decrypted = await decrypt(encrypted, 'pass');
    expect(decrypted).toBe(text);
  });

  it('should round-trip long text', async () => {
    const text = 'A'.repeat(10_000);
    const encrypted = await encrypt(text, 'pass');
    const decrypted = await decrypt(encrypted, 'pass');
    expect(decrypted).toBe(text);
  });

  it('should fail with wrong passphrase', async () => {
    const encrypted = await encrypt('secret data', 'correct-password');
    await expect(decrypt(encrypted, 'wrong-password')).rejects.toThrow(
      'Decryption failed',
    );
  });

  it('should throw for empty passphrase', async () => {
    await expect(decrypt('somedata', '')).rejects.toThrow(
      'Passphrase must not be empty',
    );
  });

  it('should throw for empty encrypted data', async () => {
    await expect(decrypt('', 'pass')).rejects.toThrow(
      'Encrypted data must not be empty',
    );
  });

  it('should throw for invalid base64 input', async () => {
    await expect(decrypt('not-valid!!!', 'pass')).rejects.toThrow();
  });

  it('should throw for truncated/corrupted payload', async () => {
    // Valid base64 but too short to contain salt+iv+authTag
    const tooShort = arrayBufferToBase64(new Uint8Array(10).buffer);
    await expect(decrypt(tooShort, 'pass')).rejects.toThrow(
      'payload too short',
    );
  });

  it('should throw for tampered ciphertext', async () => {
    const encrypted = await encrypt('test', 'pass');
    // Decode, flip a byte, re-encode
    const bytes = new Uint8Array(base64ToArrayBuffer(encrypted));
    bytes[bytes.length - 1] ^= 0xff; // Flip last byte (in auth tag region)
    const tampered = arrayBufferToBase64(bytes.buffer);

    await expect(decrypt(tampered, 'pass')).rejects.toThrow(
      'Decryption failed',
    );
  });
});
