/* hooks/conventions.ts — React Query hooks for the Conventions Extractor:
   list candidates for the active repo, trigger a (background) scan, curate
   (accept/reject + inline edit), and link a freshly-merged skill to an agent. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { AgentSkillLink, ConventionCandidate } from "@devdigest/shared";

/** Candidates for a repo. `poll` enables 2s refetch while a scan is running
 *  (the scan is a background job — mirrors the repo-intel index-state poll). */
export function useConventions(repoId: string | null | undefined, poll = false) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionCandidate[]>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
    refetchInterval: poll ? 2000 : false,
  });
}

/** Trigger a scan/re-scan. Returns 202 + jobId; results arrive via the poll. */
export function useExtractConventions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) =>
      api.post<{ status: string; jobId: string }>(`/repos/${repoId}/conventions/extract`),
    onSuccess: (_d, repoId) => qc.invalidateQueries({ queryKey: ["conventions", repoId] }),
  });
}

export interface UpdateConventionInput {
  repoId: string;
  id: string;
  patch: Partial<
    Pick<ConventionCandidate, "rule" | "accepted" | "category" | "evidence_path" | "evidence_snippet">
  >;
}

/** Accept/reject or inline-edit a single candidate. */
export function useUpdateConvention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, id, patch }: UpdateConventionInput) =>
      api.patch<ConventionCandidate>(`/repos/${repoId}/conventions/${id}`, patch),
    onSuccess: (_d, { repoId }) => qc.invalidateQueries({ queryKey: ["conventions", repoId] }),
  });
}

/** Link a (just-created) skill to an agent without disturbing its other skills. */
export function useLinkAgentSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, skillId }: { agentId: string; skillId: string }) =>
      api.post<AgentSkillLink[]>(`/agents/${agentId}/skills`, { skill_id: skillId }),
    onSuccess: (_d, { agentId }) => qc.invalidateQueries({ queryKey: ["agent-skills", agentId] }),
  });
}
