/* hooks/multi-agent.ts — React Query hooks for the L07 Multi-Agent Review.
   Launch an N-agent run over a PR, read the assembled multi-run, and fetch the
   pre-launch per-agent estimates. All API access goes through lib/api.ts.

   Contracts are imported TYPE-ONLY (never value-import a Zod schema in the
   client — it would pull zod into the bundle). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  AgentEstimates,
  MultiAgentRun,
  MultiAgentRunLaunch,
  MultiAgentRunRequest,
} from "@devdigest/shared";

// ---- Pre-launch per-agent estimates (GET /agents/estimates) ----

/** History-based per-agent time/cost estimate shown before launching a run.
   Averages are null when there is no history (never 0-as-"unknown"). */
export function useAgentEstimates() {
  return useQuery({
    queryKey: ["agent-estimates"],
    queryFn: () => api.get<AgentEstimates>("/agents/estimates"),
  });
}

// ---- Launch an N-agent run (POST /pulls/:id/multi-agent-run) ----

export interface LaunchMultiAgentRunInput {
  prId: string;
  agentIds: string[];
}

/** Launch a multi-agent review over a PR. Fire-and-forget: the ack carries the
   per-run ids so the page can subscribe to each run's SSE immediately, then
   read the assembled result via useMultiAgentRun. */
export function useLaunchMultiAgentRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ prId, agentIds }: LaunchMultiAgentRunInput) =>
      api.post<MultiAgentRunLaunch>(`/pulls/${prId}/multi-agent-run`, {
        agent_ids: agentIds,
      } satisfies MultiAgentRunRequest),
    onSuccess: (_d, { prId }) => {
      // The freshly-launched run is now the latest for this PR.
      qc.invalidateQueries({ queryKey: ["multi-agent-run", prId] });
    },
  });
}

// ---- The assembled multi-run for a PR (GET /pulls/:id/multi-agent) ----

/** The latest assembled multi-run for a PR — per-agent columns + on-read
   conflicts. Polls while any column is still `running` so live status
   self-updates on reload; the live event feed itself is the page's ColumnsView
   job (useRunEvents over the per-run SSE streams), not this poll. */
export function useMultiAgentRun(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["multi-agent-run", prId],
    queryFn: () => api.get<MultiAgentRun>(`/pulls/${prId}/multi-agent`),
    enabled: prId != null,
    refetchInterval: (query) =>
      (query.state.data?.columns ?? []).some((c) => c.status === "running") ? 4000 : false,
  });
}
