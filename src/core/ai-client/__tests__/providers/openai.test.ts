import type { AIMessage, AIModelConfig, AIStreamChunk, AITool } from '@shared/types';
import { OpenAIProvider } from '../../providers/openai';

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

describe('OpenAIProvider', () => {
  const config: AIModelConfig = {
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: 'openai-key',
  };

  it('sends Authorization header, includes stream usage option, and formats multimodal content', async () => {
    const provider = new OpenAIProvider();
    await provider.initialize(config);

    const streamPayload = [
      formatSSEData({
        choices: [
          {
            index: 0,
            delta: { content: 'Hello from OpenAI' },
            finish_reason: null,
          },
        ],
      }),
      formatSSEData({
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 4,
        },
      }),
    ].join('');

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
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is this?' },
          {
            type: 'image',
            image_url: { url: 'data:image/png;base64,AAA', detail: 'high' },
          },
        ],
      },
    ];

    const chunks = await collectChunks(provider.chat(messages, { tools }));

    expect(chunks).toEqual([
      { type: 'text', content: 'Hello from OpenAI' },
      {
        type: 'done',
        usage: {
          inputTokens: 10,
          outputTokens: 4,
        },
      },
    ]);

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = requestInit.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer openai-key');

    const requestBody = JSON.parse(String(requestInit.body)) as {
      stream_options: { include_usage: boolean };
      tools: unknown[];
      messages: Array<{ content: unknown }>;
    };

    expect(requestBody.stream_options.include_usage).toBe(true);
    expect(requestBody.tools).toHaveLength(1);

    const contentParts = requestBody.messages[0].content as Array<Record<string, unknown>>;
    expect(contentParts[0]).toEqual({ type: 'text', text: 'What is this?' });
    expect(contentParts[1]).toEqual({
      type: 'image_url',
      image_url: {
        url: 'data:image/png;base64,AAA',
        detail: 'high',
      },
    });
  });

  it('accumulates tool-call deltas by index and drains pending tool-call chunks', async () => {
    const provider = new OpenAIProvider();
    await provider.initialize(config);

    const streamPayload = [
      formatSSEData({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  function: {
                    name: 'search',
                    arguments: '{"q":"hel',
                  },
                },
                {
                  index: 1,
                  id: 'call_2',
                  function: {
                    name: 'lookup',
                    arguments: '{"id":',
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      }),
      formatSSEData({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: {
                    arguments: 'lo"}',
                  },
                },
                {
                  index: 1,
                  function: {
                    arguments: '42}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }),
      formatSSEData({
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: null,
          },
        ],
      }),
      formatSSEData({
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 20,
          completion_tokens: 2,
        },
      }),
    ].join('');

    vi.stubGlobal('fetch', createStreamingFetchMock([streamPayload]));

    const chunks = await collectChunks(provider.chat([{ role: 'user', content: 'do tools' }]));

    expect(chunks).toEqual([
      {
        type: 'tool_call',
        toolCall: {
          id: 'call_1',
          name: 'search',
          arguments: '{"q":"hello"}',
        },
      },
      {
        type: 'tool_call',
        toolCall: {
          id: 'call_2',
          name: 'lookup',
          arguments: '{"id":42}',
        },
      },
      {
        type: 'done',
        usage: {
          inputTokens: 20,
          outputTokens: 2,
        },
      },
    ]);
  });

  it('validateApiKey calls GET /v1/models and handles statuses', async () => {
    const provider = new OpenAIProvider();

    const okMock = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal('fetch', okMock);
    await expect(provider.validateApiKey('k1')).resolves.toBe(true);
    expect(okMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({ method: 'GET' }),
    );

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 401 }));
    await expect(provider.validateApiKey('k2')).resolves.toBe(false);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(provider.validateApiKey('k3')).resolves.toBe(false);
  });

  it('handles HTTP error responses with JSON error body', async () => {
    const provider = new OpenAIProvider();
    await provider.initialize(config);

    const errorBody = JSON.stringify({ error: { message: 'Rate limited', type: 'rate_limit' } });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers({}),
        text: vi.fn().mockResolvedValue(errorBody),
      }),
    );

    const stream = provider.chat([{ role: 'user', content: 'hello' }], { maxRetries: 0 });
    await expect(collectChunks(stream)).rejects.toThrow('Rate limited');
  });

  it('handles HTTP 401 error', async () => {
    const provider = new OpenAIProvider();
    await provider.initialize(config);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({}),
        text: vi.fn().mockResolvedValue(JSON.stringify({ error: { message: 'Invalid key' } })),
      }),
    );

    const stream = provider.chat([{ role: 'user', content: 'hello' }], { maxRetries: 0 });
    await expect(collectChunks(stream)).rejects.toThrow('Invalid key');
  });

  it('handles HTTP 404 error', async () => {
    const provider = new OpenAIProvider();
    await provider.initialize(config);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers({}),
        text: vi.fn().mockResolvedValue(JSON.stringify({ error: { message: 'Model not found' } })),
      }),
    );

    const stream = provider.chat([{ role: 'user', content: 'hello' }], { maxRetries: 0 });
    await expect(collectChunks(stream)).rejects.toThrow('Model not found');
  });

  it('handles HTTP 500 error with raw body fallback', async () => {
    const provider = new OpenAIProvider();
    await provider.initialize(config);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers({}),
        text: vi.fn().mockResolvedValue('Internal server error'),
      }),
    );

    const stream = provider.chat([{ role: 'user', content: 'hello' }], { maxRetries: 0 });
    await expect(collectChunks(stream)).rejects.toThrow(/Internal server error/);
  });

  it('handles HTTP error with empty body', async () => {
    const provider = new OpenAIProvider();
    await provider.initialize(config);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        headers: new Headers({}),
        text: vi.fn().mockResolvedValue(''),
      }),
    );

    const stream = provider.chat([{ role: 'user', content: 'hello' }], { maxRetries: 0 });
    await expect(collectChunks(stream)).rejects.toThrow(/OpenAI API error/);
  });

  it('formats string message content directly', async () => {
    const provider = new OpenAIProvider();
    await provider.initialize(config);

    const streamPayload = [
      formatSSEData({
        choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: null }],
      }),
      formatSSEData({
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      }),
    ].join('');

    vi.stubGlobal('fetch', createStreamingFetchMock([streamPayload]));

    const messages: AIMessage[] = [
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'hello' },
    ];

    const chunks = await collectChunks(provider.chat(messages));
    expect(chunks[0]).toEqual({ type: 'text', content: 'OK' });

    const requestBody = JSON.parse(
      String((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body),
    ) as { messages: Array<{ content: unknown }> };
    expect(typeof requestBody.messages[0].content).toBe('string');
    expect(typeof requestBody.messages[1].content).toBe('string');
  });

  it('simplifies single text content part to string', async () => {
    const provider = new OpenAIProvider();
    await provider.initialize(config);

    const streamPayload = formatSSEData({
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    });

    vi.stubGlobal('fetch', createStreamingFetchMock([streamPayload]));

    const messages: AIMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'Just text' }] },
    ];

    await collectChunks(provider.chat(messages));

    const requestBody = JSON.parse(
      String((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body),
    ) as { messages: Array<{ content: unknown }> };
    expect(typeof requestBody.messages[0].content).toBe('string');
    expect(requestBody.messages[0].content).toBe('Just text');
  });

  it('handles image content without explicit detail level', async () => {
    const provider = new OpenAIProvider();
    await provider.initialize(config);

    const streamPayload = formatSSEData({
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    });

    vi.stubGlobal('fetch', createStreamingFetchMock([streamPayload]));

    const messages: AIMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe' },
          { type: 'image', image_url: { url: 'data:image/png;base64,AAA' } },
        ],
      },
    ];

    await collectChunks(provider.chat(messages));

    const requestBody = JSON.parse(
      String((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body),
    ) as { messages: Array<{ content: Array<Record<string, unknown>> }> };
    const imgPart = requestBody.messages[0].content[1] as { image_url: { detail: string } };
    expect(imgPart.image_url.detail).toBe('low');
  });

  it('handles stream chunk with no choices', async () => {
    const provider = new OpenAIProvider();
    await provider.initialize(config);

    const streamPayload = [
      formatSSEData({ usage: { prompt_tokens: 5, completion_tokens: 2 } }),
      formatSSEData({
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      }),
    ].join('');

    vi.stubGlobal('fetch', createStreamingFetchMock([streamPayload]));

    const chunks = await collectChunks(provider.chat([{ role: 'user', content: 'hi' }]));
    expect(chunks).toEqual([{ type: 'done', usage: { inputTokens: 5, outputTokens: 2 } }]);
  });

  it('handles done chunk without usage', async () => {
    const provider = new OpenAIProvider();
    await provider.initialize(config);

    const streamPayload = formatSSEData({
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    });

    vi.stubGlobal('fetch', createStreamingFetchMock([streamPayload]));

    const chunks = await collectChunks(provider.chat([{ role: 'user', content: 'hi' }]));
    expect(chunks).toEqual([{ type: 'done' }]);
  });

  it('uses custom base URL from config', async () => {
    const provider = new OpenAIProvider();
    await provider.initialize({ ...config, baseUrl: 'https://custom.api.com' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 }));
    await provider.validateApiKey('key');

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'https://custom.api.com/v1/models',
      expect.anything(),
    );
  });

  it('handles malformed JSON in stream', async () => {
    const provider = new OpenAIProvider();
    await provider.initialize(config);

    const streamPayload = [
      'data: {invalid json}\n\n',
      formatSSEData({
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      }),
    ].join('');

    vi.stubGlobal('fetch', createStreamingFetchMock([streamPayload]));

    const chunks = await collectChunks(provider.chat([{ role: 'user', content: 'hi' }]));
    expect(chunks).toEqual([{ type: 'done' }]);
  });

  it('applies maxTokens and temperature from config', async () => {
    const provider = new OpenAIProvider();
    await provider.initialize({ ...config, maxTokens: 2048, temperature: 0.5 });

    const streamPayload = formatSSEData({
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    });

    vi.stubGlobal('fetch', createStreamingFetchMock([streamPayload]));

    await collectChunks(provider.chat([{ role: 'user', content: 'hi' }]));

    const requestBody = JSON.parse(
      String((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body),
    ) as { max_tokens: number; temperature: number };
    expect(requestBody.max_tokens).toBe(2048);
    expect(requestBody.temperature).toBe(0.5);
  });

  it('omits tools from request body when not provided', async () => {
    const provider = new OpenAIProvider();
    await provider.initialize(config);

    const streamPayload = formatSSEData({
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    });

    vi.stubGlobal('fetch', createStreamingFetchMock([streamPayload]));

    await collectChunks(provider.chat([{ role: 'user', content: 'hi' }]));

    const requestBody = JSON.parse(
      String((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body),
    ) as Record<string, unknown>;
    expect(requestBody.tools).toBeUndefined();
  });
});
