import { and, avg, count, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';

/**
 * Pre-launch estimate seam (DEC-E). Per-agent averages over the agent's COMPLETED
 * (`status='done'`) runs, workspace-scoped — the historical basis the UI shows
 * before launching a multi-agent run. Averages are NULL when there is no history
 * (SQL `avg` returns null on empty / all-null groups — never coalesced to 0, so
 * the UI can distinguish "unknown" from a genuine $0.00). `sample_size` is the
 * count of done runs the averages are computed over.
 *
 * Rollups over `agent_runs` belong on `ReviewRepository` (server INSIGHTS
 * 2026-06-22); the service maps these rows to `AgentEstimate` (adds agent_name
 * from the agents list and fills sample_size=0 for agents with no done runs —
 * such agents simply do not appear here).
 */
export interface AgentRunEstimateRow {
  agent_id: string;
  avg_duration_ms: number | null;
  avg_cost_usd: number | null;
  sample_size: number;
}

export async function agentRunEstimates(
  db: Db,
  workspaceId: string,
  agentIds?: string[],
): Promise<AgentRunEstimateRow[]> {
  // Explicit empty filter ⇒ no agents to estimate (avoid an unfiltered scan).
  if (agentIds && agentIds.length === 0) return [];

  const rows = await db
    .select({
      agentId: t.agentRuns.agentId,
      // Postgres `avg` returns numeric ⇒ the driver yields string | null.
      avgDuration: avg(t.agentRuns.durationMs),
      // `avg` ignores NULLs, so this is already the average over PRICED runs.
      avgCost: avg(t.agentRuns.costUsd),
      sampleSize: count(),
    })
    .from(t.agentRuns)
    .where(
      and(
        eq(t.agentRuns.workspaceId, workspaceId),
        eq(t.agentRuns.status, 'done'),
        // Deleted-agent runs (agent_id set null) can't be estimated per agent.
        isNotNull(t.agentRuns.agentId),
        agentIds ? inArray(t.agentRuns.agentId, agentIds) : undefined,
      ),
    )
    .groupBy(t.agentRuns.agentId);

  return rows.map((r) => ({
    // agent_id is non-null here (filtered above); assert for the return type.
    agent_id: r.agentId!,
    avg_duration_ms: r.avgDuration == null ? null : Number(r.avgDuration),
    avg_cost_usd: r.avgCost == null ? null : Number(r.avgCost),
    sample_size: Number(r.sampleSize),
  }));
}
