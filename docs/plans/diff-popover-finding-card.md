# Development Plan: Full finding card in the Smart Diff inline-tag popover

## Context

In the Smart Diff viewer, clicking an **inline finding tag** on a diff line opens a
popover that today shows only a **condensed one-line preview** (`FindingPreviewList`:
severity + title + category + file:line + confidence + 2-line rationale clamp). It has
no SUGGESTED FIX and no actions.

We want that inline-tag click to instead show the **full finding card** — the same rich
component used on the "Agent runs" tab (`FindingCard`): markdown rationale, optional
SUGGESTED FIX block, confidence, category, severity, and **functional Accept/Dismiss
buttons**. This makes a single click on a line tag enough to read and act on the finding
without leaving the diff.

Intended outcome: the inline-tag popover renders one or more expanded `FindingCard`s
(stacked vertically, scroll if tall), wired to the existing `useFindingAction()` mutation
so Accept/Dismiss persist and — for Dismiss — the tag disappears after refetch.

### The 5 confirmed product decisions (do NOT re-litigate)

1. **Scope:** ONLY the inline line-tag click changes. The file-header severity-badge
   popover (scoped to ALL of the file's findings) keeps its CURRENT condensed
   `FindingPreviewList` + chrome behavior, unchanged.
2. **Accept/Dismiss:** fully functional — wired to `useFindingAction()`
   (`POST /findings/:id/accept|dismiss`), which invalidates `["reviews", prId]`.
   Dismissing removes the tag from the diff after refetch (dismissed findings are already
   filtered out upstream in `joinSmartDiff`).
3. **Multiple findings on one line:** stack ALL full cards vertically in the popover
   (scroll if needed).
4. **Popover chrome:** KEEP a simple header (uppercase title + close `X`) in card-mode for
   usability; REMOVE only the `SeverityFilter` chips (and the preview list). *(Revised
   post-implementation: the header was initially dropped, but the title + close affordance
   proved useful, so it is retained in both modes; only the filter chips are card-mode-only
   omitted.)* The header-badge popover KEEPS its full chrome (header + chips, it stays a list).
5. **Primary card expanded + focused; the rest collapsed.** The stack is ordered
   **worst-severity-first**; the FIRST card (the one whose severity matches the clicked
   inline tag — the tag renders the line's worst severity) renders **`defaultExpanded` +
   `focused`**. All OTHER cards render **collapsed** (`defaultExpanded={false}`) and
   `focused={false}`. The chevron stays functional on every card so the user can expand/
   collapse any of them manually. (Refined from the earlier "all expanded" via the design
   discussion: only the tag-matching finding opens automatically.)

### Final design rules from the discussion (binding)

- **Card-mode popover width = 480px** (vs the 400px default). The badge-path popover stays
  400px. The viewport `left`-clamp must use the card-mode width.
- **Empty stack ⇒ auto-close.** After an Accept/Dismiss leaves **zero** live findings on the
  clicked line, the popover closes itself. While ≥1 card remains, it stays open so the user
  can act on the others.
- **`onPick` is NOT wired in card-mode** — the card is self-contained (rationale + fix shown
  in place), so no scroll-to-line navigation. The badge path keeps `onPick`.
- **Stack ordering & primary:** order `findingsAtLine.get(lineNo)` by severity descending
  (CRITICAL > WARNING > SUGGESTION > INFO), tie-break by original array order; `primaryId` =
  the first finding after this sort (== the tag's worst severity). Only `primaryId` is
  expanded + focused.
- **GitHub deep-link kept** — the card's `MonoLink` keeps linking to the GitHub blob via
  `repoFullName`+`headSha` (same as Agent runs); degrades to plain text when either is null.
- **`onAction` carries only `"accept"`/`"dismiss"`** — no `reply` argument.
- **Tests:** integration cases in `SmartDiffViewer.test.tsx` only; no separate popover unit
  test, no change to `FindingCard.test.tsx`.

## Chosen architecture: Approach (A) — render-prop / `children` injection

**Decision: Approach (A).** The shared popover (`components/findings/FindingsFilterPopover.tsx`)
stays dumb. SmartDiffViewer (which legally lives in the same route tree as `FindingCard`)
passes the card content **into** the popover. The popover gains a "card mode" that, when
content is injected, skips its chrome (title header + `SeverityFilter` chips) and renders
the injected content instead of `FindingPreviewList`.

### Why (A), and why not (B)/(C)

- The conflict: `FindingCard` is **route-private**
  (`app/repos/[repoId]/pulls/[number]/_components/FindingCard/`), while
  `FindingsFilterPopover` is **shared** (`components/findings/`). A shared component
  importing a route-private one is a **backwards dependency** — it inverts the
  dependency direction (`shared → features → app`; lower layers must never import from
  higher ones — `react-frontend-architecture`: "Import boundaries & dependency direction",
  CRITICAL). It would also drag the `prReview` i18n namespace and the route's domain into
  a generic shared widget.
- **(A) keeps the arrow correct.** The shared popover only knows about a `renderContent`
  slot (a `ReactNode`/render-prop) — a generic primitive with no knowledge of `FindingCard`.
  The route composes the two (`react-frontend-architecture`: "Composition over
  configuration" + "use `children`/slots", HIGH). No file moves, no broad blast radius, no
  importer churn.
- **(B) promote `FindingCard` to `components/findings/`** would fix the direction by moving
  the card down a layer, but: (i) `FindingCard` uses `useTranslations("prReview")` and the
  PR-review domain vocabulary — it is a feature component, not a cross-cutting primitive, so
  moving it to `shared` is a premature/incorrect promotion (`react-frontend-architecture`:
  "Promote only when a second consumer appears", AHA); (ii) it forces edits to every
  importer (`FindingsPanel`, `FindingsTab`, `ReviewRunAccordion`, `FindingCard.test.tsx`,
  the `index.ts` barrel) — larger, riskier diff for no architectural gain over (A).
- **(C) a new card-mode wrapper popover** adds a third component and indirection
  (`react-best-practices`: wrappers that only pass props through add indirection without
  value) when (A) achieves the same with one optional prop on the existing popover.

### Trade-off accepted

The popover grows one optional prop and a branch ("if `renderContent`, render it without
chrome; else current list behavior"). This is a small, explicit complexity increase on a
shared component, justified because it keeps the dependency direction legal and is reused
by both the inline-tag path (card) and stays backward-compatible for the badge path (list).

> **architecture-reviewer will validate this choice** (dependency direction:
> `shared → features`; no route-private import inside `components/findings/`). The plan is
> written so the shared popover never imports `FindingCard`.

## Affected packages & files

All changes are in `client/` (the only package touched). No backend, no `@devdigest/shared`,
no migrations.

- `client/src/components/findings/FindingsFilterPopover.tsx` — **CHANGE.** Add an optional
  `renderContent?: React.ReactNode` (card-mode) prop. When provided, skip the header +
  `SeverityFilter` rows and render `renderContent` in the scrollable body instead of
  `FindingPreviewList`. When absent, behavior is byte-for-byte unchanged. (~111 lines today.)
- `client/src/components/findings/styles.ts` — **POSSIBLE CHANGE.** May add a `cardBody`
  style (scrollable, gap-stacked) for card-mode; reuse `s.panel`'s `maxHeight: "60vh"` +
  `overflow` for scroll. No change to existing keys.
- `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.tsx`
  — **CHANGE.** In `FileRow`: import `FindingCard` + `useFindingAction`; track whether the
  open popover is the line-tag path vs the badge path; for the line-tag path pass
  `renderContent` = a stack of `<FindingCard … defaultExpanded onAction={…} pending={…} />`.
  Keep the header-badge path exactly as-is (list). Source `repoFullName`/`headSha` (see
  Phase 2). (~367 lines today; `FileRow` ~182–367, popover state ~206–216, inline tag
  button ~331–358, badge button ~261–278.)
- `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.test.tsx`
  — **CHANGE (tests).** Mock `useFindingAction` in the existing `@/lib/hooks/reviews`
  mock; provide the `prReview` namespace to the intl provider; add card-mode assertions.
- `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.test.tsx`
  — **NO CHANGE expected** (FindingCard is reused unchanged); listed only as the reference
  for card behavior assertions.

### Existing utilities/functions to REUSE (do not re-create)

- `FindingCard` — `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx`.
  Reused **as-is**. Props confirmed: `{ f: FindingRecord; focused?; defaultExpanded?;
  onAction?: (action, reply?) => void; pending?; repoFullName?: string|null; headSha?:
  string|null }`. Already renders rationale (`<Markdown>{f.rationale}</Markdown>`), optional
  SUGGESTED FIX (`<Markdown>{f.suggestion}</Markdown>`, label `t("finding.suggestedFix")`),
  Accept (`kind=secondary icon=Check`) / Dismiss (`kind=ghost icon=X`) via `onAction`. No
  data fetching; only `useTranslations("prReview")` + `useState`. Import via the existing
  barrel: `import { FindingCard } from "../FindingCard";`.
- `useFindingAction()` — `client/src/lib/hooks/reviews.ts:140-162`. `useMutation`; call
  `action.mutate({ findingId, action, prId })`; `action.isPending` /
  `action.variables?.findingId` available to derive a per-finding `pending` flag.
- `findingsByStartLine(file.findings)` — already memoized in `FileRow`
  (`SmartDiffViewer.tsx:200`) as `findingsAtLine`; the line-tag already passes
  `findingsAtLine.get(lineNo) ?? []` into `togglePopover` (line 341). Reuse this list as
  the cards to stack.
- `togglePopover` / `closePopover` / `popover` state — `SmartDiffViewer.tsx:206-216`.
  The popover key already distinguishes paths: `"badge"` (line 269) vs `` `line-${lineNo}` ``
  (line 341). Reuse `popover.key.startsWith("line-")` to branch card-mode vs list.
- `FindingsPanel` — `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx`
  is the **reference wiring** of `FindingCard` + `useFindingAction`
  (`onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}`, lines
  76-87). Mirror this exactly.
- i18n: `prReview.finding.*` keys (Accept/Dismiss/Suggested fix/accepted/dismissed) already
  exist in `client/messages/en/prReview.json:2-13` — FindingCard consumes them; no new
  strings needed for the card. `shell.diffViewer.*` (title/close/empty/sev tags) unchanged.

## Shared scaffold (context pack)

Parallel implementers must NOT each re-open these files. The verbatim fragments and exact
citations they need are below; phases reference this section.

### S1 — Popover prop contract (the seam between Phase 1 and Phase 2)

Add to `FindingsFilterPopover`'s props **one optional field**:

```ts
/** Card-mode: when provided, the popover renders this instead of the
 *  FindingPreviewList AND hides its chrome (title header + SeverityFilter).
 *  Used by the Smart Diff inline-tag path to show full FindingCards. */
renderContent?: React.ReactNode;
```

Behavior contract the two phases agree on:
- `renderContent` **absent/undefined** ⇒ popover is byte-for-byte today's behavior
  (header, filter row, `FindingPreviewList` / loading / empty). Header-badge path relies on
  this — DO NOT regress it.
- `renderContent` **present** ⇒ render `role="dialog"` panel that KEEPS `s.header` (title +
  close `X`) but has NO `s.filterRow` / NO `SeverityFilter`; body is a scrollable stack
  containing exactly `renderContent`. Outside-click + Escape close still apply. `counts`/
  `findings`/`emptyTitle`/`emptyBody` may be passed but are ignored in card-mode; `title` +
  `closeLabel` ARE used (visible header + close button), and `anchor`/`onClose` as always.
  *(Revised post-implementation — header retained in card-mode for usability.)*

### S2 — Current popover render shape (verbatim, `FindingsFilterPopover.tsx:81-110`)

The card-mode branch slots into this exact structure (the outer portal/dialog +
`onClick={(e) => e.stopPropagation()}` must be preserved; only the inner header/filter/body
changes):

```tsx
return createPortal(
  <div
    ref={ref}
    role="dialog"
    aria-label={title}
    style={{ ...s.panel, top, left, width }}
    onClick={(e) => e.stopPropagation()}
  >
    <div style={s.header}>
      <span style={s.headerTitle}>{title}</span>
      <IconBtn icon="X" onClick={onClose} label={closeLabel} />
    </div>

    <div style={s.filterRow}>
      <SeverityFilter counts={counts} active={active} onToggle={toggle} />
    </div>

    {loading ? (
      <div style={s.loadingStack}> … </div>
    ) : shown.length === 0 ? (
      <EmptyState … />
    ) : (
      <FindingPreviewList findings={shown} onPick={onPick} />
    )}
  </div>,
  document.body,
);
```

Note `s.panel` already has `maxHeight: "60vh"`, `overflow: "hidden"`, `display:"flex"`,
`flexDirection:"column"` (`styles.ts:5-19`). In card-mode the body wrapper needs
`overflowY:"auto"` to scroll tall stacks (decision #3). The existing `s.list` already does
`overflowY:"auto"; padding:6; display:flex; flexDirection:column; gap:2` — a card-mode body
can reuse a similar pattern (gap larger, e.g. 8) or add `s.cardBody`.

### S3 — FindingCard wiring (verbatim, the reference is `FindingsPanel.tsx:76-87`)

The exact `onAction` shape to reproduce in SmartDiffViewer. Build the stack from a
severity-sorted copy of the live line findings and expand/focus only the primary:

```tsx
// SEV_RANK: CRITICAL=0, WARNING=1, SUGGESTION=2, INFO=3 (lower = worse/first)
const ordered = [...liveFindings].sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
const primaryId = ordered[0]?.id;
// ...
ordered.map((f) => (
  <FindingCard
    key={f.id}
    f={f}
    defaultExpanded={f.id === primaryId}   // only the tag-matching card opens (decision #1/#3/#5)
    focused={f.id === primaryId}            // highlight the tag-matching card (decision #3)
    pending={action.isPending && action.variables?.findingId === f.id}
    repoFullName={repoFullName}
    headSha={headSha}
    onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
  />
))
```

`liveFindings` = `findingsAtLine.get(lineNo) ?? []` recomputed each render from the live
`file.findings` (NOT the captured `popover.findings` snapshot — see Risks "stale snapshot").
When `liveFindings.length === 0` after a dismiss, close the popover (auto-close, decision
above). Do NOT pass `onPick` in card-mode.

`useFindingAction` returns a `useMutation` result; `action.mutate({ findingId, action,
prId })` invalidates `["reviews", prId]` on success (`reviews.ts:158-161`). The per-finding
`pending` flag is derived from `action.variables?.findingId` so only the card being acted on
is disabled (FindingsPanel uses the coarser `action.isPending`; the finer form is preferred
here because multiple cards can be stacked — see Risks).

### S4 — Sourcing `repoFullName` / `headSha` inside SmartDiffViewer (verified)

- `headSha`: **self-sourceable.** `SmartDiffViewer` already calls `usePullDetail(prId)` as
  `pull` (`SmartDiffViewer.tsx:71`). `PrDetail` includes `head_sha`
  (`vendor/shared/contracts/platform.ts:174`, inherited by `PrDetail` at line 215). So
  `pull.data?.head_sha ?? null`.
- `repoFullName`: **NOT on `PrDetail`** (no `full_name` field on `PrMeta`/`PrDetail`). The
  page derives it from repo-context: `activeRepo?.full_name ?? null` (`page.tsx:80-83`).
  Inside SmartDiffViewer use the same source: `const { activeRepo } = useActiveRepo();`
  (from `@/lib/repo-context`) → `activeRepo?.full_name ?? null`.
- **Graceful degradation:** `FindingCard` already guards
  `repoFullName && headSha ? githubBlobUrl(...) : undefined` (`FindingCard.tsx:46-49`); when
  either is null `MonoLink` renders with `href={undefined}` and degrades to plain text. So a
  null `repoFullName` is safe — no crash, just a non-linked file ref.

### S5 — i18n namespaces in play (no new strings for the card)

- `FindingCard` uses `useTranslations("prReview")` → keys `finding.accept`, `finding.dismiss`,
  `finding.suggestedFix`, `finding.accepted`, `finding.dismissed` — **all already exist**
  (`messages/en/prReview.json:2-13`).
- `SmartDiffViewer`/popover use `useTranslations("shell")` → `diffViewer.*`. Unchanged.
- **Test consequence:** the existing `SmartDiffViewer.test.tsx` provides only
  `messages={{ shell }}` (line 123). Because the inline-tag popover now renders a
  `FindingCard` that reads `prReview`, the test's `NextIntlClientProvider` must also supply
  `prReview` (import `messages/en/prReview.json`, pass `messages={{ shell, prReview }}`).
  This is a test-only change (Phase 3), but Phase 2 implementers must know rendering a card
  in jsdom without `prReview` throws a missing-message error.

## Phases

> Phases 1 and 2 touch disjoint files and can run in parallel **against the agreed S1 prop
> contract**. Phase 3 (tests) depends on both. Phase 4 (i18n) is a no-op verification gate
> that can run anytime.

### Phase 1 — Card-mode in the shared popover
- **Surface:** client (UI)
- **Disjoint scope (owns):**
  `client/src/components/findings/FindingsFilterPopover.tsx`,
  `client/src/components/findings/styles.ts` (additive only).
  Does NOT touch `SmartDiffViewer*`, `FindingPreviewList.tsx`, `helpers.ts`.
- **Depends on:** none (implements the S1 contract; the consumer is Phase 2).
- **Skills to apply:** `react-frontend-architecture` (keep the popover a dumb,
  composition-friendly primitive — no `FindingCard` import here, CRITICAL dependency
  direction), `react-best-practices` (conditional rendering: no `{x && …}` on numbers;
  early-return the card-mode branch; keep `onClick stopPropagation` so inner clicks don't
  bubble to the outside-click handler), `next-best-practices` (component stays `"use client"`,
  no server import).
- **What changes & why:** Add optional `renderContent?: React.ReactNode` (S1). When present,
  render the portal/dialog exactly as S2, KEEPING `s.header` (title + close `X`) but
  **omitting** `s.filterRow` / `SeverityFilter`, and render
  `renderContent` inside a scrollable body wrapper (reuse `s.panel` max-height; add/keep
  `overflowY:"auto"` on the body). **Card-mode width = 480px** (vs the 400px default): set the
  card-mode width wherever `width` is currently determined, and ensure the existing `left`
  viewport-clamp (`Math.min(Math.max(anchor.left,8), innerWidth-width-8)`) uses the card-mode
  width so a 480px panel still clamps inside the viewport. When absent, render today's
  structure verbatim (400px). The
  severity-filter `useState`/`toggle`/`shown` memo may stay (harmless, unused in card-mode)
  or be skipped in card-mode — keep them mounted to avoid conditional-hooks issues; just
  don't render the filter UI.
- **Acceptance criteria:**
  - With `renderContent` undefined: identical DOM to before (header, `SeverityFilter`,
    `FindingPreviewList`/empty/loading) — header-badge path unaffected.
  - With `renderContent` set: dialog KEEPS the header (visible title + close `X`) but renders
    NO `SeverityFilter` chips and NO `FindingPreviewList` — just the injected node.
  - Outside-click and Escape still call `onClose` in both modes; clicks **inside** the panel
    do not close it (`onClick stopPropagation` retained).
  - Body scrolls when content exceeds `maxHeight: 60vh`.
  - No import of any `app/.../_components/**` file from this shared file.
- **How to test:** `cd client && pnpm test` (run in WSL — see Test plan). Covered indirectly
  by Phase 3 SmartDiffViewer tests; a direct popover unit test is optional. `pnpm typecheck`
  must pass (new optional prop is backward compatible).

### Phase 2 — SmartDiffViewer wiring (inline-tag → cards; badge path unchanged)
- **Surface:** client (UI)
- **Disjoint scope (owns):**
  `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.tsx`.
  Does NOT touch the shared popover or its styles (consumes Phase 1's prop), does NOT touch
  the test file (Phase 3).
- **Depends on:** the S1 prop contract (can develop in parallel; integrates once Phase 1's
  `renderContent` lands — coordinate on the prop name `renderContent`).
- **Skills to apply:** `react-frontend-architecture` (route composes shared popover +
  route-private `FindingCard` — legal direction; import `FindingCard` via `../FindingCard`
  barrel and `useFindingAction` via `@/lib/hooks/reviews`), `react-best-practices`
  (`FindingCard` list keyed by `f.id` not index — CRITICAL key rule; derive per-finding
  `pending` don't store; extract the card stack so JSX stays readable; no business logic in
  render), `next-best-practices` (stays `"use client"`).
- **What changes & why:**
  1. In `FileRow`, add `const action = useFindingAction();` and source
     `repoFullName`/`headSha` per S4 (`useActiveRepo()` for `full_name`; `pull` is at the
     `SmartDiffViewer` level — pass `headSha`/`repoFullName` down into `FileRow` as props, or
     read `useActiveRepo()` inside `FileRow` and thread `headSha` from the parent. Prefer
     threading both from `SmartDiffViewer` into `GroupCard`→`FileRow` as props to keep
     `usePullDetail` a single call — see Risks/positioning note. Either is acceptable; state
     the choice in the diff.).
  2. Branch the rendered popover on path: when `popover.key.startsWith("line-")`, pass
     `renderContent` = a vertical stack of `FindingCard` (one per finding in
     `popover.findings`, using S3 wiring, `defaultExpanded`, per-finding `pending`). When
     `popover.key === "badge"`, render the popover exactly as today (list — decisions #1/#4).
  3. Keep `onPick`, `counts`, `title`, `anchor`, `onClose` wiring intact for the badge path.
     For the card path, `onPick`/`counts` are irrelevant (still safe to pass; popover ignores
     them in card-mode).
  4. Dismiss flow: `action.mutate` invalidates `["reviews", prId]`; `usePrReviews` refetches;
     `joinSmartDiff` re-filters dismissed findings so the tag/card disappears — no extra code
     needed (decision #2). **DECIDED (live-source + auto-close):** render the card stack from
     the live `findingsAtLine.get(lineNo)` recomputed each render (NOT the captured
     `popover.findings` snapshot), so an accepted card updates in place and a dismissed card
     drops out after refetch. When the live list for the open line becomes **empty**, close
     the popover (auto-close). While ≥1 card remains, keep it open so the user can act on the
     others. (The `popover.findings` snapshot may still be used only to remember which line/key
     is open; the rendered cards come from the live source.)
- **Acceptance criteria:**
  - Clicking an inline line tag opens a popover containing full `FindingCard`(s) for that
    line — rationale (markdown), SUGGESTED FIX (when present), confidence, category, severity,
    Accept + Dismiss buttons — with the simple header (title + close `X`) kept but NO
    `SeverityFilter` chips. The **primary** card
    (worst severity / tag-matching) is **expanded + `focused`**; all others **collapsed**,
    `focused={false}`, chevron still toggles each.
  - Multiple findings on one line ⇒ all their cards stacked vertically, ordered
    worst-severity-first; popover scrolls; card-mode width 480px.
  - After an Accept/Dismiss empties the line (zero live findings), the popover auto-closes.
  - Accept calls `useFindingAction().mutate({ findingId, action: "accept", prId })`; Dismiss
    likewise with `"dismiss"`.
  - After a successful Dismiss + refetch, that finding's inline tag is gone from the diff.
  - The header-badge popover STILL shows the condensed `FindingPreviewList` of ALL the file's
    findings, with its title header + `SeverityFilter` chips — unchanged (decisions #1/#4).
  - File ref in the card deep-links to GitHub when `repoFullName` + `headSha` are known;
    degrades to plain text otherwise (no crash) — S4.
  - `pnpm typecheck` clean.
- **How to test:** `cd client && pnpm test` (WSL). Validated by Phase 3 cases.

### Phase 3 — Tests
- **Surface:** client (UI tests)
- **Disjoint scope (owns):**
  `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.test.tsx`.
  Does NOT touch production files.
- **Depends on:** Phase 1 + Phase 2 (asserts integrated behavior).
- **Skills to apply:** `react-testing-library` (query by role/text, `userEvent`/`fireEvent`
  as the file already uses `fireEvent`, assert on observable DOM not internals),
  `react-best-practices`.
- **What changes & why:**
  1. Extend the existing `vi.mock("@/lib/hooks/reviews", …)` (lines 11-17) to also export
     `useFindingAction: () => ({ mutate: vi.fn(), isPending: false, variables: undefined })`
     (or a captured spy to assert calls). Keep `usePrSmartDiff`/`usePrReviews`/comment hooks.
  2. Add `prReview` to the intl provider: import
     `prReview from "../../../../../../../../messages/en/prReview.json"` and render
     `messages={{ shell, prReview }}` in `renderViewer` (line 121-127) — required because the
     card reads `prReview` (S5). The existing fixtures (`REVIEWS`, lines 83-119) already
     supply `rationale`; add a `suggestion` to at least one finding to assert the SUGGESTED
     FIX block. `FindingRecord` fixtures should also include the card-consumed fields they
     lack (they already have severity/category/title/file/lines/rationale/confidence/
     accepted_at/dismissed_at; `suggestion` is nullish so optional).
  3. New/updated test cases (extend the existing `describe("SmartDiffViewer", …)`):
     - **Inline-tag click shows full card, not preview:** expand `server/src/service.ts`,
       click the `"blocker"` tag, assert the dialog contains the rationale markdown text
       ("Null deref on the happy path"), an `"Accept"` button and a `"Dismiss"` button, KEEPS
       the simple header (visible `"Findings"` title + a `"Close"` button) but does NOT render
       the severity-filter chips (no button named `/findings \(\d+\)/i`). (Replaces/
       augments the existing "clicking the inline 'blocker' tag opens a popover scoped to that
       line's finding only" test at lines 218-236 — keep its scoping assertion: shows "Boom",
       not "Nit".)
     - **SUGGESTED FIX rendered** when the finding has `suggestion` (assert
       `t("finding.suggestedFix")` label text "Suggested fix" + the suggestion body).
     - **Accept fires the mutation:** click `"Accept"`, assert the `useFindingAction` mutate
       spy was called with `{ findingId: "f1", action: "accept", prId: "pr1" }`.
     - **Dismiss fires the mutation:** likewise with `action: "dismiss"`.
     - **Multiple cards stacked:** a line with 2 findings ⇒ 2 cards in the dialog (add a
       fixture where two findings share `start_line`).
     - **Clicking inside the card does NOT close the popover:** click the Accept button (or
       card body) and assert the dialog is still present (guards the outside-click/
       stopPropagation interaction — Risks).
     - **Header-badge path UNCHANGED:** keep/confirm the existing
       "opens the findings popover on header-badge click, listing ALL the file's findings"
       (lines 256-274) and "picking a finding … scrolls … and closes" (lines 276-292) tests
       still pass — they assert the LIST behavior and title `"Findings"`, which must remain
       for the badge path.
- **Acceptance criteria:** all existing SmartDiffViewer tests still green; new card-mode
  cases green; the header-badge tests unmodified in intent and passing.
- **How to test:** `cd client && pnpm test` in WSL (`wsl.exe -d Ubuntu-24.04-dev-digest-test
  -- bash -lc 'cd /mnt/e/Sources/.../client && pnpm test'`). jsdom note: `scrollIntoView` is
  already stubbed in `beforeEach` (line 131) — keep it; the badge path's `onPick` still scrolls.

### Phase 4 — i18n verification (no new strings expected)
- **Surface:** client (i18n)
- **Disjoint scope (owns):** read-only check of `client/messages/en/prReview.json` and
  `client/messages/en/shell.json`. Likely **zero edits**.
- **Depends on:** none.
- **Skills to apply:** `next-best-practices`.
- **What changes & why:** Confirm the card needs no new keys — `finding.accept`,
  `finding.dismiss`, `finding.suggestedFix`, `finding.accepted`, `finding.dismissed` already
  exist (`prReview.json:2-13`); the inline-tag/badge `diffViewer.*` keys are unchanged. Only
  if a NEW user-facing string is introduced (e.g. an empty-stack message after dismiss) add
  it under the appropriate namespace via next-intl — NOT hardcoded (`client/AGENTS.md`: "UI
  strings go through next-intl"). Default expectation: no edits.
- **Acceptance criteria:** no hardcoded UI strings added; if any string is needed it lives in
  `messages/en/*.json` and is referenced via `useTranslations`.
- **How to test:** `pnpm typecheck` + visual; `pnpm test` covers message resolution.

## Test plan

- **Runner:** Vitest + jsdom + React Testing Library (`client/AGENTS.md`: "Tests: Vitest +
  jsdom (fetch mocked; no live API)"). Run via `cd client && pnpm test`.
- **Where they run:** in WSL per `CLAUDE.local.md` —
  `wsl.exe -d Ubuntu-24.04-dev-digest-test -- bash -lc 'cd
  /mnt/e/Sources/NeoVersity/Projects/AIAgenticEngineering/dev-digest/client && pnpm test'`.
- **Files to extend:**
  - `SmartDiffViewer.test.tsx` — primary suite (the recent `verify:l03` classifier work added
    this file's smart-diff/classifier cases; extend the same `describe`). Add the
    `useFindingAction` mock + `prReview` messages + the card-mode cases listed in Phase 3.
  - `FindingCard.test.tsx` — **no change**; it already asserts the card's accept/dismiss
    (lines 52-59) and rationale/file:line (37-50). It is the contract proof that the reused
    card behaves; SmartDiffViewer tests only need to prove the *wiring*, not re-test the card.
- **`verify:lNN` note:** per the repo's recent commits there is a `verify:l03` suite
  convention. Run the package's `pnpm test` (or the lesson-scoped `verify:l03` script if the
  change is being graded for L03) to keep that suite green; the new assertions live in the
  existing client test file, not a new `.sql-core`/verify file.
- **Typecheck:** `pnpm typecheck` in `client/` for both new props and wiring.

## DO NOT CHANGE (explicit)

- **Header-badge popover behavior:** the file-header severity-badge (`key === "badge"`,
  `SmartDiffViewer.tsx:261-278`) MUST keep rendering the condensed `FindingPreviewList` of
  ALL the file's findings, with its uppercase title header + `SeverityFilter` chips. Card-mode
  applies ONLY to `key.startsWith("line-")` (decisions #1, #4).
- **`FindingPreviewList.tsx`** — the condensed list component stays as-is; it is still used by
  the badge path here and by the PR-list / timeline popovers elsewhere.
- **`@devdigest/shared` barrel** — no edits to the shared contracts barrel or any existing
  `vendor/shared` file; this feature needs no contract change (`FindingRecord` already has
  `rationale`, `suggestion`, `confidence`, etc.).
- **`FindingCard`** — reused unchanged; do NOT move it to `components/findings/` (Approach A,
  not B). Do NOT add card-specific props to it.
- **`joinSmartDiff` / `findingsByStartLine` / `tagSeverityByLine`** — dismissed-finding
  filtering and tag derivation already work; do not alter (the dismiss-removes-tag behavior
  depends on the existing filter).
- **The shared popover's default (list) code path** — must stay byte-for-byte behaviorally
  identical when `renderContent` is absent.

## Risks & mitigations

- **Backwards dependency (CRITICAL, architecture).** Risk: the shared popover importing
  route-private `FindingCard`. Mitigation: Approach A — the popover only takes a
  `renderContent: ReactNode`; the route does the import/compose. architecture-reviewer will
  check `components/findings/**` has no `app/.../_components/**` import.
- **Stale `popover.findings` snapshot after accept/dismiss (HIGH, correctness).**
  `popover.findings` is captured at open time (`SmartDiffViewer.tsx:206-213`), so after a
  dismiss the open card stack won't auto-update from that snapshot. Mitigation (Phase 2):
  render the card stack from the **live** `findingsAtLine.get(lineNo)` (recomputed each render
  from `file.findings`) rather than the captured snapshot, so an accepted/dismissed card
  reflects fresh `accepted_at`/`dismissed_at` (or empties out) after refetch — OR close the
  popover on a successful action. Implementer MUST choose and document one; live-source is
  recommended (lets the user act on several stacked cards in one session).
- **Outside-click vs. clicks inside the card (HIGH).** The popover closes on `mousedown`
  outside `ref` (`FindingsFilterPopover.tsx:58-71`) and stops propagation on panel clicks
  (line 87). Accept/Dismiss buttons are inside the panel, so their clicks must NOT close it.
  Mitigation: keep `onClick={(e) => e.stopPropagation()}` on the panel in card-mode (S2);
  Phase 3 has an explicit "clicking inside does not close" test. Note the close listener is
  `mousedown` while buttons fire on `click` — a click inside is safe; verify no new
  `mousedown` handler is added that bubbles to document.
- **Popover positioning / overflow with tall stacked cards (MEDIUM).** Full cards (markdown +
  suggestion) are much taller than preview rows; multiple stacked can exceed the viewport.
  Mitigation: rely on `s.panel`'s `maxHeight: "60vh"` + a scrollable body (`overflowY:auto`)
  in card-mode (Phase 1). Horizontal: `width` default 400 may feel narrow for code in the
  SUGGESTED FIX block — acceptable for v1 (matches the badge popover width); a wider
  card-mode `width` is an optional polish, not required. `left` is already clamped to the
  viewport (`Math.min(Math.max(anchor.left,8), innerWidth-width-8)`, line 78); `top =
  anchor.bottom + 6` may push a tall popover below the fold but the body scrolls, so content
  stays reachable.
- **Empty findings array (MEDIUM).** A line tag only renders when `tagByLine.get(lineNo)`
  exists, and `findingsAtLine.get(lineNo)` is the same source, so the card path normally has
  ≥1 finding. Edge: after a dismiss empties the line (live-source approach), the stack could
  be empty. Mitigation: when the live card list is empty, either render nothing (popover shows
  an empty body) or auto-close; prefer auto-close on empty to avoid a blank dialog. (The badge
  path keeps its existing `EmptyState` for the filtered-to-zero case.)
- **i18n missing-namespace crash in tests (MEDIUM).** Rendering `FindingCard` (reads
  `prReview`) inside a provider that only has `shell` throws. Mitigation: Phase 3 adds
  `prReview` to the test provider (S5). Production already mounts both namespaces app-wide.
- **`useFindingAction` not in the test mock (MEDIUM).** The existing
  `vi.mock("@/lib/hooks/reviews")` (lines 11-17) does not export `useFindingAction`; once
  SmartDiffViewer calls it, the un-mocked import is `undefined` → crash. Mitigation: Phase 3
  adds it to the mock. (This is why Phase 3 depends on Phase 2.)
- **Focus management (LOW/MEDIUM, a11y).** The popover is a `role="dialog"` but does not trap
  focus today; the card's buttons are reachable by tab. Mitigation: out of scope to add a full
  focus trap (the badge path doesn't have one either — keep parity); ensure Accept/Dismiss
  have accessible labels (they render text "Accept"/"Dismiss", so they do) and that Escape
  still closes (existing handler). A focus trap is a possible follow-up, not part of this
  feature.

## Critical files for implementation

1. `client/src/components/findings/FindingsFilterPopover.tsx` — gains card-mode
   (`renderContent`); the seam between the two parallel phases.
2. `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.tsx`
   — the wiring: branch line-tag vs badge, stack `FindingCard`s, `useFindingAction`.
3. `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx`
   — reused unchanged; the card being injected (props/behavior contract).
4. `client/src/lib/hooks/reviews.ts` — `useFindingAction()` (mutation + cache invalidation).
5. `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.test.tsx`
   — must mock `useFindingAction` + add `prReview` messages + card-mode assertions.

## Open questions / assumptions — ALL RESOLVED in the design discussion

- **Empty line after Dismiss → RESOLVED: auto-close.** Close the popover when the live line
  findings hit zero; stay open while ≥1 remains.
- **Card-mode `width` → RESOLVED: 480px** (badge path stays 400px).
- **Chevron / expansion → RESOLVED:** chevron functional on all; only the primary
  (worst-severity / tag-matching) card is `defaultExpanded` + `focused`; rest collapsed.
- **`onPick` in card-mode → RESOLVED: not wired** (card is self-contained).
- **GitHub deep-link → RESOLVED: kept** (as on Agent runs).
- **`reply` arg → RESOLVED: not used** (only `accept`/`dismiss`).
- **Tests → RESOLVED:** integration cases in `SmartDiffViewer.test.tsx` only.
- **Per-finding `pending` granularity → DECIDED:** derive from
  `action.variables?.findingId === f.id`; fall back to `action.isPending` if `variables` is
  not conveniently exposed (coarser; acceptable).
- **`repoFullName`/`headSha` sourcing → DECIDED:** self-source inside `SmartDiffViewer`
  (single `usePullDetail` + `useActiveRepo` at the top, threaded down into `FileRow` as
  props). `DiffTab.tsx` / `page.tsx` unchanged.
- **Assumption:** `DiffTab` keeps calling `<SmartDiffViewer prId={prId} />` with no new prop
  (SmartDiffViewer self-sources `headSha` via `usePullDetail` and `repoFullName` via
  `useActiveRepo`), so `DiffTab.tsx` needs NO change. If the implementer instead chooses to
  pass `repoFullName`/`headSha` from the page down through `DiffTab`, that widens scope to
  `DiffTab.tsx` + `page.tsx` — NOT recommended; self-sourcing keeps the change inside
  SmartDiffViewer.
```