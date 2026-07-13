import type {
  EvalMetricStat,
  EvalSkillStabilitySummary,
  EvalSkillCaseStability,
  EvalSkillStabilityAlert,
  EvalSkillStabilityMetric,
} from '@devdigest/shared';
import type { EvalSkillSuiteRunRow, EvalRunRow } from '../../db/rows.js';
import { STABILITY_MIN_N } from './constants.js';

/**
 * Skill Eval STABILITY LAYER — the PURE variance / flags / band aggregator
 * (SPEC-2026-07-12-skill-eval-stability-layer).
 *
 * NO `container`, NO LLM, NO I/O (AC-11): every function is a pure transform over
 * already-persisted child suite-run rows + their per-case `eval_runs`. Mirrors
 * the harness `calcStats` (sample stddev, n−1) and `computeFlags` semantics, but
 * with the product-tuned STRICT flaky band (UD-1). Reuses `regressionAlert`'s
 * ≥1pt-largest-drop rule via `worstMetricDrop` so `scoring.ts` stays byte-for-byte
 * — the noise band lives HERE, never in the scorer.
 */

// ===========================================================================
// Per-metric variance
// ===========================================================================

/**
 * The sampled statistic of a metric's non-null draws: `mean`, SAMPLE `stddev`
 * (n−1, matching the harness `calcStats`; 0 for a single sample), `n`, and
 * `indicative = n < STABILITY_MIN_N`. Null when the sample is empty.
 */
export function calcMetricStat(values: number[]): EvalMetricStat | null {
  const n = values.length;
  if (n === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  // Sample variance (n−1). A single sample has no spread → stddev 0.
  const variance = n < 2 ? 0 : values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1);
  return {
    mean,
    stddev: Math.sqrt(variance),
    n,
    indicative: n < STABILITY_MIN_N,
  };
}

/**
 * The group's per-metric variance summary over its child runs. `runs_completed`
 * / `runs_failed` count the `done` / `failed` children; each metric's stat is
 * computed over the `done` runs, collecting ONLY that metric's non-null draws
 * (the null-metric rule — a metric null in a run is excluded from its sample,
 * AC-3). A metric with zero non-null draws is null (not a vacuous stat).
 */
export function computeStabilitySummary(
  runs: EvalSkillSuiteRunRow[],
): EvalSkillStabilitySummary {
  const done = runs.filter((r) => r.status === 'done');
  const nonNull = (pick: (r: EvalSkillSuiteRunRow) => number | null): number[] =>
    done.map(pick).filter((v): v is number => v != null);
  return {
    recall: calcMetricStat(nonNull((r) => r.recall)),
    precision: calcMetricStat(nonNull((r) => r.precision)),
    citation_accuracy: calcMetricStat(nonNull((r) => r.citationAccuracy)),
    cost: calcMetricStat(nonNull((r) => r.costUsd)),
    runs_completed: done.length,
    runs_failed: runs.filter((r) => r.status === 'failed').length,
  };
}

// ===========================================================================
// Per-case flags
// ===========================================================================

/** Grounded delta-finding count of a stored `actual_output` (EvalSkillCaseDelta), or 0. */
function deltaFindingCount(actualOutput: unknown): number {
  if (actualOutput && typeof actualOutput === 'object' && 'findings' in actualOutput) {
    const findings = (actualOutput as { findings?: unknown }).findings;
    if (Array.isArray(findings)) return findings.length;
  }
  return 0;
}

/**
 * Per-case stability across a group's child per-case rows. Grouped by `case_id`:
 *  - `runs`               = how many of the group's runs scored the case;
 *  - `pass_rate`          = passes / runs;
 *  - `flaky`              = `0 < pass_rate < 1` (STRICT band, UD-1; unanimous 0/1
 *                           is never flaky), NOT the harness 20–80% band;
 *  - `non_discriminating` = the delta is EMPTY in EVERY run of the case (the skill
 *                           added nothing for this case/host across the sample,
 *                           reusing the per-run empty-delta signal — AC-6).
 *
 * Insertion order of first appearance is preserved so the UI list is stable.
 */
export function computeCaseStability(rows: EvalRunRow[]): EvalSkillCaseStability[] {
  interface Acc {
    runs: number;
    passes: number;
    anyDelta: boolean;
  }
  const byCase = new Map<string, Acc>();
  const order: string[] = [];
  for (const row of rows) {
    let acc = byCase.get(row.caseId);
    if (!acc) {
      acc = { runs: 0, passes: 0, anyDelta: false };
      byCase.set(row.caseId, acc);
      order.push(row.caseId);
    }
    acc.runs += 1;
    if (row.pass === true) acc.passes += 1;
    if (deltaFindingCount(row.actualOutput) > 0) acc.anyDelta = true;
  }
  return order.map((caseId) => {
    const acc = byCase.get(caseId)!;
    const passRate = acc.runs === 0 ? 0 : acc.passes / acc.runs;
    return {
      case_id: caseId,
      pass_rate: passRate,
      runs: acc.runs,
      flaky: passRate > 0 && passRate < 1,
      non_discriminating: !acc.anyDelta,
    };
  });
}

// ===========================================================================
// Noise-aware regression alert (band wrapper over regressionAlert's rule)
// ===========================================================================

/** The two-latest-completed slice `worstMetricDrop` compares (numbers, not a string). */
export interface CompletedRunMetrics {
  recall: number | null;
  precision: number | null;
  citation_accuracy: number | null;
}

const ALERT_METRICS: readonly EvalSkillStabilityMetric[] = [
  'recall',
  'precision',
  'citation_accuracy',
] as const;

/**
 * The largest single-metric drop over the two latest COMPLETED runs
 * (`completed[0]` newest), in percentage points — MIRRORS `regressionAlert`'s
 * rule (two-latest-completed, largest drop ≥ 1pt) but returns the numbers instead
 * of the string. Null when fewer than two completed runs or no metric regressed
 * by ≥ 1pt.
 */
export function worstMetricDrop(
  completed: CompletedRunMetrics[],
): { metric: EvalSkillStabilityMetric; pts: number } | null {
  if (completed.length < 2) return null;
  const [latest, previous] = completed;
  if (!latest || !previous) return null;

  let worst: { metric: EvalSkillStabilityMetric; pts: number } | null = null;
  for (const metric of ALERT_METRICS) {
    const cur = latest[metric];
    const prev = previous[metric];
    if (cur == null || prev == null) continue;
    const pts = Math.round((prev - cur) * 100);
    if (pts >= 1 && (!worst || pts > worst.pts)) worst = { metric, pts };
  }
  return worst;
}

/**
 * The NOISE-AWARE structured alert (UD-3): the worst metric drop dampened by the
 * sampled variance band. `band` = `round(stddev × 100)` pts for that metric (0
 * when there is no sampled stat), so `beyond_band = move > band` is a same-unit
 * (pts) comparison. A move WITHIN the band is noise (`beyond_band = false`) and
 * the UI does not surface it as a regression. Pure — no LLM (AC-11). Null when
 * there is no ≥1pt drop over the two latest completed runs.
 */
export function noiseAwareAlert(
  completed: CompletedRunMetrics[],
  summary: EvalSkillStabilitySummary | null,
): EvalSkillStabilityAlert | null {
  const drop = worstMetricDrop(completed);
  if (!drop) return null;
  const stat = summary ? summary[drop.metric] : null;
  const band = stat ? Math.round(stat.stddev * 100) : 0;
  const move = drop.pts;
  return {
    metric: drop.metric,
    move,
    band,
    beyond_band: move > band,
  };
}
