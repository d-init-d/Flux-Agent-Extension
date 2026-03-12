import type {
  AIMessage,
  AIModelConfig,
  AIProviderType,
  AIRequestOptions,
  AIStreamChunk,
} from '@shared/types';
import { ErrorCode, ExtensionError } from '@shared/errors';
import type { IAIProvider } from '../interfaces';
import { AIClientManager } from '../manager';

interface MockProvider extends IAIProvider {
  initialize: ReturnType<typeof vi.fn>;
  chat: ReturnType<typeof vi.fn>;
  validateApiKey: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
}

function createProvider(type: AIProviderType): MockProvider {
  return {
    name: type,
    supportsVision: true,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    initialize: vi.fn(async () => {}),
    chat: vi.fn(async function* () {
      yield { type: 'done' } as AIStreamChunk;
    }),
    validateApiKey: vi.fn(async () => true),
    abort: vi.fn(),
  };
}

function createConfig(provider: AIProviderType): AIModelConfig {
  return {
    provider,
    model: `${provider}-model`,
    apiKey: `${provider}-key`,
  };
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

function streamChunks(chunks: AIStreamChunk[]): AsyncGenerator<AIStreamChunk, void, unknown> {
  return (async function* () {
    for (const chunk of chunks) {
      yield chunk;
    }
  })();
}

function throwStream(error: Error): AsyncGenerator<AIStreamChunk, void, unknown> {
  // eslint-disable-next-line require-yield
  return (async function* () {
    throw error;
  })();
}

describe('AIClientManager', () => {
  const messages: AIMessage[] = [{ role: 'user', content: 'hello' }];

  it('throws when getting active provider before switchProvider()', () => {
    const manager = new AIClientManager();

    expect(() => manager.getActiveProvider()).toThrowError(ExtensionError);
  });

  it('replaces provider registration when same type is registered again', async () => {
    const manager = new AIClientManager();
    const first = createProvider('openai');
    const replacement = createProvider('openai');

    manager.registerProvider(first);
    manager.registerProvider(replacement);

    expect(manager.getRegisteredProviders()).toEqual(['openai']);

    await manager.switchProvider('openai', createConfig('openai'));

    expect(first.initialize).not.toHaveBeenCalled();
    expect(replacement.initialize).toHaveBeenCalledTimes(1);
  });

  it('initializes on switchProvider() and skips re-init for identical config', async () => {
    const manager = new AIClientManager();
    const openai = createProvider('openai');
    manager.registerProvider(openai);

    const config = createConfig('openai');
    await manager.switchProvider('openai', config);
    await manager.switchProvider('openai', config);

    expect(openai.initialize).toHaveBeenCalledTimes(1);
    expect(manager.getActiveProviderType()).toBe('openai');

    await manager.switchProvider('openai', {
      ...config,
      temperature: 0.2,
    });

    expect(openai.initialize).toHaveBeenCalledTimes(2);
  });

  it('falls back in ordered mode when active provider fails', async () => {
    const manager = new AIClientManager({ fallbackStrategy: 'ordered' });
    const openai = createProvider('openai');
    const claude = createProvider('claude');

    manager.registerProvider(openai);
    manager.registerProvider(claude);

    await manager.switchProvider('openai', createConfig('openai'));
    await manager.switchProvider('claude', createConfig('claude'));
    await manager.switchProvider('openai', createConfig('openai'));

    openai.chat.mockImplementation(() =>
      throwStream(new ExtensionError(ErrorCode.AI_API_ERROR, 'openai down', true)),
    );
    claude.chat.mockImplementation(() =>
      streamChunks([{ type: 'text', content: 'fallback reply' }, { type: 'done' }]),
    );

    const chunks = await collectChunks(manager.chat(messages));

    expect(openai.chat).toHaveBeenCalledTimes(1);
    expect(claude.chat).toHaveBeenCalledTimes(1);
    expect(chunks).toEqual([{ type: 'text', content: 'fallback reply' }, { type: 'done' }]);

    const health = manager.getProviderHealth().get('openai');
    expect(health?.consecutiveFailures).toBe(1);
  });

  it.each([ErrorCode.ABORTED, ErrorCode.AI_INVALID_KEY, ErrorCode.SENSITIVE_DATA_DETECTED])(
    'does not fallback for non-eligible error code %s',
    async (errorCode) => {
      const manager = new AIClientManager();
      const openai = createProvider('openai');
      const claude = createProvider('claude');

      manager.registerProvider(openai);
      manager.registerProvider(claude);

      await manager.switchProvider('openai', createConfig('openai'));
      await manager.switchProvider('claude', createConfig('claude'));
      await manager.switchProvider('openai', createConfig('openai'));

      openai.chat.mockImplementation(() =>
        throwStream(new ExtensionError(errorCode, `blocked: ${errorCode}`)),
      );
      claude.chat.mockImplementation(() => streamChunks([{ type: 'done' }]));

      await expect(collectChunks(manager.chat(messages))).rejects.toMatchObject({
        code: errorCode,
      });

      expect(claude.chat).not.toHaveBeenCalled();
    },
  );

  it('does not use fallback providers when autoFallback is disabled', async () => {
    const manager = new AIClientManager({ autoFallback: false });
    const openai = createProvider('openai');
    const claude = createProvider('claude');

    manager.registerProvider(openai);
    manager.registerProvider(claude);

    await manager.switchProvider('openai', createConfig('openai'));
    await manager.switchProvider('claude', createConfig('claude'));
    await manager.switchProvider('openai', createConfig('openai'));

    openai.chat.mockImplementation(() =>
      throwStream(new ExtensionError(ErrorCode.AI_API_ERROR, 'primary failed', true)),
    );

    await expect(collectChunks(manager.chat(messages))).rejects.toMatchObject({
      code: ErrorCode.AI_API_ERROR,
    });

    expect(claude.chat).not.toHaveBeenCalled();
  });

  it('uses round-robin fallback ordering across attempts', async () => {
    const manager = new AIClientManager({ fallbackStrategy: 'round-robin' });
    const openai = createProvider('openai');
    const claude = createProvider('claude');
    const gemini = createProvider('gemini');

    manager.registerProvider(openai);
    manager.registerProvider(claude);
    manager.registerProvider(gemini);

    await manager.switchProvider('openai', createConfig('openai'));
    await manager.switchProvider('claude', createConfig('claude'));
    await manager.switchProvider('gemini', createConfig('gemini'));
    await manager.switchProvider('openai', createConfig('openai'));

    const order: string[] = [];
    const fail = (name: string) => () => {
      order.push(name);
      return throwStream(new ExtensionError(ErrorCode.AI_API_ERROR, `${name} failed`, true));
    };

    openai.chat.mockImplementation(fail('openai'));
    claude.chat.mockImplementation(fail('claude'));
    gemini.chat.mockImplementation(fail('gemini'));

    await expect(collectChunks(manager.chat(messages))).rejects.toThrowError(ExtensionError);
    await expect(collectChunks(manager.chat(messages))).rejects.toThrowError(ExtensionError);

    expect(order).toEqual(['openai', 'claude', 'gemini', 'openai', 'gemini', 'claude']);
  });

  it('uses least-errors strategy to prefer healthier fallback provider', async () => {
    const manager = new AIClientManager({ fallbackStrategy: 'least-errors' });
    const openai = createProvider('openai');
    const claude = createProvider('claude');
    const gemini = createProvider('gemini');

    manager.registerProvider(openai);
    manager.registerProvider(claude);
    manager.registerProvider(gemini);

    await manager.switchProvider('openai', createConfig('openai'));
    await manager.switchProvider('claude', createConfig('claude'));
    await manager.switchProvider('gemini', createConfig('gemini'));
    await manager.switchProvider('openai', createConfig('openai'));

    openai.chat.mockImplementation(() =>
      throwStream(new ExtensionError(ErrorCode.AI_API_ERROR, 'openai failed', true)),
    );
    claude.chat.mockImplementation(() =>
      throwStream(new ExtensionError(ErrorCode.AI_API_ERROR, 'claude failed', true)),
    );
    gemini.chat.mockImplementation(() => streamChunks([{ type: 'done' }]));

    // First run: openai fails -> claude fails -> gemini succeeds
    await collectChunks(manager.chat(messages));

    // Second run should prefer gemini over claude due fewer failures.
    await collectChunks(manager.chat(messages));

    expect(openai.chat).toHaveBeenCalledTimes(2);
    expect(gemini.chat).toHaveBeenCalledTimes(2);
    expect(claude.chat).toHaveBeenCalledTimes(1);
  });

  it('marks provider unhealthy after 3 failures and retries after cooldown', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const manager = new AIClientManager();
    const openai = createProvider('openai');
    const claude = createProvider('claude');

    manager.registerProvider(openai);
    manager.registerProvider(claude);

    await manager.switchProvider('openai', createConfig('openai'));
    await manager.switchProvider('claude', createConfig('claude'));
    await manager.switchProvider('openai', createConfig('openai'));

    openai.chat.mockImplementation(() =>
      throwStream(new ExtensionError(ErrorCode.AI_API_ERROR, 'openai failed', true)),
    );
    claude.chat.mockImplementation(() => streamChunks([{ type: 'done' }]));

    await collectChunks(manager.chat(messages));
    await collectChunks(manager.chat(messages));
    await collectChunks(manager.chat(messages));

    const healthAfter3 = manager.getProviderHealth().get('openai');
    expect(healthAfter3?.healthy).toBe(false);
    expect(healthAfter3?.consecutiveFailures).toBe(3);

    // Before cooldown ends, openai should be skipped.
    await collectChunks(manager.chat(messages));
    expect(openai.chat).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(60_000);

    // After cooldown, openai is tried again.
    await collectChunks(manager.chat(messages));
    expect(openai.chat).toHaveBeenCalledTimes(4);

    vi.useRealTimers();
  });

  it('forwards abort() to active provider', async () => {
    const manager = new AIClientManager();
    const openai = createProvider('openai');
    manager.registerProvider(openai);

    await manager.switchProvider('openai', createConfig('openai'));
    manager.abort();

    expect(openai.abort).toHaveBeenCalledTimes(1);
  });

  it('validates API key through the selected provider', async () => {
    const manager = new AIClientManager();
    const openai = createProvider('openai');
    manager.registerProvider(openai);

    openai.validateApiKey.mockResolvedValueOnce(true);
    const result = await manager.validateApiKey('openai', 'my-key');

    expect(result).toBe(true);
    expect(openai.validateApiKey).toHaveBeenCalledWith('my-key');
  });

  it('throws when validating API key for unregistered provider', async () => {
    const manager = new AIClientManager();

    await expect(manager.validateApiKey('openai', 'missing')).rejects.toThrowError(ExtensionError);
  });
});
