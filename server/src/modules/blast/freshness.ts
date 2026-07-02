/**
 * freshness.ts — the pure PR-vs-index freshness/divergence helper for the Blast
 * Radius panel (TD-003).
 *
 * The Blast map is built ONLY against the repo's default branch, but it is served
 * for a specific PR whose head has diverged. A naive `indexedSha !== prHeadSha`
 * (or `prBranch !== indexedBranch`) comparison is MEANINGLESS and permanently
 * true by design — a PR head is ALWAYS a different commit / branch — so it would
 * fire on every PR forever (noise → users ignore it → the confident-wrong "0
 * downstream" case stays invisible). Staleness is therefore built from a NARROW,
 * meaningful set of conditions, NOT from SHA/branch inequality:
 *
 *   1. `empty_map` (the TD-003 "Minimum" — the dangerous confident-wrong case):
 *      the index WAS readable but the map has zero downstream callers. A bare
 *      "0 downstream" must never render without a caveat.
 *   2. `base_diverged`: the recorded indexed branch is known AND the PR does NOT
 *      target it (`prBase !== indexedBranch`) — the index doesn't even reflect
 *      the PR's base (stacked / release-branch PRs). This is the one genuinely
 *      divergence-driven flag and it is NOT permanently true.
 *
 * Precedence: rule 1 is checked FIRST and wins — an empty map on a non-default
 * base reports `empty_map`, not `base_diverged`.
 *
 * Layering (Onion): this is a read-path application concern, so it lives in the
 * SERVER layer (reviewer-core stays pure). It takes only already-resolved
 * primitives — no container, DB, GitHub, git, or fs — so it unit-tests trivially;
 * the SERVICE gathers the inputs and calls it. It never throws on any input
 * (best-effort discipline — the blast read path never fails past the facade).
 */

export interface BlastFreshnessParts {
  /** `IndexState.indexedBranch` — may be undefined on legacy rows (no stamp). */
  indexedBranch?: string;
  /** `IndexState.lastIndexedSha` — '' when there is no index. */
  indexedSha: string;
  /** OPTIONAL — not on the facade; unused by the D2 logic (kept per S5). */
  repoDefaultBranch?: string;
  /** `pull.base` — the branch the PR targets. */
  prBase: string;
  /** `pull.branch` — the PR's own head branch. */
  prBranch: string;
  /** `pull.headSha` — the PR head commit. */
  prHeadSha: string;
  /** `radius.downstream.length` — 0 is the dangerous empty case. */
  downstreamCount: number;
  /**
   * Whether the index state was readable. `getIndexState` never throws, so the
   * service sets this true after the state read; kept so the helper is
   * self-contained (unreadable ⇒ never stale — no false alarm).
   */
  indexReadable: boolean;
}

export interface BlastFreshness {
  is_stale: boolean;
  stale_reason?: string;
}

/**
 * Derive the PR-vs-index freshness hint from primitives. Deterministic and pure.
 * See the module doc-comment for the D2 rules and precedence.
 */
export function deriveBlastFreshness(p: BlastFreshnessParts): BlastFreshness {
  // Rule 1 — empty_map (first match wins). Only meaningful when the index was
  // actually readable; an unreadable index is "unknown", never stale.
  if (p.indexReadable && p.downstreamCount === 0) {
    return { is_stale: true, stale_reason: 'empty_map' };
  }

  // Rule 2 — base_diverged. Skipped when the indexed branch is unknown (legacy
  // rows) — no false alarm. Never keyed on SHA or head-branch inequality.
  if (p.indexedBranch != null && p.prBase !== p.indexedBranch) {
    return { is_stale: true, stale_reason: 'base_diverged' };
  }

  return { is_stale: false };
}
