import type { AIMessage, AIModelConfig, AIStreamChunk } from '@shared/types';
import { ExtensionError, ErrorCode } from '@shared/errors';

import { CodexProvider } from '../../providers/codex';

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

describe('CodexProvider', () => {
  const config: AIModelConfig = {
    provider: 'codex',
    model: 'codex-mini-latest',
    apiKey: 'header.payload.signature',
  };

  it('targets the official ChatGPT Codex responses endpoint', async () => {
    const provider = new CodexProvider();
    await provider.initialize(config);

    const fetchMock = createStreamingFetchMock([
      [
        formatSSEData({ type: 'response.output_text.delta', delta: 'hello' }),
        formatSSEData({
          type: 'response.completed',
          response: {
            id: 'resp_1',
            usage: {
              input_tokens: 12,
              output_tokens: 4,
            },
          },
        }),
      ].join(''),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const messages: AIMessage[] = [
      { role: 'system', content: 'You are Codex.' },
      { role: 'user', content: 'Say hello.' },
    ];

    const chunks = await collectChunks(provider.chat(messages));
    expect(chunks).toEqual([
      { type: 'text', content: 'hello' },
      { type: 'done', usage: { inputTokens: 12, outputTokens: 4 } },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://chatgpt.com/backend-api/codex/responses');

    const headers = requestInit.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer header.payload.signature');

    const body = JSON.parse(String(requestInit.body)) as {
      model: string;
      stream: boolean;
      input: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe('codex-mini-latest');
    expect(body.stream).toBe(true);
    expect(body.input).toEqual([
      { role: 'system', content: 'You are Codex.' },
      { role: 'user', content: 'Say hello.' },
    ]);
  });

  it('maps stream failures to clear account-backed auth errors', async () => {
    const provider = new CodexProvider();
    await provider.initialize(config);

    const fetchMock = createStreamingFetchMock([
      formatSSEData({
        type: 'response.failed',
        response: {
          error: {
            code: 'invalid_session',
            message: 'Session expired.',
          },
        },
      }),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    await expect(collectChunks(provider.chat([{ role: 'user', content: 'Hello' }]))).rejects.toMatchObject({
      code: ErrorCode.AI_INVALID_KEY,
      message: 'Session expired. Re-import or refresh the official Codex auth artifact.',
    } satisfies Partial<ExtensionError>);
  });

  it('maps insufficient quota HTTP responses ahead of generic rate-limit handling', async () => {
    const provider = new CodexProvider();
    await provider.initialize(config);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          error: {
            code: 'insufficient_quota',
            message: 'Quota exhausted for this seat.',
          },
        }),
      ),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      collectChunks(provider.chat([{ role: 'user', content: 'Hello' }], { maxRetries: 0 })),
    ).rejects.toMatchObject({
      code: ErrorCode.AI_QUOTA_EXCEEDED,
      message: 'Quota exhausted for this seat.',
    } satisfies Partial<ExtensionError>);
  });

  it('rejects multimodal prompts before sending the request', async () => {
    const provider = new CodexProvider();
    await provider.initialize(config);

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      collectChunks(
        provider.chat([
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe this screenshot.' },
              { type: 'image', image_url: { url: 'data:image/png;base64,AAA' } },
            ],
          },
        ], { maxRetries: 0 }),
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.AI_API_ERROR,
      message: 'Codex account-backed adapter currently supports text-only prompts.',
    } satisfies Partial<ExtensionError>);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces incomplete stream reasons with a retry hint', async () => {
    const provider = new CodexProvider();
    await provider.initialize(config);

    const fetchMock = createStreamingFetchMock([
      formatSSEData({
        type: 'response.incomplete',
        response: {
          incomplete_details: {
            reason: 'max_output_tokens',
          },
        },
      }),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      collectChunks(provider.chat([{ role: 'user', content: 'Hello' }], { maxRetries: 0 })),
    ).rejects.toMatchObject({
      code: ErrorCode.AI_API_ERROR,
      message:
        'Codex returned an incomplete response (max_output_tokens). Re-auth or retry from the official Codex client may be required.',
    } satisfies Partial<ExtensionError>);
  });

  it('rejects non-JWT runtime tokens during validation', async () => {
    const provider = new CodexProvider();
    await provider.initialize(config);

    await expect(provider.validateApiKey('not-a-jwt')).resolves.toBe(false);
    await expect(provider.validateApiKey('header.payload.signature')).resolves.toBe(true);
  });
});
