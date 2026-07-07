import { describe, expect, it } from 'vitest';
import {
  Brief,
  BriefInputBundle,
  FEATURE_MODELS,
  FeatureModelId,
  ReviewFocusItem,
  WhyRiskBriefRecord,
} from '@devdigest/shared';

// A valid Risk (reused unchanged from ./brief.js) — the line-range lives inside
// the file_refs string.
const validRisk = {
  kind: 'security',
  title: 'Rate limit bypass',
  explanation: 'The new middleware short-circuits the limiter for authed users.',
  severity: 'high' as const,
  file_refs: ['src/mw/ratelimit.ts:12-18'],
};

const validBrief = {
  what: 'Adds a per-user rate limiter to the auth routes.',
  why: 'Mitigates brute-force login attempts flagged in the linked issue.',
  risk_level: 'medium' as const,
  risks: [validRisk],
  review_focus: [
    { path: 'src/mw/ratelimit.ts', line: 12, reason: 'Core limiter logic — read first.' },
    { path: 'src/routes/auth.ts', line: null, reason: 'Wiring; skim for the limiter hook.' },
  ],
};

describe('T1 — Brief + ReviewFocusItem contract', () => {
  it('parses a valid brief (risks reuse Risk, ordered review_focus, risk_level ∈ high|medium|low)', () => {
    const parsed = Brief.parse(validBrief);
    expect(parsed.risk_level).toBe('medium');
    // risks reuse the Risk shape verbatim
    expect(parsed.risks[0]?.file_refs).toEqual(['src/mw/ratelimit.ts:12-18']);
    // review_focus order is preserved (ordered list — read these first)
    expect(parsed.review_focus.map((f) => f.path)).toEqual([
      'src/mw/ratelimit.ts',
      'src/routes/auth.ts',
    ]);
  });

  it('accepts each risk_level value high|medium|low', () => {
    for (const level of ['high', 'medium', 'low'] as const) {
      expect(Brief.parse({ ...validBrief, risk_level: level }).risk_level).toBe(level);
    }
  });

  it('rejects a bad risk_level (e.g. critical)', () => {
    const bad = Brief.safeParse({ ...validBrief, risk_level: 'critical' });
    expect(bad.success).toBe(false);
  });

  it('ReviewFocusItem allows a nullish line (whole-file focus) and requires path + reason', () => {
    expect(ReviewFocusItem.safeParse({ path: 'a.ts', reason: 'x' }).success).toBe(true);
    expect(ReviewFocusItem.safeParse({ path: 'a.ts', line: null, reason: 'x' }).success).toBe(true);
    expect(ReviewFocusItem.safeParse({ path: 'a.ts', line: 5, reason: 'x' }).success).toBe(true);
    expect(ReviewFocusItem.safeParse({ line: 5, reason: 'x' }).success).toBe(false);
  });
});

describe('T2 — BriefInputBundle + WhyRiskBriefRecord contract', () => {
  const fullBundle = {
    intent: 'Add a per-user rate limiter.',
    blast_summary: '2 files changed, 3 downstream callers.',
    blast_files: [
      { path: 'src/mw/ratelimit.ts', callers: ['src/routes/auth.ts'], endpoints: ['POST /login'] },
    ],
    smart_diff_groups: [
      {
        role: 'core',
        files: [{ path: 'src/mw/ratelimit.ts', additions: 40, deletions: 2, finding_count: 1 }],
      },
    ],
    linked_issue: { number: 42, title: 'Brute-force logins', body: 'We see spikes.' },
    specs: [{ path: 'docs/specs/auth.md', content: '# Auth spec' }],
  };

  it('parses a FULL bundle', () => {
    const parsed = BriefInputBundle.parse(fullBundle);
    expect(parsed.blast_files[0]?.callers).toEqual(['src/routes/auth.ts']);
    expect(parsed.smart_diff_groups[0]?.files[0]?.finding_count).toBe(1);
    expect(parsed.linked_issue?.number).toBe(42);
  });

  it('parses a DEGRADED bundle (intent/issue/specs absent, no callers/endpoints)', () => {
    const degraded = {
      blast_files: [{ path: 'src/mw/ratelimit.ts' }],
      smart_diff_groups: [],
      specs: [],
    };
    const parsed = BriefInputBundle.parse(degraded);
    expect(parsed.intent).toBeUndefined();
    expect(parsed.blast_summary).toBeUndefined();
    expect(parsed.linked_issue).toBeUndefined();
    expect(parsed.blast_files[0]?.path).toBe('src/mw/ratelimit.ts');
    expect(parsed.specs).toEqual([]);
  });

  it('WhyRiskBriefRecord parses a stored record (Brief + pr_id + generated_at + is_stale)', () => {
    const record = {
      ...validBrief,
      pr_id: 'pr-uuid',
      generated_at: '2026-07-05T00:00:00.000Z',
      is_stale: true,
    };
    const parsed = WhyRiskBriefRecord.parse(record);
    expect(parsed.pr_id).toBe('pr-uuid');
    expect(parsed.is_stale).toBe(true);
    expect(parsed.risks[0]?.title).toBe('Rate limit bypass');
  });

  it('WhyRiskBriefRecord parses a LEGACY record with no is_stale (treated not-stale)', () => {
    const legacy = { ...validBrief, pr_id: 'pr-uuid', generated_at: '2026-07-05T00:00:00.000Z' };
    const parsed = WhyRiskBriefRecord.parse(legacy);
    expect(parsed.is_stale).toBeUndefined();
  });

  // ── 2026-07-06 delta: nullish line-data fields on the bundle (T30, AC-23) ──

  it('BriefBlastFile parses with caller_lines + changed_ranges PRESENT', () => {
    const withLineData = BriefInputBundle.parse({
      ...fullBundle,
      blast_files: [
        {
          path: 'src/mw/ratelimit.ts',
          callers: ['src/routes/auth.ts'],
          endpoints: ['POST /login'],
          caller_lines: [12, 40],
          changed_ranges: [{ start: 12, end: 18 }],
        },
      ],
    });
    const f = withLineData.blast_files[0];
    expect(f?.caller_lines).toEqual([12, 40]);
    expect(f?.changed_ranges).toEqual([{ start: 12, end: 18 }]);
  });

  it('BriefBlastFile parses with caller_lines + changed_ranges ABSENT (nullish)', () => {
    const parsed = BriefInputBundle.parse({
      ...fullBundle,
      blast_files: [{ path: 'src/mw/ratelimit.ts' }],
    });
    const f = parsed.blast_files[0];
    expect(f?.caller_lines).toBeUndefined();
    expect(f?.changed_ranges).toBeUndefined();
    // explicit null is accepted too (nullish)
    const withNull = BriefInputBundle.parse({
      ...fullBundle,
      blast_files: [{ path: 'src/mw/ratelimit.ts', caller_lines: null, changed_ranges: null }],
    });
    expect(withNull.blast_files[0]?.caller_lines).toBeNull();
    expect(withNull.blast_files[0]?.changed_ranges).toBeNull();
  });

  it('BriefSmartDiffFile parses with finding_lines PRESENT and ABSENT (count stays)', () => {
    const withLines = BriefInputBundle.parse({
      ...fullBundle,
      smart_diff_groups: [
        {
          role: 'core',
          files: [
            {
              path: 'src/mw/ratelimit.ts',
              additions: 40,
              deletions: 2,
              finding_count: 2,
              finding_lines: [10, 11],
            },
          ],
        },
      ],
    });
    const withLinesFile = withLines.smart_diff_groups[0]?.files[0];
    expect(withLinesFile?.finding_lines).toEqual([10, 11]);
    expect(withLinesFile?.finding_count).toBe(2);

    // absent finding_lines still parses (nullish); the count field is unchanged
    const absent = BriefInputBundle.parse(fullBundle);
    expect(absent.smart_diff_groups[0]?.files[0]?.finding_lines).toBeUndefined();
    expect(absent.smart_diff_groups[0]?.files[0]?.finding_count).toBe(1);
  });

  it('rejects a non-integer changed_range boundary (line NUMBERS only, AC-1)', () => {
    const bad = BriefInputBundle.safeParse({
      ...fullBundle,
      blast_files: [
        { path: 'src/mw/ratelimit.ts', changed_ranges: [{ start: '12', end: 18 }] },
      ],
    });
    expect(bad.success).toBe(false);
  });
});

describe('T3 — FeatureModelId why_risk_brief slot', () => {
  it('FeatureModelId gains the why_risk_brief value (and keeps the legacy risk_brief)', () => {
    expect(FeatureModelId.safeParse('why_risk_brief').success).toBe(true);
    expect(FeatureModelId.safeParse('risk_brief').success).toBe(true);
  });

  it('FEATURE_MODELS has a why_risk_brief entry with a sensible default', () => {
    const def = FEATURE_MODELS.find((f) => f.id === 'why_risk_brief');
    expect(def).toBeDefined();
    expect(def?.label).toBe('Why+Risk Brief');
    expect(def?.defaultProvider.length).toBeGreaterThan(0);
    expect(def?.defaultModel.length).toBeGreaterThan(0);
  });
});
