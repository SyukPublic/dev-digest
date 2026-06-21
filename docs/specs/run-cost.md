# Spec — Run Cost (USD) surfaced in the UI

> Status: planned · Owner: roman · Date: 2026-06-19
> Goal: show the **USD cost** of agent runs in three places, reusing the cost the
> review engine *already computes*. **Zero extra model calls.**

## 1. Summary

The review engine already returns `costUsd` per review (`reviewPullRequest` →
`ReviewOutcome.costUsd`), sourced from OpenRouter's real `usage.cost` or the
injected `estimateCost`/live `PriceBook`. Today the server **discards it**
([run-executor.ts:213](../../server/src/modules/reviews/run-executor.ts) destructures
only `tokensIn, tokensOut, grounding`), and the `agent_runs.cost_usd` column was
deliberately dropped by migration `0009_complex_runaways.sql`.

This feature **re-introduces the column, persists the cost, and renders it** in:

| # | Screen | Component | Format |
|---|--------|-----------|--------|
| 1 | PR list — new `COST` column | [PRRow.tsx](../../client/src/app/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx) | compact `$0.012` |
| 2 | Agent-runs timeline (per run) | [RunHistory.tsx](../../client/src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.tsx) | `9 119 tok · $0.0013` |
| 3 | Agent-run sidebar → Stats | [TraceBody.tsx](../../client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx) | `COST` stat tile `$0.06` |

## 2. Decisions (confirmed)

- **PR-list cost = sum of ALL the PR's runs.** [2026-06-20] The column shows the
  total cost of every agent run ever recorded for the PR, across all batches —
  "what this PR has cost to review so far". (Superseded the original
  latest-batch-only rollup.)
- **No backfill.** Historical runs (column was dropped) have no stored cost →
  render `—`. Cost only appears on runs executed after this lands.
- **Three render spots only** (list, timeline, sidebar). No cost row in the
  PR-Detail verdict plaque for now.
- **`—`, never `$0.00`** when cost is unknown/null. Failed & cancelled runs → null.

## 3. Data model

### 3.1 Migration `0010_<name>.sql` (manual: `pnpm db:migrate`)
```sql
ALTER TABLE "agent_runs" ADD COLUMN "cost_usd" double precision;   -- re-add (nullable)
ALTER TABLE "agent_runs" ADD COLUMN "batch_id" uuid;               -- groups one runReview() fan-out
```
- `cost_usd` nullable on purpose — unknown cost is `NULL` → UI `—`.
- `batch_id` is the deterministic grouping key for "the latest batch" (no
  reliance on `ran_at` time-windows). One id per `runReview()` call, shared by
  every agent run it creates.
- Optional supporting index for the list query:
  `CREATE INDEX agent_runs_pr_ranat_idx ON agent_runs (pr_id, ran_at DESC);`

### 3.2 Schema `server/src/db/schema/runs.ts`
Add to `agentRuns` (import `doublePrecision`):
```ts
costUsd: doublePrecision('cost_usd'),
batchId: uuid('batch_id'),
```

## 4. Server — persist & expose

1. **`service.ts` `runReview`** — generate one batch id per call and pass it to
   every `createAgentRun`:
   ```ts
   const batchId = randomUUID();           // node:crypto
   // ...createAgentRun({ ..., batchId })
   ```
2. **`run.repo.ts` `createAgentRun`** — accept + insert `batchId`.
3. **`run-executor.ts`** — capture the cost that's already there:
   - line ~213: `const { tokensIn, tokensOut, grounding, costUsd } = outcome;`
   - pass `costUsd` to `completeAgentRun` (success path).
   - failure / cancel / `failAll` paths: `costUsd: null`.
   - add `cost_usd: costUsd` to the persisted `RunTrace.stats`.
4. **`run.repo.ts` `completeAgentRun`** — accept `costUsd: number | null`, set it.
5. **`run.repo.ts` `listRunsForPull`** — select & map `cost_usd: run.costUsd`
   into each `RunSummary` (feeds screen #2).
6. **PR-list query** ([pulls/routes.ts](../../server/src/modules/pulls/routes.ts), near the
   existing `latestReviewByPr` block) — compute total cost per PR:
   - select `{ prId, costUsd }` from `agent_runs` for the listed `prIds`;
   - per PR: sum `costUsd` (skipping nulls) over every one of its runs
     (`totalCostByPr` in `./cost.ts`);
   - if the PR has no priced run → `null` (→ `—`).
   - map into `PrMeta.cost_usd`.

## 5. Contracts (`@devdigest/shared`)

> ⚠️ Contracts are **vendored into both packages** (`server/src/vendor/shared`
> and `client/src/vendor/shared`). Edit the source of truth, then re-vendor to
> the client (check for the sync script before hand-editing both copies).

- `contracts/trace.ts` → `RunStats`: add `cost_usd: z.number().nullable()`.
- `contracts/trace.ts` → `RunSummary`: add `cost_usd: z.number().nullable()`.
- `contracts/platform.ts` → `PrMeta`: add `cost_usd: z.number().nullish()`
  (list-only, mirrors how `score` is documented there).
- `AgentColumn` / `MultiAgentRun.total_cost_usd` already carry `cost_usd` —
  re-adding the column also unblocks those later (out of scope here).

## 6. Client — render

### 6.1 Shared helper + component
- `formatCost(usd: number | null): string` — `—` when null; else `$` +
  precision rule: `>= 0.1 → 3 decimals` (`$0.123`), `< 0.1 → 4 decimals`
  (`$0.0013`). (Tunable — matches the mock screenshots.)
- `RunCostBadge` (2 variants, per the requirements slide):
  - `compact` → `$0.012` (list cell + timeline);
  - `withTokens` → `$0.0013 · 9 119 tok` (timeline meta line).
  - Both return `—` (muted) when cost is null.

### 6.2 Screen 1 — PR list
- `constants.ts`: add `"cost"` to `COLUMN_KEYS` (before `"updated"`); widen
  `GRID` by one column (e.g. add `78px`).
- `PRRow.tsx`: render a cost cell using `formatCost(pr.cost_usd)`.
- i18n `prReview.list.columns.cost = "COST"`.

### 6.3 Screen 2 — agent-runs timeline
- `RunHistory.tsx`: in the right-aligned meta block (currently only `ran_at`),
  add a `tok · cost` line for settled runs:
  `{formatTokens(tokens_in,tokens_out)} · {formatCost(cost_usd)}`.

### 6.4 Screen 3 — sidebar Stats
- `TraceBody.tsx`: add a 4th `<Stat label={t("trace.stat.cost")}
  val={formatCost(stats.cost_usd)} />` next to duration/tokens/findings.
- i18n `runs.trace.stat.cost = "COST"`.

## 7. Cost source (no change needed)
Already wired in `platform/container.ts`: OpenRouter provider returns the real
`usage.cost`; OpenAI/Anthropic adapters and the OpenRouter `estimateCost` use
the `PriceBook` (live pricing) / static `pricing.ts` table. The engine stays
pricing-table-free (cost is injected). **No new network/model calls.**

## 8. Tests
- **server**: `run-executor` persists `costUsd` on success / null on failure;
  PR-list returns the total over all the PR's runs & `null` when no priced runs;
  contract test for the new nullable fields.
- **client**: `formatCost` (null → `—`, precision); `PRRow` renders cost / `—`;
  `TraceBody` shows the COST tile; `RunHistory` shows the cost line.

## 9. Acceptance criteria
1. Every **completed** run shows a cost badge in all three screens.
2. A run/ PR with no priced data shows `—`, never `$0.00`.
3. PR-list cost = sum of all the PR's agent runs (every batch).
4. Zero additional model/network calls are made to display cost.
5. Historical (pre-feature) runs render `—` (no backfill).
