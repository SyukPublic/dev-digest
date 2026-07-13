import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { EvalSkillStabilityGroupRow, EvalSkillSuiteRunRow } from '../../../db/rows.js';

/**
 * Skill Eval STABILITY-GROUP data access — the parent of N repeated differential
 * suite runs over ONE frozen snapshot (SPEC-2026-07-12-skill-eval-stability).
 * A SIBLING of `eval-skill-suite.repo.ts`: every method mirrors it 1:1 but keys
 * on the stability group. All Drizzle for the group aggregate lives here (onion
 * rule 4). The group row is deliberately THIN — variance/flags/alert are derived
 * on read from the child suite runs + their per-case `eval_runs`, never stored.
 */

/** Insert a stability group in `running` state with the frozen snapshot identity. */
export async function insertGroup(
  db: Db,
  values: {
    workspaceId: string;
    skillId: string;
    skillVersion: number;
    hostAgentId: string;
    hostAgentVersion: number;
    nRequested: number;
  },
): Promise<EvalSkillStabilityGroupRow> {
  const [row] = await db
    .insert(t.evalSkillStabilityGroups)
    .values({
      workspaceId: values.workspaceId,
      skillId: values.skillId,
      skillVersion: values.skillVersion,
      hostAgentId: values.hostAgentId,
      hostAgentVersion: values.hostAgentVersion,
      nRequested: values.nRequested,
      status: 'running',
    })
    .returning();
  return row!;
}

/** The live (`running`) stability group for a skill, if any (one-live-per-skill, AC-9). */
export async function oneRunningForSkill(
  db: Db,
  workspaceId: string,
  skillId: string,
): Promise<EvalSkillStabilityGroupRow | undefined> {
  const [row] = await db
    .select()
    .from(t.evalSkillStabilityGroups)
    .where(
      and(
        eq(t.evalSkillStabilityGroups.workspaceId, workspaceId),
        eq(t.evalSkillStabilityGroups.skillId, skillId),
        eq(t.evalSkillStabilityGroups.status, 'running'),
      ),
    );
  return row;
}

/** Flip a stability group to its terminal status (done | failed). */
export async function setTerminal(
  db: Db,
  groupId: string,
  status: 'done' | 'failed',
): Promise<void> {
  await db
    .update(t.evalSkillStabilityGroups)
    .set({ status })
    .where(eq(t.evalSkillStabilityGroups.id, groupId));
}

/** A single stability group, workspace-scoped. */
export async function getGroup(
  db: Db,
  workspaceId: string,
  id: string,
): Promise<EvalSkillStabilityGroupRow | undefined> {
  const [row] = await db
    .select()
    .from(t.evalSkillStabilityGroups)
    .where(
      and(
        eq(t.evalSkillStabilityGroups.workspaceId, workspaceId),
        eq(t.evalSkillStabilityGroups.id, id),
      ),
    );
  return row;
}

/** Stability groups for a skill, newest first. */
export async function listBySkill(
  db: Db,
  workspaceId: string,
  skillId: string,
  limit: number,
): Promise<EvalSkillStabilityGroupRow[]> {
  return db
    .select()
    .from(t.evalSkillStabilityGroups)
    .where(
      and(
        eq(t.evalSkillStabilityGroups.workspaceId, workspaceId),
        eq(t.evalSkillStabilityGroups.skillId, skillId),
      ),
    )
    .orderBy(desc(t.evalSkillStabilityGroups.ranAt))
    .limit(limit);
}

/**
 * The child skill suite runs of a group (where `stability_group_id = groupId`),
 * newest first. These are the per-run metric draws the variance aggregates over.
 */
export async function listRunsByGroup(
  db: Db,
  groupId: string,
): Promise<EvalSkillSuiteRunRow[]> {
  return db
    .select()
    .from(t.evalSkillSuiteRuns)
    .where(eq(t.evalSkillSuiteRuns.stabilityGroupId, groupId))
    .orderBy(desc(t.evalSkillSuiteRuns.ranAt));
}

/**
 * On boot: any stability group still `running` is orphaned (its process died /
 * restarted), so mark it `failed`. Global — one API instance per DB (mirrors the
 * skill-suite reaping).
 */
export async function reapStaleRunningStabilityGroups(db: Db): Promise<number> {
  const rows = await db
    .update(t.evalSkillStabilityGroups)
    .set({ status: 'failed' })
    .where(eq(t.evalSkillStabilityGroups.status, 'running'))
    .returning({ id: t.evalSkillStabilityGroups.id });
  return rows.length;
}

/**
 * Delete every stability group of a skill (service-level skill-delete cascade —
 * `skill_id` carries no DB FK). Child `eval_skill_suite_runs` cascade via the
 * `stability_group_id` FK, and their per-case `eval_runs` cascade transitively.
 */
export async function deleteBySkill(
  db: Db,
  workspaceId: string,
  skillId: string,
): Promise<number> {
  const rows = await db
    .delete(t.evalSkillStabilityGroups)
    .where(
      and(
        eq(t.evalSkillStabilityGroups.workspaceId, workspaceId),
        eq(t.evalSkillStabilityGroups.skillId, skillId),
      ),
    )
    .returning({ id: t.evalSkillStabilityGroups.id });
  return rows.length;
}
