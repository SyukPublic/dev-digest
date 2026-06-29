/**
 * Issue #10-C smoke: constructing the OctokitGitHubClient with the hardened
 * options (`retry: { enabled: false }`, `throttle: { enabled: false }`, a custom
 * `request.fetch`) must NOT throw — `throttle.enabled: false` short-circuits the
 * plugin before it would demand onRateLimit/onSecondaryRateLimit handlers. This
 * is a construction-only smoke (no network).
 */
import { describe, it, expect, vi } from 'vitest';
import { OctokitGitHubClient, timeoutNormalizingFetch } from '../src/adapters/github/octokit.js';
import {
  withRetry,
  withTimeout,
  TimeoutError,
  defaultIsRetryable,
} from '../src/platform/resilience.js';

describe('OctokitGitHubClient construction', () => {
  it('does not throw with retry/throttle disabled + custom fetch', () => {
    expect(() => new OctokitGitHubClient('ghp_faketoken')).not.toThrow();
  });
});

describe('timeoutNormalizingFetch (Fix #3 — fetch-level timeout normalization)', () => {
  // Mirror the GitHub adapter's per-call resilience seam exactly: a short
  // per-attempt timeout + ONE fresh retry, with the local TimeoutError-opt-in
  // predicate (NOT the global defaultIsRetryable, which stays timeout-agnostic).
  const call = <T>(fn: () => Promise<T>, timeoutMs: number) =>
    withRetry(() => withTimeout(fn(), timeoutMs), {
      retries: 1,
      isRetryable: (e) => e instanceof TimeoutError || defaultIsRetryable(e),
    });

  it('normalizes a real AbortSignal.timeout abort into our TimeoutError', async () => {
    // fetchImpl hangs until the injected AbortSignal.timeout fires, then rejects
    // exactly like undici does: a DOMException named 'TimeoutError' (NOT our
    // class). The wrapper must translate that into resilience.TimeoutError.
    const fetchImpl = (_url: string, opts?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener('abort', () =>
          reject(opts.signal!.reason ?? new DOMException('aborted', 'TimeoutError')),
        );
      });

    const wrapped = timeoutNormalizingFetch(fetchImpl, 10);
    await expect(wrapped('https://api.github.com/x')).rejects.toBeInstanceOf(TimeoutError);
  });

  it('makes the fetch-level timeout retryable: call() retries exactly once', async () => {
    // First attempt times out at the fetch level (→ our TimeoutError, retryable);
    // second attempt resolves. Worst-case = 2 attempts.
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockImplementationOnce(
        (_url, opts) =>
          new Promise((_res, reject) => {
            opts?.signal?.addEventListener('abort', () =>
              reject(opts.signal!.reason ?? new DOMException('aborted', 'TimeoutError')),
            );
          }),
      )
      .mockResolvedValueOnce({ ok: true } as Response);

    const wrapped = timeoutNormalizingFetch(fetchImpl, 10);
    const res = await call(() => wrapped('https://api.github.com/x'), 5_000);
    expect(res).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('passes a caller-supplied signal through and does NOT normalize its abort', async () => {
    // When the caller already owns a signal, the wrapper must not inject its own
    // timeout nor claim the abort as a timeout — a non-timeout abort surfaces as
    // the original error.
    const ac = new AbortController();
    const original = new Error('caller aborted');
    const fetchImpl = (_url: string, opts?: RequestInit): Promise<Response> =>
      new Promise((_res, reject) => {
        opts?.signal?.addEventListener('abort', () => reject(original));
      });

    const wrapped = timeoutNormalizingFetch(fetchImpl, 10);
    const p = wrapped('https://api.github.com/x', { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toBe(original);
  });

  it('passes successful responses through untouched', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue({ ok: true } as Response);
    const wrapped = timeoutNormalizingFetch(fetchImpl, 10);
    await expect(wrapped('https://api.github.com/x')).resolves.toEqual({ ok: true });
  });
});

type FetchLike = (url: string, opts?: RequestInit) => Promise<Response>;
