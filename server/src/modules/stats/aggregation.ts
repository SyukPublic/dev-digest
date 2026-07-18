/**
 * Stats aggregation — the SINGLE, pure, DB-free implementation of all accept-rate /
 * cost / severity / trend / trace math (mirrors `pulls/cost.ts`: no `this`, no
 * Drizzle, no IO). The dashboard's per-agent rows AND the per-agent Stats tab both
 * call `aggregateAgentCore`, so their numbers cannot drift (AC-34).
 *
 * Every function takes plain rows and returns DTO fragments. Trace jsonb is read
 * RAW (`unknown`) and parsed defensively PER RUN so a malformed/absent document
 * degrades that run's contribution and never throws (AC-9).
 */
import type {
  AgentStats,
  AgentPerf,
  AgentPerfRow,
  PerfCostSegment,
  SkillStats,
  SkillAgentRef,
  StatPoint,
  StatShare,
  MemoryShare,
  CategoryCount,
  SeverityWeek,
  AgentRunHistoryRow,
} from '@devdigest/shared';
import { MAX_WEEKLY_BUCKETS, WEEK_MS, TREND_LIMIT, MAX_RUNS_TREND_BUCKETS } from './constants.js';
import type { Period } from './schemas.js';

// ---------------------------------------------------------------------------
// Input row shapes (plain — what the repository projects out of the DB)
// ---------------------------------------------------------------------------

/** An `agent_runs` row reduced to what the aggregators read. */
export interface AggRun {
  id: string;
  agentId: string | null;
  ranAt: Date | null;
  durationMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  source: 'local' | 'ci';
  provider: string | null;
  model: string | null;
  prNumber: number | null;
  prId: string | null;
  findingsCount: number | null;
}

/** A `findings ⋈ reviews ⋈ agent_runs` row reduced to what the aggregators read. */
export interface AggFinding {
  runId: string | null;
  agentId: string | null;
  ranAt: Date | null;
  severity: string;
  category: string;
  acceptedAt: Date | null;
  dismissedAt: Date | null;
}

/** A run's raw trace document, kept `unknown` for per-run safe parsing (AC-9). */
export interface AggTrace {
  runId: string;
  trace: unknown;
}

type SeverityCounts = { CRITICAL: number; WARNING: number; SUGGESTION: number };

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function emptySeverity(): SeverityCounts {
  return { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
}

function normSeverity(s: string): keyof SeverityCounts | null {
  const u = s.toUpperCase();
  return u === 'CRITICAL' || u === 'WARNING' || u === 'SUGGESTION' ? u : null;
}

/** accepted / (accepted + dismissed); null when nothing was acted on (AC-8). */
export function acceptRate(accepted: number, dismissed: number): number | null {
  const acted = accepted + dismissed;
  return acted === 0 ? null : accepted / acted;
}

/** Sum + average of the PRICED runs' cost; both null when nothing is priced (AC-7). */
function costStats(runs: AggRun[]): { total: number | null; avg: number | null } {
  const priced = runs.filter((r) => r.costUsd != null);
  if (priced.length === 0) return { total: null, avg: null };
  const total = priced.reduce((s, r) => s + (r.costUsd as number), 0);
  return { total, avg: total / priced.length };
}

function avgLatency(runs: AggRun[]): number | null {
  const withDur = runs.filter((r) => r.durationMs != null);
  if (withDur.length === 0) return null;
  return withDur.reduce((s, r) => s + (r.durationMs as number), 0) / withDur.length;
}

function tallySeverity(findings: AggFinding[]): SeverityCounts {
  const out = emptySeverity();
  for (const f of findings) {
    const sev = normSeverity(f.severity);
    if (sev) out[sev]++;
  }
  return out;
}

function tallyCategory(findings: AggFinding[]): CategoryCount[] {
  const m = new Map<string, number>();
  for (const f of findings) m.set(f.category, (m.get(f.category) ?? 0) + 1);
  return [...m.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}

/** Weekly stacked-severity buckets across the period, oldest→newest (AC-25). */
function weeklySeverity(findings: AggFinding[], period: Period): SeverityWeek[] {
  const span = period.to.getTime() - period.from.getTime();
  const n = Math.min(MAX_WEEKLY_BUCKETS, Math.max(1, Math.ceil(span / WEEK_MS)));
  const bucketMs = span > 0 ? span / n : WEEK_MS;
  const buckets: SeverityWeek[] = Array.from({ length: n }, (_, i) => ({
    week: `w${i + 1}`,
    ...emptySeverity(),
  }));
  for (const f of findings) {
    if (!f.ranAt) continue;
    const sev = normSeverity(f.severity);
    if (!sev) continue;
    let idx = Math.floor((f.ranAt.getTime() - period.from.getTime()) / bucketMs);
    if (idx < 0) idx = 0;
    if (idx >= n) idx = n - 1;
    buckets[idx]![sev]++;
  }
  return buckets;
}

/** Recent runs' findings-per-run, oldest→newest, last TREND_LIMIT (AC-16). */
function recentTrend(runs: AggRun[]): StatPoint[] {
  const sorted = runs
    .filter((r) => r.ranAt)
    .sort((a, b) => a.ranAt!.getTime() - b.ranAt!.getTime());
  return sorted.slice(-TREND_LIMIT).map((r) => ({
    label: r.ranAt!.toISOString(),
    value: r.findingsCount ?? 0,
  }));
}

/** Run VOLUME over the period bucketed by day (Total-runs card sparkline). */
function runsVolumeTrend(runs: AggRun[], period: Period): number[] {
  const span = period.to.getTime() - period.from.getTime();
  const days = Math.max(1, Math.ceil(span / (24 * 60 * 60 * 1000)));
  const n = Math.min(days, MAX_RUNS_TREND_BUCKETS);
  const bucketMs = span > 0 ? span / n : span;
  const arr = new Array<number>(n).fill(0);
  for (const r of runs) {
    if (!r.ranAt || bucketMs <= 0) continue;
    let idx = Math.floor((r.ranAt.getTime() - period.from.getTime()) / bucketMs);
    if (idx < 0) idx = 0;
    if (idx >= n) idx = n - 1;
    arr[idx]!++;
  }
  return arr;
}

function lastRunAt(runs: AggRun[]): string | null {
  let latest: Date | null = null;
  for (const r of runs) {
    if (r.ranAt && (!latest || r.ranAt.getTime() > latest.getTime())) latest = r.ranAt;
  }
  return latest ? latest.toISOString() : null;
}

// ---------------------------------------------------------------------------
// T6 — Per-agent core aggregator (shared by dashboard row + stats tab, AC-34)
// ---------------------------------------------------------------------------

export interface AgentCore {
  agent_id: string;
  agent_name: string;
  provider: string | null;
  model: string | null;
  runs: number;
  findings_total: number;
  accepted: number;
  dismissed: number;
  pending: number;
  accept_rate: number | null;
  dismiss_rate: number | null;
  avg_findings_per_run: number | null;
  total_cost_usd: number | null;
  avg_cost_usd: number | null;
  avg_latency_ms: number | null;
  last_run_at: string | null;
  findings_by_severity: SeverityCounts;
  findings_by_severity_weekly: SeverityWeek[];
  findings_by_category: CategoryCount[];
  trend: StatPoint[];
  avg_cost_delta_usd: number | null;
  accept_rate_delta: number | null;
}

export interface AgentCoreInput {
  agentId: string;
  agentName: string;
  provider: string | null;
  model: string | null;
  runs: AggRun[];
  findings: AggFinding[];
  period: Period;
  /** the immediately-preceding window, for the delta chips. */
  previous?: { runs: AggRun[]; findings: AggFinding[] };
}

function countActed(findings: AggFinding[]): { accepted: number; dismissed: number; pending: number } {
  let accepted = 0;
  let dismissed = 0;
  let pending = 0;
  for (const f of findings) {
    if (f.acceptedAt != null) accepted++;
    else if (f.dismissedAt != null) dismissed++;
    else pending++;
  }
  return { accepted, dismissed, pending };
}

export function aggregateAgentCore(input: AgentCoreInput): AgentCore {
  const { runs, findings } = input;
  const { accepted, dismissed, pending } = countActed(findings);
  const cost = costStats(runs);
  const rate = acceptRate(accepted, dismissed);

  let avgCostDelta: number | null = null;
  let acceptRateDelta: number | null = null;
  if (input.previous) {
    const prevCost = costStats(input.previous.runs);
    if (cost.avg != null && prevCost.avg != null) avgCostDelta = cost.avg - prevCost.avg;
    const prev = countActed(input.previous.findings);
    const prevRate = acceptRate(prev.accepted, prev.dismissed);
    if (rate != null && prevRate != null) acceptRateDelta = rate - prevRate;
  }

  return {
    agent_id: input.agentId,
    agent_name: input.agentName,
    provider: input.provider,
    model: input.model,
    runs: runs.length,
    findings_total: findings.length,
    accepted,
    dismissed,
    pending,
    accept_rate: rate,
    dismiss_rate: acceptRate(dismissed, accepted),
    avg_findings_per_run: runs.length === 0 ? null : findings.length / runs.length,
    total_cost_usd: cost.total,
    avg_cost_usd: cost.avg,
    avg_latency_ms: avgLatency(runs),
    last_run_at: lastRunAt(runs),
    findings_by_severity: tallySeverity(findings),
    findings_by_severity_weekly: weeklySeverity(findings, input.period),
    findings_by_category: tallyCategory(findings),
    trend: recentTrend(runs),
    avg_cost_delta_usd: avgCostDelta,
    accept_rate_delta: acceptRateDelta,
  };
}

// ---------------------------------------------------------------------------
// T7 — Trace-derived shares (per-run safe parse; degrade, never throw, AC-9/23/24)
// ---------------------------------------------------------------------------

/** Skill names this run's trace pulled — [] on any malformed/absent shape. */
export function safeSkillNames(trace: unknown): string[] {
  try {
    const pa = (trace as { prompt_assembly?: unknown } | null)?.prompt_assembly as
      | { skill_tokens?: unknown }
      | undefined;
    const st = pa?.skill_tokens;
    if (!Array.isArray(st)) return [];
    return st
      .map((x) => (x && typeof x === 'object' ? (x as { name?: unknown }).name : undefined))
      .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
      .map((n) => n.trim());
  } catch {
    return [];
  }
}

/** Memory labels this run's trace pulled — [] on any malformed/absent shape. */
export function safeMemoryLabels(trace: unknown): string[] {
  try {
    const mp = (trace as { memory_pulled?: unknown } | null)?.memory_pulled;
    if (!Array.isArray(mp)) return [];
    return mp
      .map((x) => (x && typeof x === 'object' ? (x as { text?: unknown }).text : undefined))
      .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      .map((t) => t.trim());
  } catch {
    return [];
  }
}

/** Share (0..1) of period runs whose trace pulled each skill, desc (AC-23). */
export function traceSkillShares(traces: AggTrace[], totalRuns: number): StatShare[] {
  if (totalRuns <= 0) return [];
  const counts = new Map<string, number>();
  for (const { trace } of traces) {
    for (const name of new Set(safeSkillNames(trace))) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, c]) => ({ name, pct: c / totalRuns }))
    .sort((a, b) => b.pct - a.pct);
}

/** Share (0..1) of period runs whose trace pulled each memory item, desc (AC-24). */
export function traceMemoryShares(traces: AggTrace[], totalRuns: number): MemoryShare[] {
  if (totalRuns <= 0) return [];
  const counts = new Map<string, number>();
  for (const { trace } of traces) {
    for (const label of new Set(safeMemoryLabels(trace))) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([label, c]) => ({ label, pct: c / totalRuns }))
    .sort((a, b) => b.pct - a.pct);
}

// ---------------------------------------------------------------------------
// Run-history rows (pure mapping, AC-27)
// ---------------------------------------------------------------------------

export function toRunHistory(runs: AggRun[]): AgentRunHistoryRow[] {
  return runs
    .slice()
    .sort((a, b) => (b.ranAt?.getTime() ?? 0) - (a.ranAt?.getTime() ?? 0))
    .map((r) => ({
      run_id: r.id,
      ran_at: r.ranAt ? r.ranAt.toISOString() : null,
      pr_number: r.prNumber,
      pr_id: r.prId,
      tokens:
        r.tokensIn == null && r.tokensOut == null ? null : (r.tokensIn ?? 0) + (r.tokensOut ?? 0),
      cost_usd: r.costUsd,
      findings_count: r.findingsCount,
      source: r.source,
    }));
}

// ---------------------------------------------------------------------------
// AgentStats DTO (per-agent Stats tab) — core + trace panels + run history
// ---------------------------------------------------------------------------

export interface BuildAgentStatsInput extends AgentCoreInput {
  traces: AggTrace[];
}

export function buildAgentStats(input: BuildAgentStatsInput): AgentStats {
  const core = aggregateAgentCore(input);
  return {
    agent_id: core.agent_id,
    agent_name: core.agent_name,
    runs: core.runs,
    findings_total: core.findings_total,
    accepted: core.accepted,
    dismissed: core.dismissed,
    pending: core.pending,
    accept_rate: core.accept_rate,
    dismiss_rate: core.dismiss_rate,
    avg_findings_per_run: core.avg_findings_per_run,
    total_cost_usd: core.total_cost_usd,
    avg_cost_usd: core.avg_cost_usd,
    avg_latency_ms: core.avg_latency_ms,
    findings_by_severity: core.findings_by_severity,
    trend: core.trend,
    avg_cost_delta_usd: core.avg_cost_delta_usd,
    most_used_skills: traceSkillShares(input.traces, core.runs),
    most_pulled_memory: traceMemoryShares(input.traces, core.runs),
    findings_by_category: core.findings_by_category,
    findings_by_severity_weekly: core.findings_by_severity_weekly,
    run_history: toRunHistory(input.runs),
  };
}

function coreToPerfRow(core: AgentCore): AgentPerfRow {
  return {
    agent_id: core.agent_id,
    agent_name: core.agent_name,
    provider: core.provider,
    model: core.model,
    runs: core.runs,
    findings_total: core.findings_total,
    accepted: core.accepted,
    dismissed: core.dismissed,
    accept_rate: core.accept_rate,
    dismiss_rate: core.dismiss_rate,
    avg_findings_per_run: core.avg_findings_per_run,
    total_cost_usd: core.total_cost_usd,
    avg_cost_usd: core.avg_cost_usd,
    avg_latency_ms: core.avg_latency_ms,
    last_run_at: core.last_run_at,
    findings_by_severity: core.findings_by_severity,
    trend: core.trend.map((p) => p.value),
    accept_rate_delta: core.accept_rate_delta,
  };
}

// ---------------------------------------------------------------------------
// T8 — Dashboard assembler (reuses aggregateAgentCore per agent, AC-34)
// ---------------------------------------------------------------------------

export interface DashboardAgent {
  agentId: string;
  agentName: string;
  provider: string | null;
  model: string | null;
}

export interface BuildDashboardInput {
  /** live agents in the workspace (drives which rows can appear). */
  agents: DashboardAgent[];
  /** all workspace period runs, INCLUDING orphans (agentId=null). */
  runs: AggRun[];
  findings: AggFinding[];
  period: Period;
  previous?: { runs: AggRun[]; findings: AggFinding[] };
}

function groupBy<T>(items: T[], key: (t: T) => string | null): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    if (k == null) continue;
    const arr = m.get(k);
    if (arr) arr.push(it);
    else m.set(k, [it]);
  }
  return m;
}

export function buildDashboard(input: BuildDashboardInput): AgentPerf {
  const runsByAgent = groupBy(input.runs, (r) => r.agentId);
  const findingsByAgent = groupBy(input.findings, (f) => f.agentId);
  const prevRunsByAgent = groupBy(input.previous?.runs ?? [], (r) => r.agentId);
  const prevFindingsByAgent = groupBy(input.previous?.findings ?? [], (f) => f.agentId);

  // One row per LIVE agent that has at least one run in the period.
  const rows: AgentPerfRow[] = [];
  for (const a of input.agents) {
    const agentRuns = runsByAgent.get(a.agentId) ?? [];
    if (agentRuns.length === 0) continue;
    const core = aggregateAgentCore({
      agentId: a.agentId,
      agentName: a.agentName,
      provider: a.provider,
      model: a.model,
      runs: agentRuns,
      findings: findingsByAgent.get(a.agentId) ?? [],
      period: input.period,
      previous: input.previous
        ? {
            runs: prevRunsByAgent.get(a.agentId) ?? [],
            findings: prevFindingsByAgent.get(a.agentId) ?? [],
          }
        : undefined,
    });
    rows.push(coreToPerfRow(core));
  }
  // Default sort: accept-rate descending (nulls last) (AC-14).
  rows.sort((x, y) => (y.accept_rate ?? -1) - (x.accept_rate ?? -1));

  // Summary — pooled across ALL runs/findings (incl. orphans) in the period.
  const allActed = countActed(input.findings);
  const cost = costStats(input.runs);
  let totalCostDelta: number | null = null;
  if (input.previous) {
    const prevCost = costStats(input.previous.runs);
    if (cost.total != null && prevCost.total != null) totalCostDelta = cost.total - prevCost.total;
  }
  const mostActive = rows.reduce<AgentPerfRow | null>(
    (best, r) => (best == null || r.runs > best.runs ? r : best),
    null,
  );

  // cost_by_agent — LIVE agents only (orphan cost folds into the workspace total
  // via summary.total_cost_usd, not into any row/segment) (AC-17, T8).
  const agentName = new Map(input.agents.map((a) => [a.agentId, a.agentName]));
  const costByAgent: PerfCostSegment[] = [];
  for (const [agentId, agentRuns] of runsByAgent) {
    const name = agentName.get(agentId);
    if (!name) continue;
    const total = costStats(agentRuns).total;
    if (total != null) costByAgent.push({ label: name, value: total });
  }
  costByAgent.sort((a, b) => b.value - a.value);

  // cost_by_model — across ALL runs (model is known even for orphans).
  const costByModelMap = new Map<string, number>();
  for (const r of input.runs) {
    if (r.costUsd == null || !r.model) continue;
    costByModelMap.set(r.model, (costByModelMap.get(r.model) ?? 0) + r.costUsd);
  }
  const costByModel: PerfCostSegment[] = [...costByModelMap.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  return {
    summary: {
      runs: input.runs.length,
      total_cost_usd: cost.total,
      avg_accept_rate: acceptRate(allActed.accepted, allActed.dismissed),
      most_active_agent: mostActive ? mostActive.agent_name : null,
      runs_trend: runsVolumeTrend(input.runs, input.period),
      total_cost_delta_usd: totalCostDelta,
    },
    agents: rows,
    cost_by_agent: costByAgent,
    cost_by_model: costByModel,
  };
}

// ---------------------------------------------------------------------------
// T9 — Per-skill aggregator (AC-30, AC-31, AC-33)
// ---------------------------------------------------------------------------

export interface BuildSkillStatsInput {
  skillId: string;
  skillName: string;
  /** config-level count of agents linked to the skill (NOT period-scoped, AC-30). */
  usedByAgents: number;
  /** the linked-agents list for the "Agents using this skill" panel (AC-32). */
  agents: SkillAgentRef[];
  /** period runs by the linked agents (the pull-frequency denominator). */
  runs: AggRun[];
  /** traces for those runs (per-run: which skills the run pulled). */
  traces: AggTrace[];
  /** findings of those runs, projected with `runId` for the pulled-subset filter. */
  findings: AggFinding[];
}

export function buildSkillStats(input: BuildSkillStatsInput): SkillStats {
  const target = input.skillName.trim();
  // Runs (by linked agents) whose trace pulled THIS skill — the AC-31 subset.
  const pulledRunIds = new Set<string>();
  for (const { runId, trace } of input.traces) {
    if (safeSkillNames(trace).includes(target)) pulledRunIds.add(runId);
  }
  const linkedRunCount = input.runs.length;
  const pullFrequency = linkedRunCount === 0 ? null : pulledRunIds.size / linkedRunCount;

  // Findings/accept-rate/category over the pulled-the-skill subset only.
  const subset = input.findings.filter((f) => f.runId != null && pulledRunIds.has(f.runId));
  const acted = countActed(subset);

  return {
    skill_id: input.skillId,
    skill_name: input.skillName,
    used_by_agents: input.usedByAgents,
    pull_frequency: pullFrequency,
    accept_rate: acceptRate(acted.accepted, acted.dismissed),
    findings_total: subset.length,
    agents: input.agents,
    findings_by_category: tallyCategory(subset),
  };
}
