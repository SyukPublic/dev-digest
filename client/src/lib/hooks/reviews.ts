/* hooks/reviews.ts — React Query + SSE hooks for the A2 reviewer.
   Run a review, stream RunEvents live, act on findings. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, API_BASE } from "../api";
import type {
  BlastResponse,
  FindingActionKind,
  PrIntentRecord,
  PrReviewComment,
  PrRisksRecord,
  ReviewRecord,
  ReviewRunResponse,
  RunSummary,
  SmartDiffResponse,
} from "@devdigest/shared";
import { useSseEvents } from "./sse";

// ---- Active (in-flight) runs — server-side source of truth ----
export interface ActiveRun {
  run_id: string;
  agent_id: string | null;
  agent_name: string | null;
  ran_at: string | null;
}

/** In-flight runs for a PR, from the server (agent_runs where status='running').
   Survives reloads/devices; polls while anything is running so it self-clears. */
export function usePrActiveRuns(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-active-runs", prId],
    queryFn: () => api.get<ActiveRun[]>(`/pulls/${prId}/runs/active`),
    enabled: !!prId,
    refetchInterval: (query) => ((query.state.data?.length ?? 0) > 0 ? 4000 : false),
  });
}

// ---- Full run history for a PR (every agent_runs row, any status) ----
/** All runs for a PR — done, failed (with error), cancelled, running. Survives
   reload (DB-backed). Polls while anything is running so it self-updates. */
export function usePrRuns(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-runs", prId],
    queryFn: () => api.get<RunSummary[]>(`/pulls/${prId}/runs`),
    enabled: !!prId,
    refetchInterval: (query) =>
      (query.state.data ?? []).some((r) => r.status === "running") ? 4000 : false,
  });
}

// ---- Persisted reviews + findings for a PR ----
export function usePrReviews(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["reviews", prId],
    queryFn: () => api.get<ReviewRecord[]>(`/pulls/${prId}/reviews`),
    enabled: !!prId,
  });
}

/** Delete one run from the PR's run history (+ its trace). */
export function useDeleteRun(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => api.del<{ ok: boolean }>(`/runs/${runId}`),
    // Deleting a run also deletes the review it produced (server-side), so drop
    // both the timeline and the Review Runs list from cache.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pr-runs", prId] });
      qc.invalidateQueries({ queryKey: ["reviews", prId] });
    },
  });
}

/** Request cancellation of an in-flight run (takes effect at the next step). */
export function useCancelRun() {
  return useMutation({
    mutationFn: (runId: string) => api.post<{ ok: boolean }>(`/runs/${runId}/cancel`),
  });
}

/** Delete a whole review run (one agent's pass) + its findings. */
export function useDeleteReview(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reviewId: string) => api.del<{ ok: boolean }>(`/reviews/${reviewId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reviews", prId] }),
  });
}

// ---- Inline review comments on the "Files changed" tab (proxied to GitHub) --
/** Existing GitHub PR review comments, fetched live. */
export function usePrComments(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-comments", prId],
    queryFn: () => api.get<PrReviewComment[]>(`/pulls/${prId}/comments`),
    enabled: !!prId,
  });
}

export interface CreateCommentInput {
  path: string;
  line: number;
  side?: "LEFT" | "RIGHT";
  body: string;
  in_reply_to?: number;
}

/** Post one inline comment (or reply) to GitHub; refreshes the thread list. */
export function useCreatePrComment(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCommentInput) =>
      api.post<PrReviewComment>(`/pulls/${prId}/comments`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pr-comments", prId] }),
  });
}

// ---- Run a review (all enabled agents or a specific agent) ----
export interface RunReviewInput {
  prId: string;
  agentId?: string;
  all?: boolean;
}

export function useRunReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ prId, agentId, all }: RunReviewInput) =>
      api.post<ReviewRunResponse>(`/pulls/${prId}/review`, {
        ...(agentId ? { agentId } : {}),
        ...(all ? { all } : {}),
      }),
    onSuccess: (_d, { prId }) => {
      qc.invalidateQueries({ queryKey: ["reviews", prId] });
    },
  });
}

// ---- Finding actions (accept/dismiss) ----
export function useFindingAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      findingId,
      action,
      reply,
      prId: _prId,
    }: {
      findingId: string;
      action: FindingActionKind;
      reply?: string;
      prId?: string;
    }) =>
      api.post<{ finding: ReviewRecord["findings"][number]; memoryId?: string }>(
        `/findings/${findingId}/${action}`,
        reply ? { reply } : undefined,
      ),
    onSuccess: (_d, { prId }) => {
      if (prId) qc.invalidateQueries({ queryKey: ["reviews", prId] });
    },
  });
}

/** Subscribe to a run's SSE event stream. Thin wrapper over useSseEvents. */
export function useRunEvents(runIds: string[]) {
  return useSseEvents(runIds.map((id) => `${API_BASE}/runs/${id}/events`));
}

// ---- PR intent (derived intent + scope) ----

/** Fetch the stored intent record for a PR. Returns null when not yet computed. */
export function usePrIntent(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["intent", prId],
    queryFn: () => api.get<PrIntentRecord | null>(`/pulls/${prId}/intent`),
    enabled: prId != null,
  });
}

/** Recompute the intent for a PR and cache the fresh record. */
export function useRecomputeIntent(prId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PrIntentRecord>(`/pulls/${prId}/intent/recompute`),
    onSuccess: (d) => qc.setQueryData(["intent", prId], d),
  });
}

// ---- PR risk areas (derived risks from the Risks brief pipeline) ----

/** Fetch the stored risks record for a PR. Returns null when not yet computed. */
export function usePrRisks(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["risks", prId],
    queryFn: () => api.get<PrRisksRecord | null>(`/pulls/${prId}/risks`),
    enabled: prId != null,
  });
}

/** Recompute the risks for a PR and cache the fresh record. */
export function useRecomputeRisks(prId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PrRisksRecord>(`/pulls/${prId}/risks/recompute`),
    onSuccess: (d) => qc.setQueryData(["risks", prId], d),
  });
}

// ---- Blast radius (deterministic downstream-impact map; read-only) ----

/** Fetch the live, workspace-scoped blast radius for a PR. The map is
   deterministic (call-graph derived) + the LLM summary is server-cached, so
   this is a plain read with no mutation. */
export function usePrBlast(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["blast", prId],
    queryFn: () => api.get<BlastResponse>(`/pulls/${prId}/blast`),
    enabled: prId != null,
  });
}

// ---- Smart Diff (deterministic risk-ordered file layout + finding overlay) ----

/** Fetch the deterministically composed smart-diff layout for a PR. */
export function usePrSmartDiff(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["smart-diff", prId],
    queryFn: () => api.get<SmartDiffResponse>(`/pulls/${prId}/smart-diff`),
    enabled: prId != null,
  });
}
