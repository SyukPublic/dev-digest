/**
 * L06 Agent Eval Pipeline — module constants.
 */

/** Rate limit for the run-start endpoints (per-agent suite + run-all + single
 *  case): each call can fan out to expensive LLM runs, matching the review
 *  endpoints' 10/min (Non-functional / perf). */
export const EVAL_RUN_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;

/** owner_kind for the v1 agent-only surface (the 'skill' owner stays dormant). */
export const EVAL_OWNER_AGENT = 'agent' as const;

/** owner_kind for the DIFFERENTIAL skill surface (activated by the skill-eval pipeline). */
export const EVAL_OWNER_SKILL = 'skill' as const;

/** How many recent suite runs a dashboard surfaces (recent-N, not a date range). */
export const RECENT_RUNS_LIMIT = 20;
