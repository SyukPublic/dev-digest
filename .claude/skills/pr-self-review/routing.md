# pr-self-review — surface → skill routing

How `pr-self-review` maps a changed file to the skill(s) that should review it. Classify **every**
changed file from `git diff main...HEAD --name-only`, then run each owning skill scoped to that
surface's files. A file can match several rows — run every lens that applies (e.g. a route is both
*layering* and *Fastify mechanics*).

## Routing table

| # | Surface | Matches (glob, first match wins for the primary lens) | Skills to invoke |
|---|---|---|---|
| 1 | **Frontend / UI** | `client/**/*.{ts,tsx,js,jsx,css}` | `react-frontend-architecture` (placement/structure) + `react-best-practices` (component/hook correctness) + `next-best-practices` (App Router / RSC / metadata) |
| 2 | **UI tests** | `client/**/*.{test,spec}.{ts,tsx}` | `react-testing-library` |
| 3 | **Backend layering** | `server/src/modules/**`, `server/src/adapters/**`, `server/src/platform/**`, `reviewer-core/src/**` | `onion-architecture` |
| 4 | **Backend routes/plugins** | `server/src/modules/**/routes.ts`, `server/src/app.ts`, `server/src/**/plugins/**` | `fastify-best-practices` (+ `onion-architecture` rule 6: thin edge) |
| 5 | **DB access / schema** | `server/src/modules/**/repository*.ts`, `server/src/modules/**/repository/**`, `server/src/db/**` | `drizzle-orm-patterns` (+ `postgresql-table-design` when `db/schema/**` changes) |
| 6 | **Contracts / validation** | `server/src/vendor/shared/**`, `**/contracts/**`, files defining `z.object` | `zod` (+ `onion-architecture` rule 8: cross-package direction) |
| 7 | **Cross-cutting (any surface)** | auth, input handling, file upload, secrets, headers — in any file above | `security` |

## Notes & precedence

- **`reviewer-core/src/**` is BACKEND**, not frontend — route it to `onion-architecture` (rule 1:
  core stays pure). Never send it to the React lenses.
- **`client/**` never goes to backend lenses**, and `server/**` never to frontend lenses — the
  whole point of the split is that a UI file is judged by UI rules and a backend file by backend
  rules.
- **Tests** (row 2) are reviewed *in addition to* their feature surface, not instead of it.
- **`server/src/vendor/shared/**`** is the contract center: it imports nothing runtime
  (`onion-architecture` rule 8) and is the single source of truth for shapes (`zod`). Both lenses
  apply.
- **`typescript-expert`** is an optional escalation lens — pull it in only when a change leans on
  non-trivial type-level code (generics, conditional/mapped types, declaration files), regardless
  of surface.
- **Non-code surfaces** — `*.md`, `*.json` config, lockfiles, CI yaml — match no row. If a diff
  touches *only* these, Phase 1 yields no findings and the gate passes (see SKILL.md edge cases).

## Why route at all (instead of "review everything with everything")

Each skill is an expert in its surface and explicitly defers mechanics to its siblings (see the
"Sibling skills" notes in `onion-architecture` and `react-frontend-architecture`). Routing keeps
each lens focused on files it actually understands, avoids cross-surface noise (React rules firing
on a Drizzle repository), and keeps the review fast and legible.
