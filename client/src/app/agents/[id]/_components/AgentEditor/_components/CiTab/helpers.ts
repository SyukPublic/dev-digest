import type { CiRunSummary } from "@devdigest/shared";

/** A CI-run status badge descriptor: an `ci.runs.status.*` key + a colour var. */
export interface CiStatusBadge {
  labelKey: string;
  color: string;
}

/**
 * Map a CI run's lifecycle status to a status badge. Mirrors the deterministic
 * CI outcome (running / failed / no-findings / succeeded), not the model verdict.
 */
export function ciStatusBadge(run: CiRunSummary | undefined): CiStatusBadge | null {
  if (!run) return null;
  const status = run.status ?? "";
  if (status === "running") return { labelKey: "running", color: "var(--accent)" };
  if (status === "failed") return { labelKey: "failed", color: "var(--crit)" };
  if ((run.findings_count ?? 0) === 0) return { labelKey: "noFindings", color: "var(--ok)" };
  return { labelKey: "succeeded", color: "var(--ok)" };
}

/** Newest CI run for an installation (by `ran_at`; missing timestamps sort last). */
export function latestRunFor(runs: CiRunSummary[], installationId: string): CiRunSummary | undefined {
  return runs
    .filter((r) => r.ci_installation_id === installationId)
    .sort((a, b) => (Date.parse(b.ran_at ?? "") || 0) - (Date.parse(a.ran_at ?? "") || 0))[0];
}
