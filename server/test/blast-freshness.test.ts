import { describe, expect, it } from 'vitest';
import {
  deriveBlastFreshness,
  type BlastFreshnessParts,
} from '../src/modules/blast/freshness.js';

/**
 * Phase 1 (TD-003 Blast freshness) — unit table over the PURE `deriveBlastFreshness`
 * helper. No DB/IO. Asserts the D2 rules, their precedence (empty_map wins), and
 * the deliberate NON-triggers (SHA inequality / legacy branch / unreadable index).
 */
describe('deriveBlastFreshness', () => {
  // A "normal" PR: targets the indexed (default) branch, non-empty map, readable.
  const base: BlastFreshnessParts = {
    indexedBranch: 'main',
    indexedSha: 'abc123',
    prBase: 'main',
    prBranch: 'feature/x',
    prHeadSha: 'def456',
    downstreamCount: 3,
    indexReadable: true,
  };

  it('empty map on a readable index ⇒ empty_map', () => {
    expect(deriveBlastFreshness({ ...base, downstreamCount: 0 })).toEqual({
      is_stale: true,
      stale_reason: 'empty_map',
    });
  });

  it('non-empty map on a non-default-base PR ⇒ base_diverged', () => {
    expect(
      deriveBlastFreshness({ ...base, prBase: 'release/2.0', downstreamCount: 2 }),
    ).toEqual({ is_stale: true, stale_reason: 'base_diverged' });
  });

  it('PRECEDENCE: empty map on a non-default-base PR ⇒ empty_map wins over base_diverged', () => {
    expect(
      deriveBlastFreshness({ ...base, prBase: 'release/2.0', downstreamCount: 0 }),
    ).toEqual({ is_stale: true, stale_reason: 'empty_map' });
  });

  it('normal PR (base === indexedBranch, count > 0) ⇒ not stale', () => {
    expect(deriveBlastFreshness(base)).toEqual({ is_stale: false });
  });

  it('legacy row (indexedBranch undefined) + non-empty ⇒ not stale (base check skipped)', () => {
    expect(
      deriveBlastFreshness({
        ...base,
        indexedBranch: undefined,
        prBase: 'release/2.0',
        downstreamCount: 4,
      }),
    ).toEqual({ is_stale: false });
  });

  it('index unreadable ⇒ not stale even with an empty map (no false alarm)', () => {
    expect(
      deriveBlastFreshness({ ...base, indexReadable: false, downstreamCount: 0 }),
    ).toEqual({ is_stale: false });
  });

  it('indexedSha !== prHeadSha alone NEVER triggers stale', () => {
    // Distinct shas is the by-design permanent state — must not flag on its own.
    expect(
      deriveBlastFreshness({ ...base, indexedSha: 'sha-A', prHeadSha: 'sha-B' }),
    ).toEqual({ is_stale: false });
  });

  it('prBranch !== indexedBranch alone NEVER triggers stale (permanently true by design)', () => {
    expect(
      deriveBlastFreshness({ ...base, prBranch: 'anything', downstreamCount: 5 }),
    ).toEqual({ is_stale: false });
  });

  it('is deterministic — same input, same output', () => {
    const parts = { ...base, prBase: 'release/2.0', downstreamCount: 2 };
    expect(deriveBlastFreshness(parts)).toEqual(deriveBlastFreshness(parts));
  });
});
