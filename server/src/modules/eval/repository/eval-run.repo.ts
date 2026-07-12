import { desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { EvalRunRow } from '../../../db/rows.js';

/**
 * Per-case eval-run data access (one row per case execution). All Drizzle for
 * the run aggregate lives here (onion rule 4). Every per-case row is written
 * BEFORE its suite flips to a terminal status (AC-11) — the ordering invariant
 * is enforced by the executor's call order, not the DB.
 */

export interface InsertRunValues {
  caseId: string;
  /**
   * The parent AGENT suite. NULL for a single-case run or a differential
   * (skill) run. Mutually exclusive with `skillSuiteRunId` — a per-case row
   * belongs to EXACTLY ONE suite parent (a service invariant, not a DB CHECK).
   */
  suiteRunId?: string | null;
  /**
   * The parent SKILL (differential) suite. NULL for agent-suite / single-case
   * runs. Mutually exclusive with `suiteRunId` (see above).
   */
  skillSuiteRunId?: string | null;
  actualOutput?: unknown;
  pass: boolean | null;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  durationMs: number | null;
  costUsd: number | null;
  /** Set when the case's LLM execution failed; row keeps pass=false (AC-21). */
  error?: string | null;
}

export async function insertRun(db: Db, values: InsertRunValues): Promise<EvalRunRow> {
  const [row] = await db
    .insert(t.evalRuns)
    .values({
      caseId: values.caseId,
      suiteRunId: values.suiteRunId ?? null,
      skillSuiteRunId: values.skillSuiteRunId ?? null,
      actualOutput: (values.actualOutput as object | undefined) ?? null,
      pass: values.pass,
      recall: values.recall,
      precision: values.precision,
      citationAccuracy: values.citationAccuracy,
      durationMs: values.durationMs,
      costUsd: values.costUsd,
      error: values.error ?? null,
    })
    .returning();
  return row!;
}

/** All per-case rows of an AGENT suite (progressive read for polling; AC-11/AC-12). */
export async function listBySuite(db: Db, suiteRunId: string): Promise<EvalRunRow[]> {
  return db
    .select()
    .from(t.evalRuns)
    .where(eq(t.evalRuns.suiteRunId, suiteRunId))
    .orderBy(desc(t.evalRuns.ranAt));
}

/** All per-case delta rows of a SKILL (differential) suite (progressive read; AC-11). */
export async function listBySkillSuite(db: Db, skillSuiteRunId: string): Promise<EvalRunRow[]> {
  return db
    .select()
    .from(t.evalRuns)
    .where(eq(t.evalRuns.skillSuiteRunId, skillSuiteRunId))
    .orderBy(desc(t.evalRuns.ranAt));
}

/**
 * All runs for a set of cases, newest first — the caller reduces to the latest
 * run per case for the Evals-tab case list (AC-7).
 */
export async function listByCases(db: Db, caseIds: string[]): Promise<EvalRunRow[]> {
  if (caseIds.length === 0) return [];
  return db
    .select()
    .from(t.evalRuns)
    .where(inArray(t.evalRuns.caseId, caseIds))
    .orderBy(desc(t.evalRuns.ranAt));
}
