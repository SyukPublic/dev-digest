import { describe, it, expect } from 'vitest';
import type { EvalSkillSuiteRunRow, EvalRunRow } from '../src/db/rows.js';
import {
  calcMetricStat,
  computeStabilitySummary,
  computeCaseStability,
  worstMetricDrop,
  noiseAwareAlert,
  type CompletedRunMetrics,
} from '../src/modules/eval/stability.js';

/**
 * Phase 3 (T10/T11/T12) — the PURE stability aggregator (no DB, no LLM; AC-11).
 * `test_stability_stats`  — calcMetricStat / computeStabilitySummary (AC-3/AC-4).
 * `test_case_stability`   — computeCaseStability flaky / non_discriminating (AC-5/AC-6).
 * `test_noise_alert`      — worstMetricDrop / noiseAwareAlert band wrapper (AC-7).
 */

function suiteRow(overrides: Partial<EvalSkillSuiteRunRow> = {}): EvalSkillSuiteRunRow {
  return {
    id: 'sr',
    workspaceId: 'w',
    skillId: 'sk',
    skillVersion: 1,
    hostAgentId: 'ag',
    hostAgentVersion: 1,
    status: 'done',
    recall: null,
    precision: null,
    citationAccuracy: null,
    passed: 0,
    total: 0,
    costUsd: null,
    durationMs: 0,
    stabilityGroupId: 'g1',
    ranAt: new Date(),
    ...overrides,
  } as EvalSkillSuiteRunRow;
}

function runRow(overrides: Partial<EvalRunRow> = {}): EvalRunRow {
  return {
    id: 'r',
    caseId: 'c1',
    suiteRunId: null,
    skillSuiteRunId: 'sr',
    ranAt: new Date(),
    actualOutput: null,
    pass: true,
    recall: null,
    precision: null,
    citationAccuracy: null,
    durationMs: 1,
    costUsd: null,
    error: null,
    ...overrides,
  } as EvalRunRow;
}

// ── T10 / test_stability_stats ────────────────────────────────────────────────

describe('calcMetricStat — sample stddev (n−1), indicative when n < 5 (AC-3/AC-4)', () => {
  it('is null for an empty sample (never a vacuous 0)', () => {
    expect(calcMetricStat([])).toBeNull();
  });

  it('a single sample → mean, stddev 0, n 1, indicative', () => {
    expect(calcMetricStat([0.8])).toEqual({ mean: 0.8, stddev: 0, n: 1, indicative: true });
  });

  it('uses the SAMPLE stddev (n−1 denominator)', () => {
    // values [0,2,4]: mean 2, sum sq dev = 8, /(n-1)=/2 = 4, sqrt = 2.
    const stat = calcMetricStat([0, 2, 4])!;
    expect(stat.mean).toBe(2);
    expect(stat.stddev).toBeCloseTo(2);
    expect(stat.n).toBe(3);
    expect(stat.indicative).toBe(true); // n < 5
  });

  it('n === STABILITY_MIN_N (5) is NOT indicative', () => {
    const stat = calcMetricStat([1, 1, 1, 1, 1])!;
    expect(stat.n).toBe(5);
    expect(stat.stddev).toBe(0);
    expect(stat.indicative).toBe(false);
  });
});

describe('computeStabilitySummary — null-metric rule + run counts (AC-3)', () => {
  it('collects ONLY non-null draws per metric; a metric with no draws is null', () => {
    const runs = [
      suiteRow({ status: 'done', recall: 1, precision: 0.5, citationAccuracy: null, costUsd: 0.01 }),
      suiteRow({ status: 'done', recall: 0.5, precision: null, citationAccuracy: null, costUsd: 0.03 }),
    ];
    const summary = computeStabilitySummary(runs);
    expect(summary.recall).toEqual(expect.objectContaining({ n: 2, mean: 0.75 }));
    // precision had only one non-null draw
    expect(summary.precision).toEqual(expect.objectContaining({ n: 1, mean: 0.5 }));
    // citation had zero draws → null (excluded)
    expect(summary.citation_accuracy).toBeNull();
    expect(summary.cost).toEqual(expect.objectContaining({ n: 2 }));
    expect(summary.runs_completed).toBe(2);
    expect(summary.runs_failed).toBe(0);
  });

  it('excludes failed runs from the metric samples but counts them in runs_failed', () => {
    const runs = [
      suiteRow({ status: 'done', recall: 1 }),
      suiteRow({ status: 'done', recall: 0.6 }),
      suiteRow({ status: 'failed', recall: null }),
    ];
    const summary = computeStabilitySummary(runs);
    expect(summary.recall).toEqual(expect.objectContaining({ n: 2 }));
    expect(summary.runs_completed).toBe(2);
    expect(summary.runs_failed).toBe(1);
  });
});

// ── T11 / test_case_stability ──────────────────────────────────────────────────

const delta = (n: number) => ({ findings: Array.from({ length: n }, () => ({ classification: 'caught' })) });

describe('computeCaseStability — strict flaky band + non_discriminating (AC-5/AC-6)', () => {
  it('flaky when the pass outcome is NOT unanimous (0 < pass_rate < 1)', () => {
    const rows = [
      runRow({ caseId: 'c1', pass: true, actualOutput: delta(1) }),
      runRow({ caseId: 'c1', pass: false, actualOutput: delta(1) }),
    ];
    const [c] = computeCaseStability(rows);
    expect(c!.case_id).toBe('c1');
    expect(c!.runs).toBe(2);
    expect(c!.pass_rate).toBe(0.5);
    expect(c!.flaky).toBe(true);
    expect(c!.non_discriminating).toBe(false); // it did produce a delta
  });

  it('a unanimous case (all pass or all fail) is NEVER flaky', () => {
    const allPass = computeCaseStability([
      runRow({ caseId: 'c1', pass: true, actualOutput: delta(1) }),
      runRow({ caseId: 'c1', pass: true, actualOutput: delta(1) }),
    ]);
    expect(allPass[0]!.pass_rate).toBe(1);
    expect(allPass[0]!.flaky).toBe(false);

    const allFail = computeCaseStability([
      runRow({ caseId: 'c2', pass: false, actualOutput: delta(1) }),
      runRow({ caseId: 'c2', pass: false, actualOutput: delta(1) }),
    ]);
    expect(allFail[0]!.pass_rate).toBe(0);
    expect(allFail[0]!.flaky).toBe(false);
  });

  it('non_discriminating when the delta is EMPTY in EVERY run of the case (AC-6)', () => {
    const rows = [
      runRow({ caseId: 'c1', pass: true, actualOutput: delta(0) }),
      runRow({ caseId: 'c1', pass: true, actualOutput: null }),
    ];
    const [c] = computeCaseStability(rows);
    expect(c!.non_discriminating).toBe(true);
  });

  it('NOT non_discriminating when ANY run of the case produced a delta finding', () => {
    const rows = [
      runRow({ caseId: 'c1', pass: true, actualOutput: delta(0) }),
      runRow({ caseId: 'c1', pass: true, actualOutput: delta(2) }),
    ];
    expect(computeCaseStability(rows)[0]!.non_discriminating).toBe(false);
  });

  it('groups by case and preserves first-appearance order', () => {
    const rows = [
      runRow({ caseId: 'cB', pass: true, actualOutput: delta(1) }),
      runRow({ caseId: 'cA', pass: true, actualOutput: delta(1) }),
      runRow({ caseId: 'cB', pass: false, actualOutput: delta(1) }),
    ];
    const out = computeCaseStability(rows);
    expect(out.map((c) => c.case_id)).toEqual(['cB', 'cA']);
    expect(out[0]!.runs).toBe(2);
  });
});

// ── T12 / test_noise_alert ─────────────────────────────────────────────────────

const stat = (stddev: number) => ({ mean: 0.8, stddev, n: 5, indicative: false });

describe('worstMetricDrop — mirrors regressionAlert (two-latest, ≥1pt largest)', () => {
  it('null with fewer than two completed runs', () => {
    expect(worstMetricDrop([{ recall: 1, precision: 1, citation_accuracy: 1 }])).toBeNull();
  });

  it('picks the largest ≥1pt drop between the two latest (completed[0] newest)', () => {
    const completed: CompletedRunMetrics[] = [
      { recall: 0.9, precision: 0.7, citation_accuracy: 1 }, // latest
      { recall: 0.92, precision: 0.75, citation_accuracy: 1 }, // previous
    ];
    // recall drop 2pts, precision drop 5pts → precision wins.
    expect(worstMetricDrop(completed)).toEqual({ metric: 'precision', pts: 5 });
  });

  it('null when no metric regressed by ≥1pt', () => {
    expect(
      worstMetricDrop([
        { recall: 0.999, precision: 1, citation_accuracy: 1 },
        { recall: 1, precision: 1, citation_accuracy: 1 },
      ]),
    ).toBeNull();
  });

  it('skips metrics that are null on either side', () => {
    expect(
      worstMetricDrop([
        { recall: null, precision: 0.6, citation_accuracy: 1 },
        { recall: 1, precision: 0.7, citation_accuracy: 1 },
      ]),
    ).toEqual({ metric: 'precision', pts: 10 });
  });
});

describe('noiseAwareAlert — dampens the drop by the sampled band (AC-7/UD-3)', () => {
  const completed: CompletedRunMetrics[] = [
    { recall: 0.9, precision: 0.72, citation_accuracy: 1 }, // latest
    { recall: 0.9, precision: 0.75, citation_accuracy: 1 }, // previous — precision drop 3pts
  ];

  it('beyond_band = true when the move exceeds the band', () => {
    // band = round(0.01 × 100) = 1pt; move = 3pts → beyond.
    const alert = noiseAwareAlert(completed, {
      recall: null,
      precision: stat(0.01),
      citation_accuracy: null,
      cost: null,
      runs_completed: 5,
      runs_failed: 0,
    });
    expect(alert).toEqual({ metric: 'precision', move: 3, band: 1, beyond_band: true });
  });

  it('beyond_band = false when the move falls WITHIN the band (noise)', () => {
    // band = round(0.05 × 100) = 5pt; move = 3pts → within → not surfaced.
    const alert = noiseAwareAlert(completed, {
      recall: null,
      precision: stat(0.05),
      citation_accuracy: null,
      cost: null,
      runs_completed: 5,
      runs_failed: 0,
    });
    expect(alert).toEqual({ metric: 'precision', move: 3, band: 5, beyond_band: false });
  });

  it('beyond_band = false at the EXACT boundary (move === band, not just <) — strict >', () => {
    // band = round(0.03 × 100) = 3pt; move = 3pts → move === band → NOT beyond
    // (`beyond_band = move > band`, so equality must stay within-band, AC-7).
    const alert = noiseAwareAlert(completed, {
      recall: null,
      precision: stat(0.03),
      citation_accuracy: null,
      cost: null,
      runs_completed: 5,
      runs_failed: 0,
    });
    expect(alert).toEqual({ metric: 'precision', move: 3, band: 3, beyond_band: false });
  });

  it('band 0 when there is no sampled stat → any drop is beyond the band', () => {
    expect(noiseAwareAlert(completed, null)).toEqual({
      metric: 'precision',
      move: 3,
      band: 0,
      beyond_band: true,
    });
  });

  it('null when there is no ≥1pt drop', () => {
    expect(
      noiseAwareAlert(
        [
          { recall: 1, precision: 1, citation_accuracy: 1 },
          { recall: 1, precision: 1, citation_accuracy: 1 },
        ],
        null,
      ),
    ).toBeNull();
  });
});
