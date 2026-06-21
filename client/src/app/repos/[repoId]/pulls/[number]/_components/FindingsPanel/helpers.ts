import type { FindingRecord, PrFindingCounts, Severity } from "@devdigest/shared";
import { LOW_CONFIDENCE_THRESHOLD, SEVERITY_ORDER } from "./constants";

/** Tally findings by severity (the three canonical levels; others ignored). */
export function countBySeverity(findings: FindingRecord[]): PrFindingCounts {
  const counts: PrFindingCounts = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const f of findings) {
    if (f.severity === "CRITICAL" || f.severity === "WARNING" || f.severity === "SUGGESTION") {
      counts[f.severity] += 1;
    }
  }
  return counts;
}

/**
 * Optionally drop low-confidence findings, filter by active severity levels,
 * then sort by severity. `activeSeverities` undefined ⇒ all levels shown.
 */
export function visibleFindings(
  findings: FindingRecord[],
  hideLow: boolean,
  activeSeverities?: Set<Severity>,
): FindingRecord[] {
  let shown = findings;
  if (hideLow) shown = shown.filter((f) => f.confidence >= LOW_CONFIDENCE_THRESHOLD);
  if (activeSeverities) shown = shown.filter((f) => activeSeverities.has(f.severity));
  return [...shown].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
}
