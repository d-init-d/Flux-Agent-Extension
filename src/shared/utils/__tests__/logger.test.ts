/**
 * @module logger.test
 * @description Tests for the Logger class.
 *
 * Covers: log level filtering, namespace prefixing, child loggers,
 * runtime level changes, and output format.
 */

import { Logger, type LogLevel } from '../logger';

describe('Logger', () => {
  // Spy on all console methods before each test
  let debugSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Construction
  // ==========================================================================

  describe('construction', () => {
    it('should create a logger with a namespace', () => {
      const logger = new Logger('TestModule');
      // Verify it works by calling info — should include namespace in output
      logger.info('hello');
      expect(infoSpy).toHaveBeenCalledOnce();
      expect(infoSpy.mock.calls[0][0]).toContain('[TestModule]');
    });

    it('should default to info level', () => {
      const logger = new Logger('Test');

      logger.debug('should be suppressed');
      expect(debugSpy).not.toHaveBeenCalled();

      logger.info('should appear');
      expect(infoSpy).toHaveBeenCalledOnce();
    });

    it('should accept a custom initial log level', () => {
      const logger = new Logger('Test', 'debug');

      logger.debug('should appear now');
      expect(debugSpy).toHaveBeenCalledOnce();
    });
  });

  // ==========================================================================
  // Log level filtering
  // ==========================================================================

  describe('log level filtering', () => {
    it('should suppress debug when level is info', () => {
      const logger = new Logger('Test', 'info');

      logger.debug('nope');
      expect(debugSpy).not.toHaveBeenCalled();

      logger.info('yes');
      expect(infoSpy).toHaveBeenCalledOnce();

      logger.warn('yes');
      expect(warnSpy).toHaveBeenCalledOnce();

      logger.error('yes');
      expect(errorSpy).toHaveBeenCalledOnce();
    });

    it('should suppress debug and info when level is warn', () => {
      const logger = new Logger('Test', 'warn');

      logger.debug('nope');
      logger.info('nope');
      expect(debugSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();

      logger.warn('yes');
      logger.error('yes');
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(errorSpy).toHaveBeenCalledOnce();
    });

    it('should only allow error when level is error', () => {
      const logger = new Logger('Test', 'error');

      logger.debug('nope');
      logger.info('nope');
      logger.warn('nope');
      expect(debugSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();

      logger.error('yes');
      expect(errorSpy).toHaveBeenCalledOnce();
    });

    it('should allow all levels when level is debug', () => {
      const logger = new Logger('Test', 'debug');

      logger.debug('d');
      logger.info('i');
      logger.warn('w');
      logger.error('e');

      expect(debugSpy).toHaveBeenCalledOnce();
      expect(infoSpy).toHaveBeenCalledOnce();
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(errorSpy).toHaveBeenCalledOnce();
    });
  });

  // ==========================================================================
  // Output format
  // ==========================================================================

  describe('output format', () => {
    it('should include ISO timestamp in output', () => {
      const logger = new Logger('Test', 'debug');
      logger.info('hello');

      const output = infoSpy.mock.calls[0][0] as string;
      // ISO timestamp pattern: 2025-01-01T00:00:00.000Z
      expect(output).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should include namespace in brackets', () => {
      const logger = new Logger('MyComponent', 'debug');
      logger.warn('test');

      const output = warnSpy.mock.calls[0][0] as string;
      expect(output).toContain('[MyComponent]');
    });

    it('should include the message text', () => {
      const logger = new Logger('Test', 'debug');
      logger.error('something went wrong');

      const output = errorSpy.mock.calls[0][0] as string;
      expect(output).toContain('something went wrong');
    });

    it('should pass data as second argument when provided', () => {
      const logger = new Logger('Test', 'debug');
      const data = { foo: 'bar', count: 42 };

      logger.info('with data', data);

      expect(infoSpy).toHaveBeenCalledWith(expect.any(String), data);
    });

    it('should NOT pass a second argument when data is undefined', () => {
      const logger = new Logger('Test', 'debug');
      logger.info('no data');

      expect(infoSpy).toHaveBeenCalledWith(expect.any(String));
      // Ensure only 1 argument was passed (no second `undefined` arg)
      expect(infoSpy.mock.calls[0]).toHaveLength(1);
    });
  });

  // ==========================================================================
  // setLevel (runtime changes)
  // ==========================================================================

  describe('setLevel', () => {
    it('should change the log level at runtime', () => {
      const logger = new Logger('Test', 'error');

      // Initially only error works
      logger.info('suppressed');
      expect(infoSpy).not.toHaveBeenCalled();

      // Change to debug
      logger.setLevel('debug');
      logger.info('now visible');
      expect(infoSpy).toHaveBeenCalledOnce();
    });

    it('should increase strictness at runtime', () => {
      const logger = new Logger('Test', 'debug');

      logger.debug('visible');
      expect(debugSpy).toHaveBeenCalledOnce();

      logger.setLevel('error');
      logger.debug('suppressed');
      logger.info('suppressed');
      logger.warn('suppressed');
      // debug was called once before, should not increase
      expect(debugSpy).toHaveBeenCalledTimes(1);
      expect(infoSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Child loggers
  // ==========================================================================

  describe('child', () => {
    it('should create a child logger with extended namespace', () => {
      const parent = new Logger('Parent', 'debug');
      const child = parent.child('Child');

      child.info('from child');

      const output = infoSpy.mock.calls[0][0] as string;
      expect(output).toContain('[Parent:Child]');
    });

    it('should inherit the parent log level', () => {
      const parent = new Logger('Parent', 'warn');
      const child = parent.child('Child');

      child.info('suppressed');
      expect(infoSpy).not.toHaveBeenCalled();

      child.warn('visible');
      expect(warnSpy).toHaveBeenCalledOnce();
    });

    it('should allow further nesting', () => {
      const root = new Logger('App', 'debug');
      const mid = root.child('Service');
      const leaf = mid.child('Handler');

      leaf.debug('deep');

      const output = debugSpy.mock.calls[0][0] as string;
      expect(output).toContain('[App:Service:Handler]');
    });

    it('child setLevel should not affect parent', () => {
      const parent = new Logger('Parent', 'debug');
      const child = parent.child('Child');

      child.setLevel('error');

      // Child should suppress info
      child.info('suppressed');
      expect(infoSpy).not.toHaveBeenCalled();

      // Parent should still allow info
      parent.info('visible');
      expect(infoSpy).toHaveBeenCalledOnce();
    });
  });

  // ==========================================================================
  // Each log method delegates to the correct console method
  // ==========================================================================

  describe('method delegation', () => {
    const logger = new Logger('Test', 'debug');

    it('debug() calls console.debug', () => {
      logger.debug('msg');
      expect(debugSpy).toHaveBeenCalledOnce();
      expect(infoSpy).not.toHaveBeenCalled();
    });

    it('info() calls console.info', () => {
      logger.info('msg');
      expect(infoSpy).toHaveBeenCalledOnce();
      expect(debugSpy).not.toHaveBeenCalled();
    });

    it('warn() calls console.warn', () => {
      logger.warn('msg');
      expect(warnSpy).toHaveBeenCalledOnce();
    });

    it('error() calls console.error', () => {
      logger.error('msg');
      expect(errorSpy).toHaveBeenCalledOnce();
    });
  });

  // ==========================================================================
  // Edge cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle empty message', () => {
      const logger = new Logger('Test', 'debug');
      logger.info('');

      expect(infoSpy).toHaveBeenCalledOnce();
    });

    it('should handle error objects as data parameter', () => {
      const logger = new Logger('Test', 'debug');
      const err = new Error('something broke');

      logger.error('Caught error', err);

      expect(errorSpy).toHaveBeenCalledWith(expect.any(String), err);
    });

    it('should handle special characters in namespace', () => {
      const logger = new Logger('AI-Client/v2', 'debug');
      logger.info('test');

      const output = infoSpy.mock.calls[0][0] as string;
      expect(output).toContain('[AI-Client/v2]');
    });
  });

  // ==========================================================================
  // Coverage: debug/warn without data parameter (lines 71, 77)
  // ==========================================================================

  describe('log methods without data parameter', () => {
    it('should call console.debug with only formatted message (no data)', () => {
      const logger = new Logger('Test', 'debug');
      logger.debug('debug msg only');

      expect(debugSpy).toHaveBeenCalledOnce();
      expect(debugSpy.mock.calls[0]).toHaveLength(1);
      expect(debugSpy.mock.calls[0][0]).toContain('debug msg only');
    });

    it('should call console.debug with data when provided', () => {
      const logger = new Logger('Test', 'debug');
      const data = { key: 'value' };
      logger.debug('debug with data', data);

      expect(debugSpy).toHaveBeenCalledWith(expect.any(String), data);
      expect(debugSpy.mock.calls[0]).toHaveLength(2);
    });

    it('should call console.warn with only formatted message (no data)', () => {
      const logger = new Logger('Test', 'debug');
      logger.warn('warn msg only');

      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.mock.calls[0]).toHaveLength(1);
      expect(warnSpy.mock.calls[0][0]).toContain('warn msg only');
    });

    it('should call console.warn with data when provided', () => {
      const logger = new Logger('Test', 'debug');
      const data = { warning: true };
      logger.warn('warn with data', data);

      expect(warnSpy).toHaveBeenCalledWith(expect.any(String), data);
      expect(warnSpy.mock.calls[0]).toHaveLength(2);
    });

    it('should call console.error with only formatted message (no data)', () => {
      const logger = new Logger('Test', 'debug');
      logger.error('error msg only');

      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy.mock.calls[0]).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Static: Global level override
  // ==========================================================================

  describe('global level override', () => {
    afterEach(() => {
      Logger.resetAll();
    });

    it('should override per-instance level when set', () => {
      const logger = new Logger('Test', 'debug');

      Logger.setGlobalLevel('error');
      logger.debug('suppressed');
      logger.info('suppressed');
      logger.warn('suppressed');
      expect(debugSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();

      logger.error('visible');
      expect(errorSpy).toHaveBeenCalledOnce();
    });

    it('should revert to per-instance level after clearGlobalLevel', () => {
      const logger = new Logger('Test', 'debug');

      Logger.setGlobalLevel('error');
      logger.debug('suppressed');
      expect(debugSpy).not.toHaveBeenCalled();

      Logger.clearGlobalLevel();
      logger.debug('visible');
      expect(debugSpy).toHaveBeenCalledOnce();
    });
  });

  // ==========================================================================
  // Static: Console enable/disable
  // ==========================================================================

  describe('console enable/disable', () => {
    afterEach(() => {
      Logger.resetAll();
    });

    it('should suppress console output when disabled', () => {
      Logger.disableConsole();
      const logger = new Logger('Test', 'debug');
      logger.info('should not appear');

      expect(infoSpy).not.toHaveBeenCalled();
    });

    it('should resume console output when re-enabled', () => {
      Logger.disableConsole();
      const logger = new Logger('Test', 'debug');
      logger.info('hidden');
      expect(infoSpy).not.toHaveBeenCalled();

      Logger.enableConsole();
      logger.info('visible');
      expect(infoSpy).toHaveBeenCalledOnce();
    });
  });

  // ==========================================================================
  // Static: Custom transports
  // ==========================================================================

  describe('custom transports', () => {
    afterEach(() => {
      Logger.resetAll();
    });

    it('should deliver sanitized entries to custom transports', () => {
      const transport = vi.fn();
      Logger.addTransport(transport);
      const logger = new Logger('Test', 'debug');

      logger.info('hello', { key: 'value' });

      expect(transport).toHaveBeenCalledOnce();
      const entry = transport.mock.calls[0][0];
      expect(entry.level).toBe('info');
      expect(entry.namespace).toBe('Test');
      expect(entry.message).toBe('hello');
      expect(entry.data).toEqual({ key: 'value' });
    });

    it('should not add the same transport twice', () => {
      const transport = vi.fn();
      Logger.addTransport(transport);
      Logger.addTransport(transport);
      const logger = new Logger('Test', 'debug');
      logger.info('msg');

      expect(transport).toHaveBeenCalledOnce();
    });

    it('should remove a transport via removeTransport', () => {
      const transport = vi.fn();
      Logger.addTransport(transport);
      Logger.removeTransport(transport);
      const logger = new Logger('Test', 'debug');
      logger.info('msg');

      expect(transport).not.toHaveBeenCalled();
    });

    it('removeTransport should be a no-op for unknown transport', () => {
      const transport = vi.fn();
      expect(() => Logger.removeTransport(transport)).not.toThrow();
    });

    it('should clear all transports via clearTransports', () => {
      const t1 = vi.fn();
      const t2 = vi.fn();
      Logger.addTransport(t1);
      Logger.addTransport(t2);
      Logger.clearTransports();
      const logger = new Logger('Test', 'debug');
      logger.info('msg');

      expect(t1).not.toHaveBeenCalled();
      expect(t2).not.toHaveBeenCalled();
    });

    it('should swallow transport errors without crashing', () => {
      const badTransport = vi.fn(() => {
        throw new Error('boom');
      });
      Logger.addTransport(badTransport);
      const logger = new Logger('Test', 'debug');

      expect(() => logger.info('msg')).not.toThrow();
    });

    it('should redact sensitive keys in data passed to transports', () => {
      const transport = vi.fn();
      Logger.addTransport(transport);
      const logger = new Logger('Test', 'debug');

      logger.info('secrets', { apiKey: 'sk-123', password: 'hunter2', safe: 'ok' });

      const entry = transport.mock.calls[0][0];
      expect(entry.data.apiKey).toBe('[REDACTED]');
      expect(entry.data.password).toBe('[REDACTED]');
      expect(entry.data.safe).toBe('ok');
    });

    it('should include context in transport entries when logger has context', () => {
      const transport = vi.fn();
      Logger.addTransport(transport);
      const logger = new Logger('Test', 'debug', { requestId: 'abc' });

      logger.info('msg');

      const entry = transport.mock.calls[0][0];
      expect(entry.context).toEqual({ requestId: 'abc' });
    });

    it('should not include context key when no context is set', () => {
      const transport = vi.fn();
      Logger.addTransport(transport);
      const logger = new Logger('Test', 'debug');

      logger.info('msg');

      const entry = transport.mock.calls[0][0];
      expect(entry.context).toBeUndefined();
    });
  });

  // ==========================================================================
  // Static: In-memory buffer
  // ==========================================================================

  describe('in-memory buffer', () => {
    afterEach(() => {
      Logger.resetAll();
    });

    it('should buffer entries when enabled', () => {
      Logger.enableBuffer(10);
      const logger = new Logger('Test', 'debug');
      logger.info('buffered');

      const entries = Logger.getBuffer();
      expect(entries).toHaveLength(1);
      expect(entries[0].message).toBe('buffered');
    });

    it('should evict oldest entries when buffer overflows', () => {
      Logger.enableBuffer(2);
      const logger = new Logger('Test', 'debug');
      logger.info('first');
      logger.info('second');
      logger.info('third');

      const entries = Logger.getBuffer();
      expect(entries).toHaveLength(2);
      expect(entries[0].message).toBe('second');
      expect(entries[1].message).toBe('third');
    });

    it('should return empty array when buffer is not enabled', () => {
      expect(Logger.getBuffer()).toEqual([]);
    });

    it('should clear buffered entries via clearBuffer', () => {
      Logger.enableBuffer(10);
      const logger = new Logger('Test', 'debug');
      logger.info('msg');
      Logger.clearBuffer();

      expect(Logger.getBuffer()).toEqual([]);
    });

    it('clearBuffer should be a no-op when buffer is disabled', () => {
      expect(() => Logger.clearBuffer()).not.toThrow();
    });

    it('should discard buffer entirely via disableBuffer', () => {
      Logger.enableBuffer(10);
      const logger = new Logger('Test', 'debug');
      logger.info('msg');
      Logger.disableBuffer();

      expect(Logger.getBuffer()).toEqual([]);
    });
  });

  // ==========================================================================
  // withContext
  // ==========================================================================

  describe('withContext', () => {
    afterEach(() => {
      Logger.resetAll();
    });

    it('should create a new logger with merged context', () => {
      const transport = vi.fn();
      Logger.addTransport(transport);

      const logger = new Logger('Test', 'debug', { a: 1 });
      const withCtx = logger.withContext({ b: 2 });
      withCtx.info('msg');

      const entry = transport.mock.calls[0][0];
      expect(entry.context).toEqual({ a: 1, b: 2 });
    });

    it('should override parent context keys', () => {
      const transport = vi.fn();
      Logger.addTransport(transport);

      const logger = new Logger('Test', 'debug', { x: 'old' });
      const withCtx = logger.withContext({ x: 'new' });
      withCtx.info('msg');

      const entry = transport.mock.calls[0][0];
      expect(entry.context).toEqual({ x: 'new' });
    });

    it('should work when parent has no context', () => {
      const transport = vi.fn();
      Logger.addTransport(transport);

      const logger = new Logger('Test', 'debug');
      const withCtx = logger.withContext({ key: 'val' });
      withCtx.info('msg');

      const entry = transport.mock.calls[0][0];
      expect(entry.context).toEqual({ key: 'val' });
    });
  });

  // ==========================================================================
  // Performance timers
  // ==========================================================================

  describe('performance timers', () => {
    it('should measure elapsed time between time() and timeEnd()', () => {
      const logger = new Logger('Test', 'debug');
      logger.time('op');
      const elapsed = logger.timeEnd('op');

      expect(elapsed).toBeGreaterThanOrEqual(0);
      expect(debugSpy).toHaveBeenCalled();
      expect(debugSpy.mock.calls.at(-1)?.[0]).toContain('op:');
    });

    it('should return -1 and warn for unknown timer label', () => {
      const logger = new Logger('Test', 'debug');
      const result = logger.timeEnd('nonexistent');

      expect(result).toBe(-1);
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.mock.calls[0][0]).toContain('nonexistent');
    });
  });

  // ==========================================================================
  // Safe sanitization (via transport path)
  // ==========================================================================

  describe('data sanitization via transports', () => {
    afterEach(() => {
      Logger.resetAll();
    });

    it('should truncate long strings', () => {
      const transport = vi.fn();
      Logger.addTransport(transport);
      const logger = new Logger('Test', 'debug');

      const longString = 'x'.repeat(2000);
      logger.info('long', longString);

      const entry = transport.mock.calls[0][0];
      expect((entry.data as string).length).toBeLessThan(2000);
      expect(entry.data).toContain('[truncated');
    });

    it('should handle circular references', () => {
      const transport = vi.fn();
      Logger.addTransport(transport);
      const logger = new Logger('Test', 'debug');

      const circular: Record<string, unknown> = { a: 1 };
      circular.self = circular;
      logger.info('circular', circular);

      const entry = transport.mock.calls[0][0];
      expect(entry.data.self).toBe('[Circular]');
    });

    it('should serialize Error instances', () => {
      const transport = vi.fn();
      Logger.addTransport(transport);
      const logger = new Logger('Test', 'debug');

      logger.info('err', new Error('test error'));

      const entry = transport.mock.calls[0][0];
      expect(entry.data.name).toBe('Error');
      expect(entry.data.message).toBe('test error');
    });

    it('should serialize arrays', () => {
      const transport = vi.fn();
      Logger.addTransport(transport);
      const logger = new Logger('Test', 'debug');

      logger.info('arr', [1, 'two', { three: 3 }]);

      const entry = transport.mock.calls[0][0];
      expect(entry.data).toEqual([1, 'two', { three: 3 }]);
    });

    it('should convert bigint, symbol, and function to strings', () => {
      const transport = vi.fn();
      Logger.addTransport(transport);
      const logger = new Logger('Test', 'debug');

      logger.info('bigint', BigInt(42));
      logger.info('symbol', Symbol('test'));
      logger.info('fn', () => {});

      expect(transport.mock.calls[0][0].data).toBe('42');
      expect(transport.mock.calls[1][0].data).toBe('Symbol(test)');
      expect(typeof transport.mock.calls[2][0].data).toBe('string');
    });

    it('should pass through null and undefined', () => {
      const transport = vi.fn();
      Logger.addTransport(transport);
      const logger = new Logger('Test', 'debug');

      logger.info('with null', null);

      const entry = transport.mock.calls[0][0];
      expect(entry.data).toBeNull();
    });

    it('should pass through booleans and numbers', () => {
      const transport = vi.fn();
      Logger.addTransport(transport);
      const logger = new Logger('Test', 'debug');

      logger.info('bool', true);
      logger.info('num', 42);

      expect(transport.mock.calls[0][0].data).toBe(true);
      expect(transport.mock.calls[1][0].data).toBe(42);
    });

    it('should redact nested sensitive keys (token, secret, authorization)', () => {
      const transport = vi.fn();
      Logger.addTransport(transport);
      const logger = new Logger('Test', 'debug');

      logger.info('nested', {
        config: {
          Token: 'abc',
          Secret: 'xyz',
          Authorization: 'Bearer abc',
          safe: 'ok',
        },
      });

      const data = transport.mock.calls[0][0].data;
      expect(data.config.Token).toBe('[REDACTED]');
      expect(data.config.Secret).toBe('[REDACTED]');
      expect(data.config.Authorization).toBe('[REDACTED]');
      expect(data.config.safe).toBe('ok');
    });
  });

  // ==========================================================================
  // Console transport context passing
  // ==========================================================================

  describe('console transport with context', () => {
    it('should pass context as extra argument to console', () => {
      const logger = new Logger('Test', 'debug', { requestId: 'req-1' });
      logger.info('with ctx');

      expect(infoSpy).toHaveBeenCalledWith(expect.any(String), { requestId: 'req-1' });
    });

    it('should pass both data and context as extras', () => {
      const logger = new Logger('Test', 'debug', { requestId: 'req-1' });
      logger.info('both', { payload: 'test' });

      expect(infoSpy).toHaveBeenCalledWith(
        expect.any(String),
        { payload: 'test' },
        { requestId: 'req-1' },
      );
    });
  });

  // ==========================================================================
  // resetAll
  // ==========================================================================

  describe('resetAll', () => {
    it('should restore all static state to defaults', () => {
      Logger.disableConsole();
      Logger.setGlobalLevel('error');
      Logger.enableBuffer(10);
      Logger.addTransport(vi.fn());

      Logger.resetAll();

      const logger = new Logger('Test', 'debug');
      logger.debug('visible');
      expect(debugSpy).toHaveBeenCalledOnce();
      expect(Logger.getBuffer()).toEqual([]);
    });
  });

  // ==========================================================================
  // child with context inheritance
  // ==========================================================================

  describe('child context inheritance', () => {
    afterEach(() => {
      Logger.resetAll();
    });

    it('should inherit parent context in child logger', () => {
      const transport = vi.fn();
      Logger.addTransport(transport);

      const parent = new Logger('Parent', 'debug', { env: 'test' });
      const child = parent.child('Child');
      child.info('msg');

      const entry = transport.mock.calls[0][0];
      expect(entry.context).toEqual({ env: 'test' });
    });

    it('child of contextless parent should have no context', () => {
      const transport = vi.fn();
      Logger.addTransport(transport);

      const parent = new Logger('Parent', 'debug');
      const child = parent.child('Child');
      child.info('msg');

      const entry = transport.mock.calls[0][0];
      expect(entry.context).toBeUndefined();
    });
  });

  // ==========================================================================
  // Console transport: all levels with context (extras branches)
  // ==========================================================================

  describe('console transport extras branches', () => {
    it('console.debug should receive context as extra when present', () => {
      const logger = new Logger('Test', 'debug', { reqId: '1' });
      logger.debug('with ctx');

      expect(debugSpy).toHaveBeenCalledWith(expect.any(String), { reqId: '1' });
    });

    it('console.warn should receive context as extra when present', () => {
      const logger = new Logger('Test', 'debug', { reqId: '2' });
      logger.warn('with ctx');

      expect(warnSpy).toHaveBeenCalledWith(expect.any(String), { reqId: '2' });
    });

    it('console.error should receive context as extra when present', () => {
      const logger = new Logger('Test', 'debug', { reqId: '3' });
      logger.error('with ctx');

      expect(errorSpy).toHaveBeenCalledWith(expect.any(String), { reqId: '3' });
    });

    it('console.debug should receive both data and context', () => {
      const logger = new Logger('Test', 'debug', { env: 'test' });
      logger.debug('both', { key: 1 });

      expect(debugSpy).toHaveBeenCalledWith(expect.any(String), { key: 1 }, { env: 'test' });
    });

    it('console.warn should receive both data and context', () => {
      const logger = new Logger('Test', 'debug', { env: 'test' });
      logger.warn('both', { key: 2 });

      expect(warnSpy).toHaveBeenCalledWith(expect.any(String), { key: 2 }, { env: 'test' });
    });

    it('console.error should receive both data and context', () => {
      const logger = new Logger('Test', 'debug', { env: 'test' });
      logger.error('both', { key: 3 });

      expect(errorSpy).toHaveBeenCalledWith(expect.any(String), { key: 3 }, { env: 'test' });
    });

    it('should NOT include empty context in console extras', () => {
      const logger = new Logger('Test', 'debug', {});
      logger.info('empty ctx');

      expect(infoSpy).toHaveBeenCalledOnce();
      expect(infoSpy.mock.calls[0]).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Console disabled with custom transports active
  // ==========================================================================

  describe('console disabled with transports', () => {
    afterEach(() => {
      Logger.resetAll();
    });

    it('should deliver to custom transports even when console is disabled', () => {
      Logger.disableConsole();
      const transport = vi.fn();
      Logger.addTransport(transport);

      const logger = new Logger('Test', 'debug');
      logger.info('only transport');

      expect(infoSpy).not.toHaveBeenCalled();
      expect(transport).toHaveBeenCalledOnce();
      expect(transport.mock.calls[0][0].message).toBe('only transport');
    });

    it('should deliver to buffer even when console is disabled', () => {
      Logger.disableConsole();
      Logger.enableBuffer(5);

      const logger = new Logger('Test', 'debug');
      logger.warn('buffered only');

      expect(warnSpy).not.toHaveBeenCalled();
      const entries = Logger.getBuffer();
      expect(entries).toHaveLength(1);
      expect(entries[0].message).toBe('buffered only');
    });
  });

  // ==========================================================================
  // Buffer: enableBuffer when already enabled
  // ==========================================================================

  describe('buffer double-enable', () => {
    afterEach(() => {
      Logger.resetAll();
    });

    it('should keep existing buffer contents when enableBuffer is called again', () => {
      Logger.enableBuffer(10);
      const logger = new Logger('Test', 'debug');
      logger.info('first');

      Logger.enableBuffer(5);
      logger.info('second');

      const entries = Logger.getBuffer();
      expect(entries).toHaveLength(2);
      expect(entries[0].message).toBe('first');
      expect(entries[1].message).toBe('second');
    });
  });

  // ==========================================================================
  // safeSanitize: Error with extra own properties
  // ==========================================================================

  describe('Error with extra properties via transport', () => {
    afterEach(() => {
      Logger.resetAll();
    });

    it('should include extra own properties on Error instances', () => {
      const transport = vi.fn();
      Logger.addTransport(transport);
      const logger = new Logger('Test', 'debug');

      const err = new Error('custom');
      (err as Record<string, unknown>).code = 'E001';
      (err as Record<string, unknown>).statusCode = 500;
      logger.error('err with props', err);

      const data = transport.mock.calls[0][0].data;
      expect(data.name).toBe('Error');
      expect(data.message).toBe('custom');
      expect(data.code).toBe('E001');
      expect(data.statusCode).toBe(500);
    });
  });

  // ==========================================================================
  // Transport with no data (data === undefined in sanitized path)
  // ==========================================================================

  describe('transport entry without data', () => {
    afterEach(() => {
      Logger.resetAll();
    });

    it('should not include data key when no data is provided', () => {
      const transport = vi.fn();
      Logger.addTransport(transport);
      const logger = new Logger('Test', 'debug');

      logger.info('no data arg');

      const entry = transport.mock.calls[0][0];
      expect(entry.data).toBeUndefined();
      expect('data' in entry).toBe(false);
    });

    it('should not include context key when no context set (transport path)', () => {
      const transport = vi.fn();
      Logger.addTransport(transport);
      const logger = new Logger('Test', 'debug');

      logger.info('no ctx');

      const entry = transport.mock.calls[0][0];
      expect('context' in entry).toBe(false);
    });
  });

  // ==========================================================================
  // hasExternalConsumers false: no transports, no buffer, console enabled
  // ==========================================================================

  describe('no external consumers', () => {
    afterEach(() => {
      Logger.resetAll();
    });

    it('should only route to console when no transports and no buffer', () => {
      const logger = new Logger('Test', 'debug');
      logger.info('console only', { payload: true });

      expect(infoSpy).toHaveBeenCalledOnce();
      expect(infoSpy).toHaveBeenCalledWith(expect.any(String), { payload: true });
    });
  });

  // ==========================================================================
  // Global level + console disabled combination
  // ==========================================================================

  describe('combined static state', () => {
    afterEach(() => {
      Logger.resetAll();
    });

    it('should respect global level with custom transport and console disabled', () => {
      Logger.disableConsole();
      Logger.setGlobalLevel('warn');
      const transport = vi.fn();
      Logger.addTransport(transport);

      const logger = new Logger('Test', 'debug');
      logger.debug('suppressed');
      logger.info('suppressed');
      logger.warn('visible');
      logger.error('visible');

      expect(transport).toHaveBeenCalledTimes(2);
      expect(transport.mock.calls[0][0].level).toBe('warn');
      expect(transport.mock.calls[1][0].level).toBe('error');
    });
  });

  // ==========================================================================
  // Buffer with context and data in sanitized entry
  // ==========================================================================

  describe('buffer receives sanitized entries with context', () => {
    afterEach(() => {
      Logger.resetAll();
    });

    it('should buffer entries with sanitized data and context', () => {
      Logger.enableBuffer(5);
      const logger = new Logger('Test', 'debug', { component: 'UI' });
      logger.info('buffered', { token: 'secret123', safe: 'yes' });

      const entries = Logger.getBuffer();
      expect(entries).toHaveLength(1);
      expect(entries[0].data).toEqual({ token: '[REDACTED]', safe: 'yes' });
      expect(entries[0].context).toEqual({ component: 'UI' });
    });

    it('should buffer entry without data key when no data passed', () => {
      Logger.enableBuffer(5);
      const logger = new Logger('Test', 'debug');
      logger.warn('no data');

      const entries = Logger.getBuffer();
      expect(entries).toHaveLength(1);
      expect('data' in entries[0]).toBe(false);
    });
  });

  // ==========================================================================
  // safeSanitize: edge cases for each type
  // ==========================================================================

  describe('safeSanitize edge cases via transport', () => {
    afterEach(() => {
      Logger.resetAll();
    });

    it('should handle undefined data (not passed through sanitize)', () => {
      const transport = vi.fn();
      Logger.addTransport(transport);
      const logger = new Logger('Test', 'debug');

      logger.info('msg');
      expect(transport.mock.calls[0][0].data).toBeUndefined();
    });

    it('should handle nested arrays and objects', () => {
      const transport = vi.fn();
      Logger.addTransport(transport);
      const logger = new Logger('Test', 'debug');

      logger.info('nested', { list: [1, { password: 'x', ok: true }], num: 42 });

      const data = transport.mock.calls[0][0].data;
      expect(data.list[0]).toBe(1);
      expect(data.list[1].password).toBe('[REDACTED]');
      expect(data.list[1].ok).toBe(true);
      expect(data.num).toBe(42);
    });

    it('should handle short strings without truncation', () => {
      const transport = vi.fn();
      Logger.addTransport(transport);
      const logger = new Logger('Test', 'debug');

      logger.info('short', 'hello');
      expect(transport.mock.calls[0][0].data).toBe('hello');
    });
  });
});
