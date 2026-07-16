/**
 * Review Memory — module constants.
 *
 * The memory module fills the (course-scaffold) `memory` table: workspace-scoped
 * CRUD plus real pgvector semantic retrieval, injected best-effort into local
 * studio reviews. All tuning parameters were decided in the spec (no open Qs).
 */

/** Top-N memory entries injected into a review's prompt (spec decision AC-9). */
export const INJECTION_TOP_N = 5;

/**
 * Minimum cosine SIMILARITY (1 - cosineDistance) for a memory entry to count as
 * a match — used both for review injection (AC-9/AC-12) and for the studio
 * semantic search relevance floor. Cosine similarity ∈ [-1, 1]; 0.75 is a high,
 * conservative bar so only genuinely relevant entries are pulled.
 */
export const SIMILARITY_THRESHOLD = 0.75;

/** Freshness cutoff (days): an entry is "stale" when last used > this ago or
 *  never used (AC-16). */
export const STALE_DAYS = 60;

/** Upper bound on rows returned by the studio semantic search (AC-3). Larger
 *  than the injection top-N because the list view can show more matches. */
export const SEARCH_TOP_N = 50;
