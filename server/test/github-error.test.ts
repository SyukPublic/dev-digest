/**
 * Unit tests for `describeGithubError` (Issue #10-D — honest logging). The WARN
 * log must distinguish a missing token from a GitHub timeout from a generic
 * network/HTTP error, instead of always blaming "no token / offline".
 */
import { describe, it, expect } from 'vitest';
import { describeGithubError } from '../src/platform/github-error.js';
import { ConfigError } from '../src/platform/errors.js';
import { TimeoutError } from '../src/platform/resilience.js';

describe('describeGithubError', () => {
  it('reports a ConfigError as a missing token', () => {
    const out = describeGithubError(new ConfigError('GITHUB_TOKEN is not configured'));
    expect(out).toBe('no GitHub token configured');
  });

  it('reports a TimeoutError as a timeout (not "no token")', () => {
    const out = describeGithubError(new TimeoutError(10_000));
    expect(out).toContain('timed out');
    expect(out).not.toContain('no token');
  });

  it('reports a generic HTTP error with its status', () => {
    const out = describeGithubError({ name: 'HttpError', status: 502 });
    expect(out).toContain('failed');
    expect(out).toContain('status=502');
  });

  it('reports a network error with its code', () => {
    const err = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    const out = describeGithubError(err);
    expect(out).toContain('code=ECONNRESET');
  });

  it('appends rate-limit / retry-after diagnostics when present', () => {
    const err = {
      name: 'HttpError',
      status: 403,
      response: {
        status: 403,
        headers: {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': '1700000000',
          'retry-after': '60',
        },
      },
    };
    const out = describeGithubError(err);
    expect(out).toContain('ratelimit-remaining=0');
    expect(out).toContain('ratelimit-reset=1700000000');
    expect(out).toContain('retry-after=60');
  });

  it('does not throw on a non-error value', () => {
    expect(() => describeGithubError('weird')).not.toThrow();
    expect(describeGithubError(null)).toContain('failed');
  });
});
