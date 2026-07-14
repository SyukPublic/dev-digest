/* Multi-Agent Review — pure presentation helpers (feature-local).
   Estimate composition and small formatters shared by ConfigureRun / the
   results header. Cost formatting itself stays in @/lib/format (formatCost). */
import type { AgentEstimate, Conflict } from "@devdigest/shared";

/** A whole-second duration label, or "—" when unknown (never a fabricated 0). */
export function durationLabel(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return `${Math.max(0, Math.round(ms / 1000))}s`;
}

export interface ComposedEstimate {
  durationMs: number | null;
  costUsd: number | null;
}

/**
 * Summed pre-run estimate across the selected agents (AC-7). Because the agents
 * fan out in PARALLEL, wall-clock ≈ the MAX of the per-agent average durations,
 * while total cost ≈ the SUM of the per-agent average costs. Only KNOWN averages
 * contribute; if none are known the aggregate stays null → the UI shows "—",
 * never a fabricated number.
 */
export function composeEstimate(
  estimates: Pick<AgentEstimate, "avg_duration_ms" | "avg_cost_usd">[],
): ComposedEstimate {
  let costUsd: number | null = null;
  let durationMs: number | null = null;
  for (const e of estimates) {
    if (e.avg_cost_usd != null) costUsd = (costUsd ?? 0) + e.avg_cost_usd;
    if (e.avg_duration_ms != null) durationMs = Math.max(durationMs ?? 0, e.avg_duration_ms);
  }
  return { durationMs, costUsd };
}

/** Score-driven accent colour (matches CircularScore's thresholds). */
export function scoreColor(score: number | null | undefined): string {
  if (score == null) return "var(--border-strong)";
  return score >= 75 ? "var(--ok)" : score >= 50 ? "var(--warn)" : "var(--crit)";
}

/**
 * Whether a grouped location is a genuine DISAGREEMENT (AC-23): its takes carry
 * more than one distinct verdict (counting the synthesized `ignored` = "did not
 * flag" as its own value). The block renders every grouped location the server
 * returns; the "Show only conflicts" toggle narrows to these.
 */
export function isDisagreement(conflict: Conflict): boolean {
  const verdicts = new Set(conflict.takes.map((tk) => tk.verdict));
  return verdicts.size > 1;
}
