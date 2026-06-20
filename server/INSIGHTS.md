# server — INSIGHTS

> Running log of gotchas, debugging discoveries, and "why it's like this" decisions.
> Append as you learn. Keep entries short; link code with `path:line`.

## What Doesn't Work
- [2026-06-19] A failed `JobRunner` job rethrows into the returned `done` promise, but callers fire-and-forget `enqueue()`, so the rejection goes unhandled and crashes the whole API; guard with `void done.catch(() => {})` plus a global `unhandledRejection` net; `server/src/platform/jobs.ts` (enqueue).

## Codebase Patterns
- [2026-06-19] `@devdigest/shared` is TWO independent vendored copies (`server/src/vendor/shared` + `client/src/vendor/shared`) with NO sync script — add/change a contract field in BOTH or the other package never sees it; `server/src/vendor/shared/contracts`.
- [2026-06-19] The review engine already returns `costUsd` (OpenRouter `usage.cost`, else injected `estimateCost`/`PriceBook`) — persist it, never recompute; surfacing run cost costs zero extra model calls; `server/src/modules/reviews/run-executor.ts` (runOneAgent).
- [2026-06-20] PR-list COST = sum of ALL the PR's agent runs (every batch), skipping unpriced (failed/cancelled) ones; absent when no priced run → list shows "—"; `server/src/modules/pulls/cost.ts` (totalCostByPr). (Was latest-batch-only via `batch_id` until 2026-06-20; `batch_id` is still stamped per `runReview` fan-out but no longer drives the list rollup.)
- [2026-06-20] The PR-list route `GET /repos/:id/pulls` declares only `schema: { params }` — NO response schema; it returns `Promise<PrMeta[]>` as a TS type, so `PrMeta` is type-only there and serialization does NOT strip unknown keys. Surfacing a new list field = add it to the object built in the handler's `rows.map(...)` AND to the `PrMeta` Zod contract (the latter only for types); `server/src/modules/pulls/routes.ts`. Per-PR rollups follow one pattern: an `inArray(prIds)` query + a pure JS grouper (`cost.ts` totalCostByPr, `findings-summary.ts` findingCountsByPr).
- DB-backed tests must use the `*.it.test.ts` suffix or the unit/integration split breaks.
- Secrets are read only through `LocalSecretsProvider` (`~/.devdigest/secrets.json`, 0600);
  `GITHUB_TOKEN` is canonical, `GITHUB_PAT` is an accepted fallback.
- The engine reaps orphaned `running` runs on boot.

## Tool & Library Notes
- [2026-06-19] pnpm ≥10 blocks dependency build scripts by default; pnpm 11 replaced `onlyBuiltDependencies` with an `allowBuilds` map (`name: true|false`) — run `pnpm approve-builds` (needed for esbuild/ssh2/cpu-features/protobufjs); `server/pnpm-workspace.yaml`.

## Recurring Errors & Fixes
- Migrations are NOT applied on boot — first-run `relation ... does not exist` = run `pnpm db:migrate`.
- [2026-06-19] On a repo path containing spaces, the `file://${process.argv[1]}` entrypoint guard never equals `import.meta.url` (which percent-encodes spaces), so `pnpm db:migrate`/`db:seed` exit 0 doing nothing; use `pathToFileURL(process.argv[1]).href`; `server/src/db/migrate.ts` + `seed.ts`.
