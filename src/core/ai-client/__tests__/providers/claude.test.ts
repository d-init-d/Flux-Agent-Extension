import type { AIMessage, AIModelConfig, AIStreamChunk } from '@shared/types';
import { ClaudeProvider } from '../../providers/claude';

function formatSSEEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
}

function createStreamingFetchMock(chunks: string[], status: number = 200): typeof fetch {
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
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    body: status >= 200 && status < 300 ? mockBody : null,
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

describe('ClaudeProvider', () => {
  const config: AIModelConfig = {
    provider: 'claude',
    model: 'claude-4-sonnet-20250514',
    apiKey: 'claude-key',
    systemPrompt: 'Config-level system prompt',
  };

  it('builds request with top-level system field, anthropic headers, and vision conversion', async () => {
    const provider = new ClaudeProvider();
    await provider.initialize(config);

    const fetchMock = createStreamingFetchMock([formatSSEEvent('message_stop', {})]);
    vi.stubGlobal('fetch', fetchMock);

    const messages: AIMessage[] = [
      { role: 'system', content: 'Runtime system prompt' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image' },
          { type: 'image', image_url: { url: 'data:image/png;base64,AAA' } },
        ],
      },
    ];

    await collectChunks(provider.chat(messages));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;

    const headers = requestInit.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('claude-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');

    const requestBody = JSON.parse(String(requestInit.body)) as {
      system: string;
      messages: Array<{ role: string; content: unknown }>;
    };

    expect(requestBody.system).toContain('Config-level system prompt');
    expect(requestBody.system).toContain('Runtime system prompt');
    expect(requestBody.messages).toHaveLength(1);
    expect(requestBody.messages[0].role).toBe('user');

    const userContent = requestBody.messages[0].content as Array<Record<string, unknown>>;
    expect(userContent[0]).toEqual({ type: 'text', text: 'Describe this image' });
    expect(userContent[1]).toEqual({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: 'AAA',
      },
    });
  });

  it('accumulates tool call fragments and reports usage from message_start/message_delta', async () => {
    const provider = new ClaudeProvider();
    await provider.initialize(config);

    const ssePayload = [
      formatSSEEvent('message_start', {
        message: { usage: { input_tokens: 12 } },
      }),
      formatSSEEvent('content_block_start', {
        content_block: { type: 'tool_use', id: 'tool_1', name: 'search' },
      }),
      formatSSEEvent('content_block_delta', {
        delta: { type: 'input_json_delta', partial_json: '{"query":"hel' },
      }),
      formatSSEEvent('content_block_delta', {
        delta: { type: 'input_json_delta', partial_json: 'lo"}' },
      }),
      formatSSEEvent('content_block_stop', {}),
      formatSSEEvent('message_delta', {
        usage: { output_tokens: 5 },
      }),
      formatSSEEvent('message_stop', {}),
    ].join('');

    vi.stubGlobal('fetch', createStreamingFetchMock([ssePayload]));

    const chunks = await collectChunks(provider.chat([{ role: 'user', content: 'Find docs' }]));

    expect(chunks).toEqual([
      {
        type: 'tool_call',
        toolCall: {
          id: 'tool_1',
          name: 'search',
          arguments: '{"query":"hello"}',
        },
      },
      {
        type: 'done',
        usage: {
          inputTokens: 12,
          outputTokens: 5,
        },
      },
    ]);
  });

  it('validateApiKey returns false only for 401/403, true otherwise', async () => {
    const provider = new ClaudeProvider();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    await expect(provider.validateApiKey('key')).resolves.toBe(true);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(provider.validateApiKey('key')).resolves.toBe(false);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await expect(provider.validateApiKey('key')).resolves.toBe(false);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    await expect(provider.validateApiKey('key')).resolves.toBe(true);
  });

  it('validateApiKey returns true when response is ok', async () => {
    const provider = new ClaudeProvider();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    await expect(provider.validateApiKey('key')).resolves.toBe(true);
  });

  it('handles ping and empty SSE events', async () => {
    const provider = new ClaudeProvider();
    await provider.initialize(config);

    const ssePayload = [
      'event: ping\ndata: {}\n\n',
      formatSSEEvent('message_stop', {}),
    ].join('');

    vi.stubGlobal('fetch', createStreamingFetchMock([ssePayload]));
    const chunks = await collectChunks(provider.chat([{ role: 'user', content: 'hi' }]));
    expect(chunks).toEqual([{ type: 'done', usage: { inputTokens: 0, outputTokens: 0 } }]);
  });

  it('handles [DONE] sentinel — base parser terminates the stream', async () => {
    const provider = new ClaudeProvider();
    await provider.initialize(config);

    const ssePayload = [
      formatSSEEvent('content_block_delta', { delta: { type: 'text_delta', text: 'Hi' } }),
      'data: [DONE]\n\n',
    ].join('');
    vi.stubGlobal('fetch', createStreamingFetchMock([ssePayload]));
    const chunks = await collectChunks(provider.chat([{ role: 'user', content: 'hi' }]));
    expect(chunks[0]).toEqual({ type: 'text', content: 'Hi' });
  });

  it('handles malformed JSON in SSE data', async () => {
    const provider = new ClaudeProvider();
    await provider.initialize(config);

    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const ssePayload = [
      'event: content_block_delta\ndata: not-json\n\n',
      formatSSEEvent('message_stop', {}),
    ].join('');

    vi.stubGlobal('fetch', createStreamingFetchMock([ssePayload]));
    const chunks = await collectChunks(provider.chat([{ role: 'user', content: 'hi' }]));
    expect(chunks).toEqual([{ type: 'done', usage: { inputTokens: 0, outputTokens: 0 } }]);
  });

  it('handles error SSE event with message', async () => {
    const provider = new ClaudeProvider();
    await provider.initialize(config);

    const ssePayload = formatSSEEvent('error', { error: { message: 'overloaded' } });
    vi.stubGlobal('fetch', createStreamingFetchMock([ssePayload]));

    const chunks = await collectChunks(provider.chat([{ role: 'user', content: 'hi' }]));
    expect(chunks[0].type).toBe('error');
    expect(chunks[0].error?.message).toBe('overloaded');
  });

  it('handles error SSE event without message', async () => {
    const provider = new ClaudeProvider();
    await provider.initialize(config);

    const ssePayload = formatSSEEvent('error', { error: {} });
    vi.stubGlobal('fetch', createStreamingFetchMock([ssePayload]));

    const chunks = await collectChunks(provider.chat([{ role: 'user', content: 'hi' }]));
    expect(chunks[0].type).toBe('error');
    expect(chunks[0].error?.message).toBe('Unknown streaming error');
  });

  it('ignores unknown SSE event types', async () => {
    const provider = new ClaudeProvider();
    await provider.initialize(config);

    const ssePayload = [
      'event: unknown_event\ndata: {}\n\n',
      formatSSEEvent('message_stop', {}),
    ].join('');

    vi.stubGlobal('fetch', createStreamingFetchMock([ssePayload]));
    const chunks = await collectChunks(provider.chat([{ role: 'user', content: 'hi' }]));
    expect(chunks).toEqual([{ type: 'done', usage: { inputTokens: 0, outputTokens: 0 } }]);
  });

  it('handles content_block_start without content_block', async () => {
    const provider = new ClaudeProvider();
    await provider.initialize(config);

    const ssePayload = [
      formatSSEEvent('content_block_start', {}),
      formatSSEEvent('message_stop', {}),
    ].join('');

    vi.stubGlobal('fetch', createStreamingFetchMock([ssePayload]));
    const chunks = await collectChunks(provider.chat([{ role: 'user', content: 'hi' }]));
    expect(chunks).toEqual([{ type: 'done', usage: { inputTokens: 0, outputTokens: 0 } }]);
  });

  it('handles content_block_delta without delta', async () => {
    const provider = new ClaudeProvider();
    await provider.initialize(config);

    const ssePayload = [
      formatSSEEvent('content_block_delta', {}),
      formatSSEEvent('message_stop', {}),
    ].join('');

    vi.stubGlobal('fetch', createStreamingFetchMock([ssePayload]));
    const chunks = await collectChunks(provider.chat([{ role: 'user', content: 'hi' }]));
    expect(chunks).toEqual([{ type: 'done', usage: { inputTokens: 0, outputTokens: 0 } }]);
  });

  it('handles text_delta in content_block_delta', async () => {
    const provider = new ClaudeProvider();
    await provider.initialize(config);

    const ssePayload = [
      formatSSEEvent('content_block_delta', { delta: { type: 'text_delta', text: 'Hello' } }),
      formatSSEEvent('message_stop', {}),
    ].join('');

    vi.stubGlobal('fetch', createStreamingFetchMock([ssePayload]));
    const chunks = await collectChunks(provider.chat([{ role: 'user', content: 'hi' }]));
    expect(chunks[0]).toEqual({ type: 'text', content: 'Hello' });
  });

  it('handles content_block_stop without active tool call', async () => {
    const provider = new ClaudeProvider();
    await provider.initialize(config);

    const ssePayload = [
      formatSSEEvent('content_block_stop', {}),
      formatSSEEvent('message_stop', {}),
    ].join('');

    vi.stubGlobal('fetch', createStreamingFetchMock([ssePayload]));
    const chunks = await collectChunks(provider.chat([{ role: 'user', content: 'hi' }]));
    expect(chunks).toEqual([{ type: 'done', usage: { inputTokens: 0, outputTokens: 0 } }]);
  });

  it('handles message_start without usage', async () => {
    const provider = new ClaudeProvider();
    await provider.initialize(config);

    const ssePayload = [
      formatSSEEvent('message_start', { message: {} }),
      formatSSEEvent('message_stop', {}),
    ].join('');

    vi.stubGlobal('fetch', createStreamingFetchMock([ssePayload]));
    const chunks = await collectChunks(provider.chat([{ role: 'user', content: 'hi' }]));
    expect(chunks).toEqual([{ type: 'done', usage: { inputTokens: 0, outputTokens: 0 } }]);
  });

  it('handles message_start without message field', async () => {
    const provider = new ClaudeProvider();
    await provider.initialize(config);

    const ssePayload = [
      formatSSEEvent('message_start', {}),
      formatSSEEvent('message_stop', {}),
    ].join('');

    vi.stubGlobal('fetch', createStreamingFetchMock([ssePayload]));
    const chunks = await collectChunks(provider.chat([{ role: 'user', content: 'hi' }]));
    expect(chunks).toEqual([{ type: 'done', usage: { inputTokens: 0, outputTokens: 0 } }]);
  });

  it('handles message_delta without usage', async () => {
    const provider = new ClaudeProvider();
    await provider.initialize(config);

    const ssePayload = [
      formatSSEEvent('message_delta', {}),
      formatSSEEvent('message_stop', {}),
    ].join('');

    vi.stubGlobal('fetch', createStreamingFetchMock([ssePayload]));
    const chunks = await collectChunks(provider.chat([{ role: 'user', content: 'hi' }]));
    expect(chunks).toEqual([{ type: 'done', usage: { inputTokens: 0, outputTokens: 0 } }]);
  });

  it('maps HTTP 429 to rate limit error', async () => {
    const provider = new ClaudeProvider();
    await provider.initialize(config);
    const body = JSON.stringify({ error: { message: 'Rate limited' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 429, headers: new Headers({}),
      text: vi.fn().mockResolvedValue(body),
    }));
    await expect(
      collectChunks(provider.chat([{ role: 'user', content: 'hi' }], { maxRetries: 0 })),
    ).rejects.toThrow('Rate limited');
  });

  it('maps HTTP 401 to invalid key error', async () => {
    const provider = new ClaudeProvider();
    await provider.initialize(config);
    const body = JSON.stringify({ error: { message: 'Invalid API key' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 401, headers: new Headers({}),
      text: vi.fn().mockResolvedValue(body),
    }));
    await expect(
      collectChunks(provider.chat([{ role: 'user', content: 'hi' }], { maxRetries: 0 })),
    ).rejects.toThrow('Invalid API key');
  });

  it('maps HTTP 404 to model not found error', async () => {
    const provider = new ClaudeProvider();
    await provider.initialize(config);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 404, headers: new Headers({}),
      text: vi.fn().mockResolvedValue(JSON.stringify({ error: { message: 'Not found' } })),
    }));
    await expect(
      collectChunks(provider.chat([{ role: 'user', content: 'hi' }], { maxRetries: 0 })),
    ).rejects.toThrow('Not found');
  });

  it('maps HTTP 400 to API error', async () => {
    const provider = new ClaudeProvider();
    await provider.initialize(config);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 400, headers: new Headers({}),
      text: vi.fn().mockResolvedValue(JSON.stringify({ error: { message: 'Bad request' } })),
    }));
    await expect(
      collectChunks(provider.chat([{ role: 'user', content: 'hi' }], { maxRetries: 0 })),
    ).rejects.toThrow('Bad request');
  });

  it('maps HTTP 500 with non-JSON body', async () => {
    const provider = new ClaudeProvider();
    await provider.initialize(config);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 500, headers: new Headers({}),
      text: vi.fn().mockResolvedValue('Server error'),
    }));
    await expect(
      collectChunks(provider.chat([{ role: 'user', content: 'hi' }], { maxRetries: 0 })),
    ).rejects.toThrow(/Server error/);
  });

  it('maps HTTP error with empty body', async () => {
    const provider = new ClaudeProvider();
    await provider.initialize(config);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 502, headers: new Headers({}),
      text: vi.fn().mockResolvedValue(''),
    }));
    await expect(
      collectChunks(provider.chat([{ role: 'user', content: 'hi' }], { maxRetries: 0 })),
    ).rejects.toThrow(/Claude API error/);
  });

  it('converts HTTPS image URL to url source format', async () => {
    const provider = new ClaudeProvider();
    await provider.initialize({ ...config, systemPrompt: undefined });

    vi.stubGlobal('fetch', createStreamingFetchMock([formatSSEEvent('message_stop', {})]));

    const messages: AIMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Look' },
          { type: 'image', image_url: { url: 'https://example.com/photo.png' } },
        ],
      },
    ];
    await collectChunks(provider.chat(messages));

    const requestBody = JSON.parse(
      String((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body),
    ) as { messages: Array<{ content: Array<Record<string, unknown>> }> };
    expect(requestBody.messages[0].content[1]).toEqual({
      type: 'image',
      source: { type: 'url', url: 'https://example.com/photo.png' },
    });
  });

  it('skips unsupported image URL format', async () => {
    const provider = new ClaudeProvider();
    await provider.initialize({ ...config, systemPrompt: undefined });

    vi.stubGlobal('fetch', createStreamingFetchMock([formatSSEEvent('message_stop', {})]));

    const messages: AIMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Look' },
          { type: 'image', image_url: { url: 'blob:http://local/1234' } },
        ],
      },
    ];
    await collectChunks(provider.chat(messages));

    const requestBody = JSON.parse(
      String((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body),
    ) as { messages: Array<{ content: unknown }> };
    expect(typeof requestBody.messages[0].content).toBe('string');
  });

  it('simplifies single text block to string', async () => {
    const provider = new ClaudeProvider();
    await provider.initialize({ ...config, systemPrompt: undefined });

    vi.stubGlobal('fetch', createStreamingFetchMock([formatSSEEvent('message_stop', {})]));

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

  it('builds request without system prompt or temperature', async () => {
    const provider = new ClaudeProvider();
    await provider.initialize({ ...config, systemPrompt: undefined, temperature: undefined });

    vi.stubGlobal('fetch', createStreamingFetchMock([formatSSEEvent('message_stop', {})]));

    await collectChunks(provider.chat([{ role: 'user', content: 'hi' }]));

    const requestBody = JSON.parse(
      String((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body),
    ) as Record<string, unknown>;
    expect(requestBody.system).toBeUndefined();
    expect(requestBody.temperature).toBeUndefined();
  });

  it('extracts system text from content array', async () => {
    const provider = new ClaudeProvider();
    await provider.initialize({ ...config, systemPrompt: undefined });

    vi.stubGlobal('fetch', createStreamingFetchMock([formatSSEEvent('message_stop', {})]));

    const messages: AIMessage[] = [
      { role: 'system', content: [{ type: 'text', text: 'System from array' }] as any },
      { role: 'user', content: 'hi' },
    ];
    await collectChunks(provider.chat(messages));

    const requestBody = JSON.parse(
      String((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body),
    ) as { system: string };
    expect(requestBody.system).toBe('System from array');
  });

  it('includes tools in request when provided', async () => {
    const provider = new ClaudeProvider();
    await provider.initialize(config);

    vi.stubGlobal('fetch', createStreamingFetchMock([formatSSEEvent('message_stop', {})]));

    await collectChunks(provider.chat([{ role: 'user', content: 'hi' }], {
      tools: [{
        type: 'function',
        function: { name: 'search', description: 'Search', parameters: {} },
      }],
    }));

    const requestBody = JSON.parse(
      String((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body),
    ) as { tools: Array<{ name: string }> };
    expect(requestBody.tools).toHaveLength(1);
    expect(requestBody.tools[0].name).toBe('search');
  });
});
