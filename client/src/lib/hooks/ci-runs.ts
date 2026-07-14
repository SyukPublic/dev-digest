/* hooks/ci-runs.ts — React Query hooks for the global CI Runs page (L07).

   CI runs are `agent_runs` rows with source='ci', read from `GET /ci-runs`
   (workspace-scoped, server-side 7-day window). The list can pull-on-refresh:
   `useIngestCiRuns` triggers the server ingest (fetch each installed repo's
   GitHub Actions runs) then invalidates the list. Auto-refresh re-runs the
   ingest every 30s — 30s (not 4s) because GitHub rate-limits the Actions API. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { CiRunSummary } from "@devdigest/shared";

const CI_RUNS_KEY = ["ci-runs"] as const;

/** Time window for the CI-runs list; the server default is the last 7 days. */
export type CiRunsRange = "7d";

export interface CiRunsFilters {
  /** Lookback window sent to the server (default "7d"). */
  range?: CiRunsRange;
  /** When true, poll (refetch) the list every 30s. */
  autoRefresh?: boolean;
}

/**
 * Workspace CI-runs list. Agent / repo / status / source filtering is applied
 * client-side in the view (the 7-day window keeps the set small and the filter
 * option lists stable regardless of the active selection).
 */
export function useCiRuns(filters: CiRunsFilters = {}) {
  const range = filters.range ?? "7d";
  return useQuery({
    queryKey: [...CI_RUNS_KEY, range],
    queryFn: () => api.get<CiRunSummary[]>(`/ci-runs?range=${range}`),
    // 30s poll only while auto-refresh is on (GitHub Actions API is rate-limited).
    refetchInterval: filters.autoRefresh ? 30_000 : false,
  });
}

/**
 * Pull-on-refresh: trigger the server-side ingest (list each installed repo's
 * workflow runs → download + parse the result artifact → upsert `agent_runs`),
 * then invalidate the list so the freshly ingested rows render. Bound to both
 * the "Refresh" button and the 30s auto-refresh interval.
 */
export function useIngestCiRuns() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ingested: number }>("/ci-runs/ingest"),
    onSuccess: () => qc.invalidateQueries({ queryKey: CI_RUNS_KEY }),
  });
}
