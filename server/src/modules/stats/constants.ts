/**
 * Stats module constants (pure — no DB / IO). Shared by the aggregation and the
 * period schema so the numbers stay consistent across all three surfaces.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;

/** Default period when no query param is present (AC-3): last 30 days. */
export const DEFAULT_PERIOD_DAYS = 30;

/** The two shorthand windows the period control offers (AC-10). */
export const ALLOWED_DAYS = [1, 30] as const;

/** Weekly severity bars are capped at ~6 buckets, oldest→newest (AC-25). */
export const MAX_WEEKLY_BUCKETS = 6;

/** How many recent runs feed a row/tab sparkline + the "last N runs" caption (AC-16). */
export const TREND_LIMIT = 10;

/** Cap for the summary Total-runs sparkline buckets. */
export const MAX_RUNS_TREND_BUCKETS = 30;
