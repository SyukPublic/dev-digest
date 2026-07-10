import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { EvalCaseRow } from '../../../db/rows.js';

/**
 * Eval-case data access (all Drizzle for the eval-case aggregate lives here —
 * onion rule 4). Cases are workspace-scoped; `owner_id` = agent id carries NO
 * DB foreign key, so agent-delete cascade is a SERVICE-level concern
 * (`deleteByOwner`, AC-24).
 */

export interface InsertCaseValues {
  workspaceId: string;
  ownerKind: 'agent' | 'skill';
  ownerId: string;
  name: string;
  inputDiff: string;
  inputMeta?: unknown;
  expectedOutput: unknown;
  notes?: string | null;
}

export async function insertCase(db: Db, values: InsertCaseValues): Promise<EvalCaseRow> {
  const [row] = await db
    .insert(t.evalCases)
    .values({
      workspaceId: values.workspaceId,
      ownerKind: values.ownerKind,
      ownerId: values.ownerId,
      name: values.name,
      inputDiff: values.inputDiff,
      inputMeta: (values.inputMeta as object | undefined) ?? null,
      expectedOutput: (values.expectedOutput as object | undefined) ?? null,
      notes: values.notes ?? null,
    })
    .returning();
  return row!;
}

/** A single case, workspace-scoped. */
export async function getCase(
  db: Db,
  workspaceId: string,
  id: string,
): Promise<EvalCaseRow | undefined> {
  const [row] = await db
    .select()
    .from(t.evalCases)
    .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)));
  return row;
}

/** All cases for an owner (agent), oldest first (stable list order). */
export async function listByOwner(
  db: Db,
  workspaceId: string,
  ownerId: string,
): Promise<EvalCaseRow[]> {
  return db
    .select()
    .from(t.evalCases)
    .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerId, ownerId)))
    .orderBy(asc(t.evalCases.name));
}

export interface UpdateCaseValues {
  name?: string;
  inputDiff?: string;
  inputMeta?: unknown;
  expectedOutput?: unknown;
  notes?: string | null;
}

export async function updateCase(
  db: Db,
  workspaceId: string,
  id: string,
  patch: UpdateCaseValues,
): Promise<EvalCaseRow | undefined> {
  const [row] = await db
    .update(t.evalCases)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.inputDiff !== undefined ? { inputDiff: patch.inputDiff } : {}),
      ...(patch.inputMeta !== undefined ? { inputMeta: patch.inputMeta as object } : {}),
      ...(patch.expectedOutput !== undefined
        ? { expectedOutput: patch.expectedOutput as object }
        : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    })
    .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
    .returning();
  return row;
}

/** Delete a case (its per-case `eval_runs` cascade via FK). Workspace-scoped. */
export async function deleteCase(db: Db, workspaceId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(t.evalCases)
    .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
    .returning({ id: t.evalCases.id });
  return rows.length > 0;
}

/**
 * Delete every case owned by an agent (service-level agent-delete cascade —
 * `owner_id` carries no DB FK, AC-24). Per-case `eval_runs` cascade via FK.
 */
export async function deleteCasesByOwner(
  db: Db,
  workspaceId: string,
  ownerId: string,
): Promise<number> {
  const rows = await db
    .delete(t.evalCases)
    .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerId, ownerId)))
    .returning({ id: t.evalCases.id });
  return rows.length;
}
