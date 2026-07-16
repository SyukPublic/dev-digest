# TD-011 — CI Runs findings badge links out to the PR instead of an in-studio popover

| | |
|---|---|
| **Area** | `client/` (CI Runs page) + `server/` (ci module ingest) + `agent-runner/` (result artifact) |
| **Severity** | LOW–MEDIUM |
| **Status** | `watch` |
| **Surfaced by** | Post-ship CI Runs fixes (2026-07-16, branch `labs/l07`) — bug report item #4 "clicking the findings badge shows nothing" |
| **Owning skill** | `onion-architecture` (cross-package data flow) + `next-best-practices` / `react-frontend-architecture` (UI) |

## Summary

On the CI Runs page the FINDINGS cell renders per-severity count badges. The
original request for #4 was to make the badge open a **filterable findings
popover**, exactly like the PR-list FINDINGS cell
(`client/src/app/repos/[repoId]/pulls/_components/PRRow/FindingsCell.tsx` →
`FindingsFilterPopover`, fed by `usePrReviews`).

That option was **rejected** for this fix. Instead, the badge is wrapped in a
link to the pull request
(`client/src/app/ci-runs/_components/CiRunsView/CiRunRow.tsx` — FINDINGS cell,
`prUrl(repo, pr_number)`). We consciously carry the gap between "counts shown
locally" and "finding detail only on the PR".

## Why the popover was rejected (the real blocker)

The individual findings of a CI run **do not exist anywhere in the studio** —
only aggregate counts do:

- The `agent-runner` runs inside the **target repo's** GitHub Actions,
  entirely outside our server, DI graph, and Postgres (`agent-runner/CLAUDE.md`).
  It posts findings straight to the GitHub PR review and writes back only
  `devdigest-result.json`.
- That artifact carries **counts only** — `{ findings_count, critical,
  warning, suggestion, cost_usd, duration_ms, agent, version, pr_number }` —
  and no `findings[]` array (`agent-runner/src/artifact.ts` `buildResultArtifact`;
  contract `CiResultArtifact` in
  `server/src/vendor/shared/contracts/eval-ci.ts`).
- Ingest only upserts an `agent_runs` row (`source='ci'`); it creates **no**
  `reviews`/`findings` rows (`server/src/modules/ci/ingest.ts`,
  `server/src/modules/ci/repository.ts`). `CiRunSummary` has neither a
  `review_id` nor a findings field.

So a "popover like PR" has nothing to populate — the PR page's popover works
only because findings are persisted locally there.

## What the popover would have required (the pipeline extension, deferred)

A genuine in-studio findings drill-down for CI runs needs a change across
**three packages**, including a shipped artifact that has already left this
repo:

1. **Artifact contract** — add `findings[]` (path/line/severity/title/body) to
   `CiResultArtifact` and emit it from `agent-runner/src/artifact.ts`. This
   changes the **ncc-bundled runner** embedded in every already-installed
   target repo (`.devdigest/runner/index.js`), so counts-only stays the reality
   until each repo re-exports / re-installs the new bundle
   (see the 2026-07-14 INSIGHTS entry on the gitignored/unbuilt bundle).
2. **Ingest + storage** — persist the CI run's findings (either real
   `reviews`/`findings` rows keyed to the CI `agent_run`, or a JSON column) —
   a **migration** + ingest rewrite.
3. **API + UI** — a new `GET` endpoint for a CI run's findings and wiring the
   existing `FindingsFilterPopover` into `CiRunRow`.

Effort + risk (touching a deployed artifact contract) are out of scope for a
post-ship fix; hence "link to the PR" now.

## Consequence carried

- Clicking the FINDINGS badge leaves the studio (opens the PR in a new tab)
  rather than showing findings in-app — one extra hop and no in-studio filter.
- ~~The severity split lumps `suggestion` into WARNING~~ — **resolved
  (2026-07-16)**: a `suggestions` column (migration `0025_true_barracuda.sql`)
  now persists the artifact's suggestion count, so the badge shows a true
  CRITICAL/WARNING/SUGGESTION split (`CRITICAL = blockers`, `SUGGESTION =
  suggestions`, `WARNING = findings_count − blockers − suggestions`);
  `client/.../CiRunsView/helpers.ts` `findingCountsOf`,
  `server/src/modules/ci/{ingest,repository}.ts`.

## Triggers to pay down

- Users need CI-run finding detail **without leaving the studio** (e.g. CI Runs
  becomes a primary triage surface, not just a history list).
- CI runs become a **gating** signal that must be inspected/dismissed in-app.
- ~~An accurate 3-way severity split on the CI Runs badge becomes a
  requirement~~ — done 2026-07-16 (see "Consequence carried"); the *finding
  list* remains the open debt.
- The artifact contract is being revised for another reason anyway → fold the
  `findings[]` addition in while the bundle is already being re-shipped.
