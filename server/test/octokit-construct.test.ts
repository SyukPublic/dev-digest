/**
 * Issue #10-C smoke: constructing the OctokitGitHubClient with the hardened
 * options (`retry: { enabled: false }`, `throttle: { enabled: false }`, a custom
 * `request.fetch`) must NOT throw — `throttle.enabled: false` short-circuits the
 * plugin before it would demand onRateLimit/onSecondaryRateLimit handlers. This
 * is a construction-only smoke (no network).
 */
import { describe, it, expect } from 'vitest';
import { OctokitGitHubClient } from '../src/adapters/github/octokit.js';

describe('OctokitGitHubClient construction', () => {
  it('does not throw with retry/throttle disabled + custom fetch', () => {
    expect(() => new OctokitGitHubClient('ghp_faketoken')).not.toThrow();
  });
});
