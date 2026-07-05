# Development Plan: Onboarding Generator

- **Spec:** docs/specs/SPEC-2026-07-05-onboarding-generator.md (Status: approved, AC-1…AC-23)
- **Execution mode:** multi-agent (implementer wave(s) → test-writer gap pass → green barrier → architecture-reviewer ∥ plan-verifier)

## Context

A newcomer dropped into an unfamiliar repo spends their first day reverse-engineering
its shape. DevDigest already indexes every connected repo with `repo-intel` (import
graph, PageRank file importance, dependency chains, a compact skeleton), but that
index only fuels PR reviews — it is never surfaced to a human. **Onboarding Generator**
turns the index into a per-repo **Onboarding Tour** page of **seven** ordered sections
(`overview`, `architecture`, `key_modules`, `reading_path`, `getting_started`,
`conventions_gotchas`, `first_tasks`), following the house pattern *"code collects the
facts, the model writes the narrative"*: a deterministic analyzer pulls structured facts
from the `repoIntel.*` facade at **zero LLM cost**, then **exactly one** structured LLM
call turns those facts into the seven narrative sections. Files/order in `reading_path`
are facade-authoritative; the model supplies only prose, rationale, and one architecture
mermaid diagram.

One-line goal: **build the producer + surface on top of already-scaffolded pieces** —
the `onboarding` table, the `Onboarding`/`OnboardingSection`/`OnboardingLink` contracts,
the `onboarding` `FeatureModelId`, and the parameterized `onboarding.system.md` prompt
all exist and are reused; no new table and no contract change to `Onboarding` are needed.

This plan is built on facts verified by reading the code this session:
- The `onboarding` table exists exactly as the spec states — `{ repoId PK → repos (cascade),
  json jsonb, generatedAt timestamptz default now }` (`server/src/db/schema/context.ts:120-126`).
  **No migration is required.**
- The `Onboarding` contracts exist and need no change — `OnboardingSection.kind` is a free
  `z.string()`, `diagram` is `z.string().nullish()`
  (`server/src/vendor/shared/contracts/knowledge.ts:29-47`).
- `FeatureModelId` already includes `'onboarding'` with a registry default
  (`server/src/vendor/shared/contracts/platform.ts:14-51`); resolution is
  `resolveFeatureModel(container, workspaceId, 'onboarding')`
  (`server/src/modules/settings/feature-models.ts:50-57`).
- The `repoIntel` facade methods exist with the exact signatures the analyzer needs and
  **degrade, never throw** (`server/src/modules/repo-intel/types.ts:146-189`, invariant
  documented at `:11-23`).
- The prompt loader interpolates `{{sections}}`/`{{language}}` via
  `renderPrompt('onboarding.system.md', vars)` (`server/src/platform/prompts.ts:24-42`);
  the prompt template today still lists 5 sections and caps `links` at 4
  (`server/src/prompts/onboarding.system.md:3-9`) — it must be updated to the 7 kinds and
  raise the reading-path cap to ~6-8.
- The client `MermaidDiagram` renderer already validates and returns `null` on invalid
  (`client/src/components/mermaid-diagram/MermaidDiagram.tsx:32-73`) and `Markdown` renders
  safely as data (`client/src/vendor/ui/primitives/Markdown.tsx`) — AC-16 is satisfied by
  reuse. There is **no in-page TOC** and **no cross-feature collapsible card** primitive
  (`TraceSection` is private 4 levels deep in RunTraceDrawer) — both are net-new.

## Requirements review & recommendations

**Both required inputs were supplied (approved spec + `multi-agent`), so no round-trip was
needed. All 23 ACs are testable as written; no contradiction that changes the design was
found.** Findings surfaced during grounding, folded into the plan as recommendations +
explicit assumptions (a sensible default exists for each; none is design-blocking):

1. **`activeKeyFor` already collides `/onboarding` (add-repo wizard) with the new tour
   (implementation-level, folded into Phase 6).** `activeKeyFor()` already returns
   `"onboarding-tour"` for `pathname.includes("/onboarding")`
   (`client/src/components/app-shell/helpers.ts:29`). But the **existing add-repo wizard**
   lives at `/onboarding` (`client/src/app/onboarding/page.tsx`) and the **new** tour lives
   at `/repos/[repoId]/onboarding-tour/` — the broad `includes("/onboarding")` matches BOTH,
   so opening the add-repo wizard would wrongly highlight the new nav item. **Recommendation
   (folded in):** Phase 6 changes the match to `/onboarding-tour` specifically (e.g.
   `pathname.includes("/onboarding-tour")`) placed BEFORE any `/onboarding` handling, so the
   add-repo wizard keeps whatever key it had and only the tour highlights the new item
   (AC-23). The nav item `key` MUST be `"onboarding-tour"` to match the existing switch value.

2. **i18n `en` + `uk` (AC-18) vs. a single-locale runtime (spec-level note, non-blocking).**
   The client is wired for a SINGLE locale: `LOCALE = "en"`, no locale routing
   (`client/src/i18n/request.ts:14,27-30`). `messages/en/onboarding.json` exists as a **5-section
   stub** (`client/messages/en/onboarding.json:1-17`); **`messages/uk/onboarding.json` does NOT
   exist** (only `messages/uk/context.json` is present). AC-18's satisfiable, deterministic
   reading — matching the pre-existing `context.json` en+uk convention — is: author every new
   string in BOTH `messages/en/onboarding.json` (expand to 7 sections + all new UI strings) and
   a NEW `messages/uk/onboarding.json` mirror. The `uk` file is forward-looking (not loaded at
   runtime today). **Recommendation:** this is the default the plan takes; wiring live `uk`
   selection is out of scope (not in the spec's Goals). Flag to the caller if live multi-locale
   is wanted — that is a separate feature.

3. **`OnboardingSection.kind` is free-form, so seven sections need no contract change (spec
   already states this).** The plan keeps the `Onboarding` contracts untouched; the seven-kind
   set and the "diagram only for `architecture`", "≥7 sections in fixed order", and "`links[].path`
   is a real facts path" invariants are enforced at generation time (service + prompt) and asserted
   in tests — NOT by changing the shared schema.

4. **`repoIntel.getTopFilesByRank` returns `string[]` (paths only); ranks come from
   `getFileRank` as `percentile`, not a raw `rank` (grounding correction).** The spec's
   facts shape writes `rankedFiles: { path, rank }[]`; concretely the analyzer builds this by
   pairing `getTopFilesByRank(repoId, N)` (order-authoritative paths) with
   `getFileRank(repoId, paths)` → `FileRankRow { path, percentile }`
   (`server/src/modules/repo-intel/types.ts:128-131,183-188`). The facts field is therefore
   `{ path, percentile }[]` (or a `rank` alias documenting it is the percentile). Non-blocking:
   the field is display/ordering metadata only.

5. **The facts token budget reuses `DEFAULT_REPO_MAP_TOKEN_BUDGET = 1500` — no new constant
   (spec explicitly requires reuse).** The analyzer calls `getRepoMap(repoId)` with no budget
   arg, so the pipeline default applies (`server/src/modules/repo-intel/constants.ts:77`;
   used the same way at `run-executor.ts:561`). No new config key, no new Settings control.

6. **`container.llm` is an async resolver method, not a property (grounding correction to the
   brief).** The LLM call is `const llm = await container.llm(provider); await
   llm.completeStructured<Onboarding>({ model, schema: Onboarding, schemaName: 'Onboarding',
   messages })` — the provider is resolved from the feature model first
   (`server/src/modules/blast/service.ts:146-157` is the reference call site). This is one LLM
   call per generation (AC-22).

## Affected packages & files

- **`server/src/vendor/shared/contracts/onboarding-api.ts`** — NEW file (never edit the
  barrel): the API request/response shapes and the facts-input shape (`OnboardingFacts`,
  `OnboardingTourResponse`, generate-response). Barrel gets ONE append-only `export *` line
  in `server/src/vendor/shared/index.ts` (the documented "extend with new files" path,
  mirroring the `project-context.js` line at `index.ts:25`).
- **`client/src/vendor/shared/contracts/onboarding-api.ts`** — the vendored MIRROR of the
  above, produced by running `node scripts/sync-shared.mjs` (the server copy is the SINGLE
  SOURCE OF TRUTH; the script mirrors the whole tree including the barrel, and CI fails on
  drift via `--check` in `client.yml`). NEVER hand-edit the client copy — author server-side
  only, then sync and commit the mirrored files.
- **`server/src/prompts/onboarding.system.md`** — UPDATE the `{{sections}}` framing to the seven
  kinds and raise the reading-path `links` cap to ~6-8 (currently "5-section", `diagram` allowed
  for `architecture`/`routes_and_apis`, `up to 4 links` at `:3-9,29`). Keep the untrusted-data,
  grounding, and mermaid-safety rules (AC-15, AC-16).
- **`server/src/modules/onboarding-generator/`** — NEW feature module mirroring `project-context/`:
  `routes.ts` (GET tour + POST generate; `getContext` guard on both), `service.ts` (facts analyzer
  over `container.repoIntel.*` + single-flight generation + one `completeStructured` call +
  `resolveFeatureModel('onboarding')`), `repository.ts` (read/upsert the existing `onboarding`
  table), `facts.ts` (pure facts assembler), `constants.ts`. Registered by ONE line in
  `server/src/modules/index.ts:29-43` (key `onboardingGenerator`).
- **`client/src/app/repos/[repoId]/onboarding-tour/`** — NEW page (thin RSC `page.tsx` + fat
  colocated `_components/OnboardingTourView/`), distinct from the untouched `/onboarding`
  add-repo wizard. Mirrors `client/src/app/context/` page shape.
- **`client/src/vendor/ui/` (new primitives)** — `useCopyToClipboard` hook (extracted from the
  3 inline duplicates) + `CollapsibleCard` (net-new; `TraceSection` is private) + `OnThisPage`
  TOC (net-new).
- **`client/src/lib/hooks/onboarding-tour.ts`** + **`client/src/lib/api.ts`** — NEW React Query
  hooks (`useOnboardingTour`, `useGenerateOnboardingTour`) mirroring `hooks/project-context.ts`.
- **`client/src/vendor/ui/nav.ts`** + **`client/src/components/app-shell/helpers.ts`** — new
  WORKSPACE nav item between `pulls` and `context`; `activeKeyFor` fix (recommendation 1).
- **`client/messages/en/onboarding.json`** (expand to 7 sections + all new strings) +
  **`client/messages/uk/onboarding.json`** (NEW mirror).
- **Reuse (do not re-create):** `Markdown` (`client/src/vendor/ui/primitives/Markdown.tsx`) and
  `MermaidDiagram` (`client/src/components/mermaid-diagram/MermaidDiagram.tsx`, already drops
  invalid → AC-16); `useToast`/`notify` (`client/src/lib/toast.tsx`) for Share/copy confirms;
  `AppShell` + breadcrumb `crumb` prop (`client/src/vendor/ui/shell/Topbar.tsx:22-47`);
  `useActiveRepo` (`client/src/lib/repo-context`); `EmptyState`/`ErrorState`/`Skeleton`/`Badge`
  from `@devdigest/ui`; server `getContext` guard (`server/src/modules/_shared/context.ts`);
  `resolveFeatureModel` + `container.llm(provider).completeStructured`; `renderPrompt`
  (`server/src/platform/prompts.ts`); single-flight `Map<repoId, Promise>` pattern
  (`server/src/modules/repo-intel/service.ts:119,131-152`).

## Shared scaffold (context pack)

Parallel implementers MUST use these verbatim fragments instead of re-opening the source
files. Citations point to the source of record.

### CP-1 — Feature module: routes plugin shape. `server/src/modules/project-context/routes.ts:51-74`
```ts
export default async function onboardingGeneratorRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new OnboardingGeneratorService(app.container);

  app.get(
    '/repos/:repoId/onboarding-tour',
    { schema: { params: RepoParams, response: { 200: OnboardingTourResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getTour(workspaceId, req.params.repoId);
    },
  );
  app.post(
    '/repos/:repoId/onboarding-tour/generate',
    { schema: { params: RepoParams, response: { 200: OnboardingTourResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.generate(workspaceId, req.params.repoId);
    },
  );
}
```
`getContext(app.container, req)` is the AC-20 workspace guard — call it in EVERY handler; it
returns `{ workspaceId, userId }` (`server/src/modules/_shared/context.ts`). The repo is
looked up workspace-scoped in the service (`container.reposRepo.getById(workspaceId, repoId)`
→ throw `NotFoundError` if missing/foreign — `project-context/service.ts:71-75`).

### CP-2 — Service: resolve feature model → one structured LLM call. `server/src/modules/blast/service.ts:146-157`
```ts
const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'onboarding');
const llm = await this.container.llm(provider);
const res = await llm.completeStructured<Onboarding>({
  model,
  schema: Onboarding,          // reused unchanged from @devdigest/shared
  schemaName: 'Onboarding',
  messages,                     // [{ role:'system', content: renderedPrompt }, { role:'user', content: factsBlock }]
});
// res.data is the Zod-validated Onboarding; reprompt-on-error/retries are inside completeStructured
```
`StructuredRequest`/`StructuredResult` (`server/src/vendor/shared/adapters.ts`) — `res.data`
is validated `Onboarding`, `res.tokensIn/tokensOut/costUsd` available. This is the SINGLE LLM
call per generation (AC-2, AC-22). On failure/invalid-after-retries, `completeStructured`
throws → the service catches, does NOT persist, and returns an error state leaving the prior
tour intact (AC-14).

### CP-3 — Single-flight per repo (mirror; simplified — no trailing re-run). `server/src/modules/repo-intel/service.ts:119,131-152`
```ts
private readonly generating = new Map<string, Promise<OnboardingTourResponse>>();

private runExclusive(repoId: string, run: () => Promise<OnboardingTourResponse>) {
  const active = this.generating.get(repoId);
  if (active) return active;                       // AC-8: coalesce to in-flight
  const p = (async () => {
    try { return await run(); }
    finally { this.generating.delete(repoId); }
  })();
  this.generating.set(repoId, p);
  return p;
}
```
The service is a container singleton, so the map is process-global (correct for the
single-process app). `generate()` wraps its body in `runExclusive(repoId, …)` — a concurrent
Regenerate for the SAME repo returns the in-flight promise; generation stays bound to its
originating `repoId` (AC-8, AC-11). NOTE: onboarding generation is idempotent-overwrite, so
the repo-intel "one trailing re-run" set is NOT needed — omit `reindexPending`.

### CP-4 — Prompt load + interpolate. `server/src/platform/prompts.ts:24-42`
```ts
const system = await renderPrompt('onboarding.system.md', { sections: SECTION_SPEC, language });
```
`SECTION_SPEC` is the seven-kind list the updated template's `{{sections}}` slot expects
(Phase 2 owns the template text; Phase 3 owns `SECTION_SPEC` + `language`, from Settings/default).

### CP-5 — repoIntel facade (read-only; degrades, never throws). `server/src/modules/repo-intel/types.ts:128-189`
```ts
getRepoMap(repoId, tokenBudget?): Promise<RepoMapResult>   // { text, tokens, cached, degraded?, reason? }; NO budget arg → DEFAULT_REPO_MAP_TOKEN_BUDGET=1500
getTopFilesByRank(repoId, n, opts?): Promise<string[]>     // ORDER-authoritative paths (paths only!)
getCriticalPaths(repoId): Promise<string[][]>              // dependency chains → fixes reading_path order (AC-3)
getFileRank(repoId, paths): Promise<FileRankRow[]>         // { path, percentile }
getIndexState(repoId): Promise<IndexState>                 // { status, filesIndexed, updatedAt, degraded?, degradedReason?, ... } — ALWAYS works
```
Invariant (`types.ts:11-23`): array methods return `[]` when degraded; object methods carry
`degraded`/`reason`; `getIndexState()` is always available. The analyzer NEVER wraps these in
try/throw for control flow — empty/degraded IS the AC-9 fallback path.

### CP-6 — Repository: read + upsert the EXISTING onboarding table. `server/src/db/schema/context.ts:120-126`
```ts
export const onboarding = pgTable('onboarding', {
  repoId: uuid('repo_id').primaryKey().references(() => repos.id, { onDelete: 'cascade' }),
  json: jsonb('json').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
});
```
Repository takes `Db` in the constructor; `getByRepo(repoId)` selects the row (or undefined);
`upsert(repoId, json)` does `insert … onConflictDoUpdate({ target: onboarding.repoId, set: {
json, generatedAt: now } })` (AC-2 overwrite). NO `workspace_id` column — scoping is via the
repo (the service resolves `reposRepo.getById(workspaceId, repoId)` first, AC-20). One tour per
repo (PK is `repoId`). NEW `onboardingRepo` lazy getter in the container (mirror `agentsRepo`,
`container.ts:109`) OR construct in the service like `project-context` does — follow whichever
the sibling module uses; project-context constructs its repo in the container getter.

### CP-7 — Client page shape (thin RSC + fat colocated view). `client/src/app/context/page.tsx` + `client/src/app/context/_components/ProjectContextView/ProjectContextView.tsx:19-142`
```tsx
// page.tsx (RSC, ~5 LOC)
export default function OnboardingTourPage() { return <OnboardingTourView />; }

// OnboardingTourView.tsx ("use client")
const t = useTranslations("onboarding");
const { repoId, activeRepo } = useActiveRepo();
const { data, isLoading, isError, refetch } = useOnboardingTour(repoId);
const crumb = [{ label: activeRepo?.full_name ?? "Workspace", mono: true }, { label: t("title") }];
return <AppShell crumb={crumb}> … </AppShell>;
```
States, verbatim pattern: loading → `<Skeleton/>`; error → `<ErrorState body={t("loadError.title")}
onRetry={()=>refetch()} />`; no stored tour → `<EmptyState … />` + Generate CTA (AC-6, AC-13);
content → seven `<CollapsibleCard>` + `<OnThisPage>` TOC. `useActiveRepo()` gives the current
repoId so a repo switch re-queries and shows the current repo's tour (AC-11).

### CP-8 — Data hook pair (mirror). `client/src/lib/hooks/project-context.ts:33-49,63-72` + `client/src/lib/api.ts:89-100`
```tsx
export function useOnboardingTour(repoId?: string | null) {
  return useQuery({
    queryKey: ["onboarding-tour", repoId],
    queryFn: () => api.get<OnboardingTourResponse>(`/repos/${repoId}/onboarding-tour`),
    enabled: !!repoId,
  });
}
export function useGenerateOnboardingTour() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) => api.post<OnboardingTourResponse>(`/repos/${repoId}/onboarding-tour/generate`),
    onSuccess: (data, repoId) => qc.setQueryData(["onboarding-tour", repoId], data),
  });
}
```
`api.get`/`api.post` are the typed wrappers (`api.ts:89-100`); the mutation's pending state
drives the AC-7 progress affordance + disabled button.

### CP-9 — Copy-to-clipboard (extract the 3 duplicates into ONE hook).
Sources to replace: `RunTraceDrawer.tsx:51-59`, `PromptBlock.tsx:41-46`, `LiveLogStream.tsx:36-43`
— all do `navigator.clipboard?.writeText(text)` + `setCopied(true)` + `setTimeout(()=>setCopied(false), ~1500)`.
```tsx
// client/src/vendor/ui/hooks/useCopyToClipboard.ts (NEW)
export function useCopyToClipboard(resetMs = 1500) {
  const [copied, setCopied] = React.useState(false);
  const copy = React.useCallback((text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), resetMs);
  }, [resetMs]);
  return { copied, copy };
}
```
Used by `getting_started` command rows (AC-17) and Share link (AC-21). Extraction of the 3
call sites is a light refactor Phase 4 owns; the new consumers are Phase 5.

### CP-10 — CollapsibleCard + OnThisPage (NEW primitives; TraceSection is PRIVATE).
`TraceSection` (`…/RunTraceDrawer/_components/TraceSection/TraceSection.tsx:8-34`) is the shape
reference ONLY (icon + title + `<Icon.ChevronDown style={chevron(open)}/>` + `{open && body}`),
but it is private 4 levels deep in another feature — lint forbids cross-feature import. Build a
fresh `CollapsibleCard` in `client/src/vendor/ui/` with a coloured round icon + title + chevron,
keyboard-operable (button toggles `aria-expanded`, Enter/Space) — AC-12, AC-19. `OnThisPage` is a
net-new TOC: a nav list of the seven section anchors, active-section marked (vertical rule + light
text) via scroll/IntersectionObserver, keyboard-navigable, `aria-current` on the active anchor +
`aria-live` announce (AC-12, AC-19).

### CP-11 — Sidebar nav item + active-key. `client/src/vendor/ui/nav.ts:21-37` + `client/src/components/app-shell/helpers.ts:26-40`
New WORKSPACE item BETWEEN `pulls` and `context`, `key` MUST be `"onboarding-tour"` (matches the
existing switch value):
```ts
{ key: "onboarding-tour", label: "Onboarding Tour", icon: <IconName>, href: "/repos/:repoId/onboarding-tour", gKey: "o" },
```
`activeKeyFor` fix (recommendation 1): the current `if (pathname.includes("/onboarding")) return
"onboarding-tour";` (`helpers.ts:29`) must become `if (pathname.includes("/onboarding-tour"))
return "onboarding-tour";` and be ordered so the add-repo `/onboarding` wizard does NOT match it.
`resolveHref` fills `:repoId` from the active repo (`nav.ts:72-76`); the Sidebar highlights via
`ctx.activeKey === it.key` (`Sidebar.tsx:63`).

### CP-12 — Test conventions.
Server: `.it.test.ts` = DB-backed integration (`startPg()` + `seed()` + `buildApp({ config, db,
overrides })` with mock adapters); `.test.ts` = pure unit (direct mock instantiation, no DB) —
run unit-only `pnpm exec vitest run --exclude '**/*.it.test.ts'`. Client: Vitest + jsdom, fetch
mocked, wrap in `NextIntlClientProvider`, mock `useActiveRepo()` + data hooks (RTL). Run ALL
tests in WSL per project rules (`wsl.exe -d Ubuntu-24.04-dev-digest-test -- bash -lc 'cd … &&
pnpm test'`). Migrations are MANUAL — but this feature adds NONE (existing table).

## Tasks

Task IDs are global. Phases group by dependency + parallelism; `parallel-safe` phases can run
concurrently in the first wave.

### Phase 1 — Shared contracts: onboarding API + facts shapes (server + client mirror)   (parallel-safe)
- **Surface:** `@devdigest/shared` contracts (server + client mirror)
- **Disjoint scope:** `server/src/vendor/shared/contracts/onboarding-api.ts` (new) + append-only
  export line in `server/src/vendor/shared/index.ts`; then run `node scripts/sync-shared.mjs` to
  regenerate the client mirror (`client/src/vendor/shared/**`) and commit it — do NOT hand-author
  the client copy or its barrel line. Does NOT touch the `Onboarding` contracts (`knowledge.ts`),
  any barrel body, or any module.
- **Skills to apply:** `zod`, `onion-architecture` (contracts = single source of truth at the boundary),
  `typescript-expert`.
- **What changes & why:** the NEW boundary shapes the API and analyzer need, WITHOUT changing
  `Onboarding` (reused unchanged, recommendation 3). `OnboardingFacts` = `{ repoSkeleton: string,
  rankedFiles: { path, percentile }[], criticalPaths: string[][], indexState: { filesIndexed:
  number, updatedAt: string|null, degraded: boolean, degradedReason: string|null } }` (recommendation
  4). `OnboardingTourResponse` = `{ tour: Onboarding | null, meta: { filesIndexed: number,
  generatedAt: string|null, degraded: boolean, degradedReason: string|null, stale: boolean } }`
  (drives AC-1 meta line, AC-9 badge, AC-10 staleness). Export `z.infer` types. `.nullish()` on
  optional/back-compat fields (`zod` skill).
- **How to test:** `cd server && pnpm test` + `pnpm typecheck`, `cd client && pnpm typecheck` —
  schema parse/round-trip; response with `tour: null` (empty state) parses.
- [x] T1  `OnboardingFacts` Zod schema + inferred type parses a valid facts bundle and a degraded (empty) one   → AC-9, AC-22   → test_onboarding_facts_contract
- [x] T2  `OnboardingTourResponse` parses a stored-tour response, a `tour:null` empty-state response, and a degraded/stale response; server + client mirrors are identical   → AC-1, AC-6, AC-9, AC-10   → test_onboarding_tour_response_contract

### Phase 2 — Server prompt: seven sections + reading-path link cap   (parallel-safe)
- **Surface:** server (backend) + cross-cutting (security)
- **Disjoint scope:** `server/src/prompts/onboarding.system.md` ONLY. Does NOT touch any `.ts`.
- **Skills to apply:** `security` (untrusted-data + mermaid-safety framing preserved),
  `typescript-expert` (n/a — prose file), `onion-architecture` (instruction text lives in the
  template, per `prompts.ts` doc).
- **What changes & why:** the template today frames "5-section" and caps `links` at 4, and allows
  `diagram` for `architecture` AND `routes_and_apis` (`:3-9,29`). Update `{{sections}}` framing to
  the SEVEN kinds in fixed order (`overview`, `architecture`, `key_modules`, `reading_path`,
  `getting_started`, `conventions_gotchas`, `first_tasks`); allow `diagram` ONLY for `architecture`
  (all other sections' `diagram` = null, AC-5); raise the per-section `links` cap to ~6-8 for
  `reading_path` so reference files are retained (spec Contracts invariant); state that `reading_path`
  files/order are GIVEN in the facts and must not be reordered/invented (AC-3); KEEP the untrusted
  `<untrusted>` block rules (AC-15), the mermaid-safety rules incl. literal-hex `classDef` (AC-16),
  and the "markdown only, no HTML/script" rule (AC-16). `{{language}}` stays (AC-18 content language).
- **How to test:** `cd server && pnpm test` — unit that `renderPrompt('onboarding.system.md', {
  sections, language })` yields text naming all 7 kinds, restricts the diagram to `architecture`,
  and retains the untrusted/mermaid-safety clauses.
- [x] T3  Prompt template frames exactly the seven kinds in order; diagram allowed only for `architecture`; reading-path link cap ~6-8; untrusted + mermaid-safety + markdown-only rules retained   → AC-5, AC-15, AC-16   → test_onboarding_prompt_template

### Phase 3 — Server: onboarding-generator module (facts analyzer + single-flight generation + persistence + routes)   (depends on: Phase 1)
- **Surface:** server (backend) + cross-cutting (security)
- **Disjoint scope:** `server/src/modules/onboarding-generator/` (new: `facts.ts`, `service.ts`,
  `repository.ts`, `routes.ts`, `constants.ts`); the ONE registration line in
  `server/src/modules/index.ts`; the `onboardingRepo` container getter if used
  (`server/src/platform/container.ts`, additive getter only). Reads Phase 1 contracts and (at
  runtime) Phase 2's prompt, but owns no file either touches. Does NOT touch any client file.
- **Skills to apply:** `onion-architecture` (module = routes→service→repository; DB only in
  repository; `repoIntel` + LLM only via the facade/container; facts assembler is pure app logic),
  `fastify-best-practices`, `drizzle-orm-patterns`, `security` (untrusted facts + workspace scoping +
  no-secret-logging), `typescript-expert`.
- **What changes & why:** the producer. (a) `facts.ts` — a PURE assembler that turns
  `getRepoMap`/`getTopFilesByRank`/`getCriticalPaths`/`getFileRank`/`getIndexState` (CP-5) into an
  `OnboardingFacts` bundle with ZERO LLM/embedding calls (AC-22); reading_path file set + order are
  FIXED here from `getTopFilesByRank`/`getCriticalPaths` before any model call (AC-3); ranking uses
  `rank = pagerank` as the facade computes today — no churn/hotness compute, no clone deepening
  (AC-4); on a degraded/empty facade it produces a fact-only bundle with `degraded` flags rather
  than throwing (AC-9). (b) `service.ts` — `getTour(workspaceId, repoId)` reads the stored row +
  index state and returns `OnboardingTourResponse` with meta (file count, `generatedAt`, degraded,
  `stale = generatedAt < indexState.updatedAt`) making ZERO LLM calls (AC-1, AC-10, AC-22);
  `generate(workspaceId, repoId)` runs under `runExclusive` (CP-3, AC-8/AC-11), assembles facts,
  renders the prompt (CP-4), makes EXACTLY ONE `completeStructured<Onboarding>` call (CP-2, AC-2,
  AC-22), and on success upserts (CP-6, AC-2) — on failure/invalid-after-retries it does NOT
  persist, leaves the prior tour intact, and surfaces an error (AC-14); facts are passed to the
  model as untrusted data via the prompt's `<untrusted>` framing (AC-15). Repo is resolved
  workspace-scoped first (AC-20). (c) `repository.ts` — `getByRepo`/`upsert` on the existing
  `onboarding` table (CP-6). (d) `routes.ts` — GET tour + POST generate, `getContext` guard on both
  (CP-1, AC-20). Register in `modules/index.ts`.
- **How to test:** `cd server && pnpm test` — unit (`.test.ts`) for the pure facts assembler
  (reading_path order from facade, `rank=pagerank` no churn, degraded→fact-only, zero LLM),
  single-flight coalescing, one-LLM-call + upsert, and no-persist-on-failure (mock `container.llm`);
  integration (`.it.test.ts`) for GET/POST routes, workspace scoping, and open=0-LLM.
- [x] T4  Facts assembler builds `OnboardingFacts` from the facade with zero LLM/embedding calls; `reading_path` files + order come from `getTopFilesByRank`/`getCriticalPaths` (facade-authoritative, not model)   → AC-3, AC-22   → test_facts_assembler
- [x] T5  Ranking uses `rank = pagerank` (`getFileRank` percentile) as computed today; no churn/hotness compute and no clone deepening   → AC-4   → test_facts_ranking_pagerank
- [x] T6  `generate` makes EXACTLY ONE `completeStructured<Onboarding>` call over the assembled facts and upserts (json + generatedAt) keyed by repoId, overwriting any prior tour   → AC-2, AC-22   → test_generate_one_call_upsert
- [x] T7  Diagram is requested/allowed only for `architecture`; the persisted document keeps `diagram` null for the other six sections   → AC-5   → test_generate_diagram_only_architecture
- [x] T8  Concurrent `generate` for the same repo does not start a second call (single-flight coalesces to the in-flight promise); generation stays bound to its originating repoId   → AC-8, AC-11   → test_generate_single_flight
- [x] T9  LLM failure / schema-invalid-after-retries → no partial persist, error surfaced, prior stored tour intact   → AC-14   → test_generate_failure_no_persist
- [x] T10  Facts fed to the model are wrapped as untrusted data (prompt `<untrusted>` framing); embedded "instructions" carry no authority   → AC-15   → test_facts_untrusted_wrapping
- [x] T11  Degraded/partial/absent index → facts-only bundle with degraded flags; `getTour` returns a degraded-flagged response, never throws or returns a fabricated tour   → AC-9   → test_degraded_facts_only
- [x] T12  `getTour` returns the stored `Onboarding` + meta (filesIndexed, generatedAt, degraded, stale) with ZERO LLM calls; `tour:null` when none stored   → AC-1, AC-6, AC-10, AC-22   → test_get_tour_meta_zero_llm
- [x] T13  GET tour + POST generate deny cross-workspace access (repo resolved via `reposRepo.getById(workspaceId, repoId)`, `getContext` guard)   → AC-20   → test_onboarding_workspace_scoping

### Phase 4 — Client: shared primitives (copy hook, CollapsibleCard, OnThisPage TOC)   (parallel-safe)
- **Surface:** client (UI) + cross-cutting (a11y)
- **Disjoint scope:** NEW `client/src/vendor/ui/hooks/useCopyToClipboard.ts`, NEW
  `client/src/vendor/ui/CollapsibleCard.tsx` (+ its barrel export), NEW
  `client/src/vendor/ui/OnThisPage.tsx` (+ barrel export), and the light refactor of the 3 existing
  copy call sites to consume the hook (`RunTraceDrawer.tsx:51-59`, `PromptBlock.tsx:41-46`,
  `LiveLogStream.tsx:36-43` — behavior-preserving). Does NOT touch the onboarding page, module, nav,
  or i18n JSON. (The 3 refactored files are owned solely by this phase.)
- **Skills to apply:** `react-frontend-architecture`, `react-best-practices` (no render factories,
  keyboard-operable, `aria-*`), `next-best-practices`, `react-testing-library` (tests).
- **What changes & why:** the net-new reusable primitives the tour needs (CP-9, CP-10).
  `useCopyToClipboard` de-dups the 3 inline implementations into one hook (used by AC-17 command
  copy + AC-21 Share). `CollapsibleCard` is a fresh keyboard-operable collapsible (`TraceSection`
  is private cross-feature) with coloured round icon + title + chevron, `aria-expanded`,
  Enter/Space toggle (AC-12, AC-19). `OnThisPage` is a fresh in-page TOC: seven anchors, active
  marked via IntersectionObserver/scroll, `aria-current` + `aria-live` announce, keyboard-navigable
  (AC-12, AC-19).
- **How to test:** `cd client && pnpm test` — RTL: hook copies + toggles `copied` and resets;
  CollapsibleCard toggles on click AND Enter/Space with correct `aria-expanded`; OnThisPage marks
  the active anchor and is keyboard-navigable; the 3 refactored sites still copy.
- [x] T14  `useCopyToClipboard` copies text to the clipboard and flips a `copied` flag that resets; the 3 former inline copy sites now use it with unchanged behavior   → AC-17, AC-21   → test_use_copy_to_clipboard
- [x] T15  `CollapsibleCard` collapses/expands on chevron click AND via keyboard (Enter/Space), exposing correct `aria-expanded`   → AC-12, AC-19   → test_collapsible_card
- [x] T16  `OnThisPage` renders section anchors, marks the active section (`aria-current` + announce), and is keyboard-operable   → AC-12, AC-19   → test_on_this_page_toc

### Phase 5 — Client: Onboarding Tour page, sections, generate/regenerate/share, data hooks   (depends on: Phase 1, Phase 4; API-parallel with Phase 3)
- **Surface:** client (UI) + cross-cutting (a11y)
- **Disjoint scope:** NEW `client/src/app/repos/[repoId]/onboarding-tour/` (page.tsx +
  `_components/OnboardingTourView/` incl. per-section renderers for `architecture` diagram,
  `reading_path` numbered Open rows, `getting_started` copy rows, and narrative cards); NEW
  `client/src/lib/hooks/onboarding-tour.ts`; APPEND the two functions to `client/src/lib/api.ts`
  only if a helper is missing (the generic `api.get/post` already exist — prefer reuse). Does NOT
  touch nav/helpers (Phase 6), i18n JSON (Phase 7), or the Phase 4 primitive source files (imports
  them). References i18n keys by name (Phase 7 provides the values).
- **Skills to apply:** `react-frontend-architecture`, `react-best-practices`, `next-best-practices`
  (RSC page/`use client` view boundary), `react-testing-library` (tests).
- **What changes & why:** the surface. (a) The page (CP-7): breadcrumb `owner/repo › Onboarding
  Tour`, `H1` `Onboarding for <repo>` (repo name as code), meta line `Generated from index of N
  files · last refreshed X ago`, `OnThisPage` TOC, seven `CollapsibleCard`s in fixed order (AC-1,
  AC-12); loading (AC-13), no-tour empty state + **Generate** (AC-6), degraded fact-only skeleton +
  degraded badge (AC-9), staleness indicator (AC-10). (b) `architecture` card renders the model
  `diagram` via `MermaidDiagram` (drops invalid → AC-16) + `Markdown` body. (c) `reading_path` card:
  numbered rows (blue badge + mono path + role line + rationale + **Open** → existing file/diff
  viewer, AC-17); order = the response order (facade-authoritative, AC-3). (d) `getting_started`
  card: command rows with `useCopyToClipboard` copy buttons (AC-17). (e) `overview`/`key_modules`/
  `conventions_gotchas`/`first_tasks` narrative `Markdown` cards; `first_tasks` renders up to ~4
  links. (f) **Regenerate** (`useGenerateOnboardingTour`, CP-8) with a progress affordance + disabled
  control while pending (AC-7); (g) **Share link** copies the page's workspace URL + toast, no public
  link (AC-21). All model body rendered via `Markdown` (data, no script — AC-16). Data hooks per CP-8;
  the active repo drives the query so a repo switch shows the current repo (AC-11).
- **How to test:** `cd client && pnpm test` (Vitest + jsdom, fetch mocked, `NextIntlClientProvider`)
  — RTL per state; e2e (deterministic) in `e2e/` where the spec's Traceability marks e2e (AC-1,
  AC-6, AC-7, AC-11, AC-12, AC-13, AC-17, AC-21).
- [x] T17  Stored tour renders seven ordered section cards + breadcrumb `owner/repo › Onboarding Tour` + `H1 Onboarding for <repo>` + meta line (index file count + relative last-refreshed)   → AC-1   → test_tour_page_populated
- [x] T18  No stored tour → friendly empty state with a **Generate** action; opening the page makes NO generation call   → AC-6   → test_tour_empty_generate
- [x] T19  While a generation is pending, a progress affordance shows and the Generate/Regenerate control is disabled   → AC-7   → test_tour_generating_progress
- [x] T20  Repo switched while a generation is pending → the page shows the currently selected repo's tour (query keyed by repoId), no cross-repo bleed   → AC-11   → test_tour_repo_switch
- [x] T21  Loading the stored tour shows a loading state (not blank, not error)   → AC-13   → test_tour_loading_state
- [x] T22  Degraded index → deterministic fact-only skeleton + visible degraded badge (never empty, never fabricated)   → AC-9   → test_tour_degraded_skeleton
- [x] T23  Stored tour older than the latest index refresh → staleness indicator shown; no auto-regenerate   → AC-10   → test_tour_staleness_indicator
- [x] T24  `architecture` card renders the model mermaid via `MermaidDiagram` (invalid dropped, section still renders); all bodies via `Markdown` as data (no script)   → AC-16   → test_tour_diagram_and_markdown_safe
- [x] T25  `reading_path` rows render in the response (facade) order with Open → file/diff viewer; `getting_started` command rows copy to clipboard   → AC-3, AC-17   → test_tour_reading_path_and_copy
- [x] T26  TOC anchor scroll + active mark and per-card chevron collapse/expand work (page-level wiring of the Phase-4 primitives)   → AC-12   → test_tour_toc_and_cards
- [x] T27  **Share link** copies the current page's internal workspace URL + confirmation toast; creates no public link   → AC-21   → test_tour_share_link
- [x] T28  Page a11y: keyboard-operable TOC + cards, correct focus order, active-section announced (aria-live), copy/Share confirmed accessibly   → AC-19   → test_tour_a11y

### Phase 6 — Client: sidebar nav item + active-key fix   (parallel-safe)
- **Surface:** client (UI)
- **Disjoint scope:** `client/src/vendor/ui/nav.ts` (new WORKSPACE item + SHORTCUTS entry) and
  `client/src/components/app-shell/helpers.ts` (`activeKeyFor` fix). Does NOT touch the page, module,
  primitives, or i18n JSON.
- **Skills to apply:** `react-frontend-architecture`, `react-best-practices`, `react-testing-library`
  (tests).
- **What changes & why:** add the "Onboarding Tour" WORKSPACE nav item BETWEEN `pulls` and `context`
  with `key: "onboarding-tour"`, an icon, and `href: "/repos/:repoId/onboarding-tour"` (CP-11, AC-23);
  fix `activeKeyFor` so ONLY `/onboarding-tour` highlights the new item and the add-repo `/onboarding`
  wizard does not (recommendation 1). The Sidebar already highlights via `ctx.activeKey === it.key`
  and resolves `:repoId` — no Sidebar change needed.
- **How to test:** `cd client && pnpm test` — the existing `Sidebar.test.tsx` pattern: the new item
  renders between Pull Requests and Project Context; `aria-current="page"` when active; `activeKeyFor`
  returns `"onboarding-tour"` for `/repos/x/onboarding-tour` and NOT for `/onboarding`.
- [x] T29  WORKSPACE sidebar shows an "Onboarding Tour" item (with icon) between "Pull Requests" and "Project Context", active while the tour page is open, navigating to the selected repo's tour on activation; the add-repo `/onboarding` wizard does not highlight it   → AC-23   → test_sidebar_onboarding_item

### Phase 7 — i18n strings (en expand + uk mirror)   (depends on: Phase 5, Phase 6)
- **Surface:** client (i18n) + cross-cutting (i18n)
- **Disjoint scope:** `client/messages/en/onboarding.json` (expand) + NEW
  `client/messages/uk/onboarding.json`. Does NOT touch component code (Phases 5/6 reference keys).
- **Skills to apply:** `next-best-practices`, `typescript-expert`.
- **What changes & why:** every new user-facing string via next-intl in `en` AND `uk` (AC-18). Expand
  the `en` stub (currently 5-section, `onboarding.json:1-17`) to cover the seven section titles, the
  meta line, Generate/Regenerate/Share, empty/loading/error/degraded/stale, TOC label ("ON THIS PAGE"),
  and copy/Share confirmations; create the `uk` mirror (does not exist yet). Model-authored body text
  is CONTENT (generated in the configured language), not a UI string (AC-18). Per recommendation 2,
  the app is single-locale at runtime today, so the `uk` file is forward-looking.
- **How to test:** manual — every new string present in both `en` and `uk`; grep the new components
  for hardcoded literals (none).
- [x] T30  All new user-facing strings sourced from next-intl in `en` AND `uk` (7 sections + chrome + confirmations); no hardcoded UI text; model body text remains content   → AC-18   → test_i18n_en_uk

## Traceability matrix

| AC   | Task(s)         | Test                                   | Commit |
|------|-----------------|----------------------------------------|--------|
| AC-1 | T2, T12, T17    | test_tour_page_populated               | —      |
| AC-2 | T6              | test_generate_one_call_upsert          | —      |
| AC-3 | T4, T25         | test_facts_assembler                   | —      |
| AC-4 | T5              | test_facts_ranking_pagerank            | —      |
| AC-5 | T3, T7          | test_generate_diagram_only_architecture| —      |
| AC-6 | T2, T12, T18    | test_tour_empty_generate               | —      |
| AC-7 | T19             | test_tour_generating_progress          | —      |
| AC-8 | T8              | test_generate_single_flight            | —      |
| AC-9 | T1, T2, T11, T22| test_degraded_facts_only               | —      |
| AC-10| T2, T12, T23    | test_tour_staleness_indicator          | —      |
| AC-11| T8, T20         | test_tour_repo_switch                  | —      |
| AC-12| T15, T16, T26   | test_tour_toc_and_cards                | —      |
| AC-13| T21             | test_tour_loading_state                | —      |
| AC-14| T9              | test_generate_failure_no_persist       | —      |
| AC-15| T3, T10         | test_facts_untrusted_wrapping          | —      |
| AC-16| T3, T24         | test_tour_diagram_and_markdown_safe    | —      |
| AC-17| T14, T25        | test_tour_reading_path_and_copy        | —      |
| AC-18| T30             | test_i18n_en_uk                        | —      |
| AC-19| T15, T16, T28   | test_tour_a11y                         | —      |
| AC-20| T13             | test_onboarding_workspace_scoping      | —      |
| AC-21| T14, T27        | test_tour_share_link                   | —      |
| AC-22| T1, T4, T6, T12 | test_get_tour_meta_zero_llm            | —      |
| AC-23| T29             | test_sidebar_onboarding_item           | —      |

<Commit is "—" at planning time; implementers fill it as tasks land; plan-verifier audits
AC↔task↔test coverage against this table. Bidirectional coverage verified: every AC-1…AC-23 has
≥1 task, and every T1…T30 cites ≥1 AC.>

## Risks & mitigations

- **`activeKeyFor` `/onboarding` collision (Phase 6).** The broad `includes("/onboarding")` already
  in the code (`helpers.ts:29`) would highlight the new item while the add-repo wizard is open.
  Mitigation: Phase 6 narrows the match to `/onboarding-tour`; a Sidebar test asserts the wizard
  route does NOT highlight it.
- **The shared `onboarding.system.md` prompt is edited (Phase 2).** It is used ONLY by this feature's
  generation, so blast radius is contained; but a malformed `{{sections}}` framing degrades output.
  Mitigation: Phase 2 is a lone-file slice with a template unit test (T3); the `{{language}}` and
  untrusted/mermaid rules are preserved verbatim.
- **The `Onboarding` schema is reused unchanged, but the model must emit exactly seven ordered
  sections with `diagram` non-null only for `architecture`.** The schema does not enforce this
  (kind is free-form). Mitigation: prompt framing (T3) + service-side assertion/normalization + tests
  (T7); an invalid diagram is dropped at render regardless (AC-16, reused `MermaidDiagram`).
- **Two vendored copies of `@devdigest/shared` (server + client).** The server copy is the single
  source of truth; the mirror is produced by `node scripts/sync-shared.mjs` and CI fails on drift
  (`--check` in `client.yml`) — hand-editing the client copy is the failure mode to avoid.
  Mitigation: Phase 1 authors server-side only, then syncs; T2 asserts identical shapes.
- **Single-flight is process-global (container singleton).** Correct for the single-process app; a
  multi-process deploy would need a Postgres advisory lock (out of scope, matches repo-intel's
  documented posture). Mitigation: note only; not this feature's concern.
- **AC-18 i18n vs single-locale runtime.** `uk` JSON ships as forward-looking (not loaded today).
  Mitigation: recommendation 2 — escalate to the caller only if live `uk` selection is wanted (a
  separate feature).
- **Migration is NOT needed (existing `onboarding` table).** Risk is only that an implementer wrongly
  adds one. Mitigation: called out in CP-6 and Phase 3 — reuse the table, add no migration.

## Critical files for implementation

- `server/src/modules/onboarding-generator/service.ts` (NEW) — the generation authority: facts (0 LLM)
  → single-flight → one `completeStructured<Onboarding>` → upsert; getTour meta + degraded/stale.
- `server/src/modules/onboarding-generator/facts.ts` (NEW) — the pure analyzer over the `repoIntel.*`
  facade; reading_path order is fixed here (AC-3), `rank=pagerank` (AC-4), degrade-not-throw (AC-9).
- `server/src/prompts/onboarding.system.md` — the seven-section framing + reading-path cap + retained
  untrusted/mermaid-safety rules (Phase 2).
- `client/src/app/repos/[repoId]/onboarding-tour/_components/OnboardingTourView/OnboardingTourView.tsx`
  (NEW) — the page: seven cards + TOC + Generate/Regenerate/Share + degraded/stale/loading/empty.
- `server/src/vendor/shared/contracts/onboarding-api.ts` (NEW, mirrored to client via
  `node scripts/sync-shared.mjs`) — the API + facts boundary shapes (`Onboarding` itself is
  reused unchanged).

## Open questions / assumptions

*Non-blocking (a sensible default is taken; each is called out for the caller):*

- **Assumption (i18n runtime):** the `uk` half of AC-18 ships as `messages/uk/onboarding.json`
  following the existing per-namespace convention; the app stays single-locale (`en` loaded at
  runtime) — live multi-locale wiring is out of scope (not in the spec's Goals). Reversible to a
  follow-up if the caller wants live `uk` selection.
- **Assumption (`activeKeyFor` fix):** narrowing the match from `/onboarding` to `/onboarding-tour`
  is a safe, behavior-preserving change for the add-repo wizard (which had a broad match before);
  implementers verify the wizard's own highlight is unaffected.
- **Assumption (facts field naming):** `rankedFiles` carries `percentile` (from `getFileRank`), the
  concrete facade shape, paired with `getTopFilesByRank`'s order; the spec's `{ path, rank }` is read
  as "path + rank metadata". Display/ordering only — not design-blocking.
- **Assumption (repo/container wiring):** the onboarding repository is constructed the same way the
  sibling `project-context` module does (a container getter or in-service construction) — follow the
  sibling's exact choice; either satisfies the Onion rule (DB only in the repository).
- **Assumption (Open target for `reading_path`/`first_tasks` links):** "Open" routes to the existing
  file/diff viewer for the repo (AC-17); the concrete route is whatever the repo's file viewer uses
  today — implementers reuse it rather than inventing a new viewer.
- **Assumption (nav icon + gKey):** a sensible icon from the existing `IconName` set and an unused
  `gKey` (e.g. `o`) are chosen by the implementer; the item `key` MUST be `"onboarding-tour"` to match
  the existing `activeKeyFor` switch value.
