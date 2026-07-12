# API contracts & route conventions

> A map for adding or changing an HTTP endpoint. Conventions first, catalog second.
> The deep request/DI flow lives in the module [README](../README.md#request--di-flow).

## The one rule: contracts are Zod, shared, and drive the route
- Every route declares its `params`/`body`/response with **Zod contracts from
  `@devdigest/shared`** (`src/vendor/shared`); `fastify-type-provider-zod` makes one
  definition drive request validation **and** response serialization. Handlers do NOT
  hand-roll `Schema.parse(req.body)` — invalid input is rejected with `422` before the
  handler runs.
- **Extend `@devdigest/shared` with NEW files; never edit the existing barrel.**
- A contract shape lives with the domain, not the route file — reused across server,
  client, and mcp.

## Cross-cutting conventions (hold for every endpoint)
- **Multi-tenancy:** every domain row carries `workspace_id`; queries are scoped by the
  base-repository guard. A new endpoint touching domain data MUST stay inside that scope.
- **Errors:** thrown `AppError` → mapped status; validation → `422`; serialization failure →
  `500`. One shared structured envelope (the error handler), registered before modules.
- **Rate limiting:** global 120/min (disabled under `NODE_ENV=test`); expensive endpoints get
  tighter per-route caps (e.g. `POST /pulls/:id/review`); SSE and `/health*` are exempt.
- **Streaming:** long-running work streams run traces over SSE (`fastify-sse-v2`), not polling.
- **Layering is Onion:** routes → service → repository/adapters; no DB query or SDK call in a
  route. Before placing logic, INVOKE the `onion-architecture` skill.

## Endpoint catalog (starter)
Each module owns its routes in `src/modules/<name>/routes.ts`, registered in
`src/modules/index.ts`.

| Domain | Module | Routes |
|--------|--------|--------|
| Repos & PRs | `repos` / `pulls` / `polling` | `/repos` · `/pulls/:id` · `/pulls/:id/comments` · `/repos/:id/poll` |
| Review & runs | `reviews` | `/pulls/:id/review` · `/reviews` · `/findings/:id/(accept\|dismiss)` · `/runs/:id/(events\|trace)` |
| Agents | `agents` | `/agents` · `/agents/:id` |
| Repo intelligence | `repo-intel` | `/repos/:id/index-state` · `/repos/:id/resync` |
| Platform | `settings` / `workspace` | `/settings` · `/providers` · `/workspace` |
| Health | — | `/health` (liveness) · `/health/ready` (DB ping → 200/503) |

## Adding a new endpoint — checklist
1. New feature ⇒ **new module** `src/modules/<name>/` (routes + service + repository) + one
   `app.register` line in `src/modules/index.ts`. Extending an existing domain ⇒ add the route
   to its module.
2. Define/extend the Zod contract in a NEW file under `@devdigest/shared`; wire it as the route
   schema.
3. Keep the handler thin: validate via schema, delegate to a service, reach externals only
   through the DI container's adapters.
4. New columns ⇒ their own migration only (`pnpm db:generate` → `pnpm db:migrate`; MANUAL).
5. Pick a rate-limit cap if the endpoint is expensive.

See also: [server/AGENTS.md](../AGENTS.md) · [server/README.md](../README.md).
