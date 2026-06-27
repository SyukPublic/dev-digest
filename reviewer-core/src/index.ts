/**
 * @devdigest/reviewer-core — the review engine.
 *
 * Pure review logic shared by the server (local reviews in the studio) and the
 * agent-runner (CI). NO database, GitHub, or filesystem access; the only side
 * effect is an LLM call through an INJECTED LLMProvider (so it is mock-testable).
 *
 * Consumers wire it via a tsconfig path alias (`@devdigest/reviewer-core` →
 * `../reviewer-core/src`) and consume the TypeScript source directly (tsx in
 * dev, vitest in tests, @vercel/ncc bundle in the runner). The package itself
 * never emits JS — its `build` is a type-check.
 */

// Prompt assembly + prompt-injection hardening.
export {
  assemblePrompt,
  wrapUntrusted,
  type PromptParts,
  type SkillInput,
  type AssembledPrompt,
} from './prompt.js';

// Citation grounding — the mandatory mechanical gate for diff findings.
export { groundFindings, groundingSummary, type GroundingResult } from './grounding.js';

// Structured-output helpers (Zod → JSON Schema + parse-with-repair).
export {
  toJsonSchema,
  extractJson,
  parseWithRepair,
  type JsonSchema,
  type ParseResult,
} from './llm/structured.js';

// Map-reduce helpers (reduce partials, slice a file's diff).
export { reduceReviews, sliceDiff } from './review/reduce.js';

// The engine entry point: given (diff + resolved agent inputs + LLM) → grounded Review.
export {
  reviewPullRequest,
  DEFAULT_MAP_THRESHOLD_LINES,
  DEFAULT_REVIEW_MAX_RETRIES,
  type ReviewInput,
  type ReviewOutcome,
  type ReviewEvent,
  type ReviewStrategy,
  type ReviewMode,
} from './review/run.js';

// Conventions extraction: pure LLM call over repo code samples → candidate rules.
export {
  extractConventions,
  DEFAULT_EXTRACT_MAX_RETRIES,
  DEFAULT_CONVENTIONS_SYSTEM_PROMPT,
  type ConventionSampleInput,
  type ExtractConventionsInput,
  type ExtractConventionsOutcome,
} from './conventions/extract.js';

// Output: grounded Review → GitHubReviewPayload (body + inline comments + event).
export {
  toReviewPayload,
  gateTriggered,
  countBlockers,
  type ToReviewOptions,
} from './output/to-review.js';

// The single OpenAI-compatible structured provider (OpenRouter), shared by the
// CI runner and the server's openrouter path. Owns session grouping + guards.
export { OpenRouterProvider, type OpenRouterProviderOptions } from './llm/openrouter.js';

// Intent: pure classify-prompt builders + INTENT_RULE constant.
// The LLM call itself lives in the server (intent-service.ts) — these are
// the pure helpers that feed it.
export {
  serializeChangedFiles,
  buildIntentMessages,
  INTENT_RULE,
  INTENT_PROMPT_VERSION,
  formatIntentForPrompt,
  type IntentPromptInput,
} from './intent/classify-prompt.js';

// Risks: pure risks-prompt builder (FULL capped patch, not headers-only).
// The LLM call itself lives in the server (risks-service.ts) — this is the
// pure helper that feeds it.
export {
  buildRisksMessages,
  RISKS_PROMPT_VERSION,
  type RisksPromptInput,
} from './risks/risks-prompt.js';
