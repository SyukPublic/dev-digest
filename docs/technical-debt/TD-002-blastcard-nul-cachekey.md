# TD-002 — literal NUL byte (`\x00`) as cacheKey separator in `buildMermaid`

| | |
|---|---|
| **Area** | `client/` — Blast Radius panel graph builder |
| **Severity** | LOW (functionally harmless; tooling / file-hygiene hazard) |
| **Status** | `paid` (2026-07-02) — see [Resolution](#resolution-paid-2026-07-02) |
| **Surfaced by** | `architecture-reviewer` during the blast-radius UI-polish pass; ripgrep misdetecting the file as binary |
| **Detected on** | branch `labs/l04`, 2026-06-30 — **pre-existing** (present in `HEAD`, carried forward unchanged) |
| **Owning skill** | `react-frontend-architecture` (frontend) / general code hygiene |

## Summary

`buildMermaid`'s `node()` helper de-duplicates graph nodes with a `Map` keyed by
`` `${groupKey}\x00${label}` `` — the separator is a literal **NUL control byte**
(`\x00`), not a printable character (it *looks* like a space in most editors).

Confirmed it is **pre-existing**, not introduced by the UI-polish pass: exactly one
NUL byte in BOTH `HEAD` and the working tree —
`git show HEAD:<file> | tr -cd '\000' | wc -c` → `1`, and the same on the working
tree → `1`. The Phase-2 edit to `node()` (adding the `:::class` suffix) preserved
that line verbatim.

- Evidence: [client/src/app/repos/[repoId]/pulls/[number]/_components/BlastCard/BlastCard.tsx](../../client/src/app/repos/[repoId]/pulls/[number]/_components/BlastCard/BlastCard.tsx#L432)
  — `` const cacheKey = `${groupKey}\x00${label}`; `` (the `\x00` is the actual byte on disk).

## Why it's tolerable (for now)

- **No runtime / behavioral impact.** NUL is a unique, collision-resistant
  separator; it lives ONLY inside an in-memory `Map` key and never reaches the DOM
  or the Mermaid diagram source (which is separately escaped via
  `escapeMermaidLabel`). The graph renders identically with any other separator.
- It predates this work, so it is surfaced debt, not a regression of the pass that
  found it. Fixing it inside a presentational pass would be scope creep.

## Risk if left unaddressed

- **Low, but real for tooling.** A control byte in source makes ripgrep treat the
  file as **binary** — so `Grep` / CI text scans (and the `engineering-insights`
  read-before-write grep) silently **skip** it. It can also trip some
  editors/linters/diff tools, and it is invisible in code review.

## Paydown options (when a trigger fires)

- Replace the NUL with a printable, label-safe delimiter the `groupKey` can never
  contain — `groupKey` ∈ {`sym`, `caller`, `ep`, `cron`}, so `` `${groupKey}|${label}` ``
  or `` `${groupKey}\t${label}` `` are safe. One-line change in `buildMermaid`
  (`node`); restores ripgrep / CI text-scanning over the file. No behavioral change
  (the key is internal), so no test impact.

## Triggers to re-evaluate

- The next substantive edit to `buildMermaid` / `BlastCard.tsx`.
- Any time ripgrep / CI text-scanning of this file matters (e.g. a security or
  convention sweep that must not skip it).

## Resolution (paid 2026-07-02)

Paid down per [spec](../specs/td-001-td-002-hygiene-paydown.md). The NUL byte in
`buildMermaid`'s `node()` cacheKey was replaced with a printable pipe (`|`):
`` const cacheKey = `${groupKey}|${label}`; `` ([BlastCard.tsx](../../client/src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/BlastCard/BlastCard.tsx)).
`groupKey ∈ {sym, caller, ep, cron}` is pipe-free, so `|` is collision-safe; the key
stays internal to the in-memory `idFor` Map and never reaches the Mermaid source
(only `escapeMermaidLabel(label)` does) → **zero behavioral change**. The file is
text-scannable again (ripgrep no longer flags it binary; the client suite stayed
green). Verify NUL-freeness with a byte-level tool (`tr -cd '\000' < file | wc -c`
→ 0) — NOT `grep -c $'\x00'`, which returns a false count on Git-Bash (empty pattern
matches every line).
