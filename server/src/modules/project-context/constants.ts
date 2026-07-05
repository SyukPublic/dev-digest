/**
 * project-context constants — the producer side of the Project Context Folder
 * feature. Discovery/preview half (Phase 1): what markdown to surface from the
 * read-only clone, and the read-time size guard.
 *
 * The two token thresholds are DISTINCT (spec AC-13 vs AC-14):
 *   - a SOFT total-token budget (UI warn-only, never blocks attaching)
 *   - a per-file HARD cap (run-time skip-with-warning, never truncates)
 * Both are configurable via env (see platform/config.ts); the values here are
 * only fallbacks/derived helpers.
 */

/** Roots (top-level folder names) discovery globs under, any depth. Default. */
export const DEFAULT_PROJECT_CONTEXT_ROOTS = ['specs', 'docs', 'insights'] as const;

/** Only markdown is discoverable/attachable (AC-1). */
export const MARKDOWN_EXT = '.md';

/**
 * Default SOFT total-token budget (warn-only). Total attached tokens over this
 * shows a warn indicator in the UI but never blocks attaching or truncates.
 */
export const DEFAULT_TOKEN_BUDGET = 20_000;

/**
 * Default per-file HARD cap in BYTES. A single file larger than this is skipped
 * with a warning at run time and never truncated. Also bounds discovery-time
 * reads so a runaway file can't blow up the preview endpoint.
 */
export const DEFAULT_FILE_HARD_CAP_BYTES = 256 * 1024; // 256 KB

/**
 * Directories the walker never descends into, even under a configured root —
 * keeps discovery cheap and avoids surfacing vendored/build noise.
 */
export const EXCLUDED_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  'out',
  'vendor',
  '.git',
]);
