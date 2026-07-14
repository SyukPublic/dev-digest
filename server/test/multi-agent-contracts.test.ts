import { describe, it, expect } from 'vitest';
import {
  MultiAgentRunRequest,
  MultiAgentRunLaunch,
  AgentEstimate,
  AgentEstimates,
  RunTrace,
} from '@devdigest/shared';

/**
 * Phase 1 contract tests (T1, T2) for multi-agent review.
 * Pure unit — no DB. Covers the NEW launch/estimate transport shapes and the
 * additive RunTrace.grounding_dropped field (the result view shapes live in
 * contracts/observability.ts and are reused unchanged, not re-tested here).
 */

// ── T1: MultiAgentRunRequest ─────────────────────────────────────────────────
describe('MultiAgentRunRequest contract (T1)', () => {
  it('parses a request with one or more agent ids', () => {
    expect(MultiAgentRunRequest.parse({ agent_ids: ['a1'] })).toEqual({ agent_ids: ['a1'] });
    expect(MultiAgentRunRequest.parse({ agent_ids: ['a1', 'a2', 'a3'] }).agent_ids).toHaveLength(3);
  });

  it('rejects an empty agent_ids array (min 1)', () => {
    expect(MultiAgentRunRequest.safeParse({ agent_ids: [] }).success).toBe(false);
  });

  it('rejects a missing agent_ids field and non-string members', () => {
    expect(MultiAgentRunRequest.safeParse({}).success).toBe(false);
    expect(MultiAgentRunRequest.safeParse({ agent_ids: [1, 2] }).success).toBe(false);
  });
});

// ── T1: MultiAgentRunLaunch ──────────────────────────────────────────────────
describe('MultiAgentRunLaunch contract (T1)', () => {
  const launch = {
    multi_run_id: 'mr_1',
    pr_id: 'pr_1',
    runs: [
      { run_id: 'r1', agent_id: 'a1', agent_name: 'Security' },
      { run_id: 'r2', agent_id: 'a2', agent_name: 'Performance' },
    ],
  };

  it('parses a fire-and-forget launch ack and round-trips without loss', () => {
    const parsed = MultiAgentRunLaunch.parse(launch);
    expect(parsed.multi_run_id).toBe('mr_1');
    expect(parsed.runs).toHaveLength(2);
    expect(parsed.runs[0]).toEqual({ run_id: 'r1', agent_id: 'a1', agent_name: 'Security' });
    expect(MultiAgentRunLaunch.parse(launch)).toEqual(launch);
  });

  it('parses a launch with an empty runs array (nothing launched)', () => {
    expect(
      MultiAgentRunLaunch.safeParse({ multi_run_id: 'mr_0', pr_id: 'pr_0', runs: [] }).success,
    ).toBe(true);
  });

  it('rejects a run missing run_id/agent_id/agent_name, or a missing top-level field', () => {
    expect(
      MultiAgentRunLaunch.safeParse({
        multi_run_id: 'mr_1',
        pr_id: 'pr_1',
        runs: [{ run_id: 'r1', agent_id: 'a1' }],
      }).success,
    ).toBe(false);
    expect(MultiAgentRunLaunch.safeParse({ pr_id: 'pr_1', runs: [] }).success).toBe(false);
  });
});

// ── T1: AgentEstimate / AgentEstimates ───────────────────────────────────────
describe('AgentEstimate contract (T1)', () => {
  it('parses an estimate backed by history', () => {
    const est = AgentEstimate.parse({
      agent_id: 'a1',
      agent_name: 'Security',
      avg_duration_ms: 42000,
      avg_cost_usd: 0.031,
      sample_size: 12,
    });
    expect(est.avg_duration_ms).toBe(42000);
    expect(est.sample_size).toBe(12);
  });

  it('parses a no-history estimate: null averages, sample_size 0 (never 0-as-unknown)', () => {
    const est = AgentEstimate.parse({
      agent_id: 'a1',
      agent_name: 'Security',
      avg_duration_ms: null,
      avg_cost_usd: null,
      sample_size: 0,
    });
    expect(est.avg_duration_ms).toBeNull();
    expect(est.avg_cost_usd).toBeNull();
    expect(est.sample_size).toBe(0);
  });

  it('requires the averages to be present (nullable, not optional)', () => {
    expect(
      AgentEstimate.safeParse({ agent_id: 'a1', agent_name: 'Security', sample_size: 0 }).success,
    ).toBe(false);
  });

  it('rejects a negative or non-integer sample_size', () => {
    expect(
      AgentEstimate.safeParse({
        agent_id: 'a1',
        agent_name: 'Security',
        avg_duration_ms: null,
        avg_cost_usd: null,
        sample_size: -1,
      }).success,
    ).toBe(false);
    expect(
      AgentEstimate.safeParse({
        agent_id: 'a1',
        agent_name: 'Security',
        avg_duration_ms: null,
        avg_cost_usd: null,
        sample_size: 1.5,
      }).success,
    ).toBe(false);
  });

  it('AgentEstimates parses an array (possibly empty)', () => {
    expect(AgentEstimates.parse([])).toEqual([]);
    const many = AgentEstimates.parse([
      { agent_id: 'a1', agent_name: 'Security', avg_duration_ms: null, avg_cost_usd: null, sample_size: 0 },
      { agent_id: 'a2', agent_name: 'Perf', avg_duration_ms: 10, avg_cost_usd: 0.01, sample_size: 3 },
    ]);
    expect(many).toHaveLength(2);
  });
});

// ── T2: RunTrace.grounding_dropped (additive, optional) ──────────────────────
describe('RunTrace.grounding_dropped contract (T2)', () => {
  const baseTrace = {
    config: { agent: 'security', model: 'gpt-x', source: 'local' as const },
    stats: {
      duration_ms: 1000,
      tokens_in: 10,
      tokens_out: 20,
      cost_usd: null,
      findings: 0,
      grounding: 'ok',
    },
    prompt_assembly: { system: 'sys', user: 'usr' },
    tool_calls: [],
    raw_output: '',
    memory_pulled: [],
    specs_read: [],
    log: [],
  };

  it('parses an OLD (field-less) trace unchanged — grounding_dropped is optional (AC-31)', () => {
    const parsed = RunTrace.parse(baseTrace);
    expect(parsed.grounding_dropped).toBeUndefined();
  });

  it('parses a trace WITH grounding_dropped items', () => {
    const parsed = RunTrace.parse({
      ...baseTrace,
      grounding_dropped: [
        {
          title: 'Possible NPE',
          file: 'src/x.ts',
          start_line: 10,
          end_line: 12,
          reason: 'not in diff',
        },
      ],
    });
    expect(parsed.grounding_dropped).toHaveLength(1);
    expect(parsed.grounding_dropped?.[0].reason).toBe('not in diff');
  });

  it('accepts null for grounding_dropped (nullish)', () => {
    expect(RunTrace.safeParse({ ...baseTrace, grounding_dropped: null }).success).toBe(true);
  });

  it('rejects a dropped item missing a required sub-field', () => {
    expect(
      RunTrace.safeParse({
        ...baseTrace,
        grounding_dropped: [{ title: 't', file: 'f', start_line: 1, end_line: 2 }],
      }).success,
    ).toBe(false);
  });
});
