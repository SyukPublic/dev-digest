# Development Plan: Multi-agent CI (many agents per repo) + Remove-from-CI

- **Spec:** docs/specs/SPEC-2026-07-16-multi-agent-ci.md
- **Execution mode:** single-agent

## Context

"Export to CI" (L07) shipped a one-agent-per-repo design, but the studio never enforced it,
so installing a SECOND agent on the same repo silently breaks that repo's CI: the runner
hard-fails on >1 manifest, slug-colliding manifests overwrite each other, ingest fans one
result out to every installation (misattributing findings/cost), and there is no way to
remove an installation. This plan turns "N agents per repo" into a first-class, supported
flow: several agents may be installed on and review the same repo; every installed agent
reviews each PR; each run maps to its OWN installation with its own findings/cost/status;
and an agent can be cleanly removed from a repo's CI (studio row + its manifest on the
branch + detached run history). Every existing security property (fork-safety,
least-privilege permissions, no secret inlining, untrusted-diff wrapping) is preserved as
N grows. **Goal in one line:** make many agents per repo work end-to-end and add a
first-class, cleanly-torn-down uninstall.

## Requirements review & recommendations

The spec is testable and internally consistent (AC-56..AC-78, zero `[NEEDS CLARIFICATION]`,
all four clarifications resolved). Both inputs were provided (spec path + single-agent mode),
so no stop-and-ask round was needed. Findings gathered while grounding the design in code:

**HOW-decisions the spec deferred to the plan — decided here, with rationale:**

- **(a) Multi-agent execution = single-job loop inside the runner (NOT a GHA matrix).**
  The runner iterates all manifests in one job; the workflow stays static. Rationale:
  agents are added incrementally via layered commits that reuse the shared workflow (AC-63),
  so a matrix keyed on the manifest set would force the workflow YAML to be regenerated and
  re-committed on every add/remove; a single loop keeps ONE workflow, ONE aggregate status
  check (resolved decision #3 — "matches the single-workflow design"), and lets the process
  exit be computed after every agent has run (AC-61/AC-69).
- **(b) Per-agent result artifact = one shared artifact (`devdigest-result`) containing one
  result file per agent, `devdigest-result-<slug>.json`; the artifact's `agent` identity is
  the manifest-file basename slug.** Rationale: this lines the artifact identity up 1:1 with
  the stable manifest path (AC-62 ↔ AC-64). The runner reads the manifest FILE it loaded, so
  the only stable identity it can emit without unfreezing `AgentManifest` is that filename
  slug — which the server minted and stores per installation (see (c)), giving string-equality
  mapping on ingest. Reading identity FROM each result (not deriving the artifact name from the
  install) is what makes AC-65 enforceable ("unknown identity → skip"). Legacy single-agent
  bundles upload one `devdigest-result.json` → returned as a single entry → still maps.
- **(c) Manifest path = a STORED nullable `ci_installations.manifest_slug` column (own
  migration), NOT a pure `slugify(name)` derivation.** Rationale: a pure `slugify(name)`
  derivation changes when the agent is renamed, which would orphan the old manifest and break
  AC-62's "stable across re-exports". Storing the slug once (recommended composition
  `slugify(name)-<agentId-prefix>` for readability + guaranteed cross-agent uniqueness) keeps
  it stable under rename and is reused verbatim on re-export. Nullable + deterministically
  backfillable so legacy rows (pre-migration) still resolve. Matches the repo-intel convention
  "new columns = their own migration".
- **(d) Uninstall route = `DELETE /agents/:id/ci-installations/:installationId`.** Rationale:
  consistent with the existing collection route `GET /agents/:id/ci-installations` (DELETE on a
  member of the same collection) and the existing `DELETE /agents/:id` verb style.

**Non-blocking design call surfaced for the caller (assumption, not a question):**

- **`post_as` stays a workflow-level (shared) setting, applied by the runner to every agent.**
  `post_as` is deliberately NOT in the frozen `AgentManifest` — it is a workflow `env` var
  (`serialize.ts:9-11`, `workflow.ts:16-18`). With one shared workflow and a frozen manifest,
  a truly per-agent `post_as` is impossible without a contract change. AC-60's "posts its own
  result independently … per the agent's `post_as`" is satisfied by each agent posting its OWN
  review/comment using the workflow-level `post_as` (the last export sets it). Genuinely
  per-agent `post_as` would require unfreezing `AgentManifest` → a spec revision, out of scope
  here. Flagged so it is a conscious choice, not a silent degrade.

**Recommendations:**

- Ship the DB column (decision c) rather than deriving — the rename-stability bug is subtle and
  would only surface after a user renames an installed agent and re-exports.
- Keep the ncc rebuild + re-export rollout caveat (Non-goal: no auto-migration) prominent in the
  PR body so existing single-agent installs are knowingly left on the old bundle until re-export.

## Affected packages & files

- **`@devdigest/shared`** (`server/src/vendor/shared/`)
  - NEW `contracts/ci-uninstall.ts` — `CiUninstallResult` schema/type (uninstall response shape).
  - `index.ts` — append ONE `export * from './contracts/ci-uninstall.js'` line (append-only
    registration; see assumption on "barrel untouched").
  - `adapters.ts` — add two methods to the `GitHubClient` port: `deleteFiles` (delete counterpart
    to `commitFiles`) and `downloadWorkflowRunArtifactFiles` (return every result file in an
    artifact). Ports live here per Onion; adding interface methods is extension, not a barrel edit.
  - Propagate to the client via `node scripts/sync-shared.mjs` (server → client mirror; CI runs
    `--check`).
- **agent-runner** (`agent-runner/src/`)
  - `manifest.ts` — new `findManifestPaths` (plural; no >1 hard-fail — AC-59); keep
    `loadAgentManifest`.
  - `index.ts` / `run.ts` — load & run ALL manifests, per-agent isolation, per-agent artifact,
    aggregate exit; extract a single-agent review step from the current `runCi` body.
  - `artifact.ts` — set `CiResultArtifact.agent` to the stable manifest slug (not `manifest.name`).
  - **Rollout:** rebuilds `dist/index.js` via ncc; existing target-repo installs need re-export
    (Non-goal: no auto-migration).
- **server `ci` module** (`server/src/modules/ci/`)
  - `serialize.ts` — new stable per-agent slug helper (rename-stable, cross-agent-unique).
  - `bundle.ts` / `service.ts` — write the manifest at the stable slug path; store/reuse
    `manifest_slug`; add `uninstall()`; keep per-`(agent,repo)` idempotency (AC-57).
  - `repository.ts` — store/read `manifest_slug`; `deleteInstallation`; look up installations by
    slug for ingest mapping.
  - `ingest.ts` — map each result file to its installation by `CiResultArtifact.agent` slug;
    skip unknown identities; keep idempotency per `(workspace, installation, github_url)`.
  - `workflow.ts` / `constants.ts` — upload ALL per-agent result files; keep fork-safety +
    least privilege; result-file naming.
  - `routes.ts` — add `DELETE /agents/:id/ci-installations/:installationId`.
- **server adapters** (`server/src/adapters/github/octokit.ts`, `server/src/adapters/mocks.ts`)
  - `octokit.ts` — impl `deleteFiles` (Git Data API: tree on `base_tree` with `sha: null` per
    path — the delete the current `createTree` cannot express) + `downloadWorkflowRunArtifactFiles`.
  - `mocks.ts` — `MockGitHubClient` parity for both new methods (record deletions, return
    per-run result-file maps).
- **DB** (`server/src/db/schema/ci.ts`, `server/drizzle/*`) — new nullable `manifest_slug`
  column on `ci_installations` + its OWN generated migration (MANUAL `pnpm db:migrate`).
- **client** (`client/src/…`)
  - `lib/hooks/ci.ts` — `useDeleteCiInstallation` mutation (`queryKey` string arrays;
    `invalidateQueries` after success).
  - `…/CiTab/_components/Installations.tsx` (+ a new confirm-dialog component) — "Remove from CI"
    row action + destructive confirm dialog naming repo/agent (AC-75).
  - `messages/en/ci.json` — new copy (remove action, confirm dialog, last-agent warning, errors).

**Reuse (do not re-implement):** `commitFiles`/`findOpenPr`/`openPullRequest` layered-commit
flow (`octokit.ts:327-388`); `parseManifestYaml`/`buildManifest` round-trip
(`serialize.ts:41-78`); reviewer-core `reviewPullRequest`/`toReviewPayload`/`countBlockers`/
`gateTriggered` (unchanged, called per agent); `CiResultArtifact.safeParse` defensive ingest
(`ingest.ts:80-89`); the `Modal` primitive + `useDialogA11y` (`client/src/vendor/ui/kit/`) for
the confirm dialog; `api.del` (`client/src/lib/api.ts:98`); the `useDeleteAgent`
invalidate/remove pattern (`client/src/lib/hooks/agents.ts:72-81`).

## Tasks

### Phase 1 — Foundations: shared contract + GitHub adapter ports
- **Surface:** shared + backend (adapters)
- **Skills to apply:** zod, onion-architecture, typescript-expert, security
- **What changes & why:** define the uninstall response contract and the two new `GitHubClient`
  port methods every later phase depends on (branch-file deletion for uninstall; multi-file
  artifact download for per-agent ingest). Ports first so the service/ingest phases compile
  against a stable interface.
- **How to test:** `bash scripts/test-mirror.sh server exec vitest run --exclude '**/*.it.test.ts'`
  for the mock/unit; `node scripts/sync-shared.mjs --check` must pass after syncing.
- [x] T1  Add `contracts/ci-uninstall.ts` with `CiUninstallResult` = `{ removed, repo, agent_id, branch_updated, pr_url (nullable), last_agent_removed }` (Zod + `z.infer` export), register it with one appended `export *` line in `index.ts`, and run `sync-shared.mjs`   → AC-70, AC-74  → test_ci_uninstall_contract (colocated `contracts/ci-uninstall.test.ts`)
- [x] T2  Add `GitHubClient.deleteFiles(repo, { branch, base, paths[], message })` to `adapters.ts` and implement it in `octokit.ts` (tree on `base_tree` with `{ path, sha: null }` per path → commit → update ref), leaving all other branch files intact   → AC-71  → test_octokit_delete_files (colocated `adapters/github/octokit.test.ts`) + mock in T4
- [x] T3  Add `GitHubClient.downloadWorkflowRunArtifactFiles(repo, runId, artifactName): {name,text}[]` to `adapters.ts` + `octokit.ts` (unzip, return every `*.json` entry; empty array when none)   → AC-64  → test_octokit_artifact_files (colocated) + mock in T4
- [x] T4  Extend `MockGitHubClient` (`adapters/mocks.ts`) with parity for both methods: record `deletedFiles` payloads and serve a per-run map of result-file lists for `downloadWorkflowRunArtifactFiles`   → AC-64, AC-71  → test_mock_github_parity (exercised by the ingest/uninstall `.it.test.ts` suites)

### Phase 2 — Stable per-agent manifest slug + DB column + export (server ci + DB)  (depends on: Phase 1)
- **Surface:** server (ci module) + DB
- **Skills to apply:** drizzle-orm-patterns, postgresql-table-design, onion-architecture, typescript-expert
- **What changes & why:** guarantee a stable, per-agent-unique manifest path so slug-colliding
  agents never overwrite each other and re-exports target the same file (AC-62); persist the slug
  so uninstall and ingest can recover it (decision c). Keep the single reused PR + layered commit
  (AC-63) and per-`(agent,repo)` idempotency (AC-57).
- **How to test:** `bash scripts/test-mirror.sh server exec vitest run .it.test` (`ci-export`,
  `ci-migration`); `bash scripts/test-mirror.sh server arch:check`. Migration is MANUAL —
  `cd server && pnpm db:generate` then `pnpm db:migrate` before the `.it.test` run.
- [x] T5  Add nullable `manifest_slug text` to `ci_installations` (`db/schema/ci.ts`) and generate its OWN migration (`pnpm db:generate`); do not alter the empty `ci_runs` course table   → AC-62  → test_ci_migration (server/test/ci-migration.it.test.ts)
- [x] T6  Add a `stableManifestSlug(agentId, name)` helper in `serialize.ts` — rename-stable, cross-agent-unique (recommend `slugify(name)-<agentId-prefix>`), ≤ path-safe length, deterministic across re-exports   → AC-62  → test_stable_manifest_slug (server/src/modules/ci/serialize.test.ts)
- [x] T7  `repository.ts`: persist `manifest_slug` in `insertInstallation`; expose it internally (a `findInstallationRow`/`getSlug` read + a `listInstallationsForRepo` keyed by slug) WITHOUT changing the frozen `CiInstallation` DTO shape   → AC-62, AC-64  → test_repo_manifest_slug (server/test/ci-export.it.test.ts)
- [x] T8  `service.export` + `generateFiles`/`bundle.ts`: write the manifest at `manifestPath(stableSlug)`; on re-export reuse the existing row's stored slug (stable path, layered commit preserves other agents' files, single PR reused); keep per-`(agent,repo)` idempotency (no duplicate row)   → AC-56, AC-57, AC-63  → test_multi_agent_export (server/test/ci-export.it.test.ts)

### Phase 3 — Runner: load & run all manifests (agent-runner)  (depends on: Phase 2)
- **Surface:** agent-runner (embeds reviewer-core — invariants MUST hold)
- **Skills to apply:** typescript-expert, security  (reviewer-core invariants per agent-runner/CLAUDE.md)
- **What changes & why:** lift the single-manifest hard-fail (AC-59) and run every installed
  agent (AC-58/AC-60), each isolated so one failure/gate-trip does not stop the others and the
  exit is computed only after all run (AC-61/AC-69). Each agent emits its own result identified
  by the stable slug (AC-64 alignment). Every reviewer-core invariant + security property holds
  per agent (AC-68/AC-77/AC-78).
- **How to test:** `bash scripts/test-mirror.sh reviewer-core test` is unaffected; runner unit:
  agent-runner vitest (`manifest.test.ts`, `run.test.ts`) — hermetic, LLM stubbed.
- [x] T9  Replace `findManifestPath` (throws on >1) with `findManifestPaths(devdigestDir)` returning ALL `*.yaml` manifests (no hard-fail on >1; empty dir still a clear `RunnerError`)   → AC-59  → test_find_all_manifests (agent-runner/src/manifest.test.ts)
- [x] T10  Restructure `run.ts`/`index.ts`: extract a per-agent review step (current `runCi` body — `reviewPullRequest` → `toReviewPayload`/`countBlockers`/`gateTriggered` vs the manifest's `ci_fail_on`, unchanged), loop over all manifests with a PER-AGENT try/catch (one agent's trip/hard-fail still runs+posts the rest), write one artifact file per agent `devdigest-result-<slug>.json` with `agent` = manifest basename slug, and return exit non-zero iff ANY agent's gate tripped AFTER all ran   → AC-58, AC-60, AC-61, AC-68, AC-69  → test_runner_multi_agent (agent-runner/src/run.test.ts)
- [x] T11  Set `CiResultArtifact.agent` to the manifest-file basename slug in `artifact.ts` (semantic change, no new field; `AgentManifest` untouched) and assert per-agent that the diff/PR body still route through `assemblePrompt`/`wrapUntrusted` and no secret reaches any artifact/log regardless of N   → AC-64, AC-77, AC-78  → test_artifact_identity_and_secret_safety (agent-runner/src/run.test.ts)

### Phase 4 — Workflow + constants for multi-agent artifacts (server ci)  (depends on: Phase 3)
- **Surface:** server (ci module)
- **Skills to apply:** fastify-best-practices (n/a — pure gen), security, onion-architecture
- **What changes & why:** the single generated workflow must upload EVERY per-agent result file
  (so ingest can read all N) while keeping `on: pull_request` fork-safety and `contents: read` +
  `pull-requests: write` least privilege for the multi-agent run, and never inlining the
  OpenRouter key (AC-77/AC-78). One job, one aggregate status check (decision a + #3).
- **How to test:** colocated pure unit test of the generated YAML string.
- [x] T12  `workflow.ts` + `constants.ts`: change the `upload-artifact` step to capture all per-agent result files (glob `devdigest-result*.json` under the one `devdigest-result` artifact); keep `on: pull_request` (never `pull_request_target`), keep `permissions: contents: read / pull-requests: write`, keep `OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}` referenced-not-inlined, keep `safeTriggers` sanitization   → AC-58, AC-69, AC-77, AC-78  → test_workflow_multi_agent (server/src/modules/ci/workflow.test.ts)

### Phase 5 — Ingest per-agent mapping (server ci)  (depends on: Phase 4)
- **Surface:** server (ci module)
- **Skills to apply:** drizzle-orm-patterns, onion-architecture, security
- **What changes & why:** stop the blind fan-out that attributes one shared result to every
  installation; map EACH result to ITS installation by the (untrusted) `CiResultArtifact.agent`
  slug, skip identities matching no installation, and record each row with its own agent's
  counts/cost/status — including failed runs — staying idempotent per `(workspace, installation,
  run)`.
- **How to test:** `bash scripts/test-mirror.sh server exec vitest run .it.test` (`ci-ingest`).
- [x] T13  Build a per-repo slug→installation index in ingest (reuse T7 repository read) and, for each workflow run, call `downloadWorkflowRunArtifactFiles`, `safeParse` each result, map by `agent` slug to that installation; an identity matching NO installation is skipped (never attached to another install)   → AC-64, AC-65  → test_ingest_maps_by_identity + test_ingest_skips_unknown (server/test/ci-ingest.it.test.ts)
- [x] T14  Persist each mapped run against its OWN `agent_id`/`ci_installation_id` with that agent's findings/critical/suggestion/cost/duration/status (a failed agent → a `failed` row for its own install), keeping the `(workspace, installation, github_url)` idempotency (repeated refresh = no dupes); a completed run with no result file for an install stays the existing failed-vs-running logic   → AC-66, AC-67  → test_ingest_per_agent_rows + test_ingest_idempotent (server/test/ci-ingest.it.test.ts)

### Phase 6 — Uninstall: service + repository + branch cleanup + route (server ci)  (depends on: Phase 1, Phase 2)
- **Surface:** server (ci module) + adapters usage
- **Skills to apply:** fastify-best-practices, drizzle-orm-patterns, onion-architecture, security
- **What changes & why:** first-class "Remove from CI": delete the row (AC-70), delete ONLY that
  agent's manifest/skills from the branch (AC-71), when it is the LAST agent also remove the
  orphaned workflow/runner but leave the branch + PR (AC-72, decision #2), preserve run history as
  detached rows via the existing `set null` cascade (AC-73), surface a clear error without leaving
  studio/branch divergent (AC-74), and never disturb the remaining agents or an in-flight run
  (AC-76). Route is thin (parse params → one service call → typed result).
- **How to test:** `bash scripts/test-mirror.sh server exec vitest run .it.test`
  (new `server/test/ci-uninstall.it.test.ts` behind `MockGitHubClient`); `arch:check`.
- [x] T15  `repository.ts`: add `deleteInstallation(agentId, installationId)` (workspace-scoped via the agent guard) deleting exactly one `ci_installations` row; rely on the existing `agent_runs.ci_installation_id onDelete: set null` cascade to detach — not delete — that install's CI run history   → AC-70, AC-73  → test_delete_installation_detaches_history (server/test/ci-uninstall.it.test.ts)
- [x] T16  `service.uninstall(workspaceId, agentId, installationId)`: resolve the install's `manifest_slug`, call `github.deleteFiles` to remove that agent's `.devdigest/agents/<slug>.yaml` (+ its no-longer-referenced skills) from `devdigest/ci`; if it is the last agent on the repo also delete the workflow + runner/memory files, but never the branch/PR; delete the row (T15); surface `ConfigError`/GitHub errors as a clear, actionable failure and never persist a half-done state (call GitHub BEFORE or transactionally so studio and branch cannot silently diverge); return `CiUninstallResult`   → AC-71, AC-72, AC-74, AC-76  → test_uninstall_one_of_many + test_uninstall_last_agent + test_uninstall_branch_error (server/test/ci-uninstall.it.test.ts)
- [x] T17  `routes.ts`: add `DELETE /agents/:id/ci-installations/:installationId` — thin edge: parse params with a shared/`IdParams`-style schema, read context, call `service.uninstall`, return the `CiUninstallResult`   → AC-70  → test_uninstall_route (server/test/ci-uninstall.it.test.ts)

### Phase 7 — Client: Remove-from-CI action + confirm dialog + hook (client)  (depends on: Phase 6)
- **Surface:** client (UI)
- **Skills to apply:** react-frontend-architecture, react-best-practices, next-best-practices, react-testing-library
- **What changes & why:** expose the destructive uninstall on each installation row via an
  explicit, accessible confirm dialog naming repo + agent (AC-75), wired through a mutation hook
  that invalidates the installations + CI-runs queries. Per-agent attribution on the CI tab /
  CI Runs page is otherwise data-driven (correct once ingest maps right — AC-67), so no attribution
  UI change is needed beyond the existing `agents.name` join surfaced through `agent_name`.
- **How to test:** `bash scripts/test-mirror.sh client test` + `bash scripts/test-mirror.sh
  client lint`. Client tests use `fireEvent` from `@testing-library/react` (NOT `user-event` —
  not a dependency; see Open questions), rendered under `NextIntlClientProvider` (messages via
  relative import) + `ToastProvider`, with data hooks + `next/navigation` `vi.mock`ed.
- [x] T18  `lib/hooks/ci.ts`: add `useDeleteCiInstallation(agentId)` — `useMutation` calling `api.del<CiUninstallResult>('/agents/${agentId}/ci-installations/${installationId}')`, `onSuccess` `invalidateQueries` `["ci-installations", agentId]` + `["agent-ci-runs", agentId]` (string-array queryKeys)   → AC-70  → test_use_delete_ci_installation (via the CiTab test)
- [x] T19  Add a "Remove from CI" affordance to each `Installations.tsx` row that opens a destructive confirm dialog (reuse the `Modal` primitive + `useDialogA11y`) naming the repo + agent; wire confirm → `useDeleteCiInstallation`; keyboard-operable, accessible label, focus moved to a sensible sibling after removal, async in-flight/success/error announced via `aria-live`; error surfaces the server message (AC-74)   → AC-75, AC-76  → test_remove_from_ci_confirm (client CiTab.test.tsx)
- [x] T20  Add the new copy to `messages/en/ci.json` (remove-action label, confirm dialog title/body with `{repo}`/`{agent}`, last-agent warning, error text); English-only (no new locale dir)   → AC-75  → test_ci_i18n (client/src/test/ci-i18n.test.ts)

## Traceability matrix

| AC   | Task      | Test                                             | Commit |
|------|-----------|--------------------------------------------------|--------|
| AC-56 | T8       | test_multi_agent_export                          | —      |
| AC-57 | T8       | test_multi_agent_export                          | —      |
| AC-58 | T10, T12 | test_runner_multi_agent                          | —      |
| AC-59 | T9       | test_find_all_manifests                          | —      |
| AC-60 | T10      | test_runner_multi_agent                          | —      |
| AC-61 | T10      | test_runner_multi_agent                          | —      |
| AC-62 | T5, T6, T7, T8 | test_stable_manifest_slug                   | —      |
| AC-63 | T8       | test_multi_agent_export                          | —      |
| AC-64 | T3, T7, T11, T13 | test_ingest_maps_by_identity             | —      |
| AC-65 | T13      | test_ingest_skips_unknown                        | —      |
| AC-66 | T14      | test_ingest_per_agent_rows                       | —      |
| AC-67 | T14      | test_ingest_idempotent                           | —      |
| AC-68 | T10      | test_runner_multi_agent                          | —      |
| AC-69 | T10, T12 | test_runner_multi_agent + test_workflow_multi_agent | —   |
| AC-70 | T15, T17 | test_uninstall_route                             | —      |
| AC-71 | T2, T16  | test_uninstall_one_of_many                       | —      |
| AC-72 | T16      | test_uninstall_last_agent                        | —      |
| AC-73 | T15      | test_delete_installation_detaches_history        | —      |
| AC-74 | T16      | test_uninstall_branch_error                      | —      |
| AC-75 | T19, T20 | test_remove_from_ci_confirm                      | —      |
| AC-76 | T10, T16 | test_uninstall_one_of_many                       | —      |
| AC-77 | T11, T12 | test_workflow_multi_agent                        | —      |
| AC-78 | T11, T12 | test_artifact_identity_and_secret_safety + test_workflow_multi_agent | — |

Commit is "—" at planning time; the implementer fills it as tasks land; plan-verifier audits
AC↔task↔test coverage against this table. (Coverage verified both directions: every AC-56..AC-78
has ≥1 task; every task T1..T20 cites ≥1 AC.)

## Risks & mitigations

- **ncc rebuild / stale installs (rollout).** Editing the runner rebuilds `agent-runner/dist/index.js`;
  existing target-repo installs keep the old single-agent bundle until re-exported (Non-goal:
  no auto-migration). Mitigation: state this in the PR body; the studio's re-export path already
  reads the fresh bundle from disk (`bundle.ts:22-27`), so a re-export ships the new runner.
- **GHA `upload-artifact@v4` semantics.** Multiple files under one artifact name is supported;
  the same artifact NAME twice in a run is not. The single-artifact/multi-file design (decision b)
  stays within this. Mitigation: unit-test the generated YAML (`path` glob) and keep the artifact
  name stable so ingest's download key is unchanged.
- **Partial uninstall (studio row deleted but branch write fails, or vice-versa).** Would leave
  studio and branch divergent (AC-74). Mitigation: perform the GitHub branch delete BEFORE (or
  guarded around) the row delete and surface the error without deleting the row on branch-write
  failure; `container.github()` throws `ConfigError` when `GITHUB_TOKEN` is unset before any
  mutation — mirror the export flow's "no partial state" ordering (`service.ts:89-92`).
- **Untrusted artifact identity (A05/A08).** `CiResultArtifact.agent` is attacker-influenceable
  content in a target repo's CI output. Mitigation: keep the `safeParse` gate and map ONLY to a
  matching installation slug; an unknown identity is skipped (AC-65), never attached to an
  arbitrary install.
- **Migration not applied.** `.it.test` runs will throw `relation/column … does not exist` until
  `cd server && pnpm db:migrate` runs (MANUAL, not on boot). Mitigation: call it out in Phase 2's
  "How to test" and gate the ingest/export/uninstall suites behind it.
- **Rename-stability regression** if decision (c) is not honored. Mitigation: the stored column +
  reuse-on-re-export (T7/T8) is the fix; a `test_stable_manifest_slug` asserts path stability
  across a name change.

## Critical files for implementation

- `agent-runner/src/run.ts` (+ `index.ts`, `manifest.ts`, `artifact.ts`) — the single→N-manifest
  restructure; touches every future CI run in every target repo (agent-runner/CLAUDE.md invariants).
- `server/src/modules/ci/service.ts` — export slug reuse + the new `uninstall()` orchestration.
- `server/src/modules/ci/ingest.ts` — the fan-out→per-identity mapping rewrite.
- `server/src/adapters/github/octokit.ts` — `deleteFiles` + `downloadWorkflowRunArtifactFiles`
  (and `MockGitHubClient` parity in `adapters/mocks.ts`).
- `server/src/db/schema/ci.ts` + generated migration — the `manifest_slug` column.

## Open questions / assumptions

- **"Barrel untouched" ≡ append-only registration.** The shared barrel `index.ts` wires each
  contract file with an explicit `export * from './contracts/<f>.js'` line (verified: `eval-ci.ts`,
  `ci-runs.ts`, `multi-agent.ts` are all registered this way). A NEW contract file therefore needs
  exactly ONE appended `export *` line; "never edit the barrel" is read as "do not modify or
  reorder existing exports / do not redefine existing contracts", which appending a registration
  line does not do. `scripts/sync-shared.mjs` then mirrors the whole `shared/` (including `index.ts`)
  server → client. Assumption, not a blocker.
- **`GitHubClient` interface edits are sanctioned.** `adapters.ts` is the Onion ports file (not the
  `@devdigest/shared` barrel); adding methods to the `GitHubClient` interface is the established way
  new adapter capabilities are introduced (the spec explicitly calls for a new port method).
- **`post_as` remains workflow-level / shared** (see Requirements review). Truly per-agent `post_as`
  is out of scope (would require unfreezing `AgentManifest`).
- **`CiInstallation` DTO stays frozen.** `manifest_slug` is an internal repository/service column,
  not exposed on the `CiInstallation` shared shape — so no existing contract changes.
- **Client tests use `fireEvent`, not `user-event`** (`client/INSIGHTS.md` 2026-06-24 — `user-event`
  is not a client dependency and fails typecheck); render under `NextIntlClientProvider` +
  `ToastProvider` with `vi.mock`ed hooks. This overrides the generic RTL "always userEvent" guidance
  for this repo.
- **`ci_runs` course table stays empty.** CI runs continue to live in `agent_runs WHERE source='ci'`;
  the empty `ci_runs` scaffold table is intentional and is not touched.
