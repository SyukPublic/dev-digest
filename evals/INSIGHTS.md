# evals — INSIGHTS

> Running log of gotchas, debugging discoveries, and "why it's like this" decisions.
> Append as you learn. Keep entries short; link code with `path:line`.

## What Doesn't Work
- [2026-07-08] `skill-quality.ts` must NOT strict-YAML-parse SKILL.md frontmatter: gray-matter's default js-yaml 3.15.0 throws on an unquoted `description` with `: ` (e.g. "Trigger terms: x") — valid for Claude Code — and an unguarded `matter()` lets one such file abort the whole gate. Shipped fix: a tolerant `key: value` engine (`tolerantYaml`) + per-skill `try/catch`, plus `internalLinks` strips code spans so backtick'd example links aren't checked as real refs, plus a soft-WARN on unquoted-`: ` descriptions; `evals/src/skill-quality.ts` (tolerantYaml, internalLinks, evaluate).

- [2026-07-08] A plain `tsx` probe/CLI must import runtime pieces (`runClaude`, etc.) from their submodule (e.g. `evals/src/runtime/run-claude.js`), NOT from the barrel `evals/src/index.js`: the barrel re-exports the case DSL, which imports `vitest`, and importing vitest outside its runner throws `Error: Vitest failed to access its internal state`. The barrel is only for `*.eval.ts` files run under vitest; `evals/src/index.ts`.

## Tool & Library Notes
- [2026-07-08] Under pnpm 11.7 the `pnpm` field in `evals/package.json` is IGNORED (prints a WARN on every command) — build-script approval moved to `allowBuilds: {esbuild: true}` in the gitignored `evals/pnpm-workspace.yaml`. But esbuild needs no build here at all: it runs via the `@esbuild/win32-x64` platform optional-dep, so `tsx`/`vitest` work even with no approved build; `evals/pnpm-workspace.yaml`.
