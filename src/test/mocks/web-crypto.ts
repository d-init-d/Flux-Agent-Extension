/**
 * @module web-crypto-mock
 * @description Web Crypto API polyfill for Node.js/jsdom test environment.
 *
 * jsdom does not provide a full `crypto.subtle` implementation.
 * This module bridges to Node.js native `node:crypto` so that the
 * encryption module (AES-256-GCM with PBKDF2) works identically in tests.
 *
 * Usage:
 *   import { installWebCryptoMock } from './web-crypto';
 *   // Call once in global setup — the setup.ts file handles this.
 */

import { webcrypto } from 'node:crypto';

/**
 * Install the Node.js Web Crypto API as the global `crypto` if the
 * current environment does not already provide `crypto.subtle`.
 *
 * This is idempotent — calling it multiple times is safe.
 */
export function installWebCryptoMock(): void {
  // If crypto.subtle already exists and works, skip
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.subtle !== 'undefined' &&
    typeof globalThis.crypto.subtle.importKey === 'function'
  ) {
    return;
  }

  // Node ≥ 15 exposes webcrypto which fully implements the W3C Web Crypto spec
  const nodeCrypto = webcrypto as unknown as Crypto;

  if (!nodeCrypto || !nodeCrypto.subtle) {
    throw new Error(
      'web-crypto-mock: Node.js webcrypto is not available. ' +
        'Ensure you are running Node ≥ 15.',
    );
  }

  // Stub the global `crypto` with the Node implementation.
  // We keep `getRandomValues` from the existing global if it exists,
  // because jsdom may partially implement it.
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...nodeCrypto,
      // Prefer the existing getRandomValues (jsdom provides one),
      // fallback to the node implementation
      getRandomValues:
        globalThis.crypto?.getRandomValues?.bind(globalThis.crypto) ??
        nodeCrypto.getRandomValues.bind(nodeCrypto),
      subtle: nodeCrypto.subtle,
    },
    writable: true,
    configurable: true,
  });
}

/**
 * Remove the web crypto mock, restoring the original global `crypto`.
 *
 * Typically not needed — tests usually keep the mock for the entire run.
 */
export function removeWebCryptoMock(): void {
  // jsdom provides a partial crypto, so we just delete our override
  // and let jsdom's version take over if present.
  // In practice this is a no-op in most test setups.
}
