import { z } from 'zod';

/**
 * Conventions Extractor — the LLM response contract.
 *
 * Shared by `@devdigest/reviewer-core` (which forces the model to return this
 * exact shape via `completeStructured`) and the server (which verifies + persists
 * the candidates). Kept in its own file so the stable contracts barrel is only
 * EXTENDED, never edited.
 *
 * All fields are REQUIRED on purpose: structured output runs in OpenAI strict
 * json-schema mode, where every property must be present (optionals would have to
 * be nullable). Server-side verification then drops anything unsupported.
 */

export const ExtractedConvention = z.object({
  /** Imperative rule, e.g. "Always use async/await instead of .then() chains". */
  rule: z.string().min(1),
  /** Grouping bucket the model assigns (naming / async / errors / imports / …). */
  category: z.string().min(1),
  /** Repo-relative path the rule was observed in. */
  evidence_path: z.string().min(1),
  /** 2–5 lines of EXACT code from `evidence_path` backing the rule. */
  evidence_snippet: z.string().min(1),
  /** Model's self-reported confidence; re-weighted server-side by corroboration. */
  confidence: z.number().min(0).max(1),
});
export type ExtractedConvention = z.infer<typeof ExtractedConvention>;

export const ExtractedConventions = z.object({
  candidates: z.array(ExtractedConvention),
});
export type ExtractedConventions = z.infer<typeof ExtractedConventions>;
