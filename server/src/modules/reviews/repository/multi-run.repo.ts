import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { AgentRunRow, FindingRow } from '../../../db/rows.js';

type ReviewRow = typeof t.reviews.$inferSelect;

/**
 * Multi-agent run persistence (DEC-B). `multi_agent_runs` is the persisted
 * grouping identity; each participating `agent_runs` row carries the nullable
 * `multiAgentRunId` FK. Aggregates (agent_count / total_duration_ms /
 * total_cost_usd) are NOT stored — they are computed ON READ by the service from
 * the grouped rows this repo returns, mirroring the PR-list cost rollup pattern.
 */

/** One grouped agent's raw read-back: its run, joined agent name (null when the
 *  agent was deleted — E13), and the review it produced (kind='review') with its
 *  findings. Attribution (AC-27) is run → review → findings, per run. */
export interface MultiRunAgentRow {
  run: AgentRunRow;
  /** Joined from `agents.name`; null when the agent row was deleted post-run. */
  agentName: string | null;
  /** The `kind='review'` review this run produced, or null (failed/no review). */
  review: ReviewRow | null;
  /** Findings of `review` (empty when there is no review). */
  findings: FindingRow[];
}

/** The latest persisted multi-agent run for a PR + its grouped agent read-backs.
 *  The service assembles this into a `MultiAgentRun` (columns + conflicts). */
export interface LatestMultiRun {
  id: string;
  prId: string;
  ranAt: Date;
  agents: MultiRunAgentRow[];
}

/** Persist a new multi-agent run grouping; returns its id. */
export async function createMultiRun(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<string> {
  const [row] = await db
    .insert(t.multiAgentRuns)
    .values({ workspaceId, prId })
    .returning({ id: t.multiAgentRuns.id });
  return row!.id;
}

/**
 * The latest `multi_agent_runs` row for a PR (workspace-scoped) plus its grouped
 * `agent_runs` (joined with the agent name) and, per run, the review it produced
 * (`kind='review'`) with that review's findings. Returns the RAW grouped data;
 * the service derives aggregates and conflicts. `undefined` when the PR has no
 * multi-agent run yet.
 */
export async function getLatestMultiRun(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<LatestMultiRun | undefined> {
  const [group] = await db
    .select()
    .from(t.multiAgentRuns)
    .where(and(eq(t.multiAgentRuns.workspaceId, workspaceId), eq(t.multiAgentRuns.prId, prId)))
    .orderBy(desc(t.multiAgentRuns.ranAt))
    .limit(1);
  if (!group) return undefined;

  const runRows = await db
    .select({ run: t.agentRuns, agentName: t.agents.name })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(
      and(
        eq(t.agentRuns.multiAgentRunId, group.id),
        eq(t.agentRuns.workspaceId, workspaceId),
      ),
    )
    .orderBy(asc(t.agentRuns.ranAt));

  const runIds = runRows.map((r) => r.run.id);
  // Attribution: reviews.run_id links a review to the run that produced it. Take
  // only the kind='review' row (reviewsForPull interleaves a summary row too —
  // server INSIGHTS 2026-06-26).
  const reviews = runIds.length
    ? await db
        .select()
        .from(t.reviews)
        .where(and(inArray(t.reviews.runId, runIds), eq(t.reviews.kind, 'review')))
    : [];
  const reviewIds = reviews.map((r) => r.id);
  const findings = reviewIds.length
    ? await db.select().from(t.findings).where(inArray(t.findings.reviewId, reviewIds))
    : [];

  const agents: MultiRunAgentRow[] = runRows.map(({ run, agentName }) => {
    const review = reviews.find((rv) => rv.runId === run.id) ?? null;
    return {
      run,
      agentName: agentName ?? null,
      review,
      findings: review ? findings.filter((f) => f.reviewId === review.id) : [],
    };
  });

  return { id: group.id, prId: group.prId, ranAt: group.ranAt, agents };
}
