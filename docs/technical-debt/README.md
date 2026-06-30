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
