import { z } from 'zod';
import { EvalSuiteStatus } from './eval-suite.js';
import { EvalSkillDashboard } from './eval-skill-suite.js';

/**
 * Skill Eval Pipeline — STABILITY LAYER (repeat + variance + noise-aware alert)
 * (SPEC-2026-07-12-skill-eval-stability-layer).
 *
 * The MERGED differential skill-eval scores each case ONCE per suite run, but
 * both delta arms are LLM calls, so a single run's recall/precision/
 * citation_accuracy carries hidden variance. This layer repeats ONE frozen
 * snapshot N times as a *stability group* over the UNCHANGED
 * `SkillEvalRunExecutor`, then reports per-metric variance (mean ± stddev), a
 * per-case `flaky` / `non_discriminating` flag, and a NOISE-AWARE structured
 * regression alert that dampens the existing banner by the sampled band.
 *
 * This EXTENDS the barrel with a NEW file; it does NOT edit `eval-suite.ts`,
 * `eval-skill-suite.ts`, or the barrel's existing exports. Shapes that are
 * IDENTICAL to the parent (`EvalSuiteStatus`, `EvalSkillSuiteRun`,
 * `EvalSkillDashboard`, `EvalSkillCaseDelta`) are consumed unchanged from their
 * sibling files — never redefined here. The extended dashboard is a COMPOSED
 * schema (`.extend()` on the imported `EvalSkillDashboard`) so the parent's
 * contracts and the barrel stay untouched (UD-3).
 */

// ===========================================================================
// Stability group — parent of N repeated differential suite runs
// ===========================================================================

/**
 * A persisted `eval_skill_stability_groups` row, returned by the API. Holds ONE
 * frozen snapshot identity (skill + host, each captured with its version at
 * start, mirroring the differential AC-12 freeze) run `n_requested` times. The
 * per-run metric draws live on the child `eval_skill_suite_runs`; the group row
 * itself stores NO stats (they are derived on read — compute-on-read). `run_ids`
 * are the child skill suite-run ids the aggregation reads over.
 */
export const EvalSkillStabilityGroup = z.object({
  id: z.string(),
  workspace_id: z.string(),
  skill_id: z.string(),
  skill_version: z.number().int(),
  host_agent_id: z.string(),
  host_agent_version: z.number().int(),
  /** The requested repeat count (2 ≤ n ≤ STABILITY_MAX_N). */
  n_requested: z.number().int(),
  status: EvalSuiteStatus,
  /** Child skill suite-run ids belonging to this group (newest-first). */
  run_ids: z.array(z.string()),
  ran_at: z.string(),
});
export type EvalSkillStabilityGroup = z.infer<typeof EvalSkillStabilityGroup>;

// ===========================================================================
// Variance — per-metric sampled statistic
// ===========================================================================

/**
 * One metric's variance over the group's completed runs: the `mean`, the SAMPLE
 * `stddev` (n−1, mirroring the harness `calcStats`), the sample size `n`, and an
 * `indicative` flag set WHEN `n < STABILITY_MIN_N` — so the UI labels the figure
 * "indicative only" and never presents it as settled (AC-4). Null (not this
 * object) when the metric's sample is empty (every run was null for it).
 */
export const EvalMetricStat = z.object({
  mean: z.number(),
  stddev: z.number(),
  n: z.number().int(),
  indicative: z.boolean(),
});
export type EvalMetricStat = z.infer<typeof EvalMetricStat>;

/**
 * The group's per-metric variance summary. Each metric is an `EvalMetricStat` or
 * null (empty sample — the null-metric rule: a metric null in a run is excluded
 * from that metric's sample, AC-3). `runs_completed` / `runs_failed` count the
 * group's `done` / `failed` children.
 */
export const EvalSkillStabilitySummary = z.object({
  recall: EvalMetricStat.nullable(),
  precision: EvalMetricStat.nullable(),
  citation_accuracy: EvalMetricStat.nullable(),
  cost: EvalMetricStat.nullable(),
  runs_completed: z.number().int(),
  runs_failed: z.number().int(),
});
export type EvalSkillStabilitySummary = z.infer<typeof EvalSkillStabilitySummary>;

// ===========================================================================
// Per-case stability flags
// ===========================================================================

/**
 * Per-case stability across the group: `pass_rate` = passes / runs, `runs` = how
 * many of the group's runs scored this case, `flaky` WHEN the pass outcome is NOT
 * unanimous (`0 < pass_rate < 1` — STRICT band, UD-1; unanimous 0/1 never flaky),
 * and `non_discriminating` WHEN the case's delta is EMPTY in EVERY run of the
 * group (the skill added nothing for this case/host — AC-6).
 */
export const EvalSkillCaseStability = z.object({
  case_id: z.string(),
  pass_rate: z.number(),
  runs: z.number().int(),
  flaky: z.boolean(),
  non_discriminating: z.boolean(),
});
export type EvalSkillCaseStability = z.infer<typeof EvalSkillCaseStability>;

// ===========================================================================
// Noise-aware regression alert (UD-3)
// ===========================================================================

/** The metrics the noise-aware alert speaks about (mirrors `regressionAlert`). */
export const EvalSkillStabilityMetric = z.enum(['recall', 'precision', 'citation_accuracy']);
export type EvalSkillStabilityMetric = z.infer<typeof EvalSkillStabilityMetric>;

/**
 * The STRUCTURED noise-aware verdict (UD-3): the metric that dropped, the `move`
 * (drop magnitude in percentage points), the sampled `band` (the metric's
 * stddev in pts), and `beyond_band` — TRUE only when `move > band`. A move within
 * the band is noise and NOT surfaced as a regression. The existing string
 * `EvalSkillDashboard.alert` stays unchanged for agent back-compat; the skill
 * dashboard carries this structured alert ADDITIONALLY and the UI formats it.
 */
export const EvalSkillStabilityAlert = z.object({
  metric: EvalSkillStabilityMetric,
  /** Drop magnitude, percentage points (same unit as `regressionAlert`). */
  move: z.number(),
  /** The sampled noise band, percentage points (round(stddev × 100)). */
  band: z.number(),
  beyond_band: z.boolean(),
});
export type EvalSkillStabilityAlert = z.infer<typeof EvalSkillStabilityAlert>;

// ===========================================================================
// Read shapes + request/response
// ===========================================================================

/**
 * A stability group + its DERIVED variance summary + per-case flags (progressive
 * read for polling). `summary` is null while fewer than 2 runs have completed
 * (never a vacuous stddev — AC-8).
 */
export const EvalSkillStabilityDetail = z.object({
  group: EvalSkillStabilityGroup,
  summary: EvalSkillStabilitySummary.nullable(),
  cases: z.array(EvalSkillCaseStability),
});
export type EvalSkillStabilityDetail = z.infer<typeof EvalSkillStabilityDetail>;

/** Immediate response of the start-group route (`POST /skills/:id/stability-runs`). */
export const EvalSkillStabilityGroupAccepted = z.object({
  group_id: z.string(),
  status: EvalSuiteStatus,
});
export type EvalSkillStabilityGroupAccepted = z.infer<typeof EvalSkillStabilityGroupAccepted>;

/**
 * Request body for the start-group route: the host agent the delta runs on and
 * the repeat count. `n` is validated AT THE EDGE (2 ≤ n ≤ 5, mirroring
 * `STABILITY_MAX_N`) and re-checked in the service against the constant.
 */
export const EvalSkillStabilityRequest = z.object({
  host_agent_id: z.string(),
  n: z.number().int().min(2).max(5),
});
export type EvalSkillStabilityRequest = z.infer<typeof EvalSkillStabilityRequest>;

// ===========================================================================
// Extended per-skill dashboard (COMPOSED — never edits `eval-skill-suite.ts`)
// ===========================================================================

/**
 * The shipped `EvalSkillDashboard` PLUS the latest stability group's variance +
 * flags + noise-aware alert (AC-7/AC-10). Additive fields only — the parent's
 * shape and its string `alert` are preserved for agent back-compat, so this is a
 * `.extend()` on the imported schema rather than an edit to `eval-skill-suite.ts`.
 */
export const EvalSkillDashboardWithStability = EvalSkillDashboard.extend({
  stability: EvalSkillStabilitySummary.nullable(),
  stability_group: EvalSkillStabilityGroup.nullable(),
  case_stability: z.array(EvalSkillCaseStability),
  stability_alert: EvalSkillStabilityAlert.nullable(),
});
export type EvalSkillDashboardWithStability = z.infer<typeof EvalSkillDashboardWithStability>;
