# TD-005 — `INDEX_SOFT_BUDGET_MS` gates only the enqueue loop, not parse+graph

| | |
|---|---|
| **Area** | `server/` — repo-intel index pipeline |
| **Severity** | LOW–MEDIUM (a heavy repo can still overrun toward the hard cap) |
| **Status** | `watch` |
| **Surfaced by** | INSIGHTS ([server/INSIGHTS.md](../../server/INSIGHTS.md) 2026-07-01, blast unresolved-index root cause) |
| **Detected on** | branch `labs/l04`, recorded 2026-07-02 |
| **Owning skill** | `onion-architecture` (backend) / repo-intel domain |

## Summary

The index pipeline has a **soft self-watch budget** (`INDEX_SOFT_BUDGET_MS` =
110s) meant to bail to `partial` *before* the hard JobRunner cap
(`INDEX_JOB_TIMEOUT_MS` = 600s). But it only gates the **fast enqueue loop**: the
check runs before enqueuing each file
([full.ts:134](../../server/src/modules/repo-intel/pipeline/full.ts#L134)), while
the **EXPENSIVE phase** runs *after* it — `await parseQ.onIdle()`
([full.ts:202](../../server/src/modules/repo-intel/pipeline/full.ts#L202)) and the
dependency-cruiser graph build
([full.ts:217](../../server/src/modules/repo-intel/pipeline/full.ts#L217), guarded
by `if (!softBudgetReached)`). The constant's own comment already flags this:
"Only gates the enqueue loop, not the parse-workers + dependency-cruiser graph"
([constants.ts:56-59](../../server/src/modules/repo-intel/constants.ts#L56-L59)).

Because the parse-workers + graph run outside the budget window,
`softBudgetReached` stays false through the slow part, so the soft budget does NOT
prevent a heavy repo from running long toward the hard cap. This was part of the
"index zombie / all-NULL `decl_file`" root cause (INSIGHTS 2026-07-01).

**Explicitly do NOT just raise the soft budget** to track the longer hard cap:
raising it lets the enqueue phase eat the budget and starves the graph, re-creating
the hard-cap kill/zombie (INSIGHTS 2026-07-01, fix (a) note). The fix is to
**re-scope** it, not re-size it.

## Why it's accepted (for now)

- The acute failure (zombie runs racing `deleteAllForRepo`→insert→resolve) was
  mitigated separately: the per-kind hard timeout was raised to 600s, a per-repo
  index concurrency guard was added, and `resolveReferences` was made
  transactional (see recent `labs/l04` commits + INSIGHTS 2026-07-01). So the soft
  budget is no longer the last line of defense.
- Re-scoping it correctly is non-trivial (must gate `parseQ.onIdle` + graph without
  leaving a half-built index), so it is deferred rather than rushed.

## Risk if left unaddressed

- **Low–medium.** With the hard cap at 600s and the concurrency guard in place, an
  overrun no longer corrupts the index — but the soft budget gives a **false sense
  of graceful degradation** that it does not actually deliver for the slow phase.

## Paydown options (when a trigger fires)

- Re-scope the soft budget to also gate the parse-workers and the graph build
  (e.g. check the elapsed budget inside/around `parseQ.onIdle` and before the
  dependency-cruiser call), degrading cleanly to `partial` with a consistent
  persisted state.

## Triggers to re-evaluate

- A repo large enough to overrun the parse/graph phase within the 600s hard cap.
- Any change to `runFullIndex` timing/ordering, or a lowering of
  `INDEX_JOB_TIMEOUT_MS`.
