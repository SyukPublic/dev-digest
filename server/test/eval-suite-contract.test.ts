import { describe, it, expect } from 'vitest';
import {
  EvalExpectedOutput,
  EvalSuiteRun,
  EvalSuiteRunAccepted,
  RunAllResult,
  EvalCaseRunRecord,
  EvalNullableMetrics,
  EvalCompareResult,
} from '@devdigest/shared';

/** T2 — the NEW `contracts/eval-suite.ts` shapes (nullable metrics + envelope). */
describe('eval-suite contracts — T2 / AC-1 / AC-2 / AC-31', () => {
  it('EvalExpectedOutput accepts a valid must_find envelope', () => {
    const parsed = EvalExpectedOutput.safeParse({
      expectation: 'must_find',
      findings: [{ file: 'a.ts', start_line: 10, end_line: 12, severity: 'CRITICAL', category: 'security', title: 't' }],
    });
    expect(parsed.success).toBe(true);
  });

  it('EvalExpectedOutput accepts an EMPTY must_not_flag (clean fixture)', () => {
    expect(EvalExpectedOutput.safeParse({ expectation: 'must_not_flag', findings: [] }).success).toBe(true);
  });

  it('EvalExpectedOutput rejects a bad expectation + a missing line range (AC-31)', () => {
    expect(EvalExpectedOutput.safeParse({ expectation: 'maybe', findings: [] }).success).toBe(false);
    expect(
      EvalExpectedOutput.safeParse({ expectation: 'must_find', findings: [{ file: 'a.ts', start_line: 1 }] }).success,
    ).toBe(false);
  });

  it('EvalSuiteRun metrics are NULLABLE (AC-18) and status is the lifecycle enum', () => {
    const row = {
      id: 'r', workspace_id: 'w', agent_id: 'a', agent_version: 7, status: 'done' as const,
      recall: null, precision: null, citation_accuracy: null,
      passed: 0, total: 0, cost_usd: null, duration_ms: 100, ran_at: new Date().toISOString(),
    };
    expect(EvalSuiteRun.safeParse(row).success).toBe(true);
    expect(EvalSuiteRun.safeParse({ ...row, status: 'bogus' }).success).toBe(false);
  });

  it('EvalNullableMetrics allows null on every metric', () => {
    expect(EvalNullableMetrics.safeParse({ recall: null, precision: null, citation_accuracy: null }).success).toBe(true);
  });

  it('EvalSuiteRunAccepted is {suite_run_id, status}', () => {
    expect(EvalSuiteRunAccepted.safeParse({ suite_run_id: 's', status: 'running' }).success).toBe(true);
  });

  it('RunAllResult carries started[] + skipped[] with a reason enum (AC-33)', () => {
    const parsed = RunAllResult.safeParse({
      started: [{ agent_id: 'a', suite_run_id: 's' }],
      skipped: [{ agent_id: 'b', reason: 'no_cases' }, { agent_id: 'c', reason: 'already_running' }],
    });
    expect(parsed.success).toBe(true);
    expect(RunAllResult.safeParse({ started: [], skipped: [{ agent_id: 'b', reason: 'nope' }] }).success).toBe(false);
  });

  it('EvalCaseRunRecord extends EvalRunRecord with error + suite_run_id', () => {
    const parsed = EvalCaseRunRecord.safeParse({
      id: 'r', case_id: 'c', ran_at: new Date().toISOString(), actual_output: null,
      pass: false, recall: null, precision: null, citation_accuracy: null,
      duration_ms: null, cost_usd: null, suite_run_id: null, error: 'boom',
    });
    expect(parsed.success).toBe(true);
  });

  it('EvalCompareResult degrades to config_available=false with null prompts (AC-28)', () => {
    const parsed = EvalCompareResult.safeParse({
      run_a: { id: 'a', workspace_id: 'w', agent_id: 'ag', agent_version: 6, status: 'done', recall: 1, precision: 1, citation_accuracy: 1, passed: 1, total: 1, cost_usd: null, duration_ms: 1, ran_at: new Date().toISOString() },
      run_b: { id: 'b', workspace_id: 'w', agent_id: 'ag', agent_version: 7, status: 'done', recall: 1, precision: 1, citation_accuracy: 1, passed: 1, total: 1, cost_usd: null, duration_ms: 1, ran_at: new Date().toISOString() },
      delta: { recall: 0, precision: 0, citation_accuracy: 0, cost_usd: null },
      system_prompt_a: null,
      system_prompt_b: null,
      config_available: false,
    });
    expect(parsed.success).toBe(true);
  });
});
