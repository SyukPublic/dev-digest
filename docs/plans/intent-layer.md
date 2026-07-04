# Development Plan: Intent Layer

## Context

A cheap-LLM "intent classifier" derives a PR's intent into a structured shape
`{ intent, in_scope[], out_of_scope[] }` from the PR's motivation (title + body +
inline plan/spec + linked GitHub issue) plus the changed-file list (paths + hunk
headers only — **NO patch bodies**). The derived intent is stored per-PR
(`pr_intent`), auto-computed as a step of the review pipeline when missing or
stale, recomputable via a UI button, injected into every review agent's prompt
with a rule ("don't comment outside intent; if you see a serious problem out of
scope, emit ONE signal finding, not twenty"), and shown as an Intent card on the
PR detail page. The classify step logs how many tokens were saved by omitting
patch bodies.

All the persistence and contract scaffolding already exists empty (the `pr_intent`
table, the `Intent` / `PrIntentRecord` Zod contracts, `upsertIntent` / `getIntent`
repo functions, the `review_intent` feature-model registry entry). This plan wires
the **missing** behavior: the classifier service, run-executor integration, prompt
injection, the token-savings metric, the API routes, the client card, and the
cheap-model default flip.

### Confirmed product decisions (do not re-litigate)
1. SCOPE: exactly `{ intent, in_scope[], out_of_scope[] }`. No `risk_areas` field
   (that is the separate `pr_brief` feature).
2. PLAN SOURCES: PR title + body (a plan/spec may be inline in the body) + the
   linked GitHub issue (title + body), resolved via the existing
   `closes|fixes|resolves #N` regex. NO external URL fetching. With no doc/issue,
   the classifier still infers intent from implicit signals (title, body, files).
3. TRIGGER: auto-compute as a review-pipeline step when intent is missing OR stale
   (head moved since intent was computed), PLUS a manual "Recompute" button.
   `upsertIntent` already does `ON CONFLICT … UPDATE`.
4. CHEAP MODEL: flip the `review_intent` default from `openai/gpt-4.1` to
   `openrouter` / `deepseek/deepseek-v4-flash` in BOTH registries. A workspace
   override must still win.

## Affected packages & files

**reviewer-core/** (PURE — prompt text, serialization, formatting; no I/O):
- `reviewer-core/src/intent/classify-prompt.ts` — NEW. Pure builders:
  `buildIntentMessages(input)` → `ChatMessage[]` (system + user, untrusted blocks
  wrapped), `serializeChangedFiles(diff)` → hunk-headers-only string (NO patch
  bodies), and the exported `IntentSchema` re-use + `INTENT_RULE` constant (the
  "don't comment outside intent / one signal finding" text injected into review).
- `reviewer-core/src/prompt.ts` — EDIT. Add optional `intent?: string` slot to
  `PromptParts`; render a `## PR intent` section (wrapped via `wrapUntrusted`,
  intent is LLM-derived/untrusted) and add `intent` to `PromptAssembly`.
- `reviewer-core/src/index.ts` — EDIT. Export the new intent builders/constants.

**server/** (I/O — LLM call orchestration, persistence, GitHub, wiring):
- `server/src/modules/reviews/intent-service.ts` — NEW. `classifyIntent(...)`:
  resolve feature model → `container.llm(provider)` → `completeStructured<Intent>`
  → compute token-savings → persist via `repo.upsertIntent`. Pure-prompt building
  is delegated to reviewer-core.
- `server/src/modules/reviews/run-executor.ts` — EDIT. Between `loadDiff`
  (line ~97) and the agent for-loop (line ~107): compute-if-missing-or-stale,
  then read intent and pass it into `runOneAgent` → `assemblePrompt`. Add `intent`
  to `sectionTokens()` (line ~441) and record `intent_tokens_saved`.
- `server/src/modules/reviews/repository.ts` — EDIT (only if a `head_sha` column
  is added — see Phase 1 decision). Reuse existing `upsertIntent`/`getIntent`
  wrappers (lines 148–154) otherwise.
- `server/src/modules/reviews/routes.ts` — EDIT. Add `GET /pulls/:id/intent` and
  `POST /pulls/:id/intent/recompute`, delegating to the service.
- `server/src/modules/reviews/service.ts` — EDIT. Add `getIntent(workspaceId, prId)`
  and `recomputeIntent(workspaceId, prId)` orchestration methods the routes call.
- `server/src/vendor/shared/contracts/platform.ts` — EDIT. Flip the `review_intent`
  `FEATURE_MODELS` default to `openrouter` / `deepseek/deepseek-v4-flash`.

**reviewer-core ⇄ server contract** (`@devdigest/shared`):
- `Intent` and `PrIntentRecord` already exist — REUSE, do not redefine
  (`brief.ts:9-14`, `review-api.ts:60-61`).
- `server/src/vendor/shared/contracts/trace.ts` — EDIT. Add optional `intent` slot
  to the `PromptAssembly` schema (mirrors the reviewer-core type change).

**client/** (UI):
- `client/src/lib/feature-models.ts` — EDIT. Mirror the `review_intent` default flip.
- `client/src/lib/hooks/reviews.ts` — EDIT. Add `usePrIntent(prId)` query +
  `useRecomputeIntent(prId)` mutation hooks.
- `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/IntentCard.tsx`
  — NEW. The Intent card (summary + IN SCOPE + OUT OF SCOPE + Recompute + unavailable).
- `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`
  — EDIT. Accept `prId` and render `<IntentCard prId={prId} />`.
- `client/src/app/repos/[repoId]/pulls/[number]/page.tsx` — EDIT (line 140). Pass
  `prId={pr.id}` down to `OverviewTab`.
- `client/messages/en/brief.json` — EDIT. Add intent card strings
  (`inScope`/`outOfScope`/`recompute`/`computing`/`unavailableHint`…). The
  `block.intent`, `unavailable`, `unavailableHint` keys already exist — REUSE.

**Reuse (do not re-implement):**
- `upsertIntent`/`getIntent` repo funcs — `pull.repo.ts:49-68`; wrappers `repository.ts:148-154`.
- `resolveFeatureModel(container, workspaceId, id)` — `feature-models.ts:51-57`.
- `container.llm(id)` — `container.ts:201-210`; `completeStructured<T>` pattern — `extract.ts:102-113`.
- `wrapUntrusted` + `INJECTION_GUARD` — `prompt.ts:16-34`.
- `container.tokenizer.count(text)` — `container.ts:150-154`, iface `tokenizer/index.ts:16-18`.
- `getPrFiles` — `pull.repo.ts:29-33`; `getIssue(repo, n)` on `GitHubClient` — `adapters.ts:164`.
- `useRunReview` + `RunReviewDropdown` — mutation+button template (`reviews.ts:116-134`).
- `usePullDetail` — query hook template (`core.ts:111-118`); `api.get/post` — `api.ts:89-100`.

## Shared scaffold (context pack)

Implementers should NOT re-open the source files below — the load-bearing fragments
are lifted here verbatim with citations. Each phase references this pack.

### S1 — `Intent` / `PrIntentRecord` contracts (already exist; reuse)
`server/src/vendor/shared/contracts/brief.ts:9-14`:
```ts
export const Intent = z.object({
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
});
export type Intent = z.infer<typeof Intent>;
```
`server/src/vendor/shared/contracts/review-api.ts:60-61`:
```ts
export const PrIntentRecord = Intent.extend({ pr_id: z.string() });
export type PrIntentRecord = z.infer<typeof PrIntentRecord>;
```

### S2 — repo persistence (already exists; reuse via ReviewRepository)
`server/src/modules/reviews/repository.ts:148,152`:
```ts
upsertIntent(prId: string, intent: Intent): Promise<void> { return pullRepo.upsertIntent(this.db, prId, intent); }
getIntent(prId: string): Promise<Intent | undefined> { return pullRepo.getIntent(this.db, prId); }
```
`upsertIntent` already does `onConflictDoUpdate` on `prIntent.prId` (`pull.repo.ts:49-62`).

### S3 — feature-model resolution + LLM structured call (the canonical chain)
`feature-models.ts:51-57`:
```ts
export async function resolveFeatureModel(
  container: Container, workspaceId: string, id: FeatureModelId,
): Promise<FeatureModelChoice> {
  return (await getFeatureModelOverride(container, workspaceId, id)) ?? DEFAULTS[id];
}
```
`container.ts:201-210`: `async llm(id: 'openai'|'anthropic'|'openrouter'): Promise<LLMProvider>`.
`completeStructured` call shape (from `extract.ts:102-113`):
```ts
const res = await llm.completeStructured<Intent>({
  model, schema: Intent, schemaName: 'Intent',
  messages, maxRetries,
  ...(timeoutMs ? { timeoutMs } : {}),
  ...(sessionId ? { sessionId } : {}),
}); // → { data, tokensIn, tokensOut, costUsd, raw }
```

### S4 — untrusted-content wrapping (use verbatim for issue/body/file blocks)
`reviewer-core/src/prompt.ts:30-34`:
```ts
export function wrapUntrusted(label: string, content: string): string {
  const safe = content.replaceAll('</untrusted>', '<\\/untrusted>');
  return `<untrusted source="${label}">\n${safe}\n</untrusted>`;
}
```
Intent is LLM-derived → in the REVIEW prompt it is UNTRUSTED data, wrap it.

### S5 — `PromptAssembly` + `sectionTokens` (where the intent slot + token metric land)
`trace.ts` `PromptAssembly` has `system, skills, memory, specs, callers, repo_map,
pr_description, user, tokens?, skill_tokens?`. Add `intent: z.string().nullish()`.
`run-executor.ts:441-451` `sectionTokens(a)` returns `Record<string,number>`; add
`if (a.intent) out.intent = tok.count(a.intent);`. Token-savings is a separate key
written into `assembly.tokens` (see Phase 5).

### S6 — UnifiedDiff / hunk headers (input for headers-only serializer; NO patch bodies)
`adapters.ts:175-188`:
```ts
export interface DiffHunk { file: string; oldStart: number; oldLines: number; newStart: number; newLines: number; newLineNumbers: number[]; }
export interface UnifiedDiff { raw: string; files: { path: string; additions: number; deletions: number; hunks: DiffHunk[] }[]; }
```
Reconstruct `@@ -oldStart,oldLines +newStart,newLines @@` per hunk from these
numeric fields — never read `diff.raw` patch text into the intent prompt.

### S7 — client query + mutation hook templates
`reviews.ts:116-134` (mutation+invalidate) and `core.ts:111-118`:
```ts
export function usePullDetail(prId) {
  return useQuery({ queryKey: ["pull", prId], queryFn: () => api.get<PrDetail>(`/pulls/${prId}`), enabled: prId != null });
}
```
`api` wrapper: `api.get<T>(path)`, `api.post<T>(path, body)` (`api.ts:89-100`).

### S8 — UI primitives + OverviewTab seam
`OverviewTab.tsx:7-22` currently takes only `prBody`. Primitives available: `Card`,
`Chip`, `Badge`, `SectionLabel`, `Button` under `client/src/vendor/ui/primitives/`;
icons `Target`, `ListChecks`. `page.tsx:140`: `<OverviewTab prBody={pr.body} />`.

### S9 — feature-model registry entries to flip (two mirrors, identical change)
`platform.ts:52-57` and `client/src/lib/feature-models.ts:21-27` both hold:
`{ id: 'review_intent', label: 'PR Review · Intent', description: '…', defaultProvider: 'openai', defaultModel: 'gpt-4.1' }`
→ change to `defaultProvider: 'openrouter', defaultModel: 'deepseek/deepseek-v4-flash'`.

## Phases

> Dependency order: **Phase 1 (contracts/schema decision) and Phase 6 (model flip)
> have no dependencies and can start immediately.** Phase 2 (pure reviewer-core) is
> independent of the server phases and can run in parallel with Phase 1/6. Phases
> 3, 4, 5 depend on Phase 1+2. Phase 7 (client) depends on Phase 3's route shapes
> being agreed (the contracts in Phase 1), not on the server build.

---

### Phase 1 — Contracts & stale-detection decision (foundation)
- **Surface:** shared (+ server schema)
- **Disjoint scope:** `server/src/vendor/shared/contracts/trace.ts`,
  `server/src/vendor/shared/contracts/review-api.ts` (only if a new response
  contract is needed), and the schema/migration decision for `pr_intent`.
- **Depends on:** none.
- **Skills to apply:** `zod`, `drizzle-orm-patterns` (+ `postgresql-table-design`
  if a column is added), `onion-architecture` (contracts are the single boundary
  source of truth — extend with NEW content, never edit the barrel).
- **What changes & why:**
  - Add an optional `intent` slot to `PromptAssembly` in `trace.ts` (mirrors the
    reviewer-core `PromptParts`/assembly change in Phase 2): `intent: z.string().nullish()`.
  - **Stale-detection decision (recommended, lightest correct):** add a NULLABLE
    `headSha`/`computed_at` to `pr_intent` so "stale" = `pr_intent.head_sha !==
    pull_requests.head_sha`. `pr_intent` has no such column today
    (`reviews.ts:48-55`), so this REQUIRES a manual migration. Recommendation:
    add `head_sha text` (nullable) only — drop the timestamp; staleness is purely
    head-based per decision #3. If the team prefers ZERO migration, the fallback
    is: **compute-if-absent on review + always recompute on explicit button**, and
    treat a moved head as "absent for review purposes" by NOT persisting head — but
    that cannot distinguish fresh-vs-stale and will recompute every review run for
    a PR that already has intent, defeating the cheap-model savings. **Therefore
    recommend the one-column migration.** State the chosen option in the PR body.
  - Reuse `Intent`/`PrIntentRecord` for route responses (S1) — `PrIntentRecord`
    is the `GET`/`POST` response shape.
- **Acceptance criteria:**
  - `PromptAssembly` parses an object with and without `intent` (nullish).
  - If the migration option is chosen: a new migration file under
    `server/src/db/migrations` (generated via `pnpm db:generate`, NOT applied) adds
    `pr_intent.head_sha text` nullable; `prIntent` table type includes `headSha`.
  - No edit to any existing barrel/index; `Intent`/`PrIntentRecord` unchanged.
- **How to test:** `cd server && pnpm typecheck`; a Zod unit test
  (`trace.test.ts`) asserting `PromptAssembly.safeParse` succeeds for both shapes.
  Migration is MANUAL — note in the PR that `pnpm db:migrate` must be run; do NOT
  run it.

---

### Phase 2 — reviewer-core: pure intent prompt + hunk-header serializer + review-prompt slot
- **Surface:** reviewer-core (PURE)
- **Disjoint scope:** `reviewer-core/src/intent/classify-prompt.ts` (NEW),
  `reviewer-core/src/prompt.ts`, `reviewer-core/src/index.ts`.
- **Depends on:** Phase 1 only for the `PromptAssembly.intent` contract (can be
  developed against the agreed shape concurrently; integrate once both land).
- **Skills to apply:** `onion-architecture` (CRITICAL: this stays PURE — no `db`,
  no `octokit`, no `fetch`; the diff is an input), `typescript-expert`.
- **What changes & why:**
  - `serializeChangedFiles(diff: UnifiedDiff): string` — emits `path` +
    reconstructed `@@ … @@` hunk headers ONLY, from `DiffHunk` numeric fields (S6).
    Never includes patch bodies. This is the pure transform whose output feeds both
    the classify prompt and the token-savings metric (full-vs-headers).
  - `buildIntentMessages(input: { prTitle; prBody?; issueTitle?; issueBody?;
    changedFiles: string }): ChatMessage[]` — system prompt instructing the model
    to output `{ intent, in_scope[], out_of_scope[] }`, with its own injection
    guard (mirror `EXTRACT_INJECTION_GUARD`, `extract.ts:131+`), wrapping body /
    issue / file-list blocks via `wrapUntrusted` (S4). Returns messages only — the
    LLM call lives in the server (Phase 3).
  - `export const INTENT_RULE` — the trusted rule string injected into the REVIEW
    system/intent section: "Stay within the stated intent and scope. Do not raise
    findings outside `in_scope`. If you spot a genuinely serious problem that is
    out of scope, emit exactly ONE concise signal finding flagging it — not many."
  - `prompt.ts`: add `intent?: string` to `PromptParts`; in `assemblePrompt`, when
    present push `## PR intent\n${INTENT_RULE}\n${wrapUntrusted('intent', intent)}`
    into `userSections` (the rule is trusted text; the derived intent payload is
    wrapped as untrusted data). Add `intent: parts.intent ?? null` to the returned
    `PromptAssembly`.
  - `index.ts`: export `buildIntentMessages`, `serializeChangedFiles`, `INTENT_RULE`.
- **Public surface:**
  - `serializeChangedFiles(diff: UnifiedDiff): string`
  - `buildIntentMessages(input: IntentPromptInput): ChatMessage[]`
  - `INTENT_RULE: string`
  - `PromptParts.intent?: string` (new optional field)
- **Acceptance criteria:**
  - `serializeChangedFiles` output contains hunk headers and file paths and
    contains NONE of the patch body lines (no `+`/`-` content lines).
  - `assemblePrompt({ ...minimal, intent })` includes a `## PR intent` section and
    `assembly.intent === intent`; omitting `intent` produces no section and
    `assembly.intent === null` (no behavior change to existing callers).
  - reviewer-core imports nothing from `server`; `tsc --noEmit` clean.
- **How to test:** `cd reviewer-core && pnpm test` — unit tests for
  `serializeChangedFiles` (asserts no patch bodies leak) and `assemblePrompt`
  intent slot present/absent.

---

### Phase 3 — server: classify-intent service + API routes
- **Surface:** server (I/O orchestration)
- **Disjoint scope:** `server/src/modules/reviews/intent-service.ts` (NEW),
  `server/src/modules/reviews/service.ts` (add 2 methods),
  `server/src/modules/reviews/routes.ts` (add 2 routes).
- **Depends on:** Phase 1 (contracts + stale decision), Phase 2 (pure builders).
- **Skills to apply:** `onion-architecture` (CRITICAL: the LLM-call + repo +
  GitHub orchestration lives HERE, never in reviewer-core; routes stay thin →
  call ONE service method), `fastify-best-practices`, `zod`, `security`
  (untrusted PR body / issue body / model output — wrapped in Phase 2; route
  input parsed with `IdParams`; rate-limit the recompute route).
- **What changes & why:**
  - `intent-service.ts` — `classifyIntent(container, repo, workspaceId, pull,
    diff): Promise<{ intent: Intent; tokensSaved: number; tokensIn; tokensOut;
    costUsd }>`:
    1. Resolve the linked issue: the PR body regex resolution is private in the
       octokit adapter, but `pull` detail already carries `linked_issue`
       (`PrDetail.linked_issue`, attached during `getPullRequest`). REUSE that;
       do NOT re-fetch. (If a recompute path lacks it, call `getIssue(repo, n)` via
       the `GitHubClient` interface — S-cite `adapters.ts:164` — never import Octokit.)
    2. `serializeChangedFiles(diff)` (Phase 2). Compute
       `tokensSaved = tokenizer.count(diff.raw) - tokenizer.count(headersOnly)`.
    3. `buildIntentMessages(...)` → `resolveFeatureModel(container, workspaceId,
       'review_intent')` (S3) → `container.llm(provider)` →
       `completeStructured<Intent>({ model, schema: Intent, schemaName:'Intent', messages })`.
    4. `repo.upsertIntent(pull.id, res.data)` (S2). If Phase 1 added `head_sha`,
       persist `pull.headSha` alongside (extend `upsertIntent` to accept it).
    5. Return the intent + `tokensSaved` so the run-executor (Phase 5) can record it.
  - `service.ts`:
    - `getIntent(workspaceId, prId): Promise<PrIntentRecord | null>` — workspace-scope
      check via `getPull`, then `repo.getIntent(prId)`, shape to `PrIntentRecord`.
    - `recomputeIntent(workspaceId, prId): Promise<PrIntentRecord>` — load pull +
      diff (reuse `loadDiff`), call `classifyIntent` FORCE, return the record.
  - `routes.ts`:
    - `GET /pulls/:id/intent` `{ schema: { params: IdParams } }` → `service.getIntent`
      → `PrIntentRecord | null` (404/`null` when absent — match module convention).
    - `POST /pulls/:id/intent/recompute` `{ schema: { params: IdParams },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }` →
      `service.recomputeIntent` → `PrIntentRecord` (mirror the
      `/pulls/:id/review` template, `routes.ts:27-44`).
- **Public surface:**
  - `classifyIntent(container, repo, workspaceId, pull, diff, opts?: { force?: boolean }): Promise<IntentClassifyResult>`
  - `ReviewService.getIntent(workspaceId, prId)` / `.recomputeIntent(workspaceId, prId)`
  - `GET /pulls/:id/intent` → `PrIntentRecord | null`
  - `POST /pulls/:id/intent/recompute` → `PrIntentRecord`
- **Acceptance criteria:**
  - No `import` of Octokit / `postgres` / Drizzle `t.*` in `intent-service.ts` or
    `service.ts` (DB only via `repo.*`, GitHub only via the adapter interface).
  - A workspace override for `review_intent` wins over the new default (verified by
    a service test injecting an override).
  - `GET` returns the stored record; `POST …/recompute` re-runs and upserts.
  - With NO linked issue/body, classify still produces an `Intent` (model called
    with file-list + title only).
- **How to test:** `cd server && pnpm test` — service unit tests with a fake
  `LLMProvider` (via `ContainerOverrides`) and a fake repo: assert override-wins,
  recompute upserts, missing-issue path. Route tests via `app.inject` for both
  endpoints (200 shapes + rate-limit config present). DB-backed assertions use the
  `*.it.test.ts` suffix.

---

### Phase 4 — server: run-executor wiring (compute-if-missing-or-stale)
- **Surface:** server (orchestration)
- **Disjoint scope:** `server/src/modules/reviews/run-executor.ts` ONLY.
- **Depends on:** Phase 2 (`PromptParts.intent`), Phase 3 (`classifyIntent`),
  Phase 1 (stale decision / `head_sha`).
- **Skills to apply:** `onion-architecture`, `typescript-expert`.
- **What changes & why:**
  - After `loadDiff` (line ~97) and before the `for (const { agent, runId } of
    jobs)` loop (line ~107), add a `runLog.step('Deriving PR intent', …)` that:
    - reads `repo.getIntent(pull.id)`; computes staleness =
      `stored.head_sha !== pull.headSha` (Phase-1 column) — or, in the no-migration
      fallback, treats only `absent` as needing compute;
    - if absent OR stale → `classifyIntent(...)` (Phase 3), capturing `tokensSaved`;
    - holds the resolved `Intent` (or `undefined` on best-effort failure) in a
      `sharedIntent` variable.
  - This is **shared pre-work**, computed ONCE per review run (the existing
    comments at lines 38/51/61/148/313 already anticipate "diff + intent" shared
    pre-work — fulfill them). Best-effort: on classify failure, log and continue
    with `sharedIntent = undefined` (mirror the "context enrichment is best-effort"
    rule — drop the section, don't throw).
  - Thread `sharedIntent` into `runOneAgent(...)` → pass as `assemblePrompt({ …,
    intent: sharedIntent ? formatIntentForPrompt(sharedIntent) : undefined })`.
    (A tiny pure `formatIntentForPrompt(Intent): string` may live in reviewer-core
    Phase 2 or be inlined; prefer Phase 2 to keep formatting pure.)
- **Acceptance criteria:**
  - On a PR with no `pr_intent`, a review run computes + persists intent exactly
    once (not once per agent).
  - On a PR whose stored intent matches `head_sha`, NO classify LLM call happens.
  - When the head moved (or, fallback: always-absent), intent recomputes.
  - Each agent's prompt includes the `## PR intent` section; classify failure does
    not fail the review (agents still run with no intent section).
- **How to test:** `cd server && pnpm test` — run-executor unit test with fake LLM
  + fake repo asserting: single classify call across N agents; skip when fresh;
  recompute when stale; review proceeds on classify error.

---

### Phase 5 — server: token-savings logging + trace plumbing
- **Surface:** server (trace/metrics)
- **Disjoint scope:** the `sectionTokens()` method + trace assembly inside
  `run-executor.ts` (the metric-writing lines, ~300-302 / ~441-451). Coordinate
  with Phase 4 (same file) — **fold Phase 5 into Phase 4's edits** to avoid two
  agents editing `run-executor.ts` concurrently. Listed separately for clarity;
  if run in parallel it MUST be merged, not concurrent.
- **Depends on:** Phase 4 (provides `tokensSaved` + `sharedIntent`), Phase 1
  (`PromptAssembly.intent`).
- **Skills to apply:** `onion-architecture`, `typescript-expert`.
- **What changes & why:**
  - In `sectionTokens(a)` add `if (a.intent) out.intent = tok.count(a.intent);`
    (S5) so the intent section's token cost surfaces per-run like other sections.
  - Record the savings: when intent was (re)computed, write
    `intent_tokens_saved` into the run's `assembly.tokens` map (the `tokens` record
    is `Record<string, number>` per `PromptAssembly`) AND emit a `runLog.info`
    line (`Intent classified — omitting patch bodies saved ~N tokens`). The
    classify step's own `tokensIn/tokensOut/costUsd` can be logged at info level
    (no `agent_runs` row exists for the classify step — it is pre-work; do NOT
    fabricate an `agent_runs` row for it).
- **Acceptance criteria:**
  - When intent is computed, the run trace's `tokens` includes
    `intent_tokens_saved` ≥ 0 and `intent` (the section's own token count).
  - The savings log line is emitted exactly when classify runs (not on skip).
- **How to test:** `cd server && pnpm test` — extend the Phase-4 run-executor test
  to assert `assembly.tokens.intent_tokens_saved` is present after a compute and
  absent after a skip.

---

### Phase 6 — Cheap-model default flip (both registries)
- **Surface:** shared + client (config mirrors)
- **Disjoint scope:** `server/src/vendor/shared/contracts/platform.ts` (the
  `review_intent` `FEATURE_MODELS` entry) and `client/src/lib/feature-models.ts`
  (the mirrored entry). Disjoint from all other phases.
- **Depends on:** none (can start immediately, run fully in parallel).
- **Skills to apply:** `typescript-expert` (keep the two mirrors in sync — the
  client comment at `feature-models.ts:8-12` mandates it).
- **What changes & why:** Per decision #4, flip `review_intent` from
  `openai`/`gpt-4.1` to `openrouter`/`deepseek/deepseek-v4-flash` in BOTH files
  (S9). `resolveFeatureModel` already lets a workspace override win, so no logic
  change is needed — only the registry default.
- **Acceptance criteria:**
  - `defaultFeatureModel('review_intent')` returns
    `{ provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' }`.
  - Both registries (server + client mirror) match exactly.
  - A workspace override still wins (unchanged `resolveFeatureModel` behavior).
- **How to test:** `cd server && pnpm test` (a tiny assertion on
  `defaultFeatureModel('review_intent')`), `cd client && pnpm typecheck`. Visual:
  Settings UI already lists `review_intent`; the new default shows when unset.

---

### Phase 7 — client: Intent card + hooks + i18n
- **Surface:** client (UI)
- **Disjoint scope:** `client/src/lib/hooks/reviews.ts` (add 2 hooks),
  `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/IntentCard.tsx`
  (NEW), `…/_components/OverviewTab/OverviewTab.tsx` (edit props),
  `…/pulls/[number]/page.tsx` (pass `prId`), `client/messages/en/brief.json`
  (add strings).
- **Depends on:** Phase 1 (the `PrIntentRecord` response contract) + Phase 3's
  agreed route shapes. Does NOT need the server to be built — develop against the
  contract and the route paths in Phase 3.
- **Skills to apply:** `react-frontend-architecture` (colocate the card under the
  page's `_components/`; data access via a hook, not inline fetch),
  `react-best-practices` (derive, don't store; server state in TanStack Query, not
  mirrored), `next-best-practices`, `react-testing-library` (tests),
  `security` (render intent strings as text only — React auto-escapes; no
  `dangerouslySetInnerHTML`; the intent is server-derived untrusted content).
- **What changes & why:**
  - `reviews.ts`:
    - `usePrIntent(prId)` → `useQuery({ queryKey: ['intent', prId], queryFn: () =>
      api.get<PrIntentRecord | null>(\`/pulls/${prId}/intent\`), enabled: prId != null })`
      (template S7).
    - `useRecomputeIntent(prId)` → `useMutation({ mutationFn: () =>
      api.post<PrIntentRecord>(\`/pulls/${prId}/intent/recompute\`),
      onSuccess: (d) => qc.setQueryData(['intent', prId], d) })` (template S7).
  - `IntentCard.tsx` (props `{ prId: string }`): renders `Card` with a
    `SectionLabel icon="Target"` title (reuse `brief.block.intent`), the intent
    summary text, an IN SCOPE list and an OUT OF SCOPE list (each item a `Chip`,
    icon `ListChecks`), and a Recompute `Button` wired to `useRecomputeIntent`
    (disabled + "computing" label while pending). When `usePrIntent` returns
    `null`/undefined → render the unavailable state (reuse `brief.unavailable` +
    `brief.unavailableHint`).
  - `OverviewTab.tsx`: change props to `{ prBody; prId }`; render
    `<IntentCard prId={prId} />` above/below the description.
  - `page.tsx:140`: `<OverviewTab prBody={pr.body} prId={pr.id} />`.
  - `brief.json`: add `inScope`, `outOfScope`, `recompute`, `computing`,
    `emptyScope` keys (REUSE existing `block.intent`/`unavailable`/`unavailableHint`).
- **Public surface:**
  - `usePrIntent(prId: string | null | undefined)` → `UseQueryResult<PrIntentRecord | null>`
  - `useRecomputeIntent(prId: string)` → `UseMutationResult<PrIntentRecord, …>`
  - `<IntentCard prId={string} />`
- **Acceptance criteria:**
  - Card shows summary + scope lists when intent exists; shows unavailable state
    when `null`; Recompute button triggers the mutation and updates the card on
    success.
  - Types come from `@devdigest/shared` (`PrIntentRecord`), not redefined client-side.
  - No hardcoded UI strings (all via next-intl `brief.json`).
- **How to test:** `cd client && pnpm test` (RTL + Vitest, fetch mocked): render
  `IntentCard` with mocked `usePrIntent` data → asserts scope lists; with `null`
  → asserts unavailable copy; click Recompute → asserts `api.post` called and
  card updates. `pnpm typecheck`.

## Risks & mitigations
- **Two phases edit `run-executor.ts` (4 & 5).** Mitigation: MERGE Phase 5 into
  Phase 4 (same implementer); do not run them as concurrent agents. All other
  phases are file-disjoint.
- **Stale detection needs a column `pr_intent` doesn't have.** Mitigation: Phase 1
  adds a nullable `head_sha` via a generated migration (MANUAL apply). If the team
  rejects the migration, the no-migration fallback recomputes intent every review
  run for PRs that already have intent — eroding the cheap-model savings. The plan
  recommends the one-column migration and flags the trade-off explicitly.
- **Migration must not auto-apply.** Mitigation: generate only (`pnpm db:generate`),
  never run `pnpm db:migrate`; call it out in the PR body.
- **Onion leak risk:** the LLM/GitHub/DB orchestration could accidentally land in
  reviewer-core. Mitigation: Phase 2 is pure (asserted by a "no server import"
  check); all I/O is in Phase 3/4 server modules. dependency-cruiser already
  forbids `reviewer-core → server`.
- **Prompt injection:** PR body / issue body / model-derived intent are untrusted.
  Mitigation: classify prompt uses its own injection guard; the review prompt wraps
  the derived intent via `wrapUntrusted` and keeps `INTENT_RULE` as the only
  trusted instruction (the global `INJECTION_GUARD` still applies).
- **No `agent_runs` row for the classify step.** Mitigation: log tokens/cost at
  info level + record `intent_tokens_saved` in the run trace's `tokens` map; do not
  fabricate an `agent_runs` row for pre-work.
- **Two registry mirrors drift.** Mitigation: Phase 6 changes both in lockstep; the
  client file's own comment mandates sync.

## Critical files for implementation
- `server/src/modules/reviews/run-executor.ts` — the integration seam (lines ~97-107, ~300-302, ~441-451).
- `server/src/modules/reviews/intent-service.ts` (NEW) — the classify orchestration (I/O lives here).
- `reviewer-core/src/intent/classify-prompt.ts` (NEW) + `reviewer-core/src/prompt.ts` — pure prompt/serialization + the review-prompt intent slot.
- `server/src/modules/reviews/routes.ts` — the two new endpoints.
- `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/IntentCard.tsx` (NEW) — the card.

## Open questions / assumptions
- **Stale detection:** recommending the one-column `pr_intent.head_sha` migration.
  CONFIRM whether a migration is acceptable; otherwise the no-migration fallback
  (compute-if-absent + force-on-button) ships, accepting redundant recomputes.
- **Linked-issue reuse:** assumed `PrDetail.linked_issue` is already populated on
  the `pull` object available in the run-executor / recompute path. If the
  run-executor's `PullRow` lacks `linked_issue`, the service resolves it via
  `getIssue(repo, n)` (GitHubClient interface) using the body regex match — still
  no direct Octokit import. CONFIRM which object the run-executor has.
- **classify model session/trace:** assumed the classify step logs tokens via
  `runLog`/trace and does NOT get its own `agent_runs` row. CONFIRM acceptable.
- **i18n namespace:** reusing `brief.json` (it already holds `block.intent` /
  `unavailable*`) rather than a new `intent.json`. CONFIRM preferred namespace.
```
