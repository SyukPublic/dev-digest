# Development Plan: In-diff deep-links for brief risk refs and review-focus items

- **Spec:** docs/specs/SPEC-2026-07-06-in-diff-risk-ref-links.md
- **Execution mode:** single-agent

## Context

On the PR detail page the RISK AREAS rows (IntentCard) and the REVIEW FOCUS list
(ReviewFocusSection) each point a reviewer at exact places to look, but every ref
today bounces OUT to a github.com blob link — even when the ref targets a file the
PR actually changed and which is already rendered internally in the "Files changed"
tab (`SmartDiffViewer`). This feature implements the intent already anticipated in
the shared contract comment: when a ref's target is a changed file present in the
current PR diff (with a stored patch, and — for a ranged ref — a range that
intersects the file's new-side hunk lines), the link jumps INTERNALLY (Overview →
Files tab) and opens+scrolls+highlights the target inside `SmartDiffViewer`; when
the target is not confidently in the diff, it keeps today's github.com blob
behavior unchanged (a cascade fallback so no link is ever dead).

The whole decision and jump are CLIENT-ONLY: computed from data the page already
holds (`pull.data.files` patches + `parsePatch` new-side line numbers) and driven
through the existing `?tab=` query-string state extended with `file` and `line`
keys. No server, contract, `@devdigest/shared`, or DB change. **Spec goal
restated:** a reviewer reading the brief jumps straight into the in-app diff for
anything the PR changed, and still reaches github.com for everything else, with no
new network call.

## Requirements review & recommendations

The spec is internally consistent; all 12 ACs are testable (observable link
target, URL query shape, scroll spy, highlight class, focus destination, loading
state). No blocking ambiguity was found — no stop-and-ask was needed. Findings and
recommendations recorded during review (none block; all are implementation-level):

1. **`prefers-reduced-motion` has no JS reader today (AC-9).** The client only has
   the global CSS `@media (prefers-reduced-motion: reduce)` rule in
   `vendor/ui/styles.css` (client INSIGHTS 2026-06-27) — no JS `matchMedia` reader
   exists. AC-9 requires the JUMP behavior (smooth-scroll and highlight-flash) to
   change based on the preference, which is a runtime decision, so a small
   `window.matchMedia("(prefers-reduced-motion: reduce)")` read is needed in
   `SmartDiffViewer`. Recommendation: gate BOTH the `scrollIntoView` `behavior`
   (`"smooth"` → `"auto"`) and the transient highlight (skip the attention-flash)
   on that read; keep the highlight's non-color cue (focus move) unconditional so
   the jump always lands. Tests must stub `window.matchMedia` (jsdom has no
   implementation) — see the context pack.

2. **Focus target must be programmatically focusable (AC-9).** Focus moves to the
   jump destination (target line container or FileRow header). Line/row containers
   are `<div>`s today; to receive focus they need `tabIndex={-1}` added ONLY on the
   deep-link destination node (not every line — matches the spec's "anchors only on
   target lines" bound). Recommendation: reuse the same node that carries the deep-
   link anchor id and `.focus()` it after the `requestAnimationFrame` scroll.

3. **`scrollToLine` currently takes `(path, lineNo)` and finds a finding-line ref
   (AC-7/AC-8).** Deep-link target lines are NOT finding lines today, so their refs
   do not exist in `lineRefs`. The cleanest reuse (spec-endorsed) is to WIDEN the
   `id`/`ref` predicate so a line that is a deep-link target ALSO gets a
   `jumpTargetId` id + a `lineRefs` entry, then reuse the unchanged `scrollToLine`.
   Do NOT anchor all lines — only finding lines OR the active deep-link target
   line(s), preserving the DOM/ref bound (spec Non-functional / AC bound).

4. **AC-8 "first RENDERED line of the range" needs the rendered new-side line
   set.** `parsePatch` already yields per-line `newNo` for exactly the rendered
   lines; the "first rendered line of `[start..end]`" is the smallest `newNo` in
   that set intersecting the range. Recommendation: compute this in a pure helper
   (unit-testable) rather than inside the component, mirroring the existing pure-
   helper style of `helpers.ts`.

5. **Decision helper belongs in a pure, memoized module (Performance NFR).** The
   in-diff-vs-fallback decision (path membership + new-side hunk intersection) is
   pure and shared by IntentCard and ReviewFocusSection. Recommendation: put it in a
   NEW pure module so both consumers reuse ONE implementation, `parsePatch` is
   memoized per file (a `Map<path, Line[]>` built once from `pull.data.files`), and
   it is unit-tested in isolation. This also keeps IntentCard/ReviewFocusSection
   thin (they render; the decision is a function call).

## Affected packages & files

Client-only (`client/src`); no server, contract, DB, or `@devdigest/shared` change.

- **`.../_components/IntentCard/IntentCard.tsx`** — RISK AREAS `RiskRow` link
  decision: choose internal in-diff link vs today's `blobHref`→`githubBlobUrl`.
- **`.../_components/ReviewFocusSection/ReviewFocusSection.tsx`** — `FocusRow` link
  decision, same pattern (single `line` instead of a range).
- **`.../_components/SmartDiffViewer/SmartDiffViewer.tsx`** — consume the
  `file`/`line` deep-link target; open the containing group + FileRow; add anchor
  id + `lineRefs` entry + `tabIndex` on deep-link target line(s) (today only
  finding lines are anchored, lines 497–504); apply the whole-range transient
  highlight; move focus; respect reduced motion.
- **`.../_components/SmartDiffViewer/helpers.ts`** — extend with pure helpers:
  first-rendered-line-of-range + whether a line is a deep-link target (reuse
  existing `jumpTargetId`, lines 194–196).
- **`.../_components/SmartDiffViewer/constants.ts`** — NEW (per-module `constants.ts`
  convention): highlight duration ms, highlight CSS class name / marker.
- **`.../_components/DiffTab/DiffTab.tsx`** — thread the `file`/`line` deep-link
  target into `SmartDiffViewer` ONLY on the smart branch (`smart === true`); the
  flat `DiffViewer` branch is untouched (AC-12).
- **`.../[number]/page.tsx`** — read `file`/`line` from the query string (like the
  existing `tab`/`trace` reads, lines 64–65) and pass them down to `DiffTab`;
  reuse `setParam` (lines 66–71) as the transport writer.
- **NEW pure decision module** (recommended `.../_components/_shared/refLink.ts`
  or a `lib/` helper — see Phase 1 for placement) — the shared in-diff-vs-fallback
  decision + internal-URL builder, imported by IntentCard and ReviewFocusSection.
- **`messages/en/brief.json`** — any NEW user-facing string (e.g. an aria-label /
  title for an in-diff link) via next-intl; English-only (no other locale dir).

Reused unchanged: `client/src/lib/github-urls.ts` (`githubBlobUrl` fallback);
`client/src/components/diff-viewer/helpers.ts` (`parsePatch` → `newNo`);
`@/lib/hooks/core` (`usePullDetail`), `@/lib/repo-context` (`useActiveRepo`).

## Tasks

> Skill routing (UI surface, all phases): apply **react-frontend-architecture**,
> **react-best-practices**, **next-best-practices** before/while designing, and
> **react-testing-library** for the tests. `security` (always-on) governs the
> untrusted-input handling in AC-11. In single-agent mode the phases are an ordered
> sequence; later phases build on earlier ones (no disjoint-scope policing needed).
>
> **Green barrier (per phase and at the end):** run the client test suite +
> typecheck. Canonical command: `cd client && pnpm test` and `cd client &&
> pnpm typecheck`. NOTE (this machine only): execute via the WSL ext4 mirror —
> `bash scripts/test-mirror.sh client test` (~9.5s vs 24–40 min on the 9p bridge,
> TD-010) — and typecheck through the same WSL toolchain; never `pnpm test` from
> `/mnt/e`.

### Phase 1 — Pure in-diff decision + internal-URL builder (foundation)
- **Surface:** client
- **Skills to apply:** react-frontend-architecture (where the helper lives),
  react-best-practices (pure functions, derive-don't-store), security (AC-11
  untrusted path/range → integers, app-route-only URL), react-testing-library.
- **What changes & why:** Add ONE pure, memoization-friendly module that both link
  surfaces call, so the in-diff-vs-fallback decision has a single implementation and
  IntentCard/ReviewFocusSection stay thin. It answers, from `pull.data.files` +
  `parsePatch`: (a) is `path` a changed file with a stored `patch`? (b) does the
  ranged `start-end` / single `line` intersect that file's new-side (`newNo`) hunk
  lines? (c) build the internal PR-route query object (`tab=diff&file&line`) OR
  signal fallback. Range/line parsed to positive integers; the internal target is
  ONLY the app's own PR-route query keys (never an href protocol) — AC-11. Memoize
  `parsePatch` per file (a `Map<path, Line[]>` derived from `pull.data.files`) so
  rendering many refs never re-parses a patch (Performance NFR).
- **How to test:** new colocated unit test for the module (e.g.
  `refLink.test.ts`); `cd client && pnpm test` (mirror: `bash
  scripts/test-mirror.sh client test`).
- [ ] T1  New pure decision module: given `{ files }`, a `path`, and an optional
  `{ startLine?, endLine? }` / `line`, return `{ kind: "in-diff", file, line? }`
  when the path is a changed file WITH a stored patch and (for a ranged/line ref)
  the range/line intersects the file's new-side `newNo` hunk lines; otherwise
  `{ kind: "fallback" }`. Path-only / no-line ref whose path IS a diff file →
  `{ kind: "in-diff", file }` (no `line`). Pure; `parsePatch` memoized per path.  → AC-1, AC-2, AC-4, AC-5  → test_ref_link_decision
- [ ] T2  Internal-URL builder in the same module: from an `in-diff` result build
  the PR-route query shape `?tab=diff&file=<path>&line=<start-end|line>` (`line`
  omitted for a file-level jump), targeting ONLY the app PR route; range/line
  already parsed to positive integers; never emits an executable protocol.  → AC-3, AC-11  → test_ref_link_url

### Phase 2 — RISK AREAS link decision (IntentCard)  (depends on: Phase 1)
- **Surface:** client
- **Skills to apply:** react-frontend-architecture, react-best-practices,
  next-best-practices, security, react-testing-library.
- **What changes & why:** In `RiskRow` (IntentCard.tsx ~354–396), for each parsed
  `file_refs` entry, call the Phase-1 decision using `pull.data.files`. When it is
  `in-diff` AND the smart view is the active target (the internal link always points
  at `?tab=diff`, and SmartDiffViewer is that tab's default — AC-12 is enforced at
  the Files tab, see Phase 5), render an INTERNAL link (Next `Link`/router push to
  the built query URL) instead of `blobHref`→`githubBlobUrl`. When `fallback`,
  render EXACTLY today's `MonoLink`→`githubBlobUrl` (and its plain-mono-text
  degrade when repo/sha unknown). Path/label stay plain text (React auto-escape),
  no `dangerouslySetInnerHTML` — AC-11.
- **How to test:** extend `IntentCard.test.tsx`; mock `usePullDetail` with a `files`
  fixture (a patched file + a patch-less/absent file). `cd client && pnpm test`.
- [ ] T3  RISK AREAS ranged ref whose path+range match `pull.files` renders an
  INTERNAL link (href = app PR route `?tab=diff&file=…&line=start-end`), NOT a
  github.com URL.  → AC-1  → test_intent_indiff_ranged
- [ ] T4  RISK AREAS path-only ref whose path IS a diff file renders an internal
  FILE-LEVEL link (`?tab=diff&file=…`, NO `line` param).  → AC-4  → test_intent_indiff_pathonly
- [ ] T5  RISK AREAS ref that is a caller/out-of-diff file, a patch-less file, or a
  ranged ref not intersecting new-side hunks (incl. a stale-brief mismatch) keeps
  today's `githubBlobUrl` fallback; repo/sha-unknown still degrades to plain mono
  text.  → AC-5, AC-11  → test_intent_fallback
- [ ] T6  Activating an in-diff RISK AREAS link sets the query state to
  `?tab=diff&file=…&line=…` (navigation via the router), and the internal href
  targets only the app PR route (no `javascript:`/executable protocol).  → AC-3, AC-11  → test_intent_activate_sets_query

### Phase 3 — REVIEW FOCUS link decision (ReviewFocusSection)  (depends on: Phase 1)
- **Surface:** client
- **Skills to apply:** react-frontend-architecture, react-best-practices,
  next-best-practices, security, react-testing-library.
- **What changes & why:** In `FocusRow` (ReviewFocusSection.tsx ~84–115) apply the
  same Phase-1 decision, using the item's single optional `line` (no range). In-diff
  with a `line` in the new-side hunks → internal `?tab=diff&file=…&line=<line>`; no
  `line` (whole-file focus) but path IS a diff file → internal file-level jump; else
  today's `githubBlobUrl` fallback. Reason/path stay plain text — AC-11.
- **How to test:** extend `ReviewFocusSection.test.tsx` with a `files` fixture.
  `cd client && pnpm test`.
- [ ] T7  REVIEW FOCUS item whose path+`line` match the diff renders an INTERNAL
  link (`?tab=diff&file=…&line=<line>`), not github.com.  → AC-2  → test_focus_indiff_line
- [ ] T8  REVIEW FOCUS item with NO `line` whose path IS a diff file renders an
  internal FILE-LEVEL link (no `line` param); an out-of-diff / non-intersecting /
  patch-less item keeps the `githubBlobUrl` fallback.  → AC-4, AC-5  → test_focus_pathonly_and_fallback

### Phase 4 — SmartDiffViewer deep-link target: open + scroll + highlight + focus + a11y  (depends on: Phase 1)
- **Surface:** client
- **Skills to apply:** react-frontend-architecture, react-best-practices,
  react-testing-library (jsdom stubs), security.
- **What changes & why:** Teach `SmartDiffViewer` to accept a deep-link target
  `{ file, line? }` (threaded from DiffTab in Phase 5) and, once the diff data has
  loaded, OPEN the containing group + the target FileRow, then reuse the existing
  open-then-scroll pattern (`requestAnimationFrame` → `scrollToLine`, lines
  379–388/106–109). Extend the line `id`/`ref` predicate (lines 497–504) so a
  deep-link target line ALSO gets a `jumpTargetId` id + a `lineRefs` entry +
  `tabIndex={-1}` (anchors added ONLY for finding lines OR the active deep-link
  target line — DOM/ref bound preserved). Add pure helper(s) in `helpers.ts` for the
  first-RENDERED-line-of-range and range membership. Apply a transient whole-range
  highlight (new `constants.ts` duration + class). Move focus to the destination
  (target line node, else FileRow header). Respect `prefers-reduced-motion`: read
  `window.matchMedia("(prefers-reduced-motion: reduce)")` and, when reduced,
  scroll with `behavior:"auto"` and skip the highlight flash (jump still lands;
  focus move is the always-present non-color cue).
- **How to test:** extend `SmartDiffViewer.test.tsx` + `helpers.test.ts`. Stub
  `Element.prototype.scrollIntoView = vi.fn()` (jsdom has none — client INSIGHTS
  2026-06-26) and `window.matchMedia`; assert group/FileRow open, scroll spy
  called with the first new-side line, highlight class applied to the range, focus
  moved, and reduced-motion path uses `behavior:"auto"`/no flash.
- [ ] T9  Pure helpers in `helpers.ts`: given a file's parsed lines and a
  `[start,end]` (or single line), return the FIRST rendered new-side line in the
  range (smallest `newNo` intersecting) and the full set of rendered new-side lines
  in range; unit-tested independently.  → AC-7, AC-8  → test_smartdiff_range_helpers
- [ ] T10  A line-target deep-link opens the containing group + FileRow, defers via
  `requestAnimationFrame`, scrolls to the FIRST new-side line of the range, and
  applies the transient whole-range highlight (target line(s) gain a `jumpTargetId`
  id + `lineRefs` entry, added only for the deep-link target — not all lines).  → AC-6, AC-7  → test_smartdiff_line_jump
- [ ] T11  When the range is partly/wholly outside the rendered hunks: scroll to the
  first RENDERED line of the range and highlight what is rendered; when NO line of
  the range is rendered, scroll to the matched FileRow header — never throw.  → AC-8  → test_smartdiff_out_of_range
- [ ] T12  In-diff jump respects `prefers-reduced-motion` (scroll `behavior:"auto"`,
  no highlight flash when reduced; jump still lands) and moves keyboard/AT focus to
  the jump destination (target line node, else FileRow header) via `tabIndex={-1}`
  + `.focus()`.  → AC-9  → test_smartdiff_reduced_motion_and_focus

### Phase 5 — Transport wiring: URL params → DiffTab → SmartDiffViewer; SmartDiffViewer-only  (depends on: Phase 4)
- **Surface:** client
- **Skills to apply:** react-frontend-architecture, react-best-practices,
  next-best-practices, react-testing-library.
- **What changes & why:** Extend `page.tsx` to read `file`/`line` from the query
  string (alongside `tab`/`trace`, lines 64–65) and pass them to `DiffTab`. In
  `DiffTab` pass the target into `SmartDiffViewer` ONLY on the smart branch
  (`smart && prId`, line 92) — the flat `DiffViewer` branch receives nothing, so
  refs/URLs never drive in-diff handling there (AC-12; the internal link is emitted
  by Phases 2–3 only for `?tab=diff`, and SmartDiffViewer is that tab's default). On
  a directly opened / reloaded / shared URL, the open+scroll+highlight applies once
  `pull.files` + smart-diff have loaded; while loading, the Files tab shows its
  normal loading state (existing `smartDiff.isLoading` early return, SmartDiffViewer
  line 111) and the jump is applied when data arrives — no error.
- **How to test:** extend `DiffTab.test.tsx` (params reach SmartDiffViewer on the
  smart branch, NOT the flat branch) and `SmartDiffViewer.test.tsx` (loading →
  jump-on-load). Optionally a `page.test.tsx`/router assertion for param read.
  `cd client && pnpm test`.
- [ ] T13  Files tab mounted with `file`/`line` params (from an in-app click OR a
  directly opened/reloaded/shared URL) opens the target group + FileRow and applies
  the jump once the diff data is present.  → AC-6  → test_difftab_params_open_target
- [ ] T14  While `file`/`line` are present but the diff data has not finished
  loading, the Files tab shows the normal loading state (no error) and applies the
  open+scroll+highlight once data has loaded.  → AC-10  → test_difftab_loading_then_apply
- [ ] T15  With the flat `DiffViewer` active (`smart === false`), no in-diff handling
  occurs — the deep-link target is not passed to the flat branch and RISK AREAS /
  REVIEW FOCUS links keep github.com behavior for that view.  → AC-12  → test_difftab_flat_no_indiff

## Traceability matrix

| AC    | Task        | Test                                   | Commit |
|-------|-------------|----------------------------------------|--------|
| AC-1  | T1, T3      | test_intent_indiff_ranged              | —      |
| AC-2  | T1, T7      | test_focus_indiff_line                 | —      |
| AC-3  | T2, T6      | test_intent_activate_sets_query        | —      |
| AC-4  | T1, T4, T8  | test_intent_indiff_pathonly            | —      |
| AC-5  | T1, T5, T8  | test_intent_fallback                   | —      |
| AC-6  | T10, T13    | test_difftab_params_open_target        | —      |
| AC-7  | T9, T10     | test_smartdiff_line_jump               | —      |
| AC-8  | T9, T11     | test_smartdiff_out_of_range            | —      |
| AC-9  | T12         | test_smartdiff_reduced_motion_and_focus| —      |
| AC-10 | T14         | test_difftab_loading_then_apply        | —      |
| AC-11 | T2, T5, T6  | test_ref_link_url                      | —      |
| AC-12 | T15         | test_difftab_flat_no_indiff            | —      |

<Commit is "—" at planning time; the implementer fills it as tasks land;
plan-verifier audits AC↔task↔test coverage against this table.>

## Risks & mitigations

- **`scrollIntoView` / `matchMedia` absent in jsdom → tests throw or no-op.**
  Mitigation: stub `Element.prototype.scrollIntoView = vi.fn()` (client INSIGHTS
  2026-06-26) and `window.matchMedia` in `beforeEach`; assert on the spy, not real
  scrolling. Use `fireEvent` (NOT `@testing-library/user-event` — not a dependency;
  client INSIGHTS Tooling 2026-06-24).
- **Anchoring every diff line would bloat the DOM/refs on large PRs.** Mitigation:
  extend the `id`/`ref` predicate ONLY to finding lines OR the active deep-link
  target line(s) (spec bound, AC-7 note); never blanket-anchor.
- **Re-parsing each file's patch per rendered ref (Performance NFR).** Mitigation:
  memoize `parsePatch` per file path (a `Map<path, Line[]>` derived once from
  `pull.data.files`) inside the Phase-1 decision module; the decision is otherwise a
  cheap membership + range-intersection check.
- **Stale brief refs producing dead/incorrect internal links.** Mitigation: the
  decision is recomputed from the CURRENT `pull.files` each render; a ranged ref that
  no longer intersects the new-side hunks (or whose file has no patch) falls back to
  github.com (AC-5) — never an internal dead link.
- **Untrusted LLM-derived path/range forcing a bad href (OWASP A05).** Mitigation:
  the internal target is ONLY the app PR route with `tab`/`file`/`line` query keys;
  range/line parsed to positive integers; path/reason rendered as plain text (React
  auto-escape, no `dangerouslySetInnerHTML`); fallback stays an https blob via
  `githubBlobUrl` (AC-11).
- **`CollapsibleCard` title is string-only** (client INSIGHTS 2026-07-05) — do NOT
  try to embed the internal `Link` in the RISK row *title*; refs already render on
  their own body rows below the title (IntentCard.tsx ~376–388), which is where the
  link swap happens. No change to the title contract needed.

## Critical files for implementation

- `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/SmartDiffViewer.tsx`
  (open+scroll+highlight+focus; deep-link line anchors — lines 379–388, 106–109, 497–504)
- `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/helpers.ts`
  (`jumpTargetId` 194–196; new range helpers)
- `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/IntentCard.tsx`
  (`RiskRow`/`parseFileRef`/`blobHref` — the RISK AREAS link swap)
- `client/src/app/repos/[repoId]/pulls/[number]/_components/ReviewFocusSection/ReviewFocusSection.tsx`
  (`FocusRow`/`blobHref` — the REVIEW FOCUS link swap)
- `client/src/app/repos/[repoId]/pulls/[number]/page.tsx` + `.../_components/DiffTab/DiffTab.tsx`
  (query-param transport + SmartDiffViewer-only wiring)

## Open questions / assumptions

Non-blocking assumptions (each faithful to the spec; surface to the caller only if
wrong):
- **Placement of the Phase-1 shared decision module.** Assumed a route-local shared
  location (e.g. `_components/_shared/refLink.ts`) since it is PR-detail-specific glue
  (a helper, not a project-agnostic util); if a second, non-PR-detail consumer ever
  appears it can be promoted to `lib/`. Either placement satisfies the plan; the
  implementer picks per react-frontend-architecture colocation guidance.
- **Internal navigation mechanism.** Assumed the existing `setParam`/router
  `router.replace` transport (page.tsx 66–71) for click activation, and a Next
  `Link`/anchor whose `href` is the built app-route URL so reload/share works
  (AC-3, US-4); both keep the href on the app's own route (AC-11).
- **New i18n string(s).** Assumed at most an aria-label/title for the in-diff link,
  added under the existing `brief` namespace in `messages/en/brief.json` (English
  only). Ref path/range text is data, not a UI string.
- **Reduced-motion detection is a one-shot read at jump time** (not a live media-query
  subscription) — sufficient for AC-9 since the preference rarely changes mid-jump;
  a subscription would be gold-plating.
