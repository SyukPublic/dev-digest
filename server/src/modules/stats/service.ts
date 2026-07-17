import type { Container } from '../../platform/container.js';
import type { AgentPerf, AgentStats, SkillStats } from '@devdigest/shared';
import { StatsRepository } from './repository.js';
import { buildAgentStats, buildDashboard, buildSkillStats, type AggTrace } from './aggregation.js';
import { resolvePeriod, previousPeriod, type PeriodQuery } from './schemas.js';

/**
 * Stats service (T14) — orchestrates repository reads → pure aggregators →
 * `AgentPerf`/`AgentStats`/`SkillStats` DTOs. Strictly read-only: it constructs
 * NO adapter and makes NO LLM/model call (AC-1). The trace read is wrapped so a
 * jsonb/DB failure yields empty trace panels and the request still succeeds
 * (AC-9) — the per-run parse itself is already defensive in the pure code.
 *
 * The dashboard per-agent rows and the per-agent Stats tab both flow through the
 * one shared per-agent aggregator, so their numbers cannot drift (AC-34).
 */
export class StatsService {
  private repo: StatsRepository;

  constructor(private container: Container) {
    this.repo = new StatsRepository(container.db);
  }

  /** GET /agents/performance — the global dashboard (AC-11). */
  async agentPerformance(workspaceId: string, query: PeriodQuery): Promise<AgentPerf> {
    const period = resolvePeriod(query, new Date());
    const prev = previousPeriod(period);
    const [agents, runs, findings, prevRuns, prevFindings] = await Promise.all([
      this.repo.liveAgents(workspaceId),
      this.repo.runsInPeriod(workspaceId, period),
      this.repo.findingsInPeriod(workspaceId, period),
      this.repo.runsInPeriod(workspaceId, prev),
      this.repo.findingsInPeriod(workspaceId, prev),
    ]);
    return buildDashboard({
      agents,
      runs,
      findings,
      period,
      previous: { runs: prevRuns, findings: prevFindings },
    });
  }

  /** GET /agents/:id/stats — the per-agent Stats tab (AC-21). undefined → 404. */
  async agentStats(
    workspaceId: string,
    agentId: string,
    query: PeriodQuery,
  ): Promise<AgentStats | undefined> {
    const agentName = await this.repo.agentName(workspaceId, agentId);
    if (agentName === undefined) return undefined;
    const period = resolvePeriod(query, new Date());
    const prev = previousPeriod(period);
    const [runs, findings, prevRuns, prevFindings] = await Promise.all([
      this.repo.runsInPeriod(workspaceId, period, [agentId]),
      this.repo.findingsInPeriod(workspaceId, period, [agentId]),
      this.repo.runsInPeriod(workspaceId, prev, [agentId]),
      this.repo.findingsInPeriod(workspaceId, prev, [agentId]),
    ]);
    const traces = await this.safeTraces(runs.map((r) => r.id));
    return buildAgentStats({
      agentId,
      agentName,
      provider: null,
      model: null,
      runs,
      findings,
      period,
      previous: { runs: prevRuns, findings: prevFindings },
      traces,
    });
  }

  /** GET /skills/:id/stats — the per-skill Stats tab (AC-29). undefined → 404. */
  async skillStats(
    workspaceId: string,
    skillId: string,
    query: PeriodQuery,
  ): Promise<SkillStats | undefined> {
    const link = await this.repo.skillLink(workspaceId, skillId);
    if (!link) return undefined;
    const period = resolvePeriod(query, new Date());
    const [runs, findings] = await Promise.all([
      this.repo.runsInPeriod(workspaceId, period, link.agentIds),
      this.repo.findingsInPeriod(workspaceId, period, link.agentIds),
    ]);
    const traces = await this.safeTraces(runs.map((r) => r.id));
    return buildSkillStats({
      skillId: link.skillId,
      skillName: link.skillName,
      usedByAgents: link.usedByAgents,
      agents: link.agents,
      runs,
      traces,
      findings,
    });
  }

  /**
   * Read the period's run traces, degrading to an empty set on ANY failure so the
   * trace-derived panels render empty while the rest of the surface still renders
   * (AC-9). The per-run parse is defensive in the pure aggregator.
   */
  private async safeTraces(runIds: string[]): Promise<AggTrace[]> {
    try {
      return await this.repo.tracesForRuns(runIds);
    } catch {
      // Swallow: trace panels degrade to empty, the request still succeeds.
      return [];
    }
  }
}
