# Development Plan: Project Context Folder

- **Spec:** docs/specs/SPEC-2026-07-04-project-context-folder.md (Status: approved, AC-1…AC-23)
- **Execution mode:** multi-agent (implementer wave(s) → test-writer gap pass → green barrier → architecture-reviewer ∥ plan-verifier)

## Context

Today a repository's `*.md` docs (specs, design notes, insights) are invisible to
the AI reviewer: an agent judges a PR against its system prompt, attached skills,
and repo-intel context, but never against the project's own stated goals and
rules. **Project Context Folder** turns any repo markdown into review context — a
document is *attached* to a reviewer agent or skill and, on a run, its text is
injected deterministically as untrusted data under `## Project context` in the
assembled prompt, with full per-document token visibility before and after the run
and zero new LLM/embedding calls.

The one-line goal: **build the producer side for the already-scaffolded consumer**
— a reader that discovers/reads markdown from the read-only clone, an attach UI on
agents and skills, and run-executor wiring that resolves attached paths → reads
files → passes them as `specs` and records them in the trace.

This is confirmed (by reading the code) to be a **producer-only** change: the
consumer plumbing already exists and is hardcoded empty — `assemblePrompt` renders
`## Project context` from `parts.specs` and wraps each entry via `wrapUntrusted`
(`reviewer-core/src/prompt.ts:117-120,137`); `PromptAssembly.specs` /
`tokens.specs` / `skill_tokens` and `RunTrace.specs_read` already exist
(`server/src/vendor/shared/contracts/trace.ts:43,59,66,111`); the run-executor
computes `sectionTokens` for `specs` and writes `specs_read: []` / `specs: null`
(`server/src/modules/reviews/run-executor.ts:405,536,567,571`); the client
`TraceBody` already renders "Specs read" and the "Project context" block
(`client/.../TraceBody/TraceBody.tsx:47-59,116-118`).

## Requirements review & recommendations

**Resolved by grounding (no blocking questions found — spec is approved and the
execution mode was supplied). Two items surfaced as recommendations + explicit
planning assumptions rather than blockers, because a sensible default exists and
the feature is buildable either way (see Open questions / assumptions):**

1. **i18n `en` + `uk` (AC-18) vs. a single-locale app.** The client is wired for a
   SINGLE locale: `LOCALE = "en"`, no locale routing, no locale switcher, and
   **no `messages/uk/` directory exists** (`client/src/i18n/request.ts:14,27-30`;
   only `messages/en/*` present). Shipping `messages/uk/*.json` mirrors satisfies
   the letter of AC-18 per the existing per-namespace convention, but those
   strings are never LOADED at runtime today (dead until a future multi-locale
   wiring). **Recommendation:** either (a) descope AC-18's `uk` half to a follow-up
   that also wires locale selection, or (b) accept that this feature ships the `uk`
   JSON as forward-looking dead weight. This plan takes (b) as the default
   (mirror `uk` JSON, do NOT expand the i18n runtime) so the pipeline is not
   blocked; flag for the caller if (a) is preferred.

2. **A stale, conflicting "Project Context" scaffold already exists.**
   `client/messages/en/context.json` and `activeKeyFor()` already carry a
   `context` route + strings from an EARLIER, different model — it has
   `chunks`, `reindex`/`indexing`, `resync`, `indexStatus`, and an
   `editor.save`/`saving` affordance (`client/messages/en/context.json:1-24`;
   `client/src/components/app-shell/helpers.ts:30`). Those contradict this spec's
   Non-goals (no chunks/indexing) and the "Edit read-only in v1" decision (no
   Save). **Recommendation / decision folded into the plan:** REUSE and OVERWRITE
   `context.json` for this feature's strings; DROP `save`/`saving`/`chunks`/
   `reindex`/`indexing`/`resync`/`indexStatus` keys (the index-state ring is
   decorative existing repo-intel infra, not this feature's compute). Do not
   create a parallel namespace.

3. **The left-nav item is declared in `@devdigest/ui` (external `AppFrame`), not
   in the four packages.** The client only maps the active key, and
   `activeKeyFor()` already returns `"context"` for `/context`
   (`helpers.ts:30`). **Recommendation:** the client route/page work is
   self-contained; if the "Project Context" nav item under the WORKSPACE group is
   not already rendered by `AppFrame`, adding it is an `@devdigest/ui` change
   outside this plan's package scope — treated as an assumption (see Open
   questions) and verified during implementation, not planned as a slice.

4. **Path-traversal guard must live in the new service (AC-22).** The git adapter
   `readFile` does a bare `join(clonePathFor(repo), path)` with NO traversal check
   (`server/src/adapters/git/simple-git.ts:129-131`). AC-22 therefore cannot rely
   on the adapter; the project-context service MUST resolve + assert the path is a
   descendant of `clonePathFor(repo)` before every read. Folded into Phase 1.

5. **`walkClone` is NOT directly reusable.** It is coupled to code extensions
   (`SUPPORTED_EXT` = `.ts/.tsx/...`) and lives inside the repo-intel pipeline
   (`server/src/modules/repo-intel/pipeline/walk.ts:55`), which the onion facade
   rule forbids deep-importing (server rule 7). It is a *pattern reference only*
   (symlink-skip, forward-slash relpaths, unreadable-dir tolerance, size cap). The
   new markdown walker is fresh code in the project-context module. Folded into
   Phase 1.

**All ACs are testable as written; no contradictions that change the design were
found.** AC-14 (soft budget warn-only) and AC-13 (per-file hard cap skip) use two
DISTINCT thresholds — a soft TOTAL-token budget (UI warn) and a per-file HARD cap
(run-time skip) — both configurable; the plan keeps them separate config keys.

## Affected packages & files

- **`server/src/vendor/shared/`** — NEW contract file (never edit the barrel):
  `contracts/project-context.ts` (discovered-document, document-content,
  attachment-item) + a NEW file adding the `spec_tokens` extension near the trace
  contract. Barrel `index.ts` gets new export lines only (append; the AGENTS rule
  forbids editing existing barrel *content*, appending an export line for a NEW
  file is the documented "extend with new files" path — Phase 2 owns it).
- **`server/src/db/schema/`** — NEW schema file `project-context.ts` (two ordered
  link tables: `agent_specs`, `skill_specs`, mirroring `agent_skills.order` at
  `schema/agents.ts:51-63`) + its own migration. Reuse `now()`, `workspaces` FK.
- **`server/src/modules/project-context/`** — NEW feature module: `routes.ts`
  (Fastify plugin, mirrors `agents/routes.ts:70-178`), `service.ts`, `repository.ts`,
  `constants.ts`, `walk.ts` (markdown glob over the clone). Registered by ONE line
  in `modules/index.ts:28-41`.
- **`server/src/platform/config.ts`** — NEW config keys (mirror `EMBEDDINGS_ENABLED`
  at `config.ts:22,78`): `PROJECT_CONTEXT_TOKEN_BUDGET` (int, soft), per-file hard
  cap (int), root folder names (string[], default `specs,docs,insights`).
- **`server/src/platform/container.ts`** — NEW lazy getter
  `projectContextRepo` (mirror `agentsRepo` at `container.ts:107-109`).
- **`server/src/modules/reviews/run-executor.ts`** — wiring only: resolve merged
  spec paths → read (skip dangling/non-UTF-8/oversized) → pass `specs` to
  `reviewPullRequest` → record `specs_read`, `specs`, `tokens.specs`, `spec_tokens`.
  Touch points: the skills block region (259-276) for the analogous per-doc token
  build, the `reviewPullRequest` call (282-310), and the trace build (364-406,
  esp. `specs_read: []` at 405 and `skill_tokens` at 392).
- **`reviewer-core/src/prompt.ts`** — ONE-line addition to `INJECTION_GUARD`
  (18-30) naming attached specs/project docs as untrusted data (AC-21). The
  `specs` render path (117-120,137) is already correct — no change.
- **`client/src/app/context/`** — NEW Project Context page (route already keyed as
  `context` in `helpers.ts:30`).
- **`client/src/app/agents/[id]/.../AgentEditor/`** — NEW "Context" tab (extend
  `TABS` in `constants.ts:11-14`; new `_components/ContextTab/`).
- **`client/src/app/skills/[id]/.../SkillEditor/`** — NEW "Context" tab (extend
  `TABS` in `constants.ts:11-15`; new `_components/ContextTab/`).
- **`client/.../TraceBody/TraceBody.tsx`** — ADD "Per-specs tokens" subsection to
  the existing specs `PromptBlock` (116-118), mirroring the `skill_tokens`
  subsection (85,96-107) + `SKILL_TOKENS` styles (19-25).
- **`client/src/lib/hooks/`, `client/src/lib/api.ts`** — NEW hooks for
  discover/read/attach (mirror `useAgents`/`useSetAgentSkills`).
- **`client/messages/en/context.json`** (overwrite) + **`client/messages/uk/context.json`**
  (new) — see recommendation 1 & 2.
- **Reuse (do not re-create):** `<Markdown>` from `@devdigest/ui`
  (`client/src/vendor/ui/primitives/Markdown.tsx`, react-markdown + remark-gfm);
  native HTML5 DnD pattern from `SkillsTab.tsx:44-52,92-95`; `container.tokenizer.count`
  (`container.ts:150`); `container.git.readFile`/`clonePathFor`
  (`adapters.ts:235-236`); `wrapUntrusted` (`reviewer-core` `prompt-shared.ts:10`);
  `getContext` workspace guard (`modules/_shared/context.ts:14-23`); `IdParams`,
  `ZodTypeProvider` route scaffold; `linkedSkills` ordered-link pattern
  (`agents/repository.ts:198-241`).

## Shared scaffold (context pack)

Parallel implementers MUST use these verbatim fragments instead of re-opening the
source files. Citations point to the source of record.

### CP-1 — Untrusted delimiter format (AC-9, AC-21). `reviewer-core/src/prompt-shared.ts:10-14`
```ts
export function wrapUntrusted(label: string, content: string): string {
  const safe = content.replaceAll('</untrusted>', '<\\/untrusted>');
  return `<untrusted source="${label}">\n${safe}\n</untrusted>`;
}
```
`assemblePrompt` already wraps each spec as `wrapUntrusted(`spec-${i}`, s)` and
renders `## Project context\n${specsBlock}` BEFORE `## Diff to review`
(`prompt.ts:117-120,137,150`). Per-doc token counts MUST be computed over the
SAME wrapped text (`wrapUntrusted(`spec-${i}`, text)`), exactly as skills do
(`run-executor.ts:266-271`).

### CP-2 — Ordered link table (mirror of `agent_skills`). `server/src/db/schema/agents.ts:51-63`
```ts
export const agentSkills = pgTable('agent_skills', {
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  skillId: uuid('skill_id').notNull().references(() => skills.id, { onDelete: 'cascade' }),
  order: integer('order').notNull().default(0),
}, (t) => ({ pk: primaryKey({ columns: [t.agentId, t.skillId] }) }));
```
New tables store the document **path** (text, never the doc text — AC-5), an
`order` int, and (for scoping) the owning agent/skill FK. NOTE: unlike
`agent_skills` (FK to a `skills` row), a spec attachment's identity is a
repo-relative PATH string, so the PK is `(agent_id, path)` / `(skill_id, path)`.

### CP-3 — Ordered link repo methods (mirror). `server/src/modules/agents/repository.ts:198-241`
`linkedSkills` (join + `orderBy(asc(order))`), `setSkills` (delete-all then insert
with `order: index`) are the templates for `attachedSpecs(agentId)` /
`setAgentSpecs(agentId, paths[])` and the skill-side equivalents. Every query is
workspace-scoped via `eq(t.<table>.workspaceId, workspaceId)` (`repository.ts:60,75`).

### CP-4 — Attach route pair (mirror). `server/src/modules/agents/routes.ts:145-165`
```ts
app.get('/agents/:id/skills', { schema: { params: IdParams } }, async (req) => {
  const { workspaceId } = await getContext(app.container, req);
  const agent = await service.get(workspaceId, req.params.id);
  if (!agent) throw new NotFoundError('Agent not found');
  return service.skillLinks(req.params.id);
});
app.post('/agents/:id/skills', { schema: { params: IdParams, body: SetSkillsBody } }, async (req) => {
  const { workspaceId } = await getContext(app.container, req);
  /* set whole ordered set OR link one */
});
```
New endpoints: `GET/POST /agents/:id/specs`, `GET/POST /skills/:id/specs`, plus
discover/read endpoints (`GET /repos/:repoId/project-context`,
`GET /repos/:repoId/project-context/content?path=...`). `getContext` = the AC-20
workspace guard; call it in EVERY handler.

### CP-5 — Config key (mirror `EMBEDDINGS_ENABLED`). `server/src/platform/config.ts:22,54,78`
Add to `EnvSchema`: `PROJECT_CONTEXT_TOKEN_BUDGET: z.coerce.number().int().default(<N>)`,
a per-file hard-cap int, and `PROJECT_CONTEXT_ROOTS: z.string().optional()` →
`.split(',')` (default `['specs','docs','insights']`). Add matching fields to
`AppConfig` and populate in `loadConfig()`.

### CP-6 — DI getter (mirror `agentsRepo`). `server/src/platform/container.ts:107-109`
```ts
get projectContextRepo(): ProjectContextRepository {
  return (this._projectContextRepo ??= new ProjectContextRepository(this.db));
}
```

### CP-7 — Trace: per-doc token subsection UI (mirror `skill_tokens`). `client/.../TraceBody/TraceBody.tsx:19-25,85,96-107,116-118`
The existing specs `PromptBlock` (116-118) gets an `extra=` prop rendering
`spec_tokens` exactly like the `SKILL_TOKENS` subsection: a `wrap`/`head`/`row`
styled list of `{ path, tokens }` in order. Read via
`trace.prompt_assembly.spec_tokens ?? []`.

### CP-8 — Tab row style + native DnD (mirror). `client/.../AgentEditor/_components/SkillsTab/SkillsTab.tsx:44-52,83-116`
Row = drag-handle (`Icon.Menu`) + checkbox + icon + `mono` name + folder path +
type badge + Preview. DnD = `draggable` + `onDragStart/onDragOver(preventDefault)/onDrop`
with the splice-reorder in `onDrop` (44-52). **NEW for a11y (AC-19):** add a
keyboard reorder affordance (e.g. up/down buttons or Alt+Arrow) — the existing
SkillsTab is drag-only and does NOT satisfy AC-19, so this is net-new.

### CP-9 — Query hook pair (mirror). `client/src/lib/hooks/agents.ts`, `skills.ts:110-118`
```ts
export function useAgents() {
  return useQuery({ queryKey: ["agents"], queryFn: () => api.get<Agent[]>("/agents") });
}
export function useSetAgentSkills() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, skillIds }) => api.post(`/agents/${agentId}/skills`, { skill_ids: skillIds }),
    onSuccess: (links, { agentId }) => qc.setQueryData(["agent-skills", agentId], links),
  });
}
```

### CP-10 — Server test conventions.
`.it.test.ts` = DB-backed integration (`startPg()` + `seed()` + `buildApp({ config, db, overrides })`
with `MockGitClient`/`MockGitHubClient`; see `server/test/agents-versions.it.test.ts`).
`.test.ts` = pure unit, direct mock instantiation, no DB (`server/test/adapters.test.ts`).
reviewer-core + client tests run under Vitest (`pnpm test` per package). Run all
tests in WSL per project rules.

## Tasks

Task IDs are global. Phases 1–7 are the disjoint slices; parallel-safe phases can
run concurrently in the first wave.

### Phase 1 — Server: project-context module (discover, read, tokenize, guards)   (parallel-safe)
- **Surface:** server (backend) + cross-cutting (security)
- **Disjoint scope:** `server/src/modules/project-context/` (new: `walk.ts`,
  `service.ts`, `repository.ts` [discover/read only], `constants.ts`); the ONE
  registration line in `server/src/modules/index.ts`; `server/src/platform/config.ts`
  (new keys); `server/src/platform/container.ts` (new getter). Does NOT touch
  run-executor, contracts, schema, or any client file.
- **Skills to apply:** `onion-architecture` (module = routes→service→repository;
  DB only in repository; external systems via `container.git`), `fastify-best-practices`,
  `security` (path-traversal + workspace scoping), `typescript-expert`.
- **What changes & why:** a new feature module that globs the read-only clone for
  markdown under the configured roots, reads a document's raw content, and
  tokenizes — the producer's discovery/preview half. Uses `container.git`
  (`readFile`/`clonePathFor`) and `container.tokenizer.count`; degrades to empty
  on missing clone (AC-16). Path-traversal guard lives here (CP: resolve + assert
  descendant of `clonePathFor`, AC-22). Zero LLM/embedding calls (AC-23). Config
  keys per CP-5; DI getter per CP-6.
- **How to test:** `cd server && pnpm test` — unit (`.test.ts`) for walker glob
  (`**/{specs,docs,insights}/**/*.md` only) + path-traversal rejection + tokenize;
  integration (`.it.test.ts`) for the discover endpoint + workspace scoping.
- [x] T1  Walker returns ONLY `*.md` under `specs`/`docs`/`insights` roots (any depth), each with repo-relative path + `folder_type` badge; empty when roots absent   → AC-1, AC-16, AC-23   → test_discover_glob
- [x] T2  Content endpoint returns raw UTF-8 markdown + token count for a listed doc; tokens `0` for empty file   → AC-2, AC-8, AC-23   → test_document_content
- [x] T3  Path resolving outside the clone root (`../`, absolute) is rejected; no file read outside `clonePathFor(repo)`   → AC-22   → test_path_traversal_rejected
- [x] T4  All discover/read/attach routes deny cross-workspace access via `getContext`   → AC-20   → test_workspace_scoping
- [ ] T5  Add `PROJECT_CONTEXT_TOKEN_BUDGET`, per-file hard cap, root-folder-names config keys + DI `projectContextRepo` getter; register module in `modules/index.ts`   → AC-1, AC-14   → test_config_keys

### Phase 2 — Shared contracts (discovered-doc, attachment, spec_tokens)   (parallel-safe)
- **Surface:** `@devdigest/shared` contracts
- **Disjoint scope:** `server/src/vendor/shared/contracts/project-context.ts` (new),
  a new file adding `spec_tokens` (imported/extended alongside the trace contract —
  additive, `nullish`, so older traces parse), and APPEND-ONLY export lines in
  `server/src/vendor/shared/index.ts`. Does NOT edit existing contract bodies.
- **Skills to apply:** `zod`, `onion-architecture` (contracts = single source of
  truth at the boundary), `typescript-expert`.
- **What changes & why:** the new boundary shapes — `DiscoveredDocument`
  (`path`, `folder_type` enum, `tokens`, optional `missing`, optional
  `used_by_agents`), `DocumentContent` (`path`, `content`, `tokens`, `folder_type`),
  `SpecAttachment` (`path`, `order`), and `PromptAssembly.spec_tokens`
  (`{ path, tokens }[]`, optional) mirroring `skill_tokens`
  (`trace.ts:66-68`). `path` invariants: unique per repo, never contains `..`,
  `tokens ≥ 0`. Export `z.infer` types.
- **How to test:** `cd server && pnpm test` + `pnpm typecheck` — schema parse/round-trip
  unit tests; a trace WITHOUT `spec_tokens` still parses (back-compat).
- [x] T6  `DiscoveredDocument` / `DocumentContent` / `SpecAttachment` Zod schemas + inferred types parse valid shapes and reject bad ones   → AC-1, AC-2, AC-5, AC-8   → test_project_context_contracts
- [x] T7  `PromptAssembly.spec_tokens` (optional `{path,tokens}[]`) added via new file; an old trace without it still parses   → AC-10   → test_spec_tokens_contract

### Phase 3 — Server DB schema + migration (attachment link tables)   (parallel-safe)
- **Surface:** server (backend, DB) + `postgresql-table-design`
- **Disjoint scope:** `server/src/db/schema/project-context.ts` (new: `agent_specs`,
  `skill_specs`) + its OWN migration file + the schema barrel export line for the
  new file. Does NOT touch existing schema files.
- **Skills to apply:** `drizzle-orm-patterns`, `postgresql-table-design`,
  `onion-architecture`.
- **What changes & why:** two ordered link tables storing attachment PATHS (never
  doc text — AC-5), mirroring `agent_skills.order` (CP-2). PK `(agent_id, path)` /
  `(skill_id, path)`; FK to `agents`/`skills` with `onDelete: cascade`; carry
  `workspace_id` (per the "every domain table has workspace_id" rule) for the
  scoping guard. Migration is MANUAL (`cd server && pnpm db:migrate`) — the plan
  does NOT run it; test-writer/implementer note the migration exists.
- **How to test:** `cd server && pnpm test` — an `.it.test.ts` that inserts/reads
  ordered attachments round-trips path + order.
- [x] T8  `agent_specs` / `skill_specs` tables + migration: attachment stores ordered PATHS (not text), workspace-scoped, cascades on agent/skill delete   → AC-5   → test_spec_link_tables

### Phase 4 — Server: attach persistence, merge/dedup resolver, run-executor wiring   (depends on: Phase 1, Phase 2, Phase 3)
- **Surface:** server (backend) + cross-cutting (security)
- **Disjoint scope:** `server/src/modules/project-context/repository.ts` (attach
  read/write methods), `service.ts` (merge/dedup resolver + per-doc tokenization +
  attach endpoints), `routes.ts` (attach + read endpoints per CP-4), and
  `server/src/modules/reviews/run-executor.ts` (the wiring region only). This is
  the one non-parallel-safe backend phase because it consumes Phases 1–3 and edits
  the shared run-executor.
- **Skills to apply:** `onion-architecture` (resolver = service logic, DB in repo,
  wiring in the executor service), `fastify-best-practices`, `drizzle-orm-patterns`,
  `security` (untrusted data + skip-not-throw), `typescript-expert`.
- **What changes & why:** (a) persist/reorder attachments (CP-3, CP-4) storing
  paths; (b) the run-time MERGE resolver — agent-attached first (stored order),
  then skill-inherited (skill order via `linkedSkills`, then each skill's doc
  order), deduped by NORMALIZED repo-relative path, FIRST occurrence wins (AC-6,
  AC-7); (c) run-executor wiring — read each merged path from the clone
  (best-effort: skip dangling/non-UTF-8/oversized with a trace note — mirrors the
  "context enrichment is best-effort, never throw" rule, `run-executor.ts` intent
  block 111-162), pass surviving texts as `specs` to `reviewPullRequest`
  (282-310), and record `specs_read` (replace `[]` at 405), `specs`, `tokens.specs`
  (already via `sectionTokens`), and `spec_tokens` (mirror `skill_tokens` build at
  266-271,392 — count over `wrapUntrusted('spec-${i}', text)`). Per-file hard cap +
  soft budget are config-driven (Phase 1). Zero LLM/embedding calls (AC-23).
- **How to test:** `cd server && pnpm test` — unit for the pure merge/dedup
  resolver (the AC-6 ordering authority) + skip cases; integration for attach
  persistence, skill inheritance, and a full trace assertion.
- [x] T9  Attach/reorder persists ordered PATHS on agent & skill; detach removes; text never copied into metadata   → AC-5   → test_attach_persist
- [x] T10  Merge resolver: agent-attached first, then skill-inherited (skill order, then doc order); dedup by normalized path, first-occurrence-wins   → AC-6   → test_merge_order_dedup
- [x] T11  A skill-attached doc is inherited by every enabled agent using that skill on a run (subject to AC-6)   → AC-7   → test_skill_inheritance
- [x] T12  Dangling path at run time → skipped, run continues, skip recorded in trace/log   → AC-11   → test_skip_dangling
- [x] T13  Non-UTF-8 file at run time → skipped-with-warning, run continues   → AC-12   → test_skip_non_utf8
- [x] T14  Single file over the per-file hard cap → skipped-with-warning, never truncated   → AC-13   → test_skip_over_cap
- [x] T15  Completed run trace has `specs_read` (paths), `specs` text, `tokens.specs`, and `spec_tokens[]` in injected order counted over the wrapped text; zero LLM/embedding calls   → AC-10, AC-23   → test_trace_specs_recorded
- [x] T16  Per-document + total attached token counts computed via the server tokenizer over document text   → AC-8   → test_attach_token_counts

### Phase 5 — reviewer-core: prompt-assembly proof + injection-guard mention   (parallel-safe)
- **Surface:** reviewer-core (backend, pure) + cross-cutting (security)
- **Disjoint scope:** `reviewer-core/src/prompt.ts` (INJECTION_GUARD text only,
  18-30) + reviewer-core tests. Does NOT change the `specs` render path (already
  correct). No server/client files.
- **Skills to apply:** `security`, `onion-architecture` (keep reviewer-core pure),
  `typescript-expert`.
- **What changes & why:** append one clause to `INJECTION_GUARD` naming attached
  specs / project docs as untrusted DATA so embedded instructions carry no
  authority (AC-21). Also pin the already-scaffolded behavior with tests: specs
  render under `## Project context`, each `wrapUntrusted`-fenced, BEFORE
  `## Diff to review` (prompt.ts:117-120,137,150). Purity invariant preserved (no
  I/O).
- **How to test:** `cd reviewer-core && pnpm test` — unit that `assemblePrompt({ specs })`
  wraps each spec untrusted, orders them before the diff, and that the guard text
  names attached docs.
- [x] T17  `assemblePrompt` renders `specs` under `## Project context`, each untrusted-wrapped, before the diff; `assembly.specs` populated   → AC-9   → test_specs_render_untrusted
- [x] T18  INJECTION_GUARD explicitly names attached specs/project docs as untrusted data   → AC-21   → test_guard_names_specs

### Phase 6 — Client: Project Context page + Context tabs + Preview drawer   (depends on: Phase 2; API-parallel with Phase 4)
- **Surface:** client (UI) + cross-cutting (a11y, i18n)
- **Disjoint scope:** `client/src/app/context/` (new page + `_components/`);
  `client/src/app/agents/[id]/.../AgentEditor/` (extend `TABS`, new `_components/ContextTab/`);
  `client/src/app/skills/[id]/.../SkillEditor/` (extend `TABS`, new `_components/ContextTab/`);
  `client/src/lib/hooks/` + `client/src/lib/api.ts` (new hooks). Does NOT touch
  `TraceBody` (Phase 7) or i18n JSON (Phase 8 owns the strings) beyond referencing
  keys.
- **Skills to apply:** `react-frontend-architecture`, `react-best-practices`,
  `next-best-practices`, `react-testing-library` (tests).
- **What changes & why:** (a) the Project Context page: file list (name + folder +
  badge) with Preview (rendered markdown via `<Markdown>`) and Edit (raw,
  read-only — NO Save affordance in v1) + friendly empty state (AC-2, AC-16);
  (b) agent "Context" tab ("Project context" section) and skill "Context" tab
  ("Project context to use" + "SERIALIZES AS" path preview) reusing the SkillsTab
  row style + native DnD (CP-8), attached-first ordering, per-doc + total tokens
  with a soft-budget warn indicator (AC-3, AC-4, AC-8, AC-14), a "missing" badge
  for unresolved attached paths (AC-15); (c) Preview drawer (badge, tokens,
  "Used by N agents", "Attached" chip, rendered markdown) (AC-17); (d) a11y:
  keyboard-operable reorder (net-new — SkillsTab is drag-only), focus order,
  aria-live token total (AC-19). Hooks mirror CP-9.
- **How to test:** `cd client && pnpm test` (Vitest + jsdom, fetch mocked) — RTL
  tests per component; e2e (deterministic) covered in `e2e/` where noted by the spec.
- [x] T19  Project Context page lists discovered docs (path + folder-type badge); Preview renders markdown, Edit shows raw read-only (no Save)   → AC-1, AC-2   → test_project_context_page
- [x] T20  No matching files → friendly empty state on the page and empty (non-error) list in Context tabs   → AC-16   → test_empty_state
- [x] T21  Agent Context tab: "Project context" section rows (handle+checkbox+name+folder+badge+Preview), attached checked & ordered first   → AC-3   → test_agent_context_tab
- [x] T22  Skill Context tab: "Project context to use" section + "SERIALIZES AS" path list   → AC-4   → test_skill_context_tab
- [x] T23  Toggle/reorder in a Context tab persists the ordered path set (calls the attach API)   → AC-5   → test_context_tab_persist
- [ ] T24  Per-doc token count + total shown; total over soft budget shows a warn indicator, attaching NOT blocked, nothing truncated   → AC-8, AC-14   → test_token_ui_and_budget
- [x] T25  Missing attached doc renders a "missing" badge and stays detachable   → AC-15   → test_missing_badge
- [x] T26  Preview drawer shows rendered markdown, type badge, token count, "Used by N agents", and an "Attached" chip when attached   → AC-17   → test_preview_drawer
- [x] T27  Keyboard-operable reorder (non-drag), correct focus order, aria-live token-total announcement   → AC-19   → test_a11y_reorder

### Phase 7 — Client: Run trace "Per-specs tokens" subsection   (depends on: Phase 2)
- **Surface:** client (UI)
- **Disjoint scope:** `client/.../RunTraceDrawer/_components/TraceBody/TraceBody.tsx`
  (add the subsection to the existing specs `PromptBlock`) + its styles/constants.
  Isolated from Phase 6's files.
- **Skills to apply:** `react-frontend-architecture`, `react-best-practices`,
  `react-testing-library` (tests).
- **What changes & why:** the "Specs read" (47-59) and "Project context" block
  (116-118) already render. Add an `extra=` "Per-specs tokens" subsection to the
  specs `PromptBlock` mirroring the `skill_tokens` subsection (CP-7), reading
  `trace.prompt_assembly.spec_tokens ?? []` — the after-the-run per-document
  visibility.
- **How to test:** `cd client && pnpm test` — RTL test that a trace with
  `spec_tokens` renders the per-doc breakdown under the specs block.
- [x] T28  Trace specs block renders a "Per-specs tokens" subsection ({path, tokens} in order) from `spec_tokens`; "Specs read" lists injected paths   → AC-10   → test_per_specs_tokens_ui

### Phase 8 — i18n strings (en overwrite + uk mirror)   (depends on: Phase 6, Phase 7)
- **Surface:** client (i18n) + cross-cutting (i18n)
- **Disjoint scope:** `client/messages/en/context.json` (overwrite/extend) + new
  `client/messages/uk/context.json` (+ any other namespace keys the new UI needs,
  e.g. `runs.json` for the per-specs label — coordinate with Phase 7 by adding
  keys only). Does NOT touch component code.
- **Skills to apply:** `next-best-practices`, `typescript-expert`.
- **What changes & why:** every new user-facing string via next-intl in `en` and
  `uk` (AC-18). OVERWRITE the stale `context.json` (drop `save`/`saving`/`chunks`/
  `reindex`/`indexing`/`resync`/`indexStatus` — see recommendation 2). See the
  Open questions note: the app is single-locale today, so the `uk` file is
  forward-looking (not loaded at runtime) unless the caller opts to also wire
  multi-locale (out of this plan's scope).
- **How to test:** manual — every new string present in both `en` and `uk`, no
  hardcoded text in the new components (grep the new components for literals).
- [x] T29  All new user-facing strings sourced from next-intl in `en` AND `uk`; stale conflicting `context.json` keys removed; no hardcoded text   → AC-18   → test_i18n_en_uk

## Traceability matrix

| AC   | Task(s)       | Test                          | Commit |
|------|---------------|-------------------------------|--------|
| AC-1 | T1, T5, T19   | test_discover_glob            | —      |
| AC-2 | T2, T19       | test_document_content         | —      |
| AC-3 | T21           | test_agent_context_tab        | —      |
| AC-4 | T22           | test_skill_context_tab        | —      |
| AC-5 | T6, T8, T9, T23 | test_attach_persist         | —      |
| AC-6 | T10           | test_merge_order_dedup        | —      |
| AC-7 | T11           | test_skill_inheritance        | —      |
| AC-8 | T2, T16, T24  | test_attach_token_counts      | —      |
| AC-9 | T17           | test_specs_render_untrusted   | —      |
| AC-10| T7, T15, T28  | test_trace_specs_recorded     | —      |
| AC-11| T12           | test_skip_dangling            | —      |
| AC-12| T13           | test_skip_non_utf8            | —      |
| AC-13| T14           | test_skip_over_cap            | —      |
| AC-14| T5, T24       | test_token_ui_and_budget      | —      |
| AC-15| T25           | test_missing_badge            | —      |
| AC-16| T1, T20       | test_empty_state              | —      |
| AC-17| T26           | test_preview_drawer           | —      |
| AC-18| T29           | test_i18n_en_uk               | —      |
| AC-19| T27           | test_a11y_reorder             | —      |
| AC-20| T4            | test_workspace_scoping        | —      |
| AC-21| T18           | test_guard_names_specs        | —      |
| AC-22| T3            | test_path_traversal_rejected  | —      |
| AC-23| T1, T2, T15   | test_zero_llm_calls           | —      |

<Commit is "—" at planning time; implementers fill it as tasks land;
plan-verifier audits AC↔task↔test coverage against this table. Bidirectional
coverage verified: every AC-1…AC-23 has ≥1 task, and every T1…T29 cites ≥1 AC.>

## Risks & mitigations

- **Shared run-executor is the sensitive touch point (Phase 4).** It is used by
  single- AND multi-agent runs via the common trace builder. Mitigation: Phase 4
  is the only backend phase editing it, changes are additive (new `specs`/
  `spec_tokens` alongside existing `skill_tokens`), and best-effort skip semantics
  mean a spec-read failure can never abort a run (mirror the intent best-effort
  block). Assert byte-identical prompt when no specs are attached.
- **AC-18 i18n conflict (single-locale app).** See recommendation 1 — default is
  ship `uk` JSON as forward-looking; escalate to the caller if runtime multi-locale
  is wanted (that is a separate feature, not planned here).
- **Stale `context.json` / `activeKeyFor` scaffold.** Overwriting could collide
  with any orphaned component still importing the old keys. Mitigation: Phase 6/8
  implementers grep for consumers of the dropped keys before removing them.
- **`@devdigest/ui` nav item is external.** The WORKSPACE-group "Project Context"
  nav item may live in `@devdigest/ui` (outside the four packages). Mitigation:
  verify during Phase 6; if the item is missing, that is an out-of-scope `ui`
  change to raise, not silently expand this plan.
- **Migration is manual (AC-5 tables).** `pnpm db:migrate` is NOT run by the
  pipeline; integration tests (`.it.test.ts`) run migrations via `seed()`/`startPg()`.
  Risk: forgetting to run it in a live env → `relation ... does not exist`.
  Mitigation: call it out in Phase 3 + the final report.
- **Token-drift between attach-time estimate and run-time count** is by design
  (AC-8 estimate vs AC-10 real count) — not a bug; documented in both UIs.

## Critical files for implementation

- `server/src/modules/reviews/run-executor.ts` — the wiring seam (Phase 4);
  `specs_read: []`→paths (405), `specs: null`→text (567 fallback stays null),
  `spec_tokens` build mirrors `skill_tokens` (266-271, 392).
- `reviewer-core/src/prompt.ts` — `specs` render (117-120,137,150) already correct;
  `INJECTION_GUARD` (18-30) gets the AC-21 clause.
- `server/src/vendor/shared/contracts/trace.ts` — `spec_tokens` extends this
  (analog of `skill_tokens` 66-68); new shapes in a NEW `project-context.ts` file.
- `server/src/modules/agents/repository.ts` — `linkedSkills`/`setSkills`
  (198-241) = the ordered-attachment template.
- `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx`
  — "Specs read" + specs block + `skill_tokens` subsection (47-59, 85, 96-118).

## Open questions / assumptions

*Non-blocking (a sensible default is taken; each is called out for the caller):*

- **Assumption (i18n):** the `uk` half of AC-18 ships as `messages/uk/*.json`
  mirrors following the existing per-namespace convention; the app stays
  single-locale (`en` loaded at runtime) — full multi-locale runtime wiring is
  treated as out of scope (spec Non-goals do not include it). Reversible: flip to
  a follow-up if the caller wants live `uk` selection.
- **Assumption (stale scaffold):** `client/messages/en/context.json` is reused and
  overwritten; its `save`/`saving`/`chunks`/`reindex`/`indexing`/`resync`/
  `indexStatus` keys are dropped as incompatible with v1 (read-only Edit, no
  indexing). Implementers grep for stray consumers first.
- **Assumption (nav item):** the "Project Context" WORKSPACE-group nav item is
  provided by `@devdigest/ui`'s `AppFrame`; `activeKeyFor()` already keys `/context`.
  If the item is absent, adding it is an out-of-scope `@devdigest/ui` change to
  raise separately.
- **Assumption (config defaults):** concrete numeric defaults for
  `PROJECT_CONTEXT_TOKEN_BUDGET` (soft, total) and the per-file hard cap are left
  to the implementer to set sensibly (spec gives shapes, not values); they are
  configurable and warn-only / skip-with-warning respectively, so exact values are
  not design-blocking.
- **Assumption (`used_by_agents`):** computed deterministically server-side
  (count of enabled agents whose merged context includes the path); an optional
  contract field, so a first cut may omit it and the UI shows 0 without breaking
  AC-17's other elements.
