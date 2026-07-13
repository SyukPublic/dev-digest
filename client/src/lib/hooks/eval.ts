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
  EvalCaseDraft,
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
  EvalSkillHostCandidates,
  EvalSkillSuiteRunAccepted,
  RunAllSkillsResult,
  EvalSkillSuiteDetail,
  EvalSkillsWorkspaceDashboard,
  EvalSkillCompareResult,
  EvalSkillDashboardWithStability,
  EvalSkillStabilityGroupAccepted,
  EvalSkillStabilityDetail,
} from "@devdigest/shared";

/** The 4s-while-running poll interval, matching usePrRuns (AC-12). */
export const EVAL_POLL_MS = 4000;

/** True while any recent suite run is still `running` — drives 4s polling. */
export function anyRunning(runs: Pick<EvalSuiteRun, "status">[] | undefined): boolean {
  return (runs ?? []).some((r) => r.status === "running");
}

/**
 * The owner an eval case belongs to. L06 shipped agent-only cases; the skill eval
 * pipeline adds the `skill` owner. Create/update/delete hooks are owner-aware so
 * they invalidate the correct case-list + dashboard query keys. A bare string is
 * accepted for backward compatibility (treated as an agent id — the two existing
 * agent call sites pass it that way).
 */
export type EvalCaseOwner = { kind: "agent" | "skill"; id: string; name?: string };

function toOwner(owner: EvalCaseOwner | string): EvalCaseOwner {
  return typeof owner === "string" ? { kind: "agent", id: owner } : owner;
}

/** The case-list query key for an owner (agent or skill). */
function caseListKey(owner: EvalCaseOwner): readonly [string, string] {
  return owner.kind === "skill" ? ["skill-eval-cases", owner.id] : ["eval-cases", owner.id];
}

/** The per-owner dashboard query key (agent or skill). */
function dashboardKey(owner: EvalCaseOwner): readonly [string, string] {
  return owner.kind === "skill" ? ["skill-eval-dashboard", owner.id] : ["eval-dashboard", owner.id];
}

// ---- Case creation ----

/**
 * Derive (WITHOUT persisting) the eval-case draft a decided finding would
 * produce — the PR "Turn into eval case" flow opens the Case Editor on this
 * draft, and Save creates the case via `useCreateEvalCase`. A mutation (not a
 * query): it's fired imperatively on click and never cached. Errors (AC-4 file
 * gone / AC-3 pending) surface to the caller's `onError`.
 */
export function useEvalCaseDraftFromFinding() {
  return useMutation({
    mutationFn: (findingId: string) =>
      api.get<EvalCaseDraft>(`/findings/${findingId}/eval-case/preview`),
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

/** Owner-aware: invalidates the owner's (agent OR skill) case-list key on success. */
export function useCreateEvalCase(owner: EvalCaseOwner | string) {
  const qc = useQueryClient();
  const o = toOwner(owner);
  return useMutation({
    mutationFn: (input: EvalCaseInput) => api.post<EvalCase>(`/eval-cases`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: caseListKey(o) }),
  });
}

/** Owner-aware: invalidates the owner's case-list key + caches the updated case. */
export function useUpdateEvalCase(owner: EvalCaseOwner | string) {
  const qc = useQueryClient();
  const o = toOwner(owner);
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: EvalCaseInput }) =>
      api.put<EvalCase>(`/eval-cases/${id}`, input),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: caseListKey(o) });
      qc.setQueryData(["eval-case", updated.id], updated);
    },
  });
}

/** Owner-aware: invalidates the owner's case-list + dashboard keys on success. */
export function useDeleteEvalCase(owner: EvalCaseOwner | string) {
  const qc = useQueryClient();
  const o = toOwner(owner);
  return useMutation({
    mutationFn: (caseId: string) => api.del<{ ok: boolean }>(`/eval-cases/${caseId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: caseListKey(o) });
      qc.invalidateQueries({ queryKey: dashboardKey(o) });
    },
  });
}

// ---- Runs ----

/** Start a suite run for an agent (returns the running suite id immediately). */
export function useRunAgentEvals(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<EvalSuiteRunAccepted>(`/agents/${agentId}/eval-runs`),
    // Returning the Promise.all keeps the mutation `pending` until the dashboard
    // refetch lands (React Query v5 awaits it), so the Run button's spinner
    // bridges the POST→refetch window with no busy→idle→busy flicker; after the
    // refetch the dashboard has the running suite → its refetchInterval kicks in.
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["eval-dashboard", agentId] }),
        qc.invalidateQueries({ queryKey: ["eval-cases", agentId] }),
      ]),
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

// ===========================================================================
// Skill eval pipeline — DIFFERENTIAL (delta) hooks. Skill-parallel mirrors of
// the agent hooks above; a skill delta is meaningless without a host agent, so
// run-start hooks carry a `host_agent_id`. All poll on the same 4s-while-running
// interval and stop on terminal.
// ===========================================================================

/**
 * A skill's eval-case list items (status + latest-run summary). Pass
 * `pollWhileSuiteRunning` (from the dashboard's `recent_runs`) to pick up the
 * suite's progressive per-case rows on the 4s interval (AC-1).
 */
export function useSkillEvalCases(skillId: string | null | undefined, pollWhileSuiteRunning = false) {
  return useQuery({
    queryKey: ["skill-eval-cases", skillId],
    queryFn: () => api.get<EvalCaseListItem[]>(`/skills/${skillId}/eval-cases`),
    enabled: !!skillId,
    refetchInterval: pollWhileSuiteRunning ? EVAL_POLL_MS : false,
  });
}

/** The candidate host agents a skill can be evaluated on (default + all enabled). */
export function useSkillEvalHosts(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-eval-hosts", skillId],
    queryFn: () => api.get<EvalSkillHostCandidates>(`/skills/${skillId}/eval-hosts`),
    enabled: !!skillId,
  });
}

/** Start a differential suite for a skill on a host (returns the running id now). */
export function useRunSkillEvals(skillId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (hostAgentId: string) =>
      api.post<EvalSkillSuiteRunAccepted>(`/skills/${skillId}/eval-runs`, { host_agent_id: hostAgentId }),
    // Return the Promise.all so the mutation stays `pending` until the refetch
    // lands — the Run button's spinner bridges the POST→refetch window, then the
    // dashboard's `running` suite takes over the busy signal (INSIGHTS 2026-07-01).
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["skill-eval-dashboard", skillId] }),
        qc.invalidateQueries({ queryKey: ["skill-eval-cases", skillId] }),
      ]),
  });
}

/** Run differential suites for every skill with >=1 case and a resolvable host. */
export function useRunAllSkills() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<RunAllSkillsResult>(`/skill-eval-runs/all`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skill-eval-workspace-dashboard"] }),
  });
}

/** Shared key so every in-flight single skill-case run is visible via useMutationState. */
export const RUN_SKILL_CASE_MUTATION_KEY = ["eval-run-skill-case"] as const;

/**
 * Run a single skill case on demand against a host. Parallel runs are allowed.
 * Uses a distinct mutation key from the agent path so the two per-row spinners
 * never cross-report (INSIGHTS 2026-07-10).
 */
export function useRunSkillCase(skillId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: [...RUN_SKILL_CASE_MUTATION_KEY],
    mutationFn: ({ caseId, hostAgentId }: { caseId: string; hostAgentId: string }) =>
      api.post<EvalRunResult>(`/eval-cases/${caseId}/skill-run`, { host_agent_id: hostAgentId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skill-eval-cases", skillId] });
      qc.invalidateQueries({ queryKey: ["skill-eval-dashboard", skillId] });
    },
  });
}

/**
 * Case ids with a single skill-case run currently in flight — one entry per
 * pending mutation, regardless of which component started it. Drives the per-row
 * Run spinner honestly under parallel runs.
 */
export function useRunningSkillCaseIds(): string[] {
  return useMutationState({
    filters: { mutationKey: [...RUN_SKILL_CASE_MUTATION_KEY], status: "pending" },
    select: (m) => (m.state.variables as { caseId: string }).caseId,
  });
}

/** A skill suite + its per-case delta rows; polls at 4s while running. */
export function useSkillEvalSuite(suiteId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-eval-suite", suiteId],
    queryFn: () => api.get<EvalSkillSuiteDetail>(`/skill-eval-runs/${suiteId}`),
    enabled: !!suiteId,
    refetchInterval: (query) =>
      query.state.data?.suite.status === "running" ? EVAL_POLL_MS : false,
  });
}

/**
 * Per-skill differential dashboard; polls at 4s while a suite is running (AC-26).
 * The response now carries the stability layer's variance + per-case flags +
 * noise-aware alert (SPEC-2026-07-12-skill-eval-stability, AC-10).
 */
export function useSkillEvalDashboard(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-eval-dashboard", skillId],
    queryFn: () => api.get<EvalSkillDashboardWithStability>(`/skills/${skillId}/eval-dashboard`),
    enabled: !!skillId,
    refetchInterval: (query) => (anyRunning(query.state.data?.recent_runs) ? EVAL_POLL_MS : false),
  });
}

/**
 * Start a STABILITY GROUP: repeat the frozen (skill, host) snapshot N times to
 * sample the LLM variance the single differential run hides. Returns the running
 * group id immediately (fire-and-forget). `onSuccess` invalidates the per-skill
 * dashboard so its stability block + the running group's variance start flowing.
 */
export function useStartSkillStability(skillId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ hostAgentId, n }: { hostAgentId: string; n: number }) =>
      api.post<EvalSkillStabilityGroupAccepted>(`/skills/${skillId}/stability-runs`, {
        host_agent_id: hostAgentId,
        n,
      }),
    // Keep the mutation pending until the refetch lands so the button spinner
    // bridges the POST→refetch window (the same idiom as useRunSkillEvals).
    onSuccess: (accepted) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["skill-eval-dashboard", skillId] }),
        qc.invalidateQueries({ queryKey: ["skill-stability-group", accepted.group_id] }),
      ]),
  });
}

/**
 * A stability group + its variance summary + per-case flags; polls at 4s while
 * the group is running and stops on a terminal status.
 */
export function useSkillStabilityGroup(groupId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-stability-group", groupId],
    queryFn: () => api.get<EvalSkillStabilityDetail>(`/skill-stability-runs/${groupId}`),
    enabled: !!groupId,
    refetchInterval: (query) =>
      query.state.data?.group.status === "running" ? EVAL_POLL_MS : false,
  });
}

/** All-skills dashboard; polls at 4s while any skill suite is running (AC-24). */
export function useWorkspaceSkillEvalDashboard() {
  return useQuery({
    queryKey: ["skill-eval-workspace-dashboard"],
    queryFn: () => api.get<EvalSkillsWorkspaceDashboard>(`/skill-eval-dashboard`),
    refetchInterval: (query) => (anyRunning(query.state.data?.recent_runs) ? EVAL_POLL_MS : false),
  });
}

/** Compare two skill suite runs (metric+cost deltas + skill-body diff, AC-28). */
export function useCompareSkillRuns(a: string | null | undefined, b: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-eval-compare", a, b],
    queryFn: () => api.get<EvalSkillCompareResult>(`/skill-eval-compare?a=${a}&b=${b}`),
    enabled: !!a && !!b,
  });
}
