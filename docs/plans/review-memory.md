# Development Plan: Review Memory — Studio MVP

- **Spec:** docs/specs/SPEC-2026-07-16-review-memory.md
- **Execution mode:** single-agent

## Context

DevDigest's AI reviewer re-derives context every run — it has no durable memory
of the team's decisions, conventions, preferences, or learned facts, so it
re-flags known non-issues and forgets standing rules. The DB already carries an
empty `memory` table (pgvector `embedding` 1536) and a `MemoryItem` contract, and
the review engine already *consumes* memory (`## Relevant memory` block). What is
missing is everything that *fills, manages, and injects* it.

This plan delivers the **Studio MVP** (spec goal, one line): a server `memory`
module (CRUD + real pgvector semantic retrieval, workspace-scoped), a `/memory`
studio page matching the approved mockup, and best-effort injection of the most
relevant memory into local studio reviews with full run-trace observability —
covering AC-1…AC-26. Nightly auto-curation and the CI leg are explicitly out of
scope (Deferred).

## Requirements review & recommendations

The spec is approved with zero open questions; all parameters are decided (stale
= 60 days; injection top-N = 5, cosine threshold ≈ 0.75; multi-agent shares one
retrieval). No blocking ambiguity remained, so no stop-and-ask was needed. The
findings below are non-blocking recommendations grounded in the current code.

- **"Reuse the code_chunks cosine pattern" does not exist yet.** `code_chunks`
  (`server/src/db/schema/context.ts` L31-47) has an `embedding` column but **no
  query in the codebase performs a pgvector similarity search** (grep: the only
  embedding consumer is `conventions/service.ts`, which loads vectors and does
  cosine *in JS memory* for dedup — not a DB `<=>` query). The cosine query must
  therefore be **authored fresh**. Recommendation: use `drizzle-orm`'s
  `cosineDistance` helper (confirmed present in the installed `drizzle-orm@0.38.4`)
  in `repository.ts`, passing the query vector as a `number[]`, ordering ascending
  by distance, and filtering with a `sql` predicate equivalent to
  `1 - cosineDistance >= SIMILARITY_THRESHOLD`. Confirm the exact API against the
  `drizzle-orm-patterns` skill and the installed version before writing it.
- **`messages/en/memory.json` already exists (scaffolded)** and partially
  conflicts with the spec. Its header string is `"… · pgvector · semantic"` (AC-13
  wants the `pgvector` **and** `curated nightly` labels, with `semantic` as the
  search-box affordance), and its empty-state body references a "Learn action …
  retrieval-backed agents" flow that contradicts this MVP's manual-CRUD empty
  state (AC-18 = "prompt creation of the first entry"). Per check-before-create,
  **extend/adjust the existing file** — never overwrite it — adding create/edit,
  delete-confirm, validation, no-results, loading/error, and aria strings.
- **Contract placement.** Add the new shapes to `contracts/knowledge.ts`
  *additively* (as directed, matching how `ConventionCandidate` was extended). The
  barrel already re-exports `knowledge.ts` (proven: `MemoryItem` is imported from
  `@devdigest/shared` today), so **no `index.ts` edit is needed** and none is
  allowed. Do not touch the existing `MemoryItem`/`MemoryScope`/`MemoryKind`/
  `MemorySource`.
- **AC-3 × AC-20 interaction.** When a search `q` is supplied but embeddings are
  disabled, semantic search is unavailable. Recommendation: the search path
  returns a typed "semantic unavailable" error the client surfaces as the error
  state, while the non-semantic filtered list stays usable (AC-20).

## Affected packages & files

- **`server/src/vendor/shared/contracts/knowledge.ts`** — add `Memory`,
  `CreateMemory`, `UpdateMemory`, `MemoryListQuery` (additive; barrel unchanged).
- **`server/src/modules/memory/`** (NEW module, modeled on `modules/conventions/`):
  - `constants.ts` — `INJECTION_TOP_N = 5`, `SIMILARITY_THRESHOLD = 0.75`,
    `STALE_DAYS = 60`, `SEARCH_TOP_N` (list search bound).
  - `repository.ts` — the ONLY code that touches `t.memory`; workspace-scoped
    list/filter/facet-count, getById, insert, update, delete, `searchByCosine`,
    `touchLastUsed`.
  - `service.ts` — `MemoryService(container)`; constructs its own
    `MemoryRepository(container.db)`; CRUD use-cases + `search` + `retrieveRelevant`.
  - `routes.ts` — thin Fastify plugin: `GET/POST /memory`, `GET/PATCH/DELETE
    /memory/:id`; parse via contracts; workspace via `getContext`.
- **`server/src/modules/index.ts`** — one import + one registry entry (`memory`).
- **`server/src/modules/reviews/run-executor.ts`** — retrieve once in shared
  pre-work; pass `memory` to `reviewPullRequest`; set `memory_pulled` (replace the
  hardcoded `[]` at L478); `prompt_assembly.memory` already flows from
  `outcome.assembly`.
- **`server/src/db/seed.ts`** — insert example entries (idempotent) using the
  existing `workspaceId` / `repoId` (`acme/payments-api`) handles.
- **`client/src/lib/hooks/memory.ts`** (NEW) — `useMemory` hook family, modeled on
  `client/src/lib/hooks/conventions.ts`.
- **`client/src/app/memory/page.tsx`** (NEW, thin) + **`client/src/app/memory/_components/`**
  (NEW) — three-pane view (rail / list / detail), cards, detail panel, create/edit
  form, delete confirm, empty/no-results/loading/error states.
- **`client/messages/en/memory.json`** — EXTEND the existing file (see review).

**Reuse (do not reinvent):** `container.embedder()` (gated by `EMBEDDINGS_ENABLED`,
throws `ConfigError` when off — `platform/container.ts` L248-261);
`getContext(app.container, req)` for `workspaceId`; `NotFoundError`;
`IdParams`/module route conventions from `conventions/routes.ts`; the
`new ProjectContextService(container)` cross-module-service precedent in
`run-executor.ts` L66; `api`/`useQuery`/`useMutation`+`invalidateQueries` patterns
from `hooks/conventions.ts`; reviewer-core's existing `memory: string[]` input and
`## Relevant memory` rendering (`reviewer-core/src/prompt.ts` L117-137, L166;
`review/run.ts` L58-59, L140) — **no engine change**.

## Tasks

### Phase 1 — Shared contracts (Zod)
- **Surface:** shared (`@devdigest/shared`)
- **Skills to apply:** `zod`
- **What changes & why:** Define the boundary shapes once, additively in
  `contracts/knowledge.ts`, so every layer parses/serializes against the single
  source of truth. Embedding is derived server-side and is NOT in any client-facing
  shape (invariant).
- **How to test:** server `pnpm test` (unit) — `safeParse` accept/reject cases.
- [x] T1  Add `Memory` display shape (id, content, scope, kind, confidence 0..1, sources, repo_id nullable, updated_at, last_used_at nullable) reusing `MemoryScope`/`MemoryKind`/`MemorySource`  → AC-1  → test_dto_validation
- [x] T2  Add `CreateMemory` + `UpdateMemory` (partial) DTOs with cross-field refinement: content non-empty, confidence in 0..1, `repo_id` required iff scope=`repo` (else null)  → AC-7  → test_dto_validation
- [x] T3  Add `MemoryListQuery` (`scope?: MemoryScope[]`, `kind?: MemoryKind[]`, `stale?: boolean`, `q?: string`, `repo_id?`)  → AC-2  → test_dto_validation

### Phase 2 — Server module: constants + repository (data access)   (depends on: Phase 1)
- **Surface:** server (`server/src/modules/memory/`)
- **Skills to apply:** `onion-architecture`, `drizzle-orm-patterns`, `postgresql-table-design`
- **What changes & why:** All Drizzle over `t.memory` lives here (rule 4), every
  query workspace-scoped (AC-8). Repo-scope filtering = `repoId = activeRepo OR
  scope IN (global, team)`. `searchByCosine` is the fresh pgvector query (see
  review). Facet counts computed per scope/kind for the rail (AC-2).
- **How to test:** server integration (`*.it.test.ts`, needs Docker/pgvector).
- [x] T4  `constants.ts` — `INJECTION_TOP_N=5`, `SIMILARITY_THRESHOLD=0.75`, `STALE_DAYS=60`, `SEARCH_TOP_N`  → AC-9  → test_inject_topn
- [x] T5  `repository.ts` — `MemoryRepository(db)`: `list` (ws + repo/global/team, scope/kind/stale filters + facet counts), `getById`, `insert` (row + embedding), `update` (known fields; optional embedding), `delete`, `searchByCosine` (ws + repo/global/team, top-N ordered by cosine, `>= threshold`), `touchLastUsed(ids)` — all ws-scoped  → AC-1, AC-2, AC-3, AC-6, AC-8, AC-16  → test_list_scoped, test_filters_facets, test_semantic_order, test_delete_removes, test_tenant_isolation, test_stale_filter

### Phase 3 — Server module: service + routes + registration   (depends on: Phase 2)
- **Surface:** server (`server/src/modules/memory/`, `modules/index.ts`)
- **Skills to apply:** `onion-architecture`, `fastify-best-practices`, `zod`, `drizzle-orm-patterns`, `security`
- **What changes & why:** Service holds the use-cases (rule 6: routes stay thin);
  create/update embed content via `container.embedder()` best-effort (persist
  without embedding when disabled — AC-11 edge). `search` embeds `q` then
  `searchByCosine`; when embeddings are off it returns a typed "semantic
  unavailable" signal (AC-20). `retrieveRelevant(workspaceId, repoId, queryText)`
  → `{ items: string[], pulled: MemoryPulled[] }`, best-effort (catch
  `ConfigError`/failure → `{ items: [], pulled: [] }`, AC-11) and `touchLastUsed`
  on the matched ids (AC-10). Routes parse with the contracts (no `req.body` cast,
  no mass-assignment — A08), scope via `getContext`, map not-in-workspace →
  `NotFoundError` (AC-8).
- **How to test:** server unit (validation) + integration (CRUD, search, tenancy).
- [x] T6  `service.ts` — `MemoryService(container)` (own `MemoryRepository(container.db)`): `list`, `search`, `create`, `update` (re-embed only when content changed), `delete`, `retrieveRelevant`  → AC-1, AC-3, AC-4, AC-5, AC-9, AC-11  → test_create_embeds, test_update_reembed, test_degrade_embeddings_off, test_inject_topn
- [x] T7  `routes.ts` — `GET /memory` (filters + `q`), `GET /memory/:id`, `POST /memory`, `PATCH /memory/:id`, `DELETE /memory/:id`; contract-parsed; ws-scoped; cross-tenant → not-found  → AC-1, AC-2, AC-4, AC-5, AC-6, AC-7, AC-8  → test_list_scoped, test_filters_facets, test_create_embeds, test_update_reembed, test_delete_removes, test_dto_validation, test_tenant_isolation
- [x] T8  Register the module in `server/src/modules/index.ts` (one import + `memory,` entry)  → AC-1  → test_list_scoped

### Phase 4 — Review injection wiring   (depends on: Phase 3)
- **Surface:** server (`server/src/modules/reviews/run-executor.ts`)
- **Skills to apply:** `onion-architecture`
- **What changes & why:** In `executeRuns` shared pre-work (after the intent
  step, before the parallel fan-out), construct `new MemoryService(container)`
  (ProjectContextService precedent, L66) and call `retrieveRelevant` ONCE per
  review — deriving `queryText` from the PR (title + body, plus the derived intent
  summary when available) — updating `last_used_at` once. Pass the shared
  `{ items, pulled }` into each `runOneAgent`; each agent injects the SAME memory
  (AC-26). Inject only when non-empty (`...(items.length > 0 ? { memory: items }
  : {})`) so an empty result yields a byte-identical baseline prompt (AC-12).
  Replace the hardcoded `memory_pulled: []` (L478) with the shared `pulled`;
  `prompt_assembly.memory` already flows from `outcome.assembly.memory`.
- **How to test:** server integration (inject top-N; trace + last_used; degrade;
  multi-agent same memory) + reviewer-core unit (baseline prompt unchanged).
- [x] T9  Retrieve relevant memory once in shared pre-work (best-effort, degrade on error/embeddings-off), derive PR query text, `touchLastUsed` once; thread `sharedMemory` into `runOneAgent`  → AC-9, AC-10, AC-11, AC-26  → test_inject_topn, test_trace_and_lastused, test_degrade_embeddings_off, test_multi_agent_same_memory
- [x] T10  In `runOneAgent`, pass `memory` to `reviewPullRequest` omit-when-empty and set `memory_pulled` from `sharedMemory.pulled`  → AC-9, AC-10, AC-12, AC-26  → test_trace_and_lastused, test_baseline_prompt, test_multi_agent_same_memory

### Phase 5 — Seed example entries   (depends on: Phase 3)
- **Surface:** server (`server/src/db/seed.ts`)
- **Skills to apply:** `drizzle-orm-patterns`
- **What changes & why:** Insert the design's example entries into the active
  workspace, covering all five kinds and the repo/global/team scopes, idempotently
  (mirror the existing existence-check-then-insert pattern; repo-scoped rows use
  the seeded `repoId`, global/team rows use `repoId = null`). Sources include PR
  chips (`#401`, `#423`, `#482`). Embeddings are generated lazily on first
  re-save or by review retrieval; the seed does not require embeddings enabled.
- **How to test:** server integration — run seed, assert kinds/scopes present.
- [x] T11  Seed example memory rows (5 kinds × repo/global/team), idempotent  → AC-23  → test_seed_examples

### Phase 6 — (Optional) pgvector ANN index migration
- **Surface:** server (DB migration — MANUAL)
- **Skills to apply:** `drizzle-orm-patterns`, `postgresql-table-design`
- **What changes & why:** OPTIONAL and recommended DEFERRED for MVP. The workspace
  memory set is small by design (spec Non-functional) and `memory_ws_idx` already
  bounds the scan, so a filtered sequential cosine scan is adequate. If volume
  grows, add an `hnsw`/`ivfflat` index on `memory.embedding` via a NEW generated
  migration — migrations are MANUAL (`cd server && pnpm db:migrate`); no existing
  migration is edited. Include only if a measured need arises.
- **How to test:** server integration — search still returns correct top-N order.
- [ ] T12  (OPTIONAL) Add an ANN index migration for `memory.embedding`; apply via manual `pnpm db:migrate`  → AC-9  → test_semantic_order

### Phase 7 — Client hooks   (depends on: Phase 3)
- **Surface:** client (`client/src/lib/hooks/memory.ts`)
- **Skills to apply:** `react-best-practices`, `react-frontend-architecture`, `next-best-practices`
- **What changes & why:** TanStack Query hooks over the memory API, modeled on
  `hooks/conventions.ts`: array `queryKey`s including the active repo + filters +
  `q`; mutations `invalidateQueries` the list. The search error (embeddings off)
  surfaces via the query's `error` so the page renders the AC-20 error state while
  the base list stays usable. Types come from `@devdigest/shared` (never redefined).
- **How to test:** client `pnpm test` (RTL) via the components that consume them.
- [x] T13  `useMemory` family: `useMemory(filters)` (list + facet counts + `q`), `useCreateMemory`, `useUpdateMemory`, `useDeleteMemory` with `queryKey` arrays + `invalidateQueries`  → AC-1, AC-2, AC-3, AC-5, AC-6, AC-20  → test_page_renders, test_loading_error

### Phase 8 — Client `/memory` page + components   (depends on: Phase 7)
- **Surface:** client (`client/src/app/memory/`, `client/messages/en/memory.json`)
- **Skills to apply:** `react-frontend-architecture`, `react-best-practices`, `next-best-practices`, `react-testing-library`, `security`
- **What changes & why:** Thin `page.tsx` delegating to a colocated three-pane
  view (rail / list / detail), matching `memory-01.png`. Content is rendered as
  escaped text with inline code formatted safely — NEVER `dangerouslySetInnerHTML`
  (AC-24, A05). All strings via next-intl (EXTEND `messages/en/memory.json`).
  Controls labeled + keyboard-operable; async updates announced via an aria-live
  region (AC-25).
- **How to test:** client `pnpm test` (RTL, `_components/*.test.tsx`; `fireEvent`
  per the client testing convention). Full-browser flows (AC-13/21/22) may also be
  exercised in the `e2e/` deterministic suite (spec's verification tier).
- [x] T14  `app/memory/page.tsx` (thin) + `_components/MemoryView` three-pane shell; header (count + `pgvector` + `curated nightly` labels) + semantic search box (`semantic` affordance); no-selection detail placeholder  → AC-13, AC-17  → test_page_renders, test_no_selection_placeholder
- [x] T15  Filter rail — SCOPE + KIND with per-facet counts, and the "Show Stale (>60d)" toggle wiring the `stale` param  → AC-2, AC-16  → test_filters_facets, test_stale_filter
- [x] T16  List cards — kind badge, scope badge, confidence %, content with inline code rendered safely, source PR chips, last-used date  → AC-14, AC-24  → test_card_fields, test_content_escaped
- [x] T17  Detail panel — kind badge, edit + delete actions, content, confidence %, scope, updated date, source contexts (PR # + context text)  → AC-15  → test_detail_panel
- [x] T18  Create/edit form — content, scope, kind, confidence, repo association (required for repo scope), sources; client validation; list reflects change without full reload  → AC-21, AC-7  → test_create_edit_form
- [x] T19  Delete confirmation before removal  → AC-22  → test_delete_confirm
- [x] T20  Empty state (no entries → prompt first-entry creation), no-results state (search miss), loading state, error state (incl. semantic unavailable, keeping the non-semantic list usable)  → AC-18, AC-19, AC-20  → test_empty_state, test_no_results, test_loading_error
- [x] T21  Accessibility — labeled search/filter/edit/delete controls, keyboard operation, aria-live announcement of async list/detail/search updates  → AC-25  → test_a11y
- [x] T22  Extend `messages/en/memory.json` — header labels (`curated nightly`), search `semantic` label, create/edit/delete-confirm, validation, no-results, loading/error, aria strings; fix the empty-state body to match manual-CRUD MVP  → AC-13  → test_page_renders

## Traceability matrix
| AC   | Task           | Test                          | Commit |
|------|----------------|-------------------------------|--------|
| AC-1 | T1, T5, T7, T8 | test_list_scoped              | —      |
| AC-2 | T3, T5, T7, T15| test_filters_facets           | —      |
| AC-3 | T5, T6, T13    | test_semantic_order           | —      |
| AC-4 | T6, T7         | test_create_embeds            | —      |
| AC-5 | T6, T7, T13    | test_update_reembed           | —      |
| AC-6 | T5, T6, T7, T13| test_delete_removes           | —      |
| AC-7 | T2, T7, T18    | test_dto_validation           | —      |
| AC-8 | T5, T7         | test_tenant_isolation         | —      |
| AC-9 | T4, T6, T9, T10| test_inject_topn              | —      |
| AC-10| T9, T10        | test_trace_and_lastused       | —      |
| AC-11| T6, T9         | test_degrade_embeddings_off   | —      |
| AC-12| T10            | test_baseline_prompt          | —      |
| AC-13| T14, T22       | test_page_renders             | —      |
| AC-14| T16            | test_card_fields              | —      |
| AC-15| T17            | test_detail_panel             | —      |
| AC-16| T5, T15        | test_stale_filter             | —      |
| AC-17| T14, T17       | test_no_selection_placeholder | —      |
| AC-18| T20            | test_empty_state              | —      |
| AC-19| T20            | test_no_results               | —      |
| AC-20| T13, T20       | test_loading_error            | —      |
| AC-21| T18            | test_create_edit_form         | —      |
| AC-22| T19            | test_delete_confirm           | —      |
| AC-23| T11            | test_seed_examples            | —      |
| AC-24| T16            | test_content_escaped          | —      |
| AC-25| T21            | test_a11y                     | —      |
| AC-26| T9, T10        | test_multi_agent_same_memory  | —      |

Commit is `—` at planning time; the implementer fills it as tasks land, and
plan-verifier audits AC↔task↔test coverage against this table.

## Risks & mitigations

- **No existing pgvector query to copy (the "code_chunks pattern" is unqueried
  scaffolding).** Mitigation: author `searchByCosine` fresh with `drizzle-orm`'s
  `cosineDistance` (present in `0.38.4`), verified against the `drizzle-orm-patterns`
  skill; keep the query workspace + repo/global/team scoped and parameterized.
- **Byte-identical baseline regression (AC-12).** The engine already omits the
  section when `memory` is empty; the only risk is passing `memory: []` instead of
  omitting the key. Mitigation: use the `...(items.length > 0 ? { memory } : {})`
  spread exactly as `specs`/`callers` already do; a reviewer-core unit test pins
  the baseline prompt.
- **Retrieval delaying/failing a review.** Mitigation: one query-embedding + one
  bounded cosine query, wrapped in try/catch that degrades to `{ items: [], pulled:
  [] }` (AC-11), run ONCE in shared pre-work (not per agent) so multi-agent cost is
  flat (AC-26).
- **Cross-tenant leak / mass-assignment.** Mitigation: every repository method
  filtered by `workspaceId`; routes parse DTOs (no `req.body` spread); embedding is
  server-derived, never client-supplied (invariant).
- **Stored XSS via memory content in the UI.** Mitigation: render as escaped text /
  safe inline code, never `dangerouslySetInnerHTML` (AC-24).
- **Scaffolded i18n drift.** `messages/en/memory.json` predates this spec and
  conflicts (header `semantic` label, "Learn action" empty state). Mitigation:
  extend/adjust in place (check-before-create), do not overwrite.

## Critical files for implementation

- `server/src/modules/conventions/{routes,service,repository,constants}.ts` — the module template to mirror.
- `server/src/modules/reviews/run-executor.ts` — the injection site (shared pre-work L127-178; per-agent L239+; `reviewPullRequest` L357; hardcoded `memory_pulled: []` L478).
- `server/src/vendor/shared/contracts/knowledge.ts` — where the new contracts land (additive; `MemoryItem` family at L87-113).
- `server/src/platform/container.ts` — `embedder()` gating (L248-261, throws `ConfigError` when disabled).
- `client/src/lib/hooks/conventions.ts` + `client/src/app/conventions/` + `client/messages/en/memory.json` — the client template + the pre-existing i18n to extend.

## Open questions / assumptions

Non-blocking (recorded as assumptions; none change the design materially):

1. **Route shape** — memory endpoints are top-level `/memory` and `/memory/:id`,
   with the active repo passed as a `repo_id` query param for repo-scope filtering
   (mirrors the client's active-repo pattern). Assumed.
2. **Review query text (AC-9)** — the retrieval query is derived from the PR title
   + body, plus the derived intent summary when available. Assumed (spec says
   "derived from the PR" without fixing the exact text).
3. **`last_used_at` timing (AC-10/AC-26)** — updated once, at retrieval time in
   shared pre-work (retrieval runs once and is shared), not per agent.
4. **Search-unavailable behavior (AC-3/AC-20)** — when `q` is set and embeddings
   are disabled, the search path returns a typed "semantic unavailable" error the
   client renders as the error state; the non-semantic filtered list stays usable.
5. **Vector index** — deferred (Phase 6 optional); MVP relies on the small
   workspace set + `memory_ws_idx`.
