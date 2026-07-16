# Development Plan: Agent & Skill Stats + Agent Performance dashboard

- **Spec:** docs/specs/SPEC-2026-07-17-agent-skill-stats-and-performance.md
- **Execution mode:** single-agent

## Context

DevDigest persists everything needed to judge whether a reviewer agent (or a
linked skill) earns its keep — one row per run in `agent_runs`
(provider/model/duration/tokens/cost/status/source/score/findings), the findings
it produced in `findings` (with `accepted_at`/`dismissed_at` acceptance signals),
and a full `run_traces.trace` jsonb document (which skills + memory each run
pulled) — but none of it is surfaced. This feature adds three **read-only**
analytics surfaces over that already-persisted data: a per-agent **Stats** tab in
the Agent Editor, a per-skill **Stats** tab in the Skill Editor, and a global
**Agent Performance** dashboard at `/agent-performance`. All three read only
`agent_runs` + `findings` + `run_traces`; no new model/LLM/embedding calls, no
writes, no schema change, no migration. The headline quality signal is
accept-rate; unknown cost is shown honestly as "—", never "$0.00". Per AC-34 the
dashboard and the per-agent Stats tab must produce identical numbers for the same
agent + period, which the plan achieves with one shared aggregation
implementation.

## Requirements review & recommendations

The spec is complete and internally consistent (36 EARS ACs, zero open questions,
bidirectionally traced). No blocking ambiguity was found; the plan proceeds
directly. Findings and recommendations gathered during review:

- **AC-31 "those runs" (non-blocking interpretation, folded in as an
  assumption).** The clause "per-skill accept-rate shall be the accept-rate of
  findings produced by those runs" is read as: **the period's runs by linked
  agents whose trace pulled this skill** (the numerator subset of the
  pull-frequency ratio), not all runs of linked agents. `findings_total` and the
  category donut use the same subset. This is the reading consistent with the
  mockup ("value of the skill") and with `pull_frequency`'s denominator being the
  broader "runs by linked agents". Captured in Open questions / assumptions.
- **Findings → run linkage (grounded, non-blocking).** There is no
  finding→run/agent FK; findings attach to a run via
  `findings.review_id → reviews.id`, and `reviews.run_id → agent_runs.id`.
  `reviews.run_id` is nullable — legacy reviews with a null `run_id` cannot be
  period-bounded and are therefore excluded from run-scoped aggregates. Accepted;
  noted as an assumption.
- **Weekly severity bucketing key (grounded, non-blocking).** `findings` carry no
  own timestamp usable for the period; findings are bucketed by their run's
  `agent_runs.ran_at` (the same clock the period filter uses), keeping the weekly
  bars consistent with the period window.
- **Performance / indexing recommendation (implementation-level).** The spec
  leaves indexing to the planner and forbids schema changes. Every hot filter
  (`agent_runs.workspace_id` + `ran_at`, and the `findings⋈reviews⋈agent_runs`
  join) rides existing PK/FK columns; measured latency is expected to be fine for
  local-first scale. **Recommendation:** ship without new indexes; if a real
  workspace shows slow reads, add a composite `(workspace_id, ran_at)` index on
  `agent_runs` as a *separate, later* migration (out of scope here — the spec's
  intent is read-only aggregation, AC / Non-goal "no migration").
- **"Never edit the barrel" vs. wiring a new contract file (grounded).** The
  project rule forbids editing *existing contract shapes*; adding a NEW contract
  file still requires one `export *` line in the shared barrel
  (`server/src/vendor/shared/index.ts`) — this is the documented mechanism every
  prior lesson used (`observability.ts`, `productionize.ts`, `multi-agent.ts` each
  carry a "the barrel re-exports it" header). T3 follows that precedent: new file
  + one append line, no edit to any existing shape.
- **Nav test is intentionally red until this ships (grounded, must-do).**
  `client/src/vendor/ui/shell/Sidebar.test.tsx` asserts
  `expect(keys).not.toContain("agent-performance")` (a deliberate exclusion of the
  unbuilt feature, INSIGHTS 2026-07-16). Adding the nav item (T26) MUST reverse
  that assertion in the same change, mirroring how `/memory` was shipped — else a
  test that looks intentional fails.

## Affected packages & files

**server/ (`@devdigest/api`) — additive; new `stats` feature module + contract edits**
- `server/src/vendor/shared/contracts/observability.ts` — EXTEND `AgentStats`
  additively (T1). Owns the file; barrel already re-exports it.
- `server/src/vendor/shared/contracts/productionize.ts` — EXTEND
  `AgentPerf.summary` + `AgentPerfRow` additively (T2).
- `server/src/vendor/shared/contracts/skill-stats.ts` — NEW `SkillStats` contract
  file (T3) + one `export *` line in `server/src/vendor/shared/index.ts`.
- `server/src/modules/stats/` — NEW module: `routes.ts`, `service.ts`,
  `repository.ts`, `aggregation.ts` (pure), `schemas.ts` (`PeriodQuery` +
  `resolvePeriod`), `constants.ts`. Registered with one line in
  `server/src/modules/index.ts` (T16).
- Reused, unchanged: `server/src/db/schema/runs.ts` (`agent_runs`, `run_traces`),
  `server/src/db/schema/reviews.ts` (`reviews`, `findings`),
  `server/src/db/schema/agents.ts` (`agent_skills` link),
  `server/src/modules/_shared/context.ts` (`getContext` workspace scoping),
  `server/src/modules/_shared/schemas.ts` (`IdParams`),
  `server/src/modules/pulls/cost.ts` (**reuse pattern** — pure, DB-free,
  unit-tested; the aggregation module mirrors it).

**client/ (`@devdigest/web`) — additive; two editor tabs + one global page**
- `client/src/vendor/shared/**` — regenerated by `node scripts/sync-shared.mjs`
  (T4); never hand-edited.
- `client/src/lib/hooks/stats.ts` — NEW hooks `useAgentStats`, `useSkillStats`,
  `useAgentPerformance` (T18); built on `client/src/lib/api.ts` `api.get`.
- `client/src/components/period-control/` — NEW shared `PeriodControl` (T19),
  reused by all three surfaces.
- Agent editor: `client/src/app/agents/[id]/_components/AgentEditor/constants.ts`
  + `AgentEditor.tsx` + NEW `_components/StatsTab/` (T21–T22).
- Skill editor: `client/src/app/skills/[id]/_components/SkillEditor/constants.ts`
  + `SkillEditor.tsx` + NEW `_components/StatsTab/` (T23–T24).
- Dashboard: NEW `client/src/app/agent-performance/page.tsx` +
  `_components/AgentPerformanceView/` (T25).
- Nav: `client/src/vendor/ui/nav.ts` + `client/src/vendor/ui/shell/Sidebar.test.tsx`
  (reverse the exclusion) + `client/messages/en/shell.json` (`nav.agent-performance`)
  (T26).
- i18n: `client/messages/en/agentPerformance.json` (subtitle + new keys),
  `client/messages/en/agents.json` / `skills.json` (Stats-tab keys; `agents.json`
  already has `editor.tabs.stats`) (T27).
- Reused primitives (no new ones): `@devdigest/ui` charts (`Donut`, `MetricCard`,
  `Sparkline`, `LineChart`, `BarRow`) + primitives (`CircularScore`, `EmptyState`,
  `ErrorState`, `Skeleton`, `Tabs`, `Badge`); `client/src/vendor/ui/icons.tsx`
  (`TrendingUp` present; `Activity` reserved for CI Runs);
  `client/src/components/run-trace/` (`RunTraceDrawer`, opened by `runId` — backs
  AC-27 "View trace"); `client/src/lib/github-urls.ts` (`githubPrUrl` for the
  run-history PR link).

## Tasks

### Phase 1 — Shared contracts (@devdigest/shared)
- **Surface:** shared
- **Skills to apply:** `zod`, `typescript-expert`
- **What changes & why:** Fill/extend the pre-scaffolded contracts so all three
  endpoints have their response shapes, and add the new `SkillStats`. Additive and
  back-compatible; existing shapes are untouched. `pct` fields are 0..1;
  cost/delta/accept-rate are `number | null` where "null means unknown" (never 0).
- **How to test:** exercised by the server integration tests in Phase 4 (shapes
  must parse) and by `node scripts/sync-shared.mjs --check` (drift gate).
- [ ] T1  Extend `AgentStats` in `observability.ts` with `avg_cost_delta_usd`, `most_used_skills[]`, `most_pulled_memory[]`, `findings_by_category[]`, `findings_by_severity_weekly[]`, `run_history[]` (all additive/nullish per the spec's field table)  → AC-21, AC-25, AC-26, AC-27  → test_agent_stats_route.it
- [ ] T2  Extend `AgentPerf.summary` (`runs_trend: number[]`, `total_cost_delta_usd: number|null`) and `AgentPerfRow` (`accept_rate_delta: number|null`) in `productionize.ts`  → AC-12, AC-13  → test_perf_route.it
- [ ] T3  Add NEW `SkillStats` contract in `contracts/skill-stats.ts` (fields per spec) + one `export * from './contracts/skill-stats.js'` line in `server/src/vendor/shared/index.ts` (new-file wiring, not an edit to existing shapes)  → AC-29  → test_skill_stats_route.it
- [ ] T4  Run `node scripts/sync-shared.mjs` to mirror T1–T3 into `client/src/vendor/shared`; leave the barrel/`--check` green  → AC-29  → test_shared_sync

### Phase 2 — Server pure aggregation (stats module)   (depends on: Phase 1)
- **Surface:** server
- **Skills to apply:** `onion-architecture`, `zod`, `typescript-expert`
- **What changes & why:** All accept-rate / cost / severity / trend / trace math
  lives in ONE pure, DB-free, unit-testable module (`stats/aggregation.ts`,
  mirroring `pulls/cost.ts`). This is the single shared implementation AC-34
  demands: the dashboard per-agent rows and the per-agent Stats tab both call the
  same per-agent aggregator, so their numbers cannot drift. Period parsing is
  edge validation (`stats/schemas.ts`): a Zod `PeriodQuery` + a pure
  `resolvePeriod`. Functions take plain rows and return DTO fragments — no `this`,
  no Drizzle, no I/O.
- **How to test:** `server` unit vitest (plain `*.test.ts`; `pnpm exec vitest run
  --exclude '**/*.it.test.ts'`).
- [ ] T5  `PeriodQuery` Zod schema (`days` coerced to `1|30`; `from`/`to` ISO; refine `from ≤ to`, days⊥range, both-or-neither) + pure `resolvePeriod(query, now)→{from,to}` defaulting to last 30 days  → AC-3, AC-4  → test_period_query
- [ ] T6  Pure per-agent aggregator over run+finding rows: runs, accepted/dismissed/pending, accept-rate (null when acted=0), dismiss-rate, avg-findings/run, total/avg cost (null-safe; unpriced excluded from cost, still counted for runs/duration), avg duration, `findings_by_severity`, `findings_by_severity_weekly` (≤6 weekly buckets oldest→newest), `findings_by_category` (count/share), `trend`, `avg_cost_delta_usd` (period-over-period)  → AC-8, AC-25, AC-26, AC-34  → test_aggregation
- [ ] T7  Pure trace aggregation → `most_used_skills[]` / `most_pulled_memory[]` (share 0..1 of period runs whose trace pulled each); PER-RUN safe parse — a malformed/absent `prompt_assembly.skill_tokens`/`skills` or `memory_pulled` degrades that run's contribution and never throws, empty input → `[]`  → AC-9, AC-23, AC-24  → test_trace_shares
- [ ] T8  Pure dashboard assembler reusing T6 per agent: `summary` (runs + `runs_trend`, total cost + `total_cost_delta_usd`, avg accept-rate, most-active agent), per-row `accept_rate_delta`, `cost_by_agent` / `cost_by_model` `PerfCostSegment[]` (orphan `agent_id=null` runs fold into workspace cost only, not into rows)  → AC-12, AC-13, AC-17, AC-34  → test_perf_aggregation
- [ ] T9  Pure per-skill aggregator: `used_by_agents` (config count, NOT period-scoped), `pull_frequency` (share of linked-agent period runs whose trace pulled the skill; null when denominator=0), `accept_rate` + `findings_total` + `findings_by_category` over the pulled-the-skill subset  → AC-30, AC-31, AC-33  → test_skill_aggregation

### Phase 3 — Server repository (stats module)   (depends on: Phase 2)
- **Surface:** server
- **Skills to apply:** `drizzle-orm-patterns`, `onion-architecture`, `security`
- **What changes & why:** The only layer touching Drizzle. Reads are workspace-
  scoped (AC-2) and period-bounded on `agent_runs.ran_at` (AC-3), include BOTH
  `source='local'` and `source='ci'` rows (AC-35), and return plain rows for the
  pure aggregators. Trace jsonb is read RAW (not parsed in SQL) for only the
  period's runs, so AC-9's degrade-don't-throw happens in pure code (T7), not in
  the query. No mutations, parameterized queries only.
- **How to test:** `server` integration vitest (`*.it.test.ts`; needs Docker
  Postgres; `pnpm exec vitest run .it.test`).
- [ ] T10  `agent_runs` reads scoped by `workspace_id` + `ran_at ∈ period` (optional `agent_id` filter), both sources included, returning the columns the aggregators need (cost/duration/tokens/source/pr_number/pr_id/repo/agent_id/model/provider/ran_at/id)  → AC-2, AC-3, AC-35  → test_workspace_scope.it
- [ ] T11  Findings reads: `findings ⋈ reviews (review_id) ⋈ agent_runs (reviews.run_id=agent_runs.id)`, workspace-scoped + period-bounded, projecting severity/category/accepted_at/dismissed_at/agent_id/ran_at (legacy reviews with null run_id excluded)  → AC-2, AC-25, AC-26  → test_findings_read.it
- [ ] T12  `run_traces.trace` jsonb reads for the period's run ids only (bounded set), returned raw as `unknown` for T7's safe parse  → AC-9, AC-23, AC-24  → test_trace_panel_degrade.it
- [ ] T13  Skill-scoped reads: `agent_skills` links for the skill (used-by count + linked-agents list), the linked agents' period runs, their traces, and their findings  → AC-29, AC-31, AC-32  → test_skill_stats_route.it

### Phase 4 — Server service, routes & module registration (stats module)   (depends on: Phase 3)
- **Surface:** server
- **Skills to apply:** `fastify-best-practices`, `onion-architecture`, `zod`, `security`
- **What changes & why:** `StatsService` orchestrates repository reads → pure
  aggregators → `AgentPerf`/`AgentStats`/`SkillStats` DTOs; the trace step is
  wrapped so a jsonb failure yields empty panels and the request still succeeds
  (AC-9). Routes are thin: read workspace context (`getContext`), parse
  `PeriodQuery` (querystring) and `IdParams`, call ONE service method, return the
  Zod-serialized DTO. `GET /agents/performance` is a STATIC segment so it does not
  collide with the agents module's `/agents/:id` param route (find-my-way prefers
  static). No adapter/LLM is constructed anywhere in this path (AC-1).
- **How to test:** `server` integration vitest (`*.it.test.ts`) + the T5 unit test
  for query validation.
- [ ] T14  `StatsService` methods `agentPerformance` / `agentStats` / `skillStats` composing repo + pure aggregators; trace aggregation in try/catch → empty panels on failure, never throw; asserts no adapter/LLM call is made  → AC-1, AC-9, AC-21, AC-29  → test_no_llm_calls.it
- [ ] T15  Routes `GET /agents/performance`, `GET /agents/:id/stats`, `GET /skills/:id/stats`: `PeriodQuery` + `IdParams` parsed at the edge (bad range/ISO → 422, no aggregation), workspace-scoped, Zod response serialization  → AC-3, AC-4, AC-11, AC-21, AC-29  → test_perf_route.it
- [ ] T16  Register the `stats` module (one import + one entry) in `server/src/modules/index.ts`  → AC-11, AC-21, AC-29  → test_perf_route.it
- [ ] T17  Integration: dashboard row == per-agent Stats tab for the same agent+period (AC-34 parity via shared aggregation); a cross-workspace request returns no foreign data; both `local` and `ci` runs appear in aggregates  → AC-2, AC-34, AC-35  → test_dashboard_agent_parity.it

### Phase 5 — Client data layer (hooks, period control, formatters)   (depends on: Phase 4)
- **Surface:** client
- **Skills to apply:** `react-frontend-architecture`, `react-best-practices`, `next-best-practices`
- **What changes & why:** All API access goes through `src/lib/api.ts` + typed
  hooks (no ad-hoc fetch); types come from `@devdigest/shared`, never redefined.
  The period control and the null→"—" formatters are shared once (used by all
  three surfaces) and live under `src/components/` (a genuine second consumer
  exists, so promotion is justified, not premature). Query keys include the period
  so a period change refetches; the active period drives period-scoped labels
  (AC-10), so cards never hardcode "30D".
- **How to test:** `client` vitest + jsdom; hooks are exercised through the
  component tests in Phases 6–8.
- [ ] T18  `client/src/lib/hooks/stats.ts`: `useAgentStats(agentId, period)`, `useSkillStats(skillId, period)`, `useAgentPerformance(period)` via `api.get<...>(path + periodQueryString)`; period folded into the `queryKey`  → AC-11, AC-21, AC-29  → test_dashboard
- [ ] T19  Shared `PeriodControl` (`src/components/period-control/`): 30-day default, 1-day, custom range; keyboard-operable + labeled; emits the period object and derives the active-period label  → AC-10, AC-36  → test_period_control
- [ ] T20  Shared formatters: `formatCost` (null → "—", never "$0.00") and `formatAcceptRate` (null → "—", never "0%")  → AC-7, AC-8  → test_cost_fmt

### Phase 6 — Client: Agent Editor Stats tab   (depends on: Phase 5)
- **Surface:** client
- **Skills to apply:** `react-frontend-architecture`, `react-best-practices`, `react-testing-library`
- **What changes & why:** Insert a Stats tab between Evals and CI without
  disturbing the existing tab identity/order, and render it from an `?tab=stats`
  branch (matches `AgentEditor.tsx`'s existing switch). The tab body composes the
  reused chart primitives + `PeriodControl` + loading/empty/error states. Memory
  text and skill/category names render as ESCAPED text (default JSX escaping),
  truncated with an accessible full-text affordance; never
  `dangerouslySetInnerHTML`. Run-history "View trace" opens the existing
  `RunTraceDrawer` by `run_id`; the PR link uses `githubPrUrl(repo, pr_number)`
  when `pr_id` is absent (CI rows). **Tests use `fireEvent` from
  `@testing-library/react` — NOT `user-event` (not a dependency here); mock the
  data hooks + `next/navigation`, render under `NextIntlClientProvider`
  (messages by relative path) + `ToastProvider`** (client INSIGHTS 2026-06-24).
- **How to test:** `client` vitest + jsdom.
- [ ] T21  Add `{ key: "stats", labelKey: "editor.tabs.stats", icon: <line/gauge icon> }` to `AgentEditor/constants.ts` TABS (between `evals` and `ci`) and render a `StatsTab` branch in `AgentEditor.tsx`, preserving existing tab order/identity  → AC-20  → test_agent_editor_tabs
- [ ] T22  `AgentEditor/_components/StatsTab`: 4 summary cards (Total runs + `Sparkline`; Avg cost/run + delta chip; Avg duration; Accept-rate `CircularScore`), Most-used-skills + Most-pulled-memory `BarRow` lists (escaped/truncated), weekly stacked severity bars, findings-by-category `Donut` (count/share), run-history table (timestamp, PR link, tokens, cost "—", findings, `local`/`ci` `Badge`, View trace → `RunTraceDrawer`); loading `Skeleton` / `EmptyState` (— placeholders) / `ErrorState` (`loadError`); `PeriodControl`; aria-live + accessible chart labels  → AC-5, AC-6, AC-7, AC-8, AC-9, AC-18, AC-22, AC-23, AC-24, AC-25, AC-26, AC-27, AC-35, AC-36  → test_agent_stats_tab

### Phase 7 — Client: Skill Editor Stats tab   (depends on: Phase 5)
- **Surface:** client
- **Skills to apply:** `react-frontend-architecture`, `react-best-practices`, `react-testing-library`
- **What changes & why:** Same tab-insertion pattern for the Skill Editor (Stats
  between Evals and Versions), reusing `PeriodControl`, the formatters, and the
  chart primitives. "Used by" is a config count (not period-scoped); pull
  frequency, accept-rate and findings are period-scoped. Same `fireEvent` test
  harness as Phase 6.
- **How to test:** `client` vitest + jsdom.
- [ ] T23  Add the `stats` tab to `SkillEditor/constants.ts` TABS (between `evals` and `versions`) and render a `StatsTab` branch in `SkillEditor.tsx`, preserving existing tabs  → AC-28  → test_skill_editor_tabs
- [ ] T24  `SkillEditor/_components/StatsTab`: 4 summary cards (Used by; Pull frequency %; Accept-rate `CircularScore`; Findings), "Agents using this skill" list each with an "Open" action navigating to that agent's editor, findings-by-category `Donut` (count/share); loading/empty/error states; `PeriodControl`; escaped names  → AC-5, AC-6, AC-8, AC-18, AC-30, AC-31, AC-32, AC-33, AC-36  → test_skill_stats_tab

### Phase 8 — Client: Agent Performance dashboard, nav & i18n   (depends on: Phase 5)
- **Surface:** client
- **Skills to apply:** `next-best-practices`, `react-frontend-architecture`, `react-best-practices`, `react-testing-library`
- **What changes & why:** New thin route `/agent-performance` delegating to a
  colocated `AgentPerformanceView` (matches the `/ci-runs` and `/memory` global-
  page pattern). Add the GLOBAL nav item and REVERSE the deliberate exclusion in
  `Sidebar.test.tsx` (mirroring how `/memory` shipped). i18n: update the existing
  `agentPerformance.json` `subtitle` to the approved wording and add the new keys;
  add Stats-tab keys under the `agents`/`skills` namespaces (nav labels stay
  hardcoded English — nav is not i18n).
- **How to test:** `client` vitest + jsdom (`fireEvent` harness).
- [ ] T25  `client/src/app/agent-performance/page.tsx` + `_components/AgentPerformanceView`: 4 summary cards (Total runs + `Sparkline`/`LineChart`; Total cost + delta; Avg accept-rate `CircularScore`; Most-active agent with runs · accept), sortable agent table (default accept-rate desc; per-row up/down indicator; Agent/Runs/Avg cost/Avg dur./Accept/Last run/View), row-expand `Sparkline` + "last N runs · avg <dur> · <cost>" caption, two cost-breakdown `Donut`s (by agent, by model); `PeriodControl`; loading/empty/error states; row/View → agent Stats tab (`?tab=stats`); keyboard-operable + aria-live + chart labels  → AC-5, AC-6, AC-10, AC-11, AC-12, AC-13, AC-14, AC-15, AC-16, AC-17, AC-18, AC-36  → test_dashboard
- [ ] T26  Add nav item `{ key: "agent-performance", label: "Agent Performance", icon: "TrendingUp", href: "/agent-performance" }` to the GLOBAL group in `vendor/ui/nav.ts`; reverse the `not.toContain("agent-performance")` assertion in `vendor/ui/shell/Sidebar.test.tsx` (add the positive assertion); add `nav.agent-performance` to `messages/en/shell.json`; verify `activeKeyFor` highlights `/agent-performance`  → AC-19  → test_nav_item
- [ ] T27  i18n: update `agentPerformance.json` `subtitle` to "Which agents earn their keep — accept rate is the quality signal" and add keys (period control, summary-card deltas, table `Avg cost`/`Avg dur.`/`Last run`/`View`, row-expand caption, donut titles); add Stats-tab keys under `agents.json` (has `editor.tabs.stats`) and `skills.json`  → AC-10, AC-12, AC-13, AC-16, AC-17  → test_dashboard
- [ ] T28  Manual accessibility sweep across all three surfaces: keyboard operability of the period control / sortable headers / expandable rows / View+Open actions, aria-live announcement on async updates, accessible chart labels, light+dark contrast  → AC-36  → test_a11y

## Traceability matrix
| AC | Task | Test | Commit |
|------|------|----------------|--------|
| AC-1  | T14 | test_no_llm_calls.it | — |
| AC-2  | T10, T11, T17 | test_workspace_scope.it | — |
| AC-3  | T5, T10, T15 | test_period_query / test_workspace_scope.it | — |
| AC-4  | T5, T15 | test_period_query | — |
| AC-5  | T22, T24, T25 | test_dashboard / test_agent_stats_tab | — |
| AC-6  | T22, T24, T25 | test_dashboard / test_agent_stats_tab | — |
| AC-7  | T20, T22 | test_cost_fmt | — |
| AC-8  | T6, T20 | test_aggregation / test_cost_fmt | — |
| AC-9  | T7, T12, T14 | test_trace_shares / test_trace_panel_degrade.it | — |
| AC-10 | T19, T25, T27 | test_period_control / test_dashboard | — |
| AC-11 | T8, T15, T16, T18 | test_perf_route.it | — |
| AC-12 | T2, T8, T25 | test_perf_aggregation / test_dashboard | — |
| AC-13 | T2, T8, T25 | test_perf_aggregation / test_dashboard | — |
| AC-14 | T25 | test_dashboard | — |
| AC-15 | T25 | test_dashboard | — |
| AC-16 | T25 | test_dashboard | — |
| AC-17 | T8, T25 | test_perf_aggregation / test_dashboard | — |
| AC-18 | T6, T22, T24, T25 | test_dashboard / test_agent_stats_tab | — |
| AC-19 | T26 | test_nav_item | — |
| AC-20 | T21 | test_agent_editor_tabs | — |
| AC-21 | T1, T14, T15 | test_agent_stats_route.it | — |
| AC-22 | T22 | test_agent_stats_tab | — |
| AC-23 | T7, T12, T22 | test_trace_shares / test_agent_stats_route.it | — |
| AC-24 | T7, T12, T22 | test_trace_shares / test_agent_stats_tab | — |
| AC-25 | T6, T11, T22 | test_aggregation / test_agent_stats_tab | — |
| AC-26 | T6, T22 | test_aggregation / test_agent_stats_tab | — |
| AC-27 | T1, T22 | test_agent_stats_tab | — |
| AC-28 | T23 | test_skill_editor_tabs | — |
| AC-29 | T3, T13, T14, T15 | test_skill_stats_route.it | — |
| AC-30 | T9, T24 | test_skill_aggregation / test_skill_stats_tab | — |
| AC-31 | T9, T13 | test_skill_aggregation / test_skill_stats_route.it | — |
| AC-32 | T13, T24 | test_skill_stats_tab | — |
| AC-33 | T9, T24 | test_skill_aggregation / test_skill_stats_tab | — |
| AC-34 | T6, T8, T17 | test_dashboard_agent_parity.it | — |
| AC-35 | T10, T22 | test_source_included.it / test_agent_stats_tab | — |
| AC-36 | T19, T22, T24, T25, T28 | test_a11y (manual) / test_period_control | — |

## Risks & mitigations

- **Silent drift between dashboard and per-agent Stats numbers (AC-34).** *Risk:*
  two code paths compute accept-rate/cost/severity/trend differently. *Mitigation:*
  a single pure per-agent aggregator (T6) is called by both the dashboard
  assembler (T8) and the per-agent stats path (T14); an integration parity test
  (T17) locks it in.
- **`run_traces.trace` shape variance breaks the trace panels (AC-9).** *Risk:* a
  malformed / legacy / absent `prompt_assembly.skill_tokens` or `memory_pulled`
  throws and 500s the whole surface. *Mitigation:* raw jsonb read (T12) + per-run
  safe parse in pure code (T7) + service-level try/catch (T14); the panel degrades
  to empty and the rest of the surface renders (integration test T12/T14).
- **Unknown cost / accept-rate rendered as fake zeros (AC-7/AC-8).** *Risk:* null
  cost shows "$0.00", null accept-rate shows "0%". *Mitigation:* nullability
  enforced in the contract (T1/T2/T3) and pure aggregator (T6), and centralized
  null→"—" formatters (T20) used everywhere.
- **Route collision `/agents/performance` vs `/agents/:id`.** *Risk:* the new
  static route shadows or is shadowed by the agents module's param route.
  *Mitigation:* find-my-way ranks static > param, so `/agents/performance`
  resolves first; verified by the T15 integration test hitting both.
- **Reversing the intentional nav exclusion (AC-19).** *Risk:* leaving
  `Sidebar.test.tsx`'s `not.toContain("agent-performance")` in place makes an
  intentional-looking test fail once the nav item lands. *Mitigation:* T26
  reverses the assertion in the same change (mirrors the shipped `/memory`
  precedent) and adds `shell.json` `nav.agent-performance`.
- **Cross-workspace leakage (AC-2, A01/IDOR).** *Risk:* an aggregation query
  forgets the workspace guard and exposes another tenant's cost/findings.
  *Mitigation:* every repository read is `workspace_id`-scoped (T10/T11/T13);
  T17 asserts a cross-workspace request returns no foreign data.
- **Shared-contract drift server↔client.** *Risk:* client copy diverges from the
  server source of truth. *Mitigation:* T4 runs `sync-shared.mjs`; CI's
  `--check` fails on drift.

## Critical files for implementation

- `server/src/modules/stats/aggregation.ts` (NEW) — the single pure aggregation
  implementation; the heart of AC-34. Model it on
  `server/src/modules/pulls/cost.ts` (pure, DB-free, unit-tested).
- `server/src/modules/stats/repository.ts` (NEW) — the only Drizzle surface;
  workspace-scoped, period-bounded reads over `agent_runs` + `findings⋈reviews` +
  `run_traces`.
- `server/src/vendor/shared/contracts/observability.ts` /
  `contracts/productionize.ts` / `contracts/skill-stats.ts` (NEW) — the response
  contracts, synced to the client via `scripts/sync-shared.mjs`.
- `client/src/app/agent-performance/_components/AgentPerformanceView/` (NEW) — the
  dashboard (sortable table, row-expand, cost donuts, summary cards).
- `client/src/vendor/ui/nav.ts` + `client/src/vendor/ui/shell/Sidebar.test.tsx` —
  the GLOBAL nav item and the exclusion assertion that must be reversed together.

## Open questions / assumptions

Non-blocking assumptions (surfaced for the implementer; none change the design):

- **AC-31 subset semantics.** "Those runs" (for per-skill accept-rate,
  `findings_total`, and the category donut) = the period's runs BY linked agents
  WHOSE TRACE PULLED this skill — the numerator subset of `pull_frequency`, not
  all runs of linked agents. `used_by_agents` and the linked-agents list remain
  config-level and are NOT period-scoped.
- **Findings run-linkage.** Findings are attributed to a run via
  `findings.review_id → reviews.id → reviews.run_id → agent_runs.id`; reviews with
  a null `run_id` (legacy) cannot be period-bounded and are excluded from
  run-scoped aggregates.
- **Weekly severity bucket key.** Findings are bucketed into weeks by their run's
  `agent_runs.ran_at` (the same clock the period window uses).
- **Icon choice.** Nav uses `TrendingUp` (present in `icons.tsx`; distinct from
  `Activity`, which CI Runs uses); `LineChart` is not an available icon.
- **No new index / migration** is planned (spec Non-goal). A composite
  `(workspace_id, ran_at)` index on `agent_runs` is a deferred, optional follow-up
  if a real workspace shows slow reads.
