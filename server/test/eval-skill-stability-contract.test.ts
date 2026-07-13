import { describe, it, expect } from 'vitest';
import {
  EvalSkillStabilityGroup,
  EvalMetricStat,
  EvalSkillStabilitySummary,
  EvalSkillCaseStability,
  EvalSkillStabilityAlert,
  EvalSkillStabilityDetail,
  EvalSkillStabilityGroupAccepted,
  EvalSkillStabilityRequest,
  EvalSkillDashboardWithStability,
} from '@devdigest/shared';

/**
 * T1/T2 — the stability-layer contracts (SPEC-2026-07-12-skill-eval-stability).
 * `test_stability_contracts` → AC-1, AC-3, AC-5, AC-7, AC-10.
 */

const group = {
  id: 'g1',
  workspace_id: 'w',
  skill_id: 'sk',
  skill_version: 4,
  host_agent_id: 'ag',
  host_agent_version: 7,
  n_requested: 5,
  status: 'running' as const,
  run_ids: ['r1', 'r2'],
  ran_at: new Date().toISOString(),
};

const stat = { mean: 0.8, stddev: 0.05, n: 5, indicative: false };

const summary = {
  recall: stat,
  precision: null,
  citation_accuracy: stat,
  cost: null,
  runs_completed: 5,
  runs_failed: 0,
};

describe('eval-skill-stability contracts — T1 / AC-1/AC-3/AC-5/AC-7', () => {
  it('EvalSkillStabilityGroup carries snapshot identity + run_ids + status', () => {
    expect(EvalSkillStabilityGroup.safeParse(group).success).toBe(true);
    // a non-int n_requested is rejected
    expect(EvalSkillStabilityGroup.safeParse({ ...group, n_requested: 2.5 }).success).toBe(false);
    // a bogus status is rejected
    expect(EvalSkillStabilityGroup.safeParse({ ...group, status: 'bogus' }).success).toBe(false);
  });

  it('EvalMetricStat = {mean, stddev, n, indicative}; nullable in the summary', () => {
    expect(EvalMetricStat.safeParse(stat).success).toBe(true);
    // non-int n rejected
    expect(EvalMetricStat.safeParse({ ...stat, n: 5.5 }).success).toBe(false);
    // indicative must be boolean
    expect(EvalMetricStat.safeParse({ ...stat, indicative: 'no' }).success).toBe(false);
  });

  it('EvalSkillStabilitySummary allows null metric stats + carries run counts (AC-3)', () => {
    expect(EvalSkillStabilitySummary.safeParse(summary).success).toBe(true);
    // runs_completed must be int
    expect(EvalSkillStabilitySummary.safeParse({ ...summary, runs_completed: 1.5 }).success).toBe(false);
  });

  it('EvalSkillCaseStability carries pass_rate + flaky/non_discriminating flags (AC-5)', () => {
    expect(
      EvalSkillCaseStability.safeParse({
        case_id: 'c',
        pass_rate: 0.5,
        runs: 4,
        flaky: true,
        non_discriminating: false,
      }).success,
    ).toBe(true);
    // flaky must be boolean
    expect(
      EvalSkillCaseStability.safeParse({
        case_id: 'c',
        pass_rate: 0.5,
        runs: 4,
        flaky: 'yes',
        non_discriminating: false,
      }).success,
    ).toBe(false);
  });

  it('EvalSkillStabilityAlert = {metric, move, band, beyond_band} (AC-7/UD-3)', () => {
    expect(
      EvalSkillStabilityAlert.safeParse({ metric: 'precision', move: 3, band: 2, beyond_band: true }).success,
    ).toBe(true);
    // an unknown metric is rejected (recall/precision/citation_accuracy only)
    expect(
      EvalSkillStabilityAlert.safeParse({ metric: 'cost', move: 3, band: 2, beyond_band: true }).success,
    ).toBe(false);
    // beyond_band must be boolean
    expect(
      EvalSkillStabilityAlert.safeParse({ metric: 'recall', move: 3, band: 2, beyond_band: 'yes' }).success,
    ).toBe(false);
  });

  it('EvalSkillStabilityRequest enforces 2 ≤ n ≤ 5 at the edge', () => {
    expect(EvalSkillStabilityRequest.safeParse({ host_agent_id: 'ag', n: 3 }).success).toBe(true);
    expect(EvalSkillStabilityRequest.safeParse({ host_agent_id: 'ag', n: 1 }).success).toBe(false);
    expect(EvalSkillStabilityRequest.safeParse({ host_agent_id: 'ag', n: 6 }).success).toBe(false);
    expect(EvalSkillStabilityRequest.safeParse({ host_agent_id: 'ag', n: 2.5 }).success).toBe(false);
    // host required
    expect(EvalSkillStabilityRequest.safeParse({ n: 3 }).success).toBe(false);
  });

  it('EvalSkillStabilityGroupAccepted = {group_id, status}', () => {
    expect(EvalSkillStabilityGroupAccepted.safeParse({ group_id: 'g', status: 'running' }).success).toBe(true);
    expect(EvalSkillStabilityGroupAccepted.safeParse({ group_id: 'g', status: 'bogus' }).success).toBe(false);
  });

  it('EvalSkillStabilityDetail = group + nullable summary + cases', () => {
    expect(
      EvalSkillStabilityDetail.safeParse({ group, summary: null, cases: [] }).success,
    ).toBe(true);
    expect(
      EvalSkillStabilityDetail.safeParse({
        group,
        summary,
        cases: [{ case_id: 'c', pass_rate: 1, runs: 5, flaky: false, non_discriminating: true }],
      }).success,
    ).toBe(true);
  });
});

describe('EvalSkillDashboardWithStability — T2 / AC-7/AC-10 (composed, additive)', () => {
  const base = {
    skill_id: 'sk',
    skill_name: 'no-console',
    cases_total: 3,
    current: { recall: null, precision: null, citation_accuracy: null, traces_passed: 0, traces_total: 3, cost_usd: null },
    delta: { recall: null, precision: null, citation_accuracy: null },
    trend: [],
    recent_runs: [],
    alert: null,
  };

  it('extends the shipped dashboard with stability fields (parent shape preserved)', () => {
    const parsed = EvalSkillDashboardWithStability.safeParse({
      ...base,
      stability: summary,
      stability_group: group,
      case_stability: [{ case_id: 'c', pass_rate: 0.5, runs: 4, flaky: true, non_discriminating: false }],
      stability_alert: { metric: 'precision', move: 3, band: 1, beyond_band: true },
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts null stability / group / alert with an empty case_stability', () => {
    expect(
      EvalSkillDashboardWithStability.safeParse({
        ...base,
        stability: null,
        stability_group: null,
        case_stability: [],
        stability_alert: null,
      }).success,
    ).toBe(true);
  });

  it('preserves the parent string alert unchanged (UD-3 back-compat)', () => {
    const parsed = EvalSkillDashboardWithStability.safeParse({
      ...base,
      alert: 'Precision dipped 3pts on skill v4',
      stability: null,
      stability_group: null,
      case_stability: [],
      stability_alert: null,
    });
    expect(parsed.success).toBe(true);
  });
});
