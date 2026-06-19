/**
 * PR-list cost rollup (pure — no DB / `this`, so it unit-tests cleanly).
 *
 * The Pull Requests list shows, per PR, the cost of its LATEST review BATCH.
 * One "Review all" fan-out shares a `batch_id`, so the latest batch is the
 * `batch_id` of the most recent run; we sum the PRICED runs in that batch.
 */

/** An `agent_runs` row reduced to what the batch-cost sum needs. */
export interface RunCostRow {
  prId: string | null;
  batchId: string | null;
  costUsd: number | null;
}

/**
 * Cost (USD) of each PR's latest review batch.
 *
 * A PR whose latest batch has no priced run (only failed/cancelled, or legacy
 * runs created before the `cost_usd` column with `batch_id = null`) is ABSENT
 * from the returned map — so the caller renders "—", never "$0.00".
 *
 * @param rows agent_runs rows for the listed PRs, ORDERED BY ran_at DESC.
 */
export function latestBatchCostByPr(rows: RunCostRow[]): Map<string, number> {
  // Newest-first → the first batch_id seen per PR is its latest batch.
  const latestBatch = new Map<string, string | null>();
  for (const r of rows) {
    if (r.prId && !latestBatch.has(r.prId)) latestBatch.set(r.prId, r.batchId);
  }
  const cost = new Map<string, number>();
  for (const r of rows) {
    if (!r.prId || r.batchId !== latestBatch.get(r.prId) || r.costUsd == null) continue;
    cost.set(r.prId, (cost.get(r.prId) ?? 0) + r.costUsd);
  }
  return cost;
}
