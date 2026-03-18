import { describe, expect, it } from 'vitest';

import {
  evaluateProviderEndpointPolicy,
  getProviderEndpointHelperText,
  normalizeProviderEndpoint,
} from '../../provider-endpoints';

describe('provider endpoint policy', () => {
  it('normalizes cliproxyapi /v1 resource URLs to a stable endpoint', () => {
    expect(
      normalizeProviderEndpoint('cliproxyapi', 'http://127.0.0.1:8317/v1/chat/completions'),
    ).toBe('http://127.0.0.1:8317/v1');
    expect(normalizeProviderEndpoint('cliproxyapi', 'https://proxy.example.com/v1/models')).toBe(
      'https://proxy.example.com/v1',
    );
    expect(normalizeProviderEndpoint('cliproxyapi', 'https://proxy.example.com/proxy/v1/')).toBe(
      'https://proxy.example.com/proxy/v1',
    );
  });

  it('allows cliproxyapi local loopback HTTP and hosted HTTPS only', () => {
    expect(evaluateProviderEndpointPolicy('cliproxyapi', 'http://localhost:8317').valid).toBe(true);
    expect(evaluateProviderEndpointPolicy('cliproxyapi', 'http://127.0.0.1:8317').valid).toBe(
      true,
    );
    expect(evaluateProviderEndpointPolicy('cliproxyapi', 'http://[::1]:8317/v1').valid).toBe(
      true,
    );
    expect(evaluateProviderEndpointPolicy('cliproxyapi', 'https://proxy.example.com/v1').valid).toBe(
      true,
    );

    expect(evaluateProviderEndpointPolicy('cliproxyapi', 'http://192.168.1.10:8317').valid).toBe(
      false,
    );
    expect(evaluateProviderEndpointPolicy('cliproxyapi', 'http://proxy.example.com/v1').valid).toBe(
      false,
    );
    expect(evaluateProviderEndpointPolicy('cliproxyapi', 'https://proxy.example.com/api').valid).toBe(
      false,
    );
  });

  it('keeps other provider policies narrow', () => {
    expect(
      normalizeProviderEndpoint('openai', 'https://api.openai.com/v1/chat/completions'),
    ).toBe('https://api.openai.com/v1');
    expect(normalizeProviderEndpoint('ollama', 'http://localhost:11434/v1/models')).toBe(
      'http://localhost:11434/v1',
    );
    expect(evaluateProviderEndpointPolicy('openai', 'https://api.openai.com/').normalizedEndpoint).toBe(
      'https://api.openai.com',
    );
    expect(evaluateProviderEndpointPolicy('openai', 'http://api.openai.com').valid).toBe(false);
    expect(evaluateProviderEndpointPolicy('ollama', 'http://localhost:11434/').normalizedEndpoint).toBe(
      'http://localhost:11434',
    );
    expect(evaluateProviderEndpointPolicy('ollama', 'https://localhost:11434').valid).toBe(false);
    expect(evaluateProviderEndpointPolicy('ollama', 'http://192.168.1.10:11434').valid).toBe(false);
  });

  it('exposes cliproxyapi-specific helper copy', () => {
    expect(getProviderEndpointHelperText('cliproxyapi')).toMatch(/normalize/i);
    expect(getProviderEndpointHelperText('cliproxyapi')).toMatch(/127\.0\.0\.1/i);
  });

  it('exposes provider-specific helper copy for loopback and https rules', () => {
    expect(getProviderEndpointHelperText('ollama')).toMatch(/loopback http/i);
    expect(getProviderEndpointHelperText('openai')).toMatch(/https/i);
    expect(getProviderEndpointHelperText('openai')).toMatch(/\/v1\/chat\/completions/i);
  });
});
