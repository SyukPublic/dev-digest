import { z } from 'zod';
import { Severity } from './findings.js';

/**
 * A5 — Observability / Multi-agent contracts (L07).
 *
 * These are NEW contracts (A5 owns this file; the barrel re-exports it). They
 * sit alongside A2's `review-api.ts`:
 *   - MultiAgentRun        the response of POST /pulls/:id/multi-agent-run
 *   - AgentColumn          one agent's column in the multi-agent view
 *   - Conflict / ConflictTake  where agents disagree on the same file:line
 *   - AgentStats           per-agent quality aggregates (GET /agents/:id/stats)
 *   - CuratorResult        the cross-session memory curator outcome
 *
 * The single-document run trace itself stays in `contracts/trace.ts` (RunTrace).
 */

// ---------------------------------------------------------------------------
// Multi-Agent Review
// ---------------------------------------------------------------------------

/** A finding as surfaced in a multi-agent column (subset of FindingRecord). */
export const AgentColumnFinding = z.object({
  id: z.string(),
  severity: Severity,
  category: z.string(),
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  kind: z.string().nullish(),
});
export type AgentColumnFinding = z.infer<typeof AgentColumnFinding>;

/** One agent's result column in the multi-agent review. */
export const AgentColumn = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  status: z.enum(['done', 'failed', 'running']),
  verdict: z.string().nullable(),
  score: z.number().int().nullable(),
  summary: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  findings: z.array(AgentColumnFinding),
});
export type AgentColumn = z.infer<typeof AgentColumn>;

/** One agent's stance on a contended file:line. */
export const ConflictTake = z.object({
  agent_id: z.string(),
  persona: z.string(),
  /** Severity if the agent flagged it, or 'ignored' when it did not. */
  verdict: z.union([Severity, z.literal('ignored')]),
  note: z.string(),
});
export type ConflictTake = z.infer<typeof ConflictTake>;

/**
 * A cross-agent grouped location (same file + overlapping lines + category) with one
 * `take` per reviewing agent — a flagged severity, or the synthesized 'ignored' ("did
 * not flag"). The array carries BOTH genuine disagreements (divergent severities, or
 * flagged-vs-did-not-flag) AND agreement/duplicate groups (all reviewers flagged the
 * same severity); the "Show only conflicts" UI toggle (ON by default) narrows to the
 * disagreements. Requires >=2 reviewing agents. Computed from persisted findings on
 * read; not stored. (The type name `Conflict` is retained for the contract.)
 */
export const Conflict = z.object({
  file: z.string(),
  line: z.number().int(),
  title: z.string(),
  takes: z.array(ConflictTake),
});
export type Conflict = z.infer<typeof Conflict>;

/** Response of POST /pulls/:id/multi-agent-run and GET /pulls/:id/multi-agent. */
export const MultiAgentRun = z.object({
  id: z.string(),
  pr_id: z.string(),
  pr_number: z.number().int().nullish(),
  ran_at: z.string(),
  agent_count: z.number().int(),
  total_duration_ms: z.number().int(),
  total_cost_usd: z.number().nullable(),
  columns: z.array(AgentColumn),
  conflicts: z.array(Conflict),
});
export type MultiAgentRun = z.infer<typeof MultiAgentRun>;

// ---------------------------------------------------------------------------
// Per-agent Stats (GET /agents/:id/stats)
// ---------------------------------------------------------------------------

/** A single (date, value) point for a sparkline/trend. */
export const StatPoint = z.object({ label: z.string(), value: z.number() });
export type StatPoint = z.infer<typeof StatPoint>;

/** A trace-derived usage bar (skill or memory) — `pct` is a 0..1 share. */
export const StatShare = z.object({ name: z.string(), pct: z.number() });
export type StatShare = z.infer<typeof StatShare>;

/** Memory usage bar — same shape as StatShare but keyed by display `label`. */
export const MemoryShare = z.object({ label: z.string(), pct: z.number() });
export type MemoryShare = z.infer<typeof MemoryShare>;

/** Findings-by-category donut segment (count/share, NOT money). */
export const CategoryCount = z.object({ category: z.string(), count: z.number().int() });
export type CategoryCount = z.infer<typeof CategoryCount>;

/** One weekly stacked-severity bar (oldest→newest). */
export const SeverityWeek = z.object({
  week: z.string(),
  CRITICAL: z.number().int(),
  WARNING: z.number().int(),
  SUGGESTION: z.number().int(),
});
export type SeverityWeek = z.infer<typeof SeverityWeek>;

/** One row of the per-agent run-history table (AC-27). */
export const AgentRunHistoryRow = z.object({
  run_id: z.string(),
  ran_at: z.string().nullable(),
  pr_number: z.number().int().nullable(),
  pr_id: z.string().nullable(),
  tokens: z.number().int().nullable(),
  /** null-means-unknown cost (never 0 as a stand-in). */
  cost_usd: z.number().nullable(),
  findings_count: z.number().int().nullable(),
  source: z.enum(['local', 'ci']),
});
export type AgentRunHistoryRow = z.infer<typeof AgentRunHistoryRow>;

export const AgentStats = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  runs: z.number().int(),
  findings_total: z.number().int(),
  /** accept-rate is the headline quality signal. 0..1 over acted findings. */
  accepted: z.number().int(),
  dismissed: z.number().int(),
  pending: z.number().int(),
  accept_rate: z.number().nullable(),
  dismiss_rate: z.number().nullable(),
  avg_findings_per_run: z.number().nullable(),
  total_cost_usd: z.number().nullable(),
  avg_cost_usd: z.number().nullable(),
  avg_latency_ms: z.number().nullable(),
  findings_by_severity: z.object({
    CRITICAL: z.number().int(),
    WARNING: z.number().int(),
    SUGGESTION: z.number().int(),
  }),
  /** recent runs for a small trend chart (oldest→newest). */
  trend: z.array(StatPoint),
  // ---- L08 Stats-tab extensions (additive; nullish-friendly) --------------
  /** period-over-period change in avg cost/run (the `-$0.01` chip); null when unknown. */
  avg_cost_delta_usd: z.number().nullable(),
  /** trace-derived; `pct` = share (0..1) of period runs whose trace pulled the skill (AC-23). */
  most_used_skills: z.array(StatShare),
  /** trace-derived; `pct` = share of period runs whose trace pulled the memory item (AC-24). */
  most_pulled_memory: z.array(MemoryShare),
  /** donut by count/share (AC-26). */
  findings_by_category: z.array(CategoryCount),
  /** weekly stacked bars, oldest→newest (AC-25). */
  findings_by_severity_weekly: z.array(SeverityWeek),
  /** run-history table rows (AC-27). */
  run_history: z.array(AgentRunHistoryRow),
});
export type AgentStats = z.infer<typeof AgentStats>;

// ---------------------------------------------------------------------------
// Cross-session memory curator
// ---------------------------------------------------------------------------

/** A merge the curator performed (or would perform in dry-run). */
export const CuratorMerge = z.object({
  kept_id: z.string(),
  merged_ids: z.array(z.string()),
  content: z.string(),
  similarity: z.number(),
});
export type CuratorMerge = z.infer<typeof CuratorMerge>;

export const CuratorResult = z.object({
  scanned: z.number().int(),
  merges: z.array(CuratorMerge),
  removed: z.number().int(),
  dry_run: z.boolean(),
});
export type CuratorResult = z.infer<typeof CuratorResult>;
