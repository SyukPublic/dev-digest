# Development Plan: devdigest-mcp server (L04)

> **Status: PLAN ONLY — not yet implemented.** This spec is written for a future
> implementation pass. Decisions below were agreed with the user and are grounded
> in the current code (file:line refs are verified unless marked "confirm").

## Context

L04 course lab. Build a **new local MCP server** (`devdigest-mcp`, package
`@devdigest/mcp`) that exposes the DevDigest review engine to an MCP client
(Claude Code) over **stdio**. It surfaces 5 namespaced tools:
`devdigest_list_agents`, `devdigest_run_agent_on_pr`, `devdigest_get_findings`,
`devdigest_get_conventions`, `devdigest_get_blast_radius`.

The root README lists this lab as: `L04 | devdigest-mcp server · Blast Radius
(reads repo-intel)`. There is **no existing MCP code or dependency** in the repo.

**Architecture — variant A (HTTP bridge):** the MCP server is a thin **inbound
edge** (equivalent to a Fastify route per the `onion-architecture` skill) that
calls the already-running local API (`@devdigest/api`, `pnpm dev` → :3001). It
depends only on the published HTTP surface and `@devdigest/shared` Zod contracts —
**never** on `server/` internals, the DI `Container`, or Drizzle. This keeps the
dependency arrow pointing inward (`mcp → @devdigest/shared` only) and reuses the
review orchestration that already lives in the API's services.

Rejected alternative (variant B, in-process `Container` reuse): would deep-import
server internals past their facade, spin up a second DB pool + secrets resolution
in the MCP process, and run the review pipeline outside the API. Heavier and
boundary-eroding; not chosen.

### Confirmed decisions (do not re-litigate)
1. **Variant A** (HTTP bridge over the local API), not in-process Container reuse.
2. **Transport: stdio** (`StdioServerTransport`); local, launched by the MCP client.
3. **Namespacing:** all 5 tools carry the `devdigest_` prefix.
4. **`get_blast_radius` is an explicit STUB in L04.** It returns a typed
   placeholder (`{ status: "not_implemented", ... }`); the real impl (a
   `GET /repos/:id/blast` route → `container.repoIntel.getBlastRadius`) is
   deferred to homework. **No blast route is added in L04.**
5. **No auth / workspace plumbing.** The API resolves tenancy server-side via
   `LocalNoAuthProvider`, which ignores the request and returns the seeded default
   workspace + system user (`server/src/adapters/auth/local.ts:14`,
   `server/src/modules/_shared/context.ts:14`). The MCP client passes no header or
   token. **Precondition:** the DB must be seeded (`./scripts/dev.sh` or
   `pnpm db:seed`), else the provider throws `No default workspace found`.
6. **One backend code change only:** a read-only `?number=<n>` query filter on the
   existing `GET /repos/:id/pulls` route, so the MCP server resolves a PR by number
   without listing all pulls. (`repo` owner/name → `repoId` is still resolved
   client-side in MCP via `GET /repos`.)
7. **Mandatory tool-design principles** (course requirement): outcome-not-operation,
   flat scalar arguments, concise structured response `{verdict, findings[]}`,
   error-messages-that-lead-forward. Plus the agreed additions: B1 concise
   descriptions, A2 explicit context in descriptions, C read/write tool
   annotations, and namespacing (decision 3).
8. **All API responses are validated against `@devdigest/shared` contracts** at the
   MCP boundary; tool outputs are trimmed to high-signal fields.

## Affected packages & files

### server/ — the single backend change (Phase 1)
- **EDIT** `server/src/modules/pulls/routes.ts` (`GET /repos/:id/pulls`,
  routes.ts:27) — accept an optional `number` query param. When present, return the
  single matching pull (0 or 1), else the existing list. Read-only; validate the
  query with a small Zod schema.
- **EDIT** `server/src/modules/pulls/service.ts` — thin passthrough to the new repo
  method.
- **EDIT** `server/src/modules/pulls/repository.ts` — **NEW** method
  `byNumber(workspaceId, repoId, number)`: single indexed select on the existing
  unique `(repo_id, number)` (`pulls/repository.ts:78`). Returns the row or `null`.
  Drizzle stays inside the repository (onion rule 4).
- **EDIT** `server/src/modules/_shared/schemas.ts` (or a pulls-local schema file) —
  add the `number` query schema, alongside the existing `IdParams` pattern. (No
  change to the cross-package `@devdigest/shared` barrel — module-local route schema
  only.)
- **REUSE (do NOT modify):** the existing pull response contract for the return
  shape; `getContext` for tenancy.
- **TESTS:** unit for `byNumber` query shaping; `server/test/pulls-by-number.it.test.ts`
  (DB-backed, `*.it.test.ts` suffix) — found / not-found / wrong-workspace.

### mcp/ — NEW package (Phases 0, 2, 3, 4)
Thin onion edge; mirrors the route→handler split but over stdio.
- **NEW** `mcp/package.json` — name `@devdigest/mcp`, type `module`. Deps:
  `@modelcontextprotocol/sdk`, `zod`. Dev: `tsx`, `typescript`, `@types/node`.
  Scripts: `start`/`dev` via `tsx src/index.ts`. Own lockfile (this is NOT a
  monorepo — each package has its own `package.json` + lockfile).
- **NEW** `mcp/tsconfig.json` — ESM, Node ≥22; path aliases
  `@devdigest/shared` → `../server/src/vendor/shared/index.ts` and
  `@devdigest/shared/*` → `../server/src/vendor/shared/*` (mirrors `server/tsconfig.json`).
- **NEW** `mcp/src/config.ts` — read `DEVDIGEST_API_URL` (default
  `http://localhost:3001`) and the default workspace handling note (none needed). No
  secrets, no auth.
- **NEW** `mcp/src/api-client.ts` — thin `fetch` wrapper over the API. Methods:
  `listAgents()`, `listRepos()`, `resolveRepoId(ownerName)`,
  `resolvePull(repoId, prNumber)` (uses the Phase-1 `?number=` filter),
  `runReview(pullId, target)`, `consumeRunEvents(runId)` (SSE until done) /
  `pollRuns(pullId)`, `reviewsForPull(pullId)`, `conventions(repoId)`. Parses every
  response with the matching `@devdigest/shared` contract. Translates HTTP/network
  failures into the error-leads-forward messages below.
- **NEW** `mcp/src/format.ts` — **pure** mappers: API DTO → concise tool output
  (`{verdict, findings[]}` keeping only high-signal finding fields:
  `file, startLine, endLine, severity, category, title, suggestion, confidence`).
- **NEW** `mcp/src/tools/list-agents.ts`, `run-agent-on-pr.ts`, `get-findings.ts`,
  `get-conventions.ts`, `get-blast-radius.ts` — one thin handler each: validate
  input (Zod) → call `api-client` → shape via `format` → return.
- **NEW** `mcp/src/tools/index.ts` — the tool registry: namespaced `name`,
  `description`, input schema, `annotations` (read/write hints), handler.
- **NEW** `mcp/src/index.ts` — entry: construct the MCP `Server`, register tools,
  connect `StdioServerTransport`.
- **NEW** `mcp/README.md` — how to run (`pnpm i`, API up via `./scripts/dev.sh`) and
  register in the MCP client.

### Repo root (Phase 4)
- **NEW/EDIT** `.mcp.json` — register `devdigest-mcp` as a stdio server
  (`command`/`args`/`env: { DEVDIGEST_API_URL }`). Check whether `.mcp.json` already
  exists and extend it; do not clobber.
- **EDIT** root `AGENTS.md` — add a one-line entry for the `mcp/` package in the
  Package map.

## Tool → endpoint mapping

| Tool (namespaced) | write? | API call(s) | backing service |
|---|---|---|---|
| `devdigest_list_agents` | read | `GET /agents` | `AgentsService.list` |
| `devdigest_get_conventions` | read | `GET /repos/:id/conventions` | `ConventionsRepository.listByRepo` |
| `devdigest_get_findings` | read | resolve PR → `GET /pulls/:id/reviews` (`reviews/routes.ts:91`) | `ReviewService.reviewsForPull` |
| `devdigest_get_blast_radius` | read | **none — returns stub** | — (homework) |
| `devdigest_run_agent_on_pr` | **write** | resolve PR → `POST /pulls/:id/review` (`reviews/routes.ts:27`) → consume `GET /runs/:id/events` (SSE, `reviews/routes.ts:48`) until done → `GET /pulls/:id/reviews` | `ReviewService.runReview` |

PR resolution for the flat args: `repo` (`owner/name`) → `repoId` via `GET /repos`
(small local set), then `(repoId, pr)` → `pullId` via `GET /repos/:id/pulls?number=`
(Phase 1).

## Tool descriptions & annotations (draft — eval-tune at impl)

> Strings are English (they ship in the tool definitions). Finalize wording/length
> during implementation — small description refinements yield large behavioral gains.

- `devdigest_list_agents` — *readOnly*
  "List the PR-review agents configured in this workspace. Call this first —
  `devdigest_run_agent_on_pr` needs a valid `agent` id from here."
- `devdigest_run_agent_on_pr` — *write, non-destructive*
  "Run a review agent on a pull request and return the finished result. Starts a
  run, waits for it to complete, and returns `{verdict, findings[]}` in one call.
  The only tool that starts a review."
  - `repo`: "Repository as `owner/name`."
  - `pr`: "Pull request number."
  - `agent`: "Agent id from `devdigest_list_agents`, or `all` to run every enabled agent."
- `devdigest_get_findings` — *readOnly*
  "Get `{verdict, findings[]}` from the latest review run on a pull request, without
  starting a new run. Use after `devdigest_run_agent_on_pr` or to re-read an earlier
  run." (`repo`, `pr` as above)
- `devdigest_get_conventions` — *readOnly*
  "Get the repository's coding conventions (the repo-conventions extracted in L02):
  each rule with its evidence path and confidence." (`repo`)
- `devdigest_get_blast_radius` — *readOnly*
  "Impact map of a pull request — changed symbols, callers, impacted endpoints.
  STUB in L04: returns a placeholder, not real analysis yet." (`repo`, `pr`)

**Principle mapping:** namespacing (all `devdigest_`); outcome-not-operation
(`run_*` "starts/waits/returns in one call"); flat scalar args; concise
`{verdict, findings[]}`; A2 explicit context (where ids come from, `owner/name` +
number formats, L02 source, stub status); B1 1–2 sentences each (footprint well
under the auto-defer threshold); C read/write annotations (4 readOnly + 1 write).

**Error-leads-forward catalog (behavior, not descriptions):**
- unknown agent → `"Agent '<x>' not found. Call devdigest_list_agents for valid ids."`
- PR not found → `"PR #<n> not found in <owner/name>. Check the number, or that the repo is imported."`
- API unreachable → `"Cannot reach the DevDigest API at <url>. Start it with ./scripts/dev.sh and retry."`
- blast stub → `{ status: "not_implemented", note: "Blast radius is a stub in L04; coming in a later lesson." }`

## Phases (disjoint where noted)

- **Phase 0 — Scaffold `mcp/`.** package.json, tsconfig, config, stdio server with
  the registry and ONE wired read tool (`devdigest_list_agents`) end-to-end +
  `.mcp.json` registration. Exit: the MCP client lists the server and the tool runs
  against a seeded DB.
- **Phase 1 — Backend resolve route (`server/`).** The `?number=` filter + `byNumber`
  repo method + tests. **Independent of `mcp/`** — can run in parallel with Phase 0/2.
- **Phase 2 — Read tools (`mcp/`).** `devdigest_get_conventions`,
  `devdigest_get_findings`, `devdigest_get_blast_radius` (stub). Depends on Phase 0;
  `get_findings` uses Phase 1's resolve. readOnly annotations, concise output,
  error handling.
- **Phase 3 — Write tool (`mcp/`).** `devdigest_run_agent_on_pr`: POST review,
  consume run events until completion, return `{verdict, findings[]}`. Depends on
  Phase 1 (resolve) + Phase 2 (findings formatting reuse). Highest complexity:
  run-completion detection over SSE.
- **Phase 4 — Polish & verify.** Description/error eval-tune, `mcp/README.md`, root
  `AGENTS.md` line, manual run in the MCP client against a seeded repo/PR, optional
  `INSIGHTS.md` entries.

## Verify BEFORE coding (do not assume)
1. **Installed `@modelcontextprotocol/sdk` version** — confirm the `Server` /
   tool-registration API and the exact annotation field names (`readOnlyHint`,
   `destructiveHint`, …) against that version; do not code them from memory
   (version-sensitivity rule).
2. **Run-completion signal** — open `streamRunEvents` / the `GET /runs/:id/events`
   SSE shape (`reviews/routes.ts:48`, `platform/sse.ts`) and confirm the terminal
   "done" event before relying on it in Phase 3.
3. **Confirm exact paths/response shapes** for `GET /agents`,
   `GET /repos/:id/conventions`, `GET /repos` (per the repo map; open the files).
4. **`{verdict}` source** — confirm where the per-review verdict/score lives on the
   `reviewsForPull` payload and select the high-signal fields for `format.ts`.

## Verification commands
Run in WSL (toolchain lives there — see `CLAUDE.local.md`):
- backend: `cd server && pnpm typecheck && pnpm test` (incl. the new
  `*.it.test.ts`; migrations are manual — `pnpm db:migrate` is NOT run on boot).
- mcp: `cd mcp && pnpm typecheck`.
- boundaries: confirm `mcp/` imports only `@devdigest/shared`,
  `@modelcontextprotocol/sdk`, and `fetch` — no `server/src/**` internals, no
  `drizzle-orm`.
- manual: `./scripts/dev.sh` up → register `.mcp.json` → in the MCP client call each
  tool against a seeded repo/PR; check `{verdict, findings[]}`, read/write
  behavior, and the three error paths (unknown agent, API down, stub blast).

## Out of scope / homework
- Real `get_blast_radius`: add `GET /repos/:id/blast?files=` (thin edge →
  `container.repoIntel.getBlastRadius`) and wire the tool to it.
- Optional `owner/name → repoId` lookup route, to drop the client-side `GET /repos`
  listing.
- Non-local deployment / auth (a real `AuthProvider` replaces `LocalNoAuthProvider`;
  the MCP client would then pass a token — no MCP code change beyond config).
