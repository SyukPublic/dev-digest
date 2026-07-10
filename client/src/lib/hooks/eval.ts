/* hooks/eval.ts — React Query hooks for the L06 Agent Eval Pipeline.
   Promote a finding to a case, curate cases, run suites, read dashboards +
   compare. Suite/dashboard queries poll on the 4s-while-running interval and
   stop on a terminal status (AC-12), mirroring usePrRuns. Contracts are
   imported TYPE-ONLY (client convention). */
"use client";

import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  EvalCase,
  EvalCaseInput,
  EvalCaseListItem,
  EvalSuiteRunAccepted,
  RunAllResult,
  EvalRunResult,
  EvalSuiteDetail,
  EvalAgentDashboard,
  EvalWorkspaceDashboard,
  EvalCompareResult,
  EvalSuiteRun,
} from "@devdigest/shared";

/** The 4s-while-running poll interval, matching usePrRuns (AC-12). */
export const EVAL_POLL_MS = 4000;

/** True while any recent suite run is still `running` — drives 4s polling. */
export function anyRunning(runs: Pick<EvalSuiteRun, "status">[] | undefined): boolean {
  return (runs ?? []).some((r) => r.status === "running");
}

// ---- Case creation ----

/** Promote a decided finding into an eval case (server resolves agent/diff/meta). */
export function useCreateEvalCaseFromFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (findingId: string) =>
      api.post<EvalCase>(`/findings/${findingId}/eval-case`),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["eval-cases", created.owner_id] });
      qc.invalidateQueries({ queryKey: ["eval-dashboard", created.owner_id] });
    },
  });
}

/**
 * An agent's eval-case list items (status + latest-run summary). Pass
 * `pollWhileSuiteRunning` (derived from the dashboard's `recent_runs`) to pick
 * up the suite's progressive per-case rows on the 4s interval (AC-11/AC-12).
 */
export function useAgentEvalCases(agentId: string | null | undefined, pollWhileSuiteRunning = false) {
  return useQuery({
    queryKey: ["eval-cases", agentId],
    queryFn: () => api.get<EvalCaseListItem[]>(`/agents/${agentId}/eval-cases`),
    enabled: !!agentId,
    refetchInterval: pollWhileSuiteRunning ? EVAL_POLL_MS : false,
  });
}

/** A single full eval case (for the Case Editor). */
export function useEvalCase(caseId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-case", caseId],
    queryFn: () => api.get<EvalCase>(`/eval-cases/${caseId}`),
    enabled: !!caseId,
  });
}

export function useCreateEvalCase(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EvalCaseInput) => api.post<EvalCase>(`/eval-cases`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["eval-cases", agentId] }),
  });
}

export function useUpdateEvalCase(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: EvalCaseInput }) =>
      api.put<EvalCase>(`/eval-cases/${id}`, input),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ["eval-cases", agentId] });
      qc.setQueryData(["eval-case", updated.id], updated);
    },
  });
}

export function useDeleteEvalCase(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) => api.del<{ ok: boolean }>(`/eval-cases/${caseId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eval-cases", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-dashboard", agentId] });
    },
  });
}

// ---- Runs ----

/** Start a suite run for an agent (returns the running suite id immediately). */
export function useRunAgentEvals(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<EvalSuiteRunAccepted>(`/agents/${agentId}/eval-runs`),
    onSuccess: () => {
      // The dashboard now has a running suite → its refetchInterval kicks in.
      qc.invalidateQueries({ queryKey: ["eval-dashboard", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-cases", agentId] });
    },
  });
}

/** Run all enabled agents with >=1 case. */
export function useRunAllAgents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<RunAllResult>(`/eval-runs/all`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["eval-workspace-dashboard"] }),
  });
}

/** Shared key so every in-flight single-case run is visible via useMutationState. */
export const RUN_CASE_MUTATION_KEY = ["eval-run-case"] as const;

/** Run a single case on demand. Parallel runs are allowed (server has no lock). */
export function useRunCase(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...RUN_CASE_MUTATION_KEY],
    mutationFn: (caseId: string) => api.post<EvalRunResult>(`/eval-cases/${caseId}/run`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eval-cases", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-dashboard", agentId] });
    },
  });
}

/**
 * Case ids with a single-case run currently in flight — one entry per pending
 * mutation, regardless of which component started it (Evals tab, Case Editor).
 * Drives the per-row Run spinner honestly under parallel runs.
 */
export function useRunningCaseIds(): string[] {
  return useMutationState({
    filters: { mutationKey: [...RUN_CASE_MUTATION_KEY], status: "pending" },
    select: (m) => m.state.variables as string,
  });
}

/** A suite + its per-case rows; polls at 4s while running, stops on terminal. */
export function useEvalSuite(suiteId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-suite", suiteId],
    queryFn: () => api.get<EvalSuiteDetail>(`/eval-runs/${suiteId}`),
    enabled: !!suiteId,
    refetchInterval: (query) =>
      query.state.data?.suite.status === "running" ? EVAL_POLL_MS : false,
  });
}

// ---- Dashboards + compare ----

/** Per-agent dashboard; polls at 4s while a suite is running (AC-12). */
export function useEvalDashboard(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-dashboard", agentId],
    queryFn: () => api.get<EvalAgentDashboard>(`/agents/${agentId}/eval-dashboard`),
    enabled: !!agentId,
    refetchInterval: (query) => (anyRunning(query.state.data?.recent_runs) ? EVAL_POLL_MS : false),
  });
}

/** All-agents dashboard; polls at 4s while any suite is running. */
export function useWorkspaceEvalDashboard() {
  return useQuery({
    queryKey: ["eval-workspace-dashboard"],
    queryFn: () => api.get<EvalWorkspaceDashboard>(`/eval-dashboard`),
    refetchInterval: (query) => (anyRunning(query.state.data?.recent_runs) ? EVAL_POLL_MS : false),
  });
}

/** Compare two suite runs (metric deltas + system-prompt diff). */
export function useCompareRuns(a: string | null | undefined, b: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-compare", a, b],
    queryFn: () => api.get<EvalCompareResult>(`/eval-compare?a=${a}&b=${b}`),
    enabled: !!a && !!b,
  });
}
