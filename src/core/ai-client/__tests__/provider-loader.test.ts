import type { AIModelConfig } from '@shared/types';
import { createProvider } from '../provider-loader';

describe('provider loader and OpenAI-compatible plumbing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates cliproxyapi from the lazy loader surface', async () => {
    const provider = await createProvider('cliproxyapi');

    expect(provider.name).toBe('cliproxyapi');
    expect(provider.supportsVision).toBe(true);
    expect(provider.supportsFunctionCalling).toBe(true);
  });

  it('uses the documented local default base URL for cliproxyapi validation', async () => {
    const provider = await createProvider('cliproxyapi');
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await provider.initialize({
      provider: 'cliproxyapi',
      model: 'gpt-5',
      apiKey: 'cliproxy-key',
    } satisfies AIModelConfig);

    await expect(provider.validateApiKey('cliproxy-key')).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8317/v1/models', {
      method: 'GET',
      headers: { Authorization: 'Bearer cliproxy-key' },
    });
  });

  it('accepts a versioned custom base URL without duplicating /v1', async () => {
    const provider = await createProvider('cliproxyapi');
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await provider.initialize({
      provider: 'cliproxyapi',
      model: 'gpt-5',
      apiKey: 'cliproxy-key',
      baseUrl: 'https://your-domain/v1',
    } satisfies AIModelConfig);

    await expect(provider.validateApiKey('cliproxy-key')).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('https://your-domain/v1/models', {
      method: 'GET',
      headers: { Authorization: 'Bearer cliproxy-key' },
    });
  });
});
