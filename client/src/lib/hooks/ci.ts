/* hooks/ci.ts — React Query hooks for the agent-editor CI tab + Export wizard (L07).
   A CI run IS an `agent_runs` row with source='ci'; installations + those runs
   are read per-agent, and the wizard's export/install goes through one mutation. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { CiExport, CiExportRequestBody, CiInstallation, CiRunSummary } from "@devdigest/shared";

/** Per-repo CI installations for an agent (the CI-tab installation rows). */
export function useCiInstallations(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["ci-installations", agentId],
    queryFn: () => api.get<CiInstallation[]>(`/agents/${agentId}/ci-installations`),
    enabled: !!agentId,
  });
}

/** This agent's CI runs (agent_runs WHERE source='ci') for the CI-tab history. */
export function useAgentCiRuns(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-ci-runs", agentId],
    queryFn: () => api.get<CiRunSummary[]>(`/agents/${agentId}/ci-runs`),
    enabled: !!agentId,
  });
}

/**
 * Export/install an agent to CI. The POST body is a `CiExportRequest`:
 *   - `action: "files"`   → generate the bundle (Step-2 preview), no PR/install.
 *   - `action: "open_pr"` → commit the (optionally edited) files + open the PR.
 * On success the installations + CI-run lists for the agent are invalidated.
 */
export function useExportCi(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CiExportRequestBody) => api.post<CiExport>(`/agents/${agentId}/export-ci`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ci-installations", agentId] });
      qc.invalidateQueries({ queryKey: ["agent-ci-runs", agentId] });
    },
  });
}
