/**
 * @module encryption
 * @description AES-256-GCM encryption/decryption using Web Crypto API.
 * Zero external dependencies — uses only browser-native crypto.
 *
 * Format: base64(salt[16] + iv[12] + ciphertext + authTag[16])
 *
 * Key derivation: PBKDF2 with 310,000 iterations (OWASP 2024 recommendation)
 * Cipher: AES-256-GCM (authenticated encryption)
 */

// ============================================================================
// Constants
// ============================================================================

/** PBKDF2 iteration count per OWASP recommendation for SHA-256 */
const PBKDF2_ITERATIONS = 310_000;

/** Salt length in bytes — 128-bit minimum per NIST SP 800-132 */
const SALT_LENGTH = 16;

/** AES-GCM IV length in bytes — 96-bit is recommended by NIST */
const IV_LENGTH = 12;

/** AES key length in bits */
const AES_KEY_LENGTH = 256;

/** Hash algorithm for PBKDF2 */
const HASH_ALGORITHM = 'SHA-256';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Convert an ArrayBuffer to a base64-encoded string.
 *
 * @param buffer - The raw binary data to encode.
 * @returns A base64-encoded string representation.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert a base64-encoded string back to an ArrayBuffer.
 *
 * @param base64 - The base64-encoded string to decode.
 * @returns The decoded binary data as an ArrayBuffer.
 * @throws {Error} If the input is not valid base64.
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  if (base64.length === 0) {
    return new ArrayBuffer(0);
  }

  let binaryString: string;
  try {
    binaryString = atob(base64);
  } catch {
    throw new Error('Invalid base64 input');
  }

  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Generate cryptographically secure random bytes.
 *
 * @param length - Number of random bytes to generate. Must be > 0.
 * @returns A Uint8Array filled with random bytes.
 * @throws {Error} If length is not a positive integer.
 */
export function generateRandomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length <= 0) {
    throw new Error(`Invalid length: expected positive integer, got ${length}`);
  }
  return crypto.getRandomValues(new Uint8Array(length));
}

// ============================================================================
// Key Derivation
// ============================================================================

/**
 * Derive an AES-256-GCM CryptoKey from a passphrase and salt using PBKDF2.
 *
 * Uses 310,000 iterations of PBKDF2-HMAC-SHA-256 per OWASP recommendations.
 * The resulting key is non-extractable and can only be used for encrypt/decrypt.
 *
 * @param passphrase - The user-provided passphrase. Must not be empty.
 * @param salt - A random 16-byte salt. Must be exactly SALT_LENGTH bytes.
 * @returns A CryptoKey suitable for AES-256-GCM operations.
 * @throws {Error} If passphrase is empty or salt has incorrect length.
 */
export async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  if (!passphrase) {
    throw new Error('Passphrase must not be empty');
  }
  if (salt.byteLength !== SALT_LENGTH) {
    throw new Error(`Salt must be exactly ${SALT_LENGTH} bytes, got ${salt.byteLength}`);
  }

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: HASH_ALGORITHM,
    },
    keyMaterial,
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    false, // non-extractable for security
    ['encrypt', 'decrypt'],
  );
}

// ============================================================================
// Encrypt / Decrypt
// ============================================================================

/**
 * Encrypt plaintext using AES-256-GCM with a passphrase-derived key.
 *
 * Process:
 * 1. Generate random 16-byte salt
 * 2. Generate random 12-byte IV
 * 3. Derive AES-256-GCM key from passphrase + salt via PBKDF2
 * 4. Encrypt with AES-GCM (produces ciphertext + 16-byte auth tag)
 * 5. Concatenate: salt(16) | iv(12) | ciphertext+authTag
 * 6. Return base64-encoded result
 *
 * @param plaintext - The string to encrypt. May be empty.
 * @param passphrase - The passphrase used for key derivation. Must not be empty.
 * @returns A base64-encoded string containing salt + IV + ciphertext + auth tag.
 * @throws {Error} If passphrase is empty or encryption fails.
 */
export async function encrypt(plaintext: string, passphrase: string): Promise<string> {
  if (!passphrase) {
    throw new Error('Passphrase must not be empty');
  }

  const salt = generateRandomBytes(SALT_LENGTH);
  const iv = generateRandomBytes(IV_LENGTH);
  const key = await deriveKey(passphrase, salt);

  const encoder = new TextEncoder();
  const encoded = encoder.encode(plaintext);

  // AES-GCM encrypt — result includes 16-byte auth tag appended to ciphertext
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    encoded,
  );

  // Combine: salt(16) + iv(12) + ciphertext+authTag
  const combined = new Uint8Array(SALT_LENGTH + IV_LENGTH + ciphertext.byteLength);
  combined.set(salt, 0);
  combined.set(iv, SALT_LENGTH);
  combined.set(new Uint8Array(ciphertext), SALT_LENGTH + IV_LENGTH);

  return arrayBufferToBase64(combined.buffer);
}

/**
 * Decrypt an AES-256-GCM encrypted payload produced by {@link encrypt}.
 *
 * Process:
 * 1. Decode base64 to binary
 * 2. Extract salt (first 16 bytes), IV (next 12 bytes), ciphertext (rest)
 * 3. Derive key from passphrase + salt
 * 4. Decrypt with AES-GCM (verifies auth tag)
 * 5. Return decoded plaintext
 *
 * @param encryptedData - The base64-encoded encrypted payload from {@link encrypt}.
 * @param passphrase - The passphrase used during encryption.
 * @returns The original plaintext string.
 * @throws {Error} If the passphrase is wrong, data is corrupted, or format is invalid.
 */
export async function decrypt(encryptedData: string, passphrase: string): Promise<string> {
  if (!passphrase) {
    throw new Error('Passphrase must not be empty');
  }
  if (!encryptedData) {
    throw new Error('Encrypted data must not be empty');
  }

  let combined: Uint8Array;
  try {
    combined = new Uint8Array(base64ToArrayBuffer(encryptedData));
  } catch {
    throw new Error('Invalid encrypted data: not valid base64');
  }

  // Minimum size: salt(16) + iv(12) + authTag(16) = 44 bytes
  // (empty plaintext still produces a 16-byte auth tag)
  const MIN_PAYLOAD_LENGTH = SALT_LENGTH + IV_LENGTH + 16;
  if (combined.byteLength < MIN_PAYLOAD_LENGTH) {
    throw new Error(
      `Invalid encrypted data: payload too short (expected at least ${MIN_PAYLOAD_LENGTH} bytes, got ${combined.byteLength})`,
    );
  }

  const salt = combined.slice(0, SALT_LENGTH);
  const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = combined.slice(SALT_LENGTH + IV_LENGTH);

  const key = await deriveKey(passphrase, salt);

  let decrypted: ArrayBuffer;
  try {
    decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      ciphertext,
    );
  } catch {
    throw new Error('Decryption failed: wrong passphrase or corrupted data');
  }

  return new TextDecoder().decode(decrypted);
}
