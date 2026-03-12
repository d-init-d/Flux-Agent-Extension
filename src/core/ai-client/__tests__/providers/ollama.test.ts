import type { AIMessage, AIModelConfig, AIStreamChunk } from '@shared/types';
import { ErrorCode, ExtensionError } from '@shared/errors';
import { OllamaProvider } from '../../providers/ollama';

function createNDJSONFetchMock(chunks: string[]): typeof fetch {
  const encoder = new TextEncoder();
  let chunkIndex = 0;

  const mockReader: ReadableStreamDefaultReader<Uint8Array> = {
    read: vi.fn().mockImplementation(async () => {
      if (chunkIndex < chunks.length) {
        const value = encoder.encode(chunks[chunkIndex]);
        chunkIndex += 1;
        return { done: false, value };
      }
      return { done: true, value: undefined };
    }),
    releaseLock: vi.fn(),
    cancel: vi.fn().mockResolvedValue(undefined),
    closed: Promise.resolve(undefined),
  } as unknown as ReadableStreamDefaultReader<Uint8Array>;

  const mockBody = {
    getReader: vi.fn().mockReturnValue(mockReader),
  } as unknown as ReadableStream<Uint8Array>;

  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/x-ndjson' }),
    body: mockBody,
    text: vi.fn().mockResolvedValue(''),
  });
}

async function collectChunks(
  stream: AsyncGenerator<AIStreamChunk, void, unknown>,
): Promise<AIStreamChunk[]> {
  const chunks: AIStreamChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('OllamaProvider', () => {
  const config: AIModelConfig = {
    provider: 'ollama',
    model: 'llama3.2',
    baseUrl: 'http://localhost:11434',
  };

  it('uses NDJSON stream format, no auth header, and parses text+done chunks', async () => {
    const provider = new OllamaProvider();
    await provider.initialize(config);

    expect(provider.supportsFunctionCalling).toBe(false);

    const ndjson = [
      JSON.stringify({
        message: { role: 'assistant', content: 'Hello from Ollama' },
        done: false,
      }),
      JSON.stringify({
        done: true,
        eval_count: 8,
        prompt_eval_count: 3,
      }),
      '',
    ].join('\n');

    const fetchMock = createNDJSONFetchMock([ndjson]);
    vi.stubGlobal('fetch', fetchMock);

    const messages: AIMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analyze this image' },
          {
            type: 'image',
            image_url: { url: 'data:image/png;base64,ABC123' },
          },
        ],
      },
    ];

    const chunks = await collectChunks(provider.chat(messages));

    expect(chunks).toEqual([
      { type: 'text', content: 'Hello from Ollama' },
      {
        type: 'done',
        usage: {
          inputTokens: 3,
          outputTokens: 8,
        },
      },
    ]);

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = requestInit.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers['Content-Type']).toBe('application/json');

    const requestBody = JSON.parse(String(requestInit.body)) as {
      messages: Array<{ role: string; content: string; images?: string[] }>;
    };
    expect(requestBody.messages[0].content).toBe('Analyze this image');
    expect(requestBody.messages[0].images).toEqual(['ABC123']);
  });

  it('returns AI_PARSE_ERROR chunk when NDJSON line is invalid JSON', async () => {
    const provider = new OllamaProvider();
    await provider.initialize(config);

    const ndjson = ['not-json', JSON.stringify({ done: true })].join('\n');
    vi.stubGlobal('fetch', createNDJSONFetchMock([ndjson]));

    const chunks = await collectChunks(provider.chat([{ role: 'user', content: 'test' }]));

    expect(chunks[0].type).toBe('error');
    expect(chunks[0].error).toBeInstanceOf(ExtensionError);
    expect((chunks[0].error as ExtensionError).code).toBe(ErrorCode.AI_PARSE_ERROR);
    expect(chunks[1]).toEqual({
      type: 'done',
      usage: {
        inputTokens: 0,
        outputTokens: 0,
      },
    });
  });

  it('validateApiKey checks /api/tags availability', async () => {
    const provider = new OllamaProvider();
    await provider.initialize(config);

    const okMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', okMock);
    await expect(provider.validateApiKey('unused')).resolves.toBe(true);
    expect(okMock).toHaveBeenCalledWith(
      'http://localhost:11434/api/tags',
      expect.objectContaining({ method: 'GET' }),
    );

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(provider.validateApiKey('unused')).resolves.toBe(false);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));
    await expect(provider.validateApiKey('unused')).resolves.toBe(false);
  });

  it('maps HTTP 404 to model not found error', async () => {
    const provider = new OllamaProvider();
    await provider.initialize(config);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 404, headers: new Headers({}),
      text: vi.fn().mockResolvedValue(JSON.stringify({ error: 'model not found' })),
    }));

    await expect(
      collectChunks(provider.chat([{ role: 'user', content: 'hi' }], { maxRetries: 0 })),
    ).rejects.toMatchObject({ code: ErrorCode.AI_MODEL_NOT_FOUND });
  });

  it('maps HTTP 429 to rate limit error', async () => {
    const provider = new OllamaProvider();
    await provider.initialize(config);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 429, headers: new Headers({}),
      text: vi.fn().mockResolvedValue(JSON.stringify({ error: 'too many requests' })),
    }));

    await expect(
      collectChunks(provider.chat([{ role: 'user', content: 'hi' }], { maxRetries: 0 })),
    ).rejects.toMatchObject({ code: ErrorCode.AI_RATE_LIMIT });
  });

  it('maps HTTP 500 with non-JSON body', async () => {
    const provider = new OllamaProvider();
    await provider.initialize(config);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 500, headers: new Headers({}),
      text: vi.fn().mockResolvedValue('server error'),
    }));

    await expect(
      collectChunks(provider.chat([{ role: 'user', content: 'hi' }], { maxRetries: 0 })),
    ).rejects.toThrow(/server error/);
  });

  it('maps HTTP error with empty body', async () => {
    const provider = new OllamaProvider();
    await provider.initialize(config);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 503, headers: new Headers({}),
      text: vi.fn().mockResolvedValue(''),
    }));

    await expect(
      collectChunks(provider.chat([{ role: 'user', content: 'hi' }], { maxRetries: 0 })),
    ).rejects.toThrow(/Ollama API error/);
  });

  it('handles streaming chunk with done=false but no content', async () => {
    const provider = new OllamaProvider();
    await provider.initialize(config);

    const ndjson = [
      JSON.stringify({ message: { role: 'assistant', content: '' }, done: false }),
      JSON.stringify({ done: true, eval_count: 1, prompt_eval_count: 2 }),
    ].join('\n');

    vi.stubGlobal('fetch', createNDJSONFetchMock([ndjson]));
    const chunks = await collectChunks(provider.chat([{ role: 'user', content: 'hi' }]));
    expect(chunks).toEqual([{ type: 'done', usage: { inputTokens: 2, outputTokens: 1 } }]);
  });

  it('handles multimodal message with text only (no images)', async () => {
    const provider = new OllamaProvider();
    await provider.initialize(config);

    const ndjson = JSON.stringify({ done: true }) + '\n';
    const fetchMock = createNDJSONFetchMock([ndjson]);
    vi.stubGlobal('fetch', fetchMock);

    await collectChunks(provider.chat([
      { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
    ]));

    const requestBody = JSON.parse(
      String((fetchMock.mock.calls[0][1] as RequestInit).body),
    ) as { messages: Array<{ content: string; images?: string[] }> };
    expect(requestBody.messages[0].content).toBe('Hello');
    expect(requestBody.messages[0].images).toBeUndefined();
  });

  it('handles non-data-url image (raw base64)', async () => {
    const provider = new OllamaProvider();
    await provider.initialize(config);

    const ndjson = JSON.stringify({ done: true }) + '\n';
    const fetchMock = createNDJSONFetchMock([ndjson]);
    vi.stubGlobal('fetch', fetchMock);

    await collectChunks(provider.chat([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Look' },
          { type: 'image', image_url: { url: 'rawBase64Data' } },
        ],
      },
    ]));

    const requestBody = JSON.parse(
      String((fetchMock.mock.calls[0][1] as RequestInit).body),
    ) as { messages: Array<{ images?: string[] }> };
    expect(requestBody.messages[0].images).toEqual(['rawBase64Data']);
  });

  it('uses default base URL when config has no baseUrl', async () => {
    const provider = new OllamaProvider();
    await provider.initialize({ ...config, baseUrl: undefined });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    await provider.validateApiKey('unused');

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'http://localhost:11434/api/tags',
      expect.anything(),
    );
  });

  it('handles simple text message', async () => {
    const provider = new OllamaProvider();
    await provider.initialize(config);

    const ndjson = JSON.stringify({ done: true }) + '\n';
    const fetchMock = createNDJSONFetchMock([ndjson]);
    vi.stubGlobal('fetch', fetchMock);

    await collectChunks(provider.chat([{ role: 'user', content: 'hello' }]));

    const requestBody = JSON.parse(
      String((fetchMock.mock.calls[0][1] as RequestInit).body),
    ) as { messages: Array<{ role: string; content: string }> };
    expect(requestBody.messages[0]).toEqual({ role: 'user', content: 'hello' });
  });

  it('maps HTTP error with JSON error message', async () => {
    const provider = new OllamaProvider();
    await provider.initialize(config);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 400, headers: new Headers({}),
      text: vi.fn().mockResolvedValue(JSON.stringify({ error: 'bad model' })),
    }));

    await expect(
      collectChunks(provider.chat([{ role: 'user', content: 'hi' }], { maxRetries: 0 })),
    ).rejects.toThrow(/bad model/);
  });
});
