# server — INSIGHTS

> Running log of gotchas, debugging discoveries, and "why it's like this" decisions.
> Append as you learn. Keep entries short; link code with `path:line`.

## What Doesn't Work
- [2026-06-19] A failed `JobRunner` job rethrows into the returned `done` promise, but callers fire-and-forget `enqueue()`, so the rejection goes unhandled and crashes the whole API; guard with `void done.catch(() => {})` plus a global `unhandledRejection` net; `server/src/platform/jobs.ts` (enqueue).

## Codebase Patterns
- DB-backed tests must use the `*.it.test.ts` suffix or the unit/integration split breaks.
- Secrets are read only through `LocalSecretsProvider` (`~/.devdigest/secrets.json`, 0600);
  `GITHUB_TOKEN` is canonical, `GITHUB_PAT` is an accepted fallback.
- The engine reaps orphaned `running` runs on boot.

## Tool & Library Notes
- [2026-06-19] pnpm ≥10 blocks dependency build scripts by default; pnpm 11 replaced `onlyBuiltDependencies` with an `allowBuilds` map (`name: true|false`) — run `pnpm approve-builds` (needed for esbuild/ssh2/cpu-features/protobufjs); `server/pnpm-workspace.yaml`.

## Recurring Errors & Fixes
- Migrations are NOT applied on boot — first-run `relation ... does not exist` = run `pnpm db:migrate`.
- [2026-06-19] On a repo path containing spaces, the `file://${process.argv[1]}` entrypoint guard never equals `import.meta.url` (which percent-encodes spaces), so `pnpm db:migrate`/`db:seed` exit 0 doing nothing; use `pathToFileURL(process.argv[1]).href`; `server/src/db/migrate.ts` + `seed.ts`.
