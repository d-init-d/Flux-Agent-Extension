import { parseJSONStream, parseSSEStream } from '../streaming';
import type { SSEEvent } from '../types';

function createMockReader(chunks: string[]) {
  const encoder = new TextEncoder();
  let index = 0;

  const read = vi.fn().mockImplementation(async () => {
    if (index >= chunks.length) {
      return { done: true, value: undefined };
    }

    const value = encoder.encode(chunks[index]);
    index += 1;
    return { done: false, value };
  });

  const releaseLock = vi.fn();

  const reader = {
    read,
    releaseLock,
    cancel: vi.fn().mockResolvedValue(undefined),
    closed: Promise.resolve(undefined),
  } as unknown as ReadableStreamDefaultReader<Uint8Array>;

  return { reader, read, releaseLock };
}

async function collectSSEEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): Promise<SSEEvent[]> {
  const events: SSEEvent[] = [];
  for await (const event of parseSSEStream(reader, signal)) {
    events.push(event);
  }
  return events;
}

async function collectJSONEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const item of parseJSONStream(reader, signal)) {
    events.push(item);
  }
  return events;
}

describe('streaming parsers', () => {
  describe('parseSSEStream', () => {
    it('parses multiline data, metadata fields, ignores comments, and handles CRLF', async () => {
      const payload = [
        ': keep-alive\r\n',
        'event: message\r\n',
        'id: evt-1\r\n',
        'retry: 1500\r\n',
        'data: first line\r\n',
        'data: second line\r\n',
        '\r\n',
      ].join('');

      const { reader } = createMockReader([payload]);
      const events = await collectSSEEvents(reader);

      expect(events).toEqual([
        {
          event: 'message',
          id: 'evt-1',
          retry: 1500,
          data: 'first line\nsecond line',
        },
      ]);
    });

    it('stops cleanly when [DONE] sentinel is received', async () => {
      const payload = ['data: hello\n\n', 'data: [DONE]\n\n', 'data: should-not-emit\n\n'].join('');

      const { reader } = createMockReader([payload]);
      const events = await collectSSEEvents(reader);

      expect(events).toEqual([{ data: 'hello' }]);
    });

    it('flushes the buffered event when stream ends without trailing blank line', async () => {
      const { reader } = createMockReader(['data: final event\n']);
      const events = await collectSSEEvents(reader);

      expect(events).toEqual([{ data: 'final event' }]);
    });

    it('respects abort signal and releases reader lock', async () => {
      const controller = new AbortController();
      controller.abort();

      const { reader, read, releaseLock } = createMockReader(['data: ignored\n\n']);
      const events = await collectSSEEvents(reader, controller.signal);

      expect(events).toEqual([]);
      expect(read).not.toHaveBeenCalled();
      expect(releaseLock).toHaveBeenCalledTimes(1);
    });
  });

  describe('parseJSONStream', () => {
    it('parses NDJSON lines and skips empty lines', async () => {
      const ndjson = '{"a":1}\n\n{"b":2}\n   \n{"c":3}\n';
      const { reader } = createMockReader([ndjson]);

      const events = await collectJSONEvents(reader);

      expect(events).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
    });

    it('returns structured parse errors for invalid JSON lines', async () => {
      const ndjson = '{"ok":true}\nnot-json\n{"later":1}\n';
      const { reader } = createMockReader([ndjson]);

      const events = await collectJSONEvents(reader);

      expect(events).toEqual([{ ok: true }, { __parseError: true, raw: 'not-json' }, { later: 1 }]);
    });

    it('flushes remaining buffer content on stream end', async () => {
      const { reader } = createMockReader(['{"last":true}']);
      const events = await collectJSONEvents(reader);

      expect(events).toEqual([{ last: true }]);
    });

    it('respects abort signal and releases reader lock', async () => {
      const controller = new AbortController();
      controller.abort();

      const { reader, read, releaseLock } = createMockReader(['{"ignored":true}\n']);
      const events = await collectJSONEvents(reader, controller.signal);

      expect(events).toEqual([]);
      expect(read).not.toHaveBeenCalled();
      expect(releaseLock).toHaveBeenCalledTimes(1);
    });
  });
});
