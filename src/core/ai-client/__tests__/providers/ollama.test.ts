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
});
