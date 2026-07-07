# Development Plan: Blast Radius panel — UI polish & fixes

> Follow-up to [`blast-radius.md`](./blast-radius.md). That plan shipped the
> feature end-to-end (commits `72c620e` panel, `63da814` github file-links). This
> plan is a **client-only visual-polish pass** on the already-shipped panel — no
> server, contract, schema, or data-shape change. Scope is the BlastCard, its
> OverviewTab mount, and the shared MermaidDiagram component.

## Context

The **BLAST RADIUS** panel renders on the PR Overview tab next to **INTENT**. It
reads `usePrBlast(prId)` (a deterministic `BlastResponse` from the repo-intel
index) and shows the impact map two ways: an expandable **Tree** (changed symbols
→ callers → endpoints/crons) and a Mermaid **Graph**. Seven gaps vs. the agreed
design (screenshots 1–3) were found in the shipped UI (screenshots 4–5):

| # | Gap (current → desired) | Surface |
|---|---|---|
| 1 | INTENT and BLAST stack vertically → render **side-by-side** | `OverviewTab.tsx` |
| 2 | `N callers` badge sits inline after the filename → **right-align** it to the row edge | `BlastCard.tsx` (`SymbolRow`) |
| 3 | The `<>` symbol marker is muted-gray → make it **blue + bold** | `BlastCard.tsx` (`SymbolRow`) |
| 4 | Endpoints render as plain text (indistinguishable from callers) → **colored pills**, one per line | `BlastCard.tsx` (`SymbolRow`/`LeafLine`) |
| 5 | Graph text is too small to read | `MermaidDiagram.tsx` (font config) |
| 6 | Large graph overflows / is cut off & inaccessible → **nested scroll viewport** | `MermaidDiagram.tsx` / `BlastGraph` |
| 7 | Graph nodes are undifferentiated → **color by category + legend** (changed/callers/endpoints affected) | `BlastCard.tsx` (`buildMermaid`) + `MermaidDiagram.tsx` |

## Scope

- **IN:** layout (OverviewTab grid), Tree-row styling (caller rows, `<>` marker,
  caller-count alignment, endpoint/cron pills), graph styling (font size, node
  coloring + classes, legend), and a scroll viewport for the graph. i18n string
  additions where new labels appear (legend). All strings via next-intl.
- **OUT (do NOT touch):** the `BlastResponse` contract, the `blast/` server
  module, the `pr_blast_summary` cache, `repoIntel`, the `usePrBlast` hook's
  fetch, the summary LLM call, DB/migrations. No data-shape change — every fix is
  presentational and derives from existing `data.blast`.

## Locked decisions (confirmed by the product owner, 2026-06-30)

1. **Layout (#1):** responsive CSS grid, two equal columns (`1fr 1fr`) that
   **collapse to one column below ~900px**; the `Description` block stays
   full-width below the two-column row.
2. **Caller rows (#4 design-match):** adopt the design's `↳` leader
   (`CornerDownRight` icon, replacing the `Users` icon) and the `file:line` link,
   **but keep the caller symbol name** → row reads `↳ {name}  {file}:{line}`.
3. **Graph colors (#7):** `changed symbol` = blue (`--accent`), `callers` =
   neutral gray, `endpoints affected` = green (`--ok`); **crons get their own
   amber (`--warn`) class and a 4th legend dot** (the design legend lists 3, but
   the data has crons — surface them rather than hide them).
4. **Graph scroll (#6):** wrap the diagram in a nested viewport with a fixed
   `max-height` (~420px) and `overflow:auto` on **both axes**; disable Mermaid's
   `useMaxWidth` so the SVG keeps its intrinsic size and is read by scrolling
   (rather than shrinking to fit and becoming illegible).

## Current-state anchors (grounded — implementers edit exactly these)

- `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`
  — `OverviewTab.tsx:14-29`: renders `<IntentCard>`, `<BlastCard>`, `Description`
  stacked in a fragment. The parent (`page.tsx:142`) is a single-column flex,
  `maxWidth: 1080`, `gap: 24`.
- `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastCard/BlastCard.tsx`
  — `SymbolRow` (`:227-316`): the `<>` marker is `Icon.Code` at `:271`
  (`color: var(--text-muted)`); the `N callers` text is inline at `:277-281`; the
  caller rows use `Icon.Users` + name + `MonoLink` at `:286-305`; endpoints/crons
  use `LeafLine` (plain Globe/Clock + text) at `:306-311` / `:318-334`.
  `buildMermaid` (`:390-436`) emits `flowchart LR` with no `classDef`/styling.
- `client/src/components/mermaid-diagram/MermaidDiagram.tsx` — `:37`
  `mermaid.initialize({ startOnLoad:false, theme:"dark", securityLevel:"strict" })`
  (no font/`flowchart` config); `:61-74` the wrapper has `overflowX:auto` only.
- `client/messages/en/blast.json` — existing keys (`stat.*`, `view.*`,
  `callerCount`, `noDownstream`, `graph.empty|ariaLabel`, `status.*`); a `legend.*`
  block is the only addition needed.
- Theme tokens (`client/src/vendor/ui/styles.css`): `--accent` (#3b82f6 dark),
  `--ok` (#10b981), `--warn` (#f59e0b), `--accent-bg`, `--ok-bg`, `--warn-bg`,
  `--text-muted`, `--border`, `--bg-elevated` — used for the pills + graph classes.
- Icons available (`client/src/vendor/ui/icons.tsx`): `Code`, `CornerDownRight`,
  `Globe`, `Clock`, `Users`, `Boxes`, `Workflow`, `ChevronRight/Down` — all present.
  lucide icons accept `size`/`color`/`strokeWidth`/`style` (so "bold `<>`" = accent
  color + heavier `strokeWidth`).

---

## Fix-by-fix implementation detail

> Every change is presentational and reads from existing `data.blast` /
> `BlastResponse`. No contract, hook-fetch, or server change. All new visible
> strings go through `useTranslations("blast")`. Mermaid facts below are grounded
> in the installed `mermaid@11.15.0` source (verified, not recalled).

### Fix 1 — INTENT + BLAST side-by-side (`OverviewTab.tsx` + `styles.css`)

- **`OverviewTab.tsx`** — wrap ONLY the two cards in a grid; keep `Description`
  as the next sibling so it stays full-width below the row:
  ```tsx
  <>
    <div className="brief-grid">
      <IntentCard prId={prId} />
      <BlastCard prId={prId} />
    </div>
    {prBody && (
      <section> … Description … </section>
    )}
  </>
  ```
- **`client/src/vendor/ui/styles.css`** — add ONE global class (the codebase uses
  inline styles + a few global classes like `.skeleton`/`.dd-spin`; it uses **no**
  Tailwind utilities in JSX, and has no responsive breakpoints yet — so a CSS
  class is the idiomatic, SSR-safe mechanism, not a JS media-query hook):
  ```css
  .brief-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    align-items: start;        /* each card sizes to its own content, no stretch */
  }
  @media (max-width: 900px) { .brief-grid { grid-template-columns: 1fr; } }
  ```
- **Why CSS not JS:** a media query has zero hydration cost / no SSR mismatch
  (next-best-practices); the exact 900px breakpoint can't come from Tailwind's
  default `lg` (1024px) and the project doesn't use Tailwind utility classes.
- **No `page.tsx` change:** the parent flex-column (`page.tsx:142`, `gap:24`) still
  spaces the fragment's children; only the two cards now share a grid row.

### Fixes 2–4 + caller redesign — Tree row restyle (`BlastCard.tsx` `SymbolRow`)

These four touch the same `SymbolRow` (`:227-316`) and its expanded children.

- **Fix 3 — blue + bold `<>`** (`:271`): the changed-symbol marker `Icon.Code`
  → `color: "var(--accent)"`, `strokeWidth: 2.5` (lucide accepts both), keep
  `size: 13`. The symbol name stays `fontWeight: 600`. The chevron stays muted.
- **Fix 2 — right-align `N callers`** (`:277-281`): push the caller-count span to
  the row's right edge with `marginLeft: "auto"` (the header row is already a
  flex; the count becomes the trailing item). Keep it `fontSize: 12`,
  `color: var(--text-muted)`; text stays `t("callerCount", { count })`.
- **Caller rows — design `↳` leader, keep the name** (decision #2) (`:286-305`):
  replace `Icon.Users` with `Icon.CornerDownRight` (the `↳` leader, muted), KEEP
  `<span>{c.name}</span>`, KEEP the `MonoLink` `{file}:{line}` github link → row
  reads `↳ {name}  {file}:{line}`.
- **Fix 4 — endpoint/cron pills, one per line** (`:306-311`, drop/replace
  `LeafLine` `:318-334`): render each endpoint and cron as a colored `Badge`
  (the existing primitive), NOT plain text:
  - endpoint → `<Badge color="var(--accent-text)" bg="var(--accent-bg)" icon="Globe">{e}</Badge>`
  - cron → `<Badge color="var(--warn)" bg="var(--warn-bg)" icon="Clock">{c}</Badge>`
  - **one per line:** set the expanded-children container (`:285`) to
    `alignItems: "flex-start"` so each `inline-flex` Badge stays at content width
    on its own row (a flex-column otherwise stretches children full-width). Each
    Badge is a direct column child → already one per line.
- **Security unchanged:** every value is repo-derived text rendered as TEXT (React
  auto-escapes); no `dangerouslySetInnerHTML`. `Badge` renders `children` as text.

### Fix 5 — graph font size (`MermaidDiagram.tsx`)

- `MermaidDiagram` has exactly ONE consumer (BlastCard), so editing it globally is
  safe (verified — no other usage). In `mermaid.initialize` (`:37`) add
  `themeVariables: { fontSize: "18px" }`. **Grounded:** font size is read ONLY from
  `themeVariables.fontSize` (CSS string); the top-level `MermaidConfig.fontSize`
  number is in the schema but never read by the render pipeline
  (`mermaid@11.15.0`, `chunk-CSCIHK7Q.mjs:5122,5187`; dark default is `"16px"`).

### Fix 6 — graph scroll viewport (`MermaidDiagram.tsx`)

- In `mermaid.initialize` add `flowchart: { useMaxWidth: false }`. **Grounded:**
  with `useMaxWidth:false` the renderer emits `width=W height=H` numeric attrs and
  drops the `style="max-width:..."` (`flowDiagram-I6XJVG4X.mjs:1057`,
  `chunk-CSCIHK7Q.mjs:5086-5088`), so the SVG keeps its intrinsic size instead of
  shrinking to the container.
- Make the wrapper (`:62-73`) a fixed-height scroll viewport: replace
  `overflowX: "auto"` with `maxHeight: 420, overflow: "auto"` (both axes); keep
  the border/bg/radius/padding. The intrinsic-size SVG now scrolls in X and Y.
- **Optional reusability nicety:** expose `maxHeight` as a prop defaulting to 420
  (only consumer is BlastCard today, so a hardcoded 420 is acceptable for v1).

### Fix 7 — graph node coloring + legend (`BlastCard.tsx` `buildMermaid`/`BlastGraph` + `blast.json`)

- **`buildMermaid` — emit `classDef` + per-node class** (decision #3 palette).
  classDef works under `securityLevel:"strict"` (grounded:
  `mermaid.esm.mjs:1376-1428`; strict only DOMPurifies + disables click handlers).
  Use **literal hex** (CSS vars are unreliable inside the sanitized SVG; the graph
  is always `theme:"dark"`, so dark-token hex is correct and theme-stable):
  ```
  flowchart LR
    classDef changed  fill:#1c1c1c,stroke:#3b82f6,color:#ededed,stroke-width:2px
    classDef callers  fill:#1c1c1c,stroke:#6a6a6a,color:#ededed,stroke-width:1.5px
    classDef endpoint fill:#1c1c1c,stroke:#10b981,color:#ededed,stroke-width:1.5px
    classDef cron     fill:#1c1c1c,stroke:#f59e0b,color:#ededed,stroke-width:1.5px
    n0["rateLimit()"]:::changed --> n1["publicRouter"]:::callers
    n1 --> n2["GET /api/public/items"]:::endpoint
    n1 --> n3["reset-rate-buckets (hourly)"]:::cron
  ```
  Apply the class with the inline `:::name` operator as each node is first
  declared (extend the existing `node()` helper to take a class key). Edges stay
  symbol→caller, caller→endpoint, caller→cron (unchanged). `MAX_GRAPH_NODES` cap
  and the empty/`null` fallback stay.
- **Label escaping:** keep stripping `[]{}()<>|`; optionally switch the `"`
  replacement from `'` to the mermaid entity `#quot;` (grounded:
  `chunk-5ZQYHXKU.mjs:534-536`) to preserve quotes. Current behavior is safe;
  this is a minor fidelity bump.
- **Legend — rendered in React, NOT in Mermaid** (`BlastGraph`): a row beneath
  `<MermaidDiagram>` with four dots (solid `--accent` / `--text-muted` / `--ok` /
  `--warn`) + labels. Dots can use CSS vars (React-rendered, not inside the SVG):
  ```tsx
  <div style={{ display:"flex", flexWrap:"wrap", gap:14, marginTop:10, fontSize:12 }}>
    <LegendDot color="var(--accent)"    label={t("legend.changed")} />
    <LegendDot color="var(--text-muted)" label={t("legend.callers")} />
    <LegendDot color="var(--ok)"        label={t("legend.endpoints")} />
    <LegendDot color="var(--warn)"      label={t("legend.crons")} />
  </div>
  ```
- **`client/messages/en/blast.json`** — ADD a `legend` block (only new i18n):
  ```json
  "legend": {
    "changed": "changed symbol",
    "callers": "callers",
    "endpoints": "endpoints affected",
    "crons": "cron/jobs affected"
  }
  ```

---

## Phases

> All three implementation phases are **client-only** and **presentational** —
> they read existing `data.blast` / `BlastResponse`; no server, contract,
> hook-fetch, schema, or migration change (see Scope). The seven fixes split
> across **three file-disjoint files** plus one i18n file and one test file.
> Phases 1–3 own non-overlapping files and run **fully in parallel** (no edit
> collisions, no ordering constraint). Phase 4 (test update) **must run last** —
> it asserts the end-state produced by Phases 2 and 3.
>
> **File-contention reality (locked):** fixes 2, 3, 4, 7 all edit the same file
> `BlastCard.tsx`, so they CANNOT be sub-split into parallel slices — they are one
> implementer's slice (Phase 2). `OverviewTab.tsx`+`styles.css` (Phase 1) and
> `MermaidDiagram.tsx` (Phase 3) are each file-disjoint from `BlastCard.tsx` and
> from each other → those run concurrently with Phase 2.

| Phase | Owns (exclusive files) | Fixes | Runs |
|---|---|---|---|
| 1 — Layout grid | `OverviewTab.tsx`, `vendor/ui/styles.css` | 1 | concurrent with 2, 3 |
| 2 — Tree rows + graph classes + legend | `BlastCard.tsx`, `messages/en/blast.json` | 2,3,4,7 | concurrent with 1, 3 |
| 3 — Mermaid engine | `MermaidDiagram.tsx` | 5,6 | concurrent with 1, 2 |
| 4 — Test reconciliation | `BlastCard.test.tsx` | — | **after** 2 + 3 |

### Phase 1 — INTENT + BLAST side-by-side layout

- **Surface:** client (UI + global CSS)
- **Disjoint scope (exact files):**
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`
  - `client/src/vendor/ui/styles.css`
- **Depends on:** none. Owns files no other phase touches → safe to run
  concurrently with Phases 2 and 3.
- **Skills to apply:** `react-frontend-architecture` (keep the layout wrapper in
  the route's colocated `_components/`), `next-best-practices` (CSS media-query
  over a JS breakpoint hook → zero hydration cost / no SSR mismatch — the locked
  rationale in Fix 1).
- **What changes & why:** Fix 1 — wrap ONLY `<IntentCard>` + `<BlastCard>` in a
  `.brief-grid` div, keep `Description` as the next sibling so it stays full-width;
  add the `.brief-grid` global class (two equal columns, collapse to one below
  900px). Exact JSX + CSS locked in **Fix 1**. No `page.tsx` change.
- **Public surface:** new global CSS class `.brief-grid` in the shared stylesheet
  (purely additive; no existing selector changed). No new component export / prop.
- **Acceptance criteria:**
  - The two cards render inside a single element carrying class `brief-grid`;
    `Description` is a sibling of that element, not inside it.
  - `styles.css` contains a `.brief-grid` rule with `display:grid` +
    `grid-template-columns:1fr 1fr` and a `@media (max-width:900px)` rule
    collapsing to `1fr`.
  - No change to `page.tsx`; no inline `@media` / JS resize listener introduced.
  - `cd client && pnpm typecheck` clean.

### Phase 2 — Tree-row restyle + graph node classes + legend (BlastCard)

- **Surface:** client (UI + i18n)
- **Disjoint scope (exact files):**
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastCard/BlastCard.tsx`
    (`SymbolRow` `:227-316`, `LeafLine` `:318-334`, `BlastGraph` `:340-353`,
    `buildMermaid` `:390-436`)
  - `client/messages/en/blast.json` (add the `legend.*` block)
  - **NOT** `BlastCard.test.tsx` — that is Phase 4's file.
- **Depends on:** none for editing (sole owner of `BlastCard.tsx`). Runs
  concurrently with Phases 1 and 3.
- **Skills to apply:** `react-frontend-architecture` (legend is a small file-local
  `LegendDot` sub-component; reuse the existing `Badge` primitive, not a new pill),
  `react-best-practices` (derive the graph string via the existing `useMemo`; keep
  nodes/labels derived, not stored), `next-best-practices` (all new visible strings
  via `useTranslations("blast")`), `security` (every value stays repo-derived TEXT
  through `Badge` children / React escaping — no `dangerouslySetInnerHTML`).
- **What changes & why:** Fixes 2,3,4,7 — all locked in the Fix-by-fix section:
  - Fix 3: `<>` marker (`Icon.Code` `:271`) → `color:"var(--accent)"`, `strokeWidth:2.5`.
  - Fix 2: `N callers` span (`:277-281`) → `marginLeft:"auto"` to right-align.
  - Caller redesign (decision #2): replace `Icon.Users` (`:297`) with
    `Icon.CornerDownRight`, KEEP `{c.name}` + the `MonoLink` `{file}:{line}`.
  - Fix 4: endpoints/crons (`:306-311`, retiring `LeafLine`) → colored `Badge`
    pills, one per line (expanded children container → `alignItems:"flex-start"`).
  - Fix 7: `buildMermaid` emits `classDef changed|callers|endpoint|cron` (literal
    hex) + per-node `:::class`; a React-rendered legend row (4 `LegendDot`s)
    beneath `<MermaidDiagram>` in `BlastGraph`; add `legend.{changed,callers,
    endpoints,crons}` to `blast.json`.
- **Public surface:** none crosses a package boundary. New additive i18n keys
  `blast.legend.*`. `buildMermaid`'s output string gains `classDef` lines + `:::`
  suffixes — internal to BlastCard, but it is what Phase 4 re-asserts.
- **Acceptance criteria:**
  - `<>` marker uses `var(--accent)` + heavier `strokeWidth`; symbol name still
    `fontWeight:600`.
  - Caller-count span has `marginLeft:"auto"` (trailing in its flex row); text
    unchanged (`t("callerCount", { count })`).
  - Caller rows render `CornerDownRight`, the caller `name`, and the `file:line`
    `MonoLink` (github blob href + `#L{line}` preserved).
  - Each endpoint and each cron renders as a `Badge` (endpoint accent palette +
    `Globe`; cron `--warn` palette + `Clock`), one per line, at content width.
  - The string handed to `MermaidDiagram` starts with `flowchart`, contains
    `classDef changed`, `classDef cron`, and at least one `:::changed` /
    `:::endpoint` / `:::cron` suffix; `MAX_GRAPH_NODES` cap + null/empty fallback
    unchanged.
  - Legend row renders four dots + the four `legend.*` labels in Graph view.
  - `blast.json` gains a `legend` object with `changed`/`callers`/`endpoints`/
    `crons` keys.
  - `cd client && pnpm typecheck` clean.

### Phase 3 — Mermaid engine: font size + scroll viewport

- **Surface:** client (shared component — single consumer is BlastCard, verified)
- **Disjoint scope (exact files):**
  - `client/src/components/mermaid-diagram/MermaidDiagram.tsx`
    (`mermaid.initialize` `:37`, wrapper style `:61-74`)
- **Depends on:** none (sole owner). Runs concurrently with Phases 1 and 2.
- **Skills to apply:** `react-best-practices` (if exposing `maxHeight`, keep it a
  narrow defaulted prop; don't store derived layout in state),
  `react-frontend-architecture` (a shared `components/` primitive — the global
  change is justified by the verified single consumer; keep any new prop narrow).
- **What changes & why:** Fixes 5,6 — locked in the Fix-by-fix section:
  - Fix 5: add `themeVariables:{ fontSize:"18px" }` to `mermaid.initialize`.
  - Fix 6: add `flowchart:{ useMaxWidth:false }`; change the wrapper from
    `overflowX:"auto"` to `maxHeight:420, overflow:"auto"` (both axes), preserving
    border/bg/radius/padding. Optional: expose `maxHeight` prop defaulting to 420.
- **Public surface:** if the optional `maxHeight` prop is added, that is the only
  API change — additive + defaulted, so the existing BlastCard call site keeps
  compiling unchanged. `theme:"dark"` and `securityLevel:"strict"` stay.
- **Acceptance criteria:**
  - `mermaid.initialize` config includes `themeVariables.fontSize === "18px"` and
    `flowchart.useMaxWidth === false`; existing `startOnLoad:false`, `theme:"dark"`,
    `securityLevel:"strict"` retained.
  - The scroll wrapper has `overflow:"auto"` on both axes and a `maxHeight` of 420
    (literal or prop default).
  - If `maxHeight` prop is added, it defaults to 420 and BlastCard's existing usage
    still type-checks without passing it.
  - `cd client && pnpm typecheck` clean.

### Phase 4 — Reconcile BlastCard.test.tsx with the new UI

- **Surface:** client (test)
- **Disjoint scope (exact files):**
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastCard/BlastCard.test.tsx`
- **Depends on:** **Phase 2 AND Phase 3** (it asserts the markup Phase 2 produces
  and the `chart` string Phase 2's `buildMermaid` produces; the `MermaidDiagram`
  stub means Phase 3's runtime config is NOT exercised here — see Testing notes).
  Independent of Phase 1 (OverviewTab is not rendered by this test).
- **Skills to apply:** `react-testing-library` (assert user-visible output +
  accessible roles, not inline styles; `getByRole`/`getByText` first; don't assert
  internal state), `react-best-practices`.
- **What changes & why:** Several existing assertions are affected because callers
  swap `Users`→`CornerDownRight`, endpoints/crons become `Badge` pills, the graph
  string gains `classDef`/`:::`, and a legend appears. Update the affected ones and
  add the new-behavior assertions (full per-assertion list in **Testing &
  acceptance**). The fixture and the `MermaidDiagram` stub (captures the last
  `chart`) are reused unchanged.
- **Public surface:** none (test file).
- **Acceptance criteria:**
  - `cd client && pnpm test` passes (existing kept tests + updated + new
    assertions green).
  - No assertion couples to inline-style strings or component internals beyond
    what the existing suite already does (text/role/href/chart-string content).
  - The XSS guard and the empty-state / status-badge tests still pass unchanged.

---

## Testing & acceptance

**Commands (WSL only — the pnpm/Node toolchain lives in the WSL distro, per
`CLAUDE.local.md`):**
```
wsl.exe -d Ubuntu-24.04-dev-digest-test -- bash -lc 'cd client && pnpm test'
wsl.exe -d Ubuntu-24.04-dev-digest-test -- bash -lc 'cd client && pnpm typecheck'
```
There is **no** server build, **no** migration, and **no** `sync-shared` step in
this plan. Tests are Vitest + jsdom (RTL); `usePrBlast`, `useActiveRepo`,
`usePullDetail`, and `MermaidDiagram` are all mocked (`BlastCard.test.tsx:9-31`).

### Existing assertions affected (Phase 4)

1. **Caller rows — icon swap (`:115`,`:120-121`,`:127`):** tests find callers by
   `getByText("handleProfile")` / `getByText("syncJob")`. Decision #2 KEEPS the
   caller name, so these `getByText` calls **still pass** — only the leading icon
   changes `Users`→`CornerDownRight` (no icon is queried by role/name today).
   Verify they still resolve after the markup change (the name span must remain).
2. **Endpoint/cron text now inside a `Badge` (`:122-123`):** `getByText("GET
   /profile")` and `getByText("nightly-sync")` must still match — `Badge` renders
   `children` as text, so `getByText` continues to match. Confirm the pill does not
   split the label across elements (single text node per `Badge`; the icon is a
   sibling via the `icon` prop). If it ever wraps text in nested spans, fall back
   to a substring/normalizer matcher.
3. **Graph-string assertions (`:176-179`) — load-bearing, but resilient:**
   - `startsWith("flowchart")` → STILL true (Fix 7 keeps `flowchart LR` as line 1).
   - `toContain('"getUser"')` → STILL true (node is now `n0["getUser"]:::changed`;
     the `"getUser"` substring is preserved).
   - `toContain("-->")` → STILL true (edges unchanged).
   These use substring `toContain`, so they survive — the only required change is
   ADDING the new `classDef`/`:::` assertions. **Do NOT** tighten them to
   exact-match (that is the real Phase-4 hazard).

### New assertions to ADD (Phase 4)

**Tree view** (expand `getUser` first, as the existing test does at `:117`):
- **Right-aligned caller count:** assert the count text `t("callerCount",
  {count:2})` (e.g. "2 callers") is present on the `getUser` header row. RTL cannot
  reliably assert `marginLeft:"auto"` — assert the **text exists** (and lives in
  the symbol's header row), and treat true pixel alignment as a visual/manual check.
- **Accent/bold `<>` marker:** lucide `Icon.Code` renders an SVG with no accessible
  name — there is no clean role/text hook. Do NOT add a brittle
  `container.querySelector` style assertion. Treat the accent color + `strokeWidth`
  as a **visual/manual** acceptance item.
- **Endpoint/cron pills, one per line:** `getByText("GET /profile")` and
  `getByText("nightly-sync")` resolve (covered). Assert "pill, not plain text" only
  if `Badge` exposes a stable hook (e.g. it renders its icon identifiably);
  otherwise keep the text assertions and treat pill styling as visual/manual — do
  not over-assert.
- **Graph `classDef` + `:::` classes** (Graph view via
  `getByRole("button",{name:"graph"})`):
  - `expect(lastChart).toContain("classDef changed")`
  - `expect(lastChart).toContain("classDef cron")` (proves crons get the 4th amber class)
  - `expect(lastChart).toContain(":::changed")`
  - `expect(lastChart).toContain(":::endpoint")` (fixture has `GET /profile`)
  - `expect(lastChart).toContain(":::cron")` (fixture has `nightly-sync`)
- **Legend dots + labels** (Graph view): assert the four legend labels render via
  the mocked-intl messages — `getByText("changed symbol")`, the `callers` label
  (note: collides with the stat-row "callers" — use `getAllByText` + length, or
  scope with `within` the graph `role="img"` region), `getByText("endpoints
  affected")`, `getByText("cron/jobs affected")`. Requires the new `legend.*` keys
  in the test-imported `blast.json` (Phase 2's change — the test imports that file).

**Layout (Phase 1)** is **not covered** by `BlastCard.test.tsx` (it renders
`<BlastCard>` alone, not `<OverviewTab>`). The grid is CSS-only; there is no
OverviewTab test today. Phase 1's gate = the structural/`typecheck` criteria +
a **visual/manual** check at the 900px breakpoint. Don't add an OverviewTab test
purely to assert a CSS grid (low value per the testing philosophy) unless the
implementer wants a thin structural smoke test.

### What RTL CAN and CANNOT assert here (explicit)

- **CAN:** the `chart` string `buildMermaid` produced (the stub captures the last
  `chart`, `:26-31`), all visible text (labels, counts, legend), accessible roles
  (toggle buttons, the graph `role="img"`), anchor `href`/`target`/`rel`.
- **CANNOT (honest limits):** anything about the REAL Mermaid render —
  `fontSize:"18px"`, `useMaxWidth:false`, the 420px scroll viewport, SVG node
  fill/stroke colors. The diagram is mocked, so **Phase 3's config is never
  exercised by this suite** → it is a visual/manual acceptance item (no
  `MermaidDiagram` unit test exists today). Do not assert inline styles
  (`marginLeft`, `alignItems`, stroke color) — brittle, and the testing skill
  flags them as anti-patterns.

### Test-change count (Phase 4)

- **0 tests deleted** — all 11 existing tests kept.
- **~2 existing tests touched defensively** (Tree-expand `:104-128`, Tree/Graph
  toggle `:161-184`) — verified still-passing, guarded against over-tight rewrites.
- **~5 new graph-string `toContain` assertions** (`classDef changed`/`classDef
  cron`/`:::changed`/`:::endpoint`/`:::cron`) **+ 4 new legend-label assertions**.
  No new fixture, no new mock.

### Global acceptance (whole plan)

- All 7 fixes visible in the running app (`pnpm dev`, Overview tab of a PR with a
  populated index): INTENT|BLAST side-by-side (and stacked <900px); right-aligned
  `N callers`; blue/bold `<>`; `↳` caller rows with name + file:line; endpoint
  (accent) and cron (amber) pills one-per-line; larger graph font; graph scrolls in
  a 420px viewport; colored graph nodes + 4-dot legend.
- `cd client && pnpm typecheck` and `cd client && pnpm test` both green (WSL).
- No `dangerouslySetInnerHTML`; no hardcoded UI strings; no edit to the
  `BlastResponse` contract / server / DB.
- Wrap-up: run `engineering-insights` to sweep for any non-obvious finding (e.g.
  the mermaid-11 `themeVariables.fontSize` quirk) into `client/INSIGHTS.md`;
  `pr-self-review` before pushing (UI surface → react/next skills).

---

## Risks & mitigations

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | **Dark graph in a light card (pre-existing).** Mermaid is always `theme:"dark"` (`MermaidDiagram.tsx:37`); in the app's LIGHT theme a dark graph sits in a light card. This pass does NOT change `theme`. | Low (pre-existing, out of scope) | Note it; do not "fix" here (scope creep). The literal-hex classDef palette (Risk 2) is chosen to stay consistent with the always-dark graph. Candidate follow-up if the owner wants theme-aware graphs. |
| 2 | **Literal-hex classDef won't adapt to theme (intended).** Fix 7 uses literal hex, not CSS vars, because vars are unreliable inside the sanitized strict-mode SVG. | Low (by design) | Intended + grounded. Legend dots stay on CSS vars (they live outside the SVG). Document that the graph hex == dark-theme token values at time of writing; accept minor drift risk if a token is later retuned. |
| 3 | **Fixed 420px viewport on a shared component.** Hardcoding `maxHeight:420` bakes a BlastCard choice into a generic primitive. | Low (single consumer today, verified) | Expose `maxHeight` as an optional prop defaulting to 420 so it is overridable when a second consumer appears — avoids premature abstraction without hard-wiring. |
| 4 | **Breaking existing BlastCard tests.** The icon swap, Badge pills, and graph-string changes could break the 11 assertions if Phase 4 lags or over-tightens. | Medium | Sequence Phase 4 strictly AFTER Phases 2+3. Existing graph assertions are substring `toContain` and caller/endpoint queries use `getByText` on preserved labels → most survive; the hazard is an over-eager exact-match rewrite. Keep graph assertions as substrings; re-run `pnpm test` to green before done. |
| 5 | **900px breakpoint is CSS-only — invisible to jsdom.** jsdom has no layout engine; the responsive collapse can't be unit-tested. | Low | Validate the breakpoint **visually/manually** (resize across 900px) — the right tool for a CSS media query, not RTL. Phase 1's automated gate = `typecheck` + structural presence of the `.brief-grid` rule. |
| 6 | **`Badge` text-node splitting could break `getByText`.** If `Badge` wraps `children` in nested spans or interleaves the icon inside the text node, `getByText("GET /profile")` may not match a single node. | Low | The `Badge` primitive renders `children` directly (icon is a separate element via the `icon` prop). Confirm during Phase 2 that the label stays a single text node; else Phase 4 uses a normalizer/substring matcher. |
| 7 | **MermaidDiagram global edit (Phase 3) affects all consumers.** Editing a shared component is globally scoped. | Low (verified single consumer = BlastCard) | The single-consumer fact makes the global edit safe; `theme`/`securityLevel` retained; `useMaxWidth:false` + font only affect intrinsic SVG sizing/legibility. The `maxHeight` prop (Risk 3) is the override seam for a future consumer. |
| 8 | **i18n drift — missing `legend.*` keys.** The legend renders `t("legend.changed")` etc.; absent keys → next-intl throws / renders the raw key, and the legend RTL assertions fail. | Low | Phase 2 adds the `legend` block to `messages/en/blast.json` (the exact file the test imports). Phase 2 acceptance includes key presence; Phase 4's legend assertions transitively verify them. |
