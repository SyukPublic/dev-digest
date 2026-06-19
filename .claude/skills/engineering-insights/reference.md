# engineering-insights — reference

Detail for the [SKILL.md](./SKILL.md): the section rubric, record format, routing, and the
prune procedure. Read this before running a prune.

## Section rubric (7 sections, created lazily)

Entries live under section headers. The **section is the category** — don't repeat it in the
bullet. Only add a header once it has a real entry (no empty scaffolding). Canonical order:

| Section | What goes here | 4-category map |
|---|---|---|
| **What Works** | Approaches/patterns proven effective here | Patterns / Decisions |
| **What Doesn't Work** | Dead ends, antipatterns, traps to avoid | Mistakes |
| **Codebase Patterns** | Project conventions, architecture & naming decisions (the "why") | Patterns / Decisions |
| **Tool & Library Notes** | Dependency quirks, version-specific behavior, config landmines | Context |
| **Recurring Errors & Fixes** | Errors seen more than once + their verified fix/root cause | Mistakes |
| **Session Notes** | Dated one-line "what this session accomplished" summaries | Context |
| **Open Questions** | Unresolved, needs more investigation | Context |

The four research categories (Patterns / Mistakes / Decisions / Context) collapse into these
seven — use the table to place an entry. When in doubt between two sections, pick the one a
future reader would search first.

**Session Notes exception:** this section may use dated `### YYYY-MM-DD` subsections with a 1–2
sentence summary (per the source guide) instead of a single bullet — better for chronological
recaps.

### Coexistence with the existing flat bullets

The four files began as a flat bullet log under the header blockquote. Migration sorts those
bullets under the sections above **without rewording them**. Always keep the existing
`# <pkg> — INSIGHTS` title and the `> Running log…` blockquote verbatim.

## Record format

```
- [YYYY-MM-DD] <actionable gist — what to do / avoid / know>; `path` (symbol)
```

- **Dated** (today's date for new entries; older migrated bullets may stay undated).
- **Evidence**: prefer a **stable** anchor — `` `path` `` + symbol/function name — over a raw
  line number (lines drift and go stale). `` `path:line` `` is acceptable but treat the line as
  approximate. Architectural/full-file notes may omit code refs.
- **Actionable cold**: a reader who wasn't in the session must know exactly what to do.

### Anti-banality — before/after

The gate: *"If this were obvious to anyone reading the code, don't write it."* Reject three
failure modes — too generic, too specific/non-transferable, or longer than ~2 sentences.

- **Fails (generic):** `- error handling matters` — platitude, no action.
- **Fails (too specific):** `- fixed a bug on line 47` / `- renamed x to y` — changelog or impl
  detail, not a reusable lesson.
- **Passes:** ``- [2026-06-19] 4xx from the API is intentionally silent (handled inline as empty states); only network/5xx should toast; `client/src/lib/api.ts` (api wrapper) `` — specific, tells you what to do and why.

## Routing table (paths → file)

| Work touched | File |
|---|---|
| `server/**`, incl. `server/src/modules/**`, `repo-intel`, `server/src/vendor/shared` | `server/INSIGHTS.md` |
| `client/**` | `client/INSIGHTS.md` |
| `reviewer-core/**` | `reviewer-core/INSIGHTS.md` |
| `e2e/**` | `e2e/INSIGHTS.md` |

- **repo-intel roll-up:** it's a module inside `server/`, not its own package → `server/INSIGHTS.md`.
- **Multi-package change:** route to the single **primary** package. Never write the same
  insight to two files — cross-file duplication is the #1 thing prune has to undo.
- **No root `INSIGHTS.md`:** the convention is strictly per-package.

## Prune procedure (Review mode)

The log is a **draft under review**: an LLM can summarize wrongly, so prune is judgment-driven
and ends with a human confirmation. Run per file (or across all four on the monthly pass).

1. **Dedup.** Merge entries with the same gist into one; keep the **earliest** date; combine
   their `path:line` refs. Remove the redundant copies.
2. **Resolve conflicts.** When two entries contradict (one says "always X", another "X fails
   here"), open the cited `path:line` and check **live code** — whatever the code actually does
   wins. Keep the true entry; mark the outdated one with a dated correction note rather than
   deleting it silently, e.g. `- [2026-06-19] CORRECTION of the 2026-05-01 note: …`.
3. **Flag staleness — two kinds.** (a) the referenced `path`/symbol no longer exists → the code
   it described is gone; (b) the guidance is now outdated even though the path still resolves
   (a dependency upgrade changed the behavior, a pattern was refactored) → misleading, worse
   than missing. Flag both for removal/update.
4. **Size cap.** If a file passes ~**200 entries** (or one section dwarfs the rest), propose a
   **domain split** (e.g. `server/INSIGHTS.md` → keep + `server/INSIGHTS.repo-intel.md`) and
   wire the new file into the package `CLAUDE.md`. **Log what was dropped/moved** — never
   silently truncate.
5. **Resolve Open Questions.** Move any since-answered Open Question out of that section — into
   the matching section as a settled entry, or delete it if moot.
6. **Banality pass.** Re-apply the anti-banality gate to surviving entries; sharpen or drop
   platitudes that crept in.
7. **Confirm.** Present a concise summary/diff of proposed dedups, corrections, removals, splits,
   and resolved questions. Apply only after the user confirms.

## Team mode (optional)

These files are committed, so when shared across a team:
- **Append-only in PRs** — add entries, never edit others'; consolidation happens only in prune.
- **One maintainer prunes** — a designated person dedups/consolidates, not everyone.
- **Agree on entry format** — especially Codebase Patterns; inconsistent terminology across
  contributors confuses the agent that later reads them.

## Cadence

- **Capture:** every qualifying session (a real, non-obvious discovery) + a wrap-up sweep.
- **Prune:** monthly per file (project rule; the source guide suggests quarterly — monthly
  chosen here), or whenever a file feels noisy / passes the size cap.
