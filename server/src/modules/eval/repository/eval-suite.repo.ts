import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { EvalSuiteRunRow } from '../../../db/rows.js';

/**
 * Eval SUITE-RUN data access — the parent of a run over all of an agent's cases.
 * All Drizzle for the suite aggregate lives here (onion rule 4). Pooled metrics
 * are written once at terminal (`setTerminal`) and are then IMMUTABLE (AC-23).
 */

/** Insert a suite in `running` state with the agent version snapshot (AC-8/AC-14). */
export async function insertSuite(
  db: Db,
  values: { workspaceId: string; agentId: string; agentVersion: number },
): Promise<EvalSuiteRunRow> {
  const [row] = await db
    .insert(t.evalSuiteRuns)
    .values({
      workspaceId: values.workspaceId,
      agentId: values.agentId,
      agentVersion: values.agentVersion,
      status: 'running',
    })
    .returning();
  return row!;
}

/** The live (`running`) suite for an agent, if any (one-live-per-agent, AC-9). */
export async function oneRunningForAgent(
  db: Db,
  workspaceId: string,
  agentId: string,
): Promise<EvalSuiteRunRow | undefined> {
  const [row] = await db
    .select()
    .from(t.evalSuiteRuns)
    .where(
      and(
        eq(t.evalSuiteRuns.workspaceId, workspaceId),
        eq(t.evalSuiteRuns.agentId, agentId),
        eq(t.evalSuiteRuns.status, 'running'),
      ),
    );
  return row;
}

export interface SuiteTerminalValues {
  status: 'done' | 'failed';
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  passed: number;
  total: number;
  costUsd: number | null;
  durationMs: number;
}

/** Flip a suite to its terminal status + write pooled metrics ONCE (AC-11/AC-16/AC-22). */
export async function setTerminal(
  db: Db,
  suiteId: string,
  values: SuiteTerminalValues,
): Promise<void> {
  await db
    .update(t.evalSuiteRuns)
    .set({
      status: values.status,
      recall: values.recall,
      precision: values.precision,
      citationAccuracy: values.citationAccuracy,
      passed: values.passed,
      total: values.total,
      costUsd: values.costUsd,
      durationMs: values.durationMs,
    })
    .where(eq(t.evalSuiteRuns.id, suiteId));
}

/** A single suite, workspace-scoped. */
export async function getSuite(
  db: Db,
  workspaceId: string,
  id: string,
): Promise<EvalSuiteRunRow | undefined> {
  const [row] = await db
    .select()
    .from(t.evalSuiteRuns)
    .where(and(eq(t.evalSuiteRuns.workspaceId, workspaceId), eq(t.evalSuiteRuns.id, id)));
  return row;
}

/** Suite runs for an agent, newest first. */
export async function listByAgent(
  db: Db,
  workspaceId: string,
  agentId: string,
  limit: number,
): Promise<EvalSuiteRunRow[]> {
  return db
    .select()
    .from(t.evalSuiteRuns)
    .where(and(eq(t.evalSuiteRuns.workspaceId, workspaceId), eq(t.evalSuiteRuns.agentId, agentId)))
    .orderBy(desc(t.evalSuiteRuns.ranAt))
    .limit(limit);
}

/** Recent suite runs across ALL agents in a workspace, newest first. */
export async function listRecentByWorkspace(
  db: Db,
  workspaceId: string,
  limit: number,
): Promise<EvalSuiteRunRow[]> {
  return db
    .select()
    .from(t.evalSuiteRuns)
    .where(eq(t.evalSuiteRuns.workspaceId, workspaceId))
    .orderBy(desc(t.evalSuiteRuns.ranAt))
    .limit(limit);
}

/**
 * On boot: any suite still `running` is orphaned (its process died / restarted),
 * so mark it `failed` (AC-25). Global — one API instance per DB (mirrors the
 * agent_runs reaping).
 */
export async function reapStaleRunningSuites(db: Db): Promise<number> {
  const rows = await db
    .update(t.evalSuiteRuns)
    .set({ status: 'failed' })
    .where(eq(t.evalSuiteRuns.status, 'running'))
    .returning({ id: t.evalSuiteRuns.id });
  return rows.length;
}

/**
 * Delete every suite run of an agent (service-level agent-delete cascade —
 * `agent_id` carries no DB FK, AC-24). Per-case `eval_runs` cascade via FK.
 */
export async function deleteByAgent(
  db: Db,
  workspaceId: string,
  agentId: string,
): Promise<number> {
  const rows = await db
    .delete(t.evalSuiteRuns)
    .where(and(eq(t.evalSuiteRuns.workspaceId, workspaceId), eq(t.evalSuiteRuns.agentId, agentId)))
    .returning({ id: t.evalSuiteRuns.id });
  return rows.length;
}
