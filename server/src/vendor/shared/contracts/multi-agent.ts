import { z } from 'zod';
import { ReviewRunTarget } from './review-api.js';

/**
 * Multi-agent review — transport shapes for launching an N-agent run and for the
 * per-agent history-based estimate shown before launch.
 *
 * These are the ONLY-missing transport shapes: the result view (MultiAgentRun,
 * AgentColumn, Conflict, …) already lives in `contracts/observability.ts` and is
 * reused as-is. This is a NEW file (the barrel is extended with a new export
 * line, never edited in place).
 *
 *   - MultiAgentRunRequest   body of POST /pulls/:id/multi-agent-run
 *   - MultiAgentRunLaunch    fire-and-forget launch ack for that endpoint
 *   - AgentEstimate(s)       response of GET /agents/estimates
 */

// ---------------------------------------------------------------------------
// Launch (POST /pulls/:id/multi-agent-run)
// ---------------------------------------------------------------------------

/** Body: the agents to run in parallel against the PR (at least one). */
export const MultiAgentRunRequest = z.object({
  agent_ids: z.array(z.string()).min(1),
});
export type MultiAgentRunRequest = z.infer<typeof MultiAgentRunRequest>;

/**
 * Fire-and-forget launch ack. Each run streams over SSE at `/runs/:runId/events`;
 * the assembled result is fetched later via the multi-agent view. Mirrors the
 * existing fire-and-forget ReviewRunResponse shape (snake_case, `run_id`/`agent_id`
 * /`agent_name` per run — REUSING ReviewRunTarget).
 */
export const MultiAgentRunLaunch = z.object({
  multi_run_id: z.string(),
  pr_id: z.string(),
  runs: z.array(ReviewRunTarget),
});
export type MultiAgentRunLaunch = z.infer<typeof MultiAgentRunLaunch>;

// ---------------------------------------------------------------------------
// Pre-launch estimate (GET /agents/estimates)
// ---------------------------------------------------------------------------

/**
 * A per-agent estimate derived from run history, shown before launch. Averages
 * are null when there is no history (never 0-as-"unknown"); `sample_size` is the
 * number of runs the averages are computed over (0 => fall back to a heuristic,
 * not a real estimate).
 */
export const AgentEstimate = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  avg_duration_ms: z.number().nullable(),
  avg_cost_usd: z.number().nullable(),
  sample_size: z.number().int().min(0),
});
export type AgentEstimate = z.infer<typeof AgentEstimate>;

/** Response of GET /agents/estimates — one estimate per selectable agent. */
export const AgentEstimates = z.array(AgentEstimate);
export type AgentEstimates = z.infer<typeof AgentEstimates>;
