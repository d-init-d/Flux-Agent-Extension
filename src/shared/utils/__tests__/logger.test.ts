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
      // Should only have 1 argument (the formatted string), not 2
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
      // Should only have 1 argument (the formatted string), not 2
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
});
