/**
 * PR-list cost rollup (pure — no DB / `this`, so it unit-tests cleanly).
 *
 * The Pull Requests list shows, per PR, the TOTAL cost of ALL its review runs —
 * every `agent_runs` row for the PR, across every batch — summing the priced
 * runs and ignoring the rest. "What this PR has cost to review so far."
 */

/** An `agent_runs` row reduced to what the cost sum needs. */
export interface RunCostRow {
  prId: string | null;
  costUsd: number | null;
}

/**
 * Total cost (USD) across every priced run of each PR.
 *
 * A PR with no priced run (only failed/cancelled, or legacy runs created before
 * the `cost_usd` column) is ABSENT from the returned map — so the caller renders
 * "—", never "$0.00".
 *
 * @param rows agent_runs rows for the listed PRs (order irrelevant — all summed).
 */
export function totalCostByPr(rows: RunCostRow[]): Map<string, number> {
  const cost = new Map<string, number>();
  for (const r of rows) {
    if (!r.prId || r.costUsd == null) continue;
    cost.set(r.prId, (cost.get(r.prId) ?? 0) + r.costUsd);
  }
  return cost;
}
