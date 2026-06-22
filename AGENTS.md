# DevDigest — project map for Claude

> A map, not documentation. Sub-maps via links, read on demand (do not @import them). Keep ≤100 lines.

**What this is:** a local-first AI pull-request reviewer. The course *starter*: the DB
schema already holds EVERY future table sitting empty (filled lesson by lesson, L01–L08).
"Scaffolding for later" is intentional — never delete the empty "course" tables in
`server/src/db/schema/*`.

## Working rule (always)
- Verify, don't recall: NEVER assert a fact, hypothesis, or proposal from memory alone.
  Ground it first in the relevant **skill**, then established best practice, then open/Internet
  sources — and cite what you checked. Your own confidence is NOT a substitute for the check.
- Skill checkpoint (blocking): at session start AND at every change of work-type — schema /
  contract / route / backend layering / UI / tests / wrap-up — cross-check the available skills
  and INVOKE the matching one BEFORE acting (e.g. `drizzle-orm-patterns`, `zod`,
  `fastify-best-practices`, `onion-architecture` (backend layer placement / dependency
  direction), `next-best-practices`, `react-testing-library`, `engineering-insights`). A task
  "feeling routine" is not a reason to skip — that is exactly when conventions drift.
- Version-sensitive behavior (tooling/library/runtime APIs, e.g. pnpm/Node): confirm against
  the *installed* version + official docs/changelog before advising.
- Debug failures by REPRODUCING in the exact failing stack, then bisecting by layer
  (raw socket → raw `fetch` → the actual SDK) BEFORE proposing a fix — localize, don't pattern-match.
  A sibling tool (e.g. `curl`) is a sanity check on the remote, NOT a proxy for the app's client.
- Reply in the language the question/task was asked in; keep code, identifiers, and paths verbatim.

## Editing discipline
- Plan-first by default: for any non-trivial task, present an implementation plan and
  WAIT for approval before editing/implementing. Skip the gate only when the prompt
  explicitly says to implement/edit, or for trivial mechanical changes (one-liners,
  renames, typo/format fixes). Explanation/review/proposal requests are always read-only.
- Check-before-create: before creating a new file (README, docs, config), verify it
  doesn't already exist and READ it first — extend the existing one, never silently overwrite.

## Insights loop
- At session start, before working, READ the target module's `INSIGHTS.md` (each `AGENTS.md`
  links it); treat entries as high-confidence guidance.
- Double trigger — as-you-go on a confirmed non-obvious finding + a wrap-up sweep: run the
  `engineering-insights` skill to append to that module's `INSIGHTS.md`. Read before writing
  (skip if already there); append-only; capture only the substantial; prune monthly.

## Gotchas
- `relation ... does not exist` → migrations not run: `cd server && pnpm db:migrate` (MANUAL, not on boot).
- Never inline secrets/env values — point to `LocalSecretsProvider` / Settings UI.

## Stack
- Node ≥22 · pnpm ≥10 · Docker (Postgres only)
- server: Fastify 5 · Drizzle 0.38 · Postgres+pgvector · Zod 3
- client: Next 15 · React 19 · TanStack Query 5 · Tailwind 4 · next-intl 3
- reviewer-core: pure TS · openai SDK (via OpenRouter)

## Start / commands
- everything from zero: `./scripts/dev.sh` (Postgres + migrate + seed + API:3001 + web:3000)
- migrations are MANUAL: `cd server && pnpm db:migrate`
- tests: per-package `pnpm test` — see TESTING.md

## Package map (NOT a monorepo — each package has its own package.json + lockfile, wired via tsconfig path aliases)
- `server/` — Fastify API + DB, hosts repo-intel → [server/AGENTS.md](./server/AGENTS.md)
- `client/` — Next.js studio (all UI) → [client/AGENTS.md](./client/AGENTS.md)
- `reviewer-core/` — pure review engine → [reviewer-core/AGENTS.md](./reviewer-core/AGENTS.md)
- `e2e/` — deterministic browser tests, no LLM → [e2e/AGENTS.md](./e2e/AGENTS.md)
- `server/src/vendor/shared` (`@devdigest/shared`) — Zod contracts shared by all packages

## Conventions (non-default)
- Secrets never in git/DB → `~/.devdigest/secrets.json` (0600) via `LocalSecretsProvider`.
- Extend `@devdigest/shared` with NEW files; never edit the existing barrel.

## Read when
- End-to-end review pipeline / architecture → [ONBOARDING.md](./ONBOARDING.md)
- High-level overview + diagrams → [README.md](./README.md)
- Test strategy / which suite to run → [TESTING.md](./TESTING.md)
- Built-in agent prompts → [docs/agent-prompts/](./docs/agent-prompts/)
