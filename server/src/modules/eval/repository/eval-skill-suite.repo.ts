import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { EvalSkillSuiteRunRow } from '../../../db/rows.js';

/**
 * Skill Eval SUITE-RUN data access — the parent of a DIFFERENTIAL run over all of
 * a skill's cases (SPEC-2026-07-12-skill-eval-differential). A SIBLING of
 * `eval-suite.repo.ts`: every method mirrors it 1:1 but keys on the skill (plus
 * the host agent the delta was run on) instead of the agent. All Drizzle for the
 * skill-suite aggregate lives here (onion rule 4). Pooled DELTA metrics are
 * written once at terminal (`setTerminal`) and are then IMMUTABLE.
 */

/**
 * Insert a skill suite in `running` state with the skill + host version
 * snapshots. `stabilityGroupId` links the run to its stability-group parent (the
 * N-repeat layer); NULL for a STANDALONE differential run
 * (SPEC-2026-07-12-skill-eval-stability).
 */
export async function insertSuite(
  db: Db,
  values: {
    workspaceId: string;
    skillId: string;
    skillVersion: number;
    hostAgentId: string;
    hostAgentVersion: number;
    stabilityGroupId?: string | null;
  },
): Promise<EvalSkillSuiteRunRow> {
  const [row] = await db
    .insert(t.evalSkillSuiteRuns)
    .values({
      workspaceId: values.workspaceId,
      skillId: values.skillId,
      skillVersion: values.skillVersion,
      hostAgentId: values.hostAgentId,
      hostAgentVersion: values.hostAgentVersion,
      stabilityGroupId: values.stabilityGroupId ?? null,
      status: 'running',
    })
    .returning();
  return row!;
}

/** The live (`running`) skill suite for a skill, if any (one-live-per-skill, AC-19). */
export async function oneRunningForSkill(
  db: Db,
  workspaceId: string,
  skillId: string,
): Promise<EvalSkillSuiteRunRow | undefined> {
  const [row] = await db
    .select()
    .from(t.evalSkillSuiteRuns)
    .where(
      and(
        eq(t.evalSkillSuiteRuns.workspaceId, workspaceId),
        eq(t.evalSkillSuiteRuns.skillId, skillId),
        eq(t.evalSkillSuiteRuns.status, 'running'),
      ),
    );
  return row;
}

export interface SkillSuiteTerminalValues {
  status: 'done' | 'failed';
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  passed: number;
  total: number;
  costUsd: number | null;
  durationMs: number;
}

/** Flip a skill suite to its terminal status + write pooled DELTA metrics ONCE. */
export async function setTerminal(
  db: Db,
  suiteId: string,
  values: SkillSuiteTerminalValues,
): Promise<void> {
  await db
    .update(t.evalSkillSuiteRuns)
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
    .where(eq(t.evalSkillSuiteRuns.id, suiteId));
}

/** A single skill suite, workspace-scoped. */
export async function getSuite(
  db: Db,
  workspaceId: string,
  id: string,
): Promise<EvalSkillSuiteRunRow | undefined> {
  const [row] = await db
    .select()
    .from(t.evalSkillSuiteRuns)
    .where(
      and(eq(t.evalSkillSuiteRuns.workspaceId, workspaceId), eq(t.evalSkillSuiteRuns.id, id)),
    );
  return row;
}

/** Skill suite runs for a skill, newest first. */
export async function listBySkill(
  db: Db,
  workspaceId: string,
  skillId: string,
  limit: number,
): Promise<EvalSkillSuiteRunRow[]> {
  return db
    .select()
    .from(t.evalSkillSuiteRuns)
    .where(
      and(
        eq(t.evalSkillSuiteRuns.workspaceId, workspaceId),
        eq(t.evalSkillSuiteRuns.skillId, skillId),
      ),
    )
    .orderBy(desc(t.evalSkillSuiteRuns.ranAt))
    .limit(limit);
}

/** Recent skill suite runs across ALL skills in a workspace, newest first. */
export async function listRecentByWorkspace(
  db: Db,
  workspaceId: string,
  limit: number,
): Promise<EvalSkillSuiteRunRow[]> {
  return db
    .select()
    .from(t.evalSkillSuiteRuns)
    .where(eq(t.evalSkillSuiteRuns.workspaceId, workspaceId))
    .orderBy(desc(t.evalSkillSuiteRuns.ranAt))
    .limit(limit);
}

/**
 * On boot: any skill suite still `running` is orphaned (its process died /
 * restarted), so mark it `failed` (AC-22). Global — one API instance per DB
 * (mirrors the agent suite reaping).
 */
export async function reapStaleRunningSkillSuites(db: Db): Promise<number> {
  const rows = await db
    .update(t.evalSkillSuiteRuns)
    .set({ status: 'failed' })
    .where(eq(t.evalSkillSuiteRuns.status, 'running'))
    .returning({ id: t.evalSkillSuiteRuns.id });
  return rows.length;
}

/**
 * Delete every skill suite run of a skill (service-level skill-delete cascade —
 * `skill_id` carries no DB FK, AC-31). Per-case `eval_runs` cascade via the
 * `skill_suite_run_id` FK.
 */
export async function deleteBySkill(
  db: Db,
  workspaceId: string,
  skillId: string,
): Promise<number> {
  const rows = await db
    .delete(t.evalSkillSuiteRuns)
    .where(
      and(
        eq(t.evalSkillSuiteRuns.workspaceId, workspaceId),
        eq(t.evalSkillSuiteRuns.skillId, skillId),
      ),
    )
    .returning({ id: t.evalSkillSuiteRuns.id });
  return rows.length;
}
