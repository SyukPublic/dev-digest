# Development Plan: Why+Risk Brief

- **Spec:** docs/specs/SPEC-2026-07-05-why-risk-brief.md (Status: approved, AC-1…AC-21)
- **Execution mode:** multi-agent (implementer wave(s) over disjoint slices → test-writer gap pass → green barrier → architecture-reviewer ∥ plan-verifier)

## Context

A reviewer opening a PR today reconstructs the "so what" by hand — reads the diff,
guesses intent, mentally traces blast radius, decides where to look first.
DevDigest already computes the raw material (stored **Intent** `pr_intent`, the
deterministic **blast** impact map, the **smart-diff** reviewer-ordered groups,
the linked **issue**, the project **specs** attached to reviewer agents/skills)
but never fuses it into one human answer. **Why+Risk Brief** is that fusion: a
new `POST /pulls/:id/brief` assembles its input entirely from ALREADY-computed
artifacts (no diff hunks / file contents), makes **exactly one** structured LLM
call returning `Brief { what, why, risk_level, risks[], review_focus[] }`, grounds
every path to a REAL file, and persists it per PR in a NEW table. Re-opening the
PR serves the cached brief with **zero** LLM calls; a **Regenerate** button
recomputes it; an **Outdated** badge flags input drift.

One-line goal: **build the producer + three UI surfaces on top of already-computed
facts**, following the house pattern *"code collects the facts, the model writes
the narrative"* — a new PR BRIEF card (body from the brief, header COMPOSED from
the latest review, zero extra LLM), a full-width REVIEW FOCUS list, and the INTENT
card's RISK AREAS rewired from the standalone `Risks` artifact to the brief's
`risks[]`.

This plan is built on facts verified by reading the code this session:
- The `onboarding-generator` module is an EXACT structural template for a
  single-flight-behind-workspace-guard generation + upsert (`server/src/modules/onboarding-generator/{service,routes,repository}.ts`).
- `Risk` (`{ kind, title, explanation, severity, file_refs: string[] }`) and the
  `RiskSeverity` enum (`high|medium|low`) already exist and are reused UNCHANGED
  (`server/src/vendor/shared/contracts/brief.ts:47-57`) — so `risk_level` = the
  same three values, no `critical` (spec resolved decision). `file_refs` is a
  plain `string[]`, so the line-range travels INSIDE the string (e.g.
  `src/mw/ratelimit.ts:12-18`); grounding validates the PATH portion (AC-4/5).
- The EXISTING `pr_brief` table stores the raw `Risks` payload, read via
  `Risks.parse` (server INSIGHTS 2026-06-26) — the Why+Risk Brief lives in a
  SEPARATE NEW table (`pr_why_risk_brief`), leaving `pr_brief` untouched (spec
  Non-goal). `pull_requests` carries `head_sha`/`base`/`title`/`body`
  (`server/src/db/schema/pulls.ts:5-34`) for the freshness key.
- `FeatureModelId` (`server/src/vendor/shared/contracts/platform.ts:14-21`) is the
  single enum that drives the Settings model picker (Settings iterates
  `FEATURE_MODELS`). Adding one enum value + one `FEATURE_MODELS` entry makes the
  brief's model selectable automatically (additive). NOTE: the existing
  `risk_brief` slot belongs to the LEGACY `analyzeRisks` path — the Why+Risk Brief
  needs its OWN new slot, `why_risk_brief`.
- `freshness.ts` (`server/src/modules/reviews/freshness.ts`) is the freshness-key
  discipline to mirror: a pure `sha256([...ordered inputs])`, computed on write AND
  read from the SAME ordered parts (symmetry is the correctness invariant); NULL
  stored key ⇒ NOT stale.
- The card HEADER is COMPOSED client-side from data ALREADY on the page: verdict /
  score / findings from `usePrReviews` (`["reviews", prId]`,
  `client/src/lib/hooks/reviews.ts:53-59`); cost + tokens from the runs query
  (`usePrRuns`) — because `ReviewRecord` carries verdict/score/findings but NOT
  cost/tokens (`server/src/vendor/shared/contracts/review-api.ts:32-46`). Zero
  extra LLM (AC-7).
- Reusable primitives already exist: `CircularScore`
  (`client/src/vendor/ui/primitives/CircularScore.tsx`) — the PR SCORE gauge
  (needs an a11y text equivalent added, AC-18); `CollapsibleCard`
  (`client/src/vendor/ui/CollapsibleCard.tsx`) — keyboard-operable `aria-expanded`
  expander for RISK AREAS + info affordance; `RunCostBadge` + `formatCost`
  (`client/src/components/run-cost-badge/RunCostBadge.tsx`, `lib/format.ts`);
  `githubBlobUrl` + `MonoLink` for out-of-diff links, `scrollToLine` for in-diff
  (client INSIGHTS 2026-06-30); `Markdown`/`Badge`/`EmptyState`/`Skeleton`/`ErrorState`.

## Requirements review & recommendations

**Both required inputs were supplied (approved spec + `multi-agent`), so no
interview round-trip was needed. All 21 ACs are testable as written; no
contradiction that changes the design was found.** Findings surfaced during
grounding, folded into the plan as recommendations + explicit assumptions (a
sensible default exists for each; none is design-blocking):

1. **New `FeatureModelId` slot, NOT the existing `risk_brief` (grounding
   correction, folded into Phase 1 + Phase 3).** The registry already has a
   `risk_brief` slot, but it drives the LEGACY standalone `analyzeRisks`
   (`server/src/modules/reviews/risks-service.ts:63`), which this feature leaves
   dead-but-present. The Why+Risk Brief is a DIFFERENT call over DIFFERENT input
   (digests, no patch), so it gets its own additive enum value **`why_risk_brief`**
   + a `FEATURE_MODELS` entry (mirrors the `onboarding`/`risk_brief` defaults).
   Reusing `risk_brief` would couple the two independent features' model choice.

2. **The card HEADER draws from TWO existing queries, not one (grounding
   correction, folded into Phase 6).** `ReviewRecord` has `verdict`/`score`/
   `findings[]` but NO `cost_usd`/tokens (`review-api.ts:32-46`); per-run cost/
   tokens live on `agent_runs` (server INSIGHTS 2026-06-19/06-20). So the header
   composes verdict/score/"N findings · M blockers" from the latest ACTUAL review
   (`reviews.find(r => r.review.kind === 'review')`, server INSIGHTS 2026-06-26 —
   NOT `[0]`, which may be a summary) via `usePrReviews`, and the cost line from
   the matching run in `usePrRuns`. Both are ALREADY fetched on the PR page → zero
   extra fetch, zero LLM (AC-7). "M blockers" = the CRITICAL-severity finding count.

3. **`Brief.risks[]` reuses `Risk` UNCHANGED; the line-range lives in the
   `file_refs` string (grounding, folded into Phase 1 + Phase 5).** `Risk.file_refs`
   is `z.array(z.string())` (`brief.ts:55`) — there is NO structured
   `{path,start,end}`. The spec's "file:line-range link" is therefore a `file_refs`
   entry like `src/config.ts:12-18`; the client parses `path:range` at render, and
   server grounding (AC-4/5) validates the PATH portion against the real input file
   set (drop/repair the whole entry when the path is invented). `ReviewFocusItem`
   IS a new structured shape (`{ path, line?, reason }`) — a genuinely new contract.

4. **i18n `en` + `uk` (AC-17) vs. a single-locale runtime (spec-level note,
   non-blocking).** The client is single-locale at runtime (`LOCALE = "en"`, no
   locale routing; client INSIGHTS pattern). `messages/en/brief.json` EXISTS with
   the legacy intent/risks strings; **`messages/uk/brief.json` does NOT exist**
   (only `uk/context.json` + `uk/onboarding.json`). AC-17's satisfiable
   deterministic reading, matching the `context`/`onboarding` precedent: EXTEND
   `messages/en/brief.json` with the new strings AND create a NEW
   `messages/uk/brief.json` mirror (forward-looking, not loaded at runtime today).
   **Recommendation:** this is the default the plan takes; wiring live `uk`
   selection is out of scope (not in the spec's Goals). Flag to the caller if live
   multi-locale is wanted.

5. **The `pr_brief`/`Risks` endpoints + `analyzeRisks` stay DEAD-BUT-PRESENT (spec
   resolved decision, folded into Phase 7).** The plan REWIRES `IntentCard`'s
   RISK AREAS + `handleRecompute` to the brief, so `IntentCard` stops calling
   `usePrRisks`/`useRecomputeRisks` — but the plan does **NOT** delete those hooks,
   the `GET/POST /pulls/:id/risks` routes, or `analyzeRisks`. Removal is a separate
   follow-up. (`usePrIntent`/`useRecomputeIntent` remain in use for the intent
   summary + scope lists — only the RISK AREAS ownership + the risks half of
   `handleRecompute` move to the brief.)

6. **"Outdated" tooltip caveat is mandatory copy (AC-14, folded into Phase 6/8).**
   The freshness key deliberately EXCLUDES the linked issue and attached-spec
   contents (including them forces a network/clone read on every GET, and write/
   read keys must hash identical inputs). The Outdated badge tooltip MUST state
   that editing the linked issue or attached specs does NOT flag Outdated
   (Regenerate refreshes) — this surfaces the documented limitation.

## Affected packages & files

- **`server/src/vendor/shared/contracts/why-risk-brief.ts`** — NEW file (never edit
  the barrel): `Brief`, `ReviewFocusItem`, the brief input bundle
  (`BriefInputBundle`), and the brief read record (`WhyRiskBriefRecord` = `Brief` +
  `pr_id` + `is_stale` + `generated_at`, mirroring `PrIntentRecord`). `Risk`/`Intent`
  reused unchanged. Barrel gets ONE append-only `export *` line in
  `server/src/vendor/shared/index.ts` (the documented "extend with new files" path).
  Then `node scripts/sync-shared.mjs` regenerates the client mirror.
- **`server/src/vendor/shared/contracts/platform.ts`** — additive: one enum value
  `'why_risk_brief'` on `FeatureModelId` (14-21) + one `FEATURE_MODELS` entry
  (44-87). Also mirrored to the client copy via the sync script. (This is the one
  existing contract file the plan appends to — additive enum values are the
  documented additive-change path; no field/shape is edited in place.)
- **`server/src/db/schema/reviews.ts`** — APPEND a NEW `prWhyRiskBrief` table
  (`pr_id` PK → `pull_requests` cascade, `workspace_id`, `json` jsonb,
  `generated_at` timestamptz default now, `freshness_key` text nullable). Its own
  migration via `pnpm db:generate` (MANUAL `pnpm db:migrate`). Register the table
  in the `db/schema.ts` barrel import line (34).
- **`server/src/prompts/why-risk-brief.system.md`** — NEW prompt template (mirrors
  `onboarding.system.md`): untrusted-data framing, real-path grounding rules,
  markdown-only output, `{{language}}` slot.
- **`reviewer-core/src/why-risk-brief/brief-prompt.ts`** — NEW pure prompt builder
  + `BRIEF_PROMPT_VERSION` constant (mirrors `risks/risks-prompt.ts`); exported via
  `reviewer-core/src/index.ts`. Keeps reviewer-core pure (no I/O); the hash lives
  in the server. NOTE: the plan builds the prompt as a pure builder in reviewer-core
  for the version constant + injection guard; the template file above holds the
  system-prompt TEXT rendered via `renderPrompt` (either home is acceptable per the
  onboarding precedent — the constant + guard MUST live in reviewer-core).
- **`server/src/modules/brief/`** — NEW feature module: `routes.ts` (GET brief +
  POST generate; `getContext` guard on both), `service.ts` (single-flight per PR +
  input assembler + one `completeStructured` call + real-path grounding + upsert +
  on-read freshness), `repository.ts` (read/upsert `pr_why_risk_brief`),
  `assembler.ts` (pure input-bundle builder over the facades), `grounding.ts` (pure
  real-path drop/repair), `freshness.ts` (pure `briefFreshnessKey`), `constants.ts`.
  Registered by ONE line in `server/src/modules/index.ts`.
- **`client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/`** — NEW
  top-of-Overview card (body from brief, header composed from review+runs), a
  Regenerate icon button, an info affordance, an Outdated badge, a PR SCORE gauge
  with a text equivalent, empty/partial states.
- **`client/src/app/repos/[repoId]/pulls/[number]/_components/ReviewFocusSection/`**
  — NEW full-width "REVIEW FOCUS — READ THESE FIRST" ordered list + count badge.
- **`client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`**
  — insert `<PrBriefCard prId>` above `.brief-grid` (27) and `<ReviewFocusSection prId>`
  full-width below the grid + Description (25-38).
- **`client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/IntentCard.tsx`**
  — REWORK RISK AREAS to render the brief's `risks[]` (file:line links + expander
  chevron) instead of `risksRecord`; rewire `handleRecompute` risks half to the
  brief Regenerate. Keep the intent summary + scope lists + `usePrIntent`/
  `useRecomputeIntent` as-is.
- **`client/src/lib/hooks/brief.ts`** (NEW) + **`client/src/lib/api.ts`** —
  `useBrief` / `useRegenerateBrief` (mirror `onboarding-tour.ts` hook pair).
- **`client/messages/en/brief.json`** (extend) + **`client/messages/uk/brief.json`**
  (NEW mirror).
- **Reuse (do not re-create):** `CircularScore`, `CollapsibleCard`, `RunCostBadge`,
  `formatCost`/`formatTokensTotal`, `githubBlobUrl`/`MonoLink`, `scrollToLine`
  pattern, `Markdown`/`Badge`/`EmptyState`/`Skeleton`/`ErrorState`; server
  `getContext` guard; `container.reviewRepo.getPull`/`getPrFiles` (workspace guard
  for a PR); `resolveFeatureModel` + `container.llm(provider).completeStructured`;
  `renderPrompt`; `container.blast`/`container.smartDiff` facades;
  `parseLinkedIssueRef` + `container.github().getIssue`; project-context spec
  resolver (`resolveSpecPathsForAgent`/`readSpecsForRun`); `formatIntentForPrompt`.

## Shared scaffold (context pack)

Parallel implementers MUST use these verbatim fragments instead of re-opening the
source files. Citations point to the source of record.

### CP-1 — Feature module: routes plugin shape (PR-scoped). `server/src/modules/onboarding-generator/routes.ts:24-45`
```ts
const PrParams = z.object({ id: z.string().uuid() });

export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new BriefService(app.container);

  app.get(
    '/pulls/:id/brief',
    { schema: { params: PrParams, response: { 200: WhyRiskBriefRecord.nullable() } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);   // AC-16 guard
      return service.getBrief(workspaceId, req.params.id);
    },
  );
  app.post(
    '/pulls/:id/brief',
    { schema: { params: PrParams, response: { 200: WhyRiskBriefRecord } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);   // AC-16 guard
      return service.generate(workspaceId, req.params.id);
    },
  );
}
```
`getContext(app.container, req)` is the AC-16 workspace guard — call it in EVERY
handler (`server/src/modules/_shared/context.ts`). The PR is resolved
workspace-scoped IN the service via `container.reviewRepo.getPull(workspaceId, id)`
→ 404 if missing/foreign (the pattern `blast`/`smart-diff` use,
`server/src/modules/blast/service.ts:66`). Handlers stay a thin edge (onion rule 6).
NOTE the route uses `:id` (PR uuid) per the spec's `POST /pulls/:id/brief`.

### CP-2 — Service: single-flight per PR BEHIND the workspace guard. `server/src/modules/onboarding-generator/service.ts:53,94-99,154-169` + server INSIGHTS 2026-07-05
```ts
private readonly generating = new Map<string, Promise<WhyRiskBriefRecord>>();

async generate(workspaceId: string, prId: string): Promise<WhyRiskBriefRecord> {
  await this.assertPull(workspaceId, prId);          // AC-16 BEFORE coalescing
  return this.runExclusive(prId, () => this.runGeneration(workspaceId, prId));
}

private runExclusive(prId: string, run: () => Promise<WhyRiskBriefRecord>) {
  const active = this.generating.get(prId);
  if (active) return active;                          // AC-11 coalesce to in-flight
  const p = (async () => { try { return await run(); } finally { this.generating.delete(prId); } })();
  this.generating.set(prId, p);
  return p;
}
```
The guard-BEFORE-coalesce order is LOAD-BEARING (server INSIGHTS 2026-07-05): a
foreign-workspace caller must 404 and must NOT coalesce onto another tenant's
in-flight promise. Single-flight is keyed by `prId` (not repoId). The service is a
container singleton → the map is process-global (correct for the single-process app).

### CP-3 — Service: resolve feature model → ONE structured LLM call. `server/src/modules/reviews/risks-service.ts:63-71` + `onboarding-generator/service.ts:120-138`
```ts
const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'why_risk_brief');
const llm = await this.container.llm(provider);
const res = await llm.completeStructured<Brief>({
  model,
  schema: Brief,                 // NEW contract from @devdigest/shared
  schemaName: 'Brief',
  messages: [
    { role: 'system', content: system },        // renderPrompt('why-risk-brief.system.md', { language })
    { role: 'user', content: buildBriefBlock(bundle) },  // inputs as UNTRUSTED data (AC-21)
  ],
});
// res.data is Zod-validated Brief; res.tokensIn/tokensOut/costUsd available.
```
This is the SINGLE LLM call per generation (AC-19). `completeStructured` reprompts/
retries internally; on failure/invalid-after-retries it THROWS → the service does
NOT persist, leaves the prior brief intact, and the error surfaces (AC-13). Zero
embedding calls anywhere (AC-19). Signatures:
`StructuredRequest`/`StructuredResult` (`server/src/vendor/shared/adapters.ts:55-80`),
`resolveFeatureModel` (`server/src/modules/settings/feature-models.ts:51-57`).

### CP-4 — Input assembler: already-computed artifacts, NO diff bodies (AC-1, AC-12).
Pure `assembler.ts` builds the `BriefInputBundle` best-effort — each source dropped
(not thrown) on absence/error (AC-12). Sources + read paths:
- **Intent** — `container.reviewRepo.getIntent(prId)` (`server/src/modules/reviews/repository/pull.repo.ts`); render via `formatIntentForPrompt` (`@devdigest/reviewer-core`).
- **Blast summary + REAL files/callers/endpoints** — `container.blast.getBlast(workspaceId, prId)` → `BlastRadius { changed_symbols[].file, downstream[].{callers[].{file,line}, endpoints_affected, crons_affected}, summary }` (`brief.ts:16-44`, `server/src/modules/blast/service.ts:62`). This is the grounding source for real paths (AC-4).
- **Smart-diff per-group stats** — `container.smartDiff.getSmartDiff(workspaceId, prId)` → `SmartDiff { groups[].{role, files[].{path,additions,deletions,finding_lines}} }` (`brief.ts:81-113`, `server/src/modules/smart-diff/service.ts:25`). Map `finding_lines.length` → `finding_count`; send NO `patch`/hunks.
- **Linked issue (best-effort)** — `parseLinkedIssueRef(pull.body)` (`server/src/lib/linked-issue.ts`) → `container.github().getIssue({owner,name}, n)` (`adapters.ts` `getIssue`); drop on error (server INSIGHTS 2026-06-25).
- **Specs (best-effort)** — union of specs on the workspace's ENABLED reviewer agents/skills via the project-context resolver (`resolveSpecPathsForAgent` + `readSpecsForRun`, `server/src/modules/project-context/service.ts`); drop on error.

**Invariant:** zero new diff parsing, NO raw patch (AC-1); everything wrapped as
untrusted data at prompt assembly (AC-21).

### CP-5 — Real-path grounding (AC-4/5). Pure `grounding.ts`.
```ts
// realPaths = set of every path present in the assembled bundle
//   (blast_files[].path + smart_diff_groups[].files[].path).
// For each risks[].file_refs entry "path:range": split off the ":range" suffix,
//   keep the entry IFF the PATH is in realPaths; drop the whole entry otherwise
//   (repair = keep only the surviving refs). A risk with NO surviving ref is
//   still persisted (title/explanation), just without a fabricated link.
// For each review_focus[].path: drop the item when path ∉ realPaths.
// The rest of the brief (what/why/risk_level, surviving risks/focus) is persisted.
```
This is a correctness AND safety control (Agentic ASI09 — validate generated
content before storing): the model cannot smuggle an arbitrary path into a rendered
link. Runs BEFORE persist, on the server, over the SAME `realPaths` the assembler built.

### CP-6 — Freshness key (mirror `reviews/freshness.ts:38-52`). Pure `briefFreshnessKey`.
```ts
export function briefFreshnessKey(p: {
  headSha: string; base: string; title: string; body: string;
  provider: string; model: string; promptVersion: number; intentKey: string;
}): string {
  return sha256([p.headSha, p.base, p.title, p.body, p.provider, p.model, p.promptVersion, p.intentKey]);
  // intentKey = storedIntent?.freshnessKey ?? '' — the storedIntent.freshnessKey input (AC-14).
}
```
The ORDER is load-bearing (write MUST hash the SAME ordered parts the read
recomputes). Computed on WRITE (stamp `freshness_key`) AND on READ (recompute from
the `pull` row + resolved model + `BRIEF_PROMPT_VERSION` + stored intent key — NO
network). `is_stale := storedKey != null && storedKey !== currentKey`; NULL stored
key ⇒ NOT stale (AC-14). Linked issue + attached specs are DELIBERATELY excluded
(spec Non-goal; caveat surfaced in the UI tooltip).

### CP-7 — Persistence: NEW table (mirror `pr_brief` shape + `workspace_id`). `server/src/db/schema/reviews.ts:80-100`
```ts
export const prWhyRiskBrief = pgTable('pr_why_risk_brief', {
  prId: uuid('pr_id').primaryKey().references(() => pullRequests.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  json: jsonb('json').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
  freshnessKey: text('freshness_key'),   // nullable → NULL treated NOT stale (AC-14)
});
```
SEPARATE from the existing `pr_brief` (which holds raw `Risks`, server INSIGHTS
2026-06-26) — do NOT touch `pr_brief`/`Risks` storage (spec Non-goal). Repository
`upsert(prId, workspaceId, json, freshnessKey)` = `insert … onConflictDoUpdate({
target: prWhyRiskBrief.prId, set: { json, generatedAt: now, freshnessKey } })` —
idempotent-upsert so two concurrent writes can't violate the PK (AC-11). All
Drizzle lives HERE (onion rule 4). Migration is MANUAL (`pnpm db:generate` then
`pnpm db:migrate`) — the pipeline generates the file, never auto-runs it; `.it.test.ts`
run migrations via `startPg()`/`seed()`.

### CP-8 — Card HEADER composed from the latest review + its run (client, 0 LLM). `client/src/lib/hooks/reviews.ts:42,53`
```ts
const { data: reviews } = usePrReviews(prId);   // ["reviews", prId]
const { data: runs } = usePrRuns(prId);         // ["runs", prId]
const latest = reviews?.find((r) => r.kind === 'review');  // NOT [0] (may be summary)
// header fields:
//   verdict = latest?.verdict ?? "—"                         (ReviewRecord.verdict)
//   score   = latest?.score   (→ <CircularScore> + text)     (ReviewRecord.score)
//   findings/blockers = latest.findings.length / #CRITICAL   (ReviewRecord.findings[])
//   cost/tokens = the run matched by latest.run_id           (agent_runs cost/tokens)
```
`ReviewRecord` (`review-api.ts:32-46`) carries verdict/score/findings but NOT
cost/tokens — the cost line uses `RunCostBadge`/`formatCost` over the matching run
(server INSIGHTS 2026-06-19/06-20). No review → every header field renders "—"
(AC-7). Zero extra fetch (both queries already on the PR page), zero LLM.

### CP-9 — Data hook pair (mirror). `client/src/lib/hooks/onboarding-tour.ts:30-37` + `client/src/lib/api.ts:89-100`
```tsx
export function useBrief(prId?: string | null) {
  return useQuery({
    queryKey: ["brief", prId],
    queryFn: () => api.get<WhyRiskBriefRecord | null>(`/pulls/${prId}/brief`),
    enabled: !!prId,
  });
}
export function useRegenerateBrief() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prId: string) => api.post<WhyRiskBriefRecord>(`/pulls/${prId}/brief`),
    onSuccess: (data, prId) => qc.setQueryData(["brief", prId], data),
  });
}
```
`api.get`/`api.post` are the typed wrappers (`api.ts:89-100`); the mutation's
pending state drives the AC-10 progress affordance + disabled Regenerate. Write the
authoritative response into the cache via `qc.setQueryData` (client INSIGHTS
2026-06-23 — `invalidateQueries` alone loses it on unmount).

### CP-10 — Reused UI primitives (do NOT rebuild).
- **PR SCORE gauge** — `CircularScore` (`client/src/vendor/ui/primitives/CircularScore.tsx`): `{ score, size, stroke }`, color ≥75 green / 50-74 amber / <50 red, score text centered. AC-18 needs a text equivalent ADDED (e.g. `aria-label`/visually-hidden "Score N of 100" — the numeric is rendered but the gauge needs a labelled text alternative).
- **Expander** — `CollapsibleCard` (`client/src/vendor/ui/CollapsibleCard.tsx`): keyboard-operable, toggles `aria-expanded`, chevron rotates. Use for each RISK AREAS row's explanation reveal (AC-3, AC-18) and the info affordance.
- **Cost** — `RunCostBadge` (`variant="withTokens"` = "N tok · $cost") + `formatCost` (`—` for null, never `$0.00`) (`RunCostBadge.tsx`, `lib/format.ts:10-22`). The spec's "$0.014 · 8.2K→1.3K" ordering (cost-first, arrow) may need a small header-local format over `formatCost` + `formatTokensTotal` — reuse the helpers, don't re-format inline.
- **File links** — in-diff: `scrollToLine(path, line)` (`SmartDiffViewer.tsx` scrollIntoView). Out-of-diff (blast caller / repo file): `githubBlobUrl(repoFullName, headSha, file, start, end)` → `MonoLink href` (new-tab `rel="noopener noreferrer"`) (`lib/github-urls.ts:24-37`, client INSIGHTS 2026-06-30). Both are safe protocols only (no `javascript:`) — AC-18/AC-21. `repoFullName` from `useActiveRepo`, `headSha` from `usePullDetail` (NOT a contract field).
- **States/content** — `Markdown` renders model text as DATA (no HTML/script, AC-21); `Badge` (color+icon+text, never color alone), `EmptyState` (Generate CTA), `Skeleton` (loading), `ErrorState`.

### CP-11 — Test conventions.
Server: `.it.test.ts` = DB-backed integration (`startPg()` + `seed()` + `buildApp({
config, db, overrides })` with mock adapters — mock `container.llm`, blast/smartDiff/
github facades); `.test.ts` = pure unit (direct instantiation, no DB) — run unit-only
`pnpm exec vitest run --exclude '**/*.it.test.ts'`. The pure assembler / grounding /
`briefFreshnessKey` are `.test.ts`; route + workspace-scoping + open=0-LLM are
`.it.test.ts`. Client: Vitest + jsdom, `fireEvent` (NOT user-event — client INSIGHTS
2026-06-24), wrap in `NextIntlClientProvider` + `ToastProvider`, mock the data hooks +
`next/navigation`; stub `scrollIntoView` (jsdom lacks it, INSIGHTS 2026-06-26). Run ALL
tests in WSL per project rules. reviewer-core: `pnpm test` (pure). Migrations are MANUAL —
this feature adds ONE (new table); `.it.test.ts` apply it via `seed()`/`startPg()`.

## Tasks

Task IDs are global. Phases group by dependency + parallelism; `parallel-safe`
phases can run concurrently in the first wave.

### Phase 1 — Shared contracts + FeatureModel slot (server + client mirror)   (parallel-safe)
- **Surface:** `@devdigest/shared` contracts (server + client mirror)
- **Disjoint scope:** NEW `server/src/vendor/shared/contracts/why-risk-brief.ts`;
  APPEND one `export *` line to `server/src/vendor/shared/index.ts`; ADD the
  `'why_risk_brief'` enum value + `FEATURE_MODELS` entry in
  `server/src/vendor/shared/contracts/platform.ts` (additive only); then run
  `node scripts/sync-shared.mjs` and commit the regenerated `client/src/vendor/shared/**`.
  Does NOT edit any existing contract body, any module, schema, or client component.
- **Skills to apply:** `zod`, `onion-architecture` (contracts = single source of
  truth at the boundary), `typescript-expert`.
- **What changes & why:** the NEW boundary shapes. `ReviewFocusItem` =
  `{ path: string, line: z.number().int().nullish(), reason: string }` (AC-2).
  `Brief` = `{ what: string, why: string, risk_level: z.enum(['high','medium','low']),
  risks: z.array(Risk) /* EXISTS, reused */, review_focus: z.array(ReviewFocusItem) }`
  (Contracts table). `BriefInputBundle` = the assembler shape (`intent` nullish,
  `blast_summary` nullish, `blast_files: {path,callers?,endpoints?}[]`,
  `smart_diff_groups: {role, files:{path,additions,deletions,finding_count}[]}[]`,
  `linked_issue` nullish, `specs: {path,content}[]`). `WhyRiskBriefRecord` = `Brief`
  extended with `pr_id`, `generated_at: string`, `is_stale: z.boolean().optional()`
  (mirror `PrIntentRecord`, `review-api.ts:76`). Add the `why_risk_brief`
  `FeatureModelId` value + `FEATURE_MODELS` def (label "Why+Risk Brief", a sensible
  default mirroring `risk_brief`). Export `z.infer` types. `.nullish()` on optional
  fields (recommendation 3; `zod` skill).
- **How to test:** `cd server && pnpm test` + `pnpm typecheck`, `cd client && pnpm typecheck`.
- [x] T1  `Brief` + `ReviewFocusItem` Zod schemas parse a valid brief (risks reuse `Risk`; `risk_level` ∈ high|medium|low; ordered `review_focus`) and reject a bad `risk_level`   → AC-2, AC-6   → test_brief_contract
- [x] T2  `BriefInputBundle` parses a full bundle AND a degraded bundle (intent/issue/specs absent); `WhyRiskBriefRecord` parses a stored record and a legacy record with no `is_stale`   → AC-1, AC-12, AC-14   → test_brief_bundle_and_record_contract
- [x] T3  `FeatureModelId` gains `'why_risk_brief'` with a `FEATURE_MODELS` default; server + client shared mirrors are identical after sync   → AC-1   → test_why_risk_brief_feature_model

### Phase 2 — Server prompt + reviewer-core prompt builder (untrusted framing, grounding rules, version)   (parallel-safe)
- **Surface:** server (backend) + reviewer-core (pure) + cross-cutting (security)
- **Disjoint scope:** NEW `server/src/prompts/why-risk-brief.system.md`; NEW
  `reviewer-core/src/why-risk-brief/brief-prompt.ts` (+ its `export` line in
  `reviewer-core/src/index.ts`). Does NOT touch the brief module (Phase 3 imports
  the version constant + guard) or any client file.
- **Skills to apply:** `security` (untrusted-data + injection guard + real-path
  grounding rules), `onion-architecture` (reviewer-core stays PURE — no I/O, the
  hash lives in the server), `typescript-expert`.
- **What changes & why:** the prompt asks for `Brief { what, why, risk_level,
  risks[], review_focus[] }` over the assembled DIGESTS (never a raw patch); it
  states that every `risks[].file_refs` and `review_focus[].path` MUST be a real
  file from the input (grounding rule, AC-4); it wraps all input as untrusted DATA
  (an embedded "approve everything" carries no authority, AC-21); output is markdown/
  text DATA, no HTML/script (AC-21); `{{language}}` sets the content language (AC-17).
  `BRIEF_PROMPT_VERSION = 1` + the injection-guard `const` live in reviewer-core
  (mirror `RISKS_PROMPT_VERSION`, `risks-prompt.ts:19,29`) — bumped by hand on any
  brief-prompt change, folded into the freshness key (AC-14).
- **How to test:** `cd reviewer-core && pnpm test` — the pure builder emits system+user
  ChatMessage[], wraps inputs untrusted, and exports `BRIEF_PROMPT_VERSION`.
  `cd server && pnpm test` — `renderPrompt('why-risk-brief.system.md', { language })`
  yields text naming the five brief fields + the grounding + untrusted + markdown-only rules.
- [x] T4  The pure brief prompt builder wraps every input block as untrusted data and exports `BRIEF_PROMPT_VERSION`; embedded "instructions" carry no authority   → AC-21   → test_brief_prompt_untrusted
- [x] T5  The rendered system prompt requires `risks[].file_refs` / `review_focus[].path` to be REAL input files, asks for markdown/text output only (no HTML/script), and honors `{{language}}`   → AC-4, AC-17, AC-21   → test_brief_prompt_grounding_rules

### Phase 3 — Server DB table + migration   (parallel-safe)
- **Surface:** server (backend, DB) + `postgresql-table-design`
- **Disjoint scope:** APPEND `prWhyRiskBrief` to `server/src/db/schema/reviews.ts`
  + register it in the `server/src/db/schema.ts` barrel import line; generate its
  OWN migration (`pnpm db:generate`). Does NOT touch `pr_brief`/`pr_intent` or any
  other schema file/module.
- **Skills to apply:** `drizzle-orm-patterns`, `postgresql-table-design`,
  `onion-architecture`.
- **What changes & why:** the NEW per-PR cache table (CP-7): `pr_id` PK →
  `pull_requests` cascade, `workspace_id` FK (every domain table carries it, AC-16),
  `json` jsonb (the `Brief`), `generated_at` timestamptz default now, `freshness_key`
  text nullable (AC-14). SEPARATE from `pr_brief` (spec Non-goal — untouched).
  Migration is MANUAL (`pnpm db:migrate`) — the plan generates the file, never runs
  it; call this out in the final report.
- **How to test:** `cd server && pnpm test` — an `.it.test.ts` that upserts + reads a
  brief row round-trips json + freshness_key; a second upsert overwrites by `pr_id` (AC-1, AC-11).
- [x] T6  `pr_why_risk_brief` table + migration: one row per PR (PK `pr_id`, cascade), `workspace_id`, `json`, `generated_at`, nullable `freshness_key`; `pr_brief` untouched   → AC-1, AC-11, AC-16   → test_brief_table_migration

### Phase 4 — Server: brief module (assembler + grounding + freshness + single-flight generation + persistence + routes)   (depends on: Phase 1, Phase 2, Phase 3)
- **Surface:** server (backend) + cross-cutting (security)
- **Disjoint scope:** NEW `server/src/modules/brief/` (`assembler.ts`, `grounding.ts`,
  `freshness.ts`, `repository.ts`, `service.ts`, `routes.ts`, `constants.ts`); the ONE
  registration line in `server/src/modules/index.ts`. Reads Phase 1 contracts, Phase 2
  prompt/version, Phase 3 table — owns no file any of them touch. Does NOT touch any
  client file or the legacy `risks-service`/`pr_brief`.
- **Skills to apply:** `onion-architecture` (module = routes→service→repository; DB
  only in repository; blast/smart-diff/github/llm ONLY via the container facades;
  assembler/grounding/freshness are PURE app logic), `fastify-best-practices`,
  `drizzle-orm-patterns`, `security` (untrusted inputs, real-path grounding,
  workspace scoping, guard-before-coalesce, no-secret-logging), `typescript-expert`.
- **What changes & why:** the producer.
  (a) `assembler.ts` — PURE builder of `BriefInputBundle` from the already-computed
  artifacts (CP-4), NO diff bodies/hunks (AC-1); each source dropped best-effort on
  absence/error, never throws (AC-12); everything destined for untrusted framing (AC-21).
  (b) `grounding.ts` — PURE real-path drop/repair of `risks[].file_refs` +
  `review_focus[].path` against the bundle's real file set (CP-5, AC-4/5).
  (c) `freshness.ts` — PURE `briefFreshnessKey` (CP-6, AC-14).
  (d) `service.ts` — `getBrief(workspaceId, prId)` resolves the PR workspace-scoped
  (AC-16), reads the stored row, recomputes the current freshness key on read with NO
  network → `is_stale`, and returns `WhyRiskBriefRecord | null` making ZERO LLM/embedding
  calls (AC-8, AC-14, AC-19); `generate(workspaceId, prId)` runs under `runExclusive`
  (CP-2, AC-11), asserts the PR BEFORE coalescing (AC-16), assembles the bundle (AC-1),
  renders the prompt (Phase 2), makes EXACTLY ONE `completeStructured<Brief>` call (CP-3,
  AC-19), grounds paths (AC-4/5), stamps the freshness key, and idempotent-upserts (CP-7,
  AC-1, AC-11) — on LLM failure/invalid-after-retries it does NOT persist, leaves the
  prior brief intact, and surfaces the error (AC-13); it never triggers a review (AC-9,
  spec Non-goal).
  (e) `repository.ts` — `getByPr`/`upsert` on `pr_why_risk_brief` (CP-7).
  (f) `routes.ts` — GET brief + POST generate, `getContext` guard on both (CP-1, AC-16).
  Register in `modules/index.ts`.
- **How to test:** `cd server && pnpm test` — unit (`.test.ts`): assembler builds the
  bundle from mocked facades with zero LLM + drops missing sources (AC-1, AC-12); no raw
  patch in the bundle (AC-1); grounding drops/repairs invented paths keeping the rest
  (AC-4/5); `briefFreshnessKey` matches write↔read and excludes issue/specs, NULL⇒not-stale
  (AC-14); single-flight coalesces + one-LLM-call + upsert (AC-11); no-persist-on-failure
  (AC-13). integration (`.it.test.ts`): GET=0-LLM + null empty state (AC-8, AC-19), POST
  generation, cross-workspace denied (AC-16), Regenerate does not create a review run (AC-9).
- [x] T7  Assembler builds `BriefInputBundle` from intent/blast/smart-diff/issue/specs facades with zero LLM/embedding calls and NO diff hunks/file contents/raw patch   → AC-1, AC-19   → test_brief_assembler
- [x] T8  Any missing/degraded/erroring input (no intent, degraded blast, no smart-diff, no issue, unreadable specs) is dropped best-effort; assembly + generation continue over the rest without throwing   → AC-12   → test_brief_assembler_degraded
- [x] T9  `generate` makes EXACTLY ONE `completeStructured<Brief>` call over the bundle and idempotent-upserts (json + generated_at + freshness_key) keyed by `pr_id`, overwriting any prior brief   → AC-1, AC-19   → test_brief_generate_one_call_upsert
- [x] T10  Real-path grounding: a `risks[].file_refs` / `review_focus[].path` whose path is not in the assembled input file set is dropped/repaired; the rest of the brief is persisted; no fabricated path is stored   → AC-4, AC-5   → test_brief_path_grounding
- [x] T11  Concurrent `generate` for the same PR does not start a second call (single-flight coalesces to the in-flight promise); the cache write is an idempotent upsert (no PK conflict)   → AC-11   → test_brief_single_flight
- [x] T12  LLM failure / schema-invalid-after-retries → no partial persist, error surfaced, prior stored brief intact   → AC-13   → test_brief_generate_failure_no_persist
- [x] T13  `briefFreshnessKey` is stable over `[headSha, base, title, body, provider, model, BRIEF_PROMPT_VERSION, storedIntent.freshnessKey]`; excludes issue/specs; write key == read key; NULL stored key ⇒ not stale   → AC-14   → test_brief_freshness_key
- [x] T14  `getBrief` returns the stored brief + `is_stale` (recomputed on read, NO network) or `null` when none stored, making ZERO LLM and ZERO embedding calls   → AC-8, AC-14, AC-19   → test_brief_get_zero_llm
- [x] T15  GET brief + POST generate deny cross-workspace access (PR resolved via `reviewRepo.getPull(workspaceId, prId)`; workspace guard runs BEFORE single-flight coalescing)   → AC-16   → test_brief_workspace_scoping
- [x] T16  Regenerate recomputes ONLY the brief and never triggers a review run (`POST /pulls/:id/review` is not called)   → AC-9   → test_brief_regenerate_no_review

### Phase 5 — Client: PrBriefCard + REVIEW FOCUS section + data hooks + Overview wiring   (depends on: Phase 1; API-parallel with Phase 4)
- **Surface:** client (UI) + cross-cutting (a11y)
- **Disjoint scope:** NEW `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/`
  and `.../ReviewFocusSection/`; NEW `client/src/lib/hooks/brief.ts`; EDIT
  `.../OverviewTab/OverviewTab.tsx` to slot the two new blocks. Does NOT touch
  `IntentCard` (Phase 6), the standalone reviews hooks, or i18n JSON (Phase 8 owns
  strings — references keys by name). APPEND to `client/src/lib/api.ts` only if a
  helper is missing (generic `api.get/post` already exist — prefer reuse).
- **Skills to apply:** `react-frontend-architecture`, `react-best-practices`,
  `next-best-practices` (RSC/`use client` boundary), `react-testing-library` (tests).
- **What changes & why:**
  (a) `useBrief`/`useRegenerateBrief` (CP-9).
  (b) `PrBriefCard` at the top of Overview: BODY renders the brief's `what`/`why`
  (via `Markdown`, data) + a colour-coded `risk_level` badge + an info affordance
  (`CollapsibleCard`/tooltip) (AC-6); HEADER COMPOSED from the latest review + its run
  (CP-8): verdict badge, "N findings · M blockers" pill, PR SCORE gauge (`CircularScore`
  + text equivalent, AC-18), cost line (`RunCostBadge`/`formatCost`) — zero extra LLM,
  "—" when no review (AC-7); a Regenerate icon button (`useRegenerateBrief`) with a
  progress affordance + disabled-while-pending (AC-10) and aria-live announcement (AC-18);
  the Outdated badge (icon + text, never colour alone) when `is_stale`, tooltip noting
  issue/spec edits are NOT auto-flagged (AC-14, recommendation 6); an empty "Generate
  brief" body when no brief stored, making NO LLM call on open (AC-8); loading state
  (`Skeleton`, AC-15); non-blocking error state on generate failure (AC-13).
  (c) `ReviewFocusSection` full-width below the grid: an ordered list of `review_focus[]`
  with a count badge = item count; each item a clickable `file:line` link (in-diff
  `scrollToLine`, out-of-diff `githubBlobUrl`+`MonoLink`, safe protocol only) + a
  one-line reason rendered as data (AC-2, AC-18, AC-21).
  (d) `OverviewTab` wiring: `<PrBriefCard prId>` above `.brief-grid`, `<ReviewFocusSection prId>`
  full-width below the grid + Description.
- **How to test:** `cd client && pnpm test` (Vitest + jsdom, fetch mocked,
  `NextIntlClientProvider`) — RTL per state; e2e (deterministic) in `e2e/` where the
  spec's Traceability marks e2e (AC-2, AC-6, AC-8, AC-9, AC-10, AC-15).
- [x] T17  Stored brief renders the PR BRIEF card body: `what`/`why` prose (as data) + a colour-coded `risk_level` badge + an info affordance   → AC-6   → test_brief_card_body
- [x] T18  The card HEADER is composed from the latest review (verdict badge, "N findings · M blockers" pill, PR SCORE gauge, cost line) with zero extra LLM; no review → header fields render "—"   → AC-7   → test_brief_card_header_composed
- [x] T19  No stored brief → friendly "Generate brief" body with a Generate action; opening the page makes NO generation/LLM call; the composed header renders review data (or "—") independently   → AC-8   → test_brief_card_empty_state
- [x] T20  Clicking Regenerate recomputes only the brief and, on success, refreshes the card body (never triggers a review); a review run is not started from the card   → AC-9   → test_brief_regenerate
- [x] T21  While generation is pending, a progress affordance shows and the Generate/Regenerate control is disabled until it settles   → AC-10   → test_brief_generating_progress
- [x] T22  A stored brief flagged `is_stale` shows an Outdated badge (icon + text) whose tooltip notes issue/spec edits are not auto-flagged; a not-stale/legacy brief shows none   → AC-14   → test_brief_outdated_badge
- [x] T23  Loading the cached brief shows a loading state (not blank, not error)   → AC-15   → test_brief_loading_state
- [x] T24  REVIEW FOCUS renders a full-width ordered list of `review_focus[]` with a count badge = item count; each item a clickable `file:line` link + a one-line reason (as data)   → AC-2   → test_review_focus_section
- [x] T25  Card + REVIEW FOCUS a11y: PR SCORE gauge has a text equivalent, Regenerate/Outdated announced via aria-live, focus links + info affordance keyboard-operable, usable at narrow widths; file-link hrefs are safe protocols only   → AC-18, AC-21   → test_brief_a11y_and_link_safety

### Phase 6 — Client: rework INTENT card RISK AREAS to the brief   (depends on: Phase 1, Phase 5; edits IntentCard only)
- **Surface:** client (UI) + cross-cutting (a11y)
- **Disjoint scope:** `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/IntentCard.tsx`
  (RISK AREAS subsection + the risks half of `handleRecompute`). Does NOT touch the
  standalone reviews hooks, the PrBriefCard, or i18n JSON. Depends on Phase 5 for the
  `useBrief` hook + `useRegenerateBrief`. (One file, owned solely by this phase.)
- **Skills to apply:** `react-frontend-architecture`, `react-best-practices`,
  `react-testing-library` (tests).
- **What changes & why:** RISK AREAS now renders the brief's `risks[]` (via `useBrief`)
  instead of `risksRecord` (`usePrRisks`): each risk row = severity/kind icon + title +
  a REAL file link with a line range (parse `file_refs` `path:range`; in-diff `scrollToLine`,
  out-of-diff `githubBlobUrl`+`MonoLink`, safe protocol) + a keyboard-operable expander
  chevron (`CollapsibleCard`) revealing the explanation (AC-3, AC-18). `handleRecompute`'s
  risks half is rewired to the brief Regenerate (`useRegenerateBrief`) — the intent summary
  + IN/OUT scope lists + `usePrIntent`/`useRecomputeIntent` stay exactly as today
  (recommendation 5); the standalone `usePrRisks`/`useRecomputeRisks` are no longer called
  here (left dead-but-present, NOT deleted). Model text rendered as data.
- **How to test:** `cd client && pnpm test` — RTL: RISK AREAS renders brief risks with a
  file:line link + expander that reveals the explanation on click AND keyboard; the standalone
  risks endpoints are not called from IntentCard; e2e (deterministic) per AC-3.
- [x] T26  INTENT card RISK AREAS renders the brief's `risks[]` — each row a severity/kind icon + title + REAL file link (line range) + a keyboard-operable expander revealing the explanation — instead of the standalone `Risks` artifact; IntentCard no longer calls `usePrRisks`/`useRecomputeRisks`   → AC-3   → test_intent_card_risk_areas_from_brief

### Phase 7 — Verify-only: standalone risks endpoints stay dead-but-present + Onboarding Tour nav   (parallel-safe)
- **Surface:** cross-cutting (verify-only, no new production code)
- **Disjoint scope:** verification + a targeted test asserting the standalone
  `GET/POST /pulls/:id/risks` + `analyzeRisks` remain present/unused and the
  "Onboarding Tour" nav item + `g o` shortcut remain. Does NOT delete or add
  production code. (No file overlap with other phases — assertion tests only.)
- **Skills to apply:** `fastify-best-practices`/`react-testing-library` (for the
  assertion tests), `onion-architecture`.
- **What changes & why:** AC-20 is verify-only (the "Onboarding Tour" WORKSPACE nav
  item + `g o` shortcut already shipped, `client/src/vendor/ui/nav.ts`) — assert it
  still renders (WORKSPACE group, between "Pull Requests" and "Project Context").
  The migration-note posture (spec Contracts) — the standalone risks path is kept
  dead-but-present — is pinned by a test asserting the `/pulls/:id/risks` routes +
  `analyzeRisks` still exist and were NOT deleted (their removal is a separate
  follow-up, out of this feature's scope).
- **How to test:** `cd server && pnpm test` — the risks routes + `analyzeRisks` still
  resolve (dead-but-present). `cd client && pnpm test` — the existing sidebar test
  still shows "Onboarding Tour" with the `g o` shortcut.
- [x] T27  "Onboarding Tour" nav item (icon `Workflow`, WORKSPACE group, between "Pull Requests" and "Project Context") + `g o` shortcut still render — verify-only, no new work   → AC-20   → test_onboarding_tour_nav_present
- [x] T28  Standalone `GET/POST /pulls/:id/risks` + `analyzeRisks` remain present and unused (dead-but-present; not deleted)   → AC-9 (migration posture)   → test_risks_endpoints_dead_but_present

### Phase 8 — i18n strings (en extend + uk mirror)   (depends on: Phase 5, Phase 6)
- **Surface:** client (i18n) + cross-cutting (i18n)
- **Disjoint scope:** `client/messages/en/brief.json` (extend) + NEW
  `client/messages/uk/brief.json`. Does NOT touch component code (Phases 5/6
  reference keys).
- **Skills to apply:** `next-best-practices`, `typescript-expert`.
- **What changes & why:** every NEW user-facing string via next-intl in `en` AND `uk`
  (AC-17). EXTEND the existing `brief.json` (keeping the reused intent/scope keys) with:
  the PR BRIEF card (what/why labels, `risk_level` labels high/medium/low, info-affordance
  text, Generate/Regenerate, empty/loading/error, the Outdated badge + its issue/spec
  caveat tooltip), the "N findings · M blockers" pill, the PR SCORE gauge text equivalent,
  the "REVIEW FOCUS — READ THESE FIRST" heading + count-badge label, and the RISK AREAS
  expander labels; CREATE the `uk` mirror (does not exist). Model-authored brief text is
  CONTENT (generated in the configured language), not a UI string (AC-17). Per recommendation
  4, the app is single-locale at runtime today, so the `uk` file is forward-looking.
- **How to test:** manual — every new string present in both `en` and `uk`; grep the new
  components for hardcoded literals (none).
- [x] T29  All new user-facing strings sourced from next-intl in `en` AND `uk` (card, header pill, gauge text, Outdated caveat, REVIEW FOCUS, RISK AREAS expander); no hardcoded UI text; model body text remains content   → AC-17   → test_brief_i18n_en_uk

## Traceability matrix

| AC    | Task(s)              | Test                                    | Commit |
|-------|----------------------|-----------------------------------------|--------|
| AC-1  | T2, T3, T6, T7, T9   | test_brief_assembler                    | —      |
| AC-2  | T1, T24              | test_review_focus_section               | —      |
| AC-3  | T26                  | test_intent_card_risk_areas_from_brief  | —      |
| AC-4  | T5, T10              | test_brief_path_grounding               | —      |
| AC-5  | T10                  | test_brief_path_grounding               | —      |
| AC-6  | T1, T17              | test_brief_card_body                    | —      |
| AC-7  | T18                  | test_brief_card_header_composed         | —      |
| AC-8  | T14, T19             | test_brief_card_empty_state             | —      |
| AC-9  | T16, T20, T28        | test_brief_regenerate                   | —      |
| AC-10 | T21                  | test_brief_generating_progress          | —      |
| AC-11 | T2, T6, T11          | test_brief_single_flight                | —      |
| AC-12 | T2, T8               | test_brief_assembler_degraded           | —      |
| AC-13 | T12                  | test_brief_generate_failure_no_persist  | —      |
| AC-14 | T2, T13, T22         | test_brief_freshness_key                | —      |
| AC-15 | T23                  | test_brief_loading_state                | —      |
| AC-16 | T6, T15              | test_brief_workspace_scoping            | —      |
| AC-17 | T5, T29              | test_brief_i18n_en_uk                   | —      |
| AC-18 | T25                  | test_brief_a11y_and_link_safety         | —      |
| AC-19 | T7, T9, T14          | test_brief_get_zero_llm                 | —      |
| AC-20 | T27                  | test_onboarding_tour_nav_present        | —      |
| AC-21 | T4, T5, T25          | test_brief_prompt_untrusted             | —      |

<Commit is "—" at planning time; implementers fill it as tasks land; plan-verifier
audits AC↔task↔test coverage against this table. Bidirectional coverage verified:
every AC-1…AC-21 has ≥1 task, and every T1…T29 cites ≥1 AC (T3/T6 are enabler tasks
citing the ACs they enable; T28 pins the AC-9 migration posture).>

## Risks & mitigations

- **The card HEADER draws from TWO existing queries (reviews + runs), not one.**
  `ReviewRecord` has no cost/tokens (`review-api.ts:32-46`) — the cost line reads
  the run matched by `latest.run_id`. Mitigation: CP-8 documents the exact join;
  the header composes only from data ALREADY on the PR page (zero extra fetch, zero
  LLM); the unit test (T18) mocks both queries and asserts "—" when either is absent.
- **`risk_level` vs the review's own verdict/score.** The brief's `risk_level` is
  independent of the review-derived verdict/score/blockers in the header (spec
  Non-goal: no second verdict). Mitigation: the plan keeps them strictly separate —
  body renders `risk_level`; header renders review verdict/score; no cross-wiring.
- **Real-path grounding vs the `file_refs: string[]` shape.** The line-range lives
  inside the `file_refs` string, so grounding must split `path:range` and validate
  only the PATH (recommendation 3). Mitigation: CP-5 pins the split rule; T10 asserts
  invented paths are dropped/repaired while the rest persists, and the client parses
  the same `path:range` at render.
- **Freshness write/read key symmetry.** A divergent hash path manufactures a
  permanent false-Outdated (server INSIGHTS 2026-06-27 discipline). Mitigation:
  `briefFreshnessKey` is one pure helper called on BOTH sides over the SAME ordered
  parts, issue/specs excluded (CP-6); T13 asserts write key == read key + NULL⇒not-stale.
- **Single-flight must sit BEHIND the workspace guard.** A foreign-workspace caller
  could otherwise coalesce onto another tenant's in-flight brief (server INSIGHTS
  2026-07-05). Mitigation: CP-2 asserts `assertPull` BEFORE `runExclusive`; T15 covers it.
- **Migration is MANUAL (new table).** `pnpm db:migrate` is NOT run by the pipeline;
  `.it.test.ts` apply it via `seed()`/`startPg()`. Risk: forgetting to run it in a
  live env → `relation ... does not exist`. Mitigation: called out in CP-7, Phase 3,
  and the final report.
- **New `FeatureModelId` value, not the legacy `risk_brief`.** Reusing `risk_brief`
  would couple the Why+Risk Brief's model to the legacy `analyzeRisks`. Mitigation:
  recommendation 1 adds a distinct `why_risk_brief` value; T3 asserts it + a default.
- **Two vendored copies of `@devdigest/shared`.** The server copy is the single
  source of truth; the client mirror is produced by `node scripts/sync-shared.mjs`
  and CI fails on drift (server INSIGHTS 2026-06-22). Mitigation: Phase 1 authors
  server-side only, then syncs; T3 asserts identical mirrors.
- **AC-17 i18n vs single-locale runtime.** `uk/brief.json` ships forward-looking
  (not loaded today). Mitigation: recommendation 4 — escalate to the caller only if
  live `uk` selection is wanted (a separate feature).
- **`useBrief` added to a shared/consumed hook set.** Adding a new hook that
  IntentCard + PrBriefCard both consume can break other tests that mock the module
  via `importActual` (client INSIGHTS 2026-07-05). Mitigation: `useBrief` lives in a
  NEW `lib/hooks/brief.ts` (not appended to `reviews.ts`), and Phase 6 test setup
  sweeps IntentCard tests to add the `useBrief` mock.

## Critical files for implementation

- `server/src/modules/brief/service.ts` (NEW) — the generation authority: assemble
  (0 LLM) → single-flight-behind-guard → ONE `completeStructured<Brief>` → ground
  paths → stamp freshness → idempotent upsert; `getBrief` recomputes `is_stale` on
  read with no network.
- `server/src/modules/brief/assembler.ts` (NEW) — the pure input-bundle builder over
  intent/blast/smart-diff/issue/specs facades; NO diff bodies (AC-1); degrade-not-throw (AC-12).
- `server/src/vendor/shared/contracts/why-risk-brief.ts` (NEW, mirrored to client via
  `node scripts/sync-shared.mjs`) — `Brief`/`ReviewFocusItem`/`BriefInputBundle`/
  `WhyRiskBriefRecord` (`Risk`/`Intent` reused unchanged).
- `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/` (NEW) — body
  from the brief, header composed from the latest review + its run (0 LLM), Regenerate +
  Outdated + PR SCORE gauge + empty/partial states.
- `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/IntentCard.tsx`
  — RISK AREAS rework: renders the brief's `risks[]` (file:line links + expander) instead
  of the standalone `Risks` artifact; `handleRecompute` risks half rewired to the brief.

## Open questions / assumptions

*Non-blocking (a sensible default is taken; each is called out for the caller):*

- **Assumption (new model slot):** the brief's model uses a NEW `why_risk_brief`
  `FeatureModelId` value with a default mirroring `risk_brief` — NOT the existing
  `risk_brief` slot (which belongs to the legacy `analyzeRisks`). Reversible if the
  caller prefers a single shared slot.
- **Assumption (i18n runtime):** the `uk` half of AC-17 ships as
  `messages/uk/brief.json` following the per-namespace convention; the app stays
  single-locale (`en` loaded at runtime) — live multi-locale wiring is out of scope
  (not in the spec's Goals). Reversible to a follow-up.
- **Assumption (prompt home):** `BRIEF_PROMPT_VERSION` + the injection guard live in
  reviewer-core (pure); the system-prompt TEXT lives in
  `server/src/prompts/why-risk-brief.system.md` rendered via `renderPrompt` (the
  onboarding precedent). Either home for the text is acceptable; the version constant
  + guard MUST stay in reviewer-core.
- **Assumption (cost-line format):** the header cost line reuses `formatCost` +
  `formatTokensTotal`; the spec's exact "$0.014 · 8.2K→1.3K" ordering (cost-first,
  arrow) may need a small header-local composition over those helpers rather than the
  `RunCostBadge` `withTokens` variant verbatim — helpers reused, not re-formatted inline.
- **Assumption (out-of-diff link):** brief `file_refs`/`review_focus` links to files
  NOT in the diff deep-link to the repo host via `githubBlobUrl`+`MonoLink` (the
  existing out-of-diff pattern, client INSIGHTS 2026-06-30); in-diff links use the
  `scrollToLine` viewer jump. Both are safe-protocol only (AC-18/AC-21).
- **Assumption (header run match):** the header's cost/tokens come from the
  `agent_runs` row matched by the latest review's `run_id`, read from the existing
  `usePrRuns` query. If a review's run has no priced cost, the cost line shows "—"
  (never "$0.00"), consistent with `formatCost`.
