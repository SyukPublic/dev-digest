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
import {
  groundBrief,
  realPathSet,
  pathOfRef,
  rangeOfRef,
  realLineSet,
  changedHunkRange,
} from '../src/modules/brief/grounding.js';

/** A bundle whose REAL paths come from blast_files ∪ smart_diff_groups, and
 *  whose real line data (changed_ranges / caller_lines / finding_lines) is the
 *  range grounding authority (2026-07-06 delta). */
const BUNDLE: BriefInputBundle = {
  intent: null,
  blast_summary: null,
  blast_files: [
    // A file WITH changed-hunk ranges + caller lines (the repair authority).
    {
      path: 'src/config.ts',
      callers: null,
      endpoints: null,
      caller_lines: [30],
      changed_ranges: [{ start: 12, end: 18 }],
    },
    // A real file with NO line data at all (best-effort nullish → range dropped).
    { path: 'src/handler.ts', callers: null, endpoints: null },
  ],
  smart_diff_groups: [
    {
      role: 'core',
      files: [
        {
          path: 'src/service.ts',
          additions: 1,
          deletions: 0,
          finding_count: 1,
          finding_lines: [42],
        },
      ],
    },
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

describe('rangeOfRef', () => {
  it('parses :N-M and :N (single line ⇒ start===end)', () => {
    expect(rangeOfRef('src/config.ts:12-18')).toEqual({ start: 12, end: 18 });
    expect(rangeOfRef('src/config.ts:12')).toEqual({ start: 12, end: 12 });
  });
  it('returns null for a bare path or malformed range', () => {
    expect(rangeOfRef('src/config.ts')).toBeNull();
    expect(rangeOfRef('src/config.ts:0')).toBeNull();
    expect(rangeOfRef('src/config.ts:abc')).toBeNull();
  });
  it('normalises a reversed range', () => {
    expect(rangeOfRef('src/config.ts:18-12')).toEqual({ start: 12, end: 18 });
  });
});

describe('realLineSet / changedHunkRange', () => {
  it('realLineSet unions changed_ranges ∪ caller_lines ∪ finding_lines per path', () => {
    // src/config.ts: 12..18 (changed_ranges) ∪ 30 (caller_lines)
    expect([...realLineSet(BUNDLE, 'src/config.ts')].sort((a, b) => a - b)).toEqual([
      12, 13, 14, 15, 16, 17, 18, 30,
    ]);
    // src/service.ts: 42 (finding_lines)
    expect([...realLineSet(BUNDLE, 'src/service.ts')]).toEqual([42]);
    // src/handler.ts: no line data
    expect(realLineSet(BUNDLE, 'src/handler.ts').size).toBe(0);
  });
  it('changedHunkRange spans min-start / max-end over changed_ranges, else null', () => {
    expect(changedHunkRange(BUNDLE, 'src/config.ts')).toEqual({ start: 12, end: 18 });
    // finding_lines / caller_lines alone don't provide a changed-hunk repair range
    expect(changedHunkRange(BUNDLE, 'src/service.ts')).toBeNull();
    expect(changedHunkRange(BUNDLE, 'src/handler.ts')).toBeNull();
  });
});

describe('groundBrief — path+range (T33, AC-22/AC-24)', () => {
  it('keeps a range that intersects the file real changed-line set', () => {
    const brief = briefWith({
      risks: [
        {
          kind: 'security',
          title: 'r',
          explanation: 'e',
          severity: 'high',
          // 14-16 ⊂ 12..18 (intersects) → kept verbatim.
          file_refs: ['src/config.ts:14-16'],
        },
      ],
    });
    const grounded = groundBrief(brief, BUNDLE);
    expect(grounded.risks[0]!.file_refs).toEqual(['src/config.ts:14-16']);
  });

  it('repairs a missing / non-intersecting range to the changed-hunk range (never bare)', () => {
    const brief = briefWith({
      risks: [
        {
          kind: 'security',
          title: 'r',
          explanation: 'e',
          severity: 'high',
          file_refs: [
            'src/config.ts', // bare → repaired to 12-18
            'src/config.ts:99-120', // non-intersecting → repaired to 12-18
          ],
        },
      ],
    });
    const grounded = groundBrief(brief, BUNDLE);
    expect(grounded.risks[0]!.file_refs).toEqual([
      'src/config.ts:12-18',
      'src/config.ts:12-18',
    ]);
  });

  it('drops the range to a bare real path when the file has NO changed-hunk range (AC-24)', () => {
    const brief = briefWith({
      risks: [
        {
          kind: 'perf',
          title: 'r',
          explanation: 'e',
          severity: 'medium',
          // src/handler.ts is real but has no line data → range dropped, path kept.
          file_refs: ['src/handler.ts:5-9'],
        },
      ],
    });
    const grounded = groundBrief(brief, BUNDLE);
    expect(grounded.risks[0]!.file_refs).toEqual(['src/handler.ts']);
  });

  it('drops an invented path whole; keeps + grounds real ones (AC-5)', () => {
    const brief = briefWith({
      risks: [
        {
          kind: 'perf',
          title: 'N+1 query',
          explanation: 'loop over rows',
          severity: 'high',
          // service (finding_lines 42, no changed_ranges): 40-45 intersects 42 → kept.
          file_refs: ['src/service.ts:40-45', 'src/INVENTED.ts:5', 'src/config.ts'],
        },
      ],
    });
    const grounded = groundBrief(brief, BUNDLE);
    expect(grounded.risks[0]!.file_refs).toEqual(['src/service.ts:40-45', 'src/config.ts:12-18']);
  });

  it('service ref with a non-intersecting range degrades to bare path (no changed-hunk range)', () => {
    const brief = briefWith({
      risks: [
        {
          kind: 'perf',
          title: 'r',
          explanation: 'e',
          severity: 'low',
          // 10-20 does NOT include 42, and service has no changed_ranges → bare path.
          file_refs: ['src/service.ts:10-20'],
        },
      ],
    });
    const grounded = groundBrief(brief, BUNDLE);
    expect(grounded.risks[0]!.file_refs).toEqual(['src/service.ts']);
  });

  it('keeps a risk whose refs ALL drop (invented), but unlinked (AC-5)', () => {
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

  it('drops a review_focus item whose path is invented (path-only, unchanged)', () => {
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
        { kind: 'x', title: 't', explanation: 'e', severity: 'low', file_refs: ['src/service.ts:1-2'] },
      ],
      review_focus: [{ path: 'src/service.ts', line: null, reason: 'r' }],
    });
    const grounded = groundBrief(brief, emptyBundle);
    expect(grounded.risks[0]!.file_refs).toEqual([]);
    expect(grounded.review_focus).toEqual([]);
  });
});
