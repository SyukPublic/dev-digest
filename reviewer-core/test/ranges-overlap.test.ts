/**
 * Unit tests for `rangesOverlap` (reviewer-core/src/grounding.ts).
 *
 * rangesOverlap is a pure predicate: two inclusive integer ranges → boolean.
 * No stubs required. It generalizes the finding-vs-hunk `rangeIntersects` to a
 * finding-vs-finding overlap check used by the multi-agent conflict grouping.
 *
 * Formula: max(min(a), min(b)) <= min(max(a), max(b)).
 */

import { describe, it, expect } from 'vitest';
import { rangesOverlap } from '../src/grounding.js';

describe('rangesOverlap', () => {
  // Unit under test : rangesOverlap
  // Input           : identical single-line ranges [11,11] and [11,11]
  // Expected        : true (a point that coincides overlaps)
  it('is true for two identical points', () => {
    expect(rangesOverlap(11, 11, 11, 11)).toBe(true);
  });

  // Unit under test : rangesOverlap
  // Input           : distinct points [11,11] and [12,12]
  // Expected        : false (adjacent-but-disjoint points do not overlap)
  it('is false for two distinct points', () => {
    expect(rangesOverlap(11, 11, 12, 12)).toBe(false);
  });

  // Unit under test : rangesOverlap
  // Input           : partially overlapping ranges [10,14] and [12,20]
  // Expected        : true
  it('is true when ranges partially overlap', () => {
    expect(rangesOverlap(10, 14, 12, 20)).toBe(true);
  });

  // Unit under test : rangesOverlap
  // Input           : touching ranges that share exactly one endpoint [10,14] and [14,18]
  // Expected        : true (endpoints are inclusive)
  it('is true when ranges touch at exactly one endpoint', () => {
    expect(rangesOverlap(10, 14, 14, 18)).toBe(true);
  });

  // Unit under test : rangesOverlap
  // Input           : fully disjoint ranges [10,14] and [20,25]
  // Expected        : false
  it('is false when ranges are fully disjoint', () => {
    expect(rangesOverlap(10, 14, 20, 25)).toBe(false);
  });

  // Unit under test : rangesOverlap
  // Input           : one range fully contained in the other [12,13] within [10,20]
  // Expected        : true
  it('is true when one range fully contains the other', () => {
    expect(rangesOverlap(12, 13, 10, 20)).toBe(true);
    expect(rangesOverlap(10, 20, 12, 13)).toBe(true);
  });

  // Unit under test : rangesOverlap
  // Input           : endpoints given in reversed order [14,10] and [20,12]
  // Expected        : true — each pair is min/max-normalized, so order is irrelevant
  it('normalizes reversed endpoints (order-independent)', () => {
    expect(rangesOverlap(14, 10, 20, 12)).toBe(true);
    expect(rangesOverlap(14, 10, 25, 20)).toBe(false);
  });

  // Unit under test : rangesOverlap
  // Input           : commutativity — swapping the two ranges must not change the result
  // Expected        : identical result for (a,b) and (b,a)
  it('is commutative in its two ranges', () => {
    expect(rangesOverlap(10, 14, 13, 18)).toBe(rangesOverlap(13, 18, 10, 14));
    expect(rangesOverlap(10, 14, 20, 25)).toBe(rangesOverlap(20, 25, 10, 14));
  });
});
