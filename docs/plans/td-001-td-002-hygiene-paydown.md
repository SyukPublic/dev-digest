# Development Plan: Pay down TD-001 (`no-circular` warnings) + TD-002 (`\x00` cacheKey separator)

## Context

Two accepted technical-debt items are now due for paydown; both are **hygiene /
structure** refactors with **no intended behavioral change**.

**TD-001 — `no-circular` dependency-cruiser warnings (6 warnings, 0 errors; gate
stays green).** `pnpm arch:check` (`depcruise src --config .dependency-cruiser.cjs`,
[server/package.json:11](../../server/package.json#L11)) reports 6 `no-circular`
warnings. The rule is deliberately `severity: 'warn'`, and its own comment names
the intentional composition-root cycle and explicitly anticipates promotion to
`error` "if the DI is ever inverted"
([.dependency-cruiser.cjs:74-84](../../server/.dependency-cruiser.cjs#L74)).
`tsPreCompilationDeps: true` ([:88](../../server/.dependency-cruiser.cjs#L88)) means
type-only (`import type`) edges are counted, so **5 of 6 cycles have NO runtime
cycle** — only reviewer-core's is a genuine value-level module-load cycle. **Note
(empirically established, D2):** although those 5 cycles *close* through an
`import type` back-edge, each also contains a value edge (the DI root constructs
the service; the agents repository imports a value helper), so a naive "ignore
type-only edges" filter does NOT suppress them — dependency-cruiser just re-anchors
the cycle onto its value edge. Full problem statement:
[docs/technical-debt/TD-001-circular-dependencies.md](../technical-debt/TD-001-circular-dependencies.md).

**TD-002 — literal NUL byte (`\x00`) as `buildMermaid` cacheKey separator.** Inside
`buildMermaid`'s `node()` helper, the de-dup `Map` key is
`` `${groupKey}\x00${label}` `` — the char that renders as a space is a NUL control
byte on disk ([BlastCard.tsx:511](../../client/src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/BlastCard/BlastCard.tsx#L511)).
It is functionally harmless (the key lives ONLY in the in-memory `idFor`
`Map<string,string>` at [:502](../../client/src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/BlastCard/BlastCard.tsx#L502);
labels are separately escaped via `escapeMermaidLabel`
[:474,518](../../client/src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/BlastCard/BlastCard.tsx#L474)
before reaching Mermaid — the separator never reaches the DOM/diagram). But the NUL
byte makes **ripgrep treat the file as binary**, so `Grep` / CI text scans / the
`engineering-insights` read-before-write grep silently **skip** it (confirmed: this
plan's own `Grep` for `escapeMermaidLabel` in `BlastCard.tsx` returned *"binary file
matches (found "\0" byte around offset 19240)"* and found nothing — only
`grep --text` located the symbol at lines 474/518). Full problem statement:
[docs/technical-debt/TD-002-blastcard-nul-cachekey.md](../technical-debt/TD-002-blastcard-nul-cachekey.md).

Intended outcome: reviewer-core's real runtime cycle is broken (Group C, leaf
extraction); the agents type-only back-edge is removed at its source (Group B); the
intentional DI composition-root cycle is excluded from `no-circular` BY PATH (Group
A, `viaOnly.pathNot` — the empirically-verified mechanism, not edge-type filtering);
the NUL byte is replaced with a printable, label-safe separator so the file is
text-scannable again; and — once all three cycle-fixing slices land — `no-circular`
is promoted from `warn` to `error` so any NEW accidental cycle (outside the DI
composition root) fails the build (the config comment's stated end-state).

### Scope & non-goals

- **In scope:** (1) TD-002 one-line separator swap in `BlastCard.tsx`; (2) TD-001
  Group C — break reviewer-core's real value cycle by extracting a leaf module;
  (3) TD-001 Group B — remove the agents `helpers → repository` type-only back-edge
  at its source (relocate the row-type import to `db/rows.ts`); (4) TD-001 Group A —
  exclude the intentional DI composition-root cycle from `no-circular` by PATH
  (`viaOnly: { pathNot: 'src/platform/container\\.ts' }`, D2); (5) promote
  `no-circular` `warn → error` after 2–4 land (decision D5); (6) docs slice: mark
  TD-001 + TD-002 `paid` in the register + detail files and sweep INSIGHTS.
- **NO behavioral change anywhere.** Every slice is a structure/hygiene move; each
  phase states how behavior is preserved. No new feature, no contract change, no
  `@devdigest/shared` edit, no `scripts/sync-shared.mjs`.
- **NO schema / migration.** None of these surfaces touch the DB. No
  `pnpm db:generate` / `db:migrate`.
- **reviewer-core PURITY invariant preserved** (reviewer-core/AGENTS.md "The
  invariant"): the Group-C leaf module is a pure string helper — no DB / GitHub /
  fs / git / network. The only cross-package edges stay `server → reviewer-core →
  shared`.
- **The intentional composition-root cycle stays VISIBLE, not silenced.** Group A's
  fix (D2) excludes ONLY cycles that route through `src/platform/container.ts` (the
  documented composition-root cycle zone); the `import { RepoIntelService }` /
  `import type { Container }` edges still exist and are documented. A NEW runtime
  cycle that does NOT route through the DI root still warns/errors. (Residual
  trade-off — a future accidental cycle *through* `container.ts` is excluded — is a
  conscious decision, see D2/D5.)

## Affected packages & files

**client/** (TD-002 — Slice 1):
- `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastCard/BlastCard.tsx`
  — EDIT, one line. `buildMermaid` → `node()` → `cacheKey`
  ([:511](../../client/src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/BlastCard/BlastCard.tsx#L511)):
  replace the `\x00` byte with a printable delimiter (`|`, per D0). No other change.

**reviewer-core/** (TD-001 Group C — Slice 2):
- `reviewer-core/src/prompt-shared.ts` — **NEW leaf module**. Holds the moved
  `wrapUntrusted` (pure string helper, self-contained — [prompt.ts:31-35](../../reviewer-core/src/prompt.ts#L31)).
  No imports beyond the `@devdigest/shared` types it needs (it needs none today).
  This becomes the shared leaf BOTH `prompt.ts` and `classify-prompt.ts` (and the
  three other importers) depend on — breaking the mutual value edge (D1).
- `reviewer-core/src/prompt.ts` — EDIT. Remove the `wrapUntrusted` definition;
  `import { wrapUntrusted } from './prompt-shared.js'`. KEEP `import { INTENT_RULE }
  from './intent/classify-prompt.js'` (now a one-way edge → no cycle).
- `reviewer-core/src/intent/classify-prompt.ts` — EDIT, one import line
  ([:3](../../reviewer-core/src/intent/classify-prompt.ts#L3)): import
  `wrapUntrusted` from `'../prompt-shared.js'` instead of `'../prompt.js'`. This is
  the edge that closed the cycle; re-pointing it to the leaf breaks it.
- `reviewer-core/src/blast/blast-prompt.ts` ([:2](../../reviewer-core/src/blast/blast-prompt.ts#L2)),
  `reviewer-core/src/conventions/extract.ts` ([:8](../../reviewer-core/src/conventions/extract.ts#L8)),
  `reviewer-core/src/risks/risks-prompt.ts` ([:2](../../reviewer-core/src/risks/risks-prompt.ts#L2))
  — EDIT, one import line each: re-point `wrapUntrusted` from `'../prompt.js'` to
  `'../prompt-shared.js'`. (Not strictly required to break the cycle — only
  `classify-prompt.ts` closes it — but moving ALL importers to the leaf keeps the
  import graph clean and prevents `prompt.ts` from being pulled in transitively just
  for the helper. See D3.)
- `reviewer-core/src/index.ts` — EDIT. The public re-export of `wrapUntrusted`
  currently comes `from './prompt.js'` ([:15-21](../../reviewer-core/src/index.ts#L15));
  re-point that ONE named export to `'./prompt-shared.js'`. Public API surface is
  byte-identical (same name, same signature) — no consumer change.

**server/** (TD-001 Groups A & B — Slice 3):
- `server/.dependency-cruiser.cjs` — EDIT. The `no-circular` rule
  ([:74-84](../../server/.dependency-cruiser.cjs#L74)): add
  `viaOnly: { pathNot: 'src/platform/container\\.ts' }` (Group A fix, D2) so
  `no-circular` no longer reports cycles that route THROUGH the DI composition root
  — i.e. all 4 Group A DI cycles — while still catching cycles anywhere else.
  **This is the EMPIRICALLY VERIFIED mechanism** (dependency-cruiser 17.4.3,
  `pnpm exec depcruise src`): `viaOnly.pathNot` measured **6 → 2** warnings; the
  earlier `dependencyTypesNot: ['type-only']` idea was **REFUTED** (stayed **6 → 6**
  — it re-anchors each cycle onto its value edge; see D2/S3). Group A is NOT
  clearable by any structural code change — the DI back-edge is the composition-root
  pattern itself and cannot be relocated without inverting it (out of scope). The
  same edit also flips `severity: 'warn' → 'error'` (D5, gated on Slices 2 & the
  Group-B fix landing — see Phases).
- `server/src/modules/agents/helpers.ts` — EDIT, one import line
  ([:3](../../server/src/modules/agents/helpers.ts#L3)): import `AgentRow,
  AgentVersionRow` from `'../../db/rows.js'` (the canonical row-type home) instead of
  from `'./repository.js'`. This removes the `helpers → repository` back-edge at its
  SOURCE — and it is what **ACTUALLY clears Group B's warning** (the `viaOnly.pathNot`
  exclusion does NOT cover B: the agents cycle does not route through `container.ts`,
  so it is one of the 2 residual warnings after Group A is excluded). Near-zero-risk
  one-liner; makes the agents module graph honestly acyclic (D2).

**docs/** (bookkeeping — Slice 4):
- `docs/technical-debt/README.md` — EDIT rows 29 (TD-001) & 30 (TD-002) to `paid`.
- `docs/technical-debt/TD-001-circular-dependencies.md` — EDIT Status line + note
  which paydown option was taken per group + the `warn → error` promotion.
- `docs/technical-debt/TD-002-blastcard-nul-cachekey.md` — EDIT Status line + note
  the separator chosen.
- `server/INSIGHTS.md` + `reviewer-core/INSIGHTS.md` — APPEND durable lessons
  (append-only, read-before-write).

**Reuse (do NOT re-implement):**
- The canonical row-type home already exists and is already used: `db/rows.ts`
  exports `AgentRow`/`AgentVersionRow` ([:12-13](../../server/src/db/rows.ts#L12)),
  and `agents/repository.ts` ALREADY imports & re-exports them from there
  ([repository.ts:14-15](../../server/src/modules/agents/repository.ts#L14)). So
  Group B's fix is purely pointing `helpers.ts` at the same source the repository
  already uses — no new type, no moved definition.
- The `paid`-row markup pattern is already in the register for TD-003 & TD-004
  ([README.md:31-32](../technical-debt/README.md#L31)) — mirror it verbatim
  (strike-through the old trigger, append "paid via … ([spec](…), commit `…`)").
- `wrapUntrusted` is ALREADY a self-contained pure helper
  ([prompt.ts:31-35](../../reviewer-core/src/prompt.ts#L31)) — the extraction MOVES
  it verbatim; it is not rewritten.

## Shared scaffold (context pack)

> Verbatim excerpts + `file:line` citations so parallel implementers do not each
> re-open the sources. Phases reference these fragments by tag.

### S0 — TD-002 the one line (BlastCard.tsx:504-520, verbatim today)

The `node()` helper inside `buildMermaid` (the `\x00` renders as a space here):
```ts
  const node = (
    groupKey: "sym" | "caller" | "ep" | "cron",
    cls: string,
    label: string,
  ): string | null => {
    const cacheKey = `${groupKey}\x00${label}`;   // ← the NUL byte, line 511
    const existing = idFor.get(cacheKey);
    if (existing) return existing;
    // ...
    idFor.set(cacheKey, id);
    // ...
    lines.push(`  ${id}["${escapeMermaidLabel(label)}"]:::${cls}`);  // label escaped, NOT cacheKey
    return id;
  };
```
CHANGE (D0): `const cacheKey = \`${groupKey}|${label}\`;`. `groupKey` is the fixed
enum `"sym" | "caller" | "ep" | "cron"` ([:507](../../client/src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/BlastCard/BlastCard.tsx#L507))
— none of those contains `|`, so `|` is a collision-safe separator. The key is
internal (`idFor` `Map` only, [:502,512,516](../../client/src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/BlastCard/BlastCard.tsx#L502)),
never reaches Mermaid source (only `escapeMermaidLabel(label)` does, [:518](../../client/src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/BlastCard/BlastCard.tsx#L518))
→ zero behavioral / DOM / diagram change.

### S1 — Group C the cycle today (reviewer-core, value-level, verbatim)

```ts
// reviewer-core/src/prompt.ts:2  (VALUE import)
import { INTENT_RULE } from './intent/classify-prompt.js';
// ...prompt.ts:31-35 — the helper to MOVE (self-contained, no internal deps):
export function wrapUntrusted(label: string, content: string): string {
  const safe = content.replaceAll('</untrusted>', '<\\/untrusted>');
  return `<untrusted source="${label}">\n${safe}\n</untrusted>`;
}

// reviewer-core/src/intent/classify-prompt.ts:3  (VALUE import — closes the cycle)
import { wrapUntrusted } from '../prompt.js';
// ...classify-prompt.ts:147 — INTENT_RULE (stays here):
export const INTENT_RULE: string = 'Stay within the stated intent and scope. ...';
```
Both edges are **value** imports → a genuine module-load cycle
(`prompt.ts ⇄ classify-prompt.ts`). This is the ONE cycle here that
`viaOnly.pathNot` (Group A) does NOT touch and that a config filter can never
suppress — it must be broken structurally (Slice 2).

### S2 — Group C the fix: extract `wrapUntrusted` to a NEW leaf `prompt-shared.ts`

NEW `reviewer-core/src/prompt-shared.ts` (move the helper verbatim; add the module
doc-comment; NO other content — keeps it a true leaf):
```ts
/**
 * prompt-shared.ts — leaf helpers shared by the prompt builders.
 *
 * PURE (reviewer-core invariant): no I/O. Extracted here so prompt.ts and the
 * intent/blast/risks/conventions builders can share `wrapUntrusted` WITHOUT the
 * prompt.ts ⇄ intent/classify-prompt.ts value cycle (prompt.ts imports
 * INTENT_RULE from classify-prompt; classify-prompt needs wrapUntrusted — putting
 * the helper in a leaf makes the graph one-way). See TD-001 Group C.
 */
export function wrapUntrusted(label: string, content: string): string {
  const safe = content.replaceAll('</untrusted>', '<\\/untrusted>');
  return `<untrusted source="${label}">\n${safe}\n</untrusted>`;
}
```
Then re-point every importer of `wrapUntrusted`:

| File | line | old | new |
|---|---|---|---|
| `intent/classify-prompt.ts` | 3 | `from '../prompt.js'` | `from '../prompt-shared.js'` *(REQUIRED — this closes the cycle)* |
| `prompt.ts` | 31-35 → import | *defines it* | delete def; `import { wrapUntrusted } from './prompt-shared.js'` |
| `blast/blast-prompt.ts` | 2 | `from '../prompt.js'` | `from '../prompt-shared.js'` |
| `conventions/extract.ts` | 8 | `from '../prompt.js'` | `from '../prompt-shared.js'` |
| `risks/risks-prompt.ts` | 2 | `from '../prompt.js'` | `from '../prompt-shared.js'` |
| `index.ts` | 15-21 | `wrapUntrusted … from './prompt.js'` | move the `wrapUntrusted` name to a re-export `from './prompt-shared.js'` |

`prompt.ts` KEEPS `import { INTENT_RULE } from './intent/classify-prompt.js'`
([prompt.ts:2](../../reviewer-core/src/prompt.ts#L2)) — after the move, that is the
only edge between the two modules, and it is one-way → **no cycle**. `INTENT_RULE`
does NOT need to move (`classify-prompt.ts` no longer imports back from `prompt.ts`).

`index.ts` today ([:15-21](../../reviewer-core/src/index.ts#L15)):
```ts
export {
  assemblePrompt,
  wrapUntrusted,        // ← move THIS name's source to prompt-shared.js
  type PromptParts,
  type SkillInput,
  type AssembledPrompt,
} from './prompt.js';
```
Split into: `assemblePrompt` + the three types stay `from './prompt.js'`;
`wrapUntrusted` becomes `export { wrapUntrusted } from './prompt-shared.js';`.
Public API name/signature unchanged → no consumer edit anywhere.

### S3 — Group A fix: exclude the DI composition-root cycle by PATH (.dependency-cruiser.cjs:74-84)

Today:
```js
    {
      name: 'no-circular',
      comment: 'cycles couple layers. NOTE: warn (not error) — ...',
      severity: 'warn',
      from: {},
      to: { circular: true },
    },
```
CHANGE (D2 — exclude cycles that pass through the composition root, and promote to
`error` per D5):
```js
    {
      name: 'no-circular',
      comment: 'cycles couple layers. Promoted to ERROR (see TD-001 paydown). The ' +
        'intentional composition-root cycle — the hand-rolled DI constructs some ' +
        'services (e.g. RepoIntelService) while passing the whole Container back into ' +
        'them — is EXCLUDED by path via viaOnly.pathNot on src/platform/container.ts, ' +
        'because it cannot be removed without inverting the DI. A NEW cycle anywhere ' +
        'ELSE (not through container.ts) now fails the build.',
      severity: 'error',                        // ← D5, AFTER Slices 2 & Group-B fix land
      from: {},
      to: { circular: true, viaOnly: { pathNot: 'src/platform/container\\.ts' } },  // ← D2
    },
```
**Why `viaOnly.pathNot`, not `dependencyTypesNot` (empirical, dependency-cruiser
17.4.3, measured with `pnpm exec depcruise src`):**
- **Baseline (current config): 6 `no-circular` warnings** — matches TD-001.
- **`to: { circular: true, dependencyTypesNot: ['type-only'] }` → STILL 6
  (REFUTED).** `dependencyTypesNot` filters the CYCLE-ANCHOR edge, not the whole
  cycle. Observed the anchor flip from `service.ts → container.ts` (type-only) to
  `container.ts → service.ts` (value, the `import { RepoIntelService }`
  construction edge), and `helpers.ts → repository.ts` (type) to
  `repository.ts → helpers.ts` (value, `import { isConfigChange }`). A cycle that
  contains ANY value edge (Group A always does — the root constructs the service;
  Group B always does — the repository imports `isConfigChange`) still matches via
  that value edge. So edge-type filtering is INEFFECTIVE for these cycles.
- **`to: { circular: true, viaOnly: { pathNot: 'src/platform/container\\.ts' } }` →
  2 warnings (CONFIRMED WORKING).** Excludes exactly the 4 Group A cycles (all route
  through the DI composition root `container.ts`); Group B
  (agents `helpers ⇄ repository`) and Group C (reviewer-core) remain reported —
  neither routes through `container.ts`. Those 2 residual warnings are cleared by
  the STRUCTURAL fixes: Group B by S4, Group C by Slice 2. End state = **0**.

`viaOnly` is a `MiniDependencyRestrictionType` (dependency-cruiser
`restrictions.d.mts`); `viaOnly.pathNot` is the current, non-deprecated key in
17.4.3 (the older top-level `viaNot` is deprecated → use `viaOnly.pathNot`). It
targets the ONE documented intentional-cycle location by path — more honest than an
edge-type filter, and it still catches a value cycle anywhere else.

> **Residual coverage (conscious trade-off, D5).** After promotion to `error`, a
> NEW value-level cycle that routes THROUGH `container.ts` would be EXCLUDED by
> `viaOnly.pathNot` and NOT caught. This is accepted: the composition root is the
> intentional-cycle zone by design (the DI-by-`Container`-handle pattern). Any
> accidental cycle NOT through `container.ts` IS caught as a build-failing error —
> a strictly stronger gate than today's blanket `warn`.

### S4 — Group B fix at source (agents/helpers.ts:3)

Today ([helpers.ts:3](../../server/src/modules/agents/helpers.ts#L3)):
```ts
import type { AgentRow, AgentVersionRow } from './repository.js';
```
CHANGE to the canonical home (the repository ALREADY sources them there —
[repository.ts:14](../../server/src/modules/agents/repository.ts#L14),
[db/rows.ts:12-13](../../server/src/db/rows.ts#L12)):
```ts
import type { AgentRow, AgentVersionRow } from '../../db/rows.js';
```
This deletes the `helpers → repository` back-edge at its origin, so the
`helpers ⇄ repository` pair is acyclic even under `tsPreCompilationDeps`. This is
the ONLY thing that clears Group B — the Group A `viaOnly.pathNot` exclusion (S3)
does NOT cover B (the agents cycle does not route through `container.ts`; it is one
of the 2 residual warnings after S3). Types are identical (`repository.ts`
re-exports the exact same `db/rows.ts` types), so this is behavior- and
type-identical.

### S5 — `paid`-row markup to mirror (README.md:31, verbatim precedent)

```md
| [TD-003](./TD-003-blast-no-pr-vs-index-freshness.md) | ... | `paid` (2026-07-02) | ~~A wrong "no impact" is reported ...~~ — paid via freshness signal ([spec](../specs/blast-index-freshness.md), commit `62269f6`) |
```
Apply the SAME shape to rows 29 (TD-001) and 30 (TD-002): set Status
`paid (<merge-date>)`; strike-through the old trigger; append
`— paid via <what> ([spec](../specs/td-001-td-002-hygiene-paydown.md), commit \`<sha>\`)`.
Commit SHA is a placeholder until merge (Slice 4 runs last; fill from the actual
squash/merge commit).

## Confirmed decisions

### D0 — TD-002 separator = `|` (RESOLVED)
Replace `\x00` with `|`. `groupKey ∈ {sym, caller, ep, cron}` (a fixed TS enum,
[BlastCard.tsx:507](../../client/src/app/repos/%5BrepoId%5D/pulls/%5Bnumber%5D/_components/BlastCard/BlastCard.tsx#L507))
— none contains `|` or `\t`, so both are collision-safe; `|` is chosen as the more
conventional, visible delimiter. `label` is arbitrary text (a symbol/file name) that
CAN contain `|`, but that is fine: the key is `groupKey|label`, and `groupKey` is the
constrained prefix, so `("sym","a|b")` → `"sym|a|b"` can never collide with any other
`(groupKey,label)` pair because the FIRST `|` always terminates the (pipe-free)
`groupKey`. No behavioral change: the key is internal to `idFor`; `escapeMermaidLabel`
(not the key) is what reaches Mermaid. TD-002 doc explicitly blesses `|` or `\t`
([TD-002…md:45-49](../technical-debt/TD-002-blastcard-nul-cachekey.md#L45)).

### D1 — Group C: extract `wrapUntrusted` (not `INTENT_RULE`) to the leaf (RESOLVED)
The cycle is `prompt.ts —INTENT_RULE→ classify-prompt.ts —wrapUntrusted→ prompt.ts`.
Either symbol could move; **move `wrapUntrusted`** because:
1. **It is the more widely-shared symbol** — 4 importers (`prompt.ts`,
   `classify-prompt.ts`, `blast-prompt.ts`, `conventions/extract.ts`,
   `risks-prompt.ts`) all pull it from `prompt.ts` (S2 table). Relocating it to a
   true leaf decouples ALL of them from the (larger) `prompt.ts` module, not just
   the cycle.
2. **It is genuinely leaf-shaped** — a self-contained pure string function with no
   internal deps ([prompt.ts:31-35](../../reviewer-core/src/prompt.ts#L31)), so the
   leaf module has zero inbound coupling risk. `INTENT_RULE` is a lone constant, but
   it is co-located with the intent-prompt builders that logically own it; moving it
   out would split a cohesive module for no extra benefit.
3. **Onion / purity** (`onion-architecture`, reviewer-core invariant): the leaf sits
   at the innermost point of reviewer-core, pure, imported inward-only — dependency
   direction is preserved and no I/O is introduced.
`prompt.ts` keeps importing `INTENT_RULE` from `classify-prompt.ts` (one-way) → the
cycle is broken with the minimal semantic move.

### D2 — Groups A & B: exclude-by-path for A (empirical), relocate-at-source for B (RESOLVED)
The original plan proposed `dependencyTypesNot: ['type-only']` for A on the theory
that the DI back-edge is type-only. That theory was **empirically refuted** against
the installed dependency-cruiser (17.4.3, `pnpm exec depcruise src`): the config
stayed at **6 → 6** warnings because `dependencyTypesNot` filters only the cycle's
ANCHOR edge, and dependency-cruiser simply re-anchors each cycle onto its VALUE edge
(`container.ts → service.ts` via `import { RepoIntelService }`; `repository.ts →
helpers.ts` via `import { isConfigChange }`). Every one of these cycles contains a
value edge, so type-only exclusion can never suppress them.

- **Group A (4 DI warnings) → config `viaOnly: { pathNot: 'src/platform/container\\.ts' }`
  (S3). MEASURED 6 → 2 (works).** All 4 Group A cycles route through the DI
  composition root; excluding cycles that pass THROUGH `container.ts` removes exactly
  them and nothing else. This targets the ONE documented intentional-cycle location
  by path (the composition root the rule comment already describes), keeps the DI
  edges visible in code, and still catches a value cycle anywhere else. Group A is
  NOT clearable structurally — the back-edge IS the DI pattern (the container
  constructs services and hands the whole `Container` back), which cannot be
  relocated without inverting the composition root (out of scope).
- **Group B (1 warning) → relocate-at-source (S4). This is the ONLY fix for B.**
  The `viaOnly.pathNot` exclusion does NOT cover B — the agents `helpers ⇄
  repository` cycle does not route through `container.ts`, so after S3 it is one of
  the 2 residual warnings. S4 (point `helpers.ts`'s row-type import at `db/rows.ts`,
  which the repository already uses) removes the `helpers → repository` back-edge at
  its origin → B cycle gone. One-line, type-identical change; it also demonstrates
  the `db/rows.ts` canonical-home pattern the config comment already references
  ([:52-59](../../server/.dependency-cruiser.cjs#L52)).

**End-state chain:** S4 removes Group B → C removed by Slice 2 → Group A excluded by
`viaOnly.pathNot` → **0 `no-circular` warnings**, which is what makes D5's promotion
to `error` safe.

### D3 — Re-point ALL `wrapUntrusted` importers to the leaf, not just the cycle-closer (RESOLVED)
Only `classify-prompt.ts:3` MUST change to break the cycle. But `blast-prompt.ts`,
`conventions/extract.ts`, and `risks-prompt.ts` also import `wrapUntrusted` from
`prompt.ts` (S2 table). **Re-point all of them to `prompt-shared.js`** so the helper
has a single leaf home and no module pulls in `prompt.ts` transitively just for the
string helper. Pure import-path churn (same symbol, same signature); it keeps the
graph clean and prevents a future reader from re-adding a `prompt.ts` dependency
"because that's where `wrapUntrusted` was". `index.ts` re-export re-pointed likewise
(public API name unchanged).

### D4 — TD register bookkeeping is a PLAN STEP done LAST (Slice 4) (RESOLVED)
Do NOT edit the register now. As the final slice (after 1–3 merge): flip TD-001 &
TD-002 rows to `paid (YYYY-MM-DD)` mirroring TD-003/TD-004 (S5), update both detail
files' Status lines, and record which paydown option each group took (Group A =
`viaOnly.pathNot` exclusion; Group B = row-type relocation; Group C = leaf
extraction). This slice depends on all fix slices landing so the "paid via … commit
`<sha>`" links are real.

### D5 — Promote `no-circular` `warn → error` — YES, after Slice 2 + Group-B fix (RESOLVED, recommend)
The config comment explicitly anticipates promotion. **Recommendation: promote to
`error`** in the SAME edit as S3 (Slice 3), because at the end of Slices 2–3 there
are **0 `no-circular` matches**:
- After Slice 2, reviewer-core's real value cycle (Group C) is gone.
- After S4 (Group B relocation), the agents type-only back-edge is gone.
- After S3 `viaOnly.pathNot`, the 4 Group A DI cycles are excluded by path
  (measured 6 → 2; the 2 residuals are B and C, both cleared above).
- So `arch:check` has 0 matches → the rule can be `error` without failing the
  current build, and it now GUARDS against any future accidental cycle OUTSIDE the
  composition root (residual trade-off in S3: a future cycle THROUGH `container.ts`
  is excluded by design).
- **Ordering guard:** the `error` flip MUST NOT land before BOTH Slice 2 (C gone)
  AND the S4 Group-B relocation are green — otherwise `arch:check` still reports 1–2
  cycles and CI goes red. In practice the `viaOnly.pathNot` narrowing (6 → 2) and the
  S4 edit and Slice 2 can all be prepared in parallel; the `severity: 'error'` value
  is the only thing gated. Slice 3's DoD requires a green `arch:check` (0 matches),
  which is only true once Slice 2 + S4 have landed.
  - *Conservative fallback if a reviewer prefers to de-risk:* split Slice 3 into 3a
    (add `viaOnly.pathNot` + the S4 relocation, keep `severity: 'warn'` → 0 warnings
    but non-blocking) and 3b (flip to `error`) where 3b is gated on Slice 2 being
    green. The plan recommends the single combined edit since the DoD verification
    already enforces the ordering.

## Phases

> **Dependency & parallelism.** Slices 1, 2, and the non-blocking part of 3 are
> DISJOINT file sets and can be implemented in parallel by separate implementers:
> - **Slice 1 (TD-002, client)** — `BlastCard.tsx` only. Fully independent.
> - **Slice 2 (Group C, reviewer-core)** — reviewer-core files only. Independent of 1.
> - **Slice 3 (Groups A & B, server)** — `.dependency-cruiser.cjs` + `agents/helpers.ts`.
>   The `agents/helpers.ts` edit (S4, clears B) and the `viaOnly.pathNot` narrowing
>   (S3, excludes A → 6→2) are independent and may proceed in parallel with Slice 2.
>   The **`no-circular` `warn → error` promotion (D5) DEPENDS on BOTH Slice 2 (C
>   gone) AND S4 (B gone) landing** — else `arch:check` still reports cycles and CI
>   goes red. So the `severity: 'error'` value is verified/merged only after Slice 2
>   + S4.
> - **Slice 4 (docs)** — runs LAST, after 1-3 merge (needs real commit SHAs).

### Slice 1 — TD-002: replace the `\x00` cacheKey separator (client)
- **Surface:** client (UI — presentational graph builder).
- **Disjoint scope:** `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastCard/BlastCard.tsx`
  — the single `cacheKey` line in `buildMermaid`'s `node()` (S0, line 511).
- **Depends on:** none.
- **Skills to apply:** `react-frontend-architecture` (confirm the change stays a
  pure internal helper detail, no state/render impact), `typescript-expert`. (The
  `\x00` never reached the DOM, so `security` has no finding here — the separator is
  server-independent, internal, non-attacker-controlled data.)
- **What changes & why:** swap the NUL byte for `|` (D0) so ripgrep/CI text-scans
  (and the insights read-before-write grep) stop treating the file as binary. The
  key is internal to `idFor`; `escapeMermaidLabel(label)` (not the key) reaches
  Mermaid → zero behavioral change.
- **Acceptance criteria:**
  - `cacheKey` uses `|` (or `\t`); NO NUL byte anywhere in the file
    (`grep -c $'\x00' <file>` → `0`; ripgrep no longer reports "binary file
    matches" and a normal `Grep` for `escapeMermaidLabel` now finds lines 474/518).
  - `buildMermaid` output (the Mermaid source string) is byte-identical to before
    for the same input — de-dup behavior unchanged (same nodes collapse, same ids
    assigned in the same order).
  - No other line in `BlastCard.tsx` changes.
- **How to test:** `cd client && pnpm test` (extend/confirm any existing
  `BlastCard`/`buildMermaid` test still green; if a `buildMermaid` snapshot/unit
  test exists, it must be unchanged) + `pnpm typecheck`. Run in WSL:
  `wsl.exe -d Ubuntu-24.04-dev-digest-test -- bash -lc 'cd /mnt/e/Sources/NeoVersity/Projects/AIAgenticEngineering/dev-digest/client && pnpm test && pnpm typecheck'`.
  Manual: `rg escapeMermaidLabel <file>` now returns the two text matches (was
  "binary file matches").

### Slice 2 — TD-001 Group C: break the reviewer-core value cycle (leaf extraction)
- **Surface:** reviewer-core (pure core).
- **Disjoint scope:** NEW `reviewer-core/src/prompt-shared.ts`; EDIT
  `reviewer-core/src/prompt.ts`, `.../intent/classify-prompt.ts`,
  `.../blast/blast-prompt.ts`, `.../conventions/extract.ts`,
  `.../risks/risks-prompt.ts`, `.../index.ts` (import re-points + one re-export
  re-point, per S2 table). No server, no shared, no contract change.
- **Depends on:** none.
- **Skills to apply:** `onion-architecture` (leaf placement + dependency direction:
  the shared helper goes to the innermost pure leaf, imported inward-only;
  reviewer-core imports nothing from server), `typescript-expert` (ESM `.js`
  specifiers in import paths per this package's convention; no circular import),
  `security` (confirm the moved `wrapUntrusted` — the injection-hardening delimiter
  wrapper — is byte-identical; it is the load-bearing untrusted-data boundary, so
  the move must be verbatim, no logic edit).
- **What changes & why:** move the self-contained pure `wrapUntrusted` to a leaf
  module (S2) so `classify-prompt.ts` gets it from the leaf instead of from
  `prompt.ts`, breaking the `prompt.ts ⇄ classify-prompt.ts` value cycle (D1).
  `prompt.ts` keeps importing `INTENT_RULE` (now one-way). reviewer-core stays PURE
  (leaf is a string function, no I/O). This is the ONLY of the three TD-001 groups
  that a config change can never fix — it is a real value cycle and must be broken
  structurally.
- **Acceptance criteria:**
  - `wrapUntrusted` is defined ONCE, in `prompt-shared.ts`, verbatim (same body as
    [prompt.ts:31-35](../../reviewer-core/src/prompt.ts#L31)); `prompt.ts` no longer
    defines it and imports it from the leaf.
  - `classify-prompt.ts` imports `wrapUntrusted` from `'../prompt-shared.js'`; the
    `prompt.ts ⇄ classify-prompt.ts` cycle no longer exists (verified by
    `pnpm arch:check` in Slice 3 — this reviewer-core warning drops out, taking the
    residual count from 2 → 1, and to 0 once Group B/S4 lands).
  - Public API: `import { wrapUntrusted } from '@devdigest/reviewer-core'` still
    resolves to the identical function (re-exported via `index.ts` from the leaf).
  - reviewer-core purity intact: `prompt-shared.ts` imports no fs/db/net/git; only
    (if any) `@devdigest/shared` types (none needed today).
  - `pnpm test` (reviewer-core) and `pnpm build` (= `tsc --noEmit`) green; no
    behavioral change in prompt assembly, intent, blast, risks, or conventions
    output.
- **How to test:** WSL:
  `wsl.exe -d Ubuntu-24.04-dev-digest-test -- bash -lc 'cd /mnt/e/.../dev-digest/reviewer-core && pnpm test && pnpm build'`.
  (reviewer-core `build` is `tsc --noEmit`, per reviewer-core/AGENTS.md.) The cycle
  removal itself is proven by Slice 3's `arch:check`.

### Slice 3 — TD-001 Groups A & B: exclude DI cycle by path + relocate agents row-type import + promote to error
- **Surface:** server (arch-check config + agents module import).
- **Disjoint scope:** `server/.dependency-cruiser.cjs` (the `no-circular` rule, S3)
  and `server/src/modules/agents/helpers.ts` (one import line, S4). No runtime
  source change beyond the one import path.
- **Depends on:** the `severity: 'error'` flip (D5) is verified/merged only AFTER
  BOTH Slice 2 (Group C gone) AND the S4 Group-B relocation land — else `arch:check`
  still reports 1–2 cycles and goes red. The `viaOnly.pathNot` narrowing (S3, 6→2)
  and the `helpers.ts` edit (S4) themselves have no external dependency and may
  proceed in parallel with Slice 2.
- **Skills to apply:** `onion-architecture` (rule 9 — enforce boundaries
  mechanically; the config IS the boundary; the DI composition-root cycle is
  intentional and excluded by path, everything else stays caught — confirm promoting
  to `error` does not mask legitimate structure and the residual-coverage trade-off
  (S3) is acceptable), `typescript-expert` (row-type import re-point; verify
  `db/rows.ts` exports the identical `AgentRow`/`AgentVersionRow`),
  `drizzle-orm-patterns` (confirm the row types are the `$inferSelect` shapes and
  that pointing at `db/rows.ts` is the sanctioned canonical home —
  [db/rows.ts:3-11](../../server/src/db/rows.ts#L3)). NO `postgresql-table-design`
  (no schema).
- **What changes & why:** (a) add `viaOnly: { pathNot: 'src/platform/container\\.ts' }`
  to `no-circular`'s `to` so cycles routing through the DI composition root are
  excluded — clearing the 4 Group A DI warnings (empirically 6 → 2, S3/D2) without
  touching the intentional DI pattern; (b) point `agents/helpers.ts` at `db/rows.js`
  to remove Group B's back-edge at its source (S4 — the ONLY fix for B; the exclusion
  does not cover it); (c) flip `severity` `warn → error` (D5) so any NEW cycle
  outside the composition root fails the build — safe because Slices 2–3 leave 0
  matches.
- **Acceptance criteria:**
  - With `viaOnly.pathNot` alone (before Slice 2 + S4 land): `arch:check` reports
    exactly **2** `no-circular` findings (Group B agents + Group C reviewer-core) —
    the intermediate state, matching the coordinator's measurement.
  - After Slice 2 + S4 land: `pnpm arch:check` reports **0** `no-circular`
    findings and the gate is **green** (exit 0). No OTHER rule's count changes (the
    6 `error` boundary rules stay green; no new violations introduced).
  - `agents/helpers.ts` imports `AgentRow, AgentVersionRow` from `'../../db/rows.js'`;
    `pnpm typecheck` green (types identical to the old `./repository.js` re-export).
  - `no-circular` is `severity: 'error'` with
    `viaOnly: { pathNot: 'src/platform/container\\.ts' }` and the updated comment
    (S3/D5 wording). The implementer VERIFIED (via `pnpm exec depcruise src`) that
    `viaOnly.pathNot` yields 0 findings post-Slice-2/S4 before flipping to `error`.
  - The intentional DI composition-root cycle (the `import { RepoIntelService }`
    construction edge at [container.ts:31](../../server/src/platform/container.ts#L31)
    and the `import type { Container }` back-edges at
    [service.ts:21](../../server/src/modules/repo-intel/service.ts#L21) etc.) still
    EXISTS in code (not silenced/removed) — the config just no longer flags cycles
    through `container.ts`.
  - `pnpm test` (server) green (no runtime behavior touched).
- **How to test:** WSL:
  `wsl.exe -d Ubuntu-24.04-dev-digest-test -- bash -lc 'cd /mnt/e/.../dev-digest/server && pnpm arch:check && pnpm typecheck && pnpm test'`.
  The `error` flip's `arch:check` MUST be run AFTER Slice 2 + S4 have landed to pass
  (D5 ordering). Confirm by diffing `arch:check` output across states: baseline 6
  warnings → `viaOnly.pathNot` alone 2 → +Slice2 +S4 = 0.

### Slice 4 — Docs: mark TD-001 & TD-002 `paid` + INSIGHTS sweep
- **Surface:** cross-cutting (docs only; no source change).
- **Disjoint scope:** `docs/technical-debt/README.md` (rows 29 & 30),
  `docs/technical-debt/TD-001-circular-dependencies.md`,
  `docs/technical-debt/TD-002-blastcard-nul-cachekey.md`, `server/INSIGHTS.md`,
  `reviewer-core/INSIGHTS.md`.
- **Depends on:** Slices 1-3 merged (needs real commit SHAs for the "paid via …
  commit `<sha>`" links; the `no-circular` promotion described in TD-001's detail
  must actually be in place).
- **Skills to apply:** `engineering-insights` (read-before-write; append-only;
  capture only the substantial; do not duplicate existing entries).
- **What & why (D4):**
  - README rows 29 (TD-001) & 30 (TD-002) → `paid (YYYY-MM-DD)`, mirroring the
    TD-003/TD-004 markup (S5): strike-through the old trigger, append the spec +
    commit link.
  - TD-001 detail: Status → `paid`; note Group C was fixed by extracting
    `wrapUntrusted` to `prompt-shared.ts`; Group B by relocating `helpers.ts`'s
    row-type import to `db/rows.ts`; Group A by excluding the composition-root cycle
    by path (`viaOnly: { pathNot: 'src/platform/container\\.ts' }`) — NOT by
    edge-type filtering, which was tested and does not work; and that `no-circular`
    was **promoted to `error`** (the trigger's anticipated end-state), with the
    residual trade-off (a future cycle through `container.ts` is excluded) noted.
    Update the detail file's "Paydown options" A entry to reflect that option (a)
    (type-only exclusion) is REFUTED and the working mechanism is the path exclusion.
  - TD-002 detail: Status → `paid`; note the separator is now `|`.
  - `reviewer-core/INSIGHTS.md`: "prompt.ts ⇄ intent/classify-prompt.ts was a real
    value cycle (INTENT_RULE ↔ wrapUntrusted); the fix is a leaf `prompt-shared.ts`
    holding the widely-shared pure `wrapUntrusted` — move the MORE-shared symbol to
    the leaf, not the co-located constant."
  - `server/INSIGHTS.md`: "dependency-cruiser `no-circular` cannot be narrowed by
    edge type: `dependencyTypesNot: ['type-only']` filters only the cycle's ANCHOR
    edge, so a cycle containing ANY value edge (the DI root constructs services;
    the agents repository imports a value helper) just re-anchors and STILL matches
    (measured 6→6 on 17.4.3). To exempt the intentional composition-root cycle, use
    `viaOnly: { pathNot: 'src/platform/container\\.ts' }` (measured 6→2 — excludes
    only cycles routing THROUGH the DI root; `viaNot` is deprecated, use
    `viaOnly.pathNot`). Agents row types belong in `db/rows.ts` (the canonical home)
    — importing them from a sibling `repository.ts` creates a needless type-only
    back-edge that `viaOnly.pathNot` does NOT exclude (it doesn't route through
    container), so fix it structurally."
- **Acceptance criteria:** register rows + both detail Status lines consistent and
  set to `paid` with real spec/commit links; TD-001 detail's Paydown-options A entry
  updated to reflect the refuted edge-type filter vs the working path exclusion;
  INSIGHTS entries appended (not duplicated — read first); no code change; the
  `server`/`client`/`reviewer-core` suites + `arch:check` remain green from
  Slices 1-3.
- **How to test:** N/A (docs). Re-confirm `arch:check` + all three package suites
  are green (WSL) before marking `paid`.

## Risks & mitigations

- **Promoting `no-circular` to `error` before Slice 2 + S4 land → red CI (the #1
  ordering risk).** reviewer-core's value cycle (C) and the agents back-edge (B) are
  still present until Slice 2 and S4 respectively land; with `viaOnly.pathNot` alone
  the count is 2, not 0, so flipping `severity: 'error'` earlier fails `arch:check`.
  **Mitigation (D5):** the `error` flip is gated on BOTH Slice 2 and S4, and Slice
  3's DoD requires a green (0-match) `arch:check`. Optional 3a/3b split (D5 fallback)
  de-risks further.
- **Config-mechanism refutation (the finding that drove this revision).** Filtering
  by edge type does NOT work: `dependencyTypesNot: ['type-only']` measured 6 → 6 on
  dependency-cruiser 17.4.3 because it filters the cycle's anchor edge and every
  Group A/B cycle also has a value edge to re-anchor on. **Mitigation:** the plan
  uses the MEASURED-working mechanism `viaOnly: { pathNot: 'src/platform/container\\.ts' }`
  (6 → 2), clearing the DI cycles by PATH, with B and C handled structurally
  (S4, Slice 2). The implementer re-runs `pnpm exec depcruise src` to confirm the
  0-match end state before flipping to `error`.
- **`viaOnly.pathNot` key / version drift.** `viaOnly` is a
  `MiniDependencyRestrictionType` and `viaOnly.pathNot` is the current
  (non-deprecated) key in 17.4.3 (top-level `viaNot` is deprecated). **Mitigation:**
  the key was empirically verified on the installed version; the implementer
  re-confirms with `pnpm exec depcruise src` (the plan's Slice 3 DoD requires the
  measured counts) before relying on it. The path regex is escaped
  (`container\\.ts`) as a `.cjs` string.
- **Residual coverage gap (conscious trade-off).** After promotion to `error`, a NEW
  value cycle that routes THROUGH `container.ts` is EXCLUDED and not caught.
  **Accepted (S3/D5):** the composition root is the intentional-cycle zone by design;
  any accidental cycle NOT through `container.ts` IS caught as an error — strictly
  stronger than today's blanket `warn`. Stated explicitly in the config comment and
  the TD-001 detail so the trade-off is on the record, not implicit.
- **Moving `wrapUntrusted` changes injection-hardening behavior.** `wrapUntrusted`
  is the load-bearing untrusted-data delimiter (security-critical). **Mitigation:**
  the move is VERBATIM (S2) — same body, same `</untrusted>` neutralization, same
  signature; no logic edit. reviewer-core's existing prompt/injection tests
  (`pnpm test`) must stay green, proving byte-identical output. `security` skill is
  applied to Slice 2 specifically to confirm the boundary is unchanged.
- **`INTENT_RULE` re-export path drift.** `index.ts` re-exports both `wrapUntrusted`
  (from `prompt.js` today) and `INTENT_RULE` (from `classify-prompt.js`). Only
  `wrapUntrusted`'s source moves; `INTENT_RULE`'s export line is UNTOUCHED (it stays
  in `classify-prompt.ts`). **Mitigation:** S2 spells out exactly which `index.ts`
  line moves; public API names/signatures are unchanged → no consumer edit.
- **TD-002 separator collision.** A `label` could contain `|`. **It cannot cause a
  collision (D0):** the key is `groupKey|label` where `groupKey` is a pipe-free
  fixed enum, so the first `|` unambiguously delimits the prefix; two distinct
  `(groupKey,label)` pairs can never produce the same string. No behavioral change.
- **Migration / schema risk — N/A.** No surface here touches the DB; no
  `pnpm db:generate` / `db:migrate`.
- **Windows/WSL split (machine note).** Tests/typecheck/`arch:check` run **inside
  WSL** (`wsl.exe -d Ubuntu-24.04-dev-digest-test -- bash -lc '…'` from
  `/mnt/e/.../dev-digest`); **git runs on Windows**. Do not run `pnpm`/`depcruise`
  from the Windows shell. Reflected in every phase's "How to test".

## Critical files for implementation

- `reviewer-core/src/prompt-shared.ts` (NEW) + `reviewer-core/src/prompt.ts` +
  `reviewer-core/src/intent/classify-prompt.ts` — the leaf extraction that breaks
  the real value cycle (Slice 2, S2). The ONLY TD-001 group unfixable by config.
- `server/.dependency-cruiser.cjs` — the `no-circular` rule:
  `viaOnly: { pathNot: 'src/platform/container\\.ts' }` (Group A, empirically 6→2) +
  `warn → error` promotion (Slice 3, S3, D2, D5).
- `server/src/modules/agents/helpers.ts` — the row-type import re-point to
  `db/rows.js` (Slice 3, S4) — the only fix for Group B.
- `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastCard/BlastCard.tsx`
  — the `\x00 → |` cacheKey one-liner (Slice 1, S0).
- `docs/technical-debt/README.md` + the two detail files — the `paid` bookkeeping
  (Slice 4, S5); TD-001 detail also records the refuted edge-type filter vs the
  working path exclusion.

## Open questions / assumptions

- **Assumption (verified):** `wrapUntrusted` is self-contained with no internal
  imports ([prompt.ts:31-35](../../reviewer-core/src/prompt.ts#L31)), so it moves to
  a leaf cleanly. Its 4 importers are enumerated in S2 (verified via grep). Confirm
  no OTHER file imports it (the S2 table is the complete set as of this branch).
- **Assumption (verified):** `db/rows.ts` exports the identical
  `AgentRow`/`AgentVersionRow` that `agents/repository.ts` re-exports
  ([db/rows.ts:12-13](../../server/src/db/rows.ts#L12),
  [repository.ts:14-15](../../server/src/modules/agents/repository.ts#L14)), so the
  `helpers.ts` re-point is type-identical.
- **RESOLVED (was OQ1) — Group A config mechanism.** The coordinator empirically
  verified against dependency-cruiser 17.4.3: `dependencyTypesNot: ['type-only']`
  is INEFFECTIVE (6 → 6, re-anchors on the value edge);
  `viaOnly: { pathNot: 'src/platform/container\\.ts' }` WORKS (6 → 2, excludes the
  DI cycles by path). The plan uses the verified mechanism. The implementer re-runs
  `pnpm exec depcruise src` to reconfirm the 0-match end state before the `error`
  flip.
- **OQ — combined vs split Slice 3 for the `error` flip.** D5 recommends the single
  combined edit (DoD enforces the 0-match ordering); a reviewer may prefer the 3a/3b
  split (D5 fallback: land `viaOnly.pathNot` + S4 at `warn` first, flip to `error`
  once Slice 2 is green). Either satisfies the ordering guard; no contract impact.
- **Assumption:** `no-circular` is the ONLY rule currently in a `warn` state; the
  other 6 rules are `error` and green ([.dependency-cruiser.cjs:14-84](../../server/.dependency-cruiser.cjs#L14)).
  Promotion affects only `no-circular`. Confirm via `arch:check` output that no
  other rule regresses.
- **Assumption:** all 4 Group A cycles route through `src/platform/container.ts`
  (the coordinator's 6 → 2 measurement confirms: only the 2 non-container cycles —
  agents B, reviewer-core C — survive the `viaOnly.pathNot` exclusion). If a future
  Group A cycle did NOT route through `container.ts`, it would (correctly) still be
  reported.
