/**
 * Unit tests for the SSE frame parser (the highest-risk piece of the write tool,
 * per D3). Run with vitest once a test runner is wired into this package; the
 * assertions are framework-agnostic enough to also drive a tsx harness.
 */
import { describe, expect, it } from 'vitest';
import { parseSseFrames } from './sse.js';

describe('parseSseFrames', () => {
  it('parses a single complete frame', () => {
    const { frames, rest } = parseSseFrames('event: info\ndata: {"seq":1}\n\n');
    expect(frames).toEqual([{ event: 'info', data: '{"seq":1}' }]);
    expect(rest).toBe('');
  });

  it('parses multiple frames in one buffer', () => {
    const buf = 'id: 1\nevent: info\ndata: a\n\nid: 2\nevent: result\ndata: b\n\n';
    const { frames } = parseSseFrames(buf);
    expect(frames).toEqual([
      { id: '1', event: 'info', data: 'a' },
      { id: '2', event: 'result', data: 'b' },
    ]);
  });

  it('keeps an incomplete trailing frame as rest', () => {
    const { frames, rest } = parseSseFrames('event: info\ndata: a\n\nevent: result\ndata: b');
    expect(frames).toEqual([{ event: 'info', data: 'a' }]);
    expect(rest).toBe('event: result\ndata: b');
  });

  it('strips exactly one leading space after the colon', () => {
    const { frames } = parseSseFrames('data:  two-spaces\n\n');
    expect(frames[0]?.data).toBe(' two-spaces');
  });

  it('concatenates multi-line data fields with newlines', () => {
    const { frames } = parseSseFrames('data: line1\ndata: line2\n\n');
    expect(frames[0]?.data).toBe('line1\nline2');
  });

  it('normalizes CRLF line endings', () => {
    const { frames } = parseSseFrames('event: info\r\ndata: x\r\n\r\n');
    expect(frames).toEqual([{ event: 'info', data: 'x' }]);
  });

  it('ignores comment lines and unknown fields', () => {
    const { frames } = parseSseFrames(': keep-alive\nretry: 1000\nevent: tool\ndata: y\n\n');
    expect(frames).toEqual([{ event: 'tool', data: 'y' }]);
  });

  it('treats end-of-stream (no terminal done event) as the only completion signal', () => {
    // D3: the stream carries info/tool/result/error frames, never a `done`. The
    // last real frame before close is typically `result` or `error`.
    const buf = 'event: info\ndata: a\n\nevent: result\ndata: {"verdict":"approve"}\n\n';
    const { frames, rest } = parseSseFrames(buf);
    expect(rest).toBe('');
    expect(frames.at(-1)).toEqual({ event: 'result', data: '{"verdict":"approve"}' });
    // No frame is named `done` — completion is inferred from end-of-stream.
    expect(frames.some((f) => f.event === 'done')).toBe(false);
  });
});
