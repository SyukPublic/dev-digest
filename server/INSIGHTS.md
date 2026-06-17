# server — INSIGHTS

> Running log of gotchas, debugging discoveries, and "why it's like this" decisions.
> Append as you learn. Keep entries short; link code with `path:line`.

- Migrations are NOT applied on boot — first-run `relation ... does not exist` = run `pnpm db:migrate`.
- DB-backed tests must use the `*.it.test.ts` suffix or the unit/integration split breaks.
- Secrets are read only through `LocalSecretsProvider` (`~/.devdigest/secrets.json`, 0600);
  `GITHUB_TOKEN` is canonical, `GITHUB_PAT` is an accepted fallback.
- The engine reaps orphaned `running` runs on boot.
