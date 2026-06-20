import { describe, it, expect } from 'vitest';
import { totalCostByPr, type RunCostRow } from '../src/modules/pulls/cost.js';

describe('totalCostByPr', () => {
  it('sums every priced run of the PR (one "Review all" batch)', () => {
    const rows: RunCostRow[] = [
      { prId: 'pr1', costUsd: 0.0013 },
      { prId: 'pr1', costUsd: 0.0014 },
    ];
    expect(totalCostByPr(rows).get('pr1')).toBeCloseTo(0.0027, 6);
  });

  it('sums across ALL batches, not just the latest one', () => {
    const rows: RunCostRow[] = [
      { prId: 'pr1', costUsd: 0.002 }, // newest batch
      { prId: 'pr1', costUsd: 0.05 }, // older batch — still counted
    ];
    expect(totalCostByPr(rows).get('pr1')).toBeCloseTo(0.052, 6);
  });

  it('skips unpriced (failed/cancelled) runs while summing the priced ones', () => {
    const rows: RunCostRow[] = [
      { prId: 'pr1', costUsd: 0.003 },
      { prId: 'pr1', costUsd: null }, // failed/cancelled agent
      { prId: 'pr1', costUsd: 0.001 },
    ];
    expect(totalCostByPr(rows).get('pr1')).toBeCloseTo(0.004, 6);
  });

  it('omits a PR with no priced run → null at the route, not $0.00', () => {
    const rows: RunCostRow[] = [
      { prId: 'pr1', costUsd: null },
      { prId: 'pr1', costUsd: null },
    ];
    expect(totalCostByPr(rows).has('pr1')).toBe(false);
  });

  it('omits legacy runs (no cost)', () => {
    const rows: RunCostRow[] = [{ prId: 'pr1', costUsd: null }];
    expect(totalCostByPr(rows).has('pr1')).toBe(false);
  });

  it('keeps PRs independent and skips rows with a null prId', () => {
    const rows: RunCostRow[] = [
      { prId: 'pr1', costUsd: 0.01 },
      { prId: 'pr2', costUsd: 0.02 },
      { prId: null, costUsd: 0.99 }, // orphaned run (pr deleted)
    ];
    const out = totalCostByPr(rows);
    expect(out.get('pr1')).toBeCloseTo(0.01, 6);
    expect(out.get('pr2')).toBeCloseTo(0.02, 6);
    expect(out.size).toBe(2);
  });
});
