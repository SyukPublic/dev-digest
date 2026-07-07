import type { OnboardingFacts, RankedFile } from '@devdigest/shared';
import type { RepoIntel } from '../repo-intel/types.js';
import { READING_PATH_FILE_COUNT } from './constants.js';

/**
 * The PURE facts assembler — the deterministic "code collects the facts" half of
 * the house pattern. It turns the read-only `repoIntel.*` facade into an
 * `OnboardingFacts` bundle with ZERO LLM/embedding calls (AC-22), which the
 * single structured LLM call later narrates.
 *
 * Onion note: this is pure application logic. It depends ONLY on the `RepoIntel`
 * facade interface (never the indexer pipeline, rule 7) and holds no DB handle,
 * no SDK client, no clock, no fs — every input arrives through the facade so it
 * unit-tests against a mock with no infrastructure.
 *
 * Two invariants it enforces before any model is involved:
 *   - reading_path file SET + ORDER are FIXED here (AC-3): the order comes from
 *     `getTopFilesByRank` (rank-authoritative) paired with `getCriticalPaths`
 *     dependency chains — the model may not reorder or invent files.
 *   - ranking is `rank = pagerank` (`getFileRank.percentile`) exactly as the
 *     facade computes today — NO churn/hotness compute, NO clone deepening (AC-4).
 *
 * Degrades, never throws (AC-9): the facade's array methods return `[]` and its
 * object methods carry `degraded`/`reason` when the index is partial/absent, so
 * a degraded facade yields a fact-only bundle (empty arrays + `degraded` flags)
 * rather than an exception. `getIndexState()` always resolves.
 */

/**
 * Assemble the facts bundle for one repo from the facade. All five facade calls
 * are reads; a `getRepoMap`/`getTopFilesByRank`/etc. that degrades simply
 * contributes empty/degraded data — the bundle is still well-formed (AC-9).
 */
export async function assembleFacts(
  repoIntel: RepoIntel,
  repoId: string,
): Promise<OnboardingFacts> {
  // Index state ALWAYS resolves (facade invariant) — it is the authority for the
  // degraded flags carried in the bundle.
  const indexState = await repoIntel.getIndexState(repoId);

  // Repo skeleton: the compact repo map at the pipeline DEFAULT token budget (no
  // budget arg → DEFAULT_REPO_MAP_TOKEN_BUDGET). Degrades to '' when unavailable.
  const repoMap = await repoIntel.getRepoMap(repoId);

  // reading_path order authority (AC-3): the top-N files by PageRank define both
  // the SET and its baseline ORDER; dependency chains refine it below.
  const topFiles = await repoIntel.getTopFilesByRank(repoId, READING_PATH_FILE_COUNT);

  // Dependency chains — fix the reading_path order so an early file's dependants
  // follow it. Empty when the graph is absent (degraded).
  const criticalPaths = await repoIntel.getCriticalPaths(repoId);

  // Rank metadata (`percentile`) for exactly the reading-path files, in their
  // authoritative order. `getFileRank` may reorder its rows, so we re-key by path
  // to PRESERVE the facade's `getTopFilesByRank` order (AC-3/AC-4).
  const rankRows = topFiles.length > 0 ? await repoIntel.getFileRank(repoId, topFiles) : [];
  const percentileByPath = new Map(rankRows.map((r) => [r.path, r.percentile]));
  const rankedFiles: RankedFile[] = topFiles.map((path) => ({
    path,
    percentile: percentileByPath.get(path) ?? 0,
  }));

  return {
    repoSkeleton: repoMap.text,
    rankedFiles,
    criticalPaths,
    indexState: {
      filesIndexed: indexState.filesIndexed,
      // Contract carries an ISO string (or null); the facade carries a Date.
      updatedAt: indexState.updatedAt ? indexState.updatedAt.toISOString() : null,
      // A degraded/partial/failed index is degraded for the tour's purposes; the
      // explicit `degraded` flag OR a non-full status both count (AC-9).
      degraded: indexState.degraded === true || indexState.status !== 'full',
      degradedReason: indexState.degradedReason ?? indexState.reason ?? null,
    },
  };
}
