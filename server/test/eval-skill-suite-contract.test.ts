import { describe, it, expect } from 'vitest';
import {
  EvalSkillSuiteRun,
  EvalSkillSuiteRunAccepted,
  RunAllSkillsResult,
  EvalSkillRunRequest,
  EvalSkillCaseDelta,
  EvalSkillDeltaClassification,
  EvalSkillSuiteDetail,
  EvalSkillSuiteTrendPoint,
  EvalSkillDashboard,
  EvalSkillSummary,
  EvalSkillsWorkspaceDashboard,
  EvalSkillHostCandidates,
  EvalSkillCompareResult,
} from '@devdigest/shared';

/** A fully-populated `EvalSkillSuiteRun` row for reuse across cases. */
const skillSuiteRun = {
  id: 'sr',
  workspace_id: 'w',
  skill_id: 'sk',
  skill_name: 'no-console',
  skill_version: 4,
  host_agent_id: 'ag',
  host_agent_name: 'Reviewer',
  host_agent_version: 7,
  status: 'done' as const,
  recall: null,
  precision: null,
  citation_accuracy: null,
  passed: 0,
  total: 0,
  cost_usd: null,
  duration_ms: 100,
  ran_at: new Date().toISOString(),
};

/** T1 — skill suite run, trend, dashboard, compare (nullable metrics). */
describe('eval-skill-suite contracts — T1 / AC-17 / AC-26 / AC-28', () => {
  it('EvalSkillSuiteRun carries skill + host identity with NULLABLE metrics (AC-17)', () => {
    expect(EvalSkillSuiteRun.safeParse(skillSuiteRun).success).toBe(true);
    // metrics may be present
    expect(
      EvalSkillSuiteRun.safeParse({ ...skillSuiteRun, recall: 1, precision: 0.5, citation_accuracy: 0 }).success,
    ).toBe(true);
    // skill_name / host_agent_name are nullish (absent on the raw row)
    const { skill_name, host_agent_name, ...raw } = skillSuiteRun;
    expect(EvalSkillSuiteRun.safeParse(raw).success).toBe(true);
    // a bogus status is rejected
    expect(EvalSkillSuiteRun.safeParse({ ...skillSuiteRun, status: 'bogus' }).success).toBe(false);
    // a non-int skill_version is rejected
    expect(EvalSkillSuiteRun.safeParse({ ...skillSuiteRun, skill_version: 4.5 }).success).toBe(false);
  });

  it('EvalSkillSuiteRunAccepted reuses {suite_run_id, status}', () => {
    expect(EvalSkillSuiteRunAccepted.safeParse({ suite_run_id: 's', status: 'running' }).success).toBe(true);
    expect(EvalSkillSuiteRunAccepted.safeParse({ suite_run_id: 's', status: 'bogus' }).success).toBe(false);
  });

  it('EvalSkillSuiteTrendPoint carries skill + host version, all metrics nullable', () => {
    const parsed = EvalSkillSuiteTrendPoint.safeParse({
      suite_run_id: 'sr',
      ran_at: new Date().toISOString(),
      skill_version: 4,
      host_agent_id: 'ag',
      host_agent_version: 7,
      recall: null,
      precision: null,
      citation_accuracy: null,
      pass_rate: null,
      cost_usd: null,
    });
    expect(parsed.success).toBe(true);
    // missing host_agent_version is rejected
    expect(
      EvalSkillSuiteTrendPoint.safeParse({
        suite_run_id: 'sr',
        ran_at: new Date().toISOString(),
        skill_version: 4,
        host_agent_id: 'ag',
        recall: null,
        precision: null,
        citation_accuracy: null,
        pass_rate: null,
        cost_usd: null,
      }).success,
    ).toBe(false);
  });

  it('EvalSkillDashboard aggregates current/delta/trend/recent + nullable alert (AC-26)', () => {
    const parsed = EvalSkillDashboard.safeParse({
      skill_id: 'sk',
      skill_name: 'no-console',
      cases_total: 3,
      current: { recall: null, precision: null, citation_accuracy: null, traces_passed: 0, traces_total: 3, cost_usd: null },
      delta: { recall: null, precision: null, citation_accuracy: null },
      trend: [],
      recent_runs: [skillSuiteRun],
      alert: null,
    });
    expect(parsed.success).toBe(true);
    // a vacuous 0 for traces_passed as a float is rejected (int-only)
    expect(
      EvalSkillDashboard.safeParse({
        skill_id: 'sk',
        skill_name: 'no-console',
        cases_total: 3,
        current: { recall: null, precision: null, citation_accuracy: null, traces_passed: 0.5, traces_total: 3, cost_usd: null },
        delta: { recall: null, precision: null, citation_accuracy: null },
        trend: [],
        recent_runs: [],
        alert: null,
      }).success,
    ).toBe(false);
  });

  it('EvalSkillCompareResult diffs skill bodies + surfaces host_changed, degrades to null bodies (AC-28)', () => {
    const parsed = EvalSkillCompareResult.safeParse({
      run_a: skillSuiteRun,
      run_b: { ...skillSuiteRun, id: 'sr2', host_agent_version: 8 },
      delta: { recall: null, precision: null, citation_accuracy: null, cost_usd: null },
      skill_body_a: null,
      skill_body_b: null,
      host_changed: true,
    });
    expect(parsed.success).toBe(true);
    // host_changed must be a boolean
    expect(
      EvalSkillCompareResult.safeParse({
        run_a: skillSuiteRun,
        run_b: skillSuiteRun,
        delta: { recall: null, precision: null, citation_accuracy: null, cost_usd: null },
        skill_body_a: 'a',
        skill_body_b: 'b',
        host_changed: 'yes',
      }).success,
    ).toBe(false);
  });
});

/** T2 — run-all, workspace dashboard, delta view, detail, host candidates, request. */
describe('eval-skill-suite contracts — T2 / AC-24 / AC-25 / AC-30 / AC-4', () => {
  it('RunAllSkillsResult carries started[] + skipped[] with a no_host reason (AC-25)', () => {
    const parsed = RunAllSkillsResult.safeParse({
      started: [{ skill_id: 'sk', suite_run_id: 's' }],
      skipped: [
        { skill_id: 'a', reason: 'no_cases' },
        { skill_id: 'b', reason: 'no_host' },
        { skill_id: 'c', reason: 'already_running' },
      ],
    });
    expect(parsed.success).toBe(true);
    expect(
      RunAllSkillsResult.safeParse({ started: [], skipped: [{ skill_id: 'a', reason: 'nope' }] }).success,
    ).toBe(false);
  });

  it('EvalSkillRunRequest is {host_agent_id}', () => {
    expect(EvalSkillRunRequest.safeParse({ host_agent_id: 'ag' }).success).toBe(true);
    expect(EvalSkillRunRequest.safeParse({}).success).toBe(false);
  });

  it('EvalSkillCaseDelta findings carry a caught/noise/ignored classification (AC-30)', () => {
    const parsed = EvalSkillCaseDelta.safeParse({
      findings: [
        { file: 'a.ts', start_line: 10, end_line: 12, severity: 'CRITICAL', category: 'security', title: 't', classification: 'caught' },
        { file: 'b.ts', start_line: 1, end_line: 1, classification: 'noise' },
      ],
    });
    expect(parsed.success).toBe(true);
    expect(EvalSkillDeltaClassification.safeParse('ignored').success).toBe(true);
    // an unknown classification is rejected
    expect(
      EvalSkillCaseDelta.safeParse({ findings: [{ file: 'a.ts', start_line: 1, end_line: 1, classification: 'maybe' }] }).success,
    ).toBe(false);
  });

  it('EvalSkillSuiteDetail = suite + per-case run rows', () => {
    const parsed = EvalSkillSuiteDetail.safeParse({
      suite: skillSuiteRun,
      runs: [
        {
          id: 'r', case_id: 'c', ran_at: new Date().toISOString(), actual_output: null,
          pass: false, recall: null, precision: null, citation_accuracy: null,
          duration_ms: null, cost_usd: null, suite_run_id: null, error: null,
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('EvalSkillsWorkspaceDashboard = skills[] + recent_runs[], per-skill sparklines (AC-24)', () => {
    const summary = {
      skill_id: 'sk',
      skill_name: 'no-console',
      enabled: true,
      cases_total: 2,
      current: { recall: null, precision: null, citation_accuracy: null },
      sparklines: { recall: [1, 0.5], precision: [], citation_accuracy: [0] },
      last_run: null,
    };
    expect(EvalSkillSummary.safeParse(summary).success).toBe(true);
    expect(
      EvalSkillsWorkspaceDashboard.safeParse({ skills: [summary], recent_runs: [skillSuiteRun] }).success,
    ).toBe(true);
    // enabled must be a boolean
    expect(EvalSkillSummary.safeParse({ ...summary, enabled: 'yes' }).success).toBe(false);
  });

  it('EvalSkillHostCandidates has a nullable default_host_id + candidate list (AC-4)', () => {
    expect(
      EvalSkillHostCandidates.safeParse({
        default_host_id: 'ag',
        candidates: [{ id: 'ag', name: 'Reviewer', version: 7, enabled: true }],
      }).success,
    ).toBe(true);
    // default_host_id may be null (no agent links the skill)
    expect(EvalSkillHostCandidates.safeParse({ default_host_id: null, candidates: [] }).success).toBe(true);
    // a non-int version is rejected
    expect(
      EvalSkillHostCandidates.safeParse({
        default_host_id: null,
        candidates: [{ id: 'ag', name: 'Reviewer', version: 7.5, enabled: true }],
      }).success,
    ).toBe(false);
  });
});
