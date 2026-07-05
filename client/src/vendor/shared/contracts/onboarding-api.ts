import { z } from 'zod';
import { Onboarding } from './knowledge.js';

/**
 * Onboarding Generator — boundary shapes for the per-repo Onboarding Tour API
 * and the deterministic facts bundle its analyzer assembles.
 *
 * Kept in a NEW file so the stable `Onboarding` contract (`./knowledge.js`) and
 * the `@devdigest/shared` barrel are not edited (the barrel is extended with new
 * files, never edited in place). The narrative document itself (`Onboarding`,
 * `OnboardingSection`, `OnboardingLink`) is REUSED UNCHANGED — these shapes only
 * add the producer-side facts input and the API response envelope around it.
 *
 * House pattern: "code collects the facts, the model writes the narrative." The
 * facts are pulled from the `repoIntel.*` facade at ZERO LLM cost; exactly one
 * structured LLM call turns them into the seven `Onboarding` sections.
 */

/**
 * A ranked file the analyzer feeds the model: the repo-relative `path` (order is
 * facade-authoritative from `getTopFilesByRank`) paired with its PageRank
 * `percentile` (0–100, from `getFileRank`). Display / ordering metadata only —
 * the model does not reorder or invent this list.
 */
export const RankedFile = z.object({
  path: z.string(),
  percentile: z.number(),
});
export type RankedFile = z.infer<typeof RankedFile>;

/**
 * The repo-intel index state carried alongside a facts bundle. `filesIndexed`
 * drives the AC-1 meta line; `updatedAt` is compared against a stored tour's
 * `generatedAt` to compute staleness (AC-10); `degraded` + `degradedReason`
 * express the AC-9 fallback path when the index is partial/absent.
 * `getIndexState()` ALWAYS resolves, so this object is always present even when
 * the rest of the facade degrades to empty.
 */
export const OnboardingIndexState = z.object({
  filesIndexed: z.number().int().min(0),
  updatedAt: z.string().nullable(),
  degraded: z.boolean(),
  degradedReason: z.string().nullable(),
});
export type OnboardingIndexState = z.infer<typeof OnboardingIndexState>;

/**
 * The deterministic facts bundle the analyzer assembles from the `repoIntel.*`
 * facade with ZERO LLM/embedding calls (AC-22), then hands to the single
 * structured LLM call as untrusted data. `repoSkeleton` is the compact repo map;
 * `rankedFiles` fixes the `reading_path` file set; `criticalPaths` are dependency
 * chains that fix its order (AC-3). On a degraded/empty facade the arrays are
 * empty and `indexState.degraded` is set rather than throwing (AC-9).
 */
export const OnboardingFacts = z.object({
  repoSkeleton: z.string(),
  rankedFiles: z.array(RankedFile),
  criticalPaths: z.array(z.array(z.string())),
  indexState: OnboardingIndexState,
});
export type OnboardingFacts = z.infer<typeof OnboardingFacts>;

/**
 * Meta describing a served tour: the index file count + relative last-refreshed
 * line (AC-1), the degraded badge input (AC-9), and staleness — `stale` is true
 * when the stored tour's `generatedAt` predates the latest `indexState.updatedAt`
 * (AC-10). `generatedAt` is null when no tour is stored yet.
 */
export const OnboardingTourMeta = z.object({
  filesIndexed: z.number().int().min(0),
  generatedAt: z.string().nullable(),
  degraded: z.boolean(),
  degradedReason: z.string().nullable(),
  stale: z.boolean(),
});
export type OnboardingTourMeta = z.infer<typeof OnboardingTourMeta>;

/**
 * The GET-tour / POST-generate response envelope. `tour` is the stored
 * `Onboarding` document, or `null` for the empty state (no tour generated yet,
 * AC-6) — the page renders a Generate CTA in that case. `meta` always carries the
 * index-derived fields so the meta line, degraded badge, and staleness indicator
 * render even when `tour` is null (AC-1, AC-9, AC-10). Zero LLM calls on read
 * (AC-22).
 */
export const OnboardingTourResponse = z.object({
  tour: Onboarding.nullable(),
  meta: OnboardingTourMeta,
});
export type OnboardingTourResponse = z.infer<typeof OnboardingTourResponse>;
