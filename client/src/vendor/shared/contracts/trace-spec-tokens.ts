import { z } from 'zod';

/**
 * `spec_tokens` — per-document token attribution for the attached project-context
 * (specs) block, in prompt-injection order. Mirrors `skill_tokens`
 * (`./trace.ts`): the trace shows how many tokens EACH injected document added,
 * counted over the SAME untrusted-wrapped text that is sent to the LLM
 * (`wrapUntrusted('spec-${i}', text)`), so it lines up with `## Project context`.
 *
 * Kept in a NEW file (not by editing the stable trace body) so the shape has a
 * single home; `PromptAssembly` in `./trace.ts` references it as an OPTIONAL
 * (`.nullish()`) field — every existing stored trace that predates it still
 * parses (back-compat).
 */

/** One `{ path, tokens }` entry: a document's repo-relative path + its token count. */
export const SpecTokenEntry = z.object({
  path: z.string(),
  tokens: z.number().int(),
});
export type SpecTokenEntry = z.infer<typeof SpecTokenEntry>;

/** The ordered list of per-document token entries, in prompt-injection order. */
export const SpecTokens = z.array(SpecTokenEntry);
export type SpecTokens = z.infer<typeof SpecTokens>;
