/**
 * Stats pure aggregation (`modules/stats/aggregation.ts`) — the single shared
 * math behind all three surfaces (AC-6/7/8/9/12/13/17/23/24/25/26/30/31/33/34).
 * Fully pure: plain rows in, DTO fragments out; no DB, no clock.
 */
import { describe, it, expect } from 'vitest';
import {
  aggregateAgentCore,
  buildAgentStats,
  buildDashboard,
  buildSkillStats,
  traceSkillShares,
  traceMemoryShares,
  acceptRate,
  type AggRun,
  type AggFinding,
  type AggTrace,
} from '../src/modules/stats/aggregation.js';
import type { Period } from '../src/modules/stats/schemas.js';

const PERIOD: Period = {
  from: new Date('2026-06-17T00:00:00Z'),
  to: new Date('2026-07-17T00:00:00Z'),
};

function run(over: Partial<AggRun> = {}): AggRun {
  return {
    id: 'r1',
    agentId: 'a1',
    ranAt: new Date('2026-07-10T00:00:00Z'),
    durationMs: 6000,
    tokensIn: 100,
    tokensOut: 50,
    costUsd: 0.04,
    source: 'local',
    provider: 'openrouter',
    model: 'gpt-x',
    prNumber: 7,
    prId: 'pr1',
    findingsCount: 2,
    ...over,
  };
}

function finding(over: Partial<AggFinding> = {}): AggFinding {
  return {
    runId: 'r1',
    agentId: 'a1',
    ranAt: new Date('2026-07-10T00:00:00Z'),
    severity: 'WARNING',
    category: 'bug',
    acceptedAt: null,
    dismissedAt: null,
    ...over,
  };
}

describe('acceptRate (AC-8)', () => {
  it('is null when nothing was acted on', () => {
    expect(acceptRate(0, 0)).toBeNull();
  });
  it('is accepted / (accepted + dismissed)', () => {
    expect(acceptRate(3, 1)).toBeCloseTo(0.75);
  });
});

describe('aggregateAgentCore (T6)', () => {
  it('counts runs, findings, and the acted split; accept-rate over acted only', () => {
    const core = aggregateAgentCore({
      agentId: 'a1',
      agentName: 'Sec',
      provider: 'openrouter',
      model: 'gpt-x',
      runs: [run(), run({ id: 'r2' })],
      findings: [
        finding({ acceptedAt: new Date() }),
        finding({ dismissedAt: new Date() }),
        finding(), // pending
      ],
      period: PERIOD,
    });
    expect(core.runs).toBe(2);
    expect(core.findings_total).toBe(3);
    expect(core.accepted).toBe(1);
    expect(core.dismissed).toBe(1);
    expect(core.pending).toBe(1);
    expect(core.accept_rate).toBeCloseTo(0.5);
    expect(core.avg_findings_per_run).toBeCloseTo(1.5);
  });

  it('excludes unpriced runs from cost but still counts them for runs/duration (AC-7)', () => {
    const core = aggregateAgentCore({
      agentId: 'a1',
      agentName: 'Sec',
      provider: null,
      model: null,
      runs: [run({ costUsd: 0.04 }), run({ id: 'r2', costUsd: null })],
      findings: [],
      period: PERIOD,
    });
    expect(core.runs).toBe(2);
    expect(core.total_cost_usd).toBeCloseTo(0.04);
    expect(core.avg_cost_usd).toBeCloseTo(0.04); // avg over PRICED runs only
  });

  it('null cost when no run is priced (never 0)', () => {
    const core = aggregateAgentCore({
      agentId: 'a1',
      agentName: 'Sec',
      provider: null,
      model: null,
      runs: [run({ costUsd: null })],
      findings: [],
      period: PERIOD,
    });
    expect(core.total_cost_usd).toBeNull();
    expect(core.avg_cost_usd).toBeNull();
  });

  it('buckets severity by week oldest→newest (AC-25)', () => {
    const core = aggregateAgentCore({
      agentId: 'a1',
      agentName: 'Sec',
      provider: null,
      model: null,
      runs: [run()],
      findings: [
        finding({ severity: 'CRITICAL', ranAt: new Date('2026-06-18T00:00:00Z') }),
        finding({ severity: 'SUGGESTION', ranAt: new Date('2026-07-16T00:00:00Z') }),
      ],
      period: PERIOD,
    });
    const weekly = core.findings_by_severity_weekly;
    expect(weekly.length).toBeGreaterThanOrEqual(1);
    expect(weekly.length).toBeLessThanOrEqual(6);
    expect(weekly[0]!.week).toBe('w1');
    // earliest finding lands in the first bucket, latest in the last
    expect(weekly[0]!.CRITICAL).toBe(1);
    expect(weekly[weekly.length - 1]!.SUGGESTION).toBe(1);
  });

  it('caps at exactly 6 weekly buckets over a long (13-week) period, oldest→newest (AC-25)', () => {
    const longPeriod: Period = {
      from: new Date('2026-04-19T00:00:00Z'), // 90 days back
      to: new Date('2026-07-17T00:00:00Z'),
    };
    const core = aggregateAgentCore({
      agentId: 'a1',
      agentName: 'Sec',
      provider: null,
      model: null,
      runs: [run()],
      findings: [
        // oldest — must land in the FIRST bucket even though the period spans
        // ~13 raw weeks (capped to MAX_WEEKLY_BUCKETS=6).
        finding({ severity: 'CRITICAL', ranAt: new Date('2026-04-20T00:00:00Z') }),
        // a mid-period finding, just to have some spread.
        finding({ severity: 'WARNING', ranAt: new Date('2026-06-01T00:00:00Z') }),
        // newest — must land in the LAST bucket.
        finding({ severity: 'SUGGESTION', ranAt: new Date('2026-07-16T00:00:00Z') }),
      ],
      period: longPeriod,
    });
    const weekly = core.findings_by_severity_weekly;
    expect(weekly.length).toBe(6); // capped, not just "≤ 6" — a 13-raw-week span really squeezes down
    expect(weekly[0]!.week).toBe('w1');
    expect(weekly[5]!.week).toBe('w6');
    expect(weekly[0]!.CRITICAL).toBe(1); // oldest finding → first bucket
    expect(weekly[5]!.SUGGESTION).toBe(1); // newest finding → last bucket
  });

  it('findings_by_category segments by count (AC-26)', () => {
    const core = aggregateAgentCore({
      agentId: 'a1',
      agentName: 'Sec',
      provider: null,
      model: null,
      runs: [run()],
      findings: [finding({ category: 'security' }), finding({ category: 'security' }), finding({ category: 'bug' })],
      period: PERIOD,
    });
    expect(core.findings_by_category[0]).toEqual({ category: 'security', count: 2 });
  });

  it('computes period-over-period deltas from the previous window', () => {
    const core = aggregateAgentCore({
      agentId: 'a1',
      agentName: 'Sec',
      provider: null,
      model: null,
      runs: [run({ costUsd: 0.05 })],
      findings: [finding({ acceptedAt: new Date() })],
      period: PERIOD,
      previous: {
        runs: [run({ id: 'p1', costUsd: 0.06 })],
        findings: [finding({ dismissedAt: new Date() })],
      },
    });
    expect(core.avg_cost_delta_usd).toBeCloseTo(-0.01);
    expect(core.accept_rate_delta).toBeCloseTo(1); // 1.0 now vs 0.0 before
  });
});

describe('traceSkillShares / traceMemoryShares (T7, AC-9/23/24)', () => {
  const traces: AggTrace[] = [
    { runId: 'r1', trace: { prompt_assembly: { skill_tokens: [{ name: 'secret-leakage-gate' }] }, memory_pulled: [{ text: 'raw-body parser' }] } },
    { runId: 'r2', trace: { prompt_assembly: { skill_tokens: [{ name: 'secret-leakage-gate' }, { name: 'lethal-trifecta' }] } } },
  ];

  it('shares are 0..1 over total period runs, sorted desc', () => {
    const shares = traceSkillShares(traces, 2);
    expect(shares[0]).toEqual({ name: 'secret-leakage-gate', pct: 1 });
    expect(shares[1]).toEqual({ name: 'lethal-trifecta', pct: 0.5 });
  });

  it('degrades a malformed/absent trace to no contribution, never throws (AC-9)', () => {
    const bad: AggTrace[] = [
      { runId: 'r1', trace: null },
      { runId: 'r2', trace: { prompt_assembly: 'nope' } },
      { runId: 'r3', trace: { prompt_assembly: { skill_tokens: 'bad' } } },
    ];
    expect(() => traceSkillShares(bad, 3)).not.toThrow();
    expect(traceSkillShares(bad, 3)).toEqual([]);
    expect(traceMemoryShares(bad, 3)).toEqual([]);
  });

  it('empty input → []', () => {
    expect(traceSkillShares([], 0)).toEqual([]);
    expect(traceMemoryShares([], 5)).toEqual([]);
  });

  it('memory shares key by label', () => {
    expect(traceMemoryShares(traces, 2)[0]).toEqual({ label: 'raw-body parser', pct: 0.5 });
  });
});

describe('buildAgentStats includes source in run history (AC-27/35)', () => {
  it('maps local + ci runs with a source flag, newest first', () => {
    const stats = buildAgentStats({
      agentId: 'a1',
      agentName: 'Sec',
      provider: null,
      model: null,
      runs: [
        run({ id: 'r1', source: 'local', ranAt: new Date('2026-07-01T00:00:00Z') }),
        run({ id: 'r2', source: 'ci', ranAt: new Date('2026-07-10T00:00:00Z') }),
      ],
      findings: [],
      period: PERIOD,
      traces: [],
    });
    expect(stats.run_history.map((r) => r.source)).toEqual(['ci', 'local']);
    expect(stats.run_history[0]!.run_id).toBe('r2');
  });
});

describe('buildDashboard (T8, AC-14/17/34)', () => {
  const agents = [
    { agentId: 'a1', agentName: 'Security Reviewer', provider: 'openrouter', model: 'm1' },
    { agentId: 'a2', agentName: 'Perf Reviewer', provider: 'openrouter', model: 'm2' },
  ];
  const runs: AggRun[] = [
    run({ id: 'r1', agentId: 'a1', costUsd: 0.04, model: 'm1' }),
    run({ id: 'r2', agentId: 'a1', costUsd: 0.04, model: 'm1' }),
    run({ id: 'r3', agentId: 'a2', costUsd: 0.02, model: 'm2' }),
    run({ id: 'orphan', agentId: null, costUsd: 0.99, model: 'm3' }), // deleted-agent orphan
  ];
  const findings: AggFinding[] = [
    finding({ runId: 'r1', agentId: 'a1', acceptedAt: new Date() }),
    finding({ runId: 'r3', agentId: 'a2', dismissedAt: new Date() }),
  ];

  it('one row per live agent with runs; default sort accept-rate desc (AC-14)', () => {
    const perf = buildDashboard({ agents, runs, findings, period: PERIOD });
    expect(perf.agents.map((r) => r.agent_id)).toEqual(['a1', 'a2']);
    expect(perf.agents[0]!.accept_rate).toBe(1); // a1 accepted
    expect(perf.agents[1]!.accept_rate).toBe(0); // a2 dismissed
  });

  it('most-active agent = most runs in period', () => {
    const perf = buildDashboard({ agents, runs, findings, period: PERIOD });
    expect(perf.summary.most_active_agent).toBe('Security Reviewer');
  });

  it('orphan cost folds into workspace total but not into cost_by_agent (AC-17, T8)', () => {
    const perf = buildDashboard({ agents, runs, findings, period: PERIOD });
    expect(perf.summary.total_cost_usd).toBeCloseTo(0.04 + 0.04 + 0.02 + 0.99);
    expect(perf.cost_by_agent.map((s) => s.label)).toEqual(['Security Reviewer', 'Perf Reviewer']);
    // orphan model still shows in cost_by_model (model known even without an agent)
    expect(perf.cost_by_model.some((s) => s.label === 'm3')).toBe(true);
  });

  it('dashboard row == per-agent stats tab for same agent+period (AC-34 parity)', () => {
    const perf = buildDashboard({ agents, runs, findings, period: PERIOD });
    const a1Runs = runs.filter((r) => r.agentId === 'a1');
    const a1Findings = findings.filter((f) => f.agentId === 'a1');
    const tab = buildAgentStats({
      agentId: 'a1',
      agentName: 'Security Reviewer',
      provider: 'openrouter',
      model: 'm1',
      runs: a1Runs,
      findings: a1Findings,
      period: PERIOD,
      traces: [],
    });
    const row = perf.agents.find((r) => r.agent_id === 'a1')!;
    expect(row.accept_rate).toBe(tab.accept_rate);
    expect(row.total_cost_usd).toBe(tab.total_cost_usd);
    expect(row.findings_by_severity).toEqual(tab.findings_by_severity);
    expect(row.trend).toEqual(tab.trend.map((p) => p.value));
  });
});

describe('buildSkillStats (T9, AC-30/31/33)', () => {
  const runs: AggRun[] = [
    run({ id: 'r1', agentId: 'a1' }),
    run({ id: 'r2', agentId: 'a1' }),
    run({ id: 'r3', agentId: 'a2' }),
  ];
  const traces: AggTrace[] = [
    { runId: 'r1', trace: { prompt_assembly: { skill_tokens: [{ name: 'pr-quality-rubric' }] } } },
    { runId: 'r2', trace: { prompt_assembly: { skill_tokens: [{ name: 'other' }] } } },
    { runId: 'r3', trace: { prompt_assembly: { skill_tokens: [{ name: 'pr-quality-rubric' }] } } },
  ];
  const findings: AggFinding[] = [
    finding({ runId: 'r1', acceptedAt: new Date(), category: 'security' }),
    finding({ runId: 'r2', dismissedAt: new Date() }), // NOT in pulled subset
    finding({ runId: 'r3', dismissedAt: new Date(), category: 'bug' }),
  ];

  it('pull frequency = pulled runs / linked-agent period runs (AC-31)', () => {
    const s = buildSkillStats({
      skillId: 's1',
      skillName: 'pr-quality-rubric',
      usedByAgents: 3,
      agents: [{ agent_id: 'a1', agent_name: 'Sec' }],
      runs,
      traces,
      findings,
    });
    expect(s.pull_frequency).toBeCloseTo(2 / 3); // r1 + r3 pulled it
    expect(s.used_by_agents).toBe(3);
  });

  it('accept-rate + findings + category are over the pulled-the-skill subset only', () => {
    const s = buildSkillStats({
      skillId: 's1',
      skillName: 'pr-quality-rubric',
      usedByAgents: 3,
      agents: [],
      runs,
      traces,
      findings,
    });
    // subset = r1 (accepted, security) + r3 (dismissed, bug); r2 excluded
    expect(s.findings_total).toBe(2);
    expect(s.accept_rate).toBeCloseTo(0.5);
    expect(s.findings_by_category).toEqual(
      expect.arrayContaining([
        { category: 'security', count: 1 },
        { category: 'bug', count: 1 },
      ]),
    );
  });

  it('pull frequency is null when there are no linked-agent runs (AC-31)', () => {
    const s = buildSkillStats({
      skillId: 's1',
      skillName: 'pr-quality-rubric',
      usedByAgents: 0,
      agents: [],
      runs: [],
      traces: [],
      findings: [],
    });
    expect(s.pull_frequency).toBeNull();
  });
});
