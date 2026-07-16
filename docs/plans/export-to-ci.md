# Development Plan: Export to CI

- **Spec:** docs/specs/SPEC-2026-07-14-export-to-ci.md (Status: approved, 0 open clarifications)
- **Execution mode:** multi-agent
- **Lab / branch:** DevDigest L07 · worktree `dev-digest-worktree/ci` · branch `labs/I07-ci`

## Context

DevDigest agents are debugged in the studio but only deliver value when they run in the
target repository's own CI, on every PR. "Export to CI" gives an agent that path: it
serializes the agent config to `.devdigest/agents/<slug>.yaml` via the ONE shared
`AgentManifest` Zod schema (one contract, two consumers), generates a self-contained
6-file GitHub Actions bundle (manifest + skill files + empty `memory.jsonl` + committed
bundled runner + workflow), opens a reviewed PR to branch `devdigest/ci`, and pulls each
CI run's result back into the studio (pull-on-refresh, no webhooks). Two new UI surfaces
land: the agent-editor **CI tab** and the global **CI Runs** page.

This is heavily pre-scaffolded (L06): the `agent-runner` consumer, the CI Zod contracts,
the `ci_installations` table, the dormant `GitHubClient` write methods
(`commitFiles`/`openPullRequest`/`findOpenPr`), the `ExportWizardSteps`/`Modal` primitives,
and the full `ci.json` i18n namespace all exist. **This feature wires the studio-side
producer + ingest + the two UI surfaces on top of them — it does NOT rebuild what exists,
and it does NOT modify `agent-runner`.**

Goal (one line): a single "Add to CI" action turns a validated studio agent into a
reviewed, self-contained PR check in a real repo, with its runs visible back in the studio.

## Requirements review & recommendations

The spec is testable and internally coherent; every AC is observable. Findings below are
**non-blocking** implementation- and spec-level recommendations folded into the plan (no
blocking ambiguity remained — the mode is given and the single tuning point, 30s poll /
7-day lookback, is resolved inline).

- **R1 (impl — AC-6 carry mechanism).** `CiExportInput` (reused as-is) has NO `files`
  field, yet AC-6 requires Step-2 edits to be carried to Install. Resolution: add a NEW
  contract `CiExportRequest = CiExportInput.extend({ files: CiFile.array().nullish() })`
  in the new contract file (does NOT edit the frozen `CiExportInput`/`AgentManifest`). The
  route parses `CiExportRequest`; when `files` are present it commits them verbatim (after
  re-validating the manifest round-trips `AgentManifest`, AC-4), else it generates them.
- **R2 (impl — `ci_runs` retirement).** AGENTS.md hard rule: "never delete the empty
  'course' tables in `server/src/db/schema/*`." The spec explicitly permits leaving the
  table "empty-and-unused." Decision: **keep the `ci_runs` table physically**; "retire" =
  no new code reads/writes `ci_runs`/`CiRun` (CI runs live in `agent_runs WHERE
  source='ci'`), and `CiRun` is treated as deprecated/unreferenced (no edit to the existing
  contract file).
- **R3 (impl — shared-contract sync).** `@devdigest/shared` is TWO vendored copies; a sync
  script now exists (`server/INSIGHTS.md` 2026-06-22 correction): **the server copy is the
  source of truth, `node scripts/sync-shared.mjs` propagates to the client, CI fails on
  drift.** To avoid a mirror-sync race between parallel implementers, ALL
  `server/src/vendor/shared/**` edits (new contract + `GitHubClient` interface) are
  consolidated into the single barrier phase, which runs the sync once.
- **R4 (spec-level, minor — AC-31 "workflow version").** `CiInstallation` has no version
  field and there is no per-installation workflow-version store. Assumption: the CI-tab
  installation row's "workflow version" shows a derived/constant value (the generated
  workflow's version constant, or the latest run's `CiResultArtifact.version`), not a
  per-installation stored column. Recorded as an assumption, not a new column.
- **R5 (impl — AC-34 PR title).** `CiResultArtifact` carries `pr_number` but not the PR
  title. The CI Runs row's "#123 · title" shows the PR number from the artifact/run
  metadata; the title is best-effort from the workflow run's `display_title` and may be
  omitted when unavailable. No extra per-run GitHub fetch is required.
- **R6 (impl — AC-42 octokit coverage).** The real `OctokitGitHubClient` action methods
  are not directly unit-tested (consistent with the existing dormant write methods, which
  are exercised only through `MockGitHubClient`). AC-42 coverage = interface + typecheck +
  `MockGitHubClient` parity + the ingest integration test.

## Affected packages & files

**server/**
- `server/src/db/schema/runs.ts` — extend `agent_runs` (4 nullable columns) + generated
  migration `0023_*.sql` (+ `meta/`). Role: AC-40.
- `server/src/vendor/shared/contracts/ci-runs.ts` (NEW) — `CiRunSummary` + `CiExportRequest`.
- `server/src/vendor/shared/index.ts` — one `export *` line for the new file.
- `server/src/vendor/shared/adapters.ts` — 2 new `GitHubClient` port methods.
- `server/src/adapters/github/octokit.ts` — implement the 2 methods (rest.actions.*).
- `server/src/adapters/mocks.ts` — `MockGitHubClient` parity for the 2 methods.
- `server/src/modules/ci/**` (NEW module) — `routes.ts`, `service.ts`, `repository.ts`,
  `constants.ts`, `serialize.ts`, `workflow.ts`, `bundle.ts`, `ingest.ts`. Onion: routes →
  service → repository/adapters. Mirrors the `agents` module.
- `server/src/modules/index.ts` — one import + one entry (`ci`).
- Reuse: `container.github()` (port + ConfigError), `container.agentsRepo.linkedSkills`,
  the `agent-runner/dist/index.js` build artifact, `fflate` (zip; already a dep, used by
  `skill-import`), `listRunsForPull` mapper as the CI-runs query template,
  `createAgentRun`/`completeAgentRun` insert pattern.

**client/**
- `client/messages/en/ci.json` — i18n corrections (owned by the barrier phase).
- `client/src/app/agents/[id]/page.tsx` — add `"ci"` to `VALID_TABS`.
- `client/src/app/agents/[id]/_components/AgentEditor/{constants.ts,AgentEditor.tsx}` — tab
  registry entry + body-switch branch.
- `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/**` (NEW) — CI tab +
  the 4-step Export wizard modal.
- `client/src/lib/hooks/ci.ts` (NEW) — export/install/installations/agent-CI-runs hooks.
- `client/src/vendor/ui/nav.ts` — new "GLOBAL" section + "CI Runs" item.
- `client/src/app/ci-runs/**` (NEW) — thin page + `_components/CiRunsView`.
- `client/src/lib/hooks/ci-runs.ts` (NEW) — CI-runs list + ingest/refresh hooks.
- Reuse: `RunRow`, `RunHistory`, `RunCostBadge`, `SeverityCountBadges`/`SeverityBadge`,
  `Modal`, `ExportWizardSteps`, `CI_FAIL_ON_VALUES` pattern, `useUpdateAgent`, `activeKeyFor`
  (already returns `"ci-runs"`), `shell.json` nav label + `page.crumb` (already present).

**agent-runner/** — NOT modified. Its existing test suite verifies AC-18/20/21/22; it is
built (`pnpm build` → ncc `dist/index.js`) as an export-time prerequisite.

## Shared scaffold (context pack)

Everything parallel implementers need, lifted verbatim with `file:line`. **Reference this
section instead of re-opening the sources.**

### C0 — Recorded conventions that CONSTRAIN this plan (verbatim from INSIGHTS)

- **Shared contracts sync** (`server/INSIGHTS.md` 2026-06-22 correction): *"A sync script
  now exists: the SERVER copy is the source of truth (reviewer-core aliases to it too); run
  `node scripts/sync-shared.mjs` after editing a contract and CI fails on drift via
  `--check` in `client.yml`. Don't hand-edit the client copy."* → All `vendor/shared` edits
  are made in `server/src/vendor/shared/**` and propagated by `node scripts/sync-shared.mjs`
  (Phase 1 only).
- **Client component tests** (`client/INSIGHTS.md` 2026-06-24): *"Client component tests use
  `fireEvent` from `@testing-library/react` — `@testing-library/user-event` is NOT a
  dependency… Pattern: `vi.mock` the data hooks + `next/navigation`, render under
  `NextIntlClientProvider` (messages imported by relative path, `@/` can't reach
  `messages/`) + `ToastProvider`; assert toasts via their rendered text."* Use `fireEvent`,
  never `user-event`.
- **Adding a hook to a mocked module** (`client/INSIGHTS.md` 2026-07-05): a component that
  gains a hook from an already-mocked hooks module breaks unrelated tests ("No QueryClient
  set") — when a tested component consumes a new `ci`/`ci-runs` hook, sweep every test that
  mocks that module and add the override.
- **DB-backed tests** (`server/INSIGHTS.md`): *"DB-backed tests must use the `*.it.test.ts`
  suffix or the unit/integration split breaks"*; keep unit tests in `server/test/` (a
  `*.test.ts` under `src/` gets emitted to `dist/`).
- **Migrations are MANUAL** (`server/AGENTS.md`, AGENTS.md): `pnpm db:generate` produces the
  SQL (codegen — the implementer runs this and commits the file); `pnpm db:migrate` APPLIES
  it (manual, dev DB / human). Integration tests apply migrations automatically:
  `server/test/helpers/pg.ts` `startPg()` calls `runMigrations(url)`, so a generated
  `0023_*.sql` is picked up with no manual step.
- **`fflate`** (`server/INSIGHTS.md` 2026-06-23): pure JS, zero post-install scripts (no
  `pnpm approve-builds`); `adapters/skill-import` uses `unzipSync(bytes, { filter })`.
  Install/build from the WSL toolchain, not Git Bash pnpm.
- **octokit@4** (`server/INSIGHTS.md` 2026-06-27/28): batteries-included; the existing
  `OctokitGitHubClient` already disables retry/throttle and wraps calls in a resilience
  `call()` seam — the new `rest.actions.*` calls go THROUGH that same `this.call(...)`.
- **Run cost** (`client/INSIGHTS.md` 2026-06-19): reuse `RunCostBadge` + `formatCost`
  ("—" for unknown, never "$0.00"); never re-format cost inline. `cost_usd` stays
  null-for-unknown (never a 0 sentinel).
- **Dialog a11y** (`client/INSIGHTS.md` 2026-06-22): `Modal` already wires
  `useDialogA11y(onClose)` (Esc + Tab focus-trap + focus-restore). `SelectInput` does NOT
  forward arbitrary DOM props.
- **AGENTS.md invariant:** never delete the empty "course" tables → `ci_runs` stays.

### C1 — Server module scaffold (mirror the `agents` module)

`server/src/modules/index.ts` registration (verbatim, `modules/index.ts:32-50`): add
`import ci from './ci/routes.js';` at top and one `ci,` key in the `modules` object.

Route plugin shape (`modules/agents/routes.ts:1-12,71-73`):
```ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
// ...
export default async function agentsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new AgentsService(app.container);
```
Handlers read the workspace via `await getContext(app.container, req)` (`../_shared/context.js`).

Service ctor (`modules/agents/service.ts:51-56`) — build the module-private repository from
`container.db`:
```ts
export class AgentsService {
  private repo: AgentsRepository;
  constructor(private container: Container) {
    this.repo = new AgentsRepository(container.db);
  }
```
Repository decl (`modules/agents/repository.ts:1-6,51-52`):
```ts
import { and, asc, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
// ...
export class CiRepository { constructor(private db: Db) {} }   // shape to mirror
```
Note: a module-private repo is NOT swappable via `ContainerOverrides`
(`server/INSIGHTS.md` 2026-06-30). Its DB access is tested via **integration** (real
Postgres through `MockGitHubClient` overrides), not prototype spies.

### C2 — `container.github()` + facades (verbatim, `platform/container.ts`)

```ts
async github(): Promise<GitHubClient> {              // :206-213  — NOTE: async, returns Promise
  if (this.overrides.github) return this.overrides.github;
  if (this._github) return this._github;
  const token = await this.secrets.get('GITHUB_TOKEN');
  if (!token) throw new ConfigError('GITHUB_TOKEN is not configured');   // AC-43 source
  this._github = new OctokitGitHubClient(token);
  return this._github;
}
get agentsRepo(): AgentsRepository { return (this._agentsRepo ??= new AgentsRepository(this.db)); } // :111-113
readonly db: Db;                                     // :68
```
`ContainerOverrides` (`container.ts:46-64`) has `github?: GitHubClient` — tests inject
`MockGitHubClient`.

### C3 — GitHub write methods the export CALLS (verbatim `adapters/github/octokit.ts`)

`commitFiles` (`octokit.ts:325-386`) — ONE atomic commit (blobs→tree→commit→ref);
create-or-fast-forward the branch; layered on the parent tree:
```ts
async commitFiles(repo, payload): Promise<{ branch: string }> {
  return this.call(async () => {
    const g = this.octokit.rest.git;
    let parentSha; let branchExists = false;
    try { const ref = await g.getRef({ owner, repo: name, ref: `heads/${payload.branch}` });
          parentSha = ref.data.object.sha; branchExists = true; }
    catch { const baseRef = await g.getRef({ owner, repo: name, ref: `heads/${payload.base}` });
            parentSha = baseRef.data.object.sha; }
    const parentCommit = await g.getCommit({ owner, repo: name, commit_sha: parentSha });
    const tree = await g.createTree({ owner, repo: name, base_tree: parentCommit.data.tree.sha,
      tree: payload.files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.contents })) });
    const commit = await g.createCommit({ owner, repo: name, message: payload.message,
      tree: tree.data.sha, parents: [parentSha] });
    if (branchExists) await g.updateRef({ owner, repo: name, ref: `heads/${payload.branch}`, sha: commit.data.sha, force: true });
    else await g.createRef({ owner, repo: name, ref: `refs/heads/${payload.branch}`, sha: commit.data.sha });
    return { branch: payload.branch };
  });
}
```
`openPullRequest` (`octokit.ts:311-323`) → `{ url: res.data.html_url }`;
`findOpenPr(repo, branch)` (`octokit.ts:388-400`) → lists open PRs with
`head: \`${owner}:${branch}\`` → `{ url } | null`. Interface + payload shapes in
`adapters.ts:121-167` (`CommitFile`, `CommitFilesPayload{branch,base,message,files}`,
`OpenPrPayload{title,head,base,body}`).

### C4 — `MockGitHubClient` (verbatim `adapters/mocks.ts`) + integration override

```ts
export class MockGitHubClient implements GitHubClient {                     // :130
  public openedPrs: OpenPrPayload[] = [];
  public committed: CommitFilesPayload[] = [];
  constructor(private opts: MockGitHubOptions = {}) {}
  async openPullRequest(_r, payload) { this.openedPrs.push(payload); return { url: 'https://github.com/mock/mock/pull/1' }; } // :218
  async commitFiles(_r, payload) { this.committed.push(payload); return { branch: payload.branch }; }                        // :223
  async findOpenPr(_r, branch) { const pr = this.openedPrs.find((p) => p.head === branch); return pr ? { url: '…/pull/1' } : null; } // :228
}
```
Integration test wiring (`server/test/pulls-comments.it.test.ts:10,13,77-82`):
```ts
import { buildApp } from '../src/app.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
const gh = new MockGitHubClient({ /* workflowRuns, artifacts, … */ });
const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
const res = await app.inject({ method: 'POST', url: `/agents/${id}/export-ci`, payload });
// assert against gh.committed / gh.openedPrs
```
Docker-gated: `const d = hasDocker ? describe : describe.skip;`. **The 2 new adapter methods
(Phase 1) must add capture/return fixtures to `MockGitHubOptions`** (e.g. `workflowRuns`,
`artifacts: Record<runId, string>`) so Phase 2's ingest integration can drive them.

### C5 — `agent_runs` insert/query patterns (verbatim `modules/reviews/repository/run.repo.ts`)

CI-runs list = the `listRunsForPull` mapper (`run.repo.ts:57-87`) adapted to
`WHERE source='ci'` (workspace-scoped, left-join agents for the name, newest-first),
mapping every `RunSummary` field + the 4 CI columns into `CiRunSummary`:
```ts
const rows = await db.select({ run: t.agentRuns, agentName: t.agents.name })
  .from(t.agentRuns).leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
  .where(and(eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.source, 'ci')))
  .orderBy(desc(t.agentRuns.ranAt));
return rows.map(({ run, agentName }) => ({ run_id: run.id, agent_id: run.agentId,
  agent_name: agentName ?? null, provider: run.provider, model: run.model, status: run.status,
  error: run.error, duration_ms: run.durationMs, tokens_in: run.tokensIn, tokens_out: run.tokensOut,
  findings_count: run.findingsCount, grounding: run.grounding, cost_usd: run.costUsd,
  ran_at: run.ranAt ? run.ranAt.toISOString() : null, score: run.score, blockers: run.blockers,
  source: run.source, repo: run.repo, pr_number: run.prNumber, github_url: run.githubUrl,
  ci_installation_id: run.ciInstallationId }));
```
Ingest upsert mirrors `createAgentRun` (`run.repo.ts:135-160`, sets `source`) — but
**idempotent by `(workspaceId, ciInstallationId, githubUrl)`**: select-by-`githubUrl` →
update in place if found, else insert. No new unique constraint (local rows keep NULL
`github_url`). `costUsd` persisted from the artifact, never recomputed; null when unknown.

### C6 — Client hooks + api conventions

`api` wrapper (`client/src/lib/api.ts:89-100`): generic `api.get<T>(path)`, `api.post<T>(path, body)`,
`api.put`, `api.del`; no per-endpoint list — call with new path strings. `API_BASE` is
prepended; `204` → `undefined`; errors normalize to `ApiError`.

Full hook conventions (`client/src/lib/hooks/agents.ts` — verbatim, the shape to mirror):
```ts
"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Agent, ModelInfo, Provider, ReviewStrategy } from "@devdigest/shared";
export function useAgents() { return useQuery({ queryKey: ["agents"], queryFn: () => api.get<Agent[]>("/agents") }); }
export function useAgent(id) { return useQuery({ queryKey: ["agent", id], queryFn: () => api.get<Agent>(`/agents/${id}`), enabled: !!id }); }
export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateAgentInput) => api.put<Agent>(`/agents/${id}`, patch),   // patch keys include "ci_fail_on" (:54)
    onSuccess: (data) => { qc.invalidateQueries({ queryKey: ["agents"] }); qc.setQueryData(["agent", data.id], data); },
  });
}
```
Conditional-poll pattern for auto-refresh (`hooks/reviews.ts:42-50`, `usePrRuns`):
```ts
return useQuery({ queryKey: ["pr-runs", prId], queryFn: () => api.get<RunSummary[]>(`/pulls/${prId}/runs`),
  enabled: !!prId, refetchInterval: (query) =>
    (query.state.data ?? []).some((r) => r.status === "running") ? 4000 : false });
```
For CI Runs auto-refresh use **30s** (not 4000ms — GitHub rate limits) gated on the
page's auto-refresh toggle, and re-run the INGEST mutation on the interval (AC-39), then
invalidate the list. New hook files are imported directly (`@/lib/hooks/ci`,
`@/lib/hooks/ci-runs`) — the `hooks/index.ts` barrel need NOT be edited.

### C7 — Agent editor tab wiring (verbatim)

`VALID_TABS` (`client/src/app/agents/[id]/page.tsx:16`): add `"ci"`:
```ts
const VALID_TABS = ["config", "skills", "context", "evals"];   // → add "ci"
```
Tab registry (`AgentEditor/constants.ts:11-16`) — add one entry (`editor.tabs.ci` = "CI"
already exists at `messages/en/agents.json:51`; pick an `IconName`):
```ts
export const TABS: readonly EditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "skills", labelKey: "editor.tabs.skills", icon: "Sparkles" },
  { key: "context", labelKey: "editor.tabs.context", icon: "FileText" },
  { key: "evals", labelKey: "editor.tabs.evals", icon: "FlaskConical" },
  // { key: "ci", labelKey: "editor.tabs.ci", icon: "…" },
];
```
Body switch (`AgentEditor/AgentEditor.tsx:27-35`) — insert a `tab === "ci"` branch before
the `ConfigTab` fallback + `import { CiTab } from "./_components/CiTab";`.

Fail-CI-on reuse (`ConfigTab/constants.ts:10`, `ConfigTab.tsx:42,107-113`):
```ts
export const CI_FAIL_ON_VALUES: readonly CiFailOn[] = ["never", "critical", "warning", "any"];
// options = CI_FAIL_ON_VALUES.map((v) => ({ value: v, label: t(`config.ciFailOnOptions.${v}`) }));
<FormField label={t("config.ciFailOn")} hint={t("config.ciFailOnHint")}>
  <SelectInput value={ciFailOn} onChange={(v) => setCiFailOn(v as CiFailOn)} options={ciFailOnOptions} />
</FormField>
```
Both tabs write the same field via `useUpdateAgent().mutate({ id, patch: { ci_fail_on } })`
(narrow single-key patch is valid — AC-23). **Declare the 4 values LOCALLY in `CiTab`**
(they are a fixed enum) to avoid a cross-`_components` import that the `import/no-restricted-paths`
lint may reject; AC-23 only requires both controls to WRITE the same field, not to share the const.

### C8 — Wizard primitives (verbatim signatures)

`Modal` (`client/src/vendor/ui/kit/Modal.tsx:5-28`): props `{ width=720, height?, title?,
subtitle?, onClose?, children?, footer?, bodyPad="20px 24px" }`; renders its own
fixed overlay; backdrop-click + Esc → `onClose` (via `useDialogA11y`); **uncontrolled** —
mount/unmount it yourself (no `open` prop); use a fixed `height` so the dialog doesn't jump
between steps; put Back/Continue/Install + `<ExportWizardSteps>` in `footer`.

`ExportWizardSteps` (`client/src/vendor/ui/ExportWizardSteps.tsx:6`):
`ExportWizardSteps({ step, labels }: { step: number; labels: string[] })` — `step` is the
**0-based** active index; pure indicator (parent manages advancement). Pass 4 labels.

Both re-exported from `@devdigest/ui`.

### C9 — Reusable run UI (props, verbatim)

- `RunCostBadge` (`components/run-cost-badge/RunCostBadge.tsx:13-23`, `@/components/run-cost-badge`):
  `{ costUsd, tokensIn?, tokensOut?, variant?: "compact"|"withTokens" }` — no coupling; maps
  directly to `CiRunSummary.cost_usd`.
- `SeverityCountBadges` (`components/findings/SeverityCountBadges.tsx:10`): `{ counts: PrFindingCounts }`
  (icon+label, never color-alone — a11y-safe). Build counts from `critical/warning/suggestion`.
- `SeverityBadge` (`vendor/ui/primitives/Badge.tsx:52-60`), re-exported from `@devdigest/ui`.
- `RunRow` (`…/RunHistory/_components/RunRow/RunRow.tsx:61-77`) + `RunHistory`
  (`…/RunHistory/RunHistory.tsx:30-47`): both take `RunSummary[]` and are colocated under the
  PR-detail route with `useTranslations("prReview")`. `CiRunSummary` extends `RunSummary`, so
  these can be reused for the CI tab history; the CI Runs PAGE builds its own row layout
  (extra columns: Repo/PR-link/Source/Trace).

### C10 — Sidebar nav (verbatim `client/src/vendor/ui/nav.ts:5-39`)

```ts
export interface NavGroup { section: string; items: NavItemDef[]; }
export const NAV: NavGroup[] = [
  { section: "WORKSPACE", items: [ /* … */ ] },
  { section: "SKILLS LAB", items: [ /* … */ ] },
  // APPEND:
  // { section: "GLOBAL", items: [
  //   { key: "ci-runs", label: "CI Runs", icon: <IconName>, href: "/ci-runs" } ] },
];
```
`activeKeyFor` (`components/app-shell/helpers.ts:38`) ALREADY returns `"ci-runs"` for
`/ci-runs`, and `Sidebar.tsx` renders whatever is in `NAV` (highlights on
`activeKey === item.key`) — **zero extra wiring**; the nav label + `page.crumb` also already
exist in `messages/en/shell.json` + `ci.json`. Thin-page pattern (`app/agents/page.tsx`):
`page.tsx` renders one colocated `_components/CiRunsView`; the view is the `"use client"`
boundary. Wrap `/ci-runs` in `AppShell` with the existing `page.crumb`.

### C11 — Contracts to serialize/ingest against (verbatim shapes)

- `AgentManifest` (`contracts/eval-ci.ts:153-169`) — **FROZEN, no `post_as`**: `name`,
  `provider` (default `openrouter`), `model`, `system_prompt`, `skills` (null/absent → `[]`),
  `strategy` (default `auto`), `ci_fail_on` (default `critical`).
- `CiExportInput` (`:174-186`): `repo`, `target` (default gha), `action` (open_pr|files),
  `post_as` (default github_review), `triggers` (default [opened,synchronize,reopened]),
  `base` (default main). **Extend via `CiExportRequest` (new file) with optional `files`.**
- `CiFile{path,contents,editable=true}` (`:137-143`); `CiInstallation{id,agent_id,repo,
  target_type,installed_at}` (`:188-196`); `CiExport{installation,files[],pr_url|null}` (`:198-204`).
- `CiResultArtifact` (`:229-240`): `findings_count`, `critical?/warning?/suggestion?`,
  `cost_usd|null`, `duration_ms?`, `agent`, `version?`, `pr_number?` — ingest input, parsed
  with `.safeParse` (untrusted).
- `RunSummary` (`contracts/trace.ts:129-151`) — the base `CiRunSummary` extends.

### C12 — Runner contract the serializer/workflow MUST satisfy (agent-runner, NOT modified)

- Manifest path: exactly ONE `.devdigest/agents/*.yaml` (runner `manifest.ts:25-46` throws on
  0 or >1), validated by `AgentManifest.safeParse` (`manifest.ts:69`).
- Skills: one `.devdigest/skills/<slug>.md` per manifest slug (runner `skills.ts:18`; missing
  → hard fail).
- `memory.jsonl`: empty placeholder tolerated.
- Runner reads `DEVDIGEST_POST_AS` with default `github_review` (`index.ts:25-33`) — **no
  runner change**; the workflow MUST set `DEVDIGEST_POST_AS: <post_as>` (open cross-track gap,
  `agent-runner/insights/INSIGHTS.md:40`).
- Runner strips `.devdigest/**` + `.github/workflows/**` from the reviewed diff (`diff.ts:21`).
- Result artifact written to `devdigest-result.json` (`run.ts:149`), self-validated against
  `CiResultArtifact` — this is the ingest input.
- **Build/embed prerequisite:** `agent-runner/dist/index.js` is produced by
  `cd agent-runner && pnpm build` (ncc). It is currently **gitignored and not tracked** (the
  nested `agent-runner/.gitignore:2 dist/` wins over the root negation) — see Risks. The
  `ci/bundle.ts` helper reads it via node `fs` and embeds it as `.devdigest/runner/index.js`;
  missing → AC-44 clear error.

## Tasks

### Phase 1 — Foundation (barrier)   (no deps; all other phases depend on it)
- **Surface:** cross-cutting (server DB + shared contracts + GitHub adapter + client i18n)
- **Disjoint scope:** `server/src/db/schema/runs.ts` + generated `server/src/db/migrations/0023_*.sql` (+ `meta/`); `server/src/vendor/shared/contracts/ci-runs.ts` (NEW); `server/src/vendor/shared/index.ts`; `server/src/vendor/shared/adapters.ts`; `server/src/adapters/github/octokit.ts`; `server/src/adapters/mocks.ts`; `client/messages/en/ci.json`; the client `vendor/shared/**` mirror (GENERATED by `scripts/sync-shared.mjs`, never hand-edited); new server tests `server/test/ci-contract.test.ts`, `server/test/ci-migration.it.test.ts`, `server/test/ci-github-adapter.test.ts`; client i18n test.
- **Skills to apply:** `drizzle-orm-patterns`, `postgresql-table-design`, `zod`, `onion-architecture`, `security` (octokit/untrusted), `typescript-expert`.
- **What changes & why:** the single barrier that all slices build on — the new columns, the new DTO/request contracts, the two GitHub port methods (+ impl + mock), and the i18n copy. Consolidated here so `scripts/sync-shared.mjs` runs ONCE (no mirror-sync race).
- **How to test:** server unit `bash scripts/test-mirror.sh server exec vitest run --exclude '**/*.it.test.ts'`; server integration `bash scripts/test-mirror.sh server exec vitest run .it.test`; client `bash scripts/test-mirror.sh client test`. Run `node scripts/sync-shared.mjs` then confirm `--check` clean.
- [x] T1  Extend `agent_runs` (runs.ts) with `pr_number` int, `repo` text, `github_url` text, `ci_installation_id` uuid FK→`ci_installations` (onDelete set null), ALL nullable; `pnpm db:generate` → `0023_*.sql` + snapshot committed   → AC-40  → test_migration_columns
- [x] T2  New `contracts/ci-runs.ts`: `CiRunSummary = RunSummary.extend({ source, repo, pr_number, github_url, ci_installation_id })` + `CiExportRequest = CiExportInput.extend({ files: CiFile.array().nullish() })`; add one `export *` line to `index.ts`   → AC-41  → test_ci_run_summary_contract
- [x] T3  Retire `ci_runs`/`CiRun`: KEEP the physical table (course-table invariant); ensure NO new code references `ciRuns`/`CiRun` (CI runs read from `agent_runs`)   → AC-41  → test_no_ci_runs_refs
- [x] T4  Add `GitHubClient` port methods to `adapters.ts`: `listWorkflowRuns(repo, workflow)` → `{ runId, status, conclusion, prNumber, htmlUrl, displayTitle, createdAt }[]`; `downloadWorkflowRunArtifact(repo, runId, artifactName)` → extracted `devdigest-result.json` text   → AC-42  → test_mock_github_actions
- [x] T5  Implement both methods in `OctokitGitHubClient` via `rest.actions.listWorkflowRuns`/`listWorkflowRunArtifacts`+`downloadArtifact` (through the existing `this.call()` seam); extract with `fflate` (mirror `skill-import`)   → AC-42  → test_mock_github_actions
- [x] T6  Mirror both methods in `MockGitHubClient` with capture/return fixtures (`MockGitHubOptions.workflowRuns`, `artifacts`)   → AC-42  → test_mock_github_actions
- [x] T7  Run `node scripts/sync-shared.mjs` to propagate the new contract + adapter interface to the client vendor copy (client `--check` clean)   → AC-41, AC-42 (client visibility)  → test_ci_run_summary_contract
- [x] T8  i18n corrections in `client/messages/en/ci.json`: fix `exportWizard.blockMergeDesc` → "No GitHub App needed" guidance (AC-19); add `runs.table.agent`, `runs.table.duration`, `runs.table.trace`; add `runs.filters.allSources`; align CI-tab button labels "Update CI config" / "+ Add to CI"   → AC-19  → test_block_merge_copy

### Phase 2 — Server CI module   (parallel-safe; depends on: Phase 1)
- **Surface:** server (`reviewer-core` untouched)
- **Disjoint scope:** `server/src/modules/ci/**` (NEW: `routes.ts`, `service.ts`, `repository.ts`, `constants.ts`, `serialize.ts`, `workflow.ts`, `bundle.ts`, `ingest.ts`); one import + one entry in `server/src/modules/index.ts`; new tests under `server/test/ci-*.{test,it.test}.ts`.
- **Skills to apply:** `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`, `zod`, `security` (least-priv workflow, untrusted artifact/diff, no marketplace action, fork-secret behavior), `typescript-expert`.
- **What changes & why:** the studio-side producer + ingest — manifest/skill/bundle serialization, security-minimal workflow generation, the export PR (open_pr/files), the pull-on-refresh ingest, and the CI-runs / per-agent / installations read endpoints. Onion: thin routes → service → repository/`container.github()` port; `fs` read of the runner bundle lives in `bundle.ts` (a helper, NOT `service.ts`, so `arch:check` stays green).
- **How to test:** server unit + integration via the mirror (see Phase 1); mock GitHub via `MockGitHubClient` + `buildApp({ overrides: { github } })`.
- [x] T9  Scaffold the `ci` module (routes `ciRoutes` default export; `service.ts` builds `new CiRepository(container.db)`; `repository.ts`; `constants.ts`) + register `ci` in `modules/index.ts`   → AC-2 (enabler)  → test_export_route_registered
- [x] T10  Manifest serializer (`serialize.ts`): agent config → `AgentManifest` (NO `post_as`) → YAML; round-trips `AgentManifest`; 0-skill agent → valid manifest (`skills: []`), no skill files   → AC-3, AC-4, AC-5  → test_manifest_serialize, test_manifest_roundtrip, test_zero_skills
- [x] T11  Skill-body serializer: one `.devdigest/skills/<slug>.md` per linked skill (via `container.agentsRepo.linkedSkills`), filenames matching manifest slugs   → AC-45  → test_skill_files
- [x] T12  Bundle assembler (`bundle.ts`): the 6 files — `.devdigest/agents/<slug>.yaml`, skill files, empty `.devdigest/memory.jsonl`, `.devdigest/runner/index.js` (read `agent-runner/dist/index.js` via fs), `.github/workflows/devdigest-review.yml`; missing runner bundle → clear "runner bundle missing — build agent-runner" error, commit NOTHING   → AC-2, AC-44  → test_bundle_six_files, test_missing_bundle
- [x] T13  Workflow generator (`workflow.ts`): `on: pull_request` with chosen `types` (default opened/synchronize/reopened), NEVER `pull_request_target`; `permissions: { contents: read, pull-requests: write }` ONLY; review step runs `node .devdigest/runner/index.js`, NO marketplace/external action (checkout/setup-node allowed); `${{ secrets.OPENROUTER_API_KEY }}` referenced, key NEVER inlined; `env: DEVDIGEST_POST_AS: <post_as>`; fork-safe by trigger choice   → AC-12, AC-13, AC-14, AC-15, AC-16, AC-17  → test_workflow_runner_cmd, test_workflow_trigger, test_workflow_permissions, test_workflow_secret, test_workflow_postas, test_workflow_fork
- [x] T14  Export endpoint `POST /agents/:id/export-ci` (parse `CiExportRequest`; re-validate manifest round-trips `AgentManifest` before commit; `action=open_pr` → `commitFiles(branch devdigest/ci, base)` ONE atomic commit + `findOpenPr`/`openPullRequest` "Add DevDigest CI review"; NEVER commit to base, NEVER auto-merge; carry edited `files` verbatim when provided; persist `CiInstallation`; return `CiExport`)   → AC-6, AC-7, AC-8, AC-9, AC-10  → test_export_open_pr, test_export_idempotent, test_no_base_commit, test_installation_persisted, test_carry_edited_files
- [x] T15  `action=files` path: return the generated files, NO PR, NO installation persist (also the Step-2 preview generator)   → AC-11  → test_action_files
- [x] T16  `GITHUB_TOKEN`-unset handling: `container.github()` `ConfigError` surfaced as a clear, actionable error with no partial install — for BOTH export and ingest   → AC-43  → test_no_github_token
- [x] T17  Ingest service (`ingest.ts`): per installed repo, `listWorkflowRuns('devdigest-review.yml')` → `downloadWorkflowRunArtifact` → `CiResultArtifact.safeParse` (untrusted; reject malformed) → upsert `agent_runs` `source='ci'` with `pr_number`/`repo`/`github_url`/`ci_installation_id`, idempotent by `(workspaceId, ciInstallationId, githubUrl)`; a running job w/o artifact yet → a `running` row completed on a later refresh   → AC-37, AC-38  → test_ingest, test_ingest_idempotent
- [x] T18  Read endpoints: `GET /ci-runs` (`agent_runs WHERE source='ci'`, workspace-scoped, filters 7d/agent/repo/status/source → `CiRunSummary[]`) + `GET /agents/:id/ci-runs` (source='ci' for that agent) — mirror `listRunsForPull`   → AC-32, AC-35, AC-41  → test_ci_runs_list, test_agent_ci_runs
- [x] T19  `GET /agents/:id/ci-installations` → `CiInstallation[]` (per-repo rows for the CI tab)   → AC-31 (data)  → test_installations_list

### Phase 3 — Client: CI tab + Export wizard   (parallel-safe; depends on: Phase 1)
- **Surface:** client (agent editor)
- **Disjoint scope:** `client/src/app/agents/[id]/page.tsx` (`VALID_TABS`); `client/src/app/agents/[id]/_components/AgentEditor/{constants.ts,AgentEditor.tsx}`; NEW `AgentEditor/_components/CiTab/**` (tab + wizard modal + steps); NEW `client/src/lib/hooks/ci.ts`; colocated tests. READS `ci.json` (owned by Phase 1) — no edit.
- **Skills to apply:** `next-best-practices`, `react-best-practices`, `react-frontend-architecture`, `react-testing-library`, `security` (untrusted repo/PR text is server/runner-side; the editable YAML is the user's own repo), `typescript-expert`.
- **What changes & why:** the agent-editor CI tab (header actions, deployment summary, Fail-CI-on control, per-repo installations, CI run history) + the 4-step Export wizard modal (Target → Preview → Configure → Install). a11y: `Modal` focus-trap (built-in), keyboard stepper, `aria-live` for generating/installing.
- **How to test:** client via mirror `bash scripts/test-mirror.sh client test` (`fireEvent`, mock hooks + `next/navigation`, render under `NextIntlClientProvider` + `ToastProvider`); browser flows (open wizard, disabled-target, edited-file-carry) in `e2e/`.
- [x] T20  Register the CI tab: add `"ci"` to `VALID_TABS`; add `{ key: "ci", labelKey: "editor.tabs.ci", icon }` to `TABS`; add `tab === "ci"` branch + `CiTab` import in `AgentEditor.tsx`   → AC-1 (tab)  → test_ci_tab_renders
- [x] T21  `hooks/ci.ts`: `useExportCi(agentId)` (POST export-ci → `CiExport`), `useCiInstallations(agentId)` (GET), `useAgentCiRuns(agentId)` (GET → `CiRunSummary[]`)   → AC-10, AC-31, AC-32 (enabler)  → test_ci_tab_history
- [x] T22  `CiTab` component: header "Update CI config" / "+ Add to CI"; "CI deployment · Active in N repos"; per-repo installation rows (repo, target badge, last-run status, relative time, workflow version [derived — R4]) + "+ Add repository"; CI run history from `useAgentCiRuns` reusing `RunRow`/`RunCostBadge`/`SeverityCountBadges`   → AC-29, AC-31, AC-32  → test_ci_tab_header, test_ci_tab_installations, test_ci_tab_history
- [x] T23  Fail-CI-on control on the CI tab: 4 `CiFailOn` values (declared locally), `useUpdateAgent` narrow `{ ci_fail_on }` patch, description (finding ≥ severity → non-zero + required check blocks); both tabs write the SAME field   → AC-23, AC-30  → test_ci_fail_on_both_tabs, test_ci_tab_failon
- [x] T24  Export wizard modal shell (`Modal` + `ExportWizardSteps` with 4 labels, focus-trap, Back/Continue/Install footer) + Step 1 Target: 4 cards, GitHub Actions preselected + "recommended", CircleCI/Jenkins/Generic CLI disabled stubs that cannot advance   → AC-1, AC-24, AC-25  → test_wizard_opens, test_target_cards, test_disabled_target
- [x] T25  Step 2 Preview: "FILES TO CREATE" list + editable text editor for the selected file, "editable" badge on workflow+manifest, generating indicator (via `useExportCi` action=files, `aria-live`); edits held in state and carried into the Install request   → AC-2, AC-6, AC-26  → test_preview_editor, test_edited_file_carried
- [x] T26  Step 3 Configure: trigger chips (opened on / synchronize on / reopened off); "Post results as" radios (GitHub review recommended / PR comment / None); "No GitHub App needed" block-merge hint (AC-19 copy)   → AC-19, AC-27  → test_configure_step, test_block_merge_hint
- [x] T27  Step 4 Install: two cards (open PR recommended / copy zip degraded); Install → `useExportCi` open_pr (installing state, `aria-live`); "GitHub Action setup docs" link; success toast carrying the PR link   → AC-10, AC-28  → test_install_step, test_pr_link_toast

### Phase 4 — Client: CI Runs page   (parallel-safe; depends on: Phase 1)
- **Surface:** client (global page + nav)
- **Disjoint scope:** `client/src/vendor/ui/nav.ts` (GLOBAL section); NEW `client/src/app/ci-runs/**` (thin page + `_components/CiRunsView`); NEW `client/src/lib/hooks/ci-runs.ts`; colocated tests. READS `ci.json` (owned by Phase 1) — no edit.
- **Skills to apply:** `next-best-practices`, `react-best-practices`, `react-frontend-architecture`, `react-testing-library`, `typescript-expert`.
- **What changes & why:** the `/ci-runs` page under a new GLOBAL sidebar section, its table (PR link, Agent, Source, Duration, severity Findings, Cost, Status, Trace), filters, empty state, and Refresh + 30s auto-refresh ingest. Reuses `RunCostBadge`/`SeverityCountBadges`; `activeKeyFor` already maps `/ci-runs`.
- **How to test:** client via mirror (`fireEvent`, mock `hooks/ci-runs` + `next/navigation`); nav reachability + row rendering + empty state in `e2e/`.
- [x] T28  Add a "GLOBAL" `NavGroup` with a "CI Runs" item (`key: "ci-runs"`, `href: "/ci-runs"`, `IconName`) to `NAV` in `nav.ts`   → AC-33  → test_ci_runs_nav
- [x] T29  `hooks/ci-runs.ts`: `useCiRuns(filters)` (GET `/ci-runs` → `CiRunSummary[]`, 30s `refetchInterval` when auto-refresh on), `useIngestCiRuns()` (POST ingest → invalidate list)   → AC-35, AC-37, AC-39 (enabler)  → test_ci_runs_page
- [ ] T30  `/ci-runs` route: thin `page.tsx` → `_components/CiRunsView` (wrapped in `AppShell` with the existing `page.crumb`); table rows — Timestamp, Pull request (# + title → PR link), Agent, Source ("GitHub Actions"), Duration, Findings (`SeverityCountBadges`), Cost (`RunCostBadge`), Status (Succeeded / No findings / Failed / Running), per-row Trace link (`github_url`)   → AC-33, AC-34  → test_ci_runs_page, test_ci_runs_row
- [x] T31  Filters: last 7 days, all agents, all repos, all statuses, all sources   → AC-35  → test_ci_runs_filters
- [x] T32  Empty state ("No CI runs yet…")   → AC-36  → test_ci_runs_empty
- [x] T33  Refresh button + auto-refresh toggle (30s) re-running the ingest via `useIngestCiRuns`; "auto-refresh on" indicator; non-disruptive `aria-live` announce   → AC-37, AC-39  → test_refresh, test_auto_refresh

### Phase 5 — Runner-contract verification   (parallel-safe; no deps; NO new implementation)
- **Surface:** verification only (`agent-runner` — NOT modified; Non-goal)
- **Disjoint scope:** none — runs the existing `agent-runner` test suite; writes no source.
- **Skills to apply:** `security` (confirm untrusted-input handling holds), `typescript-expert`.
- **What changes & why:** confirms the pre-built runner already satisfies its contract ACs so they are marked verify-not-build. AC-16's runner side (reads `DEVDIGEST_POST_AS`, default `github_review`) is confirmed; the workflow-emit side is Phase 2 T13.
- **How to test:** run the `agent-runner` vitest suite green in WSL (`cd agent-runner && pnpm test`).
- [x] T34  Run the `agent-runner` suite green; confirm existing tests cover AC-18 (`run.test.ts` "fences the diff and PR body as `<untrusted>` … injection guard"), AC-20 ("verdict/blocker count come from the deterministic gate, never the model's self-reported verdict"), AC-21 ("post_as=github_review … REQUEST_CHANGES + exits non-zero"), AC-22 (invalid-manifest + LLM-error "non-zero exit, no artifact, nothing posted"); confirm NO runner change is needed for AC-16   → AC-18, AC-20, AC-21, AC-22  → verify_runner_suite

## Traceability matrix

| AC | Task | Test | Commit |
|------|------|------|--------|
| AC-1 | T20, T24 | test_wizard_opens | — |
| AC-2 | T12, T25 | test_bundle_six_files | — |
| AC-3 | T10 | test_manifest_serialize | — |
| AC-4 | T10 | test_manifest_roundtrip | — |
| AC-5 | T10, T11 | test_zero_skills | — |
| AC-6 | T14, T25 | test_edited_file_carried | — |
| AC-7 | T14 | test_export_open_pr | — |
| AC-8 | T14 | test_export_idempotent | — |
| AC-9 | T14 | test_no_base_commit | — |
| AC-10 | T14, T27 | test_installation_persisted / test_pr_link_toast | — |
| AC-11 | T15 | test_action_files | — |
| AC-12 | T13 | test_workflow_runner_cmd | — |
| AC-13 | T13 | test_workflow_trigger | — |
| AC-14 | T13 | test_workflow_permissions | — |
| AC-15 | T13 | test_workflow_secret | — |
| AC-16 | T13, T34 | test_workflow_postas | — |
| AC-17 | T13 | test_workflow_fork | — |
| AC-18 | T34 | verify_runner_suite (existing) | — |
| AC-19 | T8, T26 | test_block_merge_copy / test_block_merge_hint | — |
| AC-20 | T34 | verify_runner_suite (existing) | — |
| AC-21 | T34 | verify_runner_suite (existing) | — |
| AC-22 | T34 | verify_runner_suite (existing) | — |
| AC-23 | T23 | test_ci_fail_on_both_tabs | — |
| AC-24 | T24 | test_target_cards | — |
| AC-25 | T24 | test_disabled_target | — |
| AC-26 | T25 | test_preview_editor | — |
| AC-27 | T26 | test_configure_step | — |
| AC-28 | T27 | test_install_step | — |
| AC-29 | T22 | test_ci_tab_header | — |
| AC-30 | T23 | test_ci_tab_failon | — |
| AC-31 | T19, T22 | test_installations_list / test_ci_tab_installations | — |
| AC-32 | T18, T22 | test_agent_ci_runs / test_ci_tab_history | — |
| AC-33 | T28, T30 | test_ci_runs_nav | — |
| AC-34 | T30 | test_ci_runs_row | — |
| AC-35 | T18, T31 | test_ci_runs_list / test_ci_runs_filters | — |
| AC-36 | T32 | test_ci_runs_empty | — |
| AC-37 | T17, T33 | test_ingest / test_refresh | — |
| AC-38 | T17 | test_ingest_idempotent | — |
| AC-39 | T33 | test_auto_refresh | — |
| AC-40 | T1 | test_migration_columns | — |
| AC-41 | T2, T3, T18 | test_ci_run_summary_contract / test_no_ci_runs_refs | — |
| AC-42 | T4, T5, T6 | test_mock_github_actions | — |
| AC-43 | T16 | test_no_github_token | — |
| AC-44 | T12 | test_missing_bundle | — |
| AC-45 | T11 | test_skill_files | — |

Commit is "—" at planning time; implementers fill it as tasks land; plan-verifier audits
AC↔task↔test coverage against this table.

## Risks & mitigations

- **Runner bundle gitignored & unbuilt.** `agent-runner/dist/index.js` is produced only by
  `pnpm build` and is currently NOT tracked (nested `.gitignore dist/` overrides the root
  negation). Export reads it at run time. → Mitigation: AC-44's clear error is the guard;
  the plan treats `cd agent-runner && pnpm build` as an export prerequisite. **Recommend
  raising the `dist/` tracking conflict with the export/runner track owner** (out of this
  feature's code scope, but it blocks a real export).
- **Shared-mirror drift.** Two implementers editing `server/src/vendor/shared/**` would race
  on `scripts/sync-shared.mjs`. → Mitigation: ALL `vendor/shared` edits consolidated in
  Phase 1; sync runs once there; the `--check` gate confirms client parity.
- **`agent_runs` is a hot, shared table.** → Mitigation: columns are additive + nullable
  (`source='local'` rows keep NULLs); ingest upsert is workspace-scoped and idempotent via a
  select-by-`github_url` (no new unique constraint that would clash with NULLs on local rows).
- **Workflow-run → PR-number / title mapping.** `listWorkflowRuns` may return an empty
  `pull_requests` array or lack a title. → Mitigation: derive `pr_number` from the run's PR
  list else fall back to `CiResultArtifact.pr_number`; PR title best-effort from
  `display_title`, omit when absent (R5).
- **In-progress Actions job.** Its artifact may not exist yet. → Mitigation: ingest tolerates
  a missing artifact, upserts a `running` row, and completes it on a later refresh (AC-38/39).
- **Onion drift.** `fs` read of the bundle + octokit calls must not leak into `service.ts`
  (arch:check-guarded). → Mitigation: fs read in `bundle.ts` (helper); all GitHub access via
  `container.github()` interface; run `pnpm arch:check` after Phase 1/2.
- **Client cross-`_components` import + hook-mock breakage.** → Mitigation: declare
  `CI_FAIL_ON_VALUES` locally in `CiTab`; when a tested component gains a `ci`/`ci-runs`
  hook, update every test mocking that module (`client/INSIGHTS.md` 2026-07-05).
- **Security surface (lethal trifecta).** Untrusted diff + write to a public PR. → Mitigation
  is a set of hard ACs already in the plan: least-priv permissions (T13/AC-14), secret only
  from repo Secrets (T13/AC-15), fork PRs get no secrets via `pull_request` (T13/AC-17),
  untrusted-input wrapping is the runner's job (T34/AC-18), NO marketplace action
  (T13/AC-12), artifact parsed with `.safeParse` (T17). Run `pr-self-review` (blocks on
  CRITICAL) at publish.

## Critical files for implementation

- `server/src/modules/ci/` (NEW) — `serialize.ts` / `workflow.ts` / `bundle.ts` /
  `ingest.ts` / `service.ts` / `repository.ts` / `routes.ts` (the whole producer + ingest).
- `server/src/vendor/shared/contracts/ci-runs.ts` (NEW) + `server/src/vendor/shared/adapters.ts`
  (GitHubClient port methods) — the shared contract surface (sync to client).
- `server/src/db/schema/runs.ts` (+ `migrations/0023_*.sql`) — the `agent_runs` extension.
- `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/` (NEW) — CI tab +
  4-step Export wizard.
- `client/src/app/ci-runs/` (NEW) — the CI Runs page.

## Open questions / assumptions

Non-blocking (design-neutral) — recorded as assumptions rather than questions:

- **A1 (AC-6 carry):** `CiExportRequest = CiExportInput.extend({ files })` (new file) carries
  Step-2 edits; absent → server generates. Does NOT edit the frozen `CiExportInput`.
- **A2 (`ci_runs`):** physical table KEPT (AGENTS.md invariant); "retire" = no new refs +
  `CiRun` deprecated/unreferenced.
- **A3 (`CI_FAIL_ON_VALUES`):** declared locally in `CiTab` (avoid cross-`_components` import).
- **A4 (ingest dedup):** keyed on `github_url` (Actions run URL); no new unique constraint.
- **A5 (`action=files`):** returns files, does NOT persist a `CiInstallation` (persist only on
  `open_pr`); "return" satisfies AC-11. Step-2 preview reuses `action=files` (no persist).
- **A6 (AC-31 "workflow version"):** shown as a derived/constant value (no per-installation
  version column added).
- **A7 (AC-34 PR title):** best-effort from run `display_title`; may show only "#123".
- **A8 (AC-42 octokit):** real impl covered via typecheck + `MockGitHubClient` parity + the
  ingest integration test (not a direct octokit unit test).
- **A9 (AC-17 runner fork flag):** the runner's "informational" fork flag is pre-existing and
  untested/unsurfaced; NOT added (Non-goal: don't modify `agent-runner`). This feature's fork
  protection is the workflow `pull_request` trigger (tested in T13).
- **A10 (new endpoints):** a Step-2 preview reuses `action=files`; `GET /agents/:id/ci-runs`
  and `GET /agents/:id/ci-installations` are added alongside the specced
  `POST /agents/:id/export-ci` and `GET /ci-runs` (routes are not frozen contracts; the DTO
  shapes are).
