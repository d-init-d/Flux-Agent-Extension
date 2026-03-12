/**
 * @module test-setup
 * @description Global test setup file for Vitest.
 *
 * Loaded before every test file via vitest.config.ts `setupFiles`.
 *
 * Responsibilities:
 * 1. Import @testing-library/jest-dom matchers (toBeInTheDocument, etc.)
 * 2. Install Web Crypto polyfill for Node/jsdom
 * 3. Install Chrome API mocks
 * 4. Reset all mock state between tests
 */

import '@testing-library/jest-dom/vitest';

import { installWebCryptoMock } from './mocks/web-crypto';
import { installChromeMock, resetAllMocks } from './mocks/chrome';

// ============================================================================
// One-time setup (runs once when setup file is loaded)
// ============================================================================

// Web Crypto must be available before any test imports encryption.ts
installWebCryptoMock();

// Suppress React 19 act() warnings (cosmetic noise from async state updates)
const _originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const msg = typeof args[0] === 'string' ? args[0] : '';
  if (msg.includes('not wrapped in act')) return;
  _originalConsoleError(...args);
};

// ============================================================================
// Per-test lifecycle hooks
// ============================================================================

beforeEach(() => {
  // Install a fresh Chrome mock for every test
  installChromeMock();
});

afterEach(() => {
  // Reset all internal mock state (storage, tabs, cookies, etc.)
  resetAllMocks();

  // Restore all vi.fn() / vi.spyOn() mocks
  vi.restoreAllMocks();
});
