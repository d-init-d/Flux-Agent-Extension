/**
 * @module ai-client/streaming
 * @description SSE and newline-delimited JSON stream parsers.
 *
 * Handles all the gnarly edge cases of Server-Sent Events:
 * - Partial UTF-8 chunks split across reads
 * - Multi-line `data:` fields
 * - Empty lines as event boundaries
 * - [DONE] sentinel used by OpenAI-compatible APIs
 * - Comment lines (`:` prefix)
 * - Graceful abort via AbortSignal
 *
 * Also provides a NDJSON parser for Ollama-style providers that stream
 * newline-delimited JSON objects instead of SSE.
 */

import type { SSEEvent } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Sentinel value indicating the stream has ended (OpenAI/OpenRouter). */
const DONE_SENTINEL = '[DONE]';

/** TextDecoder instance reused across calls — it's stateless for utf-8. */
const decoder = new TextDecoder('utf-8');

// ---------------------------------------------------------------------------
// SSE Stream Parser
// ---------------------------------------------------------------------------

/**
 * Parse a ReadableStream of raw bytes into an async iterable of SSE events.
 *
 * The parser follows the W3C SSE specification:
 * - Lines starting with `:` are comments (ignored).
 * - Blank lines dispatch the current event.
 * - `data:` fields accumulate (joined with `\n` for multi-line).
 * - `event:`, `id:`, `retry:` fields are captured.
 * - The `[DONE]` sentinel terminates the stream cleanly.
 *
 * @param reader  - A ReadableStreamDefaultReader obtained from `response.body.getReader()`
 * @param signal  - Optional AbortSignal to cancel mid-stream
 * @yields Parsed SSEEvent objects
 */
export async function* parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SSEEvent, void, unknown> {
  // Buffer for incomplete lines across chunk boundaries
  let buffer = '';

  // Accumulator for the current event being built
  let currentEvent: Partial<SSEEvent> & { dataLines: string[] } = {
    dataLines: [],
  };

  try {
    while (true) {
      // Respect abort signal
      if (signal?.aborted) {
        return;
      }

      const { done, value } = await reader.read();

      if (done) {
        // Flush any remaining buffered event
        const flushed = flushEvent(currentEvent);
        if (flushed) {
          yield flushed;
        }
        return;
      }

      // Decode the chunk (allow partial multi-byte chars via `stream: true`
      // would require a stateful decoder; for simplicity we concatenate and
      // rely on the buffer to handle splits at line boundaries)
      buffer += decoder.decode(value, { stream: true });

      // Process complete lines from the buffer
      const lines = buffer.split('\n');

      // The last element may be an incomplete line — keep it in the buffer
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        // Respect abort signal between lines
        if (signal?.aborted) {
          return;
        }

        // Strip trailing \r (for \r\n line endings)
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

        // Empty line = event boundary
        if (line === '') {
          const flushed = flushEvent(currentEvent);
          if (flushed) {
            // Check for [DONE] sentinel
            if (flushed.data === DONE_SENTINEL) {
              return;
            }
            yield flushed;
          }
          // Reset accumulator
          currentEvent = { dataLines: [] };
          continue;
        }

        // Comment line — ignore
        if (line.startsWith(':')) {
          continue;
        }

        // Parse field: value
        const colonIndex = line.indexOf(':');

        let field: string;
        let value_str: string;

        if (colonIndex === -1) {
          // Field with no value (treat value as empty string per spec)
          field = line;
          value_str = '';
        } else {
          field = line.slice(0, colonIndex);
          // If there's a space after the colon, skip it (per spec)
          const afterColon = line.slice(colonIndex + 1);
          value_str = afterColon.startsWith(' ') ? afterColon.slice(1) : afterColon;
        }

        switch (field) {
          case 'data':
            currentEvent.dataLines.push(value_str);
            break;
          case 'event':
            currentEvent.event = value_str;
            break;
          case 'id':
            currentEvent.id = value_str;
            break;
          case 'retry': {
            const retryMs = parseInt(value_str, 10);
            if (!Number.isNaN(retryMs)) {
              currentEvent.retry = retryMs;
            }
            break;
          }
          // Unknown fields are ignored per the SSE spec
        }
      }
    }
  } finally {
    // Always release the reader lock
    try {
      reader.releaseLock();
    } catch {
      // Reader may already be released if the stream was cancelled externally
    }
  }
}

/**
 * Flush the current event accumulator into a complete SSEEvent.
 * Returns null if there's no data to flush.
 */
function flushEvent(current: Partial<SSEEvent> & { dataLines: string[] }): SSEEvent | null {
  // An event with no data lines is not dispatched (per SSE spec)
  if (current.dataLines.length === 0) {
    return null;
  }

  const event: SSEEvent = {
    data: current.dataLines.join('\n'),
  };

  if (current.event !== undefined) {
    event.event = current.event;
  }
  if (current.id !== undefined) {
    event.id = current.id;
  }
  if (current.retry !== undefined) {
    event.retry = current.retry;
  }

  return event;
}

// ---------------------------------------------------------------------------
// Newline-Delimited JSON Stream Parser (NDJSON)
// ---------------------------------------------------------------------------

/**
 * Parse a ReadableStream of newline-delimited JSON objects.
 *
 * Used by providers like Ollama that don't follow the SSE protocol but
 * instead send one JSON object per line.
 *
 * @param reader  - A ReadableStreamDefaultReader obtained from `response.body.getReader()`
 * @param signal  - Optional AbortSignal to cancel mid-stream
 * @yields Parsed JSON objects (type `unknown` — callers must validate)
 */
export async function* parseJSONStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<unknown, void, unknown> {
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) {
        return;
      }

      const { done, value } = await reader.read();

      if (done) {
        // Try to parse any remaining buffer content
        const trimmed = buffer.trim();
        if (trimmed.length > 0) {
          yield parseJSONSafe(trimmed);
        }
        return;
      }

      buffer += decoder.decode(value, { stream: true });

      // Split on newlines and process complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        if (signal?.aborted) {
          return;
        }

        const trimmed = rawLine.trim();
        if (trimmed.length === 0) {
          continue;
        }

        yield parseJSONSafe(trimmed);
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Reader may already be released
    }
  }
}

/**
 * Safely parse a JSON string, returning an error object on failure
 * instead of throwing.
 */
function parseJSONSafe(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Return a structured error that callers can detect
    return { __parseError: true, raw: text };
  }
}
