# Development Plan: Brief & Onboarding UI Refinements

- **Spec:** docs/specs/SPEC-2026-07-05-brief-and-onboarding-ui-refinements.md
- **Execution mode:** single-agent

## Context

Two shipped features — the Onboarding Generator and the Why+Risk Brief — were
reviewed against their design screenshots. The review produced six UI-polish
groups (R1, R3–R6) plus one backend layering-debt item (R2). None of them
change what either feature *does*; they refine how the shipped result looks and
reads, and pay down one composition-root inconsistency. The spec's own goal, in
one line: **make both features match their intended design more closely and
bring the onboarding backend onto the house container-getter pattern, without
regressing any feature behavior, contract, or LLM-call budget (zero on read;
one per generation).**

Concretely: R1 merges the Reading-path section's two duplicate lists into one
list driven by the facade-authoritative `links[]`, with backward-compat for
already-stored tours (a prompt/label-semantics change on the server side plus a
client renderer change). R2 adds a lazy `container.onboardingRepo` getter and
has the onboarding service consume it. R3–R5 are pure client presentation over
already-fetched data (Review-focus reframe + reorder; RISK AREAS title/refs
layout; PR-brief header controls). R6 changes one page-level i18n string.

## Requirements review & recommendations

The spec is approved (Status: approved), carries zero `[NEEDS CLARIFICATION]`
markers, and both prior open points (R5.2 idle-state appearance, R6 uk wording)
are resolved and folded into AC-11 / AC-18. AC-1…AC-18 are testable and
internally consistent. Execution mode was provided: **single-agent**. No
blocking questions — proceeding straight to the plan.

Findings from reviewing the ACs against the current code (all confirmed by
reading the cited files):

- **R5 i18n is already in place.** `messages/{en,uk}/brief.json` already define
  `regenerate` = "Regenerate brief" / "Перегенерувати бриф" and `empty.cta` =
  "Generate brief" / "Згенерувати бриф". So R5's "Regenerate brief" label and
  the header "Generate brief" CTA reuse EXISTING keys — R5 needs **no new brief
  i18n keys** (AC-14 is satisfied by reuse). The plan reuses them rather than
  adding duplicates. This is a recommendation folded into the tasks: do NOT add
  a second Regenerate/Generate key.
- **R2 is code catching up to docs.** Both `repository.ts:10-18` ("Constructed
  in the composition root as `container.onboardingRepo` (CP-6)") and
  `service.ts:36-38` already *claim* the repo is reached via
  `container.onboardingRepo`; only the constructor (`service.ts:55-57`) still
  `new`s it directly. R2 makes the code match the docstrings.
- **R2 test compatibility is real and low-risk.** `onboarding-service.test.ts`
  spies `OnboardingRepository.prototype.{getByRepo,upsert}` and builds a fake
  container object that has NO `onboardingRepo` getter. A lazy getter that
  still `new OnboardingRepository(container.db)` keeps prototype-spies working
  — BUT the service must read `this.container.onboardingRepo` (a getter on the
  fake plain object, currently absent). The fake container in the test must
  therefore gain an `onboardingRepo` field, OR the service must construct once
  in the ctor from the getter. Chosen approach (T-tasks below): service reads
  `container.onboardingRepo` **lazily at call sites / once in ctor via the
  getter**, and the test's `makeContainer` is updated to expose an
  `onboardingRepo` backed by `new OnboardingRepository(db)` so prototype-spies
  still intercept. (Server INSIGHTS 2026-06-30 documents the prototype-spy
  pattern for module-private repos; here the repo is being *promoted* to the
  container, so the fake container must expose it.)
- **R1 field-semantics recommendation.** The cleanest R1 shape keeps `links[]`
  authoritative and moves the per-file role/rationale into `link.label`
  (already the field the current renderer shows at `sections.tsx:57`), and
  turns `body` into a short intro or empty. The renderer must degrade
  gracefully for OLD stored tours whose `body` is the full numbered list and
  whose `label` is a short line — render one row per `links[]` entry, show the
  label when present, never re-render the `body` list as a second list. The
  safe, contract-preserving choice: **drop the `body` markdown list from the
  merged renderer entirely for `reading_path`** (the description now lives in
  `link.label`), so an old tour's duplicated `body` list simply isn't shown a
  second time (AC-1/AC-3). This is the recommended interpretation and is what
  the tasks encode; if the team wants to keep a short intro paragraph, that is
  an additive option that does not affect the ACs.
- **AC-9 (RISK AREAS) needs a CollapsibleCard extension.** `CollapsibleCard.title`
  is a plain `string` (client INSIGHTS 2026-07-05) rendered at fixed
  `fontSize:14/fontWeight:600` (`CollapsibleCard.tsx:82`), and the file refs
  currently sit inline in the header `right` slot (`IntentCard.tsx:370-386`).
  To get a 13px bold title AND refs on their own rows below the title, the
  refs must leave the `right` slot and render in the card BODY (above the
  explanation) or via a new backward-compatible prop. Recommended: render the
  refs as rows inside the CollapsibleCard **children** (body), and extend
  `CollapsibleCard` with an OPTIONAL `titleSize`/`titleClassName`-style additive
  prop (default unchanged = 14) so the title can be 13px without touching any
  other consumer (AC-9 + the "no breaking change" non-goal). Both are additive;
  defaults stay identical for `BriefInfo` and the tour cards.

## Affected packages & files

**client/** (R1, R3–R6 + tests)
- `src/app/repos/[repoId]/onboarding-tour/_components/OnboardingTourView/sections.tsx`
  — `ReadingPathSection` (R1): one merged list driven by `links[]`.
- `src/app/repos/[repoId]/onboarding-tour/_components/OnboardingTourView/styles.ts`
  — `pathRow`/`pathBody`/`pathPath`/`pathRationale` reshaped for the
  description-row-above-path-row layout with `[Open]` at the right edge.
- `src/app/repos/[repoId]/onboarding-tour/_components/OnboardingTourView/OnboardingTourView.tsx`
  — no logic change; the `label={t("onThisPage")}` wiring (line 132) already
  drives R6 through the string change.
- `src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`
  — reorder: PR Brief → intent/blast grid → Review focus → Description (R3).
- `src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/styles.ts`
  — add a framed-section style (reuse `descriptionBox` treatment) for Review
  focus if the frame lives at the OverviewTab level (R3).
- `src/app/repos/[repoId]/pulls/[number]/_components/ReviewFocusSection/ReviewFocusSection.tsx`
  — wrap the section in the shared card frame/background (R3); keep the
  render-nothing branches (AC-8).
- `src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/IntentCard.tsx`
  — `RiskRow` (R4): 13px bold title, refs as rows below the title.
- `src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/PrBriefCard.tsx`
  — `BriefInfo` compact (R5.1); `BriefHeader` Regenerate as a labeled Button
  in idle+pending (R5.2); header "Generate brief" CTA when no brief (R5.3).
- `src/vendor/ui/CollapsibleCard.tsx` — OPTIONAL additive `titleSize` prop
  (default 14) + compact variant support for R4/R5.1 (backward-compatible;
  reuse existing REUSE point for `BriefInfo`, risk rows, tour cards).
- `messages/en/onboarding.json` + `messages/uk/onboarding.json` — `onThisPage`
  value → "Onboarding Tour" (en) / "Ознайомчий тур" (uk) (R6); any R1
  reading-path copy if an intro string is introduced (none expected).
- `messages/{en,uk}/brief.json` — REUSE existing `regenerate`, `empty.cta`; add
  a compact-info label only if the compact info control needs distinct copy.
- Tests: `OnboardingTourView/sections.test.tsx`,
  `OnboardingTourView/OnboardingTourView.test.tsx` (inline messages + the two
  "On this page" assertions at lines 65-66, 304),
  `PrBriefCard/PrBriefCard.test.tsx`, `IntentCard/IntentCard.test.tsx`,
  `ReviewFocusSection/ReviewFocusSection.test.tsx`,
  `src/vendor/ui/CollapsibleCard.test.tsx` (if the additive prop is added).

**server/** (R1 prompt + R2 wiring + tests)
- `src/platform/container.ts` — add `private _onboardingRepo?` + lazy
  `get onboardingRepo()` mirroring `get projectContextRepo()` (R2).
- `src/modules/onboarding-generator/service.ts` — consume
  `container.onboardingRepo` instead of `new OnboardingRepository(...)` (R2).
- `src/prompts/onboarding.system.md` — `reading_path` rule: author the role +
  one-line rationale into `links[].label`; body becomes a short intro or empty
  (no duplicated numbered file list) (R1).
- Tests: `server/test/onboarding-service.test.ts` — `makeContainer` exposes
  `onboardingRepo` so prototype-spies still intercept (R2, AC-6/AC-17).

**@devdigest/shared** — no change (no new contract file, no barrel edit).

**Reuse (do not re-create):**
- `githubBlobUrl` (`client/src/lib/github-urls.ts`) — risk/focus file links.
- `fileViewerHref` + `FIRST_TASKS_MAX_LINKS` (`.../OnboardingTourView/helpers.ts`)
  — reading-path Open deep-links (unchanged, AC-5).
- Vendored `Button` (`@devdigest/ui`) — the labeled-button shape for R5.2, same
  as IntentCard's Recompute `Button` (`IntentCard.tsx:152-164`).
- `MonoLink`, `Card`, `SectionLabel`, `Badge`, `CollapsibleCard` primitives.
- `useBrief`, `usePullDetail`, `useActiveRepo`, `useRegenerateBrief` hooks —
  no new hooks; R3–R5 render already-fetched data (zero extra LLM).

## Tasks

### Phase 1 — R2: onboarding-generator container getter (server)
- **Surface:** server (backend)
- **Skills to apply:** `onion-architecture` (dependency direction: service →
  container getter → repository), `fastify-best-practices` only if wiring is
  touched (it is not), `typescript-expert`.
- **What changes & why:** `service.ts` currently `new`s its repository in the
  constructor — the only module outside the container-getter pattern. Add a
  lazy memoized `get onboardingRepo()` to the composition root (mirroring
  `get projectContextRepo()` at `container.ts:128-130`, `??=` over a private
  `_onboardingRepo` field) and have `OnboardingGeneratorService` obtain the
  repo from `container.onboardingRepo`. Behavior (getTour zero-LLM read,
  single-flight generate, upsert) is unchanged.
- **How to test:** `cd server && pnpm test` (unit; `onboarding-service.test.ts`)
  + `pnpm typecheck`. The existing prototype-spies on
  `OnboardingRepository.prototype.{getByRepo,upsert}` must keep intercepting;
  `makeContainer` gains an `onboardingRepo` backed by
  `new OnboardingRepository(db)` so the getter path is exercised.
- [x] T1  Add `private _onboardingRepo?: OnboardingRepository` + a lazy
  `get onboardingRepo(): OnboardingRepository { return (this._onboardingRepo ??= new OnboardingRepository(this.db)); }`
  to `Container`, mirroring `projectContextRepo`; import `OnboardingRepository`
  in `container.ts`.  → AC-6  → test_container_onboarding_repo_lazy
- [x] T2  Change `OnboardingGeneratorService` to obtain its repository from
  `this.container.onboardingRepo` (remove the direct `new OnboardingRepository(container.db)`
  in the ctor), keeping getTour/generate/upsert behavior identical.
  → AC-6  → test_service_uses_container_onboarding_repo
- [x] T3  Update `onboarding-service.test.ts` `makeContainer` to expose
  `onboardingRepo` (a real `new OnboardingRepository(db)` instance) so the
  service resolves the repo through the container AND the existing
  `OnboardingRepository.prototype` spies still intercept; assert getTour
  zero-LLM read and single-flight generate behavior are unchanged.
  → AC-6, AC-17  → test_onboarding_service_getter_wiring

### Phase 2 — R1: merge the Reading-path list (server prompt + client renderer)
- **Surface:** server prompt (backend, no code/contract change) + client (UI)
- **Skills to apply:** `react-frontend-architecture`, `react-best-practices`,
  `next-best-practices`, `security` (untrusted model text as data),
  `react-testing-library` (tests). No `zod`/contract change (shape unchanged).
- **What changes & why:** The `reading_path` section renders two duplicate
  lists today — a numbered `body` markdown list AND a mirrored `links[]` list
  (`sections.tsx:41-66`), because the prompt tells the model to reproduce the
  files in both places (`onboarding.system.md:18-24`). Change the prompt so the
  per-file role/one-line rationale is authored into `links[].label` and `body`
  becomes a short intro (or empty), NOT a duplicated numbered file list. Change
  `ReadingPathSection` to render ONE list driven by `links[]` (facade order,
  AC-1): each entry is a description row (from `link.label`) above a monospace
  file-path row with the Open control at the right edge. The list is ALWAYS
  driven by `links[]`; the old `body` list is not rendered as a second list.
  Backward-compat: old stored tours (full `body` list + short `label`) render
  one coherent row per `links[]` entry — path-only when `label` is
  missing/empty, never a blank row, never a crash (AC-3). No new LLM call on
  read (AC-4). The stored `Onboarding`/`OnboardingSection`/`OnboardingLink`
  contract and table shape are unchanged; the Open deep-link is unchanged (AC-5).
- **How to test:** `cd client && pnpm test`
  (`sections.test.tsx`, `OnboardingTourView.test.tsx`) + `pnpm typecheck`.
- [x] T4  Update `server/src/prompts/onboarding.system.md` `reading_path` rule
  so the model authors each file's role + one-line rationale into
  `links[].label` (mirroring the given file order) and keeps `body` a short
  intro or empty — NO duplicated numbered file list; contract/shape unchanged.
  → AC-1, AC-2  → test_prompt_reading_path_label_semantics (server:
  assert the prompt template no longer instructs a duplicated body list —
  string/render assertion via `renderPrompt` or a snapshot of the rule text)
- [x] T5  Rework `ReadingPathSection` (`sections.tsx`) to render exactly ONE
  `<ol>` driven by `section.links[]` in order: per entry a description row
  (from `link.label`, when present) above a row with the monospace `link.path`
  and the Open `MonoLink` at the right edge; do NOT render `section.body` as a
  second list. Model text (`label`, `path`) stays plain text / Markdown-as-data
  (no `dangerouslySetInnerHTML`); the Open href stays `fileViewerHref(...)`.
  → AC-1, AC-2, AC-5, AC-16  → test_reading_path_single_list
- [x] T6  Handle the backward-compat / degrade cases in `ReadingPathSection`:
  old stored tour (full-body list + short label), `body`-count ≠ `links`-count,
  empty `body`, and missing/empty `link.label` → still one row per `links[]`
  entry, path-only when no description, never a duplicated list / blank row /
  crash.  → AC-3  → test_reading_path_backward_compat
- [x] T7  Reshape the reading-path styles in
  `OnboardingTourView/styles.ts` (`pathRow`/`pathBody`/`pathPath`/`pathRationale`)
  for the description-row-above-path-row layout with `[Open]` right-aligned and
  usable at narrow widths.  → AC-1, AC-15  → test_reading_path_single_list
- [x] T8  Update `sections.test.tsx` (and any affected
  `OnboardingTourView.test.tsx` reading-path fixture/assertions) to assert ONE
  list per `links[]`, the description-above-path layout, the graceful
  fallbacks, and the preserved Open deep-link.
  → AC-1, AC-2, AC-3, AC-5, AC-17  → test_reading_path_single_list

### Phase 3 — R6: Onboarding-tour side-nav heading (client i18n)
- **Surface:** client (UI i18n)
- **Skills to apply:** `next-best-practices` (next-intl), `react-testing-library`.
- **What changes & why:** The in-page TOC heading reads the generic
  "On this page". Change ONLY the page-level `onboarding.onThisPage` string to
  the feature name so it renders as the uppercase feature name; the shared
  `OnThisPage` primitive (`vendor/ui/OnThisPage.tsx`) uppercases via CSS and
  uses the same `label` for the `<nav aria-label>`, so both the visible heading
  and the accessible name update from the one string. The primitive and its
  default behavior are NOT touched (AC-18 decision).
- **How to test:** `cd client && pnpm test` (`OnboardingTourView.test.tsx`) +
  `pnpm typecheck`.
- [x] T9  Set `onboarding.onThisPage` = `"Onboarding Tour"` in
  `messages/en/onboarding.json` and `"Ознайомчий тур"` in
  `messages/uk/onboarding.json` (reusing the existing uk feature-name
  translation, consistent with `title`); do NOT modify `OnThisPage.tsx`.
  → AC-18, AC-14  → test_toc_heading_feature_name
- [x] T10  Update `OnboardingTourView.test.tsx`: the inline `messages.onboarding.onThisPage`
  (lines 65-66) and the `getByRole("navigation", { name: "On this page" })`
  assertion (line 304) → the new heading value; assert the nav's `aria-label`
  follows the same string.  → AC-18, AC-17  → test_toc_heading_feature_name

### Phase 4 — R3: Review focus section frame + order (client)
- **Surface:** client (UI)
- **Skills to apply:** `react-frontend-architecture`, `react-best-practices`,
  `react-testing-library`.
- **What changes & why:** `ReviewFocusSection` renders a bare `<section>` with
  no card frame and sits AFTER the Description block (`OverviewTab.tsx:38-46`).
  Give it the same card frame/background as the other Overview sections (match
  the Description block's `descriptionBox` / the shared `Card` treatment) and
  move it BEFORE Description, producing the order PR Brief → intent/blast grid →
  Review focus → Description. Preserve the render-nothing branches (no brief /
  empty `review_focus` / loading) so the reframe never introduces an empty
  framed box (AC-8). Model text stays plain text; hrefs stay https/in-app only
  (AC-16).
- **How to test:** `cd client && pnpm test`
  (`ReviewFocusSection.test.tsx`; OverviewTab order via its test if present) +
  `pnpm typecheck`.
- [x] T11  In `OverviewTab.tsx`, move `<ReviewFocusSection />` ABOVE the
  Description `<section>` (final order: PR Brief → grid → Review focus →
  Description).  → AC-7  → test_overview_order
- [x] T12  Frame the Review focus section with the shared card background/border
  (reuse the `descriptionBox` treatment via `OverviewTab/styles.ts` or the
  `Card` primitive) so it matches the other Overview sections, keeping the
  existing render-nothing branches intact.  → AC-7, AC-8, AC-16
  → test_review_focus_framed
- [x] T13  Update `ReviewFocusSection.test.tsx` to assert the section renders
  inside the framed container when items exist AND renders nothing when there
  are no items / no brief / loading.  → AC-7, AC-8, AC-17
  → test_review_focus_framed

### Phase 5 — R4 + R5: RISK AREAS layout + PR-brief header controls (client)
- **Surface:** client (UI) — incl. the shared `CollapsibleCard` primitive
- **Skills to apply:** `react-frontend-architecture`, `react-best-practices`,
  `react-testing-library`, `security` (untrusted refs/titles as data).
- **What changes & why:**
  - **R4** — In `IntentCard`'s `RiskRow`, reduce the risk title to 13px while
    keeping it bold, and move the file refs OUT of the header `right` slot onto
    separate row(s) BELOW the title (inside the card body, above the
    explanation). Preserve the MonoLink → github-blob behavior at the head SHA,
    degrading to plain mono text when repo/sha is unknown; refs stay untrusted
    text. Extend `CollapsibleCard` additively (optional title-size prop,
    default 14 unchanged) so the 13px title needs no breaking change; existing
    consumers (`BriefInfo`, tour cards) keep identical defaults + expander
    semantics (whole header toggles, `aria-expanded`, chevron).
  - **R5.1** — Make `BriefInfo`'s "How this is built" info control compact
    (comparable to the "N findings · K blockers" badge), keeping it
    keyboard-operable with `aria-expanded`.
  - **R5.2** — Render the Regenerate control as a LABELED `Button` (icon +
    visible "Regenerate brief" text, reusing `brief.regenerate`) in BOTH idle
    and pending states — pending swaps the icon for a spinner + keeps the SAME
    label (not an icon-only spinner), stays disabled/non-interactive, constant
    size (no layout jump), mirroring IntentCard's Recompute `Button`
    (`IntentCard.tsx:152-164`).
  - **R5.3** — When no brief is stored, render the "Generate brief" CTA (reusing
    `brief.empty.cta`) in the header slot where Regenerate normally sits (next
    to the Score gauge cluster) as a SINGLE control (the empty-state body keeps
    only its explanatory text — no duplicate control); disabled with a progress
    affordance while pending; opening the page makes no LLM call.
  - **R5 error** — a failing generate/regenerate from the header CTA/Regenerate
    keeps the existing non-blocking error and leaves the prior brief + composed
    header intact.
- **How to test:** `cd client && pnpm test`
  (`IntentCard.test.tsx`, `PrBriefCard.test.tsx`, `CollapsibleCard.test.tsx`) +
  `pnpm typecheck`.
- [x] T14  Extend `CollapsibleCard` with an OPTIONAL additive prop for a
  smaller/compact title (e.g. `titleSize?: number`, default 14) and/or a
  compact header variant, keeping all existing defaults + expander semantics
  (whole header toggles, `aria-expanded`, chevron rotation) unchanged for
  current consumers.  → AC-9, AC-10, AC-11  → test_collapsible_card_additive
- [x] T15  In `IntentCard` `RiskRow`, render the title at 13px (still bold, via
  the new additive prop) and move `file_refs` rows into the card body BELOW the
  title (out of the `right` slot), preserving `parseFileRef` + `blobHref`
  MonoLink behavior (https/head-SHA, degrade to plain text), refs as untrusted
  text; a risk with no refs shows the title row only and still expands to its
  explanation.  → AC-9, AC-16  → test_risk_row_layout
- [x] T16  Update `IntentCard.test.tsx` to assert the 13px bold title, refs on
  separate rows below the title (not inline in the header), the no-refs case,
  and preserved link/expander behavior.  → AC-9, AC-17  → test_risk_row_layout
- [x] T17  Make `BriefInfo` (`PrBriefCard.tsx:368-382`) a compact affordance
  comparable to the findings/blockers badge, keyboard-operable with
  `aria-expanded` preserved.  → AC-10, AC-15  → test_brief_info_compact
- [x] T18  Replace the header Regenerate control (`PrBriefCard.tsx:274-292`)
  with a labeled `Button` (icon + `t("regenerate")`) shown in idle AND pending;
  pending = spinner + same label, disabled/non-interactive, constant size;
  keep the aria-live announcement.  → AC-11, AC-15  → test_regenerate_labeled
- [x] T19  When no brief is stored, render the "Generate brief" CTA
  (`t("empty.cta")`) in the header position (next to the Score gauge cluster) as
  the SINGLE Generate control; remove the duplicate button from
  `BriefEmptyBody` (keep only its explanatory text); disabled + progress
  affordance while pending; opening the page makes no LLM call.
  → AC-12, AC-15  → test_header_generate_cta
- [x] T20  Verify/keep the non-blocking generate/regenerate error path: a
  failure from the header CTA or Regenerate surfaces the existing inline error
  and leaves the prior brief + composed header intact.
  → AC-13  → test_generate_error_nonblocking
- [x] T21  Update `PrBriefCard.test.tsx` to cover: compact info control (AC-10);
  labeled Regenerate idle+pending, disabled while pending, no icon-only spinner
  (AC-11); single header Generate CTA when no brief with body keeping only text
  (AC-12); non-blocking error keeps header + prior brief (AC-13).
  → AC-11, AC-12, AC-13, AC-17  → test_prbriefcard_header_controls

### Phase 6 — i18n completeness + accessibility/security sweep (client)
- **Surface:** client (UI, cross-cutting)
- **Skills to apply:** `next-best-practices`, `security`, `react-testing-library`.
- **What changes & why:** Confirm every user-facing string touched by R1/R5/R6
  is sourced from next-intl in BOTH `en` and `uk` (reusing existing
  `brief.regenerate` / `brief.empty.cta`, adding only genuinely new keys, e.g.
  any R1 intro copy or a compact-info label if introduced) with no hardcoded
  text and uk-expansion-tolerant layout; and that the changed controls preserve
  keyboard operability + `aria-expanded`, never convey state by color alone,
  keep the Regenerate/Generate accessible name + aria-live, keep model text as
  data (no `dangerouslySetInnerHTML`), and restrict file-link hrefs to safe
  protocols. This is a verification/finish phase over Phases 2–5 (no new
  behavior).
- **How to test:** `cd client && pnpm test` (full client suite) + `pnpm typecheck`.
- [x] T22  Audit all strings introduced/changed by this feature: ensure each
  exists in `messages/en/*` AND `messages/uk/*` (reuse existing keys where they
  already cover the copy; add new keys in both locales only when needed); no
  hardcoded UI text; layout tolerates uk expansion.
  → AC-14  → test_i18n_en_uk_present
- [x] T23  Accessibility/security sweep over the changed components: keyboard +
  `aria-expanded` on info / Regenerate / risk expanders; state never by color
  alone; Regenerate/Generate keep an accessible name + aria-live; all
  model-derived strings rendered as plain text / Markdown-as-data (no
  `dangerouslySetInnerHTML`); file-link hrefs https / in-app only; usable at
  narrow widths. Encode the checkable parts as assertions in the relevant
  component tests.  → AC-15, AC-16  → test_a11y_security_sweep

### Phase 7 — R1b: correct Reading-path description for ALREADY-STORED tours (client)
- **Surface:** client (UI) — client-render-only follow-up to R1; NO
  server/prompt/contract change.
- **Skills to apply:** `react-frontend-architecture` (the pure parse/sanitize
  logic belongs in the colocated `helpers.ts`, not the render body),
  `react-best-practices`, `next-best-practices`, `security` (model-authored
  `body`/`label` stay Markdown-as-data; the parser is a bounded, line-level
  regex — no ReDoS/injection surface), `react-testing-library` (tests). No
  `zod`/contract/prompt change.
- **What changes & why:** R1 shipped (T4–T8). For a NEWLY-generated tour the
  per-file description rides in `link.label` and renders fine. But for an
  ALREADY-STORED (old-prompt) tour, `link.label` is a junk short line
  (`"1. _shared.ts"`) while the REAL per-file description lives only in the
  `body` numbered markdown list — and the shipped renderer
  (`sections.tsx:49-73`) prints `"{i+1}. {link.label}"`, so old tours show
  DOUBLED numbering (`"1. 1. _shared.ts"`) and no real description. R1b fixes
  the RENDER only:
  - **AC-19** — WHEN `section.body` holds a top-level numbered list whose parsed
    item count equals `links.length`, use each parsed item as the description of
    the entry at the same index, rendered as Markdown-as-data (inline code/bold
    preserved); `links[]` stays authoritative for set/order — so an old stored
    tour reaches the intended look WITHOUT regeneration.
  - **AC-20** — OTHERWISE (no usable body list, or count ≠ `links.length`),
    compose the description as `"N. \`link.path\` — <label>"` after sanitizing:
    strip a leading duplicate `"N."` number prefix from the label, and when the
    sanitized label is empty or equals the path's filename, render
    `"N. \`link.path\`"` alone (no dash, no junk label) — never doubled numbering,
    never a blank row.
  - **AC-21** — IF parsing the body list fails / the body is malformed (the
    `^\s*\d+\.\s+` line-level extraction with multi-line items folded until the
    next number does NOT yield a clean count-matching list), fall back to the
    AC-20 composition — no broken list, no crash.
  - **AC-22** — every description (body-list item OR composed fallback) is
    rendered as Markdown-as-data (no `dangerouslySetInnerHTML`), consistent with
    AC-16.
  - **AC-23** — opening an already-stored tour under R1b makes ZERO LLM/embedding
    calls and needs NO regeneration (client-render change only; parent
    onboarding AC-22 preserved).
  Invariants held: the onboarding PROMPT is unchanged, the `Onboarding` /
  `OnboardingSection` / `OnboardingLink` contracts are unchanged, and the Open
  file-viewer deep-link is unchanged.
- **Placement decision (HOW):** the numbered-list parser and the label sanitizer
  are PURE functions and go in the colocated
  `OnboardingTourView/helpers.ts` (matching that file's stated "pure functions
  only, trivially testable" purpose — it already hosts `relativeTimeAgo` /
  `fileViewerHref`), with a NEW colocated `helpers.test.ts`. `ReadingPathSection`
  consumes them and selects the body-list source vs. the fallback per entry —
  keeping parsing out of the render body and unit-testable without RTL.
- **How to test:** `cd client && pnpm test`
  (`OnboardingTourView/helpers.test.ts` for the pure parser/sanitizer;
  `OnboardingTourView/sections.test.tsx` for the rendered outcomes) +
  `pnpm typecheck`.
- [x] T24  Add a pure `parseNumberedList(body: string): string[]` to
  `OnboardingTourView/helpers.ts` — extract a top-level numbered list via a
  bounded line-level regex (`^\s*\d+\.\s+`), folding each item's continuation
  lines until the next number; return `[]` when no clean list is found so the
  caller can detect a mismatch / parse failure. No `dangerouslySetInnerHTML`, no
  unbounded/backtracking regex.  → AC-19, AC-21  → test_parse_numbered_list
- [x] T25  Add a pure label sanitizer to `helpers.ts`
  (e.g. `sanitizeReadingPathLabel(label, path): string | null`): strip a leading
  duplicate `"N."` number prefix, then return the label only when non-empty AND
  not equal to the path's filename, else `null` (signal "path alone"). Pure,
  unit-testable; the caller composes `"N. \`path\` — <label>"` or `"N. \`path\`"`.
  → AC-20  → test_sanitize_reading_path_label
- [x] T26  Rework `ReadingPathSection` (`sections.tsx`) to choose the description
  source PER RENDER: if `parseNumberedList(section.body).length === section.links.length`,
  use the parsed body item at the entry's index; otherwise use the AC-20
  composed/sanitized fallback. Render the description via `<Markdown>`
  (Markdown-as-data, inline formatting preserved), keep the mono path row + Open
  deep-link unchanged, and emit a SINGLE correct number (removing the shipped
  `"{i+1}. {link.label}"` doubling). Never a blank row / doubled numbering /
  crash.  → AC-19, AC-20, AC-22  → test_reading_path_r1b_description_source
- [x] T27  Handle the degrade path in `ReadingPathSection`: malformed/parse-fail
  `body`, count-mismatch body list, empty `body`, and missing/empty `link.label`
  all fall back to the AC-20 composition (path-alone when no usable label) — no
  broken list, no crash.  → AC-21  → test_reading_path_r1b_fallback
- [x] T28  Adjust `OnboardingTourView/styles.ts` ONLY if the Markdown-rendered
  description row needs layout tweaks (inline-code badge / em-dash spacing);
  keep it usable at narrow widths (no change if the existing `pathRationale`
  style suffices).  → AC-19, AC-22  → test_reading_path_r1b_description_source
- [x] T29  Add `OnboardingTourView/helpers.test.ts` covering `parseNumberedList`
  (clean count-matching list; multi-line folded items; malformed / no-list →
  `[]`; count mismatch) and the label sanitizer (strip `"N."` prefix;
  empty/filename-equal → path alone), and update `sections.test.tsx` to assert:
  body-list-matched → each item is the entry's description rendered as
  Markdown-as-data by index with single numbering (AC-19); no/mismatch/malformed
  body → sanitized `"N. path — label"` / `"N. path"` fallback, no doubled
  numbering (AC-20, AC-21); a description with inline code/bold renders as data,
  no `dangerouslySetInnerHTML` (AC-22).
  → AC-19, AC-20, AC-21, AC-22  → test_reading_path_r1b_description_source

## Traceability matrix

| AC    | Task            | Test                                   | Commit |
|-------|-----------------|----------------------------------------|--------|
| AC-1  | T4, T5, T7, T8  | test_reading_path_single_list          | —      |
| AC-2  | T4, T5, T8      | test_reading_path_single_list          | —      |
| AC-3  | T6, T8          | test_reading_path_backward_compat      | —      |
| AC-4  | T5              | test_reading_path_single_list (0 LLM)  | —      |
| AC-5  | T5, T8          | test_reading_path_single_list          | —      |
| AC-6  | T1, T2, T3      | test_onboarding_service_getter_wiring  | —      |
| AC-7  | T11, T12, T13   | test_overview_order / test_review_focus_framed | —      |
| AC-8  | T12, T13        | test_review_focus_framed               | —      |
| AC-9  | T14, T15, T16   | test_risk_row_layout                   | —      |
| AC-10 | T14, T17        | test_brief_info_compact                | —      |
| AC-11 | T14, T18, T21   | test_regenerate_labeled                | —      |
| AC-12 | T19, T21        | test_header_generate_cta               | —      |
| AC-13 | T20, T21        | test_generate_error_nonblocking        | —      |
| AC-14 | T9, T22         | test_i18n_en_uk_present                 | —      |
| AC-15 | T7, T17, T18, T19, T23 | test_a11y_security_sweep        | —      |
| AC-16 | T5, T12, T15, T23 | test_a11y_security_sweep             | —      |
| AC-17 | T3, T8, T10, T13, T16, T21 | test_onboarding_service_getter_wiring / component tests | —      |
| AC-18 | T9, T10         | test_toc_heading_feature_name          | —      |
| AC-19 | T24, T26, T28, T29 | test_reading_path_r1b_description_source | —      |
| AC-20 | T25, T26, T29   | test_sanitize_reading_path_label / test_reading_path_r1b_description_source | —      |
| AC-21 | T24, T27, T29   | test_parse_numbered_list / test_reading_path_r1b_fallback | —      |
| AC-22 | T26, T28, T29   | test_reading_path_r1b_description_source | —      |
| AC-23 | T26             | test_reading_path_r1b_description_source (0 LLM, no regen) | —      |

## Risks & mitigations

- **R2 breaks the existing prototype-spy tests.** The fake container in
  `onboarding-service.test.ts` has no `onboardingRepo` getter, so a service that
  reads `container.onboardingRepo` would get `undefined`. *Mitigation:* T3
  updates `makeContainer` to expose `onboardingRepo` backed by a real
  `new OnboardingRepository(db)`, so both the getter path AND the
  `OnboardingRepository.prototype` spies work (AC-6 explicitly requires the
  getter to keep constructing that same class lazily).
- **R1 backward-compat regressions on already-stored tours.** Old rows carry
  the full numbered list in `body` and short lines in `label`; a naive change
  could double-render or blank out. *Mitigation:* drive the list solely from
  `links[]`, never re-render `body` as a list, and cover old-shape /
  count-mismatch / empty-body / missing-label in T6/T8 (AC-3). No migration /
  backfill (explicit non-goal).
- **R4/R5.1 CollapsibleCard is shared.** `BriefInfo`, the tour section cards,
  and the risk rows all use it; a breaking change would ripple. *Mitigation:*
  T14 extends it ADDITIVELY (new optional prop, defaults unchanged) and
  `CollapsibleCard.test.tsx` asserts existing defaults + expander semantics
  still hold (non-goal: no breaking contract change).
- **R5.3 duplicate Generate control.** Moving the CTA to the header while the
  empty-state body still has a button would show two controls. *Mitigation:*
  T19 removes the body button and keeps only explanatory text; T21 asserts a
  single Generate control (AC-12).
- **Layout jump on Regenerate pending (AC-11).** An icon-only → labeled swap
  changes width. *Mitigation:* T18 uses a constant-size labeled Button in both
  states (spinner replaces the icon only), asserted in T21.
- **uk text expansion overflow.** "Перегенерувати бриф" / "Згенерувати бриф" are
  longer than the English. *Mitigation:* T22/T23 verify layout tolerance;
  header controls wrap/flex rather than fixed-width.
- **Client tests use `fireEvent`, not `user-event`** (client INSIGHTS
  2026-06-24: `@testing-library/user-event` is NOT a dependency). *Mitigation:*
  all new/updated client tests use `fireEvent` and render under
  `NextIntlClientProvider` (messages by relative path) + providers, matching the
  existing suites.
- **(R1b) `<Markdown>` primitive styles ONLY inline elements** (client INSIGHTS
  2026-06-23): without block renderers, markdown headings/lists render as plain
  body text. *Mitigation:* R1b feeds `<Markdown>` a SINGLE-LINE description
  string per entry (a body-list item or a composed `"N. \`path\` — label"`), so
  only INLINE formatting (inline-code, bold, em-dash) matters — the inline-only
  default is sufficient here. Do NOT pass a multi-line/block markdown blob into
  the per-entry description; if a body item unexpectedly spans blocks, treat it
  as the single inline string it was folded into (T24 folds continuation lines).
- **(R1b) parse count-match is the correctness pivot.** Using the body list when
  its item count ≠ `links.length` would mis-map descriptions to files.
  *Mitigation:* T26 uses the body list ONLY when
  `parseNumberedList(body).length === links.length` (exact), else the AC-20
  fallback; T24/T29 cover clean-match, multi-line-folded, count-mismatch, and
  no-list/malformed → `[]` cases (AC-21).
- **(R1b) doubled numbering regression.** The shipped renderer prints
  `"{i+1}. {link.label}"`; if the label already begins with `"N."` (old tours),
  naive composition re-doubles it. *Mitigation:* T25 strips a leading `"N."`
  prefix in the sanitizer, and T26 emits exactly one number per row; T29 asserts
  no doubled numbering (AC-20).
- **(R1b) zero-LLM / no-regeneration invariant.** R1b must not add any read-time
  model call. *Mitigation:* the change is pure client render over the already-
  fetched stored tour (no new hook, no mutation); T26's test asserts 0 LLM calls
  on open and that the intended look is reached without regeneration (AC-23),
  and the prompt/contracts are explicitly untouched.

## Critical files for implementation

- `client/.../OnboardingTourView/sections.tsx` — R1 merged reading-path list.
- `client/.../PrBriefCard/PrBriefCard.tsx` — R5 header info/Regenerate/Generate.
- `client/.../IntentCard/IntentCard.tsx` — R4 RISK AREAS layout.
- `client/src/vendor/ui/CollapsibleCard.tsx` — shared primitive, additive
  extension for R4/R5.1 (backward-compat is load-bearing).
- `server/src/platform/container.ts` + `server/src/modules/onboarding-generator/service.ts`
  — R2 container getter + consumption.

## Open questions / assumptions

- **Assumption (R1 body handling):** the merged `reading_path` renderer does NOT
  render `section.body` as a list; the per-file description lives in
  `link.label`. If the team prefers to keep a short intro paragraph from `body`,
  that is an additive tweak that does not affect any AC. (Non-blocking.)
- **Assumption (R2 wiring style):** the service reads
  `this.container.onboardingRepo` (via the getter); constructing once in the
  ctor from the getter vs. reading per call are equivalent for the ACs — either
  is acceptable as long as the getter is the sole instantiation site and
  prototype-spies still intercept. (Non-blocking.)
- **Assumption (R5 i18n reuse):** `brief.regenerate` ("Regenerate brief") and
  `brief.empty.cta` ("Generate brief") already exist in both locales and are
  reused verbatim; no new brief keys are added unless a compact-info label
  turns out to need distinct copy. (Non-blocking.)
- **Assumption (R3 frame source):** the Review-focus frame reuses the
  Description block's `descriptionBox` treatment / the shared `Card` primitive
  for visual parity; the exact primitive is an implementation detail as long as
  it matches the other Overview sections. (Non-blocking.)
- **Decision (R1b helper placement):** the pure numbered-list parser + label
  sanitizer live in the colocated `OnboardingTourView/helpers.ts` (with a new
  `helpers.test.ts`), not inside `sections.tsx`. This matches that file's stated
  "pure functions only" purpose and keeps the logic unit-testable without RTL.
  An alternative home (`sections.tsx` local helpers) would work but is harder to
  test in isolation — the colocated `helpers.ts` is the recommended placement.
  (Non-blocking.)
- **Assumption (R1b description is single-line):** each per-entry description fed
  to `<Markdown>` is a single inline string (body-list item, continuation lines
  folded by `parseNumberedList`, or a composed `"N. \`path\` — label"`), so the
  `<Markdown>` inline-only default (client INSIGHTS 2026-06-23) is sufficient and
  no block renderers are added. (Non-blocking.)
