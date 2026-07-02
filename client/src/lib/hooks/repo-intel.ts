/* hooks/repo-intel.ts — React Query hooks for the repo-intel (T3) index state.
   Mirrors hooks/context.ts (useIndexStatus/useReindex) but targets the
   repo-intel facade's HTTP surface:
     GET  /repos/:id/index-state  → RepoIntelState
     POST /repos/:id/resync       → fetch latest from origin + incremental
                                     reindex (202). NOT a destructive re-clone. */
"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";

/** Subset of the server's IndexState the badge + completion-poll need (kept
    local — not in @devdigest/shared, since repo-intel types live server-side). */
export interface RepoIntelState {
  status: "full" | "partial" | "degraded" | "failed";
  filesIndexed: number;
  filesSkipped: number;
  /** Advances when a resync writes a new index row → the UI's completion signal. */
  lastIndexedSha: string;
  updatedAt: string;
  /** True while an index run is in progress — the reliable "still working" signal
      (server-stamped at start, cleared at the terminal write). */
  indexing?: boolean;
  degraded?: boolean;
  degradedReason?: string;
  reason?: string;
}

/** GET /repos/:id/index-state → current repo-intel index state.
    Polls (1.5s) while `poll` is true (a refresh was just kicked off) OR while the
    server reports `indexing` in progress, then stops once the run settles — so
    the caller gets a reliable "reindexing… → done" signal from the `indexing`
    flag itself (the status enum is terminal-only and can't show in-progress). */
export function useRepoIntelStatus(repoId: string | null | undefined, poll = false) {
  return useQuery({
    queryKey: ["repo-intel-state", repoId],
    queryFn: () => api.get<RepoIntelState>(`/repos/${repoId}/index-state`),
    enabled: !!repoId,
    refetchInterval: (query) => (poll || query.state.data?.indexing ? 1500 : false),
  });
}

/**
 * Auto-refresh the Blast Radius card(s) once a repo re-index actually COMPLETES.
 *
 * Timing: the refresh/resync POSTs return 202 at ENQUEUE time — the index is
 * rebuilt asynchronously LATER — so invalidating `["blast"]` in their `onSuccess`
 * would refetch before the new index exists and show nothing new. The reliable
 * completion signal is `RepoIntelState.lastIndexedSha` advancing (it "advances when
 * a resync writes a new index row"); `useRepoIntelStatus` self-polls (1.5s) while
 * `indexing` is true, so a mounted consumer observes the new sha and we react to it.
 *
 * Ref-guard: we skip the FIRST sha we see for a given repo — the mount's initial
 * blast fetch already targets that index, so there is nothing stale to refetch yet.
 * We only act on a SUBSEQUENT change (mirrors `useInvalidateOnHeadChange`).
 *
 * No loop: `["blast"]` is a PREFIX key so it invalidates every `["blast", prId]`
 * query (a reindex affects the whole repo). Invalidating blast never touches the
 * `["repo-intel-state", repoId]` query that feeds `lastIndexedSha`, so the effect
 * re-runs only on a genuine sha change — it can't retrigger itself.
 */
export function useRefetchBlastOnReindex(
  repoId: string | null | undefined,
  lastIndexedSha: string | null | undefined,
): void {
  const qc = useQueryClient();
  const prevRef = useRef<{ repoId: typeof repoId; sha: string | null | undefined }>({
    repoId: undefined,
    sha: undefined,
  });

  useEffect(() => {
    if (repoId == null || lastIndexedSha == null) return;
    const prev = prevRef.current;
    const isFirstForRepo = prev.repoId !== repoId;
    prevRef.current = { repoId, sha: lastIndexedSha };
    // Skip the first sha for a given repo (mount already used that index);
    // only act on a SUBSEQUENT change → the reindex just completed.
    if (isFirstForRepo || prev.sha === lastIndexedSha) return;
    qc.invalidateQueries({ queryKey: ["blast"] });
  }, [qc, repoId, lastIndexedSha]);
}

/** POST /repos/:id/resync → fetch latest + incremental reindex (resync, not re-clone). */
export function useResyncRepoIntel(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ status: string }>(`/repos/${repoId}/resync`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["repo-intel-state", repoId] });
    },
  });
}
