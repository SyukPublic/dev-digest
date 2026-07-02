# TD-003 — Blast Radius has no PR-vs-index freshness signal (confident-wrong "0 downstream")

| | |
|---|---|
| **Area** | `server/` — repo-intel + blast modules |
| **Severity** | MEDIUM (correctness: can assert a *confident, wrong* "no impact") |
| **Status** | `paid` (2026-07-02) |
| **Surfaced by** | INSIGHTS audit ([server/INSIGHTS.md](../../server/INSIGHTS.md) 2026-06-30) |
| **Detected on** | branch `labs/l04`, recorded 2026-07-02 |
| **Paid on** | 2026-07-02 — Option A + the "Minimum" (freshness/provenance signal); commit `62269f6`, spec [docs/specs/blast-index-freshness.md](../specs/blast-index-freshness.md). Option B (index the PR ref on demand) remains out of scope. |
| **Owning skill** | `onion-architecture` (backend) / repo-intel domain |

## Summary

The blast map is built from an index of the repo's **default branch**, captured at
clone/refresh time — the clone is advanced to `origin/<defaultBranch>`
([repo-intel/service.ts:196](../../server/src/modules/repo-intel/service.ts#L196))
— but it is served for a **specific PR** whose head may have diverged. There is
**no signal that the index is stale relative to the PR under review**.

Critically, the `status` the UI shows (`full` / `partial` / `degraded` / `failed`)
reflects index **BUILD quality**, NOT index-ref-vs-PR drift: `getBlast` copies it
straight from the index state and returns it verbatim
([blast/service.ts:74-76,93](../../server/src/modules/blast/service.ts#L74-L93)).
So a `full` (no-badge) panel can render a **confident, WRONG** "0 downstream / no
impact": when the changed files declare symbols with no *resolved* callers,
`tryPersistentBlast` returns `degraded: false` + empty
([service.ts:398-399](../../server/src/modules/repo-intel/service.ts#L398-L399),
[service.ts:458-464](../../server/src/modules/repo-intel/service.ts#L458-L464)).

Three by-design divergences make this concrete (see INSIGHTS 2026-06-30):
1. `changed_symbols` is the index's **file-level** symbol set for the changed
   files (every symbol declared in a touched file), not the lines the diff changed.
2. Symbols the PR **introduces** are invisible until their ref is indexed — a
   feature's own PR shows neither the new symbol nor its new callers.
3. Endpoints/crons are precomputed **1-hop** per-caller-FILE facts, so a UI-only
   changeset trends to 0.

Nothing re-indexes on a PR/branch change — only repo add / refresh / `resync` /
indexer-version bump, all against the default branch.

## Why it's accepted (for now)

- Blast is an **advisory** enrichment: server AGENTS.md mandates best-effort
  context (drop the section on failure, never throw). It informs the reviewer; it
  is not a gate.
- Per-PR indexing (index the PR head/merge ref) is a real cost (clone advance +
  full graph rebuild, ~165–198s per run) and out of scope for the current lessons.

## Risk if left unaddressed

- **Medium.** A `full` panel that says "no downstream impact" reads as authoritative
  but can be wrong for exactly the case that matters (a change whose callers/new
  symbols live on a ref the index never saw). The absence of a badge makes the
  wrongness invisible — worse than a `degraded` panel, which at least warns.

## Paydown options (when a trigger fires)

- Add a **PR-vs-index freshness signal** distinct from build `status`: compare the
  index's `lastIndexedSha` / indexed ref against the PR's `head_sha` / `base` and
  surface a "stale index — built on `<defaultBranch>`" badge (mirrors the
  review-freshness `is_stale` pattern, [docs/specs/review-freshness.md](../specs/review-freshness.md)).
- OR index the PR ref on demand (index the PR head / merge commit) so the map
  matches the diff under review.
- Minimum: never render a bare confident "0 downstream" without a freshness caveat.

## Triggers to re-evaluate

- A user reports a wrong "no impact" on a PR that clearly has downstream callers.
- Blast is promoted from advisory to a **gating** signal (e.g. auto-severity).
- Per-PR / per-ref indexing is added to repo-intel.
