# e2e (@devdigest/e2e) — map for Claude

> A map, not documentation. Links only (no @import). Keep ≤100 lines.

**What this is:** deterministic browser end-to-end flows driven by Vercel **agent-browser**
(Rust + CDP). No LLM, no Playwright, no test framework — `wait --text` / `wait --url`
commands ARE the assertions, run against seeded demo data.

## Use when
- Adding/altering an e2e flow, or debugging a failing browser check.
- Verifying a UI change end-to-end against the real stack.

## Gotchas / rules
- No LLM is ever called — never use agent-browser's `chat` command; use deterministic locators.
- Flows assume the seeded DB (`acme/payments-api`, PR #482) is the ONLY repo → run hermetically.
- Prefer `pnpm e2e:hermetic` (isolated Postgres:5433 / API:3101 / web:3100), not the dev DB.
- Check [INSIGHTS.md](./INSIGHTS.md) for flaky-flow notes before editing.

## Stack
- agent-browser (global CLI) · tsx · TypeScript — that's it.

## Commands
- run: `pnpm test` (`tsx run.ts`) · hermetic stack: `pnpm e2e:hermetic` · typecheck: `pnpm typecheck`
- prereq: `npm i -g agent-browser && agent-browser install`

## Where things live
- `specs/*.flow.json` — flows (lexically ordered; each = a list of agent-browser commands)
- `run.ts` — the runner (one shared browser session) · `lib/assert.ts` — `{BASE}` + stdout asserts

## Conventions (non-default)
- A flow step fails by non-zero exit (a `wait` that times out); there is no assertion DSL.
- Deterministic locators only: `--url`, `--text`, `find role|text|label`.
- Failure screenshots land in `test-results/` for CI artifacts.

## Read when
- runner & env knobs → [README](./README.md)
- the flows themselves (acceptance) → [specs/](./specs/)
- deep notes → [docs/](./docs/) · lessons/gotchas → [INSIGHTS.md](./INSIGHTS.md)
