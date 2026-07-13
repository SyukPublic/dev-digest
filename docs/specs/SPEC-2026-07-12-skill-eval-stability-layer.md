# Spec: Skill Eval — stability layer (repeat + variance + noise-aware alert) | Spec ID: SPEC-2026-07-12-skill-eval-stability-layer | Status: approved
Supersedes: — | Superseded by: —

> MINI spec, authored 2026-07-12; re-grounded 2026-07-12 against the now-MERGED
> differential implementation. Status **approved** — the four blocking decisions
> were resolved with the user and are embedded below as UD-1..UD-4 (repeat/variance
> defaults, group persistence, alert shape, and group-compare scope); zero open
> `[NEEDS CLARIFICATION]` items remain. It BUILDS ON the IMPLEMENTED differential
> pipeline (`SPEC-2026-07-12-skill-eval-differential.md`, approved & shipped — the
> `eval_skill_suite_runs` table, the `eval-skill-suite.ts` contracts, the
> `SkillEvalRunExecutor`, and the reused `scoring.ts` all exist) and does NOT
> restate its acceptance criteria — inherited behavior is cited as "mirrors
> skill-diff AC-N". Prior art for the METHOD is the harness eval package
> (`evals/`: `eval:repeat`, `src/records/stats.ts`) — not a runtime dependency,
> only the reference for the statistics semantics. Captures WHAT/WHY only; the HOW
> (tables, migrations, code) is the implementation plan's job (`docs/plans/`).
> Facts ground-truthed against the merged codebase 2026-07-12 (see Inputs).

## Problem & context

The differential skill-eval scores each case **once** per suite run
(`SkillEvalRunExecutor.run` loops `snapshot.caseIds` a single time, then pools once
via `poolSuite` → `setTerminal` — `server/src/modules/eval/skill-run-executor.ts`).
But **both arms are LLM calls**, so a delta finding can appear in one run and vanish
in the next purely from model non-determinism. A single-run
`recall`/`precision`/`citation_accuracy` therefore carries **hidden variance the
product never surfaces**.

The v1 mitigation is trend-first: a code-computed regression alert over the two
latest completed runs (skill-diff AC-27). But **trend between versions is not the
same as variance within one version** — a "-3pts precision" move can be pure LLM
noise, and the alert cannot tell the two apart. So a reviewer cannot answer: *"is
this skill's delta stable, or did I just get a lucky/unlucky sample?"* and *"is
this regression real or within the noise band?"*.

The harness eval package already solved the METHOD (N runs → mean ± stddev, a
`flaky` band, `non_discriminating` when an artifact adds nothing, an
"n<K indicative only" caveat). This feature ports that method to the in-product
skill-eval — **without** changing the differential model or the scoring math.

## User-approved decisions (embedded — not re-opened)

- **UD-1 (repeat / variance defaults — product-tuned).** `STABILITY_MAX_N = 5`,
  `STABILITY_MIN_N = 5` (a sample with `n < 5` is labelled indicative-only), and
  `STABILITY_FLAKY_BAND = strict` — a case is `flaky` when its pass outcome is NOT
  unanimous (`0 < pass_rate < 1`), NOT the harness 20–80% band. Rationale: each run
  is 2 LLM passes, so a group is `2 × N × cases` passes; N = 5 is a moderate cost for
  a usable stddev. These `STABILITY_*` constants live in the eval module's
  `constants.ts`, alongside `EVAL_RUN_RATE_LIMIT`. Threaded into AC-1 (N cap), AC-4
  (indicative when `n < 5`), AC-5 (flaky = not unanimous).
- **UD-2 (group persistence).** A NEW sibling parent table
  `eval_skill_stability_groups` (following the shipped differential precedent, which
  chose a sibling `eval_skill_suite_runs` table over columns on the agent table) PLUS
  a nullable `stability_group_id` FK column on `eval_skill_suite_runs`. The child
  per-case rows keep their existing `eval_runs.skill_suite_run_id` link unchanged.
  The new table + column ship as their own additive migration (server rule). This is
  the stated shape in Contracts/Persistence and Dependencies — no longer the planner's
  call.
- **UD-3 (alert shape).** The noise-aware alert is a STRUCTURED new contract
  `EvalSkillStabilityAlert = { metric, move, band, beyond_band: boolean }`. The
  existing `EvalSkillDashboard.alert` (`z.string().nullable()`) STAYS unchanged for
  agent back-compat; the skill dashboard carries the structured alert additionally and
  the UI formats it. There is no "enrich the string" alternative. Threaded into AC-7
  and Contracts.
- **UD-4 (group compare = OUT OF SCOPE).** Two-GROUP mean-vs-mean comparison
  (mean ± band vs mean ± band) is explicitly a NON-GOAL of this spec — deferred to a
  later `compare` revision. v1 stability = repeat + variance + `flaky` /
  `non_discriminating` + noise-aware alert only. No AC implies group-vs-group compare.

## Goals / Non-goals

### Goals
- **Repeat a fixed skill snapshot N times.** Run the SAME (skill_id, skill_version,
  host_agent_id, host_agent_version) differential suite N times as one *stability
  group*, so the metrics come from a sample, not a single draw.
- **Per-metric variance.** Report `mean ± stddev` (with `n`) for recall / precision
  / citation_accuracy / cost across the group's completed runs, mirroring the
  harness `calcStats` semantics (sample stddev, n−1).
- **Per-case flaky flag.** A case whose pass outcome is not unanimous across the
  group's runs is `flaky`; surface it so a reviewer does not read one green/red as
  the truth.
- **`non_discriminating` aggregation.** A case whose delta is EMPTY in every run of
  the group (the skill added nothing for this case/host — already computed per-run
  as an empty delta, skill-diff AC-15) is flagged at the group level: the case does
  not discriminate for this skill.
- **Noise-aware regression alert.** The existing regression alert (skill-diff AC-27)
  is dampened by the stability band: a metric move that falls WITHIN the sampled
  stddev is NOT alerted as a regression.
- **Indicative-only honesty.** For a small sample (`n < STABILITY_MIN_N`) every
  variance figure is labelled indicative only, never presented as settled.
- **Reuse, don't rebuild.** Reuse the differential executor, the pure-code scorer,
  the snapshot mechanism, the fire-and-forget + polling + boot-reaping patterns, and
  the dashboard idioms — the stability layer only *repeats and aggregates* them.

### Non-goals (each with rationale)
- **Any change to the differential model, the delta computation, or the scoring
  math.** Rationale: stability is a layer OVER unchanged per-run outputs; a run is
  produced exactly as today.
- **Any `reviewer-core` change.** Rationale: the engine is already invoked per arm;
  repetition is a server-loop concern.
- **CI gates / pass-fail thresholds on stability.** Rationale: trend-first, like the
  parent — v1 reports variance, it does not block on it.
- **Cross-host or cross-version stability in one group.** Rationale: a stability
  group holds ONE frozen snapshot; mixing hosts/versions confounds variance with a
  real change (that is what `compare` is for).
- **Unbounded N.** Rationale: a differential run is already 2 LLM passes per case, so
  a group is `2 × N × cases` passes; N is capped and rate-limited.
- **Two-group compare (mean-vs-mean).** Rationale (UD-4): comparing two stability
  GROUPS as `mean ± band` vs `mean ± band` is deferred to a later `compare` revision;
  v1 is single-group repeat + variance + `flaky` / `non_discriminating` + noise-aware
  alert only. No AC in this spec implies group-vs-group comparison.

## Acceptance criteria (EARS)

Numbering is local to this spec. Inherited behavior cites "mirrors skill-diff AC-N".

- **AC-1** [Event-driven] WHEN a reviewer starts a stability run for a skill with a
  chosen host and a repeat count `N` (`2 ≤ N ≤ STABILITY_MAX_N`, where
  `STABILITY_MAX_N = 5`; UD-1), the system shall
  create a *stability group* over ONE frozen snapshot (skill_version +
  host_agent_version captured once, mirrors skill-diff AC-12) and execute N
  differential suite runs sequentially as a fire-and-forget background job, returning
  the group id immediately (mirrors skill-diff AC-8).
- **AC-2** [Ubiquitous] Every suite run in a group shall use the IDENTICAL captured
  snapshot; a mid-group skill or host edit shall not leak into the running group
  (mirrors skill-diff AC-12).
- **AC-3** [Event-driven] WHEN a group completes, the system shall compute per-metric
  `mean`, sample `stddev` (n−1), and `n` over the group's `done` runs for recall,
  precision, citation_accuracy, and cost — reusing the null-metric rule
  (a metric null in a run is excluded from that metric's sample; mirrors skill-diff
  AC-14).
- **AC-4** [State-driven] WHILE a group has `n < STABILITY_MIN_N` completed runs
  (`STABILITY_MIN_N = 5`; UD-1), the system shall mark every variance figure
  `indicative` so the UI labels it "indicative only" and never presents it as settled.
- **AC-5** [Ubiquitous] The system shall compute a per-case `pass_rate` = passes / n
  over the group and flag the case `flaky` WHEN its pass outcome is NOT unanimous
  (`0 < pass_rate < 1`) — `STABILITY_FLAKY_BAND = strict` (UD-1), NOT the harness
  20–80% band; unanimous cases (`pass_rate` of exactly 0 or 1) are never flaky.
- **AC-6** [Ubiquitous] The system shall flag a case `non_discriminating` WHEN its
  delta is empty in EVERY run of the group (the skill added nothing for this
  case/host across the whole sample), reusing the per-run empty-delta signal
  (`computeDelta` returning zero findings — `delta.ts`, skill-diff AC-15).
- **AC-7** [State-driven] WHILE a completed stability group provides a per-metric
  variance band for a skill, the regression alert (the existing pure `regressionAlert`
  over the two latest completed runs + its skill relabel `adaptSkillAlert` in
  `server/src/modules/eval/scoring.ts` / `service.ts`, skill-diff AC-27) shall be made
  NOISE-AWARE: a metric move whose magnitude is WITHIN the sampled stddev band shall
  NOT raise an alert; only a move beyond the band is surfaced, as the STRUCTURED
  `EvalSkillStabilityAlert` `{ metric, move, band, beyond_band }` (UD-3). The
  two-latest-completed and ≥1pt logic inside `regressionAlert` stays unchanged; the
  band is applied as a wrapper BEFORE the label, and the existing string
  `EvalSkillDashboard.alert` is preserved for agent back-compat. (No group-vs-group
  mean comparison — that is deferred; UD-4.)
- **AC-8** [Unwanted behavior] IF a single suite run within a group fails (setup or
  either-arm, mirrors skill-diff AC-21), THEN that run is excluded from the sample and
  the group CONTINUES; IF fewer than 2 runs complete, THEN the group is `failed` and
  no variance is reported (never a vacuous stddev of 0).
- **AC-9** [Unwanted behavior] IF a stability group is already running for the same
  skill, THEN a new group request is rejected with 409 (one live group per skill;
  mirrors skill-diff AC-19), and the per-run rate limit (`EVAL_RUN_RATE_LIMIT`,
  10/min) still bounds the fan-out — noting each group is a `2 × N × cases` LLM
  fan-out.
- **AC-10** [Event-driven] WHEN a reviewer opens the per-skill dashboard, the system
  shall show, for the latest stability group, each metric as `mean ± stddev (n)` with
  an indicative marker when applicable, and a per-case list carrying `pass_rate` +
  `flaky` / `non_discriminating` chips (colour is never the only signal).
- **AC-11** [State-driven] WHILE storing and running a stability group, the system
  shall treat the case `input_diff`, PR meta, and skill body as UNTRUSTED and use NO
  LLM in the aggregation/variance path (mirrors skill-diff AC-33); repetition adds no
  new external contact beyond the configured LLM provider.

## Contracts (shape-level)

No `reviewer-core` change; no edit to existing shared contracts. `@devdigest/shared`
gains ONE NEW file (e.g. `eval-skill-stability.ts`) — extend with new files, never
edit the barrel or the parent's now-shipped `eval-skill-suite.ts`. The group's sample
unit is the existing `EvalSkillSuiteRun` (its nullable `recall`/`precision`/
`citation_accuracy`/`cost_usd` are the per-run draws the stats aggregate over); it is
CONSUMED unchanged.

- **`EvalSkillStabilityGroup`** — `id`, `workspace_id`, `skill_id`, `skill_version`,
  `host_agent_id`, `host_agent_version`, `n_requested`, `status`
  (`running`|`done`|`failed`), `run_ids: string[]` (the child skill suite-run ids),
  `ran_at`.
- **`EvalMetricStat`** — `{ mean, stddev, n, indicative }` (nullable when the sample
  is empty), per metric.
- **`EvalSkillStabilitySummary`** — the group's `recall` / `precision` /
  `citation_accuracy` / `cost` as `EvalMetricStat`, plus `runs_completed` /
  `runs_failed`.
- **`EvalSkillCaseStability`** — per case: `case_id`, `pass_rate`, `runs`, `flaky`,
  `non_discriminating`.
- **`EvalSkillStabilityAlert`** — the noise-aware verdict as a STRUCTURED contract:
  `{ metric, move, band, beyond_band: boolean }` (UD-3). The existing
  `EvalSkillDashboard.alert` (`z.string().nullable()`) STAYS unchanged for agent
  back-compat; the skill dashboard carries this structured alert ADDITIONALLY and the
  UI formats it — the string is not replaced or enriched.

**Persistence (UD-2).** A stability group is N existing `eval_skill_suite_runs`
sharing a group id + the frozen snapshot; the aggregation reads those skill suite-run
rows (+ their per-case `eval_runs` for the flags). Following the shipped differential
precedent (which chose a SIBLING `eval_skill_suite_runs` table over columns on the
agent table), a group is a small `eval_skill_stability_groups` parent table PLUS a
nullable `stability_group_id` FK on `eval_skill_suite_runs`, subject to: (a) existing
rows stay valid; (b) the new table + column ship as their own additive migration
(server rule); (c) each child run keeps its own per-case
`eval_runs.skill_suite_run_id` link unchanged.

### API surface (shape-level)
Route names mirror the shipped skill surface (`POST /skills/:id/eval-runs`,
`GET /skill-eval-runs/:id`, `GET /skills/:id/eval-dashboard`):

| Endpoint (interface) | Request (shape) | Response (shape) |
|---|---|---|
| Start a stability group | `POST /skills/:id/stability-runs`, body `{ host_agent_id, n }` | `EvalSkillSuiteRunAccepted`-shaped `{ group_id, status: "running" }` (AC-1); 409 if running (AC-9); rejected on zero cases / no host (mirrors skill-diff AC-6/AC-20) |
| Read a group | `GET /skill-stability-runs/:id` | `EvalSkillStabilityGroup` + `EvalSkillStabilitySummary` + `EvalSkillCaseStability[]` (progressive, AC-3/AC-10) |
| Per-skill dashboard (extended) | `GET /skills/:id/eval-dashboard` | the shipped `EvalSkillDashboard` PLUS the latest group's variance + flags + noise-aware alert (AC-7/AC-10) |

## Non-functional

- **Performance / cost** — A group is `2 × N × cases` LLM passes (N differential
  runs). N is capped (`STABILITY_MAX_N`) and each start reuses `EVAL_RUN_RATE_LIMIT`
  (10/min). Runs execute SEQUENTIALLY (bounding provider concurrency, mirrors the
  parent). The variance/aggregation path is pure O(n × cases) code with no I/O; the
  client reuses the 4s-while-running polling and stops on terminal status.
- **Security** — No new authorization surface (workspace guard as today); no LLM in
  the aggregation path (AC-11); no new external contact — repetition only re-invokes
  the same provider path as a normal review.
- **Accessibility** — `flaky` / `non_discriminating` / `indicative` and metric
  direction convey state by icon + text, not colour alone; the noise-aware alert is
  announced (aria-live) as it appears after an async poll.
- **i18n** — English-only single locale `en` (AGENTS.md); the `eval` namespace is
  reused with new keys for the repeat control, variance display, and the flags.
- **Local-first** — All stability groups and their child runs live in the local
  Postgres database; consistent with the parent.

## Inputs (provenance)
- `[reused: skill-diff]` — `SPEC-2026-07-12-skill-eval-differential.md` (approved &
  shipped): the differential two-arm model, the frozen snapshot (AC-12), the pure-code
  scorer, the empty-delta signal (AC-15), the null-metric rule (AC-14), the
  fire-and-forget + 409-one-live + rate-limit + boot-reaping patterns, and the
  regression alert (AC-27) this layer makes noise-aware.
- `[reused: merged codebase, read 2026-07-12]` — the implemented differential surface:
  - `server/src/modules/eval/skill-run-executor.ts` — `SkillEvalRunExecutor.run(suiteId,
    snapshot, logger)` loops `snapshot.caseIds` ONCE and pools via `poolSuite`;
    `SkillSuiteSnapshot` freezes `skillBody`/`skillVersion` + host config +
    `hostAgentVersion` + `caseIds` at start; `buildArms` (WITHOUT = host enabled skills
    − S, WITH = +S deduped).
  - `server/src/modules/eval/delta.ts` — `computeDelta` (empty result = skill added
    nothing → the `non_discriminating` signal), `classifyDelta`, `combineCost`.
  - `server/src/modules/eval/scoring.ts` — `scoreCase` / `poolSuite` (micro-averaged,
    null-denominator rule), and `regressionAlert(completed: CompletedRunMetrics[])`
    (two-latest-completed, largest ≥1pt drop) that AC-7 wraps with a band; the skill
    relabel is `adaptSkillAlert` in `service.ts`.
  - `server/src/modules/eval/constants.ts` — `EVAL_RUN_RATE_LIMIT` `{ max: 10,
    timeWindow: '1 minute' }`, `RECENT_RUNS_LIMIT` 20, `EVAL_OWNER_SKILL` (now ACTIVE).
  - `server/src/db/schema/eval.ts` — the `eval_skill_suite_runs` table (sibling of the
    agent `eval_suite_runs`) + `eval_runs.skill_suite_run_id` FK (cascade); the sample
    unit + child-link this layer aggregates over.
  - `server/src/modules/eval/repository/eval-skill-suite.repo.ts` — `insertSuite`,
    `oneRunningForSkill`, `setTerminal`, `getSuite`, `listBySkill`,
    `listRecentByWorkspace`, `reapStaleRunningSkillSuites`, `deleteBySkill` (the repo
    surface a group aggregator reuses/extends).
  - `server/src/vendor/shared/contracts/eval-skill-suite.ts` — `EvalSkillSuiteRun`
    (the per-run sample), `EvalSkillDashboard` (with `alert: string | null`),
    `EvalSkillSuiteTrendPoint`, `EvalSkillCaseDelta`; CONSUMED unchanged.
  - `server/src/modules/eval/routes.ts` — the shipped routes this layer mirrors:
    `POST /skills/:id/eval-runs`, `POST /skill-eval-runs/all`, `GET /skill-eval-runs/:id`,
    `GET /skills/:id/eval-dashboard`, `GET /skills/:id/eval-hosts`.
- `[reference: method only, NOT a runtime dep]` — `evals/` harness package:
  `src/repeat.ts` (`eval:repeat` — N runs, `MAX_TIMES` cap, indicative-only for small
  n), `src/records/stats.ts` (`calcStats` sample stddev n−1; `computeFlags`
  `flaky` 20–80% band, `non_discriminating`, `always_failing`). This spec ports the
  SEMANTICS, not the code.

## Untrusted inputs

Identical trust boundary to the parent (skill-diff AC-33): the case `input_diff` +
PR meta and the skill body are UNTRUSTED, may legitimately bear secrets, are stored
workspace-scoped locally, and reach only the configured LLM provider as review
input during each run's two arms. The variance/aggregation path is pure code and
consumes no untrusted text as instructions.

## Dependencies & impacts
- **server** — the eval module gains a stability-group parent shape (a sibling
  `eval_skill_stability_groups` + a nullable `stability_group_id` on
  `eval_skill_suite_runs`, following the differential precedent + one additive
  migration), a repeat loop over the UNCHANGED `SkillEvalRunExecutor`, a pure
  variance/flag aggregator (over `EvalSkillSuiteRun` samples + per-case `eval_runs`),
  and a band wrapper over the existing `regressionAlert` / `adaptSkillAlert`. No
  `reviewer-core` change; no change to `scoring.ts`, `delta.ts`, or the executor.
- **client** — the per-skill dashboard gains a repeat control (N picker), variance
  display (`mean ± stddev (n)`), per-case flaky / non-discriminating chips, and the
  noise-aware alert annotation. Reuses the charts / polling / dashboard primitives.
- **@devdigest/shared** — one NEW contract file; the parent's contracts are consumed
  unchanged; the barrel is not edited.
- **Blast radius `[deterministic: repo-intel]`** — not applicable (no PR yet); NEW
  symbols + an additive migration over the shipped skill-eval surface.
