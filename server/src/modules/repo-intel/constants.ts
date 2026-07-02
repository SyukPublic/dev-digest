/**
 * repo-intel constants. Phase-tagged: [T1] used now; [T2]/[T3]
 * exported early so the pipeline lands against a single source of truth.
 */

// --- Job kinds (registered on JobRunner; enqueued from repos/service.ts) ----
export const INDEX_JOB_KIND = 'repo-intel-index';
export const REFRESH_JOB_KIND = 'repo-intel-refresh';
/** Manual "re-analyze": fetch latest from origin + incremental reindex. */
export const RESYNC_JOB_KIND = 'repo-intel-resync';

// --- Walk / parse scope -----------------------------------------------------
/** [T1] Files we parse (diff-scoped in T1; whole walk in T2). */
export const SUPPORTED_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] as const;

/** [T1] Directories never walked. `.gitignore` is layered on top in T2 walk. */
export const EXCLUDED_DIRS = [
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  'out',
  'vendor',
  '.git',
] as const;

// --- Read-time limits -------------------------------------------------------
/**
 * [T1] Blast caller fan-out cap, applied PER CHANGED SYMBOL after grouping the
 * deduped callers by `viaSymbol` (see tryPersistentBlast). NOT a global slice,
 * NOT an "ORDER BY rank DESC LIMIT N" — the cap runs in-memory in the service
 * over the post-dedup `callers[]`, so every changed symbol gets up to N callers.
 */
export const MAX_CALLERS_PER_SYMBOL = 20;

/**
 * [T1] Total prompt-fuel budget for getCallerSignatures — a GLOBAL cap on the
 * number of caller signatures emitted across ALL changed symbols combined
 * (`if (out.length >= limit) break`). Distinct from the per-symbol blast cap;
 * "global" is correct here (it bounds prompt tokens, not per-symbol fan-out).
 */
export const MAX_CALLER_SIGNATURES_TOTAL = 20;

/**
 * [T1] Bumped whenever the AST extractor or symbol schema changes. A mismatch
 * with `repo_index_state.indexer_version` forces a full reindex.
 *
 * v2 (T3): graph + decl_file resolution + file_rank + repo-map landed, so every
 * T2 `partial` index must be rebuilt to gain the rank-driven data.
 */
export const INDEXER_VERSION = 2;

// --- [T2] Full-index limits (documented now, enforced in the pipeline) ------
export const MAX_INDEXED_FILES = 5000;
export const MAX_FILE_SIZE = 400 * 1024; // 400 KB
export const MAX_PARSE_MS_PER_FILE = 2000;
/**
 * Per-kind JobRunner HARD timeout for the index pipeline (INDEX / REFRESH /
 * RESYNC all run runFullIndex / runIncremental, which can rebuild the whole
 * graph). Sized well above observed full-index durations (~165–198s on a
 * ~300-file repo) so a normal run completes and is marked `done`, instead of
 * tripping the default 120s cap → `failed` while the UNCANCELLABLE handler
 * keeps writing as a zombie (the all-NULL decl_file race). Tunable; the
 * per-file watchdog (MAX_PARSE_MS_PER_FILE) + MAX_INDEXED_FILES bound the work.
 */
export const INDEX_JOB_TIMEOUT_MS = 600_000;

/** Soft self-watch budget for the enqueue phase (< INDEX_JOB_TIMEOUT_MS) →
 * bail to `partial` before the hard cap. Only gates the enqueue loop, not the
 * parse-workers + dependency-cruiser graph (see INSIGHTS 2026-07-01). */
export const INDEX_SOFT_BUDGET_MS = 110_000;

// --- [T3] Graph / hotness / repo-map ---------------------------------------
export const BFS_DEPTH = 2;
export const HOTNESS_WINDOW_DAYS = 180;
export const DEFAULT_REPO_MAP_TOKEN_BUDGET = 1500;
/** Signatures are trimmed to this many chars in the parse phase (cache stability). */
export const MAX_SIGNATURE_CHARS = 120;
