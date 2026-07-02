# TD-001 — `no-circular` dependency-cruiser warnings (6)

| | |
|---|---|
| **Area** | `server/` (composition root + two modules) and `reviewer-core/` |
| **Severity** | LOW–MEDIUM (5 of 6 have **no runtime cycle**; see breakdown) |
| **Status** | `paid` (2026-07-02) — see [Resolution](#resolution-paid-2026-07-02) |
| **Surfaced by** | `pnpm arch:check` → `depcruise src --config .dependency-cruiser.cjs` |
| **Detected on** | commit `72c620e` (branch `labs/l04`), 2026-06-30 |
| **Owning skill** | `onion-architecture` (rule 9 — enforce boundaries mechanically) |

## Summary

`pnpm arch:check` reports **6 `no-circular` warnings (0 errors)**, so the
architecture gate stays **green**. The `no-circular` rule is deliberately
`severity: 'warn'` (not `error`) in
[server/.dependency-cruiser.cjs](../../server/.dependency-cruiser.cjs) — its own
`comment` documents the reason: the hand-rolled DI **composition root passes the
whole `Container` into services while it also constructs some of them**
(e.g. `RepoIntelService`), an *intentional* composition-root cycle. Warnings exist
so a **new, accidental** cycle gets reviewed rather than slipping in unnoticed.

**Key nuance:** depcruise runs with `tsPreCompilationDeps: true`, so it counts
**type-only** (`import type`) edges in the graph. **5 of the 6 cycles** are closed
by a `import type` back-edge that TypeScript **erases at compile time → there is no
runtime cycle**. Only the `reviewer-core` cycle (C below) is a genuine value-level
runtime cycle.

## The 6 cycles

### A. Composition-root DI cycles — `repo-intel` (4 warnings) — *type-only back-edge*

```
src/modules/repo-intel/service.ts → src/platform/container.ts → (back to service.ts)
src/modules/repo-intel/pipeline/incremental.ts → container.ts → service.ts → (back to incremental.ts)
src/modules/repo-intel/pipeline/incremental.ts → pipeline/full.ts → container.ts → service.ts → (back to incremental.ts)
src/modules/repo-intel/pipeline/full.ts → container.ts → service.ts → (back to full.ts)
```

- Forward (value) edge: `platform/container.ts` `import { RepoIntelService }` to
  **construct** it in the composition root
  ([container.ts:31](../../server/src/platform/container.ts#L31)).
- Back edges are all **type-only**, erased at runtime:
  - [repo-intel/service.ts:21](../../server/src/modules/repo-intel/service.ts#L21) — `import type { Container }`
  - [pipeline/full.ts:27](../../server/src/modules/repo-intel/pipeline/full.ts#L27) — `import type { Container }`
  - [pipeline/incremental.ts:20](../../server/src/modules/repo-intel/pipeline/incremental.ts#L20) — `import type { Container }`

This is exactly the intentional composition-root cycle the rule `comment` describes.

### B. `agents` `helpers` ↔ `repository` (1 warning) — *type-only back-edge*

```
src/modules/agents/helpers.ts → src/modules/agents/repository.ts → (back to helpers.ts)
```

- Forward (value) edge: [agents/repository.ts:6](../../server/src/modules/agents/repository.ts#L6) — `import { isConfigChange } from './helpers.js'`.
- Back edge is **type-only**: [agents/helpers.ts:3](../../server/src/modules/agents/helpers.ts#L3) — `import type { AgentRow, AgentVersionRow } from './repository.js'`.

Row types live next to the repository; the pure helper imports those types only.
Erased at runtime → no runtime cycle.

### C. `reviewer-core` `prompt` ↔ `classify-prompt` (1 warning) — **REAL runtime cycle**

```
../reviewer-core/src/intent/classify-prompt.ts → ../reviewer-core/src/prompt.ts → (back to classify-prompt.ts)
```

- [intent/classify-prompt.ts:3](../../reviewer-core/src/intent/classify-prompt.ts#L3) — `import { wrapUntrusted } from '../prompt.js'` (**value**).
- [prompt.ts:2](../../reviewer-core/src/prompt.ts#L2) — `import { INTENT_RULE } from './intent/classify-prompt.js'` (**value**).

Both edges are **value** imports → a genuine module-load cycle. Blast radius is
small (two co-located pure prompt modules sharing a constant + a helper, no I/O,
no class init), but it is the only cycle here that exists at runtime.

## Why it's accepted (for now)

- The gate is **green** (`warn`, 0 errors) — this is surfaced debt, not a failing build.
- Cycles A & B are **type-only**: zero runtime coupling, no module-init ordering
  hazard. They are an artifact of `tsPreCompilationDeps: true` + the
  DI-by-`Container`-handle pattern, which is a deliberate design choice.
- Cycle C is a real but tiny, side-effect-free cycle between two pure modules.
- Removing them now is churn with little payoff and some risk (see options).

## Risk if left unaddressed

- **Low** for A & B — no runtime effect; the only cost is depcruise noise that can
  mask a *new* accidental cycle (mitigated: warnings are reviewed, not silenced).
- **Low–medium** for C — mutual value imports can bite if either module grows
  top-level side effects or const initialisation that depends on the other's
  load order. Today both are inert constants/functions, so it is benign.

## Paydown options (when a trigger fires)

- **A & B (type-only):** either (a) configure depcruise to ignore type-only edges
  for `no-circular` (e.g. exclude `import type` via rule options / a
  `dependency-cruiser` type-only filter) so only *runtime* cycles warn, or
  (b) move the shared types to a leaf (`repo-intel/types.ts` already exists;
  agents row types could move to `db/rows.ts`, which the config comment already
  treats as the canonical home for row types).
- **C (real cycle):** extract the shared `INTENT_RULE` constant (and/or
  `wrapUntrusted`) into a small leaf module (e.g. `reviewer-core/src/intent/rule.ts`
  or a `prompt-shared.ts`) that both `prompt.ts` and `classify-prompt.ts` import,
  breaking the mutual edge. Keeps `reviewer-core` pure.

## Triggers to re-evaluate / promote `no-circular` to `error`

- A **new** `no-circular` warning appears that is **not** one of these 6.
- The DI composition root is inverted (services no longer take the whole
  `Container`) — at that point the A/B cycles disappear and the rule can be
  promoted to `error` (the config comment explicitly anticipates this).
- Cycle C's modules gain runtime side effects at import time.

## Resolution (paid 2026-07-02)

Paid down per [spec](../specs/td-001-td-002-hygiene-paydown.md) (zero behavioral
change; `pnpm arch:check` green — **0 violations**, `no-circular` now `error`).

- **Cycle C (real value cycle) — fixed structurally.** Extracted the shared pure
  `wrapUntrusted` (the more-widely-imported symbol — 5 importers) into a new
  zero-import leaf `reviewer-core/src/prompt-shared.ts`; `INTENT_RULE` stayed in
  `classify-prompt.ts`. `prompt.ts`'s `INTENT_RULE` import is now one-way → cycle
  gone, `reviewer-core` purity intact.
- **Cycle B (agents, type-only) — fixed structurally.** `agents/helpers.ts` now
  imports `AgentRow`/`AgentVersionRow` from the canonical `db/rows.ts` instead of the
  sibling `repository.ts`, removing the `helpers → repository` back-edge at its source.
- **Cycles A (DI composition-root, type-only) — excluded by path.** The
  register's original paydown option "(a) configure depcruise to ignore type-only
  edges" was **empirically REFUTED**: `dependencyTypesNot: ['type-only']` does NOT
  suppress these (measured 6→6 on dependency-cruiser 17.4.3) — it filters the cycle's
  *anchor* edge, and each cycle simply re-anchors onto its value edge (the
  `container.ts → service.ts` construction edge). The working mechanism is
  `viaOnly: { pathNot: 'src/platform/container\\.ts' }` on the `no-circular` rule,
  which excludes only cycles ROUTED THROUGH the composition root. The intentional
  DI back-edges (`import type { Container }`) remain VISIBLE in code — only the gate
  ignores them.
- **`no-circular` promoted `warn → error`.** After B/C were fixed structurally and A
  excluded by path, the unfiltered set was exactly the **4 container-routed DI cycles
  → 0** after exclusion, so the stricter gate cannot false-fail the build and now
  blocks any NEW runtime cycle outside the composition root.
- **Residual trade-off (accepted):** a future *value* cycle routed through
  `src/platform/container.ts` would be excluded by `viaOnly.pathNot` and not caught —
  acceptable because that path is the documented intentional-cycle zone; any accidental
  cycle elsewhere still errors. Documented in the rule comment.
