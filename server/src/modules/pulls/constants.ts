/** Constants for the pulls module. */

/**
 * Max PRs whose diff stats are backfilled per list request. The PR-list payload
 * from GitHub carries no diff stats, so freshly-imported PRs land with zeroed
 * size; each backfill is a per-PR detail fetch, so we cap it and let the
 * periodic refetch chip away at any remainder.
 */
export const BACKFILL_LIMIT = 10;
