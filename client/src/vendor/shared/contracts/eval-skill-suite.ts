import { z } from 'zod';
import { Severity, FindingCategory } from './findings.js';
import {
  EvalSuiteStatus,
  EvalNullableMetrics,
  EvalMetricDelta,
  EvalCurrentMetrics,
  EvalCaseRunRecord,
} from './eval-suite.js';

/**
 * Skill Eval Pipeline — DIFFERENTIAL (delta) evaluation of review skills
 * (SPEC-2026-07-12-skill-eval-differential).
 *
 * L06 shipped the in-product regression harness for review AGENTS
 * (`eval-suite.ts`). A skill has no model/prompt/strategy, so it is only
 * meaningful as a DELTA on a host agent's review: run the host twice over a
 * case's stored diff — WITHOUT the skill (baseline arm) and WITH it — and score
 * the findings the skill caused. These shapes carry the extra skill + host
 * identity, the delta classification, and the skill-suite parent that the L06
 * agent contracts don't have.
 *
 * This EXTENDS the barrel with a NEW file; it does NOT edit `eval-suite.ts`,
 * `eval-ci.ts`, `knowledge.ts`, or the barrel's existing exports. Shapes that are
 * IDENTICAL to L06 (`EvalSuiteStatus`, `EvalNullableMetrics`, `EvalMetricDelta`,
 * `EvalCurrentMetrics`, `EvalCaseRunRecord`, `EvalSuiteRunAccepted`) are consumed
 * unchanged from `eval-suite.ts` — never redefined here.
 *
 * Nullable-metric rule is inherited from L06: a metric with a zero denominator is
 * NULL (rendered "—"), never a vacuous 0 / 100% — hence `z.number().nullable()`.
 */

// ===========================================================================
// Skill suite run — parent of a differential run over all of a skill's cases
// ===========================================================================

/**
 * A persisted `eval_skill_suite_runs` row, returned by the API. Sibling of the
 * agent-typed `EvalSuiteRun`: it additionally carries the host agent that ran the
 * two arms (a skill delta is meaningless without a host). Metrics are nullable
 * when their denominator is 0.
 */
export const EvalSkillSuiteRun = z.object({
  id: z.string(),
  workspace_id: z.string(),
  skill_id: z.string(),
  /** Display-only skill name (joined on read); absent on the raw row. */
  skill_name: z.string().nullish(),
  skill_version: z.number().int(),
  host_agent_id: z.string(),
  /** Display-only host agent name (joined on read); absent on the raw row. */
  host_agent_name: z.string().nullish(),
  host_agent_version: z.number().int(),
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
export type EvalSkillSuiteRun = z.infer<typeof EvalSkillSuiteRun>;

/**
 * Immediate response of a skill run-start route (`POST /skills/:id/eval-runs`).
 * IDENTICAL shape to L06's `EvalSuiteRunAccepted` (`{ suite_run_id, status }`) —
 * re-exported under the skill alias so callers get a self-documenting name
 * without a divergent redefinition.
 */
export { EvalSuiteRunAccepted as EvalSkillSuiteRunAccepted } from './eval-suite.js';

/**
 * Response of "Run all skills" — which differential suites started, which were
 * skipped. `no_host` = no enabled agent links the skill (a skill delta needs a
 * host); `no_cases`/`already_running` mirror the agent path.
 */
export const RunAllSkillsResult = z.object({
  started: z.array(z.object({ skill_id: z.string(), suite_run_id: z.string() })),
  skipped: z.array(
    z.object({
      skill_id: z.string(),
      reason: z.enum(['no_cases', 'no_host', 'already_running']),
    }),
  ),
});
export type RunAllSkillsResult = z.infer<typeof RunAllSkillsResult>;

/** Request body for a skill run-start route — the host agent to run the delta on. */
export const EvalSkillRunRequest = z.object({
  host_agent_id: z.string(),
});
export type EvalSkillRunRequest = z.infer<typeof EvalSkillRunRequest>;

// ===========================================================================
// Per-case delta view (stored in eval_runs.actual_output — AC-30)
// ===========================================================================

/**
 * Per-delta-finding classification for the delta view: `caught` = the delta
 * finding matches a `must_find` expectation; `noise` = it intersects a
 * `must_not_flag` region (or any finding on a clean fixture); `ignored` =
 * neither (informative, never penalizes).
 */
export const EvalSkillDeltaClassification = z.enum(['caught', 'noise', 'ignored']);
export type EvalSkillDeltaClassification = z.infer<typeof EvalSkillDeltaClassification>;

/**
 * The delta persisted per case (the WITH-arm findings attributable to the skill).
 * `file` + `[start_line, end_line]` locate the finding; severity/category/title
 * are informative only (never affect matching); `classification` drives the
 * caught/noise/ignored delta view.
 */
export const EvalSkillCaseDelta = z.object({
  findings: z.array(
    z.object({
      file: z.string(),
      start_line: z.number().int(),
      end_line: z.number().int(),
      severity: Severity.nullish(),
      category: FindingCategory.nullish(),
      title: z.string().nullish(),
      classification: EvalSkillDeltaClassification,
    }),
  ),
});
export type EvalSkillCaseDelta = z.infer<typeof EvalSkillCaseDelta>;

/** A skill suite run + all of its per-case delta rows (progressive read). */
export const EvalSkillSuiteDetail = z.object({
  suite: EvalSkillSuiteRun,
  runs: z.array(EvalCaseRunRecord),
});
export type EvalSkillSuiteDetail = z.infer<typeof EvalSkillSuiteDetail>;

// ===========================================================================
// Dashboards (null-capable, mirroring the L06 agent dashboards)
// ===========================================================================

/**
 * One trend point — a skill suite run; tooltip = skill version + host agent
 * version + cost. Both versions are carried because a delta shifts with EITHER
 * the skill body OR the host config changing (the compare confounder, AC-29).
 */
export const EvalSkillSuiteTrendPoint = z.object({
  suite_run_id: z.string(),
  ran_at: z.string(),
  skill_version: z.number().int(),
  host_agent_id: z.string(),
  host_agent_version: z.number().int(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  pass_rate: z.number().nullable(),
  cost_usd: z.number().nullable(),
});
export type EvalSkillSuiteTrendPoint = z.infer<typeof EvalSkillSuiteTrendPoint>;

/** Per-skill dashboard aggregate (AC-26/AC-27). */
export const EvalSkillDashboard = z.object({
  skill_id: z.string(),
  skill_name: z.string(),
  cases_total: z.number().int(),
  /** Delta metric tile block — reuses L06's nullable current-metrics shape. */
  current: EvalCurrentMetrics,
  delta: EvalMetricDelta,
  trend: z.array(EvalSkillSuiteTrendPoint),
  recent_runs: z.array(EvalSkillSuiteRun),
  /** Code-computed regression banner; null when fewer than two completed runs. */
  alert: z.string().nullable(),
});
export type EvalSkillDashboard = z.infer<typeof EvalSkillDashboard>;

/** One skill's row in the all-skills dashboard (AC-24). */
export const EvalSkillSummary = z.object({
  skill_id: z.string(),
  skill_name: z.string(),
  /** Mirrors `skills.enabled` — disabled skills render dimmed on `/eval`. */
  enabled: z.boolean(),
  cases_total: z.number().int(),
  current: EvalNullableMetrics,
  /**
   * Per-metric sparkline series (one point per completed suite run,
   * chronological; missing metrics are floored to 0 (mirrors the per-skill
   * detail cards), so all three series share the same length).
   */
  sparklines: z.object({
    recall: z.array(z.number()),
    precision: z.array(z.number()),
    citation_accuracy: z.array(z.number()),
  }),
  last_run: EvalSkillSuiteRun.nullable(),
});
export type EvalSkillSummary = z.infer<typeof EvalSkillSummary>;

/** All-skills dashboard aggregate for `/eval?tab=skills` (AC-24). */
export const EvalSkillsWorkspaceDashboard = z.object({
  skills: z.array(EvalSkillSummary),
  recent_runs: z.array(EvalSkillSuiteRun),
});
export type EvalSkillsWorkspaceDashboard = z.infer<typeof EvalSkillsWorkspaceDashboard>;

// ===========================================================================
// Host candidates (host picker — AC-4)
// ===========================================================================

/**
 * The candidate host agents a skill can be evaluated on. `default_host_id` = the
 * first enabled agent that links the skill, or null when none do (the UI then
 * falls back to the full enabled-agent list). Each candidate carries its enabled
 * flag so the picker can dim/disable a non-runnable host with a reason (AC-6).
 */
export const EvalSkillHostCandidates = z.object({
  default_host_id: z.string().nullable(),
  candidates: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      version: z.number().int(),
      enabled: z.boolean(),
    }),
  ),
});
export type EvalSkillHostCandidates = z.infer<typeof EvalSkillHostCandidates>;

// ===========================================================================
// Compare two skill suite runs (AC-28/AC-29)
// ===========================================================================

/**
 * Compare two differential runs. Mirrors L06's `EvalCompareResult` but diffs the
 * SKILL BODY (from `skill_versions`, null → "body unavailable") instead of the
 * system prompt, and surfaces `host_changed` — a delta shift is confounded when
 * the two runs used a different host agent or host version (AC-29). Each run's
 * host id/version are carried inside `run_a` / `run_b`.
 */
export const EvalSkillCompareResult = z.object({
  run_a: EvalSkillSuiteRun,
  run_b: EvalSkillSuiteRun,
  delta: z.object({
    recall: z.number().nullable(),
    precision: z.number().nullable(),
    citation_accuracy: z.number().nullable(),
    cost_usd: z.number().nullable(),
  }),
  /** Skill bodies from `skill_versions.body`; null → "body unavailable" (AC-28). */
  skill_body_a: z.string().nullable(),
  skill_body_b: z.string().nullable(),
  /** True when the two runs used a different host agent or host version (AC-29). */
  host_changed: z.boolean(),
});
export type EvalSkillCompareResult = z.infer<typeof EvalSkillCompareResult>;
