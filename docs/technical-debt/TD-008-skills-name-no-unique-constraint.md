# TD-008 — No unique constraint on `skills.name` → silent duplicate skills

| | |
|---|---|
| **Area** | `server/` (schema) + `client/` (per-category skill generation) |
| **Severity** | LOW (duplicate rows; no data corruption) |
| **Status** | `accepted` |
| **Surfaced by** | INSIGHTS ([client/INSIGHTS.md](../../client/INSIGHTS.md) 2026-06-24) |
| **Detected on** | branch `labs/l04`, recorded 2026-07-02 |
| **Owning skill** | `drizzle-orm-patterns` / `postgresql-table-design` (schema) |

## Summary

The `skills` table declares `name` as `text('name').notNull()` with **no unique
constraint and no unique index**
([db/schema/skills.ts:5-21](../../server/src/db/schema/skills.ts#L5-L21)). The
per-category skill generation flow creates a skill **per category by looping
`POST /skills` client-side** — `for (const plan of plans) { await
create.mutateAsync(...) }`
([CreateSkillFromConventionsModal.tsx:89-91](../../client/src/app/conventions/_components/CreateSkillFromConventionsModal/CreateSkillFromConventionsModal.tsx#L89-L91)).

So re-running generation on the same repo **silently creates DUPLICATE skills**
(same name, new rows). This is **accepted / out-of-scope** by the multi-skill plan
(server-side atomicity + 409 uniqueness deferred), NOT a bug — per INSIGHTS
2026-06-24, do **not** try to "fix" it client-side; de-dup belongs in a future
server bulk route.

## Why it's accepted (for now)

- A deliberate scope cut of the multi-skill plan: server-side bulk atomicity and
  409-on-duplicate were deferred to a future bulk endpoint.
- Duplicates are recoverable (a user can delete extra skills); no data corruption,
  no cross-tenant leak (rows are `workspace_id`-scoped).

## Risk if left unaddressed

- **Low.** Repeated per-category generation clutters the skills list with dupes;
  a user may unknowingly enable/link two copies of the "same" skill. Annoyance,
  not a correctness or security issue.

## Paydown options (when a trigger fires)

- Add a **server bulk route** for skill generation with de-dup (upsert by
  normalized name within the workspace) and a `409` on conflict — the client loop
  is replaced by one call. Optionally back it with a unique index on
  `(workspace_id, name)` once naming is guaranteed stable.

## Triggers to re-evaluate

- Users report duplicate-skill clutter after re-generating.
- The multi-skill / bulk-generation server route is picked up.
- Any migration touching the `skills` table (add the unique index then).
