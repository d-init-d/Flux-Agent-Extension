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
});
