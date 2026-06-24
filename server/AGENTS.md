# server (@devdigest/api) — map for Claude

> A map, not documentation. Links only (no @import). Keep ≤100 lines.

**What this is:** the DevDigest backend — imports repos & PRs, indexes a repo with
repo-intel, stores agents, runs the reviewer (diff → reviewer-core → grounded findings).
Fastify 5 + Drizzle over Postgres (pgvector); adapters sit behind a DI container.

## Use when
- Adding/altering an endpoint, service, DB schema, migration, or adapter.
- Wiring a new feature module, or touching review orchestration / repo-intel.
- Anything about secrets, config, jobs, or SSE run streams.

## Gotchas / rules
- Migrations are NOT applied on boot — run `pnpm db:migrate` before hitting the DB.
- A DB-backed test must use the `*.it.test.ts` suffix (unit vs integration split).
- Reach external systems only through adapters (the DI container), never directly.
- Layering is Onion: dependencies point inward (routes → service → repository/adapters; core
  stays pure). Before placing logic / a DB query / an SDK call / a contract, or reviewing a
  cross-layer import, INVOKE the `onion-architecture` skill.
- Check [INSIGHTS.md](./INSIGHTS.md) for known gotchas before changing behavior.
- After a non-obvious discovery/fix here, append it to INSIGHTS.md via `engineering-insights`.

## Stack
- Fastify 5 (helmet · cors · rate-limit · fastify-sse-v2) · Drizzle 0.38 · `postgres` 3 · pgvector
- Zod contracts double as route schemas via `fastify-type-provider-zod`

## Commands
- dev: `pnpm dev` (:3001) · test: `pnpm test` · typecheck: `pnpm typecheck`
- DB: `pnpm db:migrate` · `pnpm db:seed` · `pnpm db:generate`
- unit only: `pnpm exec vitest run --exclude '**/*.it.test.ts'` · integration: `pnpm exec vitest run .it.test`

## Where things live
- `src/modules/<name>/` — feature plugins (routes + service + repository), registered in `modules/index.ts`
- `src/platform/` — DI container, config, jobs, sse, grounding, errors
- `src/adapters/` — ports (llm, github, git, astgrep, codeindex, secrets, tokenizer, embedder, depgraph)
- `src/db/schema/` — Drizzle tables · `src/vendor/shared` — shared Zod contracts

## Conventions (non-default)
- Multi-tenancy: every domain table has `workspace_id`; queries scoped by the base-repository guard.
- DI: services depend on interfaces (`@devdigest/shared`), not classes; tests mock via `ContainerOverrides`.
- repo-intel — ONLY via the `container.repoIntel.*` facade; never reach into its pipeline.
- Context enrichment is best-effort: on error / not-indexed, drop the section, don't throw.
- New feature = new module + one line in `modules/index.ts`; new columns = their own migration only.

## Read when
- routes / API map → [README](./README.md)
- the indexer → [src/modules/repo-intel/README.md](./src/modules/repo-intel/README.md)
- deep architecture → [docs/](./docs/) · feature acceptance → [specs/](./specs/) · lessons/gotchas → [INSIGHTS.md](./INSIGHTS.md)
