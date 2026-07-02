# Development Plan: Blast Radius PR-vs-index freshness / provenance signal (TD-003, Option A)

## Context

The Blast Radius panel builds its impact map from the repo-intel index, which is
built ONLY against the repo's **default branch** — the clone is advanced to
`origin/<defaultBranch>` before every (re)index
([repo-intel/service.ts:196](../../server/src/modules/repo-intel/service.ts#L196)).
But the map is served for a **specific PR** whose head has diverged. `getBlast`
copies the index build `status` (`full`/`partial`/`degraded`/`failed`) straight
into the response ([blast/service.ts:70-95](../../server/src/modules/blast/service.ts#L70-L95))
— and `status` reflects **build quality**, NOT PR-vs-index drift. So a `full`
(no-badge) panel can render a **confident, WRONG** "0 downstream / no impact":
the changed symbols' real callers or new symbols live on a ref the index never
saw. The absence of any badge makes the wrongness invisible — worse than a
`degraded` panel, which at least warns. Full problem statement:
[docs/technical-debt/TD-003-blast-no-pr-vs-index-freshness.md](../technical-debt/TD-003-blast-no-pr-vs-index-freshness.md).

This plan implements **TD-003 Option A + the "Minimum"**: a PR-vs-index
**freshness / provenance** signal, DISTINCT from build `status`, computed **on
read with NO network call**, mirroring the shipped review-freshness `is_stale`
pattern ([docs/specs/review-freshness.md](./review-freshness.md)). Intended
outcome: the panel always states which ref the map reflects, and never renders a
bare confident "0 downstream" without a freshness caveat.

### Scope & non-goals

- **In scope:** (1) surface the indexed ref/branch + sha **provenance** on the
  read contract; (2) a derived staleness/divergence hint (`is_stale` +
  `stale_reason`) computed on read from primitives already on hand — no network;
  (3) the **Minimum** — the empty/confident-wrong "0 downstream" case always
  carries a freshness caveat; (4) a `BlastCard` badge/caveat (WCAG: icon+text,
  never color alone).
- **NOT in scope — Option B (deferred):** "index the PR head/merge ref on demand"
  (a ~165–198s clone-advance + full graph rebuild). Do NOT touch the index
  pipeline timing, `INDEX_SOFT_BUDGET_MS`, or any re-indexing trigger.
- **NOT in scope:** the PR-list review status (`deriveReviewStatus`,
  `modules/pulls/status.ts`) — a separate, unrelated findings/review-level signal.
  Stays exactly as-is.
- **NOT a new endpoint:** the signal rides on the existing `GET /pulls/:id/blast`
  response (mirrors review-freshness: no separate `/freshness` route).

## Affected packages & files

**`@devdigest/shared` contracts** (extend with NEW optional fields; never edit the barrel):
- `server/src/vendor/shared/contracts/review-api.ts` — EDIT (additive). Extend
  `BlastResponse` ([review-api.ts:112-118](../../server/src/vendor/shared/contracts/review-api.ts#L112))
  with optional provenance + freshness fields (see S4). Then
  `node scripts/sync-shared.mjs` (server copy is source of truth; CI fails on drift).

**server/** (blast module + repo-intel facade):
- `server/src/modules/blast/freshness.ts` — **NEW**. PURE helper
  `deriveBlastFreshness(parts)` taking only primitives (indexed branch/sha, PR
  base/branch/headSha, repo defaultBranch, downstream count) → `{ is_stale,
  stale_reason }`. No container/DB/network — unit-tests trivially. Mirrors
  `reviews/freshness.ts` discipline.
- `server/src/modules/blast/service.ts` — EDIT. `getBlast`
  ([service.ts:58-96](../../server/src/modules/blast/service.ts#L58)) reads the
  new provenance off `IndexState`, calls the pure helper, and adds the fields to
  the response. Preserve best-effort discipline: NO new throw; the only throw
  stays the workspace-scope 404.
- `server/src/modules/repo-intel/types.ts` — EDIT (additive). Add
  `indexedBranch?: string` (+ keep existing `lastIndexedSha`) to `IndexState`
  ([types.ts:42-54](../../server/src/modules/repo-intel/types.ts#L42)). This is
  the clean Onion door: blast reads provenance via the facade's `IndexState`,
  never via `getRepoBasics`.
- `server/src/modules/repo-intel/repository.ts` — EDIT (additive). In
  `tryGetIndexState` ([repository.ts:206-247](../../server/src/modules/repo-intel/repository.ts#L206)),
  project `stats.indexedBranch` (a string) into the returned `IndexState.indexedBranch`
  (mirrors how `durationMs`/`reason`/`indexingStartedAt` are projected out of `stats`).
- `server/src/modules/repo-intel/pipeline/full.ts` &
  `server/src/modules/repo-intel/pipeline/incremental.ts` — EDIT (additive). At
  index time, stamp `stats.indexedBranch = repo.defaultBranch` into the `stats`
  object passed to `safePersist`/the terminal `upsertIndexState`. `repo` (with
  `defaultBranch`) is already in scope at [full.ts:78](../../server/src/modules/repo-intel/pipeline/full.ts#L78)
  / [incremental.ts:59](../../server/src/modules/repo-intel/pipeline/incremental.ts#L59).
  **No migration** — `stats` is `jsonb` already used this way.

**client/** (UI badge/caveat):
- `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastCard/BlastCard.tsx`
  — EDIT. Compose a new freshness badge with the existing `statusBadge`; upgrade
  the `noDownstream` empty-tree copy to carry the caveat when the map is stale.
- `client/messages/en/blast.json` — EDIT (additive). New i18n keys (see S6).

**Reuse (do NOT re-implement):**
- The `is_stale` / `stale_reason` contract shape + doc-comment style already on
  `PrIntentRecord`/`PrRisksRecord` ([review-api.ts:76-94](../../server/src/vendor/shared/contracts/review-api.ts#L76)).
- The pure-helper-in-server discipline of `reviews/freshness.ts` (per review-freshness spec §"Affected files").
- The `stats` jsonb-merge provenance precedent: `markIndexingStarted` /
  `tryGetIndexState`'s `indexingStartedAt` ([repository.ts:216-221,354-370](../../server/src/modules/repo-intel/repository.ts#L216)).
- `Badge` / `Icon` primitives + the existing `statusBadge` + `STATUS_META` WCAG
  pattern in `BlastCard.tsx` ([BlastCard.tsx:31-75](../../client/src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/BlastCard/BlastCard.tsx)).
- `container.reviewRepo.getPull` (→ `PullRow` with `base`, `branch`, `headSha`,
  `repoId`; [db/rows.ts:18](../../server/src/db/rows.ts#L18), pulls schema
  [pulls.ts:18-20](../../server/src/db/schema/pulls.ts#L18)) and
  `container.repoIntel.getIndexState` — both already called in `getBlast`.

## Shared scaffold (context pack — verbatim, do not re-open the sources)

### S1 — `getBlast` best-effort skeleton to extend (blast/service.ts:70-95, verbatim today)
```ts
let status: BlastResponse['status'] = 'failed';
let degradedReason: string | null = null;
let radius: BlastRadius;
try {
  const state = await this.container.repoIntel.getIndexState(pull.repoId);
  status = state.status;
  degradedReason = state.degradedReason ?? null;
  const result = await this.container.repoIntel.getBlastRadius(pull.repoId, changedFiles);
  radius = reshape(result);
} catch {
  radius = { changed_symbols: [], downstream: [], summary: '' };
}
// ...resolveSummary...
return { pr_id: prId, blast: radius, status, degraded_reason: degradedReason };
```
INVARIANT to preserve: a missing/degraded index NEVER throws past the facade
reads; the ONLY throw in `getBlast` is `if (!pull) throw new NotFoundError(...)`
([service.ts:63](../../server/src/modules/blast/service.ts#L63)). The freshness
computation must live **inside** the same best-effort flow.

IMPLEMENTATION NOTE (resolves plan-verifier Inc.2): `getIndexState` NEVER throws —
`tryGetIndexState` catches all errors and returns `null`, and `getIndexState`
synthesises a degraded row (`status:'degraded'`, `lastIndexedSha:''`, no
`indexedBranch`) on `null`
([repository.ts:242-246](../../server/src/modules/repo-intel/repository.ts#L242),
[service.ts:250-265](../../server/src/modules/repo-intel/service.ts#L250)). So the
ONLY facade call that can throw inside the try is the SECOND one,
`getBlastRadius`. Therefore capture the provenance (`indexedBranch`,
`lastIndexedSha`) into vars declared in the OUTER scope, assigned right AFTER
`getIndexState` returns and BEFORE `getBlastRadius`. If `getBlastRadius` throws,
the catch keeps the already-captured provenance and leaves `downstreamCount = 0`
⇒ the `empty_map` caveat still fires (correct: the index WAS read, only the
callers couldn't be computed). Provenance is null ONLY for the
synthesised-degraded state (`lastIndexedSha:''` → null, `indexedBranch` undefined
→ null), never merely because `getBlastRadius` failed.

### S2 — `IndexState` today (types.ts:42-54) — add `indexedBranch?`
```ts
export interface IndexState extends IndexResult {
  repoId: string;
  lastIndexedSha: string;
  indexerVersion: number;
  updatedAt: Date;
  indexing?: boolean;
  degraded?: boolean;
  degradedReason?: DegradedReason;
  // ADD: indexedBranch?: string;  // the branch the map reflects (from stats.indexedBranch)
}
```

### S3 — the `stats` projection pattern to mirror (repository.ts:213-241, verbatim excerpt)
```ts
const stats = (row.stats ?? {}) as Record<string, unknown>;
const durationMs = typeof stats.durationMs === 'number' ? stats.durationMs : 0;
const reason = typeof stats.reason === 'string' ? stats.reason : undefined;
// ADD (same shape): const indexedBranch = typeof stats.indexedBranch === 'string' ? stats.indexedBranch : undefined;
// ...return { ..., indexedBranch };
```
And the WRITE side to mirror (`markIndexingStarted`, repository.ts:362-370) uses
a jsonb merge — but here the provenance is written by the **pipeline's terminal
`safePersist`/`upsertIndexState`**, which already builds a fresh `stats` object
(so just add `indexedBranch: repo.defaultBranch` to that object; no `||` merge
needed on the terminal write).

### S4 — contract extension (review-api.ts BlastResponse:112-118) — additive optional fields
```ts
export const BlastResponse = z.object({
  pr_id: z.string(),
  blast: BlastRadius,
  status: z.enum(['full', 'partial', 'degraded', 'failed']),
  degraded_reason: z.string().nullish(),
  // ADD — provenance (which ref the map reflects; read in context of "0 downstream"):
  indexed_branch: z.string().nullish(),   // e.g. "main"; nullish when unknown
  indexed_sha: z.string().nullish(),      // = IndexState.lastIndexedSha; nullish when unknown/empty
  // ADD — derived freshness hint (computed on read, NO network), mirrors PrIntentRecord:
  is_stale: z.boolean().optional(),       // client treats missing as not-stale
  stale_reason: z.string().optional(),    // opaque code, e.g. 'base_diverged' | 'empty_map'
});
```
Doc-comment style: copy the `is_stale`/`stale_reason` comment tone from
`PrIntentRecord` (review-api.ts:69-80). Optional/nullish so older callers/tests
stay valid.

### S5 — the pure freshness helper contract (NEW blast/freshness.ts)
```ts
export interface BlastFreshnessParts {
  indexedBranch?: string;   // IndexState.indexedBranch (may be undefined on legacy rows)
  indexedSha: string;       // IndexState.lastIndexedSha ('' when no index)
  repoDefaultBranch?: string; // OPTIONAL — see decision D3; may be absent (not on facade)
  prBase: string;           // pull.base   (branch the PR targets)
  prBranch: string;         // pull.branch (PR's own head branch)
  prHeadSha: string;        // pull.headSha
  downstreamCount: number;  // radius.downstream.length (0 = the dangerous empty case)
  indexReadable: boolean;   // defensive; getIndexState never throws, so the service sets this true after the state read (kept so the pure helper is self-contained)
}
export interface BlastFreshness { is_stale: boolean; stale_reason?: string; }
export function deriveBlastFreshness(p: BlastFreshnessParts): BlastFreshness;
```
Pure, no imports beyond types. Logic per decision D1/D2/D4 below.

### S6 — client i18n additions (blast.json) + BlastCard seam
`blast.json` today has `status.{partial,degraded,empty}` and
`noDownstream: "{count} changed symbol(s), no downstream callers found."`
([blast.json:14,19-23](../../client/messages/en/blast.json#L14)). ADD e.g.:
```json
"freshness": {
  "provenance": "Indexed on {branch} @ {sha}",
  "staleBadge": "May be stale",
  "staleTooltip": "This map was built from the index of {branch}, not this PR — callers or symbols the PR adds may not appear.",
  "noDownstreamCaveat": "{count} changed symbol(s), no downstream callers found in the index of {branch} — this may miss impact introduced by this PR."
}
```
`BlastCard.tsx` seam: the existing `statusBadge` block (BlastCard.tsx:69-75) and
the `noDownstream` branch in `BlastTree` (BlastCard.tsx:204-210). Add a derived
`isStale = !!data.is_stale` and compose a freshness `Badge` (icon `AlertTriangle`,
`var(--warn)` — same tokens as `statusBadge`) next to it; when `data.is_stale`
and `downstream.length === 0`, render `noDownstreamCaveat` instead of
`noDownstream`. Strings via `useTranslations("blast")`.

## Confirmed decisions / open questions

This is the crux of the feature. A naive `state.lastIndexedSha !== pull.headSha`
comparison is **meaningless and permanently true** — the index is built on the
default branch by design, and a PR head is ALWAYS a different commit. A raw
SHA-equality "stale" flag would fire on EVERY PR forever (noise → users ignore it
→ the confident-wrong case stays invisible). The signal is therefore built from
**provenance + specific divergence conditions**, not SHA inequality.

### D1 — Provenance is ALWAYS exposed (not conditional on staleness)
`indexed_branch` + `indexed_sha` are set on every response whenever the index
state was readable. This is the primary fix: "0 downstream" is now read *in
context* ("no downstream callers found in the index of `main`") even when
`is_stale` is false. The map's ref is never implicit again.

### D2 — `is_stale` is a *narrow, meaningful* signal, NOT SHA inequality (RESOLVED)
`deriveBlastFreshness` sets `is_stale = true` in exactly these cases (checked in
order; first match wins for `stale_reason`):

1. **`empty_map` (the TD-003 "Minimum" — the dangerous confident-wrong case).**
   `downstreamCount === 0` AND the index was readable ⇒ `is_stale: true`,
   `stale_reason: 'empty_map'`. A bare "0 downstream" MUST never render without a
   caveat; this is the elevated caveat on exactly the case that matters. (When
   there IS downstream impact, an empty-case caveat is unnecessary — a `full`
   map with callers is trustworthy enough for an advisory panel.)
2. **`base_diverged` (stronger staleness).** `repoDefaultBranch` is known AND
   `prBase !== repoDefaultBranch` (the PR does NOT target the default branch) ⇒
   the index doesn't even reflect the PR's base. `is_stale: true`,
   `stale_reason: 'base_diverged'`. This DOES flag most PRs? No — only PRs
   targeting a non-default branch (stacked/release-branch PRs), which is exactly
   when the map is least trustworthy. This is the one genuinely
   divergence-driven flag and it is NOT permanently true.
3. Otherwise `is_stale: false`. In particular, a normal PR targeting the default
   branch with a non-empty map is NOT flagged — avoiding the permanent-false-stale
   trap.

Rationale: each condition is either the specific dangerous case (empty map) or a
real, non-constant divergence (non-default base). We deliberately DO NOT flag on
`indexedSha !== prHeadSha` (permanently true) or on `prBranch !== indexedBranch`
(also permanently true — a PR head branch is never the default branch).

### D3 — Record `indexedBranch` in `stats` at index time; `repoDefaultBranch` on read is OPTIONAL (RESOLVED — recommend stats)
Two sources for "which branch does the map reflect":
- **(a) Stamp `stats.indexedBranch = repo.defaultBranch` at index time** (mirrors
  the self-expiring `indexingStartedAt` jsonb precedent; the pipeline already
  writes a fresh `stats` object and has `repo.defaultBranch` in scope). **Truthful
  provenance:** it records the branch the map ACTUALLY reflects at the moment it
  was built, immune to a later `repos.defaultBranch` change. **No migration**
  (`stats` is `jsonb`). **RECOMMENDED** — it is the honest record and the clean
  Onion path (surfaced via `IndexState`, blast never touches `getRepoBasics`).
- **(b) Read `repo.defaultBranch` on the blast read-path.** Rejected as the
  *provenance* source: (i) it can drift from what was actually indexed (rename the
  default branch → the map still reflects the old branch, but (b) would report the
  new one — a subtle lie); (ii) `defaultBranch` is NOT on the `RepoIntel` facade
  (only on the internal `getRepoBasics`, [repository.ts:137-149](../../server/src/modules/repo-intel/repository.ts#L137)),
  and blast must not reach repos directly (server/AGENTS.md: `container.repoIntel.*`
  is the only sanctioned door). Exposing it would need a new facade method just to
  duplicate what (a) records truthfully.

**Decision:** provenance (`indexed_branch`) comes from `stats.indexedBranch` via
`IndexState.indexedBranch` (option a). The `base_diverged` check (D2 rule 2)
needs `repoDefaultBranch` to compare `prBase` against; use `indexedBranch` itself
as that reference — the indexed branch IS the default branch the index was built
on, so `prBase !== indexedBranch` is the correct, self-consistent divergence test
(and it needs no extra facade method). Legacy index rows lack `stats.indexedBranch`
(→ `indexedBranch` undefined); then provenance renders as "the default branch"
generically and the `base_diverged` check is SKIPPED (no false alarm) — only the
`empty_map` caveat still applies. This keeps the write/read symmetry the
review-freshness spec flagged as the #1 risk: the branch used for the
`base_diverged` comparison is the SAME value we recorded and surface as
provenance — they can never disagree.

### D4 — Onion path for provenance (RESOLVED)
Blast reads provenance ONLY through `container.repoIntel.getIndexState(...)`'s
returned `IndexState.indexedBranch`. No new facade method, no `getRepoBasics`
reach-through, no Drizzle in `blast/service.ts`. The write stays inside the
repo-intel pipeline (repository/pipeline), the read stays behind the facade —
dependency direction preserved (onion-architecture rules 4 & 7).

### Open questions (surface, do not block)
- **OQ1 — Copy for the empty-map caveat vs. the base-diverged badge.** Two
  distinct `stale_reason`s map to two message strings; final wording is a UX
  call. Proposed strings in S6; adjust in the UI phase without changing the
  contract.
- **OQ2 — Should `indexing` (a reindex in progress) suppress the stale badge?**
  When `state.indexing` is true a fresher map is imminent. Recommend: still show
  provenance, still show `empty_map` caveat (the current map is what's rendered),
  but this is a minor polish — left to the UI phase, no contract impact.

## Phases

> **Dependency order:** Phase 1 (contract + pure helper) has no deps. Phase 2
> (repo-intel provenance: types + repository projection + pipeline stamp) has no
> deps and is disjoint from Phase 1. Phase 3 (blast service wiring) depends on
> Phases 1 + 2. Phase 4 (UI) depends only on the Phase 1 contract field. Phase 5
> (tests + insights) follows. Phases 1, 2, and 4 can start in parallel.

### Phase 1 — Contract fields + pure freshness helper
- **Surface:** shared contract + server (pure util).
- **Disjoint scope:** `server/src/vendor/shared/contracts/review-api.ts`
  (`BlastResponse` fields, per S4) + `node scripts/sync-shared.mjs`;
  `server/src/modules/blast/freshness.ts` (NEW pure helper, per S5).
- **Depends on:** none.
- **Skills to apply:** `zod` (additive optional/nullish fields;
  parse-don't-validate; optional so old callers stay valid),
  `onion-architecture` (the helper takes primitives — no container/DB/network),
  `typescript-expert`.
- **What changes & why:** the contract exposes provenance + the derived hint so
  the client can render context and a caveat. `deriveBlastFreshness` centralizes
  the D2 logic in ONE pure function (the service just gathers inputs and calls
  it) so read-path logic is trivially testable and can't drift.
- **Acceptance criteria:**
  - `BlastResponse.safeParse({ pr_id, blast, status })` still succeeds (all new
    fields optional/nullish); parsing with `indexed_branch`, `indexed_sha`,
    `is_stale`, `stale_reason` set also succeeds.
  - `deriveBlastFreshness` is deterministic and pure (no imports beyond types).
  - `downstreamCount === 0` + `indexReadable` ⇒ `{ is_stale: true, stale_reason:
    'empty_map' }`.
  - `prBase !== indexedBranch` (both defined) ⇒ `is_stale: true`, `stale_reason:
    'base_diverged'` — BUT per D2's authoritative order (`empty_map` is rule 1,
    "first match wins"), an empty map on a non-default-base PR reports
    `stale_reason: 'empty_map'`; `base_diverged` is reported only when the map is
    non-empty. The Ph1 test MUST assert this precedence (empty_map wins).
  - A normal PR (base === indexedBranch, downstreamCount > 0) ⇒ `is_stale:
    false`. `indexedSha !== prHeadSha` alone NEVER sets stale.
  - `indexReadable === false` (catch branch) ⇒ `is_stale: false` (unknown, no
    false alarm).
- **How to test:** `cd server && pnpm test` — a unit test table over
  `deriveBlastFreshness` (empty-map, base-diverged, normal, legacy
  undefined-branch, index-unreadable); a zod unit test for the optional fields.
  `pnpm typecheck` (server). `cd reviewer-core` untouched. Run in WSL per project
  setup.

### Phase 2 — repo-intel provenance (indexedBranch through facade + stamped at index time)
- **Surface:** server (repo-intel facade type + repository + pipeline).
- **Disjoint scope:** `server/src/modules/repo-intel/types.ts` (`IndexState.indexedBranch?`,
  per S2); `server/src/modules/repo-intel/repository.ts` (`tryGetIndexState`
  projects `stats.indexedBranch`, per S3); `server/src/modules/repo-intel/pipeline/full.ts`
  & `pipeline/incremental.ts` (stamp `stats.indexedBranch = repo.defaultBranch`
  into the terminal `stats` object).
- **Depends on:** none (disjoint from Phases 1 & 4).
- **Skills to apply:** `onion-architecture` (DB read stays in the repository;
  provenance surfaced via the facade type, NOT via a repos reach-through — D3/D4),
  `drizzle-orm-patterns` (jsonb `stats` write — reuse the existing object build,
  no new column), `typescript-expert`. **No `postgresql-table-design` / no
  migration** — this is the deliberate `stats` jsonb route (D3).
- **What changes & why:** records the branch the map ACTUALLY reflects at index
  time (truthful provenance, immune to a later default-branch rename) and surfaces
  it through the sanctioned facade door so blast can read it without touching
  repos. Mirrors the `indexingStartedAt` self-expiring jsonb precedent.
- **Acceptance criteria:**
  - After a full or incremental index, the persisted `repo_index_state.stats`
    contains `indexedBranch` = the repo's default branch.
  - `getIndexState(repoId).indexedBranch` returns that string; on a legacy row
    without `stats.indexedBranch` it is `undefined` (no throw).
  - No new migration file is produced; `repo_index_state` column set is unchanged.
  - `tryGetIndexState`'s existing best-effort catch (table missing ⇒ `null`) is
    preserved; `getIndexState` still synthesises its degraded fallback with
    `indexedBranch` undefined.
- **How to test:** `cd server && pnpm test` — an `*.it.test.ts` that runs an
  index (or upserts a state row with `stats.indexedBranch`) and asserts
  `getIndexState(...).indexedBranch`; a unit assertion that the pipeline's
  terminal `stats` object includes `indexedBranch`. `pnpm typecheck`. WSL.

### Phase 3 — Blast service wiring (provenance + freshness into the response)
- **Surface:** server (blast application service).
- **Disjoint scope:** `server/src/modules/blast/service.ts` (`getBlast` only).
- **Depends on:** Phases 1 + 2 (needs the contract fields, the pure helper, and
  `IndexState.indexedBranch`).
- **Skills to apply:** `onion-architecture` (orchestration only — read via
  `container.repoIntel.getIndexState`, compute via the pure `freshness.ts`, NO
  Drizzle/adapter import; preserve facade boundaries), `zod`, `fastify-best-practices`
  (route stays thin — this is service-layer), `security` (all provenance strings
  are repo-derived; they flow out as data — no injection surface; the workspace
  404 guard prevents cross-tenant reads and is preserved).
- **What changes & why:** `getBlast` captures `indexed_branch = state.indexedBranch
  ?? null` and `indexed_sha = state.lastIndexedSha || null` into OUTER-scope vars
  right after `getIndexState` (which never throws — see S1 IMPLEMENTATION NOTE),
  then computes `{ is_stale, stale_reason }` via `deriveBlastFreshness(...)` from
  `pull.base/branch/headSha`, the captured provenance, and
  `radius.downstream.length`. Because `getIndexState` never throws, `indexReadable`
  is effectively always true; a `getBlastRadius`-only throw is handled by the catch
  keeping the captured provenance and using `downstreamCount = 0` (⇒ the `empty_map`
  caveat). The best-effort invariant holds (never throw past the facade reads; only
  the 404 throws).
- **Acceptance criteria:**
  - Response carries `indexed_branch`/`indexed_sha` from the index state (null
    only for the synthesised-degraded state: `lastIndexedSha:''`, no
    `indexedBranch`). Provenance SURVIVES a `getBlastRadius`-only throw (it is
    captured before that call) — it is NOT nulled merely because the map failed.
  - `is_stale`/`stale_reason` reflect `deriveBlastFreshness` (empty-map ⇒ caveat;
    non-default base ⇒ diverged; normal PR ⇒ not stale).
  - The workspace-scope 404 is the ONLY throw; a not-indexed/degraded repo still
    returns a valid `BlastResponse` (empty map + `is_stale: true`/`empty_map` when
    the state was readable but the map is empty; not-stale when unreadable).
  - No Drizzle/adapter/SDK import added to `service.ts`; repo-intel still reached
    only via `container.repoIntel.*`.
- **How to test:** `cd server && pnpm test` — extend the blast service unit test
  (it spies the repo class prototype — module-private repo, per INSIGHTS
  2026-06-30): assert provenance passthrough, `empty_map` on an empty downstream,
  `base_diverged` on a non-default `pull.base`, not-stale on a normal PR, and that
  a throwing `getIndexState`/`getBlastRadius` still returns a 200-shaped
  `BlastResponse` (no throw). `pnpm typecheck`. WSL.

### Phase 4 — UI badge + caveat in BlastCard
- **Surface:** client (UI).
- **Disjoint scope:** `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastCard/BlastCard.tsx`;
  `client/messages/en/blast.json`.
- **Depends on:** Phase 1 contract field only (not the server build).
- **Skills to apply:** `react-best-practices` (derive `isStale`/provenance from
  the query data — do NOT mirror into local state), `react-frontend-architecture`,
  `next-best-practices`, `react-testing-library`; strings via next-intl only.
- **What changes & why:** surface the previously-invisible signal. Compose a
  freshness `Badge` (icon+text, `var(--warn)` — WCAG, never color alone) with the
  existing `statusBadge` (S6). Show provenance ("Indexed on {branch} @ {sha}") so
  "0 downstream" is read in context. Critically, when `is_stale` and
  `downstream.length === 0`, render `noDownstreamCaveat` instead of the bare
  `noDownstream` — the TD-003 Minimum. The badge composes with, does not
  duplicate, the build-`status` badge.
- **Acceptance criteria:**
  - `is_stale === true` ⇒ a freshness badge renders (icon + text) with the
    `stale_reason`-appropriate tooltip; `false`/absent ⇒ no freshness badge.
  - Provenance line/tooltip shows `indexed_branch` (+ short `indexed_sha`) when
    present; degrades gracefully to generic copy when absent.
  - Empty map + `is_stale` ⇒ the caveat copy (not the bare "no downstream
    callers") is shown; empty map + not-stale still shows the caveat only if
    `empty_map` fired (which it does whenever the index was readable — so a
    readable empty map always carries the caveat).
  - Build-status badge behavior unchanged; both badges can coexist. No hardcoded
    strings.
- **How to test:** `cd client && pnpm test` — extend `BlastCard.test.tsx`: stub
  `usePrBlast` returning `is_stale: true` + `indexed_branch` ⇒ assert freshness
  badge + provenance present; empty `downstream` + `is_stale` ⇒ assert caveat copy
  (not `noDownstream`); not-stale ⇒ no freshness badge. `pnpm typecheck`. WSL.

### Phase 5 — wrap-up: suites green + insights
- **Surface:** cross-cutting (no source changes beyond fixups).
- **Depends on:** Phases 1–4.
- **What & why:** run `server` + `client` suites green; `engineering-insights`
  sweep to record the durable lessons in `server/INSIGHTS.md`: (a) "blast staleness
  can NOT be `indexedSha !== headSha` — permanently true by design; use provenance
  + empty-map + non-default-base divergence"; (b) "indexed branch is stamped into
  `repo_index_state.stats` (jsonb, no migration) and surfaced via
  `IndexState.indexedBranch` — the truthful provenance vs. re-reading a mutable
  `repos.defaultBranch`."
- **Acceptance:** both suites green; INSIGHTS entries appended (read-before-write,
  append-only).
- **How to test:** `cd server && pnpm test`, `cd client && pnpm test`, both
  `pnpm typecheck`. WSL.

## Risks & mitigations

- **Permanent false-stale (the #1 risk, same class the review-freshness spec
  flagged).** A raw `indexedSha !== headSha` or `prBranch !== indexedBranch`
  comparison is permanently true by design → the badge fires on every PR → users
  learn to ignore it → the confident-wrong case stays invisible (worse than
  today). **Mitigation:** `is_stale` is driven ONLY by (a) the empty-map case and
  (b) a genuine, non-constant divergence (`prBase !== indexedBranch`); SHA
  inequality is explicitly NOT a stale trigger (D2). A unit test asserts a normal
  PR is NOT flagged.
- **Write/read asymmetry on the divergence branch value.** If provenance were
  recorded one way (stamped branch) and the divergence check compared against
  another (`repos.defaultBranch` re-read on read), a default-branch rename would
  make them silently disagree → false stale/fresh. **Mitigation (D3):** the
  `base_diverged` check compares `pull.base` against the SAME `indexedBranch` we
  recorded and surface as provenance — one value, no asymmetry. Legacy rows
  (no stamped branch) SKIP the divergence check (no false alarm), keeping only
  the empty-map caveat.
- **"Empty map best-effort must still never throw."** The freshness computation
  and provenance reads live inside `getBlast`'s existing best-effort `try`; the
  catch branch sets `indexReadable: false` ⇒ not-stale, null provenance. The ONLY
  throw stays the workspace 404. Enforced by a service test that makes the facade
  reads throw and asserts a valid `BlastResponse` still returns.
- **Migration risk — avoided.** Provenance uses the `stats` jsonb column (D3) →
  NO migration, no `pnpm db:generate`/`db:migrate`. (If a reviewer insists on a
  typed column instead, that WOULD require `pnpm db:generate` + MANUAL
  `pnpm db:migrate` — call it out and NEVER auto-apply. The plan recommends
  against it.)
- **Legacy index rows lack `stats.indexedBranch`.** Treated as unknown provenance
  ⇒ generic copy + divergence check skipped; the empty-map caveat still applies.
  Backfilled on the next index/refresh. No false alarm.
- **Advisory-only invariant.** Blast stays advisory (TD-003 §"Why accepted"): this
  adds a caveat, never a gate. No change to severity/auto-review behavior.

## Critical files for implementation

- `server/src/modules/blast/service.ts` — `getBlast` orchestration; where
  provenance + freshness are wired into the best-effort flow (Phase 3).
- `server/src/modules/blast/freshness.ts` — NEW pure helper; the single home of
  the D2 staleness logic (Phase 1).
- `server/src/vendor/shared/contracts/review-api.ts` — `BlastResponse` additive
  fields (Phase 1); then `scripts/sync-shared.mjs`.
- `server/src/modules/repo-intel/repository.ts` — `tryGetIndexState` projection of
  `stats.indexedBranch` (Phase 2) — the sanctioned facade door.
- `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastCard/BlastCard.tsx`
  — the badge + empty-map caveat (Phase 4).

## Open questions / assumptions

- The two design open questions (OQ1 caveat copy, OQ2 suppress-on-reindex) are
  UX-only and do not block or change the contract — see "Confirmed decisions".
- **Assumption:** the pipeline's terminal `stats` object at `safePersist` /
  `upsertIndexState` is the right place to stamp `indexedBranch`, and `repo`
  (carrying `defaultBranch`) is in scope there — verified at
  [full.ts:78](../../server/src/modules/repo-intel/pipeline/full.ts#L78) and
  [incremental.ts:59](../../server/src/modules/repo-intel/pipeline/incremental.ts#L59).
  The implementer should confirm every terminal-write path (partial/no-files/
  degraded early returns also call `safePersist`) stamps it — or accept that
  early-degraded rows carry no branch (treated as legacy-unknown, which is safe).
- **Assumption:** `indexed_sha` = `IndexState.lastIndexedSha`; when the state is
  the synthesised degraded fallback, `lastIndexedSha` is `''` → surface as null.
