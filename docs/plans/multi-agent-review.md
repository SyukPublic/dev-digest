# Development Plan: Multi-Agent Review

- **Spec:** docs/specs/SPEC-multi-agent-review.md (Status: approved; AC-1 … AC-37; zero [NEEDS CLARIFICATION])
- **Execution mode:** multi-agent (parallel implementer waves)

## Context

DevDigest can run one reviewer agent — or fan out "Review all" — over a PR, but results
are one-agent-at-a-time and offer no way to compare specialized reviewers on the same code.
This feature (lesson L07) runs an **arbitrary selected set** of agents **in real parallel**
in one pass, groups their findings by code location so duplicates stop nagging and
disagreements surface, keeps per-agent attribution in the data, and reuses the existing Run
Trace + Live Log for the "why did this cost this much / what did the grounding gate reject"
story. Much of the plumbing is pre-scaffolded but unwired (the `MultiAgentRun` /
`AgentColumn` / `Conflict` contracts, i18n copy, the `multi_agent_runs` stub table); this
plan wires it together, builds the page + picker + multi-run service, and — per **D1** —
replaces the sequential agent loop with a bounded parallel fan-out.

**One-line goal:** launch N chosen agents in parallel over a PR, persist a grouped multi-run,
and present per-agent columns/tabs + on-read cross-agent conflicts + reused trace/live-log.

## Requirements review & recommendations

The spec is testable and internally consistent; no blocking ambiguity was found. Resolved
design decisions D1–D4 and the shape-level contracts made this a wiring/HOW exercise. The
following are **non-blocking** engineering findings folded into the plan (no spec change
required):

- **AC-36 (429) is not assertable in the integration suite.** Per-route `config.rateLimit`
  is a **no-op under tests** — `buildApp` registers `@fastify/rate-limit` only when
  `config.nodeEnv !== 'test'` (server INSIGHT 2026-07-13). So the live 429 cannot be proven
  via `app.inject()`. AC-36 is therefore split: (a) an integration/unit assertion that the
  launch route **carries** `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }` and
  that the shared error envelope shape is used, plus that SSE routes carry
  `rateLimit: false`; and (b) a manual dev-server check for the actual 429. This is a
  test-harness reality, not a scope change.
- **Aggregates computed on read, not stored (recommendation, adopted).** AC-11 requires the
  multi-run to *expose* `agent_count`/`total_duration_ms`/`total_cost_usd`; it does not
  require storing them. Deriving them on read from the grouped `agent_runs` (which already
  persist `duration_ms`/`cost_usd`) mirrors the existing PR-list cost rollup pattern and
  avoids denormalization drift (server INSIGHTS 2026-06-20, 2026-06-27). See **DEC-B**.
- **Barrel wiring is unavoidable and sanctioned.** "Never edit the barrel" means *do not
  modify existing export lines*; a **single additive** `export * from './contracts/…'` line
  for a NEW contract file is how every prior contract (observability, productionize,
  onboarding-api) was wired. The plan adds exactly one such line and runs the sync script.
- **AC-31 render is a bonus, not the gate.** AC-31's verification is server-side (the trace
  enumerates the dropped findings). Rendering them in the drawer is included as a small extra
  (T12) but is not what makes AC-31 pass (T2 + T5 do).

## Affected packages & files

**`@devdigest/shared`** (server copy is source of truth; re-vendored to client via
`node scripts/sync-shared.mjs`):
- `server/src/vendor/shared/contracts/multi-agent.ts` — **new**: `MultiAgentRunRequest`,
  `MultiAgentRunLaunch` (fire-and-forget ack), `AgentEstimate` / `AgentEstimates`.
- `server/src/vendor/shared/contracts/trace.ts` — **additive** optional `grounding_dropped`
  field on `RunTrace`.
- `server/src/vendor/shared/index.ts` — one additive re-export line.
- `server/src/vendor/shared/contracts/observability.ts` — **reuse as-is** (`MultiAgentRun`,
  `AgentColumn`, `AgentColumnFinding`, `Conflict`, `ConflictTake`).

**`server`** (all multi-run backend inside the existing `reviews` module — see **DEC-A**):
- `server/src/db/schema/runs.ts` — add `multiAgentRunId` column on `agent_runs` (+ migration).
- `server/src/modules/reviews/run-executor.ts` — D1 parallel fan-out + `grounding_dropped`.
- `server/src/modules/reviews/repository/multi-run.repo.ts` — **new**.
- `server/src/modules/reviews/repository/estimate.repo.ts` — **new**.
- `server/src/modules/reviews/repository/run.repo.ts` — `createAgentRun` gains `multiAgentRunId`.
- `server/src/modules/reviews/repository.ts` — compose the new repo methods.
- `server/src/modules/reviews/multi-run-service.ts` — **new** coordinator.
- `server/src/modules/reviews/conflicts.ts` — **new** pure conflict builder.
- `server/src/modules/reviews/routes.ts` — 3 new routes.
- `reviewer-core/src/grounding.ts` — export pure `rangesOverlap` (generalized `rangeIntersects`).

**`client`**:
- `client/src/components/run-trace/**` — **new** home for the lifted `RunTraceDrawer`
  (moved out of the pulls route so the new page can reach it).
- `client/src/app/repos/[repoId]/pulls/[number]/page.tsx` — update the drawer import only.
- `client/src/lib/hooks/multi-agent.ts` — **new** query/mutation hooks.
- `client/src/vendor/ui/nav.ts` — new nav item + `g m` shortcut.
- `client/src/app/repos/[repoId]/pulls/[number]/_components/AgentPicker/**` — **new** picker.
- `client/src/app/repos/[repoId]/pulls/[number]/_components/PrDetailHeader/PrDetailHeader.tsx`
  — swap `RunReviewDropdown` → `AgentPicker`.
- `client/src/app/repos/[repoId]/multi-agent/**` — **new** Multi-Agent Review route + `_components`.
- `client/messages/en/runs.json` — add keys for the (N) button, per-agent estimate, summed
  estimate (reuse the existing `page`/`column`/`conflicts`/`tabs`/`trace`/`drawer` blocks).

**Reuse (do not rebuild):** `useRunEvents`/`useSseEvents`, `useRunTrace`, `useFindingAction`,
`useAgents`, `RunTraceDrawer`, `LiveLogStream`, `formatCost`/`RunCostBadge`, `githubBlobUrl`,
`ReviewRunExecutor.executeRuns`, `ReviewRepository`, the SSE `RunBus`, `messages/en/shell.json`
`nav.multi-agent`, and the `CaseEditor` (`initialDraft` without `caseId` = create-on-save).

## Shared scaffold (context pack)

Parallel implementers must NOT re-open these sources — the load-bearing fragments are lifted
here verbatim with citations.

### Recorded conventions (verbatim — must be honored)

- **Client tests use `fireEvent`, never `user-event`** (`@testing-library/user-event` is not a
  dep). "Client component tests use `fireEvent` from `@testing-library/react` — … render under
  `NextIntlClientProvider` … + `ToastProvider`; assert toasts via their rendered text."
  (client/INSIGHTS.md 2026-06-24).
- **`useRunEvents` is content-addressed by `runIds.join(",")`** — "its `eslint-disable
  react-hooks/exhaustive-deps` is deliberate … callers may pass a fresh array each render …
  do NOT 'fix' the disable or memoize `runIds`." (client/INSIGHTS.md 2026-06-22). Key the
  multi-run SSE subscription off `runIds.join(',')`.
- **Reuse cost formatting** — "Run-cost UI shares `src/lib/format.ts` (`formatCost` → '—' for
  unknown cost, never '$0.00') and the `RunCostBadge` component … reuse them, don't re-format
  cost inline." (client/INSIGHTS.md 2026-06-19).
- **Shared contracts are two vendored copies with a sync script** — "the SERVER copy is the
  source of truth … run `node scripts/sync-shared.mjs` after editing a contract and CI fails
  on drift via `--check`. Don't hand-edit the client copy." (server/INSIGHTS.md 2026-06-22).
- **Trace-before-status write order is load-bearing** — in `runOneAgent`, persist
  `saveRunTrace` BEFORE flipping `completeAgentRun({status:'done'})` (server/INSIGHTS.md
  2026-07-04). Any change in T5 must preserve this order.
- **Client imports contracts TYPE-ONLY** — never value-import a contract schema in the client
  (pulls zod into the bundle). Use type-level guards for enum-shaped constants
  (client/INSIGHTS.md 2026-06-28).
- **Per-route rate limit is a no-op under tests** — assert route config / an app-level guard,
  not a live 429 via `inject()` (server/INSIGHTS.md 2026-07-13).
- **jsdom stubs** — `scrollIntoView` is absent (stub in `beforeEach`); adding a new hook to an
  already-mocked hooks module breaks sibling tests with "No QueryClient set" unless overridden
  (client/INSIGHTS.md 2026-06-26, 2026-07-05).

### Onion placement (from the always-on skill)

Routes parse once at the edge with a shared Zod contract → call ONE service method; DB access
only in `repository/*.repo.ts`; `reviewer-core` stays pure (the diff/findings are inputs).
The multi-run service MAY construct its own module-private repo from `container.db`, and reads
shared entities (`agentsRepo`, `reviewRepo`) via the container facade — never by deep-importing
another module. `arch:check` (`pnpm arch:check` from `server/`) must stay green.

### Reused utility bodies (call these; do not re-read the sources)

`useRunEvents` — `client/src/lib/hooks/reviews.ts:166-168` (wrapper) over
`client/src/lib/hooks/sse.ts:9-55` (`useSseEvents`):
```ts
export function useRunEvents(runIds: string[]) {
  return useSseEvents(runIds.map((id) => `${API_BASE}/runs/${id}/events`));
}
// useSseEvents: subscribes to N EventSource streams, content-addressed by key = urls.join(",");
// returns { events: RunEvent[]; running: boolean }; replays buffer on connect, ends on done.
```

`api` client — `client/src/lib/api.ts:89-100` (all hooks build on this; errors → `ApiError`):
```ts
export const api = {
  get:  <T>(path, opts?) => apiFetch<T>(path, { signal: opts?.signal }, opts),
  post: <T>(path, body?, opts?) => apiFetch<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined, signal: opts?.signal }, opts),
  del:  <T>(path, opts?) => apiFetch<T>(path, { method: "DELETE", signal: opts?.signal }, opts),
  // + put, patch
};
```

`createAgentRun` — `server/src/modules/reviews/repository/run.repo.ts:135-161` (T6 extends the
`values` object + insert with an optional `multiAgentRunId`; everything else unchanged):
```ts
export async function createAgentRun(db, values: {
  workspaceId: string; agentId: string | null; prId: string;
  provider: string | null; model: string | null; batchId: string;
  // T6 ADD: multiAgentRunId?: string | null;
}): Promise<string> {
  const [row] = await db.insert(t.agentRuns).values({
    workspaceId: values.workspaceId, agentId: values.agentId, prId: values.prId,
    provider: values.provider, model: values.model, batchId: values.batchId,
    status: 'running', source: 'local',
    // T6 ADD: multiAgentRunId: values.multiAgentRunId ?? null,
  }).returning({ id: t.agentRuns.id });
  return row!.id;
}
```

`rangeIntersects` — `reviewer-core/src/grounding.ts:41-46` (T8 generalizes to a finding-vs-
finding `rangesOverlap`):
```ts
function rangeIntersects(lines: Set<number>, start: number, end: number): boolean {
  const lo = Math.min(start, end); const hi = Math.max(start, end);
  for (let n = lo; n <= hi; n++) if (lines.has(n)) return true;
  return false;
}
// T8 ADD (pure, exported): rangesOverlap(aStart,aEnd,bStart,bEnd) =>
//   Math.max(min(a),min(b)) <= Math.min(max(a),max(b))
```

`GroundingResult.dropped` shape — `reviewer-core/src/grounding.ts:18-21` (source for T2/T5):
```ts
export interface GroundingResult { kept: Finding[]; dropped: { finding: Finding; reason: string }[]; }
```

`RunTraceDrawer` props — `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/RunTraceDrawer.tsx:19-29`
(default export; T12 moves the folder verbatim, updates only the import in `pulls/[number]/page.tsx:17`):
```ts
export interface RunTraceDrawerProps {
  runId: string; agentName?: string | null; prNumber?: number | null;
  findings?: FindingRecord[]; running?: boolean; onClose: () => void;
}
```

### Reused contract shapes (already barrel-exported from `observability.ts`)

`MultiAgentRun` = `{ id, pr_id, pr_number?, ran_at, agent_count, total_duration_ms,
total_cost_usd(nullable), columns: AgentColumn[], conflicts: Conflict[] }`.
`AgentColumn` = `{ run_id, agent_id, agent_name, provider(nullable), model(nullable),
status:'done'|'failed'|'running', verdict(nullable), score(int,nullable), summary(nullable),
duration_ms(int,nullable), cost_usd(nullable), findings: AgentColumnFinding[] }`.
`AgentColumnFinding` = `{ id, severity, category, title, file, start_line, kind? }`.
`Conflict` = `{ file, line, title, takes: ConflictTake[] }`.
`ConflictTake` = `{ agent_id, persona, verdict: Severity | 'ignored', note }` (`'ignored'` ==
"did not flag"). `Finding` has `start_line`/`end_line`, `suggestion` (suggested fix),
`confidence` (0..1), `kind`, `trifecta_components`; there is **no** `agent` field — attribution
is `review_id → ReviewRecord.agent_id`/`agent_name`.

### Pre-written i18n (reuse; add only the noted new keys)

`client/messages/en/runs.json` already has `page` (title/subtitle/selectPr/prItem/view/running/
noAgents/noRun/crumb + a `page.runAll` = "Run all agents" and `page.meta`), `column`
(noFindings/findingsCount), `conflicts` (title/onlyConflicts/empty/didNotFlag), `tabs`,
`trace`, `drawer`, `severity`, `viewTrace`. `client/messages/en/shell.json` `nav.multi-agent`
= "Multi-Agent Review" already exists. **Add** (T16) keys for: the "Run multi-agent review (N)"
button, the per-agent estimate line, and the summed estimate; `page.runAll` may be repurposed
as a "select all" affordance.

### Decisions (do not reopen)

- **DEC-A — Module placement: inside `server/src/modules/reviews/`.** The multi-run reuses
  `ReviewRunExecutor.executeRuns` (the D1 fan-out, which MUST live in the reviews module) and
  `ReviewRepository` (owns `agent_runs`/`run_traces`) without crossing the module facade
  (onion rule 7); `multi_agent_runs` grouping is an observability concern already co-located
  with `agent_runs` here. A separate `modules/multi-agent/` would need a new cross-module
  facade purely to launch runs — more wiring, no benefit.
- **DEC-B — Grouping storage: keep `multi_agent_runs` as the persisted identity; add ONE
  nullable `multiAgentRunId` FK column on `agent_runs`** (`onDelete: 'set null'` → graceful
  E13 degradation). Aggregates (`agent_count` = count, `total_duration_ms` = MAX per-agent
  duration, `total_cost_usd` = SUM of priced runs) are computed **on read** from the grouped
  rows. `batch_id` is untouched (separate concern; still stamped per fan-out). Migration adds
  the one column; MANUAL (`cd server && pnpm db:migrate`).
- **DEC-C — Grounding-rejected surfacing: additive optional `RunTrace.grounding_dropped`**
  (`{ title, file, start_line, end_line, reason }[]`), mapped from `outcome.dropped` (already
  returned by `reviewPullRequest`, currently discarded) in `runOneAgent`'s trace builder.
  Optional so old traces still parse (mirrors `skill_tokens`/`spec_tokens`).
- **DEC-D — Conflicts: pure + on-read.** Generalize `rangesOverlap` in `reviewer-core`; the
  grouping pass lives in a pure `reviews/conflicts.ts` (same file + line-range overlap + same
  category, optional title-token overlap), invoked when serving `GET /pulls/:id/multi-agent`.
  Not stored (AC-21). "did not flag" takes (`verdict='ignored'`) synthesized for agents that
  reviewed but did not flag that location (AC-22).
- **DEC-E — Estimate: minimal batch read `GET /agents/estimates`** — `avg(duration_ms)` /
  `avg(cost_usd)` over the agent's completed `agent_runs`, workspace-scoped, nullable with
  `sample_size` (0 ⇒ fallback; never 0-as-"unknown"). Query on `ReviewRepository` (rollups over
  `agent_runs` belong there — server INSIGHT 2026-06-22). Route hosted in the reviews module;
  `/agents/estimates` (static) safely precedes `/agents/:id` (param) in find-my-way. Summed
  estimate (Σ cost, max duration) composed client-side.
- **DEC-F — Launch response: fire-and-forget ack** `{ multi_run_id, pr_id, runs:
  {run_id, agent_id, agent_name}[] }` (mirrors the existing `ReviewRunResponse` fire-and-forget
  shape) so the client subscribes to each run's SSE immediately; the full `MultiAgentRun` is
  then read via `GET /pulls/:id/multi-agent`.

## Tasks

### Wave 1 — shared contracts + schema/migration (blocking prerequisite)

Both Wave-2 backend and frontend slices import the Wave-1 contract types; backend also needs
the migration. Phase 1 and Phase 2 touch disjoint files → `parallel-safe` with each other.

#### Phase 1 — Shared contracts   (parallel-safe)
- **Surface:** shared (`@devdigest/shared`)
- **Disjoint scope:** `server/src/vendor/shared/contracts/multi-agent.ts` (new),
  `server/src/vendor/shared/contracts/trace.ts` (additive), `server/src/vendor/shared/index.ts`
  (one added line), and the sync-generated `client/src/vendor/shared/**` (via the script only).
- **Skills to apply:** `zod`, `typescript-expert`
- **What changes & why:** define the only-missing transport shapes; reuse `observability.ts`
  as-is. Re-vendor so the client sees them.
- **How to test:** `bash scripts/test-mirror.sh server exec vitest run --exclude '**/*.it.test.ts'`
  (contract parse/reject unit tests); the client copy is verified by the sync `--check` in CI.
- [ ] T1  New `contracts/multi-agent.ts` — `MultiAgentRunRequest { agent_ids: z.array(z.string()).min(1) }`, `MultiAgentRunLaunch { multi_run_id, pr_id, runs: {run_id, agent_id, agent_name}[] }`, `AgentEstimate { agent_id, agent_name, avg_duration_ms: number|null, avg_cost_usd: number|null, sample_size: int≥0 }`, `AgentEstimates = array`; add ONE additive barrel re-export line; run `node scripts/sync-shared.mjs`   → AC-5, AC-6, AC-7, AC-9, AC-10   → test_multi_agent_contracts
- [ ] T2  Additive optional `grounding_dropped: z.array(z.object({ title, file, start_line, end_line, reason })).nullish()` on `RunTrace` in `contracts/trace.ts`; re-vendor; assert an old (field-less) trace still parses   → AC-31   → test_trace_grounding_dropped_contract

#### Phase 2 — Schema + migration   (parallel-safe)
- **Surface:** server (DB schema)
- **Disjoint scope:** `server/src/db/schema/runs.ts`, generated `server/drizzle/*` migration SQL.
- **Skills to apply:** `drizzle-orm-patterns`, `postgresql-table-design`, `onion-architecture`
- **What changes & why:** add the grouping link (DEC-B); keep the empty `multi_agent_runs`
  course table (never delete). Column is nullable so legacy `agent_runs` rows are unaffected.
- **How to test:** `bash scripts/test-mirror.sh server exec vitest run .it.test` (grouping
  asserted via the Phase-4/5 integration tests once the migration is applied).
- [ ] T3  Add nullable `multiAgentRunId: uuid('multi_agent_run_id').references(() => multiAgentRuns.id, { onDelete: 'set null' })` to `agentRuns` in `schema/runs.ts`; `cd server && pnpm db:generate`; **MANUAL apply** `cd server && pnpm db:migrate` (NOT auto-run on boot)   → AC-11, AC-27   → test_multi_run_grouping

### Wave 2 — backend ∥ frontend (disjoint file sets)

Backend Phases 3–5 and frontend Phases 6–8 own non-overlapping files and run concurrently.
Within the backend, Phase 3 (executor) and Phase 4 (repo) are `parallel-safe`; Phase 5
(service+routes) `depends on Phase 4`. Within the frontend, Phase 6 (plumbing) is
`parallel-safe`; Phases 7 and 8 `depend on Phase 6` but are file-disjoint from each other.

#### Phase 3 — Parallel fan-out + grounding trace   (parallel-safe; depends on Phase 1)
- **Surface:** server (reviews module)
- **Disjoint scope:** `server/src/modules/reviews/run-executor.ts` ONLY. Keep the
  `executeRuns` signature stable so Phase 5 is decoupled.
- **Skills to apply:** `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`
- **What changes & why:** D1 — replace the sequential `for … await` loop (~line 170) with a
  bounded parallel fan-out (p-queue with a concurrency cap) so total duration ≈ max, not sum;
  preserve per-agent failure isolation and the once-loaded diff + once-derived intent (shared
  pre-work stays before the fan-out). Do NOT touch `ci/` or `agent-runner/`.
- **How to test:** `bash scripts/test-mirror.sh server exec vitest run .it.test`; then
  `pnpm arch:check` green.
- [ ] T4  Replace the sequential loop with a bounded p-queue fan-out over `jobs`, each calling `runOneAgent`; keep failure isolation (a rejected agent marks its own row failed, others continue) and the shared `diff`/`sharedIntent`   → AC-13, AC-14, AC-15, AC-16   → test_parallel_fanout
- [ ] T5  In `runOneAgent`'s success trace builder, map `outcome.dropped` → `trace.grounding_dropped` (`{title, file, start_line, end_line, reason}`); preserve the trace-before-status write order   → AC-31   → test_trace_grounding_rejected

#### Phase 4 — Multi-run persistence + estimate   (parallel-safe; depends on Phases 1, 2)
- **Surface:** server (reviews module — repo layer)
- **Disjoint scope:** `server/src/modules/reviews/repository/multi-run.repo.ts` (new),
  `server/src/modules/reviews/repository/estimate.repo.ts` (new),
  `server/src/modules/reviews/repository/run.repo.ts` (`createAgentRun` param only),
  `server/src/modules/reviews/repository.ts` (compose). Does NOT touch `run-executor.ts`,
  `routes.ts`, or `service.ts`.
- **Skills to apply:** `drizzle-orm-patterns`, `onion-architecture`
- **What changes & why:** the DB seam for grouping, read-back, and the historical estimate.
- **How to test:** `bash scripts/test-mirror.sh server exec vitest run .it.test`.
- [ ] T6  `multi-run.repo.ts`: `createMultiRun(workspaceId, prId) → id`; `getLatestMultiRun(workspaceId, prId)` = latest `multi_agent_runs` row for the PR + its grouped `agent_runs` (join agent name/provider/model) + each run's review/findings (via existing `reviewsForPull`/join); extend `createAgentRun` to accept `multiAgentRunId`; compose all into `ReviewRepository`   → AC-11, AC-12, AC-27   → test_multi_run_repo
- [ ] T7  `estimate.repo.ts`: `agentRunEstimates(workspaceId, agentIds?) → { agent_id, avg_duration_ms, avg_cost_usd, sample_size }[]` over `status='done'` runs, workspace-scoped; nullable averages, `sample_size` = count; expose via `ReviewRepository`   → AC-5, AC-6   → test_agent_estimates

#### Phase 5 — Multi-run service + conflicts + routes   (depends on Phase 4)
- **Surface:** server (reviews module) + reviewer-core (pure primitive)
- **Disjoint scope:** `server/src/modules/reviews/multi-run-service.ts` (new),
  `server/src/modules/reviews/conflicts.ts` (new), `server/src/modules/reviews/routes.ts`
  (3 routes added), `reviewer-core/src/grounding.ts` (add `rangesOverlap`), and (if the service
  is promoted) `server/src/platform/container.ts`. Does NOT touch the repo files (owned by
  Phase 4) or `run-executor.ts` (Phase 3).
- **Skills to apply:** `onion-architecture`, `fastify-best-practices`, `zod`, `security`
- **What changes & why:** the orchestration + edge. Validate the launch body once at the route;
  reject foreign agent ids; compute conflicts on read.
- **How to test:** `bash scripts/test-mirror.sh reviewer-core test` (rangesOverlap),
  `bash scripts/test-mirror.sh server exec vitest run --exclude '**/*.it.test.ts'` (conflicts
  unit) then `… .it.test` (service/routes); `pnpm arch:check`.
- [ ] T8  `reviewer-core/src/grounding.ts`: export pure `rangesOverlap(aStart, aEnd, bStart, bEnd): boolean` (generalized from `rangeIntersects`); keep the core pure   → AC-21   → test_ranges_overlap
- [ ] T9  `conflicts.ts` (pure): `buildConflicts(columns: AgentColumn[]): Conflict[]` — group findings by `file` + overlapping `[start_line,end_line]` (via `rangesOverlap`) + same `category` (optional title-token overlap); for each group emit a `ConflictTake` per reviewing agent, synthesizing `verdict='ignored'` for agents that ran but did not flag the location; a group is a conflict when severities diverge OR flagged-vs-did-not-flag   → AC-21, AC-22, AC-23   → test_conflicts
- [ ] T10  `multi-run-service.ts`: `launch(workspaceId, prId, agentIds)` — resolve/validate that every id is a workspace agent (reject foreign → 400/404), `createMultiRun`, create N `agent_runs` (`multiAgentRunId` + one `batchId`), fire-and-forget `executor.executeRuns`, return the DEC-F ack; `getLatest(workspaceId, prId)` — build `AgentColumn[]`, aggregates (count / MAX duration / SUM priced cost), `conflicts = buildConflicts(columns)` → `MultiAgentRun`; `estimates(workspaceId)` → `AgentEstimates`   → AC-9, AC-10, AC-11, AC-12, AC-14, AC-22, AC-27   → test_multi_run_service
- [ ] T11  Routes in `reviews/routes.ts`: `POST /pulls/:id/multi-agent-run` (parse `MultiAgentRunRequest` at edge, `config.rateLimit {max:10,timeWindow:'1 minute'}`, resp `MultiAgentRunLaunch`), `GET /pulls/:id/multi-agent` (resp `MultiAgentRun`), `GET /agents/estimates` (resp `AgentEstimates`); SSE routes stay `rateLimit:false`   → AC-10, AC-12, AC-36   → test_multi_agent_routes

#### Phase 6 — Frontend plumbing: drawer lift + hooks + nav   (parallel-safe; depends on Phase 1)
- **Surface:** client
- **Disjoint scope:** move `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/**`
  → `client/src/components/run-trace/**`; edit the single importer
  `client/src/app/repos/[repoId]/pulls/[number]/page.tsx` (import line + mount only);
  `client/src/lib/hooks/multi-agent.ts` (new); `client/src/vendor/ui/nav.ts`.
- **Skills to apply:** `react-frontend-architecture`, `react-best-practices`, `next-best-practices`, `react-testing-library`
- **What changes & why:** the drawer must live in a neutral shared module so the new route can
  import it without violating the route-privacy import boundary; hooks + nav unblock Phases 7–8.
- **How to test:** `bash scripts/test-mirror.sh client test`.
- [ ] T12  Lift `RunTraceDrawer` (with its `_components`/helpers/styles/constants + tests) to `client/src/components/run-trace/`; update the pulls-page import; behavior identical; optionally render `grounding_dropped` in `TraceBody`   → AC-28, AC-31   → test_run_trace_drawer
- [ ] T13  `lib/hooks/multi-agent.ts`: `useAgentEstimates()` (GET `/agents/estimates`), `useLaunchMultiAgentRun()` (POST `/pulls/:id/multi-agent-run`), `useMultiAgentRun(prId)` (GET `/pulls/:id/multi-agent`, `refetchInterval` while any column `running`); API only via `lib/api.ts`   → AC-5, AC-9, AC-12, AC-17   → test_multi_agent_hooks
- [ ] T14  Add the `multi-agent` nav item to `NAV` in `vendor/ui/nav.ts` (`href: "/repos/:repoId/multi-agent"`, `gKey: "m"`) + a `g m` `SHORTCUTS` row; label via `shell.json` `nav.multi-agent`   → AC-34   → test_nav

#### Phase 7 — PR-header agent picker   (depends on Phase 6)
- **Surface:** client (pulls route)
- **Disjoint scope:** `client/src/app/repos/[repoId]/pulls/[number]/_components/AgentPicker/**`
  (new), `.../PrDetailHeader/PrDetailHeader.tsx` (swap the control). Does NOT touch `page.tsx`
  (owned by Phase 6) or the new route (Phase 8). `RunReviewDropdown` may be left in place until
  Wave 3 retires it.
- **Skills to apply:** `react-frontend-architecture`, `react-best-practices`, `react-testing-library`
- **What changes & why:** AC-1 — replace the one-or-all Run Review control with a multi-select
  picker that launches a multi-run and routes to the new page.
- **How to test:** `bash scripts/test-mirror.sh client test`; e2e in Wave 3.
- [ ] T15  `AgentPicker` — a checkbox per workspace agent (from `useAgents`), a per-agent time/cost orientation (from `useAgentEstimates`, `formatCost`/`RunCostBadge`, fallback when `sample_size=0`), "Run multi-agent review (N)" (disabled when 0 selected), "Configure agents…" → `/agents`, merged/closed warning (reuse the header's existing merged banner + `prReview.runReview.mergedWarning`); on launch → `useLaunchMultiAgentRun` then `router.push` to `/repos/:repoId/multi-agent`; wire it into `PrDetailHeader` in place of `RunReviewDropdown`   → AC-1, AC-4, AC-5, AC-8, AC-9, AC-35   → test_agent_picker

#### Phase 8 — Multi-Agent Review page   (depends on Phase 6)
- **Surface:** client (new route)
- **Disjoint scope:** `client/src/app/repos/[repoId]/multi-agent/**` (new: `page.tsx` +
  `_components/ConfigureRun`, `ColumnsView`, `TabsView`, `ConflictsBlock`) and additive keys in
  `client/messages/en/runs.json`. File-disjoint from Phase 7. `page.tsx` is owned solely by this
  phase; if two implementers share it, split by disjoint `_components` subfolders with `page.tsx`
  wired last by the ConfigureRun owner (phase-size balance — this phase is the largest slice).
- **Skills to apply:** `react-frontend-architecture`, `react-best-practices`, `next-best-practices`, `react-testing-library`
- **What changes & why:** the whole page (AC-2/3, configure, results Columns/Tabs, conflicts,
  live status, empty states, actions).
- **How to test:** `bash scripts/test-mirror.sh client test`; e2e in Wave 3.
- [ ] T16  `page.tsx` + `ConfigureRun` — mode switch (Configure ⇄ Results); Step 1 PR select, Step 2 agent checkboxes (DB agents only), per-agent estimate + summed estimate (Σ cost, MAX duration) composed client-side, "Run multi-agent review (N)" (disabled at 0), `noAgents`/`noRun` empty states; add the new i18n keys ((N) button, per-agent estimate, summed estimate)   → AC-2, AC-3, AC-4, AC-6, AC-7, AC-8, AC-9   → test_configure_run
- [ ] T17  `ColumnsView` (default) — per-agent header (status/score/cost via `RunCostBadge`), findings list, "View trace" opening the lifted `RunTraceDrawer`; Columns/Tabs toggle; live status via `useMultiAgentRun` + `useRunEvents(runIds.join(','))` with `aria-live`; zero-findings column empty state   → AC-17, AC-18, AC-19, AC-28, AC-37   → test_columns_view
- [ ] T18  `ConflictsBlock` — "Where agents disagree" below the columns + "Show only conflicts" toggle + "agents agree" empty state; render each `ConflictTake` including the `verdict='ignored'` ("did not flag") take   → AC-20, AC-22, AC-23, AC-37   → test_conflicts_block
- [ ] T19  `TabsView` + finding detail — per-agent tabs; confidence %, suggested fix (`suggestion`), actions Accept/Dismiss (via `useFindingAction`), Learn (stub), Turn into eval case (bridge stub via `CaseEditor` `initialDraft` without `caseId`); `lethal_trifecta` renders "ALL 3 PRESENT" from `trifecta_components`   → AC-24, AC-25, AC-26   → test_tabs_detail

### Wave 3 — integration / wiring + e2e + trace reuse

Depends on Phases 5, 7, 8. Deterministic e2e (no LLM).

#### Phase 9 — Integration, e2e & measurement   (depends on Phases 5, 7, 8)
- **Surface:** cross-cutting (e2e + server integration)
- **Disjoint scope:** `e2e/**` (new specs) and `server/test/*.it.test.ts` (measurement/SSE);
  final wiring touch-ups only (retire `RunReviewDropdown` if fully replaced; confirm the
  header→page navigation). Uses files already owned above — schedule after they land.
- **Skills to apply:** `react-testing-library` (e2e patterns), `fastify-best-practices`, `security`
- **How to test:** e2e suite (deterministic); `bash scripts/test-mirror.sh server exec vitest run .it.test`.
- [ ] T20  e2e deterministic flow: nav item + route exist (AC-34); page opens in Configure when no multi-run and launch switches to Results (AC-2/AC-9); Columns/Tabs toggle (AC-18); "View trace" opens the drawer (AC-28); "Show only conflicts" filters (AC-23); zero-findings empties (AC-37); PR header shows the picker not Run Review, and a merged PR warns yet still permits (AC-1/AC-35)   → AC-1, AC-34, AC-35   → test_multi_agent_e2e
- [ ] T21  Integration/measurement: SSE replay-then-live for a late/reconnecting subscriber (AC-29, reuses `RunBus`); trace exposes prompt-block token counts + per-call cost (AC-30) and per-finding cost is derivable (AC-33); "1 vs 3" — total duration ≈ MAX, total cost ≈ SUM (~3×) via deterministic mocks/clock (AC-32)   → AC-29, AC-30, AC-32, AC-33   → test_multi_run_measurement

## Traceability matrix

| AC | Task(s) | Test | Commit |
|------|---------|------|--------|
| AC-1  | T15, T20 | test_agent_picker / test_multi_agent_e2e | — |
| AC-2  | T16, T20 | test_configure_run | — |
| AC-3  | T16 | test_configure_run | — |
| AC-4  | T15, T16 | test_configure_run | — |
| AC-5  | T1, T7, T13, T16 | test_agent_estimates | — |
| AC-6  | T1, T7, T16 | test_agent_estimates | — |
| AC-7  | T1, T16 | test_configure_run | — |
| AC-8  | T15, T16 | test_configure_run | — |
| AC-9  | T10, T15, T16 | test_multi_run_service | — |
| AC-10 | T1, T10, T11 | test_multi_agent_routes | — |
| AC-11 | T3, T6, T10 | test_multi_run_repo | — |
| AC-12 | T6, T10, T11 | test_multi_agent_routes | — |
| AC-13 | T4 | test_parallel_fanout | — |
| AC-14 | T4, T10, T21 | test_parallel_fanout | — |
| AC-15 | T4 | test_parallel_fanout | — |
| AC-16 | T4 | test_parallel_fanout (+ arch:check) | — |
| AC-17 | T13, T17 | test_columns_view | — |
| AC-18 | T17, T20 | test_columns_view | — |
| AC-19 | T17 | test_columns_view | — |
| AC-20 | T18 | test_conflicts_block | — |
| AC-21 | T8, T9 | test_conflicts | — |
| AC-22 | T9, T10, T18 | test_conflicts | — |
| AC-23 | T9, T18, T20 | test_conflicts_block | — |
| AC-24 | T19 | test_tabs_detail | — |
| AC-25 | T19 | test_tabs_detail | — |
| AC-26 | T19 | test_tabs_detail | — |
| AC-27 | T3, T6, T10 | test_multi_run_repo | — |
| AC-28 | T12, T17, T20 | test_run_trace_drawer / test_multi_agent_e2e | — |
| AC-29 | T21 | test_multi_run_measurement | — |
| AC-30 | T21 | test_multi_run_measurement | — |
| AC-31 | T2, T5, T12 | test_trace_grounding_rejected | — |
| AC-32 | T21 | test_multi_run_measurement | — |
| AC-33 | T21 | test_multi_run_measurement | — |
| AC-34 | T14, T20 | test_multi_agent_e2e | — |
| AC-35 | T15, T20 | test_agent_picker / test_multi_agent_e2e | — |
| AC-36 | T11 | test_multi_agent_routes (config asserted; live 429 manual — see review) | — |
| AC-37 | T17, T18 | test_columns_view / test_conflicts_block | — |

Commit is "—" at planning time; the implementer fills it as each task lands; plan-verifier
audits AC↔task↔test coverage against this table.

## Risks & mitigations

- **Parallel fan-out regressions (D1, highest-impact).** `executeRuns` is shared by the
  existing single/all-agent flow. Mitigation: T4 keeps the signature stable, preserves the
  once-loaded diff + once-derived intent and per-agent failure isolation, bounds concurrency
  with a cap, and preserves the trace-before-status write order; run the FULL server unit +
  integration suites (they cover the existing review paths) and `arch:check`.
- **Shared-pre-work failure fails all agents (E4).** By design: no agent can run without a
  diff. Keep the existing `failAll` pre-fan-out; the per-agent isolation only applies inside
  the fan-out (AC-15).
- **Contract drift between the two vendored copies.** Mitigation: never hand-edit the client
  copy — run `node scripts/sync-shared.mjs` in Phase 1; CI `--check` fails on drift.
- **`/agents/estimates` vs `/agents/:id` routing.** Static wins over parametric in find-my-way,
  so no clash; documented in DEC-E. Verify with a route test.
- **Migration not applied.** Migrations are MANUAL — integration tests will `relation … does
  not exist` until `cd server && pnpm db:migrate` runs. Called out in T3.
- **AC-36 live 429 unprovable in tests.** Mitigation: assert route config + envelope in tests,
  verify the actual 429 manually (see Requirements review).
- **New route importing pulls-route internals.** The client import-boundary lint forbids it —
  hence the drawer lift (T12) must precede Phase 8's use of it.
- **Agent deleted after running (E13).** `onDelete: 'set null'` on both `agent_id` and the new
  `multiAgentRunId` FK keeps columns degrading gracefully (retain `agent_name` on the run/join
  where possible); assert no crash.

## Critical files for implementation

- `server/src/modules/reviews/run-executor.ts` — D1 fan-out + `grounding_dropped` (T4, T5).
- `server/src/modules/reviews/multi-run-service.ts` (new) — the coordinator (T10).
- `server/src/vendor/shared/contracts/observability.ts` — the reused `MultiAgentRun`/`Conflict`
  shapes; `contracts/multi-agent.ts` (new) — the request/estimate shapes (T1).
- `server/src/db/schema/runs.ts` — the grouping column + migration (T3).
- `client/src/app/repos/[repoId]/multi-agent/page.tsx` (new) — the page composition root (T16–T19).

## Open questions / assumptions

- **Assumption (non-blocking):** the launch route hosts `GET /agents/estimates` in the reviews
  module (data owner); moving it to the agents module later is a pure relocation (query stays
  on `ReviewRepository`).
- **Assumption:** `MultiAgentRunLaunch` (DEC-F) is the launch response envelope; the spec left
  the exact envelope a planner choice and only requires immediate per-run SSE subscription,
  which this satisfies.
- **Assumption:** the concurrency cap for the p-queue fan-out is a small constant (e.g. 4,
  matching the seeded agent count); the implementer may make it a named constant in
  `reviews/constants.ts`. No AC pins a specific value.
- **Assumption:** "Turn into eval case" reuses `CaseEditor` with `initialDraft` and no
  `caseId` (create-on-save) per client INSIGHT 2026-07-12 — a bridge stub, not the eval-case
  pipeline (AC-25 non-goal).
