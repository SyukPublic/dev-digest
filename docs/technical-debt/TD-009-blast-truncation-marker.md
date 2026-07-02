# TD-009 — Blast per-symbol cap trims silently, no "showing top N" marker

| | |
|---|---|
| **Area** | `server/` (repo-intel blast) + `client/` (BlastCard) |
| **Severity** | LOW |
| **Status** | `accepted` (deliberately deferred) |
| **Surfaced by** | TD-004 paydown ([docs/specs/blast-per-symbol-caller-cap.md](../specs/blast-per-symbol-caller-cap.md) D5), recorded 2026-07-02 |
| **Owning skill** | `onion-architecture` (backend) / repo-intel domain |

## Summary

TD-004's fix makes the blast facade cap correctly **per changed symbol**
(`tryPersistentBlast` groups deduped callers by `viaSymbol`, rank-sorts each
group, and slices to `MAX_CALLERS_PER_SYMBOL` before flattening — see
[TD-004](./TD-004-blast-max-callers-global-cap.md) "Paydown in progress"). That
closes the *silent wrong* failure mode (a whole symbol's callers disappearing).
It does **not** add any visibility for the remaining, expected trim: a symbol
with **more than 20 callers still has the 21st+ dropped with no indication** —
no "showing top 20 of N callers" marker anywhere in the facade result or the UI.
The same silent-trim gap exists in the consumer's own defense-in-depth cap
(`blast/service.ts` `reshape`, `callerRows.slice(0, MAX_CALLERS_PER_SYMBOL)`).

## Why it's accepted (for now)

- After the TD-004 fix, this is a **benign, expected summarization**, not an
  under-report: every changed symbol that HAS callers gets its top-20 by rank: no
  symbol is silently emptied anymore.
- Blast is advisory (see [TD-003](./TD-003-blast-no-pr-vs-index-freshness.md)); a
  trimmed-but-present caller list for a very hot symbol is a reasonable summary,
  not a correctness defect.
- Adding a marker touches the shared contract (`DownstreamImpact` in
  `server/src/vendor/shared/contracts/brief.ts:31-37`, which today has no
  `truncated`/`total_callers` field) plus a `BlastCard` UI affordance — a
  cross-package change disproportionate to a benign per-symbol trim, so it was
  explicitly deferred rather than folded into the TD-004 paydown
  (spec D5).

## Risk if left unaddressed

- **Low.** A reviewer working a hot symbol (>20 callers) has no way to tell the
  panel is incomplete for that symbol versus genuinely narrow. No data is wrong,
  only under-displayed without a caveat.

## Paydown options (when a trigger fires)

- Add an **optional, additive** field to the shared `DownstreamImpact` contract
  (`server/src/vendor/shared/contracts/brief.ts`) — e.g. `truncated?: boolean`
  and/or `total_callers?: number` — via a NEW file or additive edit, never editing
  the existing barrel directly with a breaking change.
- Populate it in the consumer `reshape` (`server/src/modules/blast/service.ts`,
  around the per-group cap at `callerRows.slice(0, MAX_CALLERS_PER_SYMBOL)`) when
  a group's caller count exceeds the cap.
- Add a "+N more" affordance in `BlastCard`
  (`client/src/app/repos/[repoId]/pulls/[number]/_components/BlastCard/BlastCard.tsx`)
  so truncation is explicit to the reviewer.

## Triggers to re-evaluate

- A user asks "why only 20 callers?" for a symbol they know has more.
- The truncation marker becomes an explicit product requirement.
- The blast panel is otherwise reworked and the UI affordance can be added cheaply
  alongside.
