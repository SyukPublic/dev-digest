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

/**
 * Skill Eval STABILITY LAYER — repeat / variance defaults (UD-1, product-tuned).
 * A stability group repeats ONE frozen snapshot N times; each run is 2 LLM
 * passes, so a group is `2 × N × cases` passes.
 */

/** Max repeat count for a stability group (`2 ≤ n ≤ STABILITY_MAX_N`). */
export const STABILITY_MAX_N = 5;

/**
 * A sample with fewer than this many completed runs is labelled "indicative
 * only" — never presented as settled variance (AC-4).
 */
export const STABILITY_MIN_N = 5;

/**
 * The flaky band: `strict` = a case is flaky WHEN its pass outcome is NOT
 * unanimous (`0 < pass_rate < 1`), NOT the harness 20–80% band (AC-5).
 */
export const STABILITY_FLAKY_BAND = 'strict' as const;
