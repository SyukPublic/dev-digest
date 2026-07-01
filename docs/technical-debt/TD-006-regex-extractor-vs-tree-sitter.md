# TD-006 — Regex symbol/reference extractor instead of tree-sitter

| | |
|---|---|
| **Area** | `server/` — repo-intel extraction (blast accuracy) |
| **Severity** | LOW–MEDIUM (approximate parse → approximate blast) |
| **Status** | `accepted` |
| **Surfaced by** | In-code `TODO` ([lib/extract.ts:4](../../server/src/lib/extract.ts#L4)) |
| **Detected on** | branch `labs/l04`, recorded 2026-07-02 |
| **Owning skill** | `onion-architecture` (backend) / repo-intel domain |

## Summary

The symbol/reference extractor that feeds blast-radius is a **regex-based** parser
for TS/JS, not an AST parser. Its design note records the deliberate choice: the F1
scaffolding left a `TODO` to wire `web-tree-sitter` for accurate blast-radius, but
"under the parallel-phase rules we MUST NOT run installs, and `web-tree-sitter`
additionally needs grammar files"
([lib/extract.ts:4-6](../../server/src/lib/extract.ts#L4-L6)).

A regex extractor approximates symbol boundaries and references, so the resulting
symbol table + reference edges (and therefore the blast map) are best-effort, not
exact.

## Why it's accepted (for now)

- A hard constraint at the time (no installs during parallel phases; tree-sitter
  needs a grammar asset), not just a preference.
- The regex extractor is good enough for the advisory blast map (see
  [TD-003](./TD-003-blast-no-pr-vs-index-freshness.md)); blast never gates.
- Note: the astgrep adapter (`container.astGrep`) already backs the main index
  parse; this TD is specifically about the `lib/extract.ts` regex path and the
  accuracy ceiling it sets.

## Risk if left unaddressed

- **Low–medium.** Missed or mis-attributed symbols/references silently degrade
  blast precision (false-negative callers, wrong enclosing symbol). It compounds
  with TD-003 (already-imprecise blast), but has no runtime/crash impact.

## Paydown options (when a trigger fires)

- Wire `web-tree-sitter` (or the existing ast-grep path more fully) for accurate
  extraction once installs are permitted and the grammar assets can ship —
  replacing the regex heuristics behind the same extractor interface.

## Triggers to re-evaluate

- Blast precision becomes a product requirement (e.g. blast gates severity).
- A dependency-install step is permitted and the tree-sitter grammar can be
  vendored.
- Recurring reports of missing/incorrect callers traceable to parse inaccuracy.
