import type { Memory, MemorySource } from '@devdigest/shared';
import type { MemoryRow } from './repository.js';

/**
 * Map a persisted `memory` row to the client-facing `Memory` DTO. The embedding
 * is intentionally dropped (server-owned, never leaves the boundary); timestamps
 * are serialized to ISO strings; a null confidence degrades to 0.
 */
export function toMemoryDto(row: MemoryRow): Memory {
  return {
    id: row.id,
    content: row.content,
    scope: row.scope,
    kind: row.kind,
    confidence: row.confidence ?? 0,
    sources: (row.sources as MemorySource[] | null) ?? [],
    repo_id: row.repoId ?? null,
    updated_at: row.updatedAt.toISOString(),
    last_used_at: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
  };
}

/** First PR number referenced by a row's sources, if any (for `memory_pulled`). */
export function firstSourcePr(sources: unknown): number | undefined {
  const arr = (sources as MemorySource[] | null) ?? [];
  const withPr = arr.find((s) => s.pr != null);
  return withPr?.pr ?? undefined;
}
