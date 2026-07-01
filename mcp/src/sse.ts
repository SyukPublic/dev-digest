/**
 * Minimal, pure SSE (Server-Sent Events) frame parser.
 *
 * The DevDigest run-event stream (`GET /runs/:id/events`) emits frames in the
 * fastify-sse-v2 shape:
 *
 *   id: <seq>
 *   event: <kind>            # info | tool | result | error
 *   data: <JSON RunEvent>
 *                            # blank line terminates the frame
 *
 * D3 — there is NO terminal `done` data event: the server signals completion by
 * CLOSING the connection. So this parser deliberately does NOT look for a
 * sentinel; the API client treats end-of-stream as completion and uses these
 * frames only to surface the last `result`/`error`. Keeping the byte-level
 * parsing here (no I/O) makes it unit-testable in isolation.
 *
 * Per the SSE spec, fields may repeat (multi-line `data:`), a leading space
 * after the colon is stripped, lines starting with `:` are comments, and `\r\n`
 * / `\n` / `\r` all delimit lines. A frame is a run of field lines terminated by
 * a blank line.
 */

/** One parsed SSE frame. `data` is the concatenated `data:` field(s) verbatim. */
export interface SseFrame {
  readonly event?: string;
  readonly data: string;
  readonly id?: string;
}

/**
 * Parses all COMPLETE frames (those terminated by a blank line) from `buffer`,
 * returning them plus the unconsumed remainder (a partial frame still arriving).
 * Pure — caller accumulates `rest` and re-feeds it as more bytes arrive.
 */
export function parseSseFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  const frames: SseFrame[] = [];
  // Normalize CRLF / CR to LF so frame splitting is uniform.
  const normalized = buffer.replace(/\r\n|\r/g, '\n');

  // A blank line ("\n\n") terminates a frame. Split on it; the last chunk is the
  // (possibly incomplete) remainder, kept for the next read.
  const chunks = normalized.split('\n\n');
  const rest = chunks.pop() ?? '';

  for (const chunk of chunks) {
    if (chunk.trim() === '') continue; // stray blank separators
    const frame = parseFrame(chunk);
    if (frame) frames.push(frame);
  }

  return { frames, rest };
}

/** Parses a single frame chunk (its field lines, no trailing blank line). */
function parseFrame(chunk: string): SseFrame | null {
  let event: string | undefined;
  let id: string | undefined;
  const dataLines: string[] = [];

  for (const rawLine of chunk.split('\n')) {
    if (rawLine === '' || rawLine.startsWith(':')) continue; // blank / comment
    const colon = rawLine.indexOf(':');
    const field = colon === -1 ? rawLine : rawLine.slice(0, colon);
    let value = colon === -1 ? '' : rawLine.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1); // strip one leading space

    switch (field) {
      case 'event':
        event = value;
        break;
      case 'id':
        id = value;
        break;
      case 'data':
        dataLines.push(value);
        break;
      default:
        break; // ignore unknown fields (e.g. `retry`)
    }
  }

  if (dataLines.length === 0 && event === undefined && id === undefined) return null;
  return {
    ...(event !== undefined ? { event } : {}),
    ...(id !== undefined ? { id } : {}),
    data: dataLines.join('\n'),
  };
}
