# Development Plan: Blast per-symbol caller cap (TD-004)

## Context

`MAX_CALLERS_PER_SYMBOL` (= 20) is documented as a **per-changed-symbol** caller
fan-out cap — its own comment reads "Caller fan-out cap **per changed symbol**
(ORDER BY rank DESC LIMIT N)"
([constants.ts:29-30](../../server/src/modules/repo-intel/constants.ts#L29-L30)).
But the repo-intel facade applies it as a **single global slice** across ONE flat,
rank-sorted array of all callers across all changed symbols:
`tryPersistentBlast` fetches ALL callers with no per-symbol limit
([service.ts:403](../../server/src/modules/repo-intel/service.ts#L403)), dedups
them into a flat `callers[]` (dedup key `fromPath|enclosing|toSymbol`,
[service.ts:428-445](../../server/src/modules/repo-intel/service.ts#L428)),
sorts that array globally by rank
([service.ts:446](../../server/src/modules/repo-intel/service.ts#L446)), and then
`callers.slice(0, MAX_CALLERS_PER_SYMBOL)` — the **global** slice, the bug
([service.ts:460](../../server/src/modules/repo-intel/service.ts#L460)).

On a wide changeset the callers of lower-ranked changed symbols can be **silently
dropped entirely** while a higher-ranked symbol fills the quota. The panel looks
complete but under-reports for some symbols, with **no "truncated" marker**. Full
problem statement:
[docs/technical-debt/TD-004-blast-max-callers-global-cap.md](../technical-debt/TD-004-blast-max-callers-global-cap.md).

The consumer already does the right shape but cannot recover facade-dropped
callers: `blast/service.ts` `reshape()` groups the flat `callers[]` by `viaSymbol`
into `DownstreamImpact[]` and applies its OWN per-symbol cap
([blast/service.ts:186-229](../../server/src/modules/blast/service.ts#L186)), with
a local `MAX_CALLERS_PER_SYMBOL = 20`
([blast/service.ts:39-45](../../server/src/modules/blast/service.ts#L39)) whose
comment explicitly notes the facade cap is global. It operates on already-truncated
input, so a symbol the facade dropped to zero stays zero.

**Dual-semantics trap (must be resolved cleanly, not papered over):** the SAME
`MAX_CALLERS_PER_SYMBOL` constant is also the default `limit` of
`getCallerSignatures`
([service.ts:527-531](../../server/src/modules/repo-intel/service.ts#L527)), where
it is a **total** prompt-fuel budget across all changed symbols
(`if (out.length >= limit) break` at
[service.ts:570](../../server/src/modules/repo-intel/service.ts#L570) and
[service.ts:578](../../server/src/modules/repo-intel/service.ts#L578)) — there the
"global" behavior is CORRECT. So the TD's paydown option B ("rename to
`MAX_CALLERS_TOTAL`") is right for signatures but WRONG for blast. This plan splits
the constant into two with distinct, correctly-documented semantics.

Intended outcome: `tryPersistentBlast` returns up to N callers **per changed
symbol** (matching the documented intent), the signatures total-budget path keeps
its correct global semantics under a clearly-named constant, and a regression test
proves the exact wide-changeset failure mode that is currently invisible. The
existing consumer per-symbol cap is retained as documented defense-in-depth.

### Scope & non-goals

- **In scope:** (1) fix `tryPersistentBlast` to cap per-`viaSymbol` (in-memory,
  after dedup — see D1); (2) split `MAX_CALLERS_PER_SYMBOL` into a per-symbol blast
  cap vs a total signatures budget, fixing the misleading comment (D2); (3) keep
  the consumer's local per-symbol cap as documented defense-in-depth (D3); (4) a
  facade-level regression test on a wide (>20 total, multi-symbol) changeset (the
  invisible failure); (5) flip TD-004 Status in the register (D4/Phase 4).
- **NOT in scope — a "truncated" contract/UI marker (deferred, D5).** The TD's
  option B truncation marker is a follow-up: it needs new fields on `BlastResult` /
  `BlastCallerRow` and `DownstreamImpact` plus a UI affordance. This plan makes the
  cap correct-by-symbol first; the visibility marker is noted as a follow-up TD/spec
  and NOT implemented here (see D5 for why, and what the contract change would be).
- **NO schema / migration / index change.** The fix stays in the service layer
  over the EXISTING `getResolvedCallers` SQL; no window function, no new index, no
  `pnpm db:generate` / `db:migrate` (D1 explains why SQL is the wrong layer).
- **Advisory-only invariant preserved.** Blast stays advisory (TD-003 / TD-004
  "why accepted"); this changes WHICH callers are returned, never adds a gate.

## Affected packages & files

**server/** (repo-intel facade — the fix):
- `server/src/modules/repo-intel/constants.ts` — EDIT. Split
  `MAX_CALLERS_PER_SYMBOL` into two constants with fixed comments (S1). Keep the
  numeric value 20 for both (behavior-preserving on the signatures side).
- `server/src/modules/repo-intel/service.ts` — EDIT. `tryPersistentBlast`
  ([service.ts:428-464](../../server/src/modules/repo-intel/service.ts#L428)):
  replace the global sort+slice with a **group-by-`viaSymbol` + per-group
  rank-sort + per-group slice** (S2). `getCallerSignatures`
  ([service.ts:527-531](../../server/src/modules/repo-intel/service.ts#L527)):
  point its default `limit` at the new total-budget constant (S3). No other
  behavior change.

**server/ tests** (prove per-symbol behavior; the currently-invisible failure):
- `server/test/blast-unresolved-index.test.ts` — EXTEND (or a sibling
  `blast-per-symbol-cap.test.ts` — see Phase 3). This is the ideal precedent: a
  PURE-mock test that drives `RepoIntelService.getBlastRadius` → `tryPersistentBlast`
  with a stubbed `repo` object, NO Postgres, NO clone
  ([blast-unresolved-index.test.ts:37-84](../../server/test/blast-unresolved-index.test.ts#L37)).
  Add the wide-changeset per-symbol regression here or in a sibling with the same
  harness.
- `server/test/blast-service.test.ts` — no code change required (the consumer's
  own per-symbol cap regression at
  [blast-service.test.ts:197-224](../../server/test/blast-service.test.ts#L197)
  stays green — it tests the consumer, not the facade). Optionally add a comment
  cross-referencing the new facade-level test so the two layers' caps are
  documented as intentional defense-in-depth.

**Reuse (do NOT re-implement):**
- The exact group-by-`viaSymbol` idiom already exists in the CONSUMER's `reshape`
  ([blast/service.ts:193-204](../../server/src/modules/blast/service.ts#L193)):
  `const groups = new Map<string, ...>(); for (const c of callers) { ... }` then
  `.slice(0, cap)` per group. Mirror that idiom in the facade (S2) so both layers
  read identically.
- The pure-mock facade test harness in
  [blast-unresolved-index.test.ts](../../server/test/blast-unresolved-index.test.ts)
  (`buildService` stubbing `svc.repo` with `getSymbolRows` / `getResolvedCallers` /
  `getReferenceResolution` / `getFileFacts`) — copy it for the per-symbol test.
- `enclosingFromRows` + the dedup `seenCaller` set already in `tryPersistentBlast`
  ([service.ts:428-445](../../server/src/modules/repo-intel/service.ts#L428)) — the
  fix reuses the SAME deduped `callers[]`; it changes only the sort/slice AFTER it.

## Shared scaffold (context pack)

> Verbatim excerpts + `file:line` citations so parallel implementers do not each
> re-open the sources. Phases reference these fragments by tag.

### S1 — `constants.ts:28-30` today (the mislabeled single constant) → split into two

Today ([constants.ts:28-30](../../server/src/modules/repo-intel/constants.ts#L28)):
```ts
// --- Read-time limits -------------------------------------------------------
/** [T1] Caller fan-out cap per changed symbol (ORDER BY rank DESC LIMIT N). */
export const MAX_CALLERS_PER_SYMBOL = 20;
```
The comment claims "per changed symbol" but blast applies it globally, while
`getCallerSignatures` uses it as a TOTAL budget — two different meanings on one
name. Split into two named constants (both value 20 → signatures behavior
unchanged; blast semantics fixed by S2):
```ts
// --- Read-time limits -------------------------------------------------------
/**
 * [T1] Blast caller fan-out cap, applied PER CHANGED SYMBOL after grouping the
 * deduped callers by `viaSymbol` (see tryPersistentBlast). NOT a global slice.
 */
export const MAX_CALLERS_PER_SYMBOL = 20;

/**
 * [T1] Total prompt-fuel budget for getCallerSignatures — a GLOBAL cap on the
 * number of caller signatures emitted across ALL changed symbols combined
 * (`if (out.length >= limit) break`). Distinct from the per-symbol blast cap;
 * "global" is correct here (it bounds prompt tokens, not per-symbol fan-out).
 */
export const MAX_CALLER_SIGNATURES_TOTAL = 20;
```
Naming note (typescript-expert / naming): keep the per-symbol constant NAME
(`MAX_CALLERS_PER_SYMBOL`) — its documented intent is now actually implemented, so
renaming it would only churn call sites. Introduce the NEW name only for the
total-budget meaning. Implementer must update the `getCallerSignatures` default
(S3) and any import.

### S2 — `tryPersistentBlast` sort+slice today (service.ts:446-464) → per-symbol grouping

Today ([service.ts:446-464](../../server/src/modules/repo-intel/service.ts#L446)),
`callers` is the deduped flat array built at
[service.ts:428-445](../../server/src/modules/repo-intel/service.ts#L428):
```ts
    callers.sort((a, b) => b.rank - a.rank);              // GLOBAL rank sort

    // ...getFileFacts / endpoints / factsByFile build (unchanged)...

    return {
      changedSymbols,
      callers: callers.slice(0, MAX_CALLERS_PER_SYMBOL),   // GLOBAL slice = the BUG
      impactedEndpoints: [...endpoints],
      factsByFile,
      degraded: false,
    };
```
Replace the global sort + global slice with a **per-`viaSymbol` grouping**, mirror
of the consumer's `reshape` idiom
([blast/service.ts:193-204](../../server/src/modules/blast/service.ts#L193)).
Grouping preserves first-seen `viaSymbol` order; within each group sort by rank
DESC, then take the top N. Then FLATTEN back to a single `callers[]` (the facade
contract `BlastResult.callers` is a flat array — types.ts:82-95 — so the shape is
unchanged; only WHICH rows survive changes):
```ts
    // Cap PER changed symbol (not globally): group the deduped callers by the
    // symbol they reach, rank-sort within each group, take the top N per group,
    // then flatten back to the flat BlastResult.callers contract. Mirrors the
    // consumer reshape's group-by-viaSymbol (blast/service.ts) — the facade now
    // returns up to N callers for EVERY changed symbol, not top-N across all.
    const byViaSymbol = new Map<string, BlastCallerRow[]>();
    for (const c of callers) {
      const list = byViaSymbol.get(c.viaSymbol) ?? [];
      list.push(c);
      byViaSymbol.set(c.viaSymbol, list);
    }
    const cappedCallers: BlastCallerRow[] = [];
    for (const group of byViaSymbol.values()) {
      group.sort((a, b) => b.rank - a.rank || tieBreak(a, b)); // rank DESC, deterministic tie-break
      for (const c of group.slice(0, MAX_CALLERS_PER_SYMBOL)) cappedCallers.push(c);
    }
    // ...getFileFacts / endpoints / factsByFile build stays as-is BUT see NOTE-A...
    return {
      changedSymbols,
      callers: cappedCallers,
      impactedEndpoints: [...endpoints],
      factsByFile,
      degraded: false,
    };
```
- **`tieBreak` (rank-tie determinism, D1):** `callers.sort((a,b)=>b.rank-a.rank)`
  today is NOT stable across equal ranks — with many rank-0 rows (the degraded /
  no-`file_rank` path returns `rank: 0`), which 20 survive is arbitrary. Add a
  deterministic secondary key so the slice is reproducible: e.g.
  `(a,b) => b.rank - a.rank || a.file.localeCompare(b.file) || a.symbol.localeCompare(b.symbol) || a.line - b.line`.
  Define it inline or as a tiny local `tieBreak`.
- **NOTE-A (endpoints/factsByFile must be computed from the CAPPED callers, D1).**
  Today `getFileFacts` runs over `callerFiles` = the files of ALL callers
  ([service.ts:417,450](../../server/src/modules/repo-intel/service.ts#L417)),
  BEFORE the slice — so `impactedEndpoints` can currently include endpoints from
  callers that the global slice then dropped. After the fix, verify the endpoints
  union is derived from the callers that SURVIVE the per-symbol cap (the consumer's
  `reshape` already unions facts over its own capped set —
  [blast/service.ts:211-218](../../server/src/modules/blast/service.ts#L211)). The
  cleanest fix: compute `callerFiles` for `getFileFacts` from `cappedCallers` (not
  the pre-cap `callers`). **REQUIRED — not optional (plan-verifier tightened this):**
  derive `impactedEndpoints`/`factsByFile` from `cappedCallers` so the facade's
  endpoints match the callers it actually returns; do NOT leave a pre-cap superset.
  Order the facts fetch AFTER the cap (both are pure in-memory + one repo read, no
  perf concern). Call this out in the phase.

### S3 — `getCallerSignatures` default limit (service.ts:527-531) → total-budget constant

Today ([service.ts:527-531](../../server/src/modules/repo-intel/service.ts#L527)):
```ts
  async getCallerSignatures(
    repoId: string,
    changedFiles: string[],
    limit: number = MAX_CALLERS_PER_SYMBOL,   // ← mislabeled: this is a TOTAL budget
  ): Promise<SignatureRow[]> {
```
Change the default ONLY (value stays 20 → behavior identical):
```ts
    limit: number = MAX_CALLER_SIGNATURES_TOTAL,
```
The break-on-`out.length >= limit` logic ([service.ts:570,578](../../server/src/modules/repo-intel/service.ts#L570))
is the TOTAL-budget semantics and stays exactly as-is. This is the disjoint,
correct half of the dual-semantics split.

### S4 — the facade `BlastResult.callers` contract (types.ts:71-95) — SHAPE UNCHANGED

```ts
export interface BlastCallerRow {
  file: string;
  symbol: string;
  viaSymbol: string;   // which changed symbol this caller reaches — the group key
  line: number;
  rank: number;        // file_rank.rank (0 in the degraded/ripgrep path)
}
export interface BlastResult {
  changedSymbols: BlastChangedSymbol[];
  callers: BlastCallerRow[];              // still a FLAT array — S2 only changes WHICH rows
  impactedEndpoints: string[];
  factsByFile?: Record<string, { endpoints: string[]; crons: string[] }>;
  degraded?: boolean;
  reason?: DegradedReason;
}
```
The fix is contract-transparent: `callers` stays a flat array; the consumer's
`reshape` re-groups it exactly as before. No `@devdigest/shared` change, no
`scripts/sync-shared.mjs`, no client change in this plan. (The DEFERRED truncation
marker in D5 is what WOULD touch the shared contract — not in scope.)

### S5 — pure-mock facade test harness to copy (blast-unresolved-index.test.ts:37-84)

The precedent harness (no Postgres, no clone) that drives the real
`tryPersistentBlast` via `getBlastRadius`:
```ts
const svc = new RepoIntelService(container /* {config:{repoIntelEnabled:true}, db:{}, codeIndex:{...}} */);
(svc as unknown as { repo: Record<string, unknown> }).repo = {
  tryGetIndexState: async () => FULL_STATE,           // status 'full'
  getRepoBasics:    async () => ({ id, owner, name, defaultBranch:'main', clonePath:null }),
  getSymbolRows:    async (_r, paths) => /* decl rows for changed files; caller-file enclosing rows */,
  getResolvedCallers: async () => /* the WIDE, multi-viaSymbol caller set */,
  getReferenceResolution: async () => ({ total: N, resolved: N }),  // healthy → persistent path
  getFileFacts:     async () => [],
};
const blast = await svc.getBlastRadius('r1', [CHANGED_FILES]);
```
KEY for the per-symbol test: `getResolvedCallers` returns `ResolvedCallerRow[]`
(`{ fromPath, toSymbol, line, rank }`), and `tryPersistentBlast` derives
`viaSymbol = c.toSymbol` ([service.ts:441](../../server/src/modules/repo-intel/service.ts#L441)).
So to exercise the wide-changeset multi-symbol case, return e.g. 30 rows with
`toSymbol:'alpha'` + 30 with `toSymbol:'beta'` (distinct `fromPath` so dedup keeps
them). `getSymbolRows` must also return declared rows for both `alpha` and `beta`
in the changed files (so `nameSet` includes both) AND enclosing symbol rows for the
caller files (so `enclosingFromRows` resolves — or falls back to the filename,
which is fine for the assertion). Assert: `blast.callers.filter(c=>c.viaSymbol==='alpha').length === 20`
AND `...'beta'...length === 20` (today's bug → beta would be 0 or < 20).

## Confirmed decisions

### D1 — Cap in-memory in the service (group-by-`viaSymbol`), NOT in SQL (RESOLVED)

Two candidate layers for the per-symbol cap:

- **(a) In-memory in `tryPersistentBlast` after grouping by `viaSymbol`** —
  **RECOMMENDED.**
- **(b) In SQL via `ROW_NUMBER() OVER (PARTITION BY to_symbol ORDER BY rank DESC)
  <= N` inside `getResolvedCallers`** — REJECTED.

Rationale (grounded in the dedup subtlety the task flags):

1. **The cap is applied AFTER a dedup that SQL cannot see.** `tryPersistentBlast`
   dedups the raw reference rows by `fromPath|enclosing|toSymbol`
   ([service.ts:435-437](../../server/src/modules/repo-intel/service.ts#L435)),
   where `enclosing` is computed IN THE SERVICE from a SEPARATE query
   (`getSymbolRows` on the caller files, then `enclosingFromRows` by line —
   [service.ts:419-434](../../server/src/modules/repo-intel/service.ts#L419)). The
   `references` table has no `enclosing` column. A raw-row SQL
   `ROW_NUMBER() PARTITION BY to_symbol LIMIT N` would count raw references (a
   single enclosing caller can have MULTIPLE reference rows / lines to the same
   `toSymbol`), so it could yield **fewer than N *unique* callers per symbol** —
   the exact under-report we are fixing, reintroduced one layer down. The unit of
   "a caller" (`fromPath|enclosing|toSymbol`) only exists post-dedup in the
   service, so the cap must be applied there.
2. **Onion placement (onion-architecture rule 4 & the "where does this live"
   checklist).** The enclosing-symbol resolution + dedup is application logic that
   already lives in the service; the repository's job is the raw
   join-and-filter. Pushing a semantic per-symbol cap into SQL would move
   business logic (what counts as a distinct caller, how many to keep) into the
   data-access layer. Keep the repository query a thin `references ⋈ file_rank`
   read ([repository.ts:542-570](../../server/src/modules/repo-intel/repository.ts#L542))
   and cap in the service.
3. **No migration / no index / no window (postgresql-table-design).** Option (a)
   needs zero schema change. Option (b) would want an index supporting
   `PARTITION BY to_symbol ORDER BY rank` (a composite / window-friendly index on
   `references(repo_id, decl_file, to_symbol)` joined to `file_rank.rank`) to stay
   fast — a new migration (MANUAL `pnpm db:migrate`), for no benefit, since the
   caller set per changeset is already bounded and read in-process. The MANUAL
   migration convention (server AGENTS.md) makes gratuitous schema churn the wrong
   trade.
4. **Rank-tie determinism (fixes a latent non-determinism).** The current global
   `sort((a,b)=>b.rank-a.rank)` is not stable for equal ranks — and the degraded /
   pre-`file_rank` path sets `rank: 0` for every row
   ([service.ts:344](../../server/src/modules/repo-intel/service.ts#L344), types
   note [types.ts:78-79](../../server/src/modules/repo-intel/types.ts#L78)), so
   ties are common and "which survive the slice" is arbitrary run-to-run. The
   per-group sort adds a deterministic secondary key (S2 `tieBreak`) so the cap is
   reproducible — a small correctness bonus of doing it in-memory where we control
   the comparator.

**Decision:** cap in-memory in `tryPersistentBlast` by grouping the deduped
`callers[]` on `viaSymbol`, rank-sorting each group with a deterministic tie-break,
slicing each to `MAX_CALLERS_PER_SYMBOL`, and flattening back. `getResolvedCallers`
SQL is UNCHANGED (no LIMIT, no window).

### D2 — Split the constant: per-symbol blast cap vs total signatures budget (RESOLVED)

Keeping one constant is the root of the trap (S1): blast wants per-symbol,
`getCallerSignatures` wants total. **Decision:** two constants (S1) —
`MAX_CALLERS_PER_SYMBOL` (per-symbol, now actually enforced per symbol by D1) and
`MAX_CALLER_SIGNATURES_TOTAL` (total prompt-fuel budget). Both are 20 today, so the
signatures path is behavior-identical; only the NAME + doc-comment change there.
The misleading "ORDER BY rank DESC LIMIT N" per-symbol comment is corrected to
describe the in-memory grouping (S1). This is exactly the "resolve cleanly, two
distinct constants" the TD demands, rather than a blanket rename that would
mis-describe the blast intent.

### D3 — Keep the consumer's local per-symbol cap as defense-in-depth (RESOLVED — keep)

After the facade caps per-symbol, `blast/service.ts`'s local per-symbol cap
([blast/service.ts:204](../../server/src/modules/blast/service.ts#L204)) becomes
redundant in the happy path. **Decision: KEEP it** (documented defense-in-depth),
do NOT remove:

- **The facade is not the only caller shape.** The consumer re-groups by
  `viaSymbol` and can receive more than N per symbol from a DIFFERENT facade path:
  the ripgrep degraded `getBlastRadius` fallback returns its `callerRows` with NO
  per-symbol cap at all (assembled at
  [service.ts:321-356](../../server/src/modules/repo-intel/service.ts#L321),
  returned uncapped at [service.ts:358-364](../../server/src/modules/repo-intel/service.ts#L358)) —
  the per-symbol slice lives ONLY on the persistent `tryPersistentBlast` path
  (S2). The local cap guarantees the PANEL never renders an unbounded list
  regardless of which facade path fed it.
- **Do NOT import the repo-intel constant across the facade boundary** (server
  AGENTS.md: repo-intel only via `container.repoIntel.*`; onion-architecture rule 7
  — respect facade boundaries). The consumer's `MAX_CALLERS_PER_SYMBOL` stays a
  LOCAL declaration ([blast/service.ts:38-45](../../server/src/modules/blast/service.ts#L38)).
  The two constants living independently is intentional, not duplication to
  DRY-away.
- **Action:** update the local comment so it reads as intentional
  defense-in-depth now that the facade ALSO caps per-symbol (today it says the
  facade cap is global — that clause becomes stale after this fix). One-line
  comment edit only; the code and value are unchanged. (Optional, low-priority; if
  an implementer touches `blast/service.ts` for the comment cross-reference in
  Phase 3, do it there — otherwise leave it, since it is not load-bearing.)

### D4 — TD register bookkeeping is a PLAN STEP, done after the fix lands (Phase 4)

Do NOT edit the register now. As a plan step (Phase 4): flip TD-004 in
[docs/technical-debt/README.md](../technical-debt/README.md) row 32 from
`accepted` → `planned` when this spec is adopted, and → `paid (YYYY-MM-DD)` with a
spec + commit link once merged — mirroring how TD-003 was marked paid
([README.md:31](../technical-debt/README.md#L31)). Update the TD-004 detail file's
Status line ([TD-004…md:7](../technical-debt/TD-004-blast-max-callers-global-cap.md#L7))
to match, and (once paid) note that Option A ("regroup + cap per symbol") was taken
and Option B (rename to global + UI marker) was split: the total-budget half became
`MAX_CALLER_SIGNATURES_TOTAL`, the UI truncation marker was DEFERRED (D5).

### D5 — Truncation-visibility marker: DEFERRED, with the contract path documented (RESOLVED — defer)

The TD's option B includes a "showing top N callers per symbol" marker so
truncation is explicit. **Decision: DEFER**, and record why + what it would touch:

- **Why defer.** (i) The primary defect is *silent WRONG omission* (whole symbols
  dropped) — D1 fixes that; after it, a per-symbol cap dropping the 21st+ callers
  of ONE symbol is a benign, expected summarization (the panel is advisory —
  TD-004 "why accepted"). (ii) A marker touches the shared contract
  (`BlastResult` / `BlastCallerRow` server type AND the shared `DownstreamImpact` /
  `BlastRadius` in [contracts/brief.ts:31-44](../../server/src/vendor/shared/contracts/brief.ts#L31)),
  requires `scripts/sync-shared.mjs`, and a `BlastCard` UI affordance — a
  cross-package change disproportionate to a benign per-symbol trim. (iii) Contract
  check done: `brief.ts` `DownstreamImpact` has no `truncated`/`total` field today;
  adding one is additive but out of scope here.
- **What the follow-up would be (documented for the follow-up TD/spec, NOT built
  now):** add an OPTIONAL additive field via a NEW file / additive edit — e.g.
  `DownstreamImpact.truncated?: boolean` (+ maybe `total_callers?: number`) in the
  shared `brief.ts` (never edit the barrel), populated in the consumer `reshape`
  when `callerRows.length > MAX_CALLERS_PER_SYMBOL`
  ([blast/service.ts:202-204](../../server/src/modules/blast/service.ts#L202)), and
  a "+N more" affordance in `BlastCard`. Surface as a new register row (e.g.
  TD-004-followup or fold into TD-004's detail as a remaining sub-item) when a
  trigger fires (a user asks "why only 20 callers?").

## Phases

> **Dependency order:** Phase 1 (constants split) and Phase 2 (`tryPersistentBlast`
> per-symbol cap + `getCallerSignatures` default) both edit only server repo-intel
> files; Phase 2 CONSUMES the new constants from Phase 1, so **Phase 2 depends on
> Phase 1**. They touch the SAME two files (`constants.ts`, `service.ts`) — so they
> are NOT parallelizable and are best done as one sequential slice by one
> implementer (see the note under Phase 2). Phase 3 (tests) depends on Phase 2.
> Phase 4 (register bookkeeping + insights) is last. There is no client/shared work.

### Phase 1 — Split the constant (per-symbol blast cap vs total signatures budget)
- **Surface:** server (repo-intel constants).
- **Disjoint scope:** `server/src/modules/repo-intel/constants.ts` ONLY (the
  read-time-limits block, lines 28-30, per S1).
- **Depends on:** none.
- **Skills to apply:** `typescript-expert` (naming: keep `MAX_CALLERS_PER_SYMBOL`
  for the now-correct per-symbol meaning; introduce `MAX_CALLER_SIGNATURES_TOTAL`
  for the total budget), `onion-architecture` (constants stay in the module; no
  cross-boundary import). No `postgresql-table-design` — no schema.
- **What changes & why:** eliminate the dual-semantics trap (D2). One name meant
  two things; split into two correctly-documented constants (both 20), and fix the
  misleading "per changed symbol (ORDER BY rank DESC LIMIT N)" comment to describe
  the in-memory grouping the fix introduces.
- **Acceptance criteria:**
  - `constants.ts` exports BOTH `MAX_CALLERS_PER_SYMBOL` (=20, per-symbol,
    corrected comment) AND `MAX_CALLER_SIGNATURES_TOTAL` (=20, documented as the
    total prompt-fuel budget).
  - No behavior change from this phase alone (nothing consumes the new constant
    until Phase 2); `pnpm typecheck` passes (the new export is unused until Phase 2
    — acceptable within the combined slice; see Phase 2 note).
- **How to test:** `cd server && pnpm typecheck` (WSL). No runtime test for a
  constant; behavior is proven in Phase 3.

### Phase 2 — Per-symbol cap in `tryPersistentBlast` + total-budget default in `getCallerSignatures`
- **Surface:** server (repo-intel facade service).
- **Disjoint scope:** `server/src/modules/repo-intel/service.ts` — `tryPersistentBlast`
  sort+slice region ([service.ts:446-464](../../server/src/modules/repo-intel/service.ts#L446),
  per S2) + `getCallerSignatures` default `limit`
  ([service.ts:527-531](../../server/src/modules/repo-intel/service.ts#L527), per
  S3).
- **Depends on:** Phase 1 (consumes both new constant names).
- **Skills to apply:** `onion-architecture` (cap stays in the service AFTER the
  service-side dedup + enclosing resolution; repository SQL untouched — D1 rules 1
  & 2), `drizzle-orm-patterns` (confirm `getResolvedCallers` stays a plain
  `references ⋈ file_rank` read with NO added LIMIT/window — repository.ts:542-570),
  `typescript-expert` (deterministic tie-break comparator; `Map<string,
  BlastCallerRow[]>` grouping). NO `postgresql-table-design` / NO migration (D1
  rule 3).
- **What changes & why:** the core fix. Replace the global `callers.sort(...)` +
  `callers.slice(0, MAX_CALLERS_PER_SYMBOL)` with a group-by-`viaSymbol`,
  per-group rank-sort (deterministic tie-break), per-group `slice(0, N)`, then
  flatten (S2) — so EVERY changed symbol gets up to N callers, not top-N across
  all. Point `getCallerSignatures`'s default `limit` at
  `MAX_CALLER_SIGNATURES_TOTAL` (S3) — behavior-identical, semantics-correct.
  Ensure `impactedEndpoints`/`factsByFile` are derived from the CAPPED caller set
  (NOTE-A in S2).
- **Acceptance criteria:**
  - For a wide changeset with >20 callers each across ≥2 `viaSymbol`s,
    `getBlastRadius(...).callers` contains up to `MAX_CALLERS_PER_SYMBOL` callers
    for EACH `viaSymbol` (not top-N total). No `viaSymbol` present in the input is
    silently emptied by the cap.
  - The returned `callers[]` is still a FLAT `BlastCallerRow[]` (contract shape
    unchanged, S4); the consumer `reshape` regroups it unchanged.
  - Rank-tie determinism: two runs over the same input return the SAME surviving
    callers per symbol (secondary sort key applied).
  - `impactedEndpoints` reflects the callers that SURVIVE the cap (NOTE-A) — not
    endpoints of dropped callers.
  - `getCallerSignatures` behavior is unchanged (default budget still 20 total;
    `if (out.length >= limit) break` intact); only the constant NAME differs.
  - No Drizzle/SQL change; `getResolvedCallers` has no LIMIT/window added. No new
    migration file.
  - `pnpm typecheck` passes.
- **How to test:** proven in Phase 3 (`cd server && pnpm test`); `pnpm typecheck`
  now (WSL).
- **NOTE (parallelization):** Phases 1 & 2 edit the SAME two files and Phase 2
  depends on Phase 1's exports — they are **NOT** independently parallelizable.
  Recommend ONE implementer executes Phase 1 then Phase 2 as a single sequential
  slice. Phase 3 (tests) is a genuinely disjoint file and MAY be written in
  parallel by `test-writer` against the S5 harness + the S2/S3 acceptance criteria
  (the test authoring does not touch `service.ts`/`constants.ts`), then run after
  Phase 2 lands.

### Phase 3 — Regression test: per-symbol cap on a wide, multi-symbol changeset
- **Surface:** server (tests).
- **Disjoint scope:** `server/test/blast-per-symbol-cap.test.ts` (NEW — recommended,
  to keep the unresolved-index test focused) OR an added `describe` block in
  `server/test/blast-unresolved-index.test.ts`. Copies the S5 pure-mock harness.
  Does NOT touch production source.
- **Depends on:** Phase 2 (asserts the fixed behavior).
- **Skills to apply:** `onion-architecture` (test drives the facade via
  `getBlastRadius` — the sanctioned entry — not internals), `typescript-expert`
  (typed stubs). This is a pure unit test (no DB) → `.test.ts`, NOT `.it.test.ts`
  (server AGENTS.md: DB-backed = `.it.test.ts`; this uses a stubbed `repo`, so
  plain `.test.ts` is correct — matching the precedent
  [blast-unresolved-index.test.ts](../../server/test/blast-unresolved-index.test.ts)).
- **What changes & why:** prove the currently-INVISIBLE failure. The wide-changeset
  case (>20 total callers across ≥2 symbols) is exactly what today's global slice
  gets wrong (a lower-ranked symbol emptied) and what has no coverage at the facade
  layer — the consumer's existing regression
  ([blast-service.test.ts:197-224](../../server/test/blast-service.test.ts#L197))
  only exercises the CONSUMER cap on already-truncated input, so it would stay
  green even with the facade bug present.
- **Acceptance criteria:**
  - A test builds `getResolvedCallers` returning 30 callers via `toSymbol:'alpha'`
    + 30 via `toSymbol:'beta'` (distinct `fromPath` so dedup keeps them; healthy
    `getReferenceResolution` so the persistent path runs), drives
    `svc.getBlastRadius(repoId, changedFiles)`, and asserts
    `callers.filter(c=>c.viaSymbol==='alpha').length === 20` AND
    `...'beta'...length === 20`. (Against pre-Phase-2 code this test FAILS — beta
    is emptied/under-20 — confirming it pins the bug.)
  - A test asserts rank-tie determinism: identical input → identical surviving set
    across two calls (or an explicit ordering assertion on a rank-0-heavy group).
  - A test asserts the small case is unaffected: ≤20 total across symbols returns
    all callers (per-symbol cap coincides with the old global one — TD-004 "why
    accepted").
  - Assert `impactedEndpoints` excludes endpoints unique to cap-dropped callers
    (NOTE-A, now mandatory): stub `getFileFacts` so a dropped (21st+) caller's file
    contributes a UNIQUE endpoint, then assert that endpoint is ABSENT from the
    facade `impactedEndpoints`.
  - Existing `blast-service.test.ts` and `blast-unresolved-index.test.ts` stay
    green.
- **How to test:** `cd server && pnpm test` (or `pnpm exec vitest run
  blast-per-symbol-cap` first for the new file), then the full `server` suite
  green; `pnpm typecheck` (WSL).

### Phase 4 — TD register bookkeeping + insights sweep
- **Surface:** cross-cutting (docs only; no source change).
- **Disjoint scope:** `docs/technical-debt/README.md` (row 32),
  `docs/technical-debt/TD-004-blast-max-callers-global-cap.md` (Status +
  paydown-taken note), and `server/INSIGHTS.md` (append).
- **Depends on:** Phases 1–3 merged.
- **Skills to apply:** `engineering-insights` (read-before-write; append-only;
  capture only the substantial).
- **What & why (D4):** flip TD-004 `accepted → planned` when this spec is adopted;
  → `paid (YYYY-MM-DD)` with spec + commit links once merged (mirror TD-003 row 31).
  Record in `server/INSIGHTS.md`: (a) "the facade `MAX_CALLERS_PER_SYMBOL` was a
  GLOBAL slice over one flat rank-sorted array — a per-symbol cap MUST group by
  `viaSymbol` AFTER the service-side dedup (`fromPath|enclosing|toSymbol`), which
  SQL cannot express, so it stays in the service, not a `ROW_NUMBER()` window"; (b)
  "`getCallerSignatures`'s `limit` is a TOTAL prompt-fuel budget (correctly global)
  — now `MAX_CALLER_SIGNATURES_TOTAL`, distinct from the per-symbol blast cap;
  don't re-merge them"; (c) the DEFERRED truncation marker (D5) as a known
  follow-up.
- **Acceptance criteria:** register + detail Status consistent; INSIGHTS entries
  appended (not duplicated); a NEW register row is filed for the DEFERRED truncation
  marker (D5) so the deferral is tracked (a TD-004 follow-up item / new TD-NNN row),
  not just noted in the spec. No code change.
- **How to test:** N/A (docs). Confirm the `server`/`client` suites are still green
  from Phase 3.

## Risks & mitigations

- **Reintroducing the under-report one layer down (SQL LIMIT-per-symbol) — the #1
  design trap.** A `ROW_NUMBER() PARTITION BY to_symbol` in `getResolvedCallers`
  counts RAW references, but a caller is only distinct AFTER the service dedup by
  `fromPath|enclosing|toSymbol` — so SQL could return < N unique callers per symbol
  (D1 rule 1). **Mitigation:** cap in the service after dedup (D1); the SQL stays
  unchanged; a test with multiple reference lines from one enclosing caller (same
  `fromPath|enclosing`, different `line`) can pin that the cap counts UNIQUE
  callers, not rows.
- **Rank-tie non-determinism (latent, surfaced by this change).** Equal ranks
  (esp. the all-`rank:0` degraded path) make "which 20 survive" arbitrary.
  **Mitigation:** deterministic secondary sort key (S2 `tieBreak`); a test asserts
  reproducibility.
- **`impactedEndpoints` drift (NOTE-A).** If endpoints keep being unioned over the
  PRE-cap caller files, the facade reports endpoints for callers it no longer
  returns. **Mitigation:** derive the facts union from the CAPPED callers (S2
  NOTE-A); the consumer `reshape` already does this on its side, so alignment is
  natural. A test can assert the union excludes dropped-caller endpoints.
- **Dual-semantics regression on the signatures path.** If the split accidentally
  changed the `getCallerSignatures` value or the break condition, prompt-fuel
  budgeting would change. **Mitigation:** value stays 20; ONLY the constant name +
  comment change (S3); the `repo-intel-facade-degraded.test.ts` signatures cases
  ([lines 49-51,110-124](../../server/test/repo-intel-facade-degraded.test.ts#L49))
  stay green.
- **Consumer double-cap confusion.** Two per-symbol caps (facade + consumer) could
  look like an accidental duplicate. **Mitigation:** KEEP the consumer cap as
  documented defense-in-depth (D3), update its comment (the "facade cap is global"
  clause is now stale), and do NOT cross-import the constant (facade boundary).
- **Silent-truncation visibility still absent.** After the fix, a symbol with >20
  callers still trims silently (no "+N more"). **Mitigation:** this is now benign
  (whole-symbol drops are gone) and advisory; the marker is explicitly DEFERRED
  with its contract path documented (D5) as a follow-up — not a regression from
  today (today has no marker either).
- **Migration risk — avoided.** The fix is service-layer only; NO schema/index/
  migration (D1 rule 3). If a reviewer insists on the SQL-window approach, it WOULD
  need `pnpm db:generate` + MANUAL `pnpm db:migrate` for a supporting index — call
  it out and do NOT auto-apply; the plan recommends against it.

## Critical files for implementation

- `server/src/modules/repo-intel/service.ts` — `tryPersistentBlast` (the global
  sort+slice → per-`viaSymbol` cap, S2) and `getCallerSignatures` default (S3). The
  heart of the fix (Phase 2).
- `server/src/modules/repo-intel/constants.ts` — split
  `MAX_CALLERS_PER_SYMBOL` / `MAX_CALLER_SIGNATURES_TOTAL` + corrected comments
  (S1, Phase 1).
- `server/test/blast-unresolved-index.test.ts` — the pure-mock facade harness to
  copy (S5); the new per-symbol regression lives here or in a sibling (Phase 3).
- `server/src/modules/repo-intel/repository.ts` — `getResolvedCallers`
  ([542-570](../../server/src/modules/repo-intel/repository.ts#L542)); confirmed
  UNCHANGED (no LIMIT/window) — read-only reference for D1.
- `server/src/modules/blast/service.ts` — the CONSUMER `reshape` per-symbol cap
  ([186-229](../../server/src/modules/blast/service.ts#L186)); kept as
  defense-in-depth, optional comment refresh (D3).

## Open questions / assumptions

- **OQ1 (NOTE-A ordering).** Whether `impactedEndpoints`/`factsByFile` are computed
  before or after the per-symbol cap is an implementer call; RECOMMENDATION is
  after (derive from `cappedCallers`) so the facade's endpoints match its returned
  callers (S2 NOTE-A). Either way the consumer `reshape` re-unions over its own
  capped set, so the CLIENT-visible endpoints are already correct; the facade-level
  alignment is a consistency nicety, not a correctness bug for the panel.
- **OQ2 (truncation marker copy/UX).** Deferred entirely (D5); no contract impact
  in this plan. Wording + affordance are a follow-up UX call.
- **Assumption.** `viaSymbol` (= `ResolvedCallerRow.toSymbol`,
  [service.ts:441](../../server/src/modules/repo-intel/service.ts#L441)) is the
  correct per-symbol grouping key — confirmed: it is precisely how the consumer
  `reshape` groups ([blast/service.ts:194-199](../../server/src/modules/blast/service.ts#L194))
  and matches the "per changed symbol" intent in the constant's comment (S1). The
  changed symbol a caller reaches, not the caller's own enclosing symbol.
- **Assumption.** Keeping BOTH constants at 20 is intentional (behavior-preserving
  on signatures; documented per-symbol on blast). If product later wants a
  different per-symbol blast fan-out, only `MAX_CALLERS_PER_SYMBOL` changes — the
  split makes that independent of the prompt budget.
