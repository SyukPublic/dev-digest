/* hooks/memory.ts — React Query hooks for Review Memory: the workspace-scoped
   list (+ facet counts) filtered by scope/kind/freshness, a separate semantic
   search (so an embeddings-off error can surface without breaking the base list,
   AC-20), and create/update/delete mutations that invalidate the list. Types
   come from @devdigest/shared and are never redefined here. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  CreateMemory,
  Memory,
  MemoryKind,
  MemoryList,
  MemoryScope,
  UpdateMemory,
} from "@devdigest/shared";

export interface MemoryFilters {
  repoId: string | null;
  scope: MemoryScope[];
  kind: MemoryKind[];
  stale: boolean;
}

function listQuery(f: MemoryFilters): string {
  const p = new URLSearchParams();
  if (f.repoId) p.set("repo_id", f.repoId);
  if (f.scope.length) p.set("scope", f.scope.join(","));
  if (f.kind.length) p.set("kind", f.kind.join(","));
  if (f.stale) p.set("stale", "true");
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Base (non-semantic) list + facet counts. The queryKey includes the active
 *  repo and every filter so a change refetches. Always enabled. */
export function useMemory(filters: MemoryFilters) {
  return useQuery({
    queryKey: ["memory", filters.repoId, filters.scope, filters.kind, filters.stale] as const,
    queryFn: ({ signal }) => api.get<MemoryList>(`/memory${listQuery(filters)}`, { signal }),
  });
}

/** Semantic search — enabled only when `q` is non-empty. On error (embeddings
 *  disabled → 503) the page renders the AC-20 error state while the base list
 *  from `useMemory` stays usable. `retry: false` so the error surfaces at once. */
export function useMemorySearch(q: string, repoId: string | null) {
  const query = q.trim();
  return useQuery({
    queryKey: ["memory-search", repoId, query] as const,
    queryFn: ({ signal }) => {
      const p = new URLSearchParams({ q: query });
      if (repoId) p.set("repo_id", repoId);
      return api.get<MemoryList>(`/memory?${p.toString()}`, { signal });
    },
    enabled: query.length > 0,
    retry: false,
  });
}

/** Invalidate every memory list (prefix match) after a mutation. */
function useInvalidateMemory() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["memory"] });
    void qc.invalidateQueries({ queryKey: ["memory-search"] });
  };
}

export function useCreateMemory() {
  const invalidate = useInvalidateMemory();
  return useMutation({
    mutationFn: (dto: CreateMemory) => api.post<Memory>("/memory", dto),
    onSuccess: invalidate,
  });
}

export function useUpdateMemory() {
  const invalidate = useInvalidateMemory();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateMemory }) =>
      api.patch<Memory>(`/memory/${id}`, patch),
    onSuccess: invalidate,
  });
}

export function useDeleteMemory() {
  const invalidate = useInvalidateMemory();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/memory/${id}`),
    onSuccess: invalidate,
  });
}
