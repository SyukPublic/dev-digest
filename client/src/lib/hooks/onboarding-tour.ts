/* hooks/onboarding-tour.ts — React Query hooks for the per-repo Onboarding Tour
   (CP-8). Mirrors the project-context hook pair: a repoId-keyed GET query plus a
   generate mutation that seeds the query cache with the authoritative result.

   The query is keyed by `repoId` so a repo switch re-queries and the page shows
   the CURRENT repo's tour — no cross-repo bleed while a generation is pending
   (AC-11). Reads are LLM-free (AC-22); the POST triggers the single structured
   LLM call server-side and returns the fresh `OnboardingTourResponse`. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { OnboardingTourResponse } from "@devdigest/shared";

/** The stored tour + meta for the active repo (or `tour: null` when none exists
 *  yet → the page shows the Generate empty state, AC-6). Disabled until a repo is
 *  selected; keyed by repoId so switching repos re-queries (AC-11). */
export function useOnboardingTour(repoId?: string | null) {
  return useQuery({
    queryKey: ["onboarding-tour", repoId],
    queryFn: () => api.get<OnboardingTourResponse>(`/repos/${repoId}/onboarding-tour`),
    enabled: !!repoId,
  });
}

/** Generate (or regenerate) the tour for a repo. The mutation's `isPending`
 *  drives the AC-7 progress affordance + disabled control; on success the fresh
 *  response is written straight into the repoId-keyed query cache so the page
 *  updates without a refetch round-trip. */
export function useGenerateOnboardingTour() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) =>
      api.post<OnboardingTourResponse>(`/repos/${repoId}/onboarding-tour/generate`),
    onSuccess: (data, repoId) => qc.setQueryData(["onboarding-tour", repoId], data),
  });
}
