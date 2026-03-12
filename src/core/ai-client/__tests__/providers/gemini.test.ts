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

  it('handles stream chunk with no data', async () => {
    const provider = new GeminiProvider();
    await provider.initialize(config);

    const ssePayload = [
      'data: \n\n',
      formatSSEData({
        candidates: [{ finishReason: 'STOP', content: { parts: [] } }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      }),
    ].join('');

    vi.stubGlobal('fetch', createStreamingFetchMock([ssePayload]));
    const chunks = await collectChunks(provider.chat([{ role: 'user', content: 'hi' }]));
    expect(chunks).toEqual([{ type: 'done', usage: { inputTokens: 1, outputTokens: 1 } }]);
  });

  it('handles malformed JSON in stream', async () => {
    const provider = new GeminiProvider();
    await provider.initialize(config);

    const ssePayload = [
      'data: {invalid}\n\n',
      formatSSEData({
        candidates: [{ finishReason: 'STOP', content: { parts: [] } }],
      }),
    ].join('');

    vi.stubGlobal('fetch', createStreamingFetchMock([ssePayload]));
    const chunks = await collectChunks(provider.chat([{ role: 'user', content: 'hi' }]));
    expect(chunks).toEqual([{ type: 'done', usage: { inputTokens: 0, outputTokens: 0 } }]);
  });

  it('handles API error inside stream payload', async () => {
    const provider = new GeminiProvider();
    await provider.initialize(config);

    const ssePayload = formatSSEData({
      error: { code: 400, message: 'Bad request', status: 'INVALID_ARGUMENT' },
    });

    vi.stubGlobal('fetch', createStreamingFetchMock([ssePayload]));
    const chunks = await collectChunks(provider.chat([{ role: 'user', content: 'hi' }]));
    expect(chunks[0].type).toBe('error');
    expect(chunks[0].error?.message).toContain('Bad request');
  });

  it('handles stream with no candidates', async () => {
    const provider = new GeminiProvider();
    await provider.initialize(config);

    const ssePayload = [
      formatSSEData({ usageMetadata: { promptTokenCount: 5 } }),
      formatSSEData({
        candidates: [{ finishReason: 'STOP', content: { parts: [] } }],
      }),
    ].join('');

    vi.stubGlobal('fetch', createStreamingFetchMock([ssePayload]));
    const chunks = await collectChunks(provider.chat([{ role: 'user', content: 'hi' }]));
    expect(chunks).toEqual([{ type: 'done', usage: { inputTokens: 0, outputTokens: 0 } }]);
  });

  it('handles text content with empty text', async () => {
    const provider = new GeminiProvider();
    await provider.initialize(config);

    const ssePayload = [
      formatSSEData({
        candidates: [{ content: { parts: [{ text: '' }] } }],
      }),
      formatSSEData({
        candidates: [{ finishReason: 'STOP', content: { parts: [] } }],
      }),
    ].join('');

    vi.stubGlobal('fetch', createStreamingFetchMock([ssePayload]));
    const chunks = await collectChunks(provider.chat([{ role: 'user', content: 'hi' }]));
    expect(chunks).toEqual([{ type: 'done', usage: { inputTokens: 0, outputTokens: 0 } }]);
  });

  it('maps HTTP 400 with API_KEY_INVALID to invalid key error', async () => {
    const provider = new GeminiProvider();
    await provider.initialize(config);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 400, headers: new Headers({}),
      text: vi.fn().mockResolvedValue(JSON.stringify({
        error: { message: 'API key not valid', status: 'API_KEY_INVALID' },
      })),
    }));

    await expect(
      collectChunks(provider.chat([{ role: 'user', content: 'hi' }], { maxRetries: 0 })),
    ).rejects.toThrow(/Invalid Gemini API key/);
  });

  it('maps HTTP 403 to access denied error', async () => {
    const provider = new GeminiProvider();
    await provider.initialize(config);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 403, headers: new Headers({}),
      text: vi.fn().mockResolvedValue(JSON.stringify({ error: { message: 'Forbidden' } })),
    }));

    await expect(
      collectChunks(provider.chat([{ role: 'user', content: 'hi' }], { maxRetries: 0 })),
    ).rejects.toThrow(/access denied/i);
  });

  it('maps HTTP 404 to model not found error', async () => {
    const provider = new GeminiProvider();
    await provider.initialize(config);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 404, headers: new Headers({}),
      text: vi.fn().mockResolvedValue(JSON.stringify({ error: { message: 'Model not found' } })),
    }));

    await expect(
      collectChunks(provider.chat([{ role: 'user', content: 'hi' }], { maxRetries: 0 })),
    ).rejects.toThrow(/model not found/i);
  });

  it('maps HTTP 429 to rate limit error', async () => {
    const provider = new GeminiProvider();
    await provider.initialize(config);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 429, headers: new Headers({}),
      text: vi.fn().mockResolvedValue(JSON.stringify({ error: { message: 'Too many requests' } })),
    }));

    await expect(
      collectChunks(provider.chat([{ role: 'user', content: 'hi' }], { maxRetries: 0 })),
    ).rejects.toThrow(/rate limit/i);
  });

  it('maps HTTP 500 with non-JSON body', async () => {
    const provider = new GeminiProvider();
    await provider.initialize(config);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 500, headers: new Headers({}),
      text: vi.fn().mockResolvedValue('Internal error'),
    }));

    await expect(
      collectChunks(provider.chat([{ role: 'user', content: 'hi' }], { maxRetries: 0 })),
    ).rejects.toThrow(/Internal error/);
  });

  it('maps HTTP error with empty body', async () => {
    const provider = new GeminiProvider();
    await provider.initialize(config);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 503, headers: new Headers({}),
      text: vi.fn().mockResolvedValue(''),
    }));

    await expect(
      collectChunks(provider.chat([{ role: 'user', content: 'hi' }], { maxRetries: 0 })),
    ).rejects.toThrow(/Gemini API error/);
  });

  it('skips non-data-url images with warning', async () => {
    const provider = new GeminiProvider();
    await provider.initialize(config);

    vi.stubGlobal('fetch', createStreamingFetchMock([
      formatSSEData({ candidates: [{ finishReason: 'STOP', content: { parts: [] } }] }),
    ]));

    const messages: AIMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Look' },
          { type: 'image', image_url: { url: 'https://example.com/img.png' } },
        ],
      },
    ];
    await collectChunks(provider.chat(messages));

    const requestBody = JSON.parse(
      String((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body),
    ) as { contents: Array<{ parts: Array<Record<string, unknown>> }> };
    expect(requestBody.contents[0].parts).toHaveLength(1);
    expect(requestBody.contents[0].parts[0]).toEqual({ text: 'Look' });
  });

  it('builds request without temperature and maxTokens', async () => {
    const provider = new GeminiProvider();
    await provider.initialize({ ...config, temperature: undefined, maxTokens: undefined });

    vi.stubGlobal('fetch', createStreamingFetchMock([
      formatSSEData({ candidates: [{ finishReason: 'STOP', content: { parts: [] } }] }),
    ]));

    await collectChunks(provider.chat([{ role: 'user', content: 'hi' }]));

    const requestBody = JSON.parse(
      String((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body),
    ) as { generationConfig: Record<string, unknown> };
    expect(requestBody.generationConfig.temperature).toBeUndefined();
    expect(requestBody.generationConfig.maxOutputTokens).toBeUndefined();
  });

  it('builds request without system instruction when no system messages', async () => {
    const provider = new GeminiProvider();
    await provider.initialize(config);

    vi.stubGlobal('fetch', createStreamingFetchMock([
      formatSSEData({ candidates: [{ finishReason: 'STOP', content: { parts: [] } }] }),
    ]));

    await collectChunks(provider.chat([{ role: 'user', content: 'hi' }]));

    const requestBody = JSON.parse(
      String((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body),
    ) as Record<string, unknown>;
    expect(requestBody.systemInstruction).toBeUndefined();
  });

  it('handles system content as array', async () => {
    const provider = new GeminiProvider();
    await provider.initialize(config);

    vi.stubGlobal('fetch', createStreamingFetchMock([
      formatSSEData({ candidates: [{ finishReason: 'STOP', content: { parts: [] } }] }),
    ]));

    await collectChunks(provider.chat([
      { role: 'system', content: [{ type: 'text', text: 'System' }] as any },
      { role: 'user', content: 'hi' },
    ]));

    const requestBody = JSON.parse(
      String((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body),
    ) as { systemInstruction: { parts: Array<{ text: string }> } };
    expect(requestBody.systemInstruction.parts[0].text).toBe('System');
  });

  it('handles STOP with missing usageMetadata', async () => {
    const provider = new GeminiProvider();
    await provider.initialize(config);

    const ssePayload = formatSSEData({
      candidates: [{ finishReason: 'STOP', content: { parts: [] } }],
    });

    vi.stubGlobal('fetch', createStreamingFetchMock([ssePayload]));
    const chunks = await collectChunks(provider.chat([{ role: 'user', content: 'hi' }]));
    expect(chunks).toEqual([{ type: 'done', usage: { inputTokens: 0, outputTokens: 0 } }]);
  });
});
