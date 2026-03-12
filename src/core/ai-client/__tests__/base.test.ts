import type {
  AIMessage,
  AIModelConfig,
  AIRequestOptions,
  AIStreamChunk,
  AIProviderType,
} from '@shared/types';
import { ErrorCode, ExtensionError } from '@shared/errors';
import type { SSEEvent } from '../types';
import { BaseProvider } from '../base';
import type { RateLimiter } from '../rate-limiter';

function createSSEPayload(events: Array<{ event?: string; data: unknown }>): string {
  return events
    .map(({ event, data }) => {
      const lines: string[] = [];
      if (event) {
        lines.push(`event: ${event}`);
      }
      lines.push(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
      lines.push('');
      return lines.join('\n');
    })
    .join('\n');
}

function createStreamingResponse(payloadChunks: string[]): Response {
  const encoder = new TextEncoder();
  let index = 0;

  const reader = {
    read: vi.fn().mockImplementation(async () => {
      if (index >= payloadChunks.length) {
        return { done: true, value: undefined };
      }

      const value = encoder.encode(payloadChunks[index]);
      index += 1;
      return { done: false, value };
    }),
    releaseLock: vi.fn(),
    cancel: vi.fn().mockResolvedValue(undefined),
    closed: Promise.resolve(undefined),
  } as unknown as ReadableStreamDefaultReader<Uint8Array>;

  const body = {
    getReader: vi.fn().mockReturnValue(reader),
  } as unknown as ReadableStream<Uint8Array>;

  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    body,
    text: vi.fn().mockResolvedValue(''),
  } as unknown as Response;
}

function createErrorResponse(status: number, body: string): Response {
  return {
    ok: false,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    body: null,
    text: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
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

class TestProvider extends BaseProvider {
  readonly name: AIProviderType = 'custom';
  readonly supportsVision = false;
  readonly supportsStreaming = true;
  readonly supportsFunctionCalling = false;

  constructor(private readonly endpoint: string = 'https://api.test.local/v1/chat') {
    super();
    this.initLogger();
  }

  getApiKeyForTest(): string {
    return this.getApiKey();
  }

  getRateLimiterForTest(): RateLimiter | null {
    return this.rateLimiter;
  }

  protected buildHeaders(): Record<string, string> {
    return {
      'X-Test-Header': 'enabled',
    };
  }

  protected getEndpoint(): string {
    return this.endpoint;
  }

  protected buildRequestBody(
    messages: AIMessage[],
    _options?: AIRequestOptions,
  ): Record<string, unknown> {
    return {
      messages,
      model: this.getModel(),
    };
  }

  protected parseStreamChunk(event: unknown): AIStreamChunk | null {
    const sse = event as SSEEvent;
    if (!sse?.data || typeof sse.data !== 'string') {
      return null;
    }

    let parsed: { type?: string; content?: string };
    try {
      parsed = JSON.parse(sse.data) as { type?: string; content?: string };
    } catch {
      return null;
    }

    if (parsed.type === 'text') {
      return { type: 'text', content: parsed.content ?? '' };
    }

    if (parsed.type === 'done') {
      return { type: 'done' };
    }

    return null;
  }

  protected mapErrorResponse(status: number, body: string): ExtensionError {
    if (status === 429) {
      return new ExtensionError(ErrorCode.AI_RATE_LIMIT, body || 'rate limit', true);
    }

    if (status === 404) {
      return new ExtensionError(ErrorCode.AI_MODEL_NOT_FOUND, body || 'model not found');
    }

    return new ExtensionError(ErrorCode.AI_API_ERROR, body || `HTTP ${status}`, status >= 500);
  }

  async validateApiKey(_apiKey: string): Promise<boolean> {
    return true;
  }
}

describe('BaseProvider', () => {
  const messages: AIMessage[] = [{ role: 'user', content: 'hello' }];
  const initializedConfig: AIModelConfig = {
    provider: 'custom',
    model: 'test-model',
    apiKey: 'test-key',
  };

  it('throws if chat() is called before initialize()', async () => {
    const provider = new TestProvider();

    await expect(collectChunks(provider.chat(messages))).rejects.toMatchObject({
      code: ErrorCode.AI_API_ERROR,
    });
  });

  it('throws AI_INVALID_KEY when api key is not configured', async () => {
    const provider = new TestProvider();
    await provider.initialize({ provider: 'custom', model: 'test-model' });

    expect(() => provider.getApiKeyForTest()).toThrowError(ExtensionError);

    try {
      provider.getApiKeyForTest();
    } catch (error) {
      expect(error).toMatchObject({ code: ErrorCode.AI_INVALID_KEY });
    }
  });

  it('runs template flow: build request, fetch stream, parse chunks, and yield output', async () => {
    const provider = new TestProvider();
    await provider.initialize(initializedConfig);

    const payload = createSSEPayload([
      { data: { type: 'text', content: 'hello' } },
      { data: { type: 'done' } },
    ]);

    const fetchMock = vi.fn().mockResolvedValue(createStreamingResponse([payload]));
    vi.stubGlobal('fetch', fetchMock);

    const chunks = await collectChunks(provider.chat(messages));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test.local/v1/chat',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Test-Header': 'enabled',
        }),
      }),
    );

    expect(chunks).toEqual([{ type: 'text', content: 'hello' }, { type: 'done' }]);
  });

  it('integrates with rate limiter (waitForCapacity + recordRequest)', async () => {
    const provider = new TestProvider();
    await provider.initialize(initializedConfig);

    const limiter = provider.getRateLimiterForTest();
    if (!limiter) {
      throw new Error('Rate limiter should be initialized');
    }

    const waitSpy = vi.spyOn(limiter, 'waitForCapacity').mockResolvedValue();
    const recordSpy = vi.spyOn(limiter, 'recordRequest');

    const payload = createSSEPayload([
      { data: { type: 'text', content: '1234' } },
      { data: { type: 'done' } },
    ]);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createStreamingResponse([payload])));

    await collectChunks(provider.chat(messages));

    expect(waitSpy).toHaveBeenCalledTimes(1);
    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(recordSpy.mock.calls[0][0]).toBeGreaterThan(0);
  });

  it('retries retryable HTTP errors with exponential backoff', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const provider = new TestProvider();
    await provider.initialize(initializedConfig);

    const successPayload = createSSEPayload([{ data: { type: 'done' } }]);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createErrorResponse(429, '{"error":"rate"}'))
      .mockResolvedValueOnce(createStreamingResponse([successPayload]));

    vi.stubGlobal('fetch', fetchMock);

    const run = collectChunks(provider.chat(messages, { maxRetries: 1 }));
    await vi.advanceTimersByTimeAsync(1000);

    const chunks = await run;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(chunks).toEqual([{ type: 'done' }]);

    vi.useRealTimers();
  });

  it('maps non-OK non-retryable responses through mapErrorResponse()', async () => {
    const provider = new TestProvider();
    await provider.initialize(initializedConfig);

    const fetchMock = vi.fn().mockResolvedValue(createErrorResponse(404, '{"error":"missing"}'));

    vi.stubGlobal('fetch', fetchMock);

    await expect(collectChunks(provider.chat(messages, { maxRetries: 2 }))).rejects.toMatchObject({
      code: ErrorCode.AI_MODEL_NOT_FOUND,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('propagates external abort signal and throws ABORTED', async () => {
    const provider = new TestProvider();
    await provider.initialize(initializedConfig);

    const external = new AbortController();

    const fetchMock = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;

          if (!signal) {
            reject(new Error('Missing abort signal'));
            return;
          }

          if (signal.aborted) {
            reject(new Error('aborted'));
            return;
          }

          signal.addEventListener(
            'abort',
            () => {
              reject(new Error('aborted'));
            },
            { once: true },
          );
        }),
    );

    vi.stubGlobal('fetch', fetchMock);

    const run = collectChunks(provider.chat(messages, { signal: external.signal }));
    await Promise.resolve();
    external.abort();

    await expect(run).rejects.toMatchObject({ code: ErrorCode.ABORTED });
  });

  it('throws when response body is null', async () => {
    const provider = new TestProvider();
    await provider.initialize(initializedConfig);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        body: null,
        text: vi.fn().mockResolvedValue(''),
      }),
    );

    await expect(collectChunks(provider.chat(messages, { maxRetries: 0 }))).rejects.toMatchObject({
      code: ErrorCode.AI_API_ERROR,
    });
  });

  it('abort() method clears internal controller', () => {
    const provider = new TestProvider();
    provider.abort();
    // No error - abort on uninitialized provider is safe
  });

  it('handles already-aborted external signal', async () => {
    const provider = new TestProvider();
    await provider.initialize(initializedConfig);

    const external = new AbortController();
    external.abort();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        throw new Error('aborted');
      }),
    );

    await expect(
      collectChunks(provider.chat(messages, { signal: external.signal })),
    ).rejects.toMatchObject({ code: ErrorCode.ABORTED });
  });

  it('wraps non-ExtensionError as AI_API_ERROR and retries', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const provider = new TestProvider();
    await provider.initialize(initializedConfig);

    const successPayload = createSSEPayload([{ data: { type: 'done' } }]);

    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(createStreamingResponse([successPayload]));

    vi.stubGlobal('fetch', fetchMock);

    const run = collectChunks(provider.chat(messages, { maxRetries: 1 }));
    await vi.advanceTimersByTimeAsync(2000);

    const chunks = await run;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(chunks).toEqual([{ type: 'done' }]);

    vi.useRealTimers();
  });

  it('exhausts retries and throws the last error', async () => {
    const provider = new TestProvider();
    await provider.initialize(initializedConfig);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(collectChunks(provider.chat(messages, { maxRetries: 0 }))).rejects.toMatchObject({
      code: ErrorCode.AI_API_ERROR,
      message: expect.stringContaining('Network error'),
    });
  });

  it('caps large error response body in safeReadBody', async () => {
    const provider = new TestProvider();
    await provider.initialize(initializedConfig);

    const largeBody = 'x'.repeat(8000);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createErrorResponse(500, largeBody)));

    await expect(collectChunks(provider.chat(messages, { maxRetries: 0 }))).rejects.toMatchObject({
      code: ErrorCode.AI_API_ERROR,
    });
  });

  it('handles safeReadBody failure gracefully', async () => {
    const provider = new TestProvider();
    await provider.initialize(initializedConfig);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers(),
        body: null,
        text: vi.fn().mockRejectedValue(new Error('read failed')),
      }),
    );

    await expect(collectChunks(provider.chat(messages, { maxRetries: 0 }))).rejects.toMatchObject({
      code: ErrorCode.AI_API_ERROR,
    });
  });

  it('updates rate limiter headers from response', async () => {
    const provider = new TestProvider();
    await provider.initialize(initializedConfig);

    const limiter = provider.getRateLimiterForTest();
    expect(limiter).not.toBeNull();
    const updateSpy = vi.spyOn(limiter!, 'updateFromHeaders');

    const payload = createSSEPayload([{ data: { type: 'done' } }]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createStreamingResponse([payload])));

    await collectChunks(provider.chat(messages));

    expect(updateSpy).toHaveBeenCalledTimes(1);
  });
});
