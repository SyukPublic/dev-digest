/* hooks/brief.ts — React Query hooks for the Why+Risk Brief (Phase 5, CP-9).
   Mirrors the onboarding-tour / project-context hook pair: a prId-keyed GET query
   plus a regenerate mutation that SEEDS the query cache with the authoritative
   result (so the fresh brief survives an unmount — `invalidateQueries` alone would
   lose it, client INSIGHTS 2026-06-23).

   Reads are LLM-FREE (a plain GET of the cached record, `null` when none exists →
   the card shows the Generate empty state, AC-8). The POST triggers the single
   structured LLM call server-side and returns the fresh `WhyRiskBriefRecord`. The
   mutation's `isPending` drives the AC-10 progress affordance + disabled Regenerate.

   These hooks live in their OWN module (NOT appended to `reviews.ts`): adding a
   hook to a shared, test-mocked module leaves the new hook REAL in unrelated tests
   that mock via `importActual`, and its `useQuery` then dies without a provider
   (client INSIGHTS 2026-07-05). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { WhyRiskBriefRecord } from "@devdigest/shared";

/** The stored brief for a PR, or `null` when none has been generated yet (→ the
 *  card renders the Generate empty state, AC-8). Disabled until a prId is known.
 *  Pure read: no LLM call on open (AC-8). */
export function useBrief(prId?: string | null) {
  return useQuery({
    queryKey: ["brief", prId],
    queryFn: () => api.get<WhyRiskBriefRecord | null>(`/pulls/${prId}/brief`),
    enabled: !!prId,
  });
}

/** Regenerate the brief for a PR — the ONLY path that spends an LLM call. The
 *  mutation's `isPending` drives the AC-10 progress affordance + disabled control;
 *  on success the fresh record is written straight into the prId-keyed cache so the
 *  card body updates without a refetch round-trip (AC-9, INSIGHTS 2026-06-23). */
export function useRegenerateBrief() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prId: string) => api.post<WhyRiskBriefRecord>(`/pulls/${prId}/brief`),
    onSuccess: (data, prId) => qc.setQueryData(["brief", prId], data),
  });
}
