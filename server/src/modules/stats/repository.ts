import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { AggRun, AggFinding, AggTrace } from './aggregation.js';
import type { Period } from './schemas.js';

/**
 * Stats data-access — the ONLY layer that touches Drizzle for the stats module
 * (Onion rule 4). All reads are:
 *   - workspace-scoped on `agent_runs.workspace_id` (tenancy guard, AC-2),
 *   - period-bounded on `agent_runs.ran_at` (AC-3),
 *   - source-agnostic: BOTH `source='local'` and `source='ci'` rows are included
 *     (AC-35),
 *   - read-only, parameterized (no mutation, no raw string interpolation, AC-1).
 *
 * `run_traces.trace` jsonb is returned RAW (as `unknown`) for the pure aggregator
 * to parse defensively per run (AC-9) — never parsed/aggregated in SQL.
 *
 * Module-private: constructed from `container.db` by `StatsService`.
 */

/** Config-level skill link data (NOT period-scoped) for the Skill Stats tab. */
export interface SkillLink {
  skillId: string;
  skillName: string;
  /** count of agents currently linked (AC-30). */
  usedByAgents: number;
  /** the linked-agents list for the "Agents using this skill" panel (AC-32). */
  agents: { agent_id: string; agent_name: string }[];
  /** the linked agent ids (the pull-frequency denominator's population). */
  agentIds: string[];
}

export class StatsRepository {
  constructor(private db: Db) {}

  /**
   * T10 — workspace-scoped, period-bounded `agent_runs`. Optional `agentIds`
   * narrows to a subset (single-agent stats / a skill's linked agents); omit it
   * for the whole-workspace dashboard (orphan `agent_id=null` runs included).
   * An explicitly empty `agentIds` short-circuits to `[]`.
   */
  async runsInPeriod(
    workspaceId: string,
    period: Period,
    agentIds?: string[],
  ): Promise<AggRun[]> {
    if (agentIds && agentIds.length === 0) return [];
    const conds = [
      eq(t.agentRuns.workspaceId, workspaceId),
      gte(t.agentRuns.ranAt, period.from),
      lte(t.agentRuns.ranAt, period.to),
    ];
    if (agentIds) conds.push(inArray(t.agentRuns.agentId, agentIds));
    const rows = await this.db
      .select({
        id: t.agentRuns.id,
        agentId: t.agentRuns.agentId,
        ranAt: t.agentRuns.ranAt,
        durationMs: t.agentRuns.durationMs,
        tokensIn: t.agentRuns.tokensIn,
        tokensOut: t.agentRuns.tokensOut,
        costUsd: t.agentRuns.costUsd,
        source: t.agentRuns.source,
        provider: t.agentRuns.provider,
        model: t.agentRuns.model,
        prNumber: t.agentRuns.prNumber,
        prId: t.agentRuns.prId,
        findingsCount: t.agentRuns.findingsCount,
      })
      .from(t.agentRuns)
      .where(and(...conds))
      .orderBy(asc(t.agentRuns.ranAt));
    return rows;
  }

  /**
   * T11 — findings joined to their run via `findings.review_id → reviews.id →
   * reviews.run_id = agent_runs.id`. The inner joins DROP legacy reviews whose
   * `run_id` is null (they cannot be period-bounded). Workspace-scoped +
   * period-bounded on the RUN's `ran_at`. Optional `agentIds` narrows the set.
   */
  async findingsInPeriod(
    workspaceId: string,
    period: Period,
    agentIds?: string[],
  ): Promise<AggFinding[]> {
    if (agentIds && agentIds.length === 0) return [];
    const conds = [
      eq(t.agentRuns.workspaceId, workspaceId),
      gte(t.agentRuns.ranAt, period.from),
      lte(t.agentRuns.ranAt, period.to),
    ];
    if (agentIds) conds.push(inArray(t.agentRuns.agentId, agentIds));
    const rows = await this.db
      .select({
        runId: t.agentRuns.id,
        agentId: t.agentRuns.agentId,
        ranAt: t.agentRuns.ranAt,
        severity: t.findings.severity,
        category: t.findings.category,
        acceptedAt: t.findings.acceptedAt,
        dismissedAt: t.findings.dismissedAt,
      })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .innerJoin(t.agentRuns, eq(t.reviews.runId, t.agentRuns.id))
      .where(and(...conds));
    return rows;
  }

  /**
   * T12 — `run_traces.trace` jsonb for a BOUNDED set of run ids (the period's
   * runs), returned RAW so the pure aggregator parses each defensively (AC-9).
   */
  async tracesForRuns(runIds: string[]): Promise<AggTrace[]> {
    if (runIds.length === 0) return [];
    const rows = await this.db
      .select({ runId: t.runTraces.runId, trace: t.runTraces.trace })
      .from(t.runTraces)
      .where(inArray(t.runTraces.runId, runIds));
    return rows.map((r) => ({ runId: r.runId, trace: r.trace as unknown }));
  }

  /**
   * T13 — config-level link data for one skill: the used-by count and the
   * linked-agents list. Workspace-scoped via the agents join. Returns undefined
   * when the skill does not exist in this workspace (→ 404 at the service).
   */
  async skillLink(workspaceId: string, skillId: string): Promise<SkillLink | undefined> {
    const [skill] = await this.db
      .select({ id: t.skills.id, name: t.skills.name })
      .from(t.skills)
      .where(and(eq(t.skills.id, skillId), eq(t.skills.workspaceId, workspaceId)));
    if (!skill) return undefined;

    const linked = await this.db
      .select({ agentId: t.agents.id, agentName: t.agents.name })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agents.id, t.agentSkills.agentId))
      .where(and(eq(t.agentSkills.skillId, skillId), eq(t.agents.workspaceId, workspaceId)));

    return {
      skillId: skill.id,
      skillName: skill.name,
      usedByAgents: linked.length,
      agents: linked.map((a) => ({ agent_id: a.agentId, agent_name: a.agentName })),
      agentIds: linked.map((a) => a.agentId),
    };
  }

  /** Live agents in the workspace (drives which dashboard rows can appear). */
  async liveAgents(
    workspaceId: string,
  ): Promise<{ agentId: string; agentName: string; provider: string | null; model: string | null }[]> {
    const rows = await this.db
      .select({
        agentId: t.agents.id,
        agentName: t.agents.name,
        provider: t.agents.provider,
        model: t.agents.model,
      })
      .from(t.agents)
      .where(eq(t.agents.workspaceId, workspaceId));
    return rows;
  }

  /** The agent's display name (for the per-agent Stats DTO). Workspace-scoped. */
  async agentName(workspaceId: string, agentId: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ name: t.agents.name })
      .from(t.agents)
      .where(and(eq(t.agents.id, agentId), eq(t.agents.workspaceId, workspaceId)));
    return row?.name;
  }
}
