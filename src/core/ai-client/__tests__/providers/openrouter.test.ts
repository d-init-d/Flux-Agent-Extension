import type { AIModelConfig, AIStreamChunk } from '@shared/types';
import { ErrorCode, ExtensionError } from '@shared/errors';
import { OpenRouterProvider } from '../../providers/openrouter';

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

function createErrorFetchMock(status: number, body: string): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    body: null,
    text: vi.fn().mockResolvedValue(body),
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

describe('OpenRouterProvider', () => {
  const config: AIModelConfig = {
    provider: 'openrouter',
    model: 'anthropic/claude-3.5-sonnet',
    apiKey: 'openrouter-key',
  };

  it('sends OpenRouter-specific headers and stream_options.include_usage', async () => {
    const provider = new OpenRouterProvider();
    await provider.initialize(config);

    const streamPayload = [
      formatSSEData({
        id: 'evt-1',
        object: 'chat.completion.chunk',
        created: 1,
        model: config.model,
        choices: [
          {
            index: 0,
            delta: { content: 'Hello from OpenRouter' },
            finish_reason: null,
          },
        ],
      }),
      formatSSEData({
        id: 'evt-2',
        object: 'chat.completion.chunk',
        created: 2,
        model: config.model,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
      }),
    ].join('');

    const fetchMock = createStreamingFetchMock([streamPayload]);
    vi.stubGlobal('fetch', fetchMock);

    const chunks = await collectChunks(provider.chat([{ role: 'user', content: 'hi' }]));

    expect(chunks).toEqual([{ type: 'text', content: 'Hello from OpenRouter' }, { type: 'done' }]);

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = requestInit.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer openrouter-key');
    expect(headers['HTTP-Referer']).toBe('chrome-extension://flux-agent');
    expect(headers['X-Title']).toBe('Flux Agent');

    const requestBody = JSON.parse(String(requestInit.body)) as {
      stream_options: { include_usage: boolean };
    };
    expect(requestBody.stream_options.include_usage).toBe(true);
  });

  it('flushes only the first accumulated tool call when finish_reason is tool_calls', async () => {
    const provider = new OpenRouterProvider();
    await provider.initialize(config);

    const streamPayload = [
      formatSSEData({
        id: 'evt-a',
        object: 'chat.completion.chunk',
        created: 1,
        model: config.model,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_a',
                  function: { name: 'search', arguments: '{"q":"hel' },
                },
                {
                  index: 1,
                  id: 'call_b',
                  function: { name: 'lookup', arguments: '{"id":' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      }),
      formatSSEData({
        id: 'evt-b',
        object: 'chat.completion.chunk',
        created: 2,
        model: config.model,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: 'lo"}' } },
                { index: 1, function: { arguments: '42}' } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }),
      formatSSEData({
        id: 'evt-c',
        object: 'chat.completion.chunk',
        created: 3,
        model: config.model,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
      }),
    ].join('');

    vi.stubGlobal('fetch', createStreamingFetchMock([streamPayload]));

    const chunks = await collectChunks(provider.chat([{ role: 'user', content: 'run tools' }]));

    const toolCalls = chunks.filter((chunk) => chunk.type === 'tool_call');
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toEqual({
      type: 'tool_call',
      toolCall: {
        id: 'call_a',
        name: 'search',
        arguments: '{"q":"hello"}',
      },
    });
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  });

  it('carries lastUsage from usage-only chunk into final done chunk', async () => {
    const provider = new OpenRouterProvider();
    await provider.initialize(config);

    const streamPayload = [
      formatSSEData({
        id: 'evt-usage',
        object: 'chat.completion.chunk',
        created: 1,
        model: config.model,
        choices: [],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 7,
          total_tokens: 12,
        },
      }),
      formatSSEData({
        id: 'evt-stop',
        object: 'chat.completion.chunk',
        created: 2,
        model: config.model,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
      }),
    ].join('');

    vi.stubGlobal('fetch', createStreamingFetchMock([streamPayload]));
    const chunks = await collectChunks(provider.chat([{ role: 'user', content: 'hello' }]));

    expect(chunks).toEqual([
      {
        type: 'done',
        usage: {
          inputTokens: 5,
          outputTokens: 7,
        },
      },
    ]);
  });

  it('validateApiKey calls /api/v1/auth/key and handles status codes', async () => {
    const provider = new OpenRouterProvider();

    const okMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', okMock);
    await expect(provider.validateApiKey('k1')).resolves.toBe(true);
    expect(okMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/auth/key',
      expect.objectContaining({ method: 'GET' }),
    );

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(provider.validateApiKey('k2')).resolves.toBe(false);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(provider.validateApiKey('k3')).resolves.toBe(false);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(provider.validateApiKey('k4')).resolves.toBe(false);
  });

  it('maps HTTP 402 into AI_QUOTA_EXCEEDED', async () => {
    const provider = new OpenRouterProvider();
    await provider.initialize(config);

    vi.stubGlobal('fetch', createErrorFetchMock(402, '{"error":{"message":"Payment required"}}'));

    await expect(
      collectChunks(provider.chat([{ role: 'user', content: 'hello' }])),
    ).rejects.toMatchObject({
      code: ErrorCode.AI_QUOTA_EXCEEDED,
    });
  });
});
