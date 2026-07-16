import { and, asc, cosineDistance, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { MemoryRow } from '../../db/rows.js';
import type { MemoryKind, MemoryScope, MemorySource } from '@devdigest/shared';

export type { MemoryRow };

/**
 * Review Memory data-access — the ONLY place that touches the `memory` table
 * (Onion rule 4). Every query is workspace-scoped (tenancy guard, AC-8), and
 * repo-scope visibility is `repoId = activeRepo OR scope IN (global, team)`.
 * Module-private (not a cross-cutting entity), so it is constructed in the
 * service from `container.db`, not in the container.
 *
 * The 1536-dim `embedding` vector is server-owned: `insert`/`update` receive it
 * from the service (embedded from content), never from the client.
 */

/** A row to persist (workspace/repo/scope set by the service). */
export interface InsertMemory {
  workspaceId: string;
  repoId: string | null;
  scope: MemoryScope;
  kind: MemoryKind;
  content: string;
  confidence: number;
  sources: MemorySource[];
  /** Server-derived embedding; null when embeddings are disabled/failed. */
  embedding: number[] | null;
}

/** Known-field patch (no mass-assignment). `embedding` is set ONLY when the
 *  content changed and re-embedding succeeded. */
export interface UpdateMemoryPatch {
  content?: string;
  scope?: MemoryScope;
  kind?: MemoryKind;
  confidence?: number;
  sources?: MemorySource[];
  repoId?: string | null;
  embedding?: number[] | null;
  updatedAt?: Date;
}

export interface ListFilters {
  repoId?: string | null;
  scope?: MemoryScope[];
  kind?: MemoryKind[];
  stale?: boolean;
  /** Entries with lastUsedAt older than this (or null) count as stale. */
  staleBefore?: Date;
}

export interface CosineSearch {
  repoId?: string | null;
  queryVector: number[];
  limit: number;
  threshold: number;
}

export class MemoryRepository {
  constructor(private db: Db) {}

  /**
   * Repo-scope visibility predicate: repo-scoped rows only for the active repo,
   * global/team always. With no active repo, repo-scoped rows are excluded.
   */
  private visibility(repoId: string | null | undefined) {
    if (repoId) {
      return or(
        inArray(t.memory.scope, ['global', 'team']),
        and(eq(t.memory.scope, 'repo'), eq(t.memory.repoId, repoId)),
      )!;
    }
    return inArray(t.memory.scope, ['global', 'team']);
  }

  /** Workspace-scoped list with optional scope/kind/stale filters (AC-1/2/16). */
  async list(workspaceId: string, filters: ListFilters = {}): Promise<MemoryRow[]> {
    const conds = [eq(t.memory.workspaceId, workspaceId), this.visibility(filters.repoId)];
    if (filters.scope?.length) conds.push(inArray(t.memory.scope, filters.scope));
    if (filters.kind?.length) conds.push(inArray(t.memory.kind, filters.kind));
    if (filters.stale) {
      const cutoff = filters.staleBefore ?? new Date();
      conds.push(or(isNull(t.memory.lastUsedAt), lt(t.memory.lastUsedAt, cutoff))!);
    }
    return this.db
      .select()
      .from(t.memory)
      .where(and(...conds))
      .orderBy(desc(t.memory.updatedAt));
  }

  /** Per-scope and per-kind counts over the visible set (rail facets, AC-2). */
  async countFacets(
    workspaceId: string,
    repoId?: string | null,
  ): Promise<{ scope: Record<string, number>; kind: Record<string, number> }> {
    const base = and(eq(t.memory.workspaceId, workspaceId), this.visibility(repoId));
    const scopeRows = await this.db
      .select({ scope: t.memory.scope, count: sql<number>`count(*)::int` })
      .from(t.memory)
      .where(base)
      .groupBy(t.memory.scope);
    const kindRows = await this.db
      .select({ kind: t.memory.kind, count: sql<number>`count(*)::int` })
      .from(t.memory)
      .where(base)
      .groupBy(t.memory.kind);
    const scope: Record<string, number> = {};
    for (const r of scopeRows) scope[r.scope] = Number(r.count);
    const kind: Record<string, number> = {};
    for (const r of kindRows) kind[r.kind] = Number(r.count);
    return { scope, kind };
  }

  async getById(workspaceId: string, id: string): Promise<MemoryRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.memory)
      .where(and(eq(t.memory.workspaceId, workspaceId), eq(t.memory.id, id)));
    return row;
  }

  async insert(row: InsertMemory): Promise<MemoryRow> {
    const [created] = await this.db
      .insert(t.memory)
      .values({
        workspaceId: row.workspaceId,
        repoId: row.repoId,
        scope: row.scope,
        kind: row.kind,
        content: row.content,
        confidence: row.confidence,
        sources: row.sources,
        embedding: row.embedding,
      })
      .returning();
    return created!;
  }

  /** Apply a known-field patch (scoped). Undefined when not in the workspace. */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateMemoryPatch,
  ): Promise<MemoryRow | undefined> {
    const [row] = await this.db
      .update(t.memory)
      .set({
        ...(patch.content !== undefined ? { content: patch.content } : {}),
        ...(patch.scope !== undefined ? { scope: patch.scope } : {}),
        ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
        ...(patch.confidence !== undefined ? { confidence: patch.confidence } : {}),
        ...(patch.sources !== undefined ? { sources: patch.sources } : {}),
        ...(patch.repoId !== undefined ? { repoId: patch.repoId } : {}),
        ...(patch.embedding !== undefined ? { embedding: patch.embedding } : {}),
        ...(patch.updatedAt !== undefined ? { updatedAt: patch.updatedAt } : {}),
      })
      .where(and(eq(t.memory.workspaceId, workspaceId), eq(t.memory.id, id)))
      .returning();
    return row;
  }

  /** Remove a row (scoped). Returns false when it isn't in the workspace. */
  async delete(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.memory)
      .where(and(eq(t.memory.workspaceId, workspaceId), eq(t.memory.id, id)))
      .returning({ id: t.memory.id });
    return rows.length > 0;
  }

  /**
   * Fresh pgvector cosine search (workspace + repo/global/team scoped). Orders
   * ascending by cosine DISTANCE (most similar first) and keeps only rows whose
   * cosine SIMILARITY (1 - distance) meets the threshold. The query vector is
   * passed as a parameter; rows without an embedding are excluded.
   */
  async searchByCosine(workspaceId: string, opts: CosineSearch): Promise<MemoryRow[]> {
    const { repoId, queryVector, limit, threshold } = opts;
    const distance = cosineDistance(t.memory.embedding, queryVector);
    return this.db
      .select()
      .from(t.memory)
      .where(
        and(
          eq(t.memory.workspaceId, workspaceId),
          this.visibility(repoId),
          isNotNull(t.memory.embedding),
          sql`1 - (${distance}) >= ${threshold}`,
        ),
      )
      .orderBy(asc(distance))
      .limit(limit);
  }

  /** Stamp `last_used_at = now()` on the matched ids (scoped). No-op if empty. */
  async touchLastUsed(workspaceId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .update(t.memory)
      .set({ lastUsedAt: new Date() })
      .where(and(eq(t.memory.workspaceId, workspaceId), inArray(t.memory.id, ids)));
  }
}
