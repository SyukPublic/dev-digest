import { createHash } from 'node:crypto';

/**
 * freshness.ts — the PURE Why+Risk Brief freshness key (CP-6, AC-14).
 *
 * A freshness key is a stable hash of EVERY input that determines the brief's
 * LLM output: the PR head SHA, base branch, title, body, the resolved provider +
 * model, the brief prompt version, and the anchored intent's freshness key. The
 * brief FUSES the derived intent (its rendering rides into the prompt), so the
 * brief goes stale when the intent is recomputed — mirroring `risksFreshnessKey`.
 *
 * How it is used (parity with `reviews/freshness.ts`):
 *  - WRITE stamps the key alongside the stored brief.
 *  - READ recomputes the CURRENT key with NO network — every input is on the
 *    `pull` row, a cheap settings read, the `BRIEF_PROMPT_VERSION` constant, or
 *    the stored intent's key — and compares it against the stored one.
 *  - `is_stale := storedKey != null && storedKey !== currentKey`. A NULL stored
 *    key (legacy / pre-migration rows) is treated as NOT stale (no false alarm).
 *
 * Deliberate exclusion (spec Non-goal): the linked GitHub issue AND the attached
 * project specs are NOT in the key. Folding the issue in would force a GitHub
 * call on every read to recompute the current key; folding specs in would force
 * a clone read. The write/read keys must hash the SAME inputs or they would
 * never match (permanent false-stale). The UI surfaces this caveat in a tooltip.
 *
 * Layering (Onion): this is an application/caching concern, not review domain
 * logic, so the hash lives in the SERVER layer. It takes already-resolved
 * primitives (no container, DB, GitHub, or fs) so it unit-tests trivially; the
 * SERVICE gathers the inputs and calls it.
 */

/**
 * The array ORDER is load-bearing: the write-side and read-side must hash the
 * SAME ordered inputs, or the keys never match. Do not reorder these parts.
 */
function sha256(parts: (string | number)[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

export function briefFreshnessKey(p: {
  headSha: string;
  base: string;
  title: string;
  body: string;
  provider: string;
  model: string;
  promptVersion: number;
  intentKey: string; // = storedIntent?.freshnessKey ?? ''
}): string {
  return sha256([
    p.headSha,
    p.base,
    p.title,
    p.body,
    p.provider,
    p.model,
    p.promptVersion,
    p.intentKey,
  ]);
}
