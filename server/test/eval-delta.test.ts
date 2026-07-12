/**
 * Unit tests for the PURE skill-eval delta module (Phase 3, T10/T11/T15).
 *
 * `test_delta`       — findingsMatch (file EQ + range INTERSECT, severity/category
 *                      ignored → AC-10), computeDelta (grounded + dropped, AC-33),
 *                      classifyDelta (caught/noise/ignored → AC-30/AC-13).
 * `test_delta_empty` — empty-delta semantics fall out of the UNCHANGED scorer
 *                      (`poolSuite` over a zero-length delta): must_not_flag PASS,
 *                      must_find recall 0 / FAIL (AC-15).
 *
 * PURE: no DB, no LLM, no container.
 */
import { describe, it, expect } from 'vitest';
import type { Finding, EvalExpectedOutput } from '@devdigest/shared';
import { findingsMatch, computeDelta, classifyDelta, combineCost } from '../src/modules/eval/delta.js';
import { poolSuite, scoreCase, type CaseRunResult } from '../src/modules/eval/scoring.js';

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f-1',
    severity: 'medium',
    category: 'bug',
    title: 'a finding',
    file: 'a.ts',
    start_line: 10,
    end_line: 12,
    rationale: 'because',
    confidence: 0.9,
    ...overrides,
  } as Finding;
}

describe('findingsMatch — AC-10 (file EQ + range INTERSECT; severity/category ignored)', () => {
  it('matches on same file with intersecting ranges regardless of severity/category', () => {
    const a = finding({ file: 'a.ts', start_line: 10, end_line: 12, severity: 'high', category: 'security' });
    const b = finding({ file: 'a.ts', start_line: 12, end_line: 20, severity: 'low', category: 'style' });
    expect(findingsMatch(a, b)).toBe(true);
  });

  it('does NOT match a different file even with identical ranges', () => {
    expect(findingsMatch(finding({ file: 'a.ts' }), finding({ file: 'b.ts' }))).toBe(false);
  });

  it('does NOT match disjoint ranges on the same file', () => {
    const a = finding({ file: 'a.ts', start_line: 1, end_line: 3 });
    const b = finding({ file: 'a.ts', start_line: 10, end_line: 12 });
    expect(findingsMatch(a, b)).toBe(false);
  });

  it('matches when ranges touch at a single line (inclusive intersection)', () => {
    const a = finding({ file: 'a.ts', start_line: 1, end_line: 5 });
    const b = finding({ file: 'a.ts', start_line: 5, end_line: 9 });
    expect(findingsMatch(a, b)).toBe(true);
  });
});

describe('computeDelta — AC-33 (findings the skill CAUSED + dropped count)', () => {
  it('keeps WITH findings that match NO WITHOUT finding; drops matched ones', () => {
    const shared = finding({ id: 'shared', file: 'a.ts', start_line: 10, end_line: 12 });
    const caused = finding({ id: 'caused', file: 'b.ts', start_line: 1, end_line: 2 });
    const delta = computeDelta(
      { findings: [shared, caused], dropped: [] },
      { findings: [finding({ id: 'baseline', file: 'a.ts', start_line: 11, end_line: 13 })], dropped: [] },
    );
    expect(delta.findings.map((f) => f.id)).toEqual(['caused']);
    expect(delta.dropped).toBe(0);
  });

  it('counts WITH-arm dropped findings that match NO WITHOUT-arm dropped finding', () => {
    const droppedShared = finding({ id: 'ds', file: 'a.ts', start_line: 1, end_line: 2 });
    const droppedNew = finding({ id: 'dn', file: 'c.ts', start_line: 5, end_line: 6 });
    const delta = computeDelta(
      { findings: [], dropped: [droppedShared, droppedNew] },
      { findings: [], dropped: [finding({ id: 'db', file: 'a.ts', start_line: 1, end_line: 2 })] },
    );
    expect(delta.findings).toEqual([]);
    expect(delta.dropped).toBe(1);
  });

  it('is empty when WITH and WITHOUT produce the same findings (skill added nothing)', () => {
    const f = finding({ file: 'a.ts', start_line: 10, end_line: 12 });
    const delta = computeDelta({ findings: [f], dropped: [] }, { findings: [f], dropped: [] });
    expect(delta.findings).toEqual([]);
    expect(delta.dropped).toBe(0);
  });
});

describe('classifyDelta — AC-30/AC-13 (caught | noise | ignored)', () => {
  it('caught: must_find case, finding matches an expectation', () => {
    const expected: EvalExpectedOutput = {
      expectation: 'must_find',
      findings: [{ file: 'a.ts', start_line: 10, end_line: 12 }],
    };
    expect(classifyDelta(finding({ file: 'a.ts', start_line: 11, end_line: 11 }), expected)).toBe('caught');
  });

  it('ignored: must_find case, finding matches NO expectation (never noise)', () => {
    const expected: EvalExpectedOutput = {
      expectation: 'must_find',
      findings: [{ file: 'a.ts', start_line: 10, end_line: 12 }],
    };
    expect(classifyDelta(finding({ file: 'z.ts', start_line: 1, end_line: 1 }), expected)).toBe('ignored');
  });

  it('noise: must_not_flag clean fixture (empty findings[]) → ANY finding is noise', () => {
    const expected: EvalExpectedOutput = { expectation: 'must_not_flag', findings: [] };
    expect(classifyDelta(finding({ file: 'anywhere.ts', start_line: 1, end_line: 1 }), expected)).toBe('noise');
  });

  it('noise: must_not_flag, finding intersects a must_not_flag region', () => {
    const expected: EvalExpectedOutput = {
      expectation: 'must_not_flag',
      findings: [{ file: 'a.ts', start_line: 10, end_line: 12 }],
    };
    expect(classifyDelta(finding({ file: 'a.ts', start_line: 12, end_line: 14 }), expected)).toBe('noise');
  });

  it('ignored: must_not_flag, finding OUTSIDE every must_not_flag region', () => {
    const expected: EvalExpectedOutput = {
      expectation: 'must_not_flag',
      findings: [{ file: 'a.ts', start_line: 10, end_line: 12 }],
    };
    expect(classifyDelta(finding({ file: 'a.ts', start_line: 100, end_line: 101 }), expected)).toBe('ignored');
  });
});

describe('combineCost — AC-18 (unknown never treated as 0)', () => {
  it('sums two known costs', () => {
    expect(combineCost(0.01, 0.02)).toBeCloseTo(0.03);
  });
  it('is null when either arm is null', () => {
    expect(combineCost(null, 0.02)).toBeNull();
    expect(combineCost(0.01, null)).toBeNull();
    expect(combineCost(null, null)).toBeNull();
  });
});

describe('test_delta_empty — empty delta via the UNCHANGED scorer (AC-15)', () => {
  it('must_not_flag with an EMPTY delta PASSES (no findings → no noise)', () => {
    const result: CaseRunResult = {
      expected: { expectation: 'must_not_flag', findings: [] },
      findings: [],
      dropped: 0,
      costUsd: null,
    };
    const score = scoreCase(result);
    expect(score.pass).toBe(true);
    // No findings → precision denominator 0 → null (never a vacuous 100%).
    expect(score.precision).toBeNull();

    const pooled = poolSuite([result]);
    expect(pooled.passed).toBe(1);
    expect(pooled.total).toBe(1);
    expect(pooled.precision).toBeNull();
  });

  it('must_find with an EMPTY delta FAILS with recall 0 (the skill found nothing)', () => {
    const result: CaseRunResult = {
      expected: {
        expectation: 'must_find',
        findings: [{ file: 'a.ts', start_line: 10, end_line: 12 }],
      },
      findings: [],
      dropped: 0,
      costUsd: null,
    };
    const score = scoreCase(result);
    expect(score.pass).toBe(false);
    expect(score.recall).toBe(0);

    const pooled = poolSuite([result]);
    expect(pooled.recall).toBe(0);
    expect(pooled.passed).toBe(0);
    expect(pooled.total).toBe(1);
  });
});
