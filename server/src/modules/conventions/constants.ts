/**
 * Conventions Extractor — module constants.
 *
 * The extractor fills the (course-scaffold) `conventions` table: scan a repo's
 * config files (deterministically) + a sample of source files (via a cheap LLM),
 * verify every LLM claim against disk, then persist curated candidates.
 */

/** JobRunner kind for the asynchronous extract/re-scan job. */
export const EXTRACT_CONVENTIONS_JOB_KIND = 'conventions-extract';

/** How many top-ranked source files to feed the LLM (via getConventionSamples).
 * top-12 per spec; lower only after measuring per-scan token cost consciously.
 */
export const SAMPLE_FILE_COUNT = 12;

/** Lower confidence bound communicated to the model. */
export const MIN_CONFIDENCE = 0.6;

/**
 * LLM budget. The JobRunner caps a job at 120s; bound the (retryable) extraction
 * call well under that so a slow model can't fail the whole job — on timeout the
 * service still persists the deterministic config rules.
 */
export const EXTRACTION_TIMEOUT_MS = 55_000;
export const EXTRACTION_MAX_RETRIES = 1;

/**
 * Cheap default for extraction. OpenRouter routes through the OpenAI-compatible
 * API; `deepseek/deepseek-v4-flash` is the repo's seeded low-cost model.
 */
export const DEFAULT_EXTRACTION_PROVIDER = 'openrouter' as const;
export const DEFAULT_EXTRACTION_MODEL = 'deepseek/deepseek-v4-flash';

/** Confidence bump when a rule is corroborated in ≥2 sample files. */
export const CORROBORATION_BOOST = 0.1;
/** Confidence penalty when a rule is seen in a single file only. */
export const SINGLE_OCCURRENCE_PENALTY = 0.8;
/** Min corroborating files to count as "consistently followed". */
export const CORROBORATION_THRESHOLD = 2;

/**
 * F3 — additive bump when a rule is STRUCTURALLY corroborated (AST symbols match
 * the rule's predicate), layered on top of the text-occurrence confidence. Kept
 * small and additive so structural is a second signal, not a replacement.
 */
export const STRUCTURAL_BOOST = 0.1;

/**
 * F4 — cosine threshold above which two rules are treated as semantic duplicates
 * and merged. Conservative start; tunable — calibrate on real extracted rules.
 * (OpenAI text-embedding-3-small, 1536 dims; pairs near-paraphrases ~0.9+.)
 */
export const SEMANTIC_DEDUP_THRESHOLD = 0.92;

/**
 * Config files read deterministically (no LLM). Order matters only for display.
 * JS-only configs (eslint.config.js, prettier.config.js) are intentionally
 * skipped — they can't be parsed safely without executing them.
 */
export const CONFIG_FILES = [
  'tsconfig.json',
  '.prettierrc',
  '.prettierrc.json',
  '.eslintrc.json',
  '.eslintrc',
  '.editorconfig',
  'biome.json',
  'package.json',
] as const;
