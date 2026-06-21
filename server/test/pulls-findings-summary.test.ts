import { describe, it, expect } from 'vitest';
import {
  findingCountsByPr,
  type FindingSeverityRow,
} from '../src/modules/pulls/findings-summary.js';

describe('findingCountsByPr', () => {
  it('tallies findings by severity for a PR', () => {
    const rows: FindingSeverityRow[] = [
      { prId: 'pr1', severity: 'CRITICAL' },
      { prId: 'pr1', severity: 'CRITICAL' },
      { prId: 'pr1', severity: 'WARNING' },
      { prId: 'pr1', severity: 'SUGGESTION' },
    ];
    expect(findingCountsByPr(rows).get('pr1')).toEqual({ CRITICAL: 2, WARNING: 1, SUGGESTION: 1 });
  });

  it('tallies across ALL review runs of the PR (rows already pre-filtered to non-dismissed)', () => {
    const rows: FindingSeverityRow[] = [
      { prId: 'pr1', severity: 'WARNING' }, // run A
      { prId: 'pr1', severity: 'CRITICAL' }, // run B
    ];
    expect(findingCountsByPr(rows).get('pr1')).toEqual({ CRITICAL: 1, WARNING: 1, SUGGESTION: 0 });
  });

  it('ignores unknown/legacy severities', () => {
    const rows: FindingSeverityRow[] = [
      { prId: 'pr1', severity: 'CRITICAL' },
      { prId: 'pr1', severity: 'INFO' }, // not one of the three canonical levels
      { prId: 'pr1', severity: 'nit' },
    ];
    expect(findingCountsByPr(rows).get('pr1')).toEqual({ CRITICAL: 1, WARNING: 0, SUGGESTION: 0 });
  });

  it('omits a PR with no findings rows → "—" at the route, not 0·0·0', () => {
    expect(findingCountsByPr([]).has('pr1')).toBe(false);
  });

  it('keeps PRs independent', () => {
    const rows: FindingSeverityRow[] = [
      { prId: 'pr1', severity: 'CRITICAL' },
      { prId: 'pr2', severity: 'SUGGESTION' },
    ];
    const out = findingCountsByPr(rows);
    expect(out.get('pr1')).toEqual({ CRITICAL: 1, WARNING: 0, SUGGESTION: 0 });
    expect(out.get('pr2')).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 1 });
    expect(out.size).toBe(2);
  });
});
