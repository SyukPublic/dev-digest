# Development Plan: Agent Eval Pipeline

- **Spec:** docs/specs/SPEC-2026-07-10-agent-eval-pipeline.md
- **Execution mode:** single-agent

## Context

DevDigest's studio lets a user tune a review agent (system prompt, model, strategy,
linked skills) but gives no in-product, numeric answer to "did my change regress or
improve the agent?". The insight the spec builds on: the reviewer's **accept /
dismiss** decisions are ground truth (accepted = should find; dismissed = should not
flag), so the product already owns the perfect regression dataset. This feature turns
those decisions into a living, local-first regression harness: promote a decided
finding into an eval case in one click, curate cases, run an agent against all its
cases (async, sequential, progressive), and read pooled recall / precision /
citation-accuracy with run history, trend charts, run-to-run compare, and a
deterministic (code-computed, no-LLM) regression alert. The review engine
(`reviewer-core`) is reused **unchanged**; scoring is new **pure server-side** code.

Spec goal restated: shift the repo's `evals/` methodology into the product plane —
after changing an agent, run its eval set and see whether the numbers moved.

## Requirements review & recommendations

The spec is approved (36 ACs, zero `[NEEDS CLARIFICATION]`), internally consistent,
and every AC is observable/testable. Findings surfaced while designing against the
codebase (none blocking; folded into the tasks below):

1. **`EvalDashboard` / `EvalTrendPoint` cannot express null metrics — contract vs
   AC-18 (implementation-level, load-bearing).** The pre-scaffolded
   `EvalDashboard.current.{recall,precision,citation_accuracy}` and every
   `EvalTrendPoint.{recall,precision,citation_accuracy}` are `z.number()`
   (non-nullable) in `contracts/eval-ci.ts:57-88`. AC-18 requires a zero-denominator
   metric to be **null → rendered "—" (never a vacuous 0/100%)**. The spec says
   consume `EvalDashboard` "as-is" but also mandates null rendering; these collide.
   Recommendation (adopted in T2/T29/T31): put a **nullable** metric shape in the
   NEW contract file (`EvalSuiteRun` already has `double, nullable` metrics per the
   spec table) and surface the per-agent/per-suite "current" tiles and trend points
   from that nullable type. Keep `EvalDashboard` for `recent_runs`/`alert` where
   nullability is not at stake. This honors "one NEW file, never edit the barrel/
   existing contract files" AND AC-18. Do **not** widen `eval-ci.ts`.

2. **AC-14 config snapshot must capture resolved skill BODIES, not just ids
   (implementation-level).** `agent_versions.config_json` stores skill **ids**
   (`agents/repository.ts:154-173`); skill **bodies** live in the mutable `skills`
   table. Snapshotting only ids lets a mid-run skill-body edit leak into a running
   suite, violating AC-14 ("edits made while the suite is running do not affect that
   running suite"). Adopted in T20: at suite start, resolve and hold the config +
   skill bodies in memory (like `run-executor.runOneAgent` resolves them per run) and
   reuse that snapshot for every case in the loop.

3. **Client-side `expected_output` validation cannot import the Zod schema as a value
   (constraint).** The client imports contracts **type-only** (client convention,
   `client/AGENTS.md`). So AC-31's client-side "block save on invalid JSON/envelope"
   must use a local `JSON.parse` + lightweight shape guard (expectation ∈
   {must_find, must_not_flag}; findings[] each with file/start_line/end_line), with
   the **server 422** (T16/T19) as the authoritative gate. Adopted in T37.

4. **`activeKeyFor` already maps `/eval` → "eval", but `NAV` has no eval item.**
   `app-shell/helpers.ts:35` is ready; `vendor/ui/nav.ts` SKILLS LAB group lacks the
   entry. AC-32 needs the nav item added (T39).

5. **New migration must be GENERATED before integration tests run (test coupling).**
   The `.it.test.ts` harness provisions its DB by applying `server/src/db/migrations/*`
   via `runMigrations` (`server/test/helpers/pg.ts:42`). So `pnpm db:generate` (T3)
   must land the new SQL BEFORE any DB-backed eval test can pass; `pnpm db:migrate`
   (applying to the dev DB) stays a MANUAL user step (migrations are never run on boot).

6. **Non-blocking assumptions** (recorded, not questions): (a) "Run all agents"
   fan-out starts up to N concurrent suites (one per enabled agent), each internally
   sequential — provider concurrency is bounded per-suite, not across suites; this
   matches the spec's "one live suite per agent". (b) Scoring reads
   `ReviewOutcome.review.findings` (grounded/kept) for match+precision and
   `ReviewOutcome.dropped` for the citation denominator; `total_findings` for
   precision = grounded findings count.

## Affected packages & files

**server** (new module + additive schema/migration; engine reused unchanged):
- `server/src/db/schema/eval.ts` — extend: NEW `evalSuiteRuns` table; add
  `evalRuns.suiteRunId` (FK → eval_suite_runs, cascade) + `evalRuns.error` (text null).
  Reuse the empty `evalCases`/`evalRuns` scaffolds as-is (`eval.ts:7-35`).
- `server/src/db/rows.ts` — add `EvalCaseRow`, `EvalRunRow`, `EvalSuiteRunRow`.
- `server/src/db/migrations/` — NEW generated migration (via `pnpm db:generate`).
- `server/src/modules/eval/` — NEW module: `routes.ts`, `service.ts`,
  `run-executor.ts`, `scoring.ts` (pure), `repository.ts` (+ `repository/eval-case.repo.ts`,
  `eval-suite.repo.ts`, `eval-run.repo.ts`), `constants.ts`.
- `server/src/modules/index.ts` — one import + one entry (`eval`).
- `server/src/app.ts` — add eval-suite boot reaping next to `reapStaleRuns` (`app.ts:80-85`).
- `server/src/vendor/shared/contracts/eval-suite.ts` — NEW shared contract file;
  one `export *` line added to `vendor/shared/index.ts`. Sync via `node scripts/sync-shared.mjs`.

**Reuse (do NOT modify):** `reviewer-core` `reviewPullRequest` (`review/run.ts:130`);
`server/src/lib/diff-parser.ts` `parseUnifiedDiff`; `container.reviewRepo.getPull`/
`getPrFiles` (`reviews/repository.ts` facade → `pull.repo.ts:10-35`);
`container.reviewRepo.findingContext` (`review.repo.ts:153-167`, resolves finding→review→pull);
`container.agentsRepo` (`getById`, `getVersion`, `linkedSkills`, `deleteById`);
`container.llm(provider)`; the review fire-and-forget + trace-before-terminal pattern
(`reviews/service.ts:130-150`, `run-executor.ts:456-473`); grounding
(`ReviewOutcome.review.findings`/`dropped`, `grounding.ts`).

**client** (new UI over shipped primitives; type-only contract imports):
- `client/src/lib/hooks/eval.ts` — NEW hooks (none exist yet); 4s-while-running poll
  idiom from `usePrRuns` (`lib/hooks/reviews.ts:42-50`).
- `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx`
  + `.../FindingsPanel/FindingsPanel.tsx` — "Turn into eval case" action.
- `client/src/app/agents/[id]/_components/AgentEditor/` — `constants.ts` TABS + new
  `_components/EvalsTab/`; `client/src/app/agents/[id]/page.tsx` VALID_TABS.
- `client/src/app/eval/` — NEW `/eval` page (all-agents + per-agent views) + CaseEditor
  + Compare modals.
- `client/src/vendor/ui/nav.ts` — add "Eval Dashboard" item (key `eval`) under SKILLS LAB.
- `client/messages/en/agents.json` — new key `editor.tabs.evals`. (The `eval` namespace
  is already shipped: `client/messages/en/eval.json`.)
- Reuse vendored charts `LineChart`/`MetricCard`/`Sparkline` (`vendor/ui/charts/`),
  `parsePatch`/`DiffViewer` (`components/diff-viewer/helpers.ts:12`), the `Modal` kit,
  mono `Textarea`.

## Tasks

### Phase 1 — Foundation: schema, row types, shared contract, migration
- **Surface:** server + shared
- **Skills to apply:** `drizzle-orm-patterns`, `postgresql-table-design`, `zod`, `onion-architecture`
- **What changes & why:** the DB gains one table + two columns (additive) and
  `@devdigest/shared` gains one new file, so every later phase has its types + tables.
- **How to test:** `server` unit (contract shape) + `server` `.it.test.ts` (schema via
  testcontainers `runMigrations`).
- [x] T1  Extend `db/schema/eval.ts`: NEW `evalSuiteRuns` (id uuid pk; `workspace_id`→workspaces cascade; `agent_id` uuid; `agent_version` int; `status` enum running|done|failed; `recall`/`precision`/`citation_accuracy` double null; `passed`/`total` int; `cost_usd` double null; `duration_ms` int; `ran_at` timestamptz default now) + add `eval_runs.suite_run_id` (→ eval_suite_runs cascade) and `eval_runs.error` (text null); add `EvalCaseRow`/`EvalRunRow`/`EvalSuiteRunRow` to `db/rows.ts`.  → AC-8, AC-11, AC-23  → test_eval_schema
- [x] T2  NEW shared file `contracts/eval-suite.ts`: `EvalSuiteRun` (nullable pooled metrics), `EvalExpectedOutput` envelope (`expectation` enum + `findings[]` `{file,start_line,end_line,severity?,category?,title?}`), `EvalNullableMetrics` (recall/precision/citation nullable, for AC-18 tiles/trend — see review finding #1), `EvalSuiteRunAccepted` `{suite_run_id, status}`, `RunAllResult` `{started[], skipped[]}`, `EvalCaseFromFindingInput`, and a per-case record extending `EvalRunRecord` with `error`+`suite_run_id`; add ONE `export *` line to `vendor/shared/index.ts`; run `node scripts/sync-shared.mjs`.  → AC-1, AC-2, AC-31  → test_eval_suite_contract
- [x] T3  Generate the additive migration: `cd server && pnpm db:generate` (new `NNNN_*.sql` + journal for the table + two columns); verify it is additive-only. Applying (`pnpm db:migrate`) is a MANUAL user step — NOT run here and NOT on boot.  → AC-8, AC-11  → test_eval_schema

### Phase 2 — Pure scoring engine (no LLM)   (depends on: Phase 1)
- **Surface:** server (pure application logic; NOT reviewer-core — spec non-goal)
- **Skills to apply:** `typescript-expert`, `onion-architecture`
- **What changes & why:** `modules/eval/scoring.ts` — pure, I/O-free functions over a
  stubbed `ReviewOutcome` + `EvalExpectedOutput`; the deterministic heart of AC-15..AC-20/AC-35.
- **How to test:** `server` unit (`pnpm exec vitest run --exclude '**/*.it.test.ts'`), all against stubs.
- [x] T4  `matchesExpectation(finding, expected)`: match iff finding.file EQUALS expected file AND `[start_line,end_line]` INTERSECTS expected range; severity/category/title never affect matching.  → AC-15  → test_scoring_match
- [x] T5  Pooled micro-averaged metrics: recall = matched must_find / all must_find; precision = 1 − noise/total_findings (noise = grounded findings intersecting a must_not_flag region PLUS any finding in a must_not_flag case with empty `findings[]`); citation_accuracy = Σkept/Σ(kept+dropped); findings outside any expected/must_not_flag region do not penalize precision.  → AC-16  → test_scoring_metrics
- [x] T6  Per-case pass: `must_find` passes iff ALL expected findings matched; `must_not_flag` passes iff zero noise.  → AC-17  → test_scoring_pass
- [x] T7  Null-denominator rule: recall null when zero must_find expectations; citation null when zero pre-gate findings; precision null when zero total findings (never vacuous 100%).  → AC-18  → test_scoring_nulls
- [x] T8  Cost aggregation: unknown component → case cost null (never 0); suite cost = sum of priced cases, or null when none priced.  → AC-20  → test_scoring_cost
- [x] T9  `regressionAlert(latestTwoCompleted)`: pure, code-computed banner text (e.g. "Precision dipped 2pts on v7") from the two latest COMPLETED runs; null when fewer than two.  → AC-35  → test_scoring_alert
- [x] T10  Assert the scoring module is LLM-free: pure signatures consuming `ReviewOutcome`+envelope only; no provider/`container.llm` reference.  → AC-36  → test_scoring_no_llm

### Phase 3 — Eval repository + module registration   (depends on: Phase 1)
- **Surface:** server (data access)
- **Skills to apply:** `drizzle-orm-patterns`, `onion-architecture`
- **What changes & why:** all Drizzle lives here (rule 4); a facade + per-entity repo
  files mirror `reviews/repository.ts`. Register the module (rule: new module + one line in `modules/index.ts`).
- **How to test:** `server` `.it.test.ts` (DB-backed).
- [x] T11  `repository/eval-case.repo.ts` (+ facade `repository.ts`): create (finding-derived or manual), get, `listByOwner(workspaceId, agentId)`, update, delete (cascades `eval_runs`), and agent-cascade delete by `owner_id` (no DB FK).  → AC-6, AC-23, AC-24  → test_eval_case_repo
- [x] T12  `repository/eval-suite.repo.ts`: insert suite (status=running + `agent_version` snapshot), `oneRunningForAgent`, set-terminal (metrics + status), `listByAgent` (newest first), `reapStaleRunningSuites` (boot).  → AC-8, AC-9, AC-25  → test_eval_suite_repo
- [x] T13  `repository/eval-run.repo.ts`: insert per-case row (metrics OR error+pass=false, with `suite_run_id`), list by suite, recent-across-agents, trend points.  → AC-11, AC-21, AC-34  → test_eval_run_repo
- [x] T14  Register `eval` in `modules/index.ts` (one import + one entry); scaffold `modules/eval/routes.ts` plugin + `constants.ts` (enables the tab/dashboard/route surfaces).  → AC-7, AC-32  → test_eval_module_registered

### Phase 4 — Case creation (finding + manual) service & routes   (depends on: Phase 3)
- **Surface:** server (service + thin routes)
- **Skills to apply:** `onion-architecture`, `fastify-best-practices`, `zod`, `security`
- **What changes & why:** the "Turn into eval case" server action + manual case CRUD;
  edge parses once with the contract (rule 5), routes stay thin (rule 6), workspace-scoped.
- **How to test:** `server` `.it.test.ts`.
- [x] T15  `service.createCaseFromFinding(findingId)`: resolve finding→review→agent (owner=agent) via `findingContext`; read CURRENT `pr_files`; if the finding's file is absent → clear error, NO empty case (AC-4); else build a single-file unified diff (mirror `diffFromPrFiles` for one file) + `input_meta` from the pull + `expected_output` envelope from the decision (accepted→`must_find`, dismissed→`must_not_flag`) with `findings[]` from the finding's file/lines/severity/category/title, name prefilled from the finding title; a stale-anchor finding whose file is still present yields a case from the current patch (AC-5); duplicates allowed (AC-6).  → AC-1, AC-2, AC-4, AC-5, AC-6  → test_case_from_finding
- [x] T16  `service` manual create/update: reject when `parseUnifiedDiff(input_diff)` yields zero files (AC-30) and validate the `EvalExpectedOutput` envelope, 422 on invalid shape (AC-31 server side).  → AC-30, AC-31  → test_case_validation
- [x] T17  `service.deleteCase`: cascade the case's per-case `eval_runs` rows but PRESERVE each historical `eval_suite_runs` row's pooled aggregates (immutable).  → AC-23  → test_case_delete_cascade
- [x] T18  Agent-delete cascade at the service level: deleting an agent removes its eval cases + suite history (`owner_id` carries no DB FK).  → AC-24  → test_agent_delete_cascade
- [x] T19  `routes.ts`: `POST` create-from-finding, `POST`/`PUT` manual case (parse `EvalCaseInput` + envelope), `DELETE` case, `GET /agents/:id/eval-cases` — each `getContext`-scoped, thin edge.  → AC-1, AC-7, AC-31  → test_case_routes

### Phase 5 — Suite executor, run endpoints, boot reaping   (depends on: Phase 2, Phase 4)
- **Surface:** server (background executor + service + routes + boot)
- **Skills to apply:** `onion-architecture`, `fastify-best-practices`, `security`
- **What changes & why:** the async, sequential, progressive suite runner mirroring
  the review fire-and-forget pattern; scoring from Phase 2; rate-limited run endpoints; boot reaping.
- **How to test:** `server` `.it.test.ts`.
- [x] T20  `run-executor.ts`: snapshot the agent config ONCE at suite start — systemPrompt/model/provider/strategy + `agent_version` + RESOLVED linked-skill bodies (see review finding #2) held in memory; mid-run agent/skill edits do not affect the running suite.  → AC-14  → test_suite_snapshot
- [x] T21  Executor loop over the START-snapshot case-id set, sequential; a case deleted mid-run drops out without aborting; feed the engine ONLY `parseUnifiedDiff(input_diff)` + stored PR meta + snapshot config — NO callers/repoMap/intent/repo-intel.  → AC-13, AC-26  → test_suite_inputs
- [x] T22  Executor persists EVERY per-case `eval_runs` row (scored via Phase 2) BEFORE the suite flips to a terminal status; a per-case LLM failure (provider error / schema-repair exhausted) writes `error`+`pass=false` and the suite CONTINUES.  → AC-11, AC-21  → test_suite_progressive
- [ ] T23  Executor pools suite metrics (Phase 2) and sets terminal `done`; a setup failure (agent missing/disabled, all cases raced away, or LLM key missing) sets `failed`; individual case failures still complete the suite `done`.  → AC-16, AC-22  → test_suite_terminal
- [x] T24  `service.startSuite(agentId)`: insert running suite + return `{suite_run_id, status:"running"}` immediately (`void executor.run(...).catch(...)`); 409 when a suite is already running for the agent; reject when the agent has zero cases.  → AC-8, AC-9, AC-10  → test_start_suite
- [x] T25  `service.runAllAgents`: start a suite for every ENABLED agent with ≥1 case; SKIP zero-case and already-running agents; return `{ started[], skipped[] }`.  → AC-33  → test_run_all
- [ ] T26  `service.runSingleCase(caseId)`: run one case through the same executor/scoring path; return `EvalRunResult`.  → AC-8, AC-19  → test_run_single_case
- [x] T27  `routes.ts`: `POST /agents/:id/eval-runs` (rate-limit 10/min), `POST` run-all (rate-limit 10/min), `POST` run single case, `GET` suite + per-case rows — `getContext`-scoped.  → AC-8, AC-9, AC-10, AC-33  → test_run_routes
- [x] T28  `app.ts` boot: reap eval suites left `status=running` by a dead process (mirror `reapStaleRuns`), non-fatal.  → AC-25  → test_suite_reap

### Phase 6 — Dashboard + compare read endpoints   (depends on: Phase 2, Phase 5)
- **Surface:** server (read services + thin routes)
- **Skills to apply:** `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`
- **What changes & why:** aggregate reads for the tab + dashboard + compare; null-safe
  metrics (review finding #1); the compare prompt-diff reads `agent_versions.config_json`.
- **How to test:** `server` `.it.test.ts`.
- [ ] T29  `service.buildDashboard(agent | workspace)`: current metrics (nullable), delta vs previous run, trend points (one per suite run), recent runs, and the code-computed alert (T9); zero-denominator metrics stay null.  → AC-18, AC-19, AC-34, AC-35  → test_dashboard
- [x] T30  `service.compareRuns(runA, runB)`: metric deltas + system-prompt diff from `agent_versions.config_json`; a missing `agent_versions` row degrades to "config unavailable" (no error); NO Promote data.  → AC-27, AC-28  → test_compare
- [x] T31  `routes.ts`: `GET` dashboard (per-agent + workspace), `GET` compare — `getContext`-scoped; dashboard aggregate response.  → AC-19, AC-27, AC-32  → test_dashboard_routes

### Phase 7 — Client hooks + FindingCard "Turn into eval case"   (depends on: Phase 4, Phase 6)
- **Surface:** client
- **Skills to apply:** `react-frontend-architecture`, `react-best-practices`, `next-best-practices`, `react-testing-library`
- **What changes & why:** the data layer (all API access via hooks, not ad-hoc fetch)
  + the one-click promote action; contracts imported TYPE-ONLY.
- **How to test:** `client` RTL/vitest (fetch mocked).
- [x] T32  `lib/hooks/eval.ts`: `useCreateEvalCaseFromFinding`, `useAgentEvalCases`, `useRunAgentEvals`, `useRunAllAgents`, `useRunCase`, `useEvalDashboard`, `useCompareRuns`, case CRUD hooks; suite/dashboard queries poll `refetchInterval` 4s WHILE a suite is running and STOP on terminal (mirror `usePrRuns`); invalidate queries after each mutation.  → AC-12  → test_eval_hooks_poll
- [x] T33  `FindingCard`: add "Turn into eval case" (flask) action in the expanded action row; DISABLED while the finding is pending (no `accepted_at` and no `dismissed_at`); enabled on accepted/dismissed.  → AC-3  → test_findingcard_eval_action
- [x] T34  `FindingsPanel`: wire the new action to `useCreateEvalCaseFromFinding` (pass finding id; server resolves agent/diff/meta/envelope); toast on success/error.  → AC-1, AC-2  → test_findingspanel_eval_wire

### Phase 8 — AgentEditor Evals tab   (depends on: Phase 7)
- **Surface:** client
- **Skills to apply:** `react-frontend-architecture`, `react-best-practices`, `react-testing-library`
- **What changes & why:** the per-agent Evals tab (Mockup 5).
- **How to test:** `client` RTL/vitest.
- [x] T35  Register the tab: `AgentEditor/constants.ts` TABS entry (`labelKey:"editor.tabs.evals"`, flask icon), `agents/[id]/page.tsx` VALID_TABS includes `"evals"`, new key `editor.tabs.evals` in `messages/en/agents.json`.  → AC-7  → test_evals_tab_registered
- [ ] T36  `EvalsTab` component: metric summary tiles (recall/precision/citation, cases passed/total), case list (status icon + TEXT label pass/fail/never-run, mono name, subtitle, expectation chip, run/edit/delete), "Run all evals", "New eval case", "View full dashboard →"; loading + empty states (shipped copy); null metrics render "—".  → AC-7, AC-18, AC-19  → test_evals_tab

### Phase 9 — Case Editor + Compare modals   (depends on: Phase 7)
- **Surface:** client
- **Skills to apply:** `react-frontend-architecture`, `react-best-practices`, `react-testing-library`
- **What changes & why:** the manual authoring modal (Mockup 6) and the read-only
  compare modal (Mockup 4); a11y focus management + non-color-only state.
- **How to test:** `client` RTL/vitest.
- [x] T37  `CaseEditor` modal: Name (required); Input tabs Diff | PR meta (NO Files tab); unified-diff preview (`parsePatch`/`DiffViewer`); Expected-output JSON editor with valid/invalid indicator (icon + TEXT, not color alone) + "+ Finding skeleton" insert; "Run on save" toggle; "Run case"; last-run banner (pass/fail via shipped copy); focus trap; BLOCK Save on invalid JSON/envelope via local `JSON.parse` + shape guard (review finding #3).  → AC-29, AC-31  → test_case_editor
- [x] T38  `CompareModal`: four delta tiles (recall/precision/citation/cost) with direction by icon+TEXT; system-prompt diff block; Close only (NO Promote); missing version → "config unavailable"; focus trap.  → AC-27, AC-28  → test_compare_modal

### Phase 10 — /eval dashboard page + nav   (depends on: Phase 8, Phase 9)
- **Surface:** client
- **Skills to apply:** `react-frontend-architecture`, `react-best-practices`, `next-best-practices`, `react-testing-library`
- **What changes & why:** the `/eval` Skills-Lab dashboard (Mockups 2 & 3).
- **How to test:** `client` RTL/vitest for the views; `e2e` (deterministic, no LLM) for the page under nav.
- [x] T39  `vendor/ui/nav.ts`: add "Eval Dashboard" item (`key:"eval"`, flask/beaker icon) under SKILLS LAB (`activeKeyFor` already maps `/eval`→"eval").  → AC-32  → e2e_eval_page
- [x] T40  `/eval` all-agents view: per-agent rows (model chip, last-run summary, sparkline, RECALL/PREC/CITE), recent-runs-across-agents, "Run all agents"; never-run agents render "—"; empty state.  → AC-32, AC-33  → test_eval_all_agents
- [ ] T41  `/eval` per-agent view: back link, model chip, agent switcher, "Run eval", regression alert banner (aria-live, code-computed), three MetricCards with deltas + mini sparklines, multi-series metric trend chart (recharts), recent-runs table with checkbox compare (opens Compare modal); fewer than two completed runs → no delta/no alert; running state polls; null metrics "—".  → AC-18, AC-34, AC-35  → test_eval_per_agent

## Traceability matrix

| AC | Task | Test | Commit |
|------|------|----------------|--------|
| AC-1 | T15 | test_case_from_finding | — |
| AC-2 | T15 | test_case_from_finding | — |
| AC-3 | T33 | test_findingcard_eval_action | — |
| AC-4 | T15 | test_case_from_finding | — |
| AC-5 | T15 | test_case_from_finding | — |
| AC-6 | T15 | test_case_from_finding | — |
| AC-7 | T36 | test_evals_tab | — |
| AC-8 | T24 | test_start_suite | — |
| AC-9 | T24 | test_start_suite | — |
| AC-10 | T24 | test_start_suite | — |
| AC-11 | T22 | test_suite_progressive | — |
| AC-12 | T32 | test_eval_hooks_poll | — |
| AC-13 | T21 | test_suite_inputs | — |
| AC-14 | T20 | test_suite_snapshot | — |
| AC-15 | T4 | test_scoring_match | — |
| AC-16 | T5 | test_scoring_metrics | — |
| AC-17 | T6 | test_scoring_pass | — |
| AC-18 | T7 | test_scoring_nulls | — |
| AC-19 | T29 | test_dashboard | — |
| AC-20 | T8 | test_scoring_cost | — |
| AC-21 | T22 | test_suite_progressive | — |
| AC-22 | T23 | test_suite_terminal | — |
| AC-23 | T17 | test_case_delete_cascade | — |
| AC-24 | T18 | test_agent_delete_cascade | — |
| AC-25 | T28 | test_suite_reap | — |
| AC-26 | T21 | test_suite_inputs | — |
| AC-27 | T30 | test_compare | — |
| AC-28 | T30 | test_compare | — |
| AC-29 | T37 | test_case_editor | — |
| AC-30 | T16 | test_case_validation | — |
| AC-31 | T16 | test_case_validation | — |
| AC-32 | T39 | e2e_eval_page | — |
| AC-33 | T25 | test_run_all | — |
| AC-34 | T41 | test_eval_per_agent | — |
| AC-35 | T9 | test_scoring_alert | — |
| AC-36 | T10 | test_scoring_no_llm | — |

## Risks & mitigations

- **Contract nullability vs AC-18 (review finding #1).** Returning null metrics through
  the non-nullable `EvalDashboard`/`EvalTrendPoint` would either 500 (serializer) or
  force a vacuous 0. Mitigation: surface null-capable metrics from the NEW
  `contracts/eval-suite.ts` types (T2/T29/T31); keep `eval-ci.ts`/the barrel untouched.
- **Migration ↔ integration-test coupling (review finding #5).** DB-backed eval tests
  fail if the migration is missing. Mitigation: T3 generates the SQL before any
  `.it.test.ts` runs; `runMigrations` (testcontainers) applies it automatically. The
  dev DB still needs the MANUAL `pnpm db:migrate` (never on boot) before hitting `:3001`.
- **Snapshot leakage (review finding #2).** Snapshotting skill IDs only would let a
  mid-run skill-body edit change results. Mitigation: T20 snapshots resolved bodies in memory.
- **Run-all fan-out concurrency.** "Run all agents" starts up to N concurrent suites
  (one per enabled agent). Bounded per-suite (sequential cases) but not across suites;
  the 10/min endpoint rate-limit + one-live-suite-per-agent are the guards. Accepted per spec.
- **Untrusted, secret-bearing diff data (AC-36 / security).** Stored `input_diff`/PR meta
  may contain real secrets (the `stripe-key-leak` case). Mitigation: workspace-scoped
  storage only, never logged, sent nowhere but the configured LLM provider as review
  input; INJECTION_GUARD + untrusted-content wrapping apply in the engine; scoring is LLM-free (T10).
- **Onion/layering drift.** New module must keep Drizzle in repositories (rule 4),
  services depending on `container.*` interfaces (rule 2/3), thin routes (rule 6), and
  reach shared entities only via `container.reviewRepo`/`container.agentsRepo` (rule 7).
  Mitigation: run `pnpm arch:check` (from `server/`) after backend phases.

## Critical files for implementation

- `server/src/db/schema/eval.ts` — the pre-scaffolded `eval_cases`/`eval_runs` reused as-is + the additive table/columns.
- `server/src/modules/reviews/service.ts` + `run-executor.ts` — the fire-and-forget + trace-before-terminal-status pattern the suite executor mirrors (AC-8/AC-11).
- `server/src/modules/eval/scoring.ts` (new) — the pure, no-LLM heart (AC-15..AC-20, AC-35, AC-36).
- `server/src/vendor/shared/contracts/eval-suite.ts` (new) + `eval-ci.ts` (reused) — the boundary contracts.
- `client/src/lib/hooks/eval.ts` (new) + `client/messages/en/eval.json` (shipped copy) — the client data layer + i18n baseline.

## Open questions / assumptions

- **Assumption (non-blocking):** scoring reads `ReviewOutcome.review.findings` (grounded/kept)
  for match + precision and `ReviewOutcome.dropped` for the citation denominator;
  `total_findings` for precision = grounded findings count (per the spec's scoring flow diagram).
- **Assumption:** the client validates `expected_output` locally (`JSON.parse` + shape
  guard) for the valid/invalid indicator and Save gate, with the server 422 as the
  authoritative validation (client imports contracts type-only).
- **Assumption:** "Run all agents" may start up to N concurrent suites (one per enabled
  eligible agent); no global suite concurrency cap beyond the per-agent single-live rule
  and the 10/min endpoint limit.
