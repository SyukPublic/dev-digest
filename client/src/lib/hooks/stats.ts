/* hooks/stats.ts — React Query hooks for the three read-only stats surfaces
   (L08): the per-agent Stats tab, the per-skill Stats tab, and the global Agent
   Performance dashboard. All access goes through `api.get` with types from
   `@devdigest/shared` (never redefined). The active period is folded into the
   `queryKey` so switching the period control refetches (AC-10/11/21/29). */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { periodToQuery, periodKey, type StatsPeriod } from "../period";
import type { AgentStats, AgentPerf, SkillStats } from "@devdigest/shared";

/** GET /agents/:id/stats — the per-agent Stats tab (AC-21). */
export function useAgentStats(agentId: string, period: StatsPeriod) {
  return useQuery({
    queryKey: ["agent-stats", agentId, periodKey(period)],
    queryFn: () => api.get<AgentStats>(`/agents/${agentId}/stats${periodToQuery(period)}`),
  });
}

/** GET /skills/:id/stats — the per-skill Stats tab (AC-29). */
export function useSkillStats(skillId: string, period: StatsPeriod) {
  return useQuery({
    queryKey: ["skill-stats", skillId, periodKey(period)],
    queryFn: () => api.get<SkillStats>(`/skills/${skillId}/stats${periodToQuery(period)}`),
  });
}

/** GET /agents/performance — the global dashboard (AC-11). */
export function useAgentPerformance(period: StatsPeriod) {
  return useQuery({
    queryKey: ["agent-performance", periodKey(period)],
    queryFn: () => api.get<AgentPerf>(`/agents/performance${periodToQuery(period)}`),
  });
}
