# Technical Debt Register — DevDigest

> A living list of **known, consciously-accepted** technical debt: deliberate
> compromises, tolerated smells, and deferred cleanups. Each item gets its own
> `TD-NNN-<slug>.md` detail file; this page is the index.
>
> This is **not** a bug tracker (use issues/PRs for defects) and **not**
> architecture documentation (see [`../`](../) and the `onion-architecture` skill).
> It records debt we have chosen to carry, *why* it is tolerable, and *what* would
> trigger paying it down.

## How to use

- To add an item: append a row to the register and create a `TD-NNN-<slug>.md`
  detail file (copy the shape of an existing one). Use the next free `TD-NNN`.
- **Status** — one of:
  - `accepted` — we carry it deliberately; no action planned.
  - `watch` — tolerated, but re-evaluate when a listed trigger fires.
  - `planned` — a cleanup is scheduled/agreed.
  - `paid` — resolved; keep the row for history, mark the date.
- **Severity** — align with the owning skill's levels where one applies
  (e.g. `onion-architecture`: CRITICAL / HIGH / MEDIUM).
- Ground every claim in code/config (cite paths + lines), never from memory.

## Register

| ID | Title | Area | Severity | Status | Trigger to pay down |
|----|-------|------|----------|--------|---------------------|
| [TD-001](./TD-001-circular-dependencies.md) | `no-circular` dependency-cruiser warnings (6) | `server/` (composition root) + `reviewer-core/` | LOW–MEDIUM | `accepted` | A *new* accidental cycle appears, or the DI composition root is inverted |
| [TD-002](./TD-002-blastcard-nul-cachekey.md) | Literal NUL byte (`\x00`) as `buildMermaid` cacheKey separator | `client/` (Blast Radius panel) | LOW | `watch` | Next edit to `buildMermaid` / `BlastCard.tsx`, or when ripgrep/CI text-scan of the file matters |
| [TD-003](./TD-003-blast-no-pr-vs-index-freshness.md) | Blast has no PR-vs-index freshness signal (confident-wrong "0 downstream") | `server/` (repo-intel + blast) | MEDIUM | `paid` (2026-07-02) | ~~A wrong "no impact" is reported, blast becomes a gating signal, or per-PR indexing lands~~ — paid via freshness signal ([spec](../specs/blast-index-freshness.md), commit `62269f6`) |
| [TD-004](./TD-004-blast-max-callers-global-cap.md) | `MAX_CALLERS_PER_SYMBOL` applied globally, not per-symbol | `server/` (repo-intel blast) | LOW | `planned` | Panel presents per-symbol callers, or missing callers reported on a multi-symbol PR — cleanup agreed/implemented via [spec](../specs/blast-per-symbol-caller-cap.md) |
| [TD-005](./TD-005-index-soft-budget-scope.md) | `INDEX_SOFT_BUDGET_MS` gates only the enqueue loop, not parse+graph | `server/` (repo-intel index pipeline) | LOW–MEDIUM | `watch` | A repo overruns the parse/graph phase within the hard cap, or `runFullIndex` timing changes |
| [TD-006](./TD-006-regex-extractor-vs-tree-sitter.md) | Regex symbol/reference extractor instead of tree-sitter | `server/` (repo-intel extraction) | LOW–MEDIUM | `accepted` | Blast precision becomes a requirement, or installs (tree-sitter grammar) are permitted |
| [TD-007](./TD-007-walk-ignores-gitignore.md) | repo-intel file walk does not honor `.gitignore` | `server/` (repo-intel walk) | LOW | `accepted` | Ignored files materially pollute the index, or `ignore`/`git ls-files` is adopted |
| [TD-008](./TD-008-skills-name-no-unique-constraint.md) | No unique constraint on `skills.name` → silent duplicate skills | `server/` (schema) + `client/` (per-category gen) | LOW | `accepted` | Duplicate-skill clutter reported, or the bulk-generation server route is picked up |
| [TD-009](./TD-009-blast-truncation-marker.md) | Blast per-symbol cap trims silently — no "showing top N callers" marker | `server/` (repo-intel blast) + `client/` (BlastCard) | LOW | `accepted` | A user asks "why only 20 callers?", or the marker becomes a requirement |
