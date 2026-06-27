import { createHash } from 'node:crypto';

/**
 * freshness.ts — pure freshness-key helpers for the derived PR artifacts
 * (intent, risks).
 *
 * A freshness key is a stable hash of EVERY input that determines the LLM
 * output for an artifact: the PR head SHA, base branch, title, body, the
 * resolved provider + model, and the prompt version. Risks additionally fold in
 * the intent's freshness key, because risks anchor on the intent (it goes into
 * the prompt) and therefore go stale when the intent is recomputed.
 *
 * How it is used: the write-path stores the key alongside the artifact; the
 * read-path recomputes the CURRENT key (no network — every input is on the
 * `pull` row, a cheap settings read, or the stored intent's key) and compares it
 * against the stored one. `is_stale := storedKey != null && storedKey !==
 * currentKey`. A NULL stored key (legacy/pre-migration rows) is treated as NOT
 * stale.
 *
 * Deliberate exclusion: the linked GitHub issue is NOT in the key. Including it
 * would force a GitHub call on every read to recompute the current key, and the
 * write/read keys must hash the SAME inputs or they would never match (permanent
 * false-stale). `classifyIntent` still uses the issue for classification — it
 * just does not feed into the key.
 *
 * Layering (Onion): this is an application/caching concern, not review domain
 * logic, so the hash lives in the SERVER layer — `reviewer-core` stays pure
 * (only the prompt-version CONSTANTS live there). These helpers take
 * already-resolved primitives (no container, DB, GitHub, or fs) so they
 * unit-test trivially; the SERVICE gathers the inputs and calls them.
 */

/**
 * The array ORDER is load-bearing: the write-side and read-side must hash the
 * SAME ordered inputs, or the keys never match. Do not reorder the `parts`
 * arrays passed by the callers below.
 */
function sha256(parts: (string | number)[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

export function intentFreshnessKey(p: {
  headSha: string;
  base: string;
  title: string;
  body: string;
  provider: string;
  model: string;
  promptVersion: number;
}): string {
  return sha256([p.headSha, p.base, p.title, p.body, p.provider, p.model, p.promptVersion]);
}

export function risksFreshnessKey(p: {
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
