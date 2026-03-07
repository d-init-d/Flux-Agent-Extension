import type { AIMessage, AIModelConfig, AIStreamChunk, AITool } from '@shared/types';
import { GeminiProvider } from '../../providers/gemini';

function formatSSEData(data: unknown): string {
  return `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
}

function createStreamingFetchMock(chunks: string[]): typeof fetch {
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
    headers: new Headers({ 'content-type': 'text/event-stream' }),
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

describe('GeminiProvider', () => {
  const config: AIModelConfig = {
    provider: 'gemini',
    model: 'gemini-2.0-flash',
    apiKey: 'gemini-key',
    temperature: 0.3,
  };

  it('uses header auth and builds systemInstruction, role mapping, inlineData, and tools', async () => {
    const provider = new GeminiProvider();
    await provider.initialize(config);

    const streamPayload = formatSSEData({
      candidates: [
        {
          finishReason: 'STOP',
          content: { parts: [] },
        },
      ],
      usageMetadata: {
        promptTokenCount: 8,
        candidatesTokenCount: 3,
      },
    });

    const fetchMock = createStreamingFetchMock([streamPayload]);
    vi.stubGlobal('fetch', fetchMock);

    const tools: AITool[] = [
      {
        type: 'function',
        function: {
          name: 'search_docs',
          description: 'Search docs',
          parameters: { type: 'object', properties: { q: { type: 'string' } } },
        },
      },
    ];

    const messages: AIMessage[] = [
      { role: 'system', content: 'System instruction' },
      { role: 'assistant', content: 'I previously replied' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Please analyze this image' },
          {
            type: 'image',
            image_url: { url: 'data:image/png;base64,AAA' },
          },
        ],
      },
    ];

    const chunks = await collectChunks(provider.chat(messages, { tools }));
    expect(chunks).toEqual([
      {
        type: 'done',
        usage: {
          inputTokens: 8,
          outputTokens: 3,
        },
      },
    ]);

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain('/v1beta/models/gemini-2.0-flash:streamGenerateContent');
    expect(calledUrl).toContain('alt=sse');
    expect(calledUrl).not.toContain('key=gemini-key');

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(requestInit.headers).toEqual(
      expect.objectContaining({ 'x-goog-api-key': 'gemini-key' }),
    );
    const body = JSON.parse(String(requestInit.body)) as {
      systemInstruction: { parts: Array<{ text: string }> };
      contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
      tools: Array<{ functionDeclarations: unknown[] }>;
    };

    expect(body.systemInstruction.parts[0].text).toBe('System instruction');
    expect(body.contents[0].role).toBe('model');
    expect(body.contents[1].role).toBe('user');
    expect(body.contents[1].parts[0]).toEqual({ text: 'Please analyze this image' });
    expect(body.contents[1].parts[1]).toEqual({
      inlineData: {
        mimeType: 'image/png',
        data: 'AAA',
      },
    });
    expect(body.tools[0].functionDeclarations).toHaveLength(1);
  });

  it('emits tool_call chunk from functionCall part with generated id', async () => {
    const provider = new GeminiProvider();
    await provider.initialize(config);

    const streamPayload = [
      formatSSEData({
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: 'search_docs',
                    args: { q: 'flux' },
                  },
                },
              ],
            },
          },
        ],
      }),
      formatSSEData({
        candidates: [
          {
            finishReason: 'STOP',
            content: { parts: [] },
          },
        ],
      }),
    ].join('');

    vi.stubGlobal('fetch', createStreamingFetchMock([streamPayload]));

    const chunks = await collectChunks(provider.chat([{ role: 'user', content: 'Call tool' }]));

    expect(chunks[0].type).toBe('tool_call');
    expect(chunks[0].toolCall?.name).toBe('search_docs');
    expect(chunks[0].toolCall?.arguments).toBe('{"q":"flux"}');
    expect(chunks[0].toolCall?.id).toBeTruthy();
    expect(chunks[chunks.length - 1].type).toBe('done');
  });

  it.each(['SAFETY', 'RECITATION'] as const)(
    'emits error chunk for blocked finishReason %s',
    async (finishReason) => {
      const provider = new GeminiProvider();
      await provider.initialize(config);

      const streamPayload = formatSSEData({
        candidates: [
          {
            finishReason,
            content: { parts: [] },
          },
        ],
      });

      vi.stubGlobal('fetch', createStreamingFetchMock([streamPayload]));

      const chunks = await collectChunks(provider.chat([{ role: 'user', content: 'test' }]));
      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe('error');
      expect(chunks[0].error?.message).toContain('safety');
    },
  );

  it('validateApiKey checks models endpoint', async () => {
    const provider = new GeminiProvider();

    const okMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', okMock);
    await expect(provider.validateApiKey('k1')).resolves.toBe(true);
    expect(okMock).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ 'x-goog-api-key': 'k1' }),
      }),
    );

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(provider.validateApiKey('k2')).resolves.toBe(false);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(provider.validateApiKey('k3')).resolves.toBe(false);
  });
});
