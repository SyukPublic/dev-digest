import { and, asc, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ConventionRow } from '../../db/rows.js';
import type { ConventionSource } from '@devdigest/shared';
import { acceptedRuleKeys, normalizeRule } from './helpers.js';

export type { ConventionRow };

/**
 * Conventions data-access — the ONLY place that touches the `conventions` table.
 * Every query is workspace-scoped (tenancy guard). Module-private (not a
 * cross-cutting entity), so it's constructed in the service, not the container.
 */

/** A row to persist from a scan (workspace/repo set by the caller). */
export interface InsertConvention {
  workspaceId: string;
  repoId: string;
  rule: string;
  evidencePath: string;
  evidenceSnippet: string;
  confidence: number;
  category: string;
  source: ConventionSource;
  occurrences: number | null;
  extractedAt: Date;
}

/** Curator edits from the UI (accept/reject + inline edit). */
export interface UpdateConvention {
  accepted?: boolean;
  rule?: string;
  evidencePath?: string;
  evidenceSnippet?: string;
  category?: string;
}

export class ConventionsRepository {
  constructor(private db: Db) {}

  /** Candidates for a repo, grouped by category then confidence (desc). */
  async listByRepo(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)))
      .orderBy(asc(t.conventions.category), desc(t.conventions.confidence));
  }

  async getById(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
    return row;
  }

  /**
   * Replace a repo's candidates with a fresh scan, atomically (one transaction):
   * select the prior accepted keys, delete the repo's existing rows, then insert
   * the new ones. accept (`accepted = true`) is carried forward by normalised rule;
   * rejected/new rows reset to false.
   */
  async replaceAll(
    workspaceId: string,
    repoId: string,
    rows: InsertConvention[],
  ): Promise<ConventionRow[]> {
    return this.db.transaction(async (tx) => {
      const prior = await tx
        .select({ rule: t.conventions.rule, accepted: t.conventions.accepted })
        .from(t.conventions)
        .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)));
      const preserved = acceptedRuleKeys(prior);
      await tx
        .delete(t.conventions)
        .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)));
      if (rows.length === 0) return [];
      return tx
        .insert(t.conventions)
        .values(rows.map((r) => ({ ...r, accepted: preserved.has(normalizeRule(r.rule)) })))
        .returning();
    });
  }

  /** Apply a curator edit (scoped). Undefined when the row isn't in the workspace. */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateConvention,
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({
        ...(patch.accepted !== undefined ? { accepted: patch.accepted } : {}),
        ...(patch.rule !== undefined ? { rule: patch.rule } : {}),
        ...(patch.evidencePath !== undefined ? { evidencePath: patch.evidencePath } : {}),
        ...(patch.evidenceSnippet !== undefined ? { evidenceSnippet: patch.evidenceSnippet } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
      })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }
}
