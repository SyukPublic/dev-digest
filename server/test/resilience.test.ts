/**
 * Unit tests for the resilience primitives (Issue #10-B). A `TimeoutError` is
 * NOT globally retryable (so heavy LLM/job paths keep their no-retry default);
 * the GitHub adapter opts in LOCALLY via `octokit.ts call()` — a short timeout +
 * one fresh retry, worst case ~2×TIMEOUT. These tests pin both: the default
 * predicate leaves TimeoutError alone, and the adapter's local predicate retries
 * it exactly once.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  withRetry,
  withTimeout,
  TimeoutError,
  defaultIsRetryable,
} from '../src/platform/resilience.js';

describe('defaultIsRetryable', () => {
  it('does NOT treat a TimeoutError as retryable (timeout-retry is per call-site)', () => {
    expect(defaultIsRetryable(new TimeoutError(10_000))).toBe(false);
  });

  it('keeps 429 / 5xx and network codes retryable', () => {
    expect(defaultIsRetryable({ status: 429 })).toBe(true);
    expect(defaultIsRetryable({ status: 503 })).toBe(true);
    expect(defaultIsRetryable({ response: { status: 500 } })).toBe(true);
    expect(defaultIsRetryable({ code: 'ECONNRESET' })).toBe(true);
    expect(defaultIsRetryable({ code: 'ETIMEDOUT' })).toBe(true);
  });

  it('does NOT retry a 4xx (other than 429) or an unknown error', () => {
    expect(defaultIsRetryable({ status: 404 })).toBe(false);
    expect(defaultIsRetryable({ status: 422 })).toBe(false);
    expect(defaultIsRetryable(new Error('boom'))).toBe(false);
  });
});

describe('withRetry + the default predicate (LLM / job paths)', () => {
  it('does NOT re-run a timed-out operation — a slow run is not multiplied', async () => {
    const fn = vi.fn(async () => {
      throw new TimeoutError(10);
    });
    // No isRetryable override → defaultIsRetryable → TimeoutError is terminal.
    await expect(withRetry(fn, { retries: 3, baseDelayMs: 0 })).rejects.toBeInstanceOf(TimeoutError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('still retries a transient 5xx with the default predicate', async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts < 3) throw { status: 503 };
      return 'ok';
    });
    const result = await withRetry(fn, { retries: 3, baseDelayMs: 0, maxDelayMs: 0 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('the GitHub-path local predicate (octokit.ts call)', () => {
  // The exact predicate the adapter composes: TimeoutError retryable HERE only.
  const githubIsRetryable = (e: unknown) => e instanceof TimeoutError || defaultIsRetryable(e);

  it('retries a timed-out attempt and recovers on the fresh one', async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts === 1) throw new TimeoutError(10);
      return 'ok';
    });

    const result = await withRetry(fn, {
      retries: 1,
      baseDelayMs: 0,
      maxDelayMs: 0,
      isRetryable: githubIsRetryable,
    });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries a persistent timeout EXACTLY once — worst case is 2 attempts (~2×TIMEOUT)', async () => {
    const fn = vi.fn(async () => {
      throw new TimeoutError(10);
    });

    await expect(
      withRetry(fn, { retries: 1, baseDelayMs: 0, maxDelayMs: 0, isRetryable: githubIsRetryable }),
    ).rejects.toBeInstanceOf(TimeoutError);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('withTimeout', () => {
  it('rejects with a TimeoutError when the deadline passes', async () => {
    const never = new Promise<string>(() => {});
    await expect(withTimeout(never, 5)).rejects.toBeInstanceOf(TimeoutError);
  });

  it('resolves the underlying promise when it beats the deadline', async () => {
    await expect(withTimeout(Promise.resolve('fast'), 1000)).resolves.toBe('fast');
  });
});
