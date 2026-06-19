import { describe, it, expect } from 'vitest';
import { latestBatchCostByPr, type RunCostRow } from '../src/modules/pulls/cost.js';

/**
 * Rows are always passed newest-first (the route orders by ran_at DESC), so the
 * first batch_id seen per PR is its latest batch. These fixtures keep that order.
 */
describe('latestBatchCostByPr', () => {
  it('sums every priced run in the latest batch (one "Review all")', () => {
    const rows: RunCostRow[] = [
      { prId: 'pr1', batchId: 'b2', costUsd: 0.0013 },
      { prId: 'pr1', batchId: 'b2', costUsd: 0.0014 },
    ];
    expect(latestBatchCostByPr(rows).get('pr1')).toBeCloseTo(0.0027, 6);
  });

  it('ignores older batches — only the most recent one counts', () => {
    const rows: RunCostRow[] = [
      { prId: 'pr1', batchId: 'b2', costUsd: 0.002 }, // latest
      { prId: 'pr1', batchId: 'b1', costUsd: 0.05 }, // older — excluded
    ];
    expect(latestBatchCostByPr(rows).get('pr1')).toBeCloseTo(0.002, 6);
  });

  it('sums only the priced runs when the latest batch is mixed', () => {
    const rows: RunCostRow[] = [
      { prId: 'pr1', batchId: 'b1', costUsd: 0.003 },
      { prId: 'pr1', batchId: 'b1', costUsd: null }, // failed/cancelled agent
    ];
    expect(latestBatchCostByPr(rows).get('pr1')).toBeCloseTo(0.003, 6);
  });

  it('omits a PR whose latest batch has no priced run → null at the route, not $0.00', () => {
    const rows: RunCostRow[] = [
      { prId: 'pr1', batchId: 'b1', costUsd: null },
      { prId: 'pr1', batchId: 'b1', costUsd: null },
    ];
    expect(latestBatchCostByPr(rows).has('pr1')).toBe(false);
  });

  it('omits legacy runs (batch_id = null, no cost)', () => {
    const rows: RunCostRow[] = [{ prId: 'pr1', batchId: null, costUsd: null }];
    expect(latestBatchCostByPr(rows).has('pr1')).toBe(false);
  });

  it('keeps PRs independent and skips rows with a null prId', () => {
    const rows: RunCostRow[] = [
      { prId: 'pr1', batchId: 'b1', costUsd: 0.01 },
      { prId: 'pr2', batchId: 'b9', costUsd: 0.02 },
      { prId: null, batchId: 'b1', costUsd: 0.99 }, // orphaned run (pr deleted)
    ];
    const out = latestBatchCostByPr(rows);
    expect(out.get('pr1')).toBeCloseTo(0.01, 6);
    expect(out.get('pr2')).toBeCloseTo(0.02, 6);
    expect(out.size).toBe(2);
  });
});
