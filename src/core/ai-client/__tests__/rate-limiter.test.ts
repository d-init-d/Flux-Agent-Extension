import { getDefaultRateLimits, RateLimiter } from '../rate-limiter';

describe('rate-limiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getDefaultRateLimits', () => {
    it.each([
      ['claude', { maxRequestsPerMinute: 50, maxTokensPerMinute: 40000 }],
      ['openai', { maxRequestsPerMinute: 60, maxTokensPerMinute: 60000 }],
      ['cliproxyapi', { maxRequestsPerMinute: 60, maxTokensPerMinute: 60000 }],
      ['gemini', { maxRequestsPerMinute: 15, maxTokensPerMinute: 1000000 }],
      ['ollama', { maxRequestsPerMinute: 120, maxTokensPerMinute: 500000 }],
      ['openrouter', { maxRequestsPerMinute: 60, maxTokensPerMinute: 100000 }],
      ['custom', { maxRequestsPerMinute: 30, maxTokensPerMinute: 30000 }],
    ] as const)('returns defaults for %s', (provider, expected) => {
      expect(getDefaultRateLimits(provider)).toEqual(expected);
    });
  });

  describe('canMakeRequest and sliding window', () => {
    it('enforces both request-count and token limits', () => {
      const limiter = new RateLimiter({ maxRequestsPerMinute: 2, maxTokensPerMinute: 5 }, 1000);

      expect(limiter.canMakeRequest()).toBe(true);

      limiter.recordRequest(2);
      expect(limiter.canMakeRequest()).toBe(true);

      limiter.recordRequest(2);
      expect(limiter.canMakeRequest()).toBe(false);

      vi.advanceTimersByTime(1100);
      expect(limiter.canMakeRequest()).toBe(true);

      limiter.recordRequest(5);
      expect(limiter.canMakeRequest()).toBe(false);
    });

    it('respects header-reported remaining quota until reset', () => {
      const limiter = new RateLimiter({ maxRequestsPerMinute: 10, maxTokensPerMinute: 1000 }, 1000);

      limiter.updateFromHeaders(
        new Headers({
          'x-ratelimit-remaining-requests': '0',
          'x-ratelimit-reset-requests': '2',
        }),
      );

      expect(limiter.canMakeRequest()).toBe(false);

      vi.advanceTimersByTime(2100);
      expect(limiter.canMakeRequest()).toBe(true);
    });
  });

  describe('recordRequest pruning behavior', () => {
    it('prunes expired records when log size exceeds 2x maxRequests', () => {
      const limiter = new RateLimiter({ maxRequestsPerMinute: 2, maxTokensPerMinute: 100 }, 1000);

      limiter.recordRequest(1); // t = 0
      vi.advanceTimersByTime(100);
      limiter.recordRequest(1); // t = 100
      vi.advanceTimersByTime(100);
      limiter.recordRequest(1); // t = 200
      vi.advanceTimersByTime(100);
      limiter.recordRequest(1); // t = 300

      // Move all old entries outside the sliding window, then add one more.
      vi.advanceTimersByTime(2000);
      limiter.recordRequest(1); // Triggers eager prune (> 2x maxRequests)

      expect(limiter.getRemainingCapacity().requests).toBe(1);
    });
  });

  describe('waitForCapacity', () => {
    it('polls every 500ms and resolves when capacity returns', async () => {
      const limiter = new RateLimiter({ maxRequestsPerMinute: 1, maxTokensPerMinute: 100 }, 1000);

      limiter.recordRequest(1);
      const waiting = limiter.waitForCapacity();

      await vi.advanceTimersByTimeAsync(1600);
      await expect(waiting).resolves.toBeUndefined();
    });

    it('rejects after 120s if capacity does not return', async () => {
      const limiter = new RateLimiter(
        { maxRequestsPerMinute: 1, maxTokensPerMinute: 100 },
        1_000_000,
      );

      limiter.recordRequest(1);
      const waiting = limiter.waitForCapacity();
      const assertion = expect(waiting).rejects.toThrow('120000ms');

      await vi.advanceTimersByTimeAsync(120_500);
      await assertion;
    });
  });

  describe('updateFromHeaders parsing', () => {
    it('supports multiple header-name variants and upgrades internal limits', () => {
      const limiter = new RateLimiter(
        { maxRequestsPerMinute: 10, maxTokensPerMinute: 1000 },
        60_000,
      );

      limiter.updateFromHeaders(
        new Headers({
          'ratelimit-remaining': '5',
          'ratelimit-limit': '99',
          'x-ratelimit-limit-tokens': '12345',
        }),
      );

      expect(limiter.getRemainingCapacity()).toEqual({
        requests: 99,
        tokens: 12345,
      });
    });

    it('parses Retry-After header in seconds', () => {
      const limiter = new RateLimiter(
        { maxRequestsPerMinute: 10, maxTokensPerMinute: 1000 },
        60_000,
      );

      limiter.updateFromHeaders(
        new Headers({
          'x-ratelimit-remaining-requests': '0',
          'retry-after': '2',
        }),
      );

      expect(limiter.canMakeRequest()).toBe(false);
      vi.advanceTimersByTime(2100);
      expect(limiter.canMakeRequest()).toBe(true);
    });

    it('parses Retry-After header as HTTP-date', () => {
      const limiter = new RateLimiter(
        { maxRequestsPerMinute: 10, maxTokensPerMinute: 1000 },
        60_000,
      );

      const dateHeader = new Date(Date.now() + 3000).toUTCString();
      limiter.updateFromHeaders(
        new Headers({
          'x-ratelimit-remaining-requests': '0',
          'retry-after': dateHeader,
        }),
      );

      expect(limiter.canMakeRequest()).toBe(false);
      vi.advanceTimersByTime(3100);
      expect(limiter.canMakeRequest()).toBe(true);
    });
  });
});
