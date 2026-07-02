# TD-004 — `MAX_CALLERS_PER_SYMBOL` is applied GLOBALLY, not per-symbol

| | |
|---|---|
| **Area** | `server/` — repo-intel blast |
| **Severity** | LOW (misnamed cap → silently dropped callers) |
| **Status** | `paid` (2026-07-02) |
| **Surfaced by** | INSIGHTS audit ([server/INSIGHTS.md](../../server/INSIGHTS.md) 2026-06-29) |
| **Detected on** | branch `labs/l04`, recorded 2026-07-02 |
| **Owning skill** | `onion-architecture` (backend) / repo-intel domain |

## Summary

`MAX_CALLERS_PER_SYMBOL` (= 20) is documented as a **per-changed-symbol** fan-out
cap — its own comment says "Caller fan-out cap per changed symbol"
([constants.ts:29-30](../../server/src/modules/repo-intel/constants.ts#L29-L30)).
But `tryPersistentBlast` applies it as `callers.slice(0, MAX_CALLERS_PER_SYMBOL)`
over **ONE flat, rank-sorted array** of all callers across all changed symbols
([service.ts:446](../../server/src/modules/repo-intel/service.ts#L446) sorts,
[service.ts:460](../../server/src/modules/repo-intel/service.ts#L460) slices).

So the returned `callers[]` is the **top-20 across ALL changed symbols combined**,
not 20 each. A consumer that wants per-symbol caller lists (e.g. the L04 blast
panel building `DownstreamImpact[]`) must regroup by `viaSymbol` itself and
**cannot recover callers the facade already dropped**.

## Why it's accepted (for now)

- For most PRs the total caller set is well under 20, so the global cap and a
  per-symbol cap coincide — the divergence only bites on wide changesets.
- The top-20-by-rank set is still a reasonable "most important callers" summary,
  and blast is advisory (see [TD-003](./TD-003-blast-no-pr-vs-index-freshness.md)).

## Risk if left unaddressed

- **Low.** On a wide changeset, callers of a lower-ranked changed symbol can be
  entirely absent while a higher-ranked symbol's callers fill the quota — the panel
  looks complete but silently under-reports for some symbols. The bug is invisible
  (no "truncated" marker).

## Paydown options (when a trigger fires)

- Regroup `callers` by `viaSymbol` and cap **per symbol** (`ORDER BY rank DESC
  LIMIT N` per group) before flattening — matches the constant's documented intent.
- OR rename the constant to reflect the actual global cap (e.g.
  `MAX_CALLERS_TOTAL`) and add a "showing top N callers" marker in the UI so the
  truncation is explicit.

## Paydown (shipped)

Adopted via [docs/specs/blast-per-symbol-caller-cap.md](../specs/blast-per-symbol-caller-cap.md),
shipped in commit `6df3eb3` on `labs/l04`:

- **Option A adopted** — `tryPersistentBlast` now groups the deduped `callers[]`
  by `viaSymbol`, rank-sorts each group with a deterministic tie-break, and slices
  per group before flattening back to the flat `BlastResult.callers` contract
  (spec S2/D1). Every changed symbol gets up to N callers, not top-N across all.
- **Constant SPLIT, not blanket-renamed** — the dual-semantics trap (this same
  constant was also `getCallerSignatures`'s TOTAL prompt-fuel budget) is resolved
  by splitting into two constants (spec S1/D2), not the single rename the
  "paydown options" above proposed:
  `server/src/modules/repo-intel/constants.ts` now exports `MAX_CALLERS_PER_SYMBOL`
  (per-symbol blast cap, now correctly enforced per symbol) and the new
  `MAX_CALLER_SIGNATURES_TOTAL` (total signatures budget, unchanged behavior).
  Both stay at 20.
- **"Showing top N" UI marker DEFERRED** — the second half of Option B (a
  truncation-visibility affordance) is out of scope for this paydown; it needs an
  additive shared-contract field and a `BlastCard` change disproportionate to the
  per-symbol fix (spec D5). Tracked separately as
  [TD-009](./TD-009-blast-truncation-marker.md).
- **Paid (2026-07-02):** shipped via the per-symbol cap — spec
  [blast-per-symbol-caller-cap.md](../specs/blast-per-symbol-caller-cap.md),
  commit `6df3eb3` (INSIGHTS follow-up `ed555a4`); mirrors how
  [TD-003](./TD-003-blast-no-pr-vs-index-freshness.md) was marked paid on the branch.

## Triggers to re-evaluate

- The blast panel is changed to present per-symbol caller lists.
- A user reports missing callers for a symbol on a multi-symbol PR.
- Any edit to `tryPersistentBlast` caller assembly.
