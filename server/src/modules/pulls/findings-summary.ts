/**
 * PR-list findings rollup (pure — no DB / `this`, so it unit-tests cleanly).
 *
 * The Pull Requests list shows, per PR, a tally of its findings by severity
 * (CRITICAL / WARNING / SUGGESTION). We count the PR's NON-dismissed findings
 * across every review run — the same set the PR detail page (and the list's
 * findings popover) shows — so the column badges and the popover always agree.
 */
import type { PrFindingCounts } from '@devdigest/shared';

/** A `findings ⋈ reviews` row reduced to what the severity tally needs. */
export interface FindingSeverityRow {
  prId: string;
  severity: string;
}

/** Zero tally — also the shape returned for a PR with reviews but no findings. */
function emptyCounts(): PrFindingCounts {
  return { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
}

/**
 * Finding counts by severity per PR.
 *
 * A PR with no findings rows is ABSENT from the returned map → the caller
 * renders "—" rather than "0 · 0 · 0". Unknown/legacy severities are ignored
 * (only the three canonical levels are tallied).
 *
 * @param rows non-dismissed findings (joined to their review's pr_id) for the
 *             listed PRs (order irrelevant — all tallied).
 */
export function findingCountsByPr(rows: FindingSeverityRow[]): Map<string, PrFindingCounts> {
  const byPr = new Map<string, PrFindingCounts>();
  for (const r of rows) {
    if (r.severity !== 'CRITICAL' && r.severity !== 'WARNING' && r.severity !== 'SUGGESTION') {
      continue;
    }
    let counts = byPr.get(r.prId);
    if (!counts) {
      counts = emptyCounts();
      byPr.set(r.prId, counts);
    }
    counts[r.severity] += 1;
  }
  return byPr;
}
