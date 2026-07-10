import { z } from 'zod';
import { Severity, FindingCategory } from './findings.js';
import { EvalRunRecord } from './eval-ci.js';

/**
 * L06 Agent Eval Pipeline — NEW shared contract file for the in-product
 * regression harness (SPEC-2026-07-10-agent-eval-pipeline).
 *
 * This EXTENDS the barrel with a new file; it does NOT edit `eval-ci.ts`,
 * `knowledge.ts`, or the barrel's existing exports. The base `EvalCase`,
 * `EvalRun`, `EvalOwnerKind` live in `knowledge.ts`; `EvalCaseInput`,
 * `EvalRunRecord`, `EvalRunResult`, `EvalTrendPoint`, `EvalDashboard` live in
 * `eval-ci.ts` and are consumed unchanged.
 *
 * Why a new file instead of widening `eval-ci.ts`: AC-18 requires a metric with
 * a zero denominator to be NULL → rendered "—" (never a vacuous 0 / 100%). The
 * pre-scaffolded `EvalDashboard.current.*` and `EvalTrendPoint.*` are
 * non-nullable `z.number()`; returning null through them would 500 (serializer)
 * or force a vacuous 0. So the per-agent / per-suite "current" tiles and trend
 * points are surfaced from the NULLABLE types defined here.
 */

// ===========================================================================
// Expected-output envelope (jsonb; D4)
// ===========================================================================

/** Case polarity — drives per-case pass (AC-17) and metric bucketing (AC-16). */
export const EvalExpectation = z.enum(['must_find', 'must_not_flag']);
export type EvalExpectation = z.infer<typeof EvalExpectation>;

/**
 * One expected finding. `file` matched by EQUALITY, `[start_line, end_line]` by
 * INTERSECTION (AC-15); severity/category/title are informative only and never
 * affect matching.
 */
export const EvalExpectedFinding = z.object({
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  severity: Severity.nullish(),
  category: FindingCategory.nullish(),
  title: z.string().nullish(),
});
export type EvalExpectedFinding = z.infer<typeof EvalExpectedFinding>;

/**
 * The `expected_output` envelope stored on an eval case. A `must_not_flag` case
 * with an EMPTY `findings[]` means "no findings anywhere on this diff" — a
 * clean-fixture control where ANY produced finding is noise (AC-16). An invalid
 * shape is rejected 422 (AC-31).
 */
export const EvalExpectedOutput = z.object({
  expectation: EvalExpectation,
  findings: z.array(EvalExpectedFinding),
});
export type EvalExpectedOutput = z.infer<typeof EvalExpectedOutput>;

// ===========================================================================
// Suite run — parent of a run over all of an agent's cases
// ===========================================================================

export const EvalSuiteStatus = z.enum(['running', 'done', 'failed']);
export type EvalSuiteStatus = z.infer<typeof EvalSuiteStatus>;

/** Recall / precision / citation, each nullable when its denominator is 0 (AC-18). */
export const EvalNullableMetrics = z.object({
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
});
export type EvalNullableMetrics = z.infer<typeof EvalNullableMetrics>;

/** Signed metric deltas vs the previous run; null when a side is null (AC-34). */
export const EvalMetricDelta = z.object({
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
});
export type EvalMetricDelta = z.infer<typeof EvalMetricDelta>;

/** A persisted `eval_suite_runs` row, returned by the API. */
export const EvalSuiteRun = z.object({
  id: z.string(),
  workspace_id: z.string(),
  agent_id: z.string(),
  /** Display-only agent name (joined on read); absent on the raw row. */
  agent_name: z.string().nullish(),
  agent_version: z.number().int(),
  status: EvalSuiteStatus,
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  passed: z.number().int(),
  total: z.number().int(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int(),
  ran_at: z.string(),
});
export type EvalSuiteRun = z.infer<typeof EvalSuiteRun>;

/** Immediate response of `POST /agents/:id/eval-runs` (AC-8). */
export const EvalSuiteRunAccepted = z.object({
  suite_run_id: z.string(),
  status: EvalSuiteStatus,
});
export type EvalSuiteRunAccepted = z.infer<typeof EvalSuiteRunAccepted>;

/** Response of "Run all agents" — which suites started, which were skipped (AC-33). */
export const RunAllResult = z.object({
  started: z.array(z.object({ agent_id: z.string(), suite_run_id: z.string() })),
  skipped: z.array(
    z.object({
      agent_id: z.string(),
      reason: z.enum(['no_cases', 'already_running']),
    }),
  ),
});
export type RunAllResult = z.infer<typeof RunAllResult>;

/** Request body for "create case from a finding" (finding id is a path param). */
export const EvalCaseFromFindingInput = z.object({
  finding_id: z.string(),
});
export type EvalCaseFromFindingInput = z.infer<typeof EvalCaseFromFindingInput>;

// ===========================================================================
// Per-case run record (extends EvalRunRecord with error + suite linkage)
// ===========================================================================

/**
 * A per-case `eval_runs` row surfaced with its suite linkage + failure reason.
 * Composed from the existing `EvalRunRecord` (never editing it) plus the two new
 * columns.
 */
export const EvalCaseRunRecord = EvalRunRecord.extend({
  suite_run_id: z.string().nullable(),
  error: z.string().nullable(),
});
export type EvalCaseRunRecord = z.infer<typeof EvalCaseRunRecord>;

/** A suite run + all of its per-case rows (progressive read; AC-11/AC-12). */
export const EvalSuiteDetail = z.object({
  suite: EvalSuiteRun,
  runs: z.array(EvalCaseRunRecord),
});
export type EvalSuiteDetail = z.infer<typeof EvalSuiteDetail>;

// ===========================================================================
// Eval-case list item (Evals tab / case list)
// ===========================================================================

/**
 * A case + a compact view of its latest run for the AgentEditor Evals tab and
 * dashboard case list. `expected_count` = the envelope's `findings[].length`;
 * `latest.actual_count` = how many findings the last run produced.
 */
export const EvalCaseListItem = z.object({
  id: z.string(),
  name: z.string(),
  expectation: EvalExpectation.nullable(),
  expected_count: z.number().int(),
  latest: z
    .object({
      run_id: z.string(),
      pass: z.boolean().nullable(),
      recall: z.number().nullable(),
      precision: z.number().nullable(),
      citation_accuracy: z.number().nullable(),
      actual_count: z.number().int().nullable(),
      duration_ms: z.number().int().nullable(),
      cost_usd: z.number().nullable(),
      ran_at: z.string(),
      error: z.string().nullable(),
    })
    .nullable(),
});
export type EvalCaseListItem = z.infer<typeof EvalCaseListItem>;

// ===========================================================================
// Dashboards (null-capable — supersede EvalDashboard.current / EvalTrendPoint)
// ===========================================================================

/** One trend point — a suite run; tooltip = agent version + cost (AC-34). */
export const EvalSuiteTrendPoint = z.object({
  suite_run_id: z.string(),
  ran_at: z.string(),
  agent_version: z.number().int(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  pass_rate: z.number().nullable(),
  cost_usd: z.number().nullable(),
});
export type EvalSuiteTrendPoint = z.infer<typeof EvalSuiteTrendPoint>;

/** "current" tile block — nullable metrics + passed/total + cost (AC-18/AC-19). */
export const EvalCurrentMetrics = z.object({
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  cost_usd: z.number().nullable(),
});
export type EvalCurrentMetrics = z.infer<typeof EvalCurrentMetrics>;

/** Per-agent dashboard aggregate (AC-18/AC-19/AC-34/AC-35). */
export const EvalAgentDashboard = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  model: z.string(),
  cases_total: z.number().int(),
  current: EvalCurrentMetrics,
  delta: EvalMetricDelta,
  trend: z.array(EvalSuiteTrendPoint),
  recent_runs: z.array(EvalSuiteRun),
  /** Code-computed regression banner; null when fewer than two completed runs (AC-35). */
  alert: z.string().nullable(),
});
export type EvalAgentDashboard = z.infer<typeof EvalAgentDashboard>;

/** One agent's row in the all-agents dashboard (AC-32). */
export const EvalAgentSummary = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  model: z.string(),
  /** Mirrors `agents.enabled` — disabled agents render dimmed on `/eval`. */
  enabled: z.boolean(),
  cases_total: z.number().int(),
  current: EvalNullableMetrics,
  /**
   * Per-metric sparkline series (one point per completed suite run,
   * chronological; null metrics are skipped per series, so lengths may differ).
   */
  sparklines: z.object({
    recall: z.array(z.number()),
    precision: z.array(z.number()),
    citation_accuracy: z.array(z.number()),
  }),
  last_run: EvalSuiteRun.nullable(),
});
export type EvalAgentSummary = z.infer<typeof EvalAgentSummary>;

/** All-agents dashboard aggregate for `/eval` (AC-32/AC-33). */
export const EvalWorkspaceDashboard = z.object({
  agents: z.array(EvalAgentSummary),
  recent_runs: z.array(EvalSuiteRun),
});
export type EvalWorkspaceDashboard = z.infer<typeof EvalWorkspaceDashboard>;

// ===========================================================================
// Compare two suite runs (AC-27/AC-28)
// ===========================================================================

export const EvalCompareResult = z.object({
  run_a: EvalSuiteRun,
  run_b: EvalSuiteRun,
  delta: z.object({
    recall: z.number().nullable(),
    precision: z.number().nullable(),
    citation_accuracy: z.number().nullable(),
    cost_usd: z.number().nullable(),
  }),
  /** System prompts from `agent_versions.config_json`; null → "config unavailable" (AC-28). */
  system_prompt_a: z.string().nullable(),
  system_prompt_b: z.string().nullable(),
  config_available: z.boolean(),
});
export type EvalCompareResult = z.infer<typeof EvalCompareResult>;
