# Development Plan: Review-result freshness

> **Umbrella spec.** This file owns the "are the stored review results still
> valid for the current PR head?" problem across ALL derived artifacts. It ships
> in stages:
>
> - **Stage 1 (THIS document, detailed below)** — a richer *freshness key* for
>   `intent` and `risks`, plus a UI hint that they are stale. Replaces the
>   single-input `head_sha` staleness check.
> - **Stage 2 (specced below — L0+L1)** — a commit anchor on each review
>   (`reviews.head_sha`) plus a deterministic per-finding `anchor_status`
>   (`current` / `moved_out` / `orphaned`) computed against the current diff. No
>   LLM, no content re-anchoring (that is L2, future). See "Stage 2 — findings
>   freshness" at the end.
>
> Grow this file as stages are specced; do not split per-stage unless it gets
> unwieldy.

## Context

DevDigest derives several artifacts from a PR and stores them: the **intent**
(`pr_intent`), the **risks** brief (`pr_brief`), and the review **findings**
(`findings`). Each is a point-in-time snapshot computed against some commit, and
each can silently go stale after later commits.

Today the only freshness signal for `intent`/`risks` is a single-input check:
`stored.head_sha !== pull.head_sha`. It is:

1. **Incomplete.** `head_sha` captures only the *code*. The intent/risks output
   also depends on the PR **title**, **body**, the **base** branch, and the
   resolved **feature-model** (`review_intent` / `risk_brief`) and the **prompt**
   itself — none of which move `head_sha`. Editing a PR description on GitHub does
   NOT create a commit, so `head_sha` is unchanged while the correct output
   changed.
2. **Invisible.** `head_sha` is stripped from the API responses as an
   "implementation-only" field (`service.ts` `getIntent`/`getRisks`), so the
   client cannot tell intent/risks are stale. The `IntentCard` always shows an
   unconditional "Recompute" button with no "out of date" hint.
3. **Only wired for intent.** The check runs ONLY as pre-work inside a review run
   (`run-executor.ts`); risks have no automatic check at all.

Stage 1 replaces the `head_sha` check with a **freshness key** — a stable hash of
all the inputs that actually determine the output — stores it next to each
artifact, exposes a derived `is_stale` boolean on the read contracts, and shows a
UI hint when stale. The richer key also makes the existing
recompute-vs-reuse optimization in `run-executor.ts` correct (it now recomputes
when title/body/base/model/prompt change, not only on a new commit).

### Confirmed decisions (do NOT re-litigate)

1. **Linked-issue is EXCLUDED from the freshness key — on both the write and the
   read side.** Including it would force a GitHub call on every `GET
   /pulls/:id/intent|risks` to recompute the current key, and the write/read keys
   must use the SAME inputs or they would never match (permanent false-stale).
   Consequence: editing the linked issue does NOT auto-flag stale; it is caught
   only by a manual Recompute. Document this limitation in the UI/PR body.
   `classifyIntent` still *uses* the issue for the actual classification
   (unchanged) — it just does not feed it into the key.
2. **Prompt version = explicit constants, bumped by hand.** Introduce
   `INTENT_PROMPT_VERSION` and `RISKS_PROMPT_VERSION` in `reviewer-core` next to
   the prompt builders; bump on any prompt change (same discipline as
   `agent.version`). NOT an auto-hash of the prompt template (whitespace-fragile).
3. **Staleness surfaced via fields on the existing read contracts.** Add optional
   `is_stale` (and `stale_reason?`) to `PrIntentRecord` / `PrRisksRecord` — NOT a
   separate `/freshness` endpoint. The client reads it through the same
   `usePrIntent` / `usePrRisks` hooks.
4. **Separate keys for intent and risks.** They have different inputs (intent ←
   title/body/base/headers/model/prompt; risks ← title/body/base/diff/model/prompt
   + the anchored intent). Each artifact stores its own key.

### Resolved 2026-06-26 (the four Stage-1 open questions)

5. **Hash primitive = `node:crypto` `sha256`** over `JSON.stringify(parts)` (in the
   server `freshness.ts` — `reviewer-core` stays pure). Not FNV-1a: a 32-bit
   collision = a false-fresh artifact (correctness bug), not just a cosmetic one.
6. **Stage 1 ships `is_stale` only** — a single opaque hash, compared
   stored-vs-current. `stale_reason` stays an optional contract field but is NOT
   computed yet (computing it would require storing inputs separately/per-field).
7. **`risksKey` folds in `storedIntent.freshnessKey`** — risks anchor on the intent
   (it goes into the prompt), so they go stale when the intent is recomputed.
   Reuses the already-stored intent key; costs one PK read on the risks read-path,
   no network.
8. **`base` (branch name) is in BOTH keys** — catches PR re-targeting. Caveat: it
   does NOT catch the base branch *advancing* (no base SHA is stored — out of scope).

### Scope & non-goals

- **In scope (Stage 1):** the freshness key + storage + `is_stale` on
  intent/risks contracts + the `run-executor` intent gate switch + the UI hint.
- **NOT in scope:** findings freshness (Stage 2, roadmap stub only). Do not touch
  the `findings` table or the smart-diff overlay here.
- **NOT in scope:** the PR-list review status (`deriveReviewStatus`,
  `modules/pulls/status.ts`, `needs_review`/`reviewed`/`stale` derived from
  `lastReviewedSha` vs `head_sha` + age). That is a separate, findings/review-level
  signal and stays exactly as-is. "Freshness key" here is about the DERIVED
  ARTIFACTS, not the PR-level review status.

### Freshness key definition

A stable hash over the ordered list of inputs that determine the artifact
(linked-issue excluded per decision #1):

```
intentKey = sha256(JSON.stringify([
  pull.headSha, pull.base, pull.title, pull.body ?? '',
  intentModel.provider, intentModel.model,        // resolveFeatureModel('review_intent')
  INTENT_PROMPT_VERSION,
]))

risksKey  = sha256(JSON.stringify([
  pull.headSha, pull.base, pull.title, pull.body ?? '',
  risksModel.provider, risksModel.model,          // resolveFeatureModel('risk_brief')
  RISKS_PROMPT_VERSION,
  storedIntent?.freshnessKey ?? '',               // risks anchor on the intent → stale when its key changes
]))
```

`is_stale := storedKey != null && storedKey !== currentKey`. When `storedKey` is
null (legacy/pre-migration rows) treat as NOT stale (no false alarm; recompute on
next review fills it). The current key is computed with NO network call: every
input is on the `pull` row, a cheap settings read, or (for risks) the stored
intent's key — no network.

## Affected packages & files

**reviewer-core/** (PURE — versions describe the pure prompt; no I/O):
- `reviewer-core/src/intent/classify-prompt.ts` — EDIT (additive). Export
  `export const INTENT_PROMPT_VERSION = 1;` (bump on prompt change).
- `reviewer-core/src/risks/risks-prompt.ts` — EDIT (additive). Export
  `export const RISKS_PROMPT_VERSION = 1;`.
- `reviewer-core/src/index.ts` — EDIT (additive). Re-export both constants.

**server/** (the freshness key is an application/caching concern, NOT review
domain logic — so the hash lives in the server, keeping `reviewer-core` pure):
- `server/src/modules/reviews/freshness.ts` — NEW. Pure helpers
  `intentFreshnessKey(parts)` / `risksFreshnessKey(parts)` (assemble + `sha256`
  via `node:crypto`). Take already-resolved primitives (head/base/title/body/
  provider/model/version) as args — NO container, NO DB, NO GitHub — so they
  unit-test trivially. The SERVICE gathers the inputs and calls these.
- `server/src/modules/reviews/intent-service.ts` — EDIT. Compute `intentKey` from
  the inputs it already has and pass it to `repo.upsertIntent(..., key)`.
- `server/src/modules/reviews/risks-service.ts` — EDIT. Same for `risksKey` →
  `repo.upsertRisks(..., key)`.
- `server/src/modules/reviews/service.ts` — EDIT. `getIntent`/`getRisks` compute
  the *current* key and set `is_stale` on the returned record.
- `server/src/modules/reviews/run-executor.ts` — EDIT. Swap the intent gate from
  `stored.headSha !== pull.headSha` to `storedKey !== currentIntentKey`.
- `server/src/modules/reviews/repository/pull.repo.ts` — EDIT (additive). Persist
  + return `freshnessKey` in `upsertIntent`/`getIntent`/`upsertRisks`/`getRisks`
  (extend `IntentWithMeta`/`RisksWithMeta`).
- `server/src/modules/reviews/repository.ts` — EDIT (additive). Propagate the new
  arg/return through the `ReviewRepository` delegation wrappers + type re-exports.
- `server/src/db/schema/reviews.ts` — EDIT (additive). Add nullable
  `freshnessKey: text('freshness_key')` to `prIntent` and `prBrief` (keep the
  existing `headSha` column for debug/back-compat).
- `server/src/db/migrations/<generated>` — NEW (`pnpm db:generate`; MANUAL apply
  only — NEVER run `pnpm db:migrate` from the agent).

**`@devdigest/shared` contracts** (extend with NEW content; never edit the barrel):
- `server/src/vendor/shared/contracts/review-api.ts` — EDIT (additive). Add
  optional `is_stale: z.boolean().optional()` (and `stale_reason: z.string().optional()`)
  to `PrIntentRecord` and `PrRisksRecord`. Then `node scripts/sync-shared.mjs` to
  mirror into `client/src/vendor/shared`.

**client/** (UI hint):
- `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/IntentCard.tsx`
  — EDIT. When `intent.is_stale` or `risksRecord.is_stale`, render an "Outdated"
  badge next to the Recompute button. No new hook (the fields ride on the existing
  `usePrIntent`/`usePrRisks` queries).
- `client/messages/en/brief.json` — EDIT (additive). New keys e.g. `staleBadge`
  ("Outdated — recompute recommended"), `staleTooltip` (explains the linked-issue
  caveat).

**Reuse (do NOT re-implement):**
- `resolveFeatureModel(container, workspaceId, id)` — `modules/settings/feature-models.ts:51`.
- `upsertIntent`/`getIntent`/`upsertRisks`/`getRisks` — `repository/pull.repo.ts:56,85,106,124`.
- `usePrIntent`/`usePrRisks` hooks — `client/src/lib/hooks/reviews.ts:172,192`.
- The intent gate precedent — `run-executor.ts:114-145`.

## Shared scaffold (context pack — verbatim, do not re-open the sources)

### S1 — current `pr_intent` / `pr_brief` schema (Stage 1 adds `freshness_key`)
`server/src/db/schema/reviews.ts` (both already carry the nullable `head_sha`):
```ts
export const prIntent = pgTable('pr_intent', {
  prId: uuid('pr_id').primaryKey().references(() => pullRequests.id, { onDelete: 'cascade' }),
  intent: text('intent').notNull(),
  inScope: jsonb('in_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  outOfScope: jsonb('out_of_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  headSha: text('head_sha'),                 // keep; ADD: freshnessKey: text('freshness_key')
});
export const prBrief = pgTable('pr_brief', {
  prId: uuid('pr_id').primaryKey().references(() => pullRequests.id, { onDelete: 'cascade' }),
  json: jsonb('json').notNull(),
  headSha: text('head_sha'),                 // keep; ADD: freshnessKey: text('freshness_key')
});
```

### S2 — repository funcs to extend (intent shown; risks is the parallel)
`server/src/modules/reviews/repository/pull.repo.ts:56-99` (today):
```ts
export async function upsertIntent(db, prId, intent: Intent, headSha?: string): Promise<void> { /* …onConflictDoUpdate… */ }
export type IntentWithMeta = Intent & { headSha: string | null };
export async function getIntent(db, prId): Promise<IntentWithMeta | undefined> {
  const [row] = await db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
  if (!row) return undefined;
  return { intent: row.intent, in_scope: row.inScope, out_of_scope: row.outOfScope, headSha: row.headSha ?? null };
}
```
Stage-1 variant: add a `freshnessKey?: string` write arg (stored alongside
`headSha`), and return `freshnessKey: row.freshnessKey ?? null` on
`IntentWithMeta`/`RisksWithMeta`.

### S3 — the intent gate to switch (run-executor pre-work)
`server/src/modules/reviews/run-executor.ts:116-118` (today):
```ts
const stored = await this.repo.getIntent(pull.id);
const stale = !stored || stored.headSha !== pull.headSha;
```
Stage-1: `const currentKey = intentFreshnessKey({ headSha: pull.headSha, base: pull.base, title: pull.title, body: pull.body ?? '', provider, model, promptVersion: INTENT_PROMPT_VERSION });`
then `const stale = !stored || stored.freshnessKey == null || stored.freshnessKey !== currentKey;`
(`provider`/`model` from `resolveFeatureModel(container, workspaceId, 'review_intent')`).

### S4 — service read shape to augment (omit headSha; ADD is_stale)
`server/src/modules/reviews/service.ts:196-209` (today `getIntent`):
```ts
const stored = await this.repo.getIntent(prId);
if (!stored) return null;
return { pr_id: prId, intent: stored.intent, in_scope: stored.in_scope, out_of_scope: stored.out_of_scope };
```
Stage-1: compute `currentKey` (no network) and return
`{ ...same, is_stale: stored.freshnessKey != null && stored.freshnessKey !== currentKey }`.
`getRisks` (`service.ts:242-250`) mirrors this for `risksKey`.

### S5 — write-time persistence already has all inputs (no extra calls)
`server/src/modules/reviews/intent-service.ts:78-94` already resolves the model and
has the diff/title/body; compute the key there and pass it to upsert:
```ts
const { provider, model } = await resolveFeatureModel(container, workspaceId, 'review_intent');
// …completeStructured…
await repo.upsertIntent(pull.id, res.data, pull.headSha,
  intentFreshnessKey({ headSha: pull.headSha, base: pull.base, title: pull.title, body: pull.body ?? '', provider, model, promptVersion: INTENT_PROMPT_VERSION }));
```
`risks-service.ts:58-69` is the parallel (`'risk_brief'`, `RISKS_PROMPT_VERSION`),
and ALSO passes `storedIntent?.freshnessKey ?? ''` into `risksFreshnessKey` (it
already reads the stored intent to anchor the prompt — no extra call).

### S6 — contract extension (review-api.ts)
`PrIntentRecord = Intent.extend({ pr_id: z.string() })` / `PrRisksRecord =
Risks.extend({ pr_id: z.string() })` today. Add:
```ts
.extend({ pr_id: z.string(), is_stale: z.boolean().optional(), stale_reason: z.string().optional() })
```
Optional so older callers/tests stay valid; the client treats missing as `false`.

### S7 — IntentCard seam for the badge
`IntentCard.tsx:70-73,141` — already reads `usePrIntent`/`usePrRisks`. Add a
derived `const isStale = !!(intent?.is_stale || risksRecord?.is_stale);` and, when
true, render a `Badge` (icon `AlertTriangle`, `var(--warn)`) before/with the
existing `recomputeButton`. Strings via `brief.json` + next-intl.

## Phases

> **Dependency order:** Phase 1 (core constants + pure key util + contract) has no
> deps. Phase 2 (schema/migration + repo) depends on nothing but is the data seam.
> Phase 3 (service + run-executor) depends on Phases 1 + 2. Phase 4 (UI) depends on
> the Phase 1 contract field only (not the server build). Phase 5 (tests) follows.

### Phase 1 — core versions, pure key util, contract field
- **Surface:** reviewer-core (PURE) + server util + shared contract.
- **Disjoint scope:** `classify-prompt.ts` / `risks-prompt.ts` / `index.ts`
  (version consts); `modules/reviews/freshness.ts` (NEW pure hash); `review-api.ts`
  (`is_stale`/`stale_reason`) + `scripts/sync-shared.mjs`.
- **Depends on:** none.
- **Skills to apply:** `onion-architecture` (reviewer-core stays PURE — versions
  are data, no I/O; the hash lives in the server app layer, takes primitives, no
  container/DB), `zod` (additive optional fields; parse-don't-validate), `typescript-expert`.
- **What & why:** version constants give the prompt a bumpable identity (decision
  #2). `freshness.ts` centralizes the key so write-path, read-path and run-executor
  all hash identically (one definition ⇒ no drift). Contract fields expose
  staleness (decision #3).
- **Acceptance:** `intentFreshnessKey(parts)` is deterministic and order-sensitive;
  changing ANY part changes the hash; identical parts ⇒ identical hash.
  `PrIntentRecord.safeParse({ pr_id, intent, in_scope, out_of_scope })` still
  succeeds (fields optional); parsing with `is_stale: true` succeeds.
  `reviewer-core` imports nothing from `server`.
- **How to test:** `cd reviewer-core && pnpm test` (consts exported); a server unit
  test for `freshness.ts` (determinism, per-part sensitivity, exclusion of issue);
  a zod unit test for the optional fields; `pnpm typecheck` both packages.

### Phase 2 — schema column + MANUAL migration + repository
- **Surface:** server schema + data access.
- **Disjoint scope:** `db/schema/reviews.ts` (add `freshnessKey` to `prIntent` &
  `prBrief`); `db/migrations/<generated>` (NEW, generate only);
  `repository/pull.repo.ts` + `repository.ts` (thread the key through
  upsert/get + `IntentWithMeta`/`RisksWithMeta`).
- **Depends on:** none (parallel with Phase 1).
- **Skills to apply:** `drizzle-orm-patterns` (column add, `onConflictDoUpdate`
  set), `postgresql-table-design` (nullable text, no default needed),
  `onion-architecture` (DB access ONLY here — rule 4).
- **What & why:** nullable `freshness_key` (legacy rows = NULL = treated not-stale).
  Keep `head_sha` for debugging/back-compat. New column ⇒ its own migration
  (server convention).
- **Acceptance:** `upsertIntent`/`upsertRisks` accept + persist `freshnessKey`;
  `getIntent`/`getRisks` return it (`string | null`); round-trip preserves it. A
  new migration file adds `freshness_key text` (nullable) to both tables and is NOT
  applied.
- **How to test:** `*.it.test.ts` round-trip (store key → read back) for both
  tables; `pnpm typecheck`. PR body: `pnpm db:migrate` MUST be run MANUALLY.

### Phase 3 — service exposes is_stale + run-executor gate switch
- **Surface:** server application services.
- **Disjoint scope:** `intent-service.ts` / `risks-service.ts` (compute + persist
  key at write time), `service.ts` (`getIntent`/`getRisks` compute current key →
  `is_stale`), `run-executor.ts` (intent gate uses the key).
- **Depends on:** Phases 1 + 2.
- **Skills to apply:** `onion-architecture` (services orchestrate; resolve model
  via `resolveFeatureModel`, hash via `freshness.ts`, persist via `repo.*`; NO
  Drizzle/Octokit here — rules 2/4/6), `zod`.
- **What & why:** write-path stamps the key with zero extra calls (inputs already
  resolved — S5). Read-path computes the current key with no network (S4) and sets
  `is_stale`. `run-executor` recompute-vs-reuse now reacts to title/body/base/model/
  prompt, not only a new commit (S3) — and still reuses when nothing material
  changed (cost guard preserved). For risks, the key folds in the stored intent's
  `freshnessKey`, so BOTH `analyzeRisks` (write) and `getRisks` (read) read the
  stored intent (one PK lookup) — i.e. `getRisks` now depends on `getIntent`.
- **Acceptance:** after `recomputeIntent`, `getIntent` returns `is_stale:false`;
  after mutating `pull.title` (no head move) the stored key differs from the current
  key ⇒ `getIntent` returns `is_stale:true`. `run-executor` skips the LLM when the
  key matches and recomputes when it differs (assert via the existing
  run-executor-intent test, updated). No Drizzle import in `service.ts`/`*-service.ts`.
- **How to test:** `cd server && pnpm test` — update `intent-service.test.ts`,
  `risks-service.test.ts`, `run-executor-intent.test.ts` (they currently assert
  `headSha` behavior → assert key behavior); add a `getIntent`/`getRisks`
  `is_stale` unit test (fresh vs title-changed vs model-changed).

### Phase 4 — UI hint in IntentCard
- **Surface:** client (UI).
- **Disjoint scope:** `IntentCard.tsx` (stale badge), `messages/en/brief.json`
  (new keys).
- **Depends on:** Phase 1 contract field (not the server build).
- **Skills to apply:** `react-best-practices` (derive `isStale` from query data —
  don't mirror into local state), `react-frontend-architecture`,
  `react-testing-library`, `next-best-practices`.
- **What & why:** surface the previously-invisible staleness next to the Recompute
  button (S7). Tooltip documents the linked-issue caveat (decision #1) so users
  know an issue edit won't auto-flag.
- **Acceptance:** when `is_stale` is true on either record, an "Outdated" badge
  renders; when both false/absent, no badge. Recompute still works; after success
  the refetched record clears the badge. No hardcoded strings.
- **How to test:** `cd client && pnpm test` — extend `IntentCard.test.tsx`: stub
  `usePrIntent` with `is_stale:true` → assert badge present; `false`/absent →
  absent; `pnpm typecheck`.

### Phase 5 — wrap-up: tests green + insights
- Run all three suites green (`reviewer-core`, `server`, `client`).
- `engineering-insights` sweep: record the "head_sha is an incomplete freshness
  key; hash all output-determining inputs; linked-issue deliberately excluded for
  read-path cost" lesson in `server/INSIGHTS.md`.

## Risks & mitigations
- **Write/read key asymmetry ⇒ permanent false-stale.** The single most likely
  bug. Mitigation: ONE `freshness.ts` helper used by write, read, and
  run-executor; a unit test asserts the same inputs produce the same key across all
  three call sites. For risks specifically, BOTH the write (`analyzeRisks`) and read
  (`getRisks`) sites must feed the stored intent's key into the helper, or risks
  would be permanently stale.
- **Migration must not auto-apply.** `pnpm db:generate` only; MANUAL `pnpm
  db:migrate`; call out in the PR body (server gotcha: `relation … does not exist`
  ⇒ migration not run).
- **Legacy NULL keys.** Treat `freshnessKey == null` as NOT stale (no false alarm);
  the next review/recompute backfills it.
- **`body`/`title` freshness.** The current key uses the persisted `pull` row;
  `pulls` are refreshed by list-sync/poll (`upsertImportedPulls`) and detail open
  (`getDetail` `updateDetail` for body). Stale-detection is therefore only as fresh
  as the last sync — acceptable; note it.
- **Onion leak.** The hash uses `node:crypto` and lives in the SERVER layer, never
  in `reviewer-core` (which stays pure — only the version *constants* live there).

## Open questions / assumptions

All four Stage-1 open questions are RESOLVED — see "Resolved 2026-06-26" under
Confirmed decisions (sha256; `is_stale` only; `risksKey` ⊇ `intent.freshnessKey`;
`base` in the key). No Stage-1 open questions remain; the plan is implementation-ready.

---

## Stage 2 — findings freshness (L0+L1)

### Context

`findings` rows carry `file` + `start_line` + `end_line` but **NO commit anchor**
(`reviews` has no `head_sha`), so after later commits there is no per-finding
actuality signal. The smart-diff overlay maps the latest review's findings onto the
CURRENT diff by line NUMBER, with no SHA/content check — so:
- a finding on a **deleted file** silently drops from the overlay but lingers in
  run history with a stale `file:line`;
- a finding whose **lines changed** mis-anchors onto unrelated code (number match,
  not content);
- a finding whose **problem was fixed** stays "open" until a human dismisses it or a
  new review runs.

Stage 2 ships **L0 + L1**:
- **L0** — stamp each `review` with the `head_sha` it ran against (the missing
  anchor).
- **L1** — derive a per-finding `anchor_status` (`current` / `moved_out` /
  `orphaned`) against the CURRENT diff, deterministically, no LLM. Make the silent
  drop and the without-warning mis-anchor EXPLICIT in the UI.

**Key insight (drives the design):** L1 is the **grounding predicate run against the
current diff**. Grounding (`reviewer-core` `groundFindings`) keeps a finding only if
its `file:line` intersects a real hunk of the diff it was reviewed against; the
server diff-parser already records `hunk.newLineNumbers` "exactly what the
citation-grounding gate needs" (`lib/diff-parser.ts:5-7`). L1 re-applies the SAME
"does this finding intersect a hunk?" check against the CURRENT diff. Same predicate,
later diff → reuse it, don't reinvent.

### What L1 does and does NOT do

- DOES catch deterministically: file gone (`orphaned`), the finding's lines no
  longer present in the current diff (`moved_out`).
- Does NOT verify **content**: when the line numbers still intersect a hunk, L1
  reports `current` even though the code at those lines may have changed (a residual
  mis-anchor). Eliminating that is **L2** (content re-anchoring) — explicitly a
  future stage, NOT Stage 2.

### Confirmed decisions

1. **Anchor = `reviews.head_sha`** (nullable `text`), stamped in `insertReview`
   from `pull.headSha` (run-executor already has it). One review = one diff = one
   head; no need for a per-finding column. Legacy rows (NULL) ⇒ treat findings as
   `current` (no retroactive noise).
2. **`anchor_status: 'current' | 'moved_out' | 'orphaned'`**, DERIVED on read (never
   a stored mutable status), exposed on the finding **read** contract `FindingRecord`
   — NOT on the LLM-output schema `Finding` (the model must not emit it). Missing ⇒
   client treats as `current`.
3. **Pure classifier in `reviewer-core`**, reusing the grounding hunk-intersection
   predicate; the server orchestrates (loads the current diff via `diffFromPrFiles`
   — NO network — and annotates the DTOs). DB access stays in the repository.
4. **Fast path:** when `review.head_sha === pull.head_sha`, every finding of that
   review is `current` — skip diff work entirely.
5. **Full-file kinds** (`secret_leak`, `phantom`, `lethal_trifecta`, `hook`) are
   never `moved_out` — only `orphaned` (file gone) or `current` (the grounding
   invariant: full-file kinds need only the file to exist).
6. **No auto-mutation.** `anchor_status` is advisory/derived; we never auto-dismiss.
   Remediation stays manual dismiss OR re-run review (which already produces fresh
   findings; stale ones remain in history).
7. **UI makes staleness explicit** (the actual fix for the silent-drop / mis-anchor):
   - FindingsTab / FindingCard: a badge for `moved_out` ("Outdated — code changed")
     and `orphaned` ("Orphaned — file removed").
   - Smart-diff overlay: tint/tag ONLY `current` findings; collect `moved_out` +
     `orphaned` into a dedicated "Outdated findings" list (mirrors the
     `OutdatedComments` pattern) instead of silently dropping / mis-anchoring them.

### Algorithm (per finding, against the current diff)

```
status(finding, review, pull, currentDiff):
  if review.head_sha == null:            return 'current'      # legacy, no anchor
  if review.head_sha == pull.head_sha:   return 'current'      # fast path
  fileEntry = currentDiff.files.find(f => f.path === finding.file)
  if !fileEntry:                         return 'orphaned'     # file gone from diff
  if isFullFileKind(finding.kind):       return 'current'      # file exists; no line anchor
  covered = union(h.newLineNumbers for h in fileEntry.hunks)
  hit = any(line in covered for line in [finding.start_line .. finding.end_line])
  return hit ? 'current' : 'moved_out'
```
`currentDiff` = `diffFromPrFiles(repo, pull.id)` (parse of stored `pr_files`
patches — no network); computed ONCE per PR read, reused across findings.

### Affected packages & files

**reviewer-core/** (PURE — diff is an input):
- `reviewer-core/src/grounding.ts` (or a new `anchor.ts`) — EXPORT a pure
  `anchorStatus(finding, diff): 'current' | 'moved_out' | 'orphaned'` reusing the
  existing hunk-intersection predicate. `index.ts` re-export.

**server/**:
- `server/src/db/schema/reviews.ts` — EDIT (additive). `headSha: text('head_sha')`
  on `reviews` (nullable).
- `server/src/db/migrations/<generated>` — NEW (`pnpm db:generate`; MANUAL apply).
- `server/src/modules/reviews/repository/review.repo.ts` — EDIT. Add `headSha` to
  the `insertReview` values (+ its param type); `ReviewRow` picks the column up
  automatically.
- `server/src/modules/reviews/run-executor.ts` — EDIT (one line). Pass
  `headSha: pull.headSha` into `insertReview` (`run-executor.ts:299-309`).
- `server/src/modules/reviews/service.ts` + `helpers.ts` — EDIT. In `reviewsForPull`,
  load `diffFromPrFiles` once, then annotate each DTO finding with `anchor_status`
  (new optional field on `ReviewDtoFinding`). Use the per-review head fast-path.
- `server/src/modules/smart-diff/service.ts` — EDIT. Build the overlay's
  `findingsByPath` from `current` findings only (skip `moved_out`/`orphaned`), so no
  phantom tints; the segregated list is surfaced client-side via `anchor_status`.

**`@devdigest/shared` contracts** (additive; never edit the barrel):
- `server/src/vendor/shared/contracts/review-api.ts` (or `findings.ts`) — add
  optional `anchor_status` to the finding **read** contract `FindingRecord`. Then
  `node scripts/sync-shared.mjs`.

**client/**:
- `FindingCard.tsx` / `FindingsTab.tsx` — render the `moved_out`/`orphaned` badge.
- `SmartDiffViewer/helpers.ts` (`buildSeverityOverlay`, `tagSeverityByLine`,
  `findingsByStartLine`) — EDIT: only `current` findings tint/tag; gather
  `moved_out`+`orphaned` for the new section.
- `SmartDiffViewer.tsx` — render an "Outdated findings" list per file/group.
- `messages/en/shell.json` / `prReview.json` — new badge/section strings.

### Shared scaffold (verbatim)

`lib/diff-parser.ts:46-78` already yields per-hunk new-side line numbers — the L1
substrate:
```ts
hunk = { file, oldStart, oldLines, newStart, newLines, newLineNumbers: [] };
// '+' line  → newLineNumbers.push(cursor); cursor++
// context   → newLineNumbers.push(cursor); cursor++
// '-' line  → no new-side line consumed
```
`diffFromPrFiles(repo, prId)` (`diff-loader.ts:33-44`) reconstructs the current
`UnifiedDiff` from `pr_files` with NO network. `insertReview` (`review.repo.ts:11-27`)
gains `headSha`. `findingRowToDto` (`reviews/helpers.ts:34-53`) gains an
`anchor_status` field (defaulted by the annotating step). `FindingKind`
(`findings.ts:17-23`) lists the full-file kinds for decision #5.

### Phases

> **Order:** Phase 1 (schema + stamp) and Phase 2 (pure classifier + contract) are
> independent. Phase 3 (server annotation) depends on 1 + 2. Phase 4 (UI) depends on
> the Phase 2 contract field. Phase 5 = tests + insights.

#### Phase 1 — `reviews.head_sha` column + stamp it
- **Surface:** server schema + data access + run-executor.
- **Disjoint scope:** `db/schema/reviews.ts`, `db/migrations/<generated>`,
  `repository/review.repo.ts` (`insertReview`), `run-executor.ts` (one line).
- **Skills:** `drizzle-orm-patterns`, `postgresql-table-design`, `onion-architecture`.
- **What & why:** the missing anchor. Nullable so historic reviews stay valid (→
  treated `current`). New column ⇒ its own migration (generate only; MANUAL apply).
- **Acceptance:** new reviews persist `head_sha = pull.head_sha`; `ReviewRow`
  includes it; migration adds `reviews.head_sha text` nullable and is NOT applied.
- **How to test:** an `*.it.test.ts` asserting a run stamps the head; `pnpm typecheck`.

#### Phase 2 — pure `anchorStatus` + contract field
- **Surface:** reviewer-core (PURE) + shared contract.
- **Disjoint scope:** `reviewer-core/src/grounding.ts`|`anchor.ts` + `index.ts`;
  `review-api.ts` (`anchor_status` on `FindingRecord`) + `sync-shared.mjs`.
- **Skills:** `onion-architecture` (stays pure; diff is input — reuse grounding),
  `zod`, `typescript-expert`.
- **What & why:** one predicate, reused from grounding (decision #3). Contract field
  is optional (decision #2).
- **Acceptance:** `anchorStatus` returns `orphaned` (file absent), `moved_out`
  (file present, range not in any hunk's `newLineNumbers`), `current` (range hits a
  hunk, or full-file kind with file present). `reviewer-core` imports nothing from
  `server`. `FindingRecord.safeParse` still passes without `anchor_status`.
- **How to test:** `cd reviewer-core && pnpm test` — unit table over the three
  statuses + a full-file-kind case; a zod test for the optional field.

#### Phase 3 — server annotates findings (reviewsForPull + smart-diff)
- **Surface:** server services.
- **Disjoint scope:** `reviews/service.ts` + `reviews/helpers.ts` (annotate DTOs),
  `smart-diff/service.ts` (overlay from `current` only).
- **Depends on:** Phases 1 + 2.
- **Skills:** `onion-architecture` (diff via `diffFromPrFiles` through the repo
  facade; classifier is pure; no Drizzle in the service), `fastify-best-practices`.
- **What & why:** annotate each finding with `anchor_status` using the current diff
  (loaded once) + the per-review head fast-path. Smart-diff builds `finding_lines`
  from `current` findings so `moved_out` no longer produces phantom tints; the
  segregated findings reach the client via `anchor_status`.
- **Acceptance:** after a head move, a finding on a removed file → `orphaned`; on a
  removed line-range → `moved_out`; on an untouched range → `current`. Head
  unchanged → all `current` with no diff parse. No Drizzle import in the services.
- **How to test:** `cd server && pnpm test` — service unit tests with crafted
  pr_files/findings covering all three statuses + fast-path; a smart-diff test that
  `moved_out` lines are excluded from `finding_lines`.

#### Phase 4 — UI: badges + "Outdated findings" section
- **Surface:** client (UI).
- **Disjoint scope:** `FindingCard.tsx`, `FindingsTab.tsx`,
  `SmartDiffViewer/helpers.ts` + `SmartDiffViewer.tsx`, i18n JSON.
- **Depends on:** Phase 2 contract field.
- **Skills:** `react-best-practices` (derive from the finding's `anchor_status`,
  don't store), `react-frontend-architecture`, `react-testing-library`.
- **What & why (concrete visualization, confirmed 2026-06-27):** the actual fix for
  the silent drop / mis-anchor — make stale findings VISIBLE and correctly NOT
  mis-tinted (decision #7).
  - **Badge on `FindingCard`** (next to severity): `current` → no badge;
    `moved_out` → `Badge` `var(--warn)`/`var(--warn-bg)`, label "Outdated", title
    "The line this finding pointed to changed after the review — re-run to refresh";
    `orphaned` → `Badge` `var(--stale)`/`var(--text-muted)`, label "File removed",
    title "This file is no longer in the PR diff". Icon `AlertTriangle` (verified
    present) for both — distinguished by color + label (WCAG: never color alone);
    swap to a more specific verified icon if desired.
  - **Smart-diff:** only `current` findings tint lines / show inline tags. ONE
    PR-level "Outdated findings" section at the bottom of `SmartDiffViewer`, grouped
    by file, listing `moved_out` + `orphaned` as compact `FindingCard`s — styled
    like the existing `OutdatedComments` footer (`comments.ts` `outdatedWrap`/
    `outdatedTitle`). PR-level (NOT per-file) because an `orphaned` finding has no
    `FileRow` to live under.
  - **Agent-runs tab:** do NOT change the tab's numeric badge (= all findings).
    Instead show a quiet "N outdated" chip in the "Review runs" `SectionLabel`
    right-slot when any finding is stale. Stale findings still count in totals /
    severity tallies (they are not dismissed).
  - i18n under `shell.json` `diffViewer` (parallel to the existing
    `outdatedTitle: "{count} comment(s) on older revisions"`).
- **Acceptance:** `moved_out`/`orphaned` findings render a badge and appear in the
  "Outdated findings" list; only `current` findings tint/tag diff lines; `current`
  (or missing status) behaves exactly as today.
- **How to test:** `cd client && pnpm test` — RTL: stub findings with each status →
  assert badge + section placement + that a `moved_out` line is not tinted.

#### Phase 5 — wrap-up
- All three suites green; `engineering-insights` records the L0+L1 design (anchor =
  `reviews.head_sha`; L1 = grounding predicate vs the current diff; L2 content
  re-anchoring deferred).

### Risks & mitigations
- **L1 reports `current` on a content-changed-but-same-line finding.** Known,
  accepted limitation (that is L2). Mitigation: document it in the UI copy
  ("anchor still present; content not re-verified") and the spec; do not over-claim.
- **`diffFromPrFiles` reflects only the last-synced `pr_files`.** Staleness is as
  fresh as the last detail open / poll — acceptable; note it.
- **Cost on `reviewsForPull`.** Parse the diff ONCE per PR read, skip entirely via
  the head fast-path; per-finding work is a set lookup. No network.
- **Don't pollute the LLM `Finding` schema.** `anchor_status` lives ONLY on the read
  contract `FindingRecord`, never on `Finding` (which is also the structured-output
  schema).

### Resolved (Stage 2) — 2026-06-27
- **PR-list FINDINGS counter — UNCHANGED (non-goal).** The severity tally in the PR
  list (`findingSeverityRows` → `findingCountsByPr` → `toPrMeta`,
  `review.repo.ts:105-121`) stays the total non-dismissed-findings count with NO
  `anchor_status` awareness. Rationale: list-level staleness is already carried by
  the STATUS column (`deriveReviewStatus`: `needs_review`/`stale` when head moved),
  and computing L1 per listed PR would add a diff-parse on the list's hot rollup
  path. Do NOT touch `findingSeverityRows`. (A cheap L0 "live-only" SQL filter —
  count only findings whose `review.head_sha = pull.head_sha` — or a precise L1
  exclusion are possible FUTURE follow-ups, explicitly out of Stage 2.)
- **Persist vs derive `anchor_status`:** DERIVE on read (decision #2). The status
  depends on the moving current diff + `pull.head_sha`, so a stored value would
  itself go stale and need invalidation on every head move / `pr_files` refresh. We
  persist the immutable INPUT (`reviews.head_sha`) and derive the volatile verdict.
  (Persist would only win if the status were expensive — L3 — or needed in
  cross-PR SQL filters; neither applies to the per-PR detail view.)
- **L2 re-anchoring** (content-aware line re-pointing + content-change detection):
  OUT of Stage 2 — deferred to **Stage 2b**, now SPECCED & IMPLEMENTED as **Issue #3**
  in [docs/specs/l03-issues.md](./l03-issues.md): deterministic, no LLM — the server
  stamps a per-finding `anchor_fingerprint` = `sha256` of the new-side anchored text
  (pure `anchoredText` extractor in reviewer-core), and on read a fingerprint mismatch
  while the line anchor still intersects ⇒ the new `content_changed` status.
- **Visualization** (badge copy/icons, the PR-level "Outdated findings" section, the
  Agent-runs "N outdated" chip): locked — see Phase 4 above.

No Stage-2 open questions remain; the plan is implementation-ready.
