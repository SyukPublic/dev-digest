/**
 * Phase 4 (T10) — real-path grounding unit tests (CP-5, AC-4/5).
 *
 * Pure — no DB/IO. Proves an invented `risks[].file_refs` entry or
 * `review_focus[].path` (a path NOT in the assembled input file set) is
 * dropped/repaired while the rest of the brief is kept; a fabricated path is
 * never carried through; and a risk whose refs all drop is still retained
 * (title/explanation), just unlinked.
 */

import { describe, it, expect } from 'vitest';
import type { Brief, BriefInputBundle } from '@devdigest/shared';
import { groundBrief, realPathSet, pathOfRef } from '../src/modules/brief/grounding.js';

/** A bundle whose REAL paths come from blast_files ∪ smart_diff_groups. */
const BUNDLE: BriefInputBundle = {
  intent: null,
  blast_summary: null,
  blast_files: [
    { path: 'src/config.ts', callers: null, endpoints: null },
    { path: 'src/handler.ts', callers: null, endpoints: null },
  ],
  smart_diff_groups: [
    { role: 'core', files: [{ path: 'src/service.ts', additions: 1, deletions: 0, finding_count: 0 }] },
  ],
  linked_issue: null,
  specs: [],
};

function briefWith(overrides: Partial<Brief>): Brief {
  return {
    what: 'w',
    why: 'y',
    risk_level: 'medium',
    risks: [],
    review_focus: [],
    ...overrides,
  };
}

describe('realPathSet', () => {
  it('unions blast_files + smart_diff_groups file paths', () => {
    expect([...realPathSet(BUNDLE)].sort()).toEqual([
      'src/config.ts',
      'src/handler.ts',
      'src/service.ts',
    ]);
  });
});

describe('pathOfRef', () => {
  it('strips a trailing line-range suffix', () => {
    expect(pathOfRef('src/config.ts:12-18')).toBe('src/config.ts');
    expect(pathOfRef('src/config.ts:12')).toBe('src/config.ts');
    expect(pathOfRef('src/config.ts')).toBe('src/config.ts');
  });
});

describe('groundBrief', () => {
  it('drops an invented file_ref but keeps real ones (repair)', () => {
    const brief = briefWith({
      risks: [
        {
          kind: 'perf',
          title: 'N+1 query',
          explanation: 'loop over rows',
          severity: 'high',
          file_refs: ['src/service.ts:10-20', 'src/INVENTED.ts:5', 'src/config.ts'],
        },
      ],
    });
    const grounded = groundBrief(brief, BUNDLE);
    expect(grounded.risks[0]!.file_refs).toEqual(['src/service.ts:10-20', 'src/config.ts']);
  });

  it('keeps a risk whose refs ALL drop, but unlinked (AC-5)', () => {
    const brief = briefWith({
      risks: [
        {
          kind: 'auth',
          title: 'Missing check',
          explanation: 'no guard',
          severity: 'high',
          file_refs: ['src/GHOST.ts:1', 'nowhere/x.ts'],
        },
      ],
    });
    const grounded = groundBrief(brief, BUNDLE);
    expect(grounded.risks).toHaveLength(1);
    expect(grounded.risks[0]!.title).toBe('Missing check');
    expect(grounded.risks[0]!.file_refs).toEqual([]);
  });

  it('drops a review_focus item whose path is invented', () => {
    const brief = briefWith({
      review_focus: [
        { path: 'src/handler.ts', line: 3, reason: 'entry point' },
        { path: 'src/FAKE.ts', line: null, reason: 'invented' },
      ],
    });
    const grounded = groundBrief(brief, BUNDLE);
    expect(grounded.review_focus).toEqual([
      { path: 'src/handler.ts', line: 3, reason: 'entry point' },
    ]);
  });

  it('keeps the non-path fields (what/why/risk_level) untouched', () => {
    const brief = briefWith({ what: 'refactor X', why: 'because Y', risk_level: 'low' });
    const grounded = groundBrief(brief, BUNDLE);
    expect(grounded.what).toBe('refactor X');
    expect(grounded.why).toBe('because Y');
    expect(grounded.risk_level).toBe('low');
  });

  it('drops everything when the bundle has no real paths (all fabricated)', () => {
    const emptyBundle: BriefInputBundle = { ...BUNDLE, blast_files: [], smart_diff_groups: [] };
    const brief = briefWith({
      risks: [
        { kind: 'x', title: 't', explanation: 'e', severity: 'low', file_refs: ['src/service.ts'] },
      ],
      review_focus: [{ path: 'src/service.ts', line: null, reason: 'r' }],
    });
    const grounded = groundBrief(brief, emptyBundle);
    expect(grounded.risks[0]!.file_refs).toEqual([]);
    expect(grounded.review_focus).toEqual([]);
  });
});
