# DevDigest — project map for Claude

> A map, not documentation. Links only (no @import) — read on demand. Keep ≤100 lines.

**What this is:** a local-first AI pull-request reviewer. The course *starter*: the DB
schema already holds EVERY future table sitting empty (filled lesson by lesson, L01–L08).
"Scaffolding for later" is intentional — never delete the empty "course" tables in
`server/src/db/schema/*`.

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
- `server/` — Fastify API + DB, hosts repo-intel → [server/CLAUDE.md](./server/CLAUDE.md)
- `client/` — Next.js studio (all UI) → [client/CLAUDE.md](./client/CLAUDE.md)
- `reviewer-core/` — pure review engine → [reviewer-core/CLAUDE.md](./reviewer-core/CLAUDE.md)
- `e2e/` — deterministic browser tests, no LLM → [e2e/CLAUDE.md](./e2e/CLAUDE.md)
- `server/src/vendor/shared` (`@devdigest/shared`) — Zod contracts shared by all packages

## Conventions (non-default)
- Secrets never in git/DB → `~/.devdigest/secrets.json` (0600) via `LocalSecretsProvider`.
- Extend `@devdigest/shared` with NEW files; never edit the existing barrel.

## Read when
- End-to-end review pipeline / architecture → [ONBOARDING.md](./ONBOARDING.md)
- High-level overview + diagrams → [README.md](./README.md)
- Test strategy / which suite to run → [TESTING.md](./TESTING.md)
- Built-in agent prompts → [docs/agent-prompts/](./docs/agent-prompts/)
