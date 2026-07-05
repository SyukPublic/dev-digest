/**
 * onboarding-generator constants — the fixed shape of the seven-section
 * Onboarding Tour and the analyzer's facts budget.
 *
 * House pattern: "code collects the facts, the model writes the narrative." The
 * `SECTION_KINDS` order is the AUTHORITY — the prompt frames it, the service
 * asserts/normalizes the model's output against it, and the persisted document
 * always carries exactly these seven kinds in this order (AC-5). `diagram` is
 * allowed only for `architecture`; every other section's diagram is dropped to
 * null on the way in.
 */

/**
 * The seven Onboarding sections, in fixed order. This is the single source of
 * the ordering + membership invariant enforced service-side after the LLM call.
 */
export const SECTION_KINDS = [
  'overview',
  'architecture',
  'key_modules',
  'reading_path',
  'getting_started',
  'conventions_gotchas',
  'first_tasks',
] as const;

export type SectionKind = (typeof SECTION_KINDS)[number];

/** The ONLY kind allowed to carry a non-null mermaid `diagram` (AC-5). */
export const DIAGRAM_KIND: SectionKind = 'architecture';

/**
 * How many top-ranked files the analyzer feeds the model as the reading-path
 * reference set. Matches the prompt's `reading_path` links cap (~6-8) so every
 * provided reference file is retained in the narrative (AC-3).
 */
export const READING_PATH_FILE_COUNT = 8;

/**
 * The content language for generated titles/body (AC-18). Single-locale runtime
 * today (`en`); a Settings-driven override is a forward-looking follow-up.
 */
export const DEFAULT_CONTENT_LANGUAGE = 'English';

/**
 * A human-readable spec of the seven kinds, interpolated into the prompt's
 * `{{sections}}` slot (Phase 2 owns the template text; this is the data it
 * expects). Kept deterministic so the same generation is reproducible.
 */
export const SECTION_SPEC = SECTION_KINDS.map(
  (kind, i) => `${i + 1}. ${kind}`,
).join('\n');
