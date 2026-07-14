/* Pure display/derivation helpers for the CI Runs page. No side effects. */
import type { CiRunSummary, PrFindingCounts } from "@devdigest/shared";
import type { CiRunStatus } from "./constants";

/**
 * Map a CI run row to its display status. A completed run that produced
 * findings reads "succeeded" (it did its job and posted findings); a completed
 * run with zero findings reads "noFindings" (clean PR). Both are successful
 * executions — "failed" is reserved for a crashed/cancelled run.
 */
export function statusOf(run: CiRunSummary): CiRunStatus {
  const s = run.status ?? "";
  if (s === "running") return "running";
  if (s === "failed" || s === "cancelled") return "failed";
  return (run.findings_count ?? 0) > 0 ? "succeeded" : "noFindings";
}

/**
 * Build severity counts for `SeverityCountBadges` from the fields a CI run row
 * carries. The run row has no per-severity breakdown (only `findings_count` +
 * `blockers`), so blocking findings map to CRITICAL and the remainder to
 * WARNING — the same blocker-vs-non-blocker split the PR timeline row shows.
 * Returns null when there are no findings (the cell renders "—").
 */
export function findingCountsOf(run: CiRunSummary): PrFindingCounts | null {
  const total = run.findings_count ?? 0;
  if (total <= 0) return null;
  const critical = Math.min(run.blockers ?? 0, total);
  return { CRITICAL: critical, WARNING: total - critical, SUGGESTION: 0 };
}

/** Compact duration, e.g. 7420 → "7.4s", 74210 → "1m 14s", null → "—". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}m ${s}s`;
}

/** Absolute timestamp for the TIMESTAMP column; "—" when the run has no ran_at. */
export function formatTimestamp(ranAt: string | null | undefined): string {
  if (!ranAt) return "—";
  return new Date(ranAt).toLocaleString();
}

/** GitHub PR URL from repo + number, e.g. "acme/api" #12 → the PR page. */
export function prUrl(repo: string | null, prNumber: number | null): string | null {
  if (!repo || prNumber == null) return null;
  return `https://github.com/${repo}/pull/${prNumber}`;
}

/** Distinct, sorted non-null values of a field across the rows (filter options). */
export function distinct(runs: CiRunSummary[], field: "agent_name" | "repo"): string[] {
  const set = new Set<string>();
  for (const r of runs) {
    const v = r[field];
    if (v) set.add(v);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}
