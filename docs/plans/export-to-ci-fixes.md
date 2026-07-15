# Development Plan: Export to CI — post-ship fixes

- **Spec:** docs/specs/SPEC-2026-07-15-export-to-ci-fixes.md (Status: approved)
- **Execution mode:** single-agent

## Context

The shipped "Export to CI" feature (L07) drifted from the now-on-disk mockups
(`docs/specs/assets/SPEC-2026-07-14-export-to-ci/`). This plan turns the approved
fixes spec (AC-46..AC-55) into an ordered, single-executor implementation:

- **CI tab** — heading "CI deployment" with the "Active in {n} repos" pill inline
  (AC-46); the Fail-CI-on gate gets its own `ci`-namespace label + hint (AC-47/49),
  keeps all four verbose options (AC-48), and stacks label/description above the
  control so the description never collapses to one word per line (AC-50).
- **Wizard Step 1 (Target)** — the target repo prefills from the shell's active repo
  (AC-51) and becomes a repo selector modelled on the nav switcher, not a free-text
  field (AC-52).
- **Wizard Step 4 (Install)** — both install cards become a real keyboard-operable
  radiogroup (AC-53); "Copy files as a zip" produces a downloadable archive of the
  generated bundle (AC-54, Variant A).
- **Docs** — the `cd agent-runner && pnpm build` export prerequisite is documented
  (AC-55, non-blocking).
- **Plus one user-approved extra:** migrate the local `CI_TAB_COPY` strings into the
  `ci` i18n namespace so the whole surface honours "UI strings via next-intl".

Single-agent because the slices are **not disjoint**: `ExportWizard.tsx` is edited by
both the repo-selector (AC-51/52) and the install-action (AC-53/54) work, and
`client/messages/en/ci.json` + `CiTab/constants.ts` are touched by several fixes. The
work is ordered so shared-file edits happen in sequence, never in parallel.

## Requirements review & recommendations

**Spec quality.** AC-46..AC-55 are observable and testable; the two intentional
deviations (AC-48 keep-4-values, AC-50 stacked layout) are pinned so they are not
"fixed" back. No blocking ambiguity — both required inputs (spec path, execution
mode) were provided, so no stop-and-ask was needed.

**Verify-only item (generated-files count) — VERIFIED AS A NON-ISSUE, NO TASK.**
`ci.exportWizard.installCardBody` already interpolates `{count}`
(`client/messages/en/ci.json:77`), fed by `count: fileCount` in
`InstallStep.tsx:39`, and `ExportWizard.tsx:144` passes `fileCount={mergedFiles.length}`.
There is **no hardcoded "5"/"6" in code** — the static number lives only in the design
PNG. The parent spec (SPEC-2026-07-14) already recorded this copy drift as out of
scope. No fix task is added.

**AC-54 zip — plan decision: CLIENT-SIDE (Variant A), no server route.** The wizard
already holds the merged `CiFile[]` in memory (`mergedFiles`, edits included) from the
Step-2 `action=files` fetch (`ExportWizard.tsx:54`). Zipping in the browser from those
in-memory `{path, contents}` pairs needs **zero** new server endpoint, **zero** new Zod
contract, and **zero** extra network round-trip — exactly what the spec's non-goals
prefer ("No new shared Zod contract"; "the zip path can be assembled from the returned
`CiFile[]`"). A server route would add a contract + endpoint to ship bytes the client
already has. Add `fflate` as a client dependency (the server already ships `fflate
^0.8.2`, so it is already vetted in-repo; zero-dependency and browser-safe). This also
makes AC-54 trivially satisfy "open no PR and persist no installation" — the `files`
path calls no mutation at all. Re-reading is required: re-fetching with `action=files`
would regenerate the bundle server-side and **discard the Step-2 edits**, contradicting
AC-54's "edits from Step 2 included" — so the zip MUST be built from `mergedFiles`, not
a fresh fetch.

**Recommendations (non-blocking):**
- The existing `ExportWizard.test.tsx` `gotoPreview()`/`test_disabled_target` type into
  `getByPlaceholderText("acme/payments-api")`. AC-52 removes that free-text input, so
  those helpers/tests MUST be updated to drive the new selector — this is called out in
  Phase 2 and is a coverage risk if missed.
- The "Add repository…" affordance (AC-52) should reuse the nav-switcher behaviour
  (`useShellContext.onAddRepo` routes to `/onboarding`). Routing away closes the modal;
  that is acceptable for the empty-repo edge case (add a repo, then re-open the wizard)
  and is the least-new-code faithful reuse. Recorded as an assumption, not a question.

## Affected packages & files

Client (primary surface):
- `client/messages/en/ci.json` — change `ciTab.heading`; add `ciTab.failOn.label`,
  `ciTab.failOn.hint`, `ciTab.activeInRepos` (ICU plural), `ciTab.runHistory`,
  `exportWizard.zipCardTitle`, `exportWizard.zipCardHint`, `exportWizard.docsLink`.
- `.../CiTab/CiTab.tsx` — heading text + inline pill; pill/run-history via `useTranslations`.
- `.../CiTab/_components/FailOnControl.tsx` — CI-tab label/hint from the `ci` namespace;
  keep four verbose options from `agents.config.ciFailOnOptions`; stacked layout.
- `.../CiTab/styles.ts` — `failOnRow` flex-row → column stack.
- `.../CiTab/constants.ts` — remove the `CI_TAB_COPY` object once all consumers migrate
  (leave `CI_FAIL_ON_VALUES`, `WIZARD_TARGETS`, etc. intact).
- `.../CiTab/_components/ExportWizard/ExportWizard.tsx` — repo prefill + install-action
  state + zip wiring.
- `.../CiTab/_components/ExportWizard/steps/TargetStep.tsx` — repo selector (replaces the
  free-text `TextInput`).
- `.../CiTab/_components/ExportWizard/steps/InstallStep.tsx` — radiogroup of install cards.
- New: `.../CiTab/_components/ExportWizard/zip.ts` — `downloadBundleZip(files, repoName)`
  helper (client-side, colocated; a project-specific "helper", not a generic util).
- `client/package.json` — add `fflate` (align to the server's `^0.8.2`).
- Tests: `.../CiTab/CiTab.test.tsx`, `.../ExportWizard/ExportWizard.test.tsx`
  (extend/update — the placeholder-driven helpers must change for AC-52).

e2e (deterministic, no LLM — JSON flow specs, `wait --text`/`find role|text` are the
assertions):
- New `e2e/specs/14-ci-export-repo-selector.flow.json` (AC-52).
- New `e2e/specs/15-ci-install-radios.flow.json` (AC-53).

Docs:
- `ONBOARDING.md` and `agent-runner/README.md` — AC-55 prerequisite note.

Reuse (do NOT reinvent):
- `useActiveRepo()` (`client/src/lib/repo-context.tsx:58`) → `activeRepo.full_name`
  (owner/name) + `repos`. Active-repo preselect precedent:
  `conventions/.../ConventionsListView.tsx:23`.
- Repo-list / add hooks: `useRepos`, `useAddRepo` (`client/src/lib/hooks/core.ts:68,75`).
- Nav repo-switcher pattern: `client/src/vendor/ui/shell/RepoSwitcher.tsx` (uses the
  `Dropdown` kit + a `DropdownItemDef[]` of repos + an "Add repository…" item; omit the
  `onRemove`/trash affordance per AC-52). `Dropdown`/`DropdownItemDef` live in
  `client/src/vendor/ui/kit` (`onRemove` is the delete affordance to leave off).
- The existing `ci` mutation `useExportCi` (`client/src/lib/hooks/ci.ts:34`) — unchanged;
  used only for the `open_pr` path.
- Contracts (reused as-is, no change): `CiFile`, `CiExportInput.action` (`open_pr | files`),
  `CiExportRequest.files` — `server/src/vendor/shared/contracts/eval-ci.ts` /
  `contracts/ci-runs.ts`.

**Recorded conventions that constrain this plan (client INSIGHTS.md):**
- **[2026-06-24] Tests use `fireEvent`, NOT `user-event`.** `@testing-library/user-event`
  is NOT a client dependency (importing it fails typecheck). Pattern: `vi.mock` the data
  hooks + `next/navigation`, render under `NextIntlClientProvider` (messages imported by
  RELATIVE path — `@/` cannot reach `messages/`) + `ToastProvider`; assert toasts via
  rendered text. The generic react-testing-library skill's userEvent/MSW guidance does
  NOT apply here. (See existing `CiTab.test.tsx` / `ExportWizard.test.tsx`.)
- **[2026-06-22] Adding an i18n namespace/key needs NO wiring** — `messages/en/*.json` is
  auto-merged; just `useTranslations("ci")`. Test files import the specific
  `messages/en/*.json` by relative path.
- **[2026-07-14] Client import-boundary lint (`no-restricted-imports`) reddens
  `pnpm lint` AND `next build`, invisible to `pnpm test`/`typecheck`.** Run `pnpm lint`
  on the client before finishing. A `steps/` file reaching its feature-root already uses
  the `ExportWizard/constants.ts` = `export * from "../../constants"` shim — keep that
  shape; do NOT reach via `@/app/**` or `../../../`.
- **[2026-06-28] Client imports `@devdigest/shared` TYPE-ONLY** (`import type`) — never
  value-import a contract schema (it would pull zod into the client bundle).
- **[2026-06-22] kit `SelectInput`/`SearchableSelect` do NOT forward `...rest`** (no
  `aria-*`/`id` passthrough), unlike `TextInput`/`Textarea`. If the repo selector needs
  a11y attributes on the control, prefer the `Dropdown` kit (nav-switcher pattern) or
  extend the select first — do not assume passthrough.
- jsdom gaps for tests: no `URL.createObjectURL`/anchor-download and no
  `scrollIntoView`/`PointerEvent` — stub the browser APIs the zip-download test needs in
  `beforeEach` and assert the spy, not a real download.

## Tasks

### Phase 1 — CI tab header + Fail-CI-on panel + CI-tab i18n
- **Surface:** client (UI + i18n)
- **Skills to apply:** react-frontend-architecture, react-best-practices, next-best-practices (+ react-testing-library for tests)
- **What changes & why:** align the CI tab with `agent-editor-ci-01.png` (heading, inline
  pill, gate label/hint/layout) and decouple the CI-tab gate copy from the Config tab by
  giving it `ci`-namespace keys. `FailOnControl` is CI-tab-only (used solely in
  `CiTab.tsx`); the Config tab has its own control in `ConfigTab.tsx`, so this does not
  touch the Config tab.
- **How to test:** client `pnpm test` (Vitest + jsdom), extend `CiTab/CiTab.test.tsx`
  (fireEvent pattern; render under `NextIntlClientProvider` with `ci` + `agents`
  messages). AC-50 also gets a manual visual check at normal CI-tab width.
- [ ] T1  Edit `client/messages/en/ci.json`: set `ciTab.heading` = "CI deployment"; add `ciTab.failOn.label` = "Fail CI on", `ciTab.failOn.hint` = "Exit non-zero when a finding at or above this severity lands. Pair with a required status check to block merges.", `ciTab.activeInRepos` = `{n, plural, one {Active in # repo} other {Active in # repos}}`, `ciTab.runHistory` = "CI run history"   → AC-46, AC-47, AC-49   → test_ci_json_keys
- [ ] T2  In `CiTab.tsx`: render the heading from `ci.ciTab.heading`, move the "Active in {n} repos" pill INLINE into `headerRow` (remove its standalone row), read the pill via `t("ciTab.activeInRepos", { n: installs.length })` and the run-history label via `t("ciTab.runHistory")` (drop `CI_TAB_COPY.activeInRepos`/`.runHistory`)   → AC-46   → test_ci_tab_header
- [ ] T3  In `FailOnControl.tsx`: source the gate label from `ci.ciTab.failOn.label` and the hint from `ci.ciTab.failOn.hint`; KEEP all four `CI_FAIL_ON_VALUES` rendered with their verbose labels from `agents.config.ciFailOnOptions` (do NOT reduce to three); leave `ConfigTab.tsx` on `agents.config.ciFailOn`/`ciFailOnHint`   → AC-47, AC-48, AC-49   → test_ci_tab_failon
- [ ] T4  In `CiTab/styles.ts` change `failOnRow` to a vertical stack (`flexDirection: "column"`, remove the `flex:1` vs `flexShrink:0` fight) and adjust `FailOnControl.tsx` so label + description sit full-width ABOVE the segmented control and the description wraps as normal prose (reading order label → description → control)   → AC-50   → test_ci_tab_failon_stacked

### Phase 2 — Export wizard Step 1 (Target): repo prefill + repo selector   (depends on: Phase 1)
- **Surface:** client (UI)
- **Skills to apply:** react-frontend-architecture, react-best-practices, next-best-practices (+ react-testing-library for tests)
- **What changes & why:** stop making authors retype `owner/name`. Prefill from the
  shell's active repo and replace the free-text `TextInput` with a repo selector modelled
  on the nav switcher (with "Add repository…", no trash). Depends on Phase 1 only because
  both phases edit `ExportWizard.tsx` sequentially (single-agent), not for data.
- **How to test:** client `pnpm test` (extend `ExportWizard.test.tsx`) + a new e2e flow.
  **The existing `gotoPreview()` and `test_disabled_target` type into the
  `acme/payments-api` placeholder — they MUST be updated to select a repo from the new
  selector, since the free-text input is removed.**
- [ ] T5  In `ExportWizard.tsx`: initialise `repo` state from `useActiveRepo().activeRepo?.full_name` (owner/name); if no active repo resolves, start unselected (empty string) rather than blank-and-typed. Adjust `canContinue` at step 0 so Continue is enabled once a repo is selected (prefilled or picked) and disabled when unselected   → AC-51   → test_wizard_repo_prefill
- [ ] T6  In `TargetStep.tsx`: replace the free-text `FormField`+`TextInput` with a repo selector fed by `useActiveRepo().repos` (fallback `useRepos`), modelled on `RepoSwitcher` (the `Dropdown` kit + `DropdownItemDef[]` of repo `full_name`s + an "Add repository…" item reusing the `/onboarding` add flow); render NO delete/trash affordance and NO free-text field; keyboard-operable + labelled. Update `ExportWizard.test.tsx` helpers to drive the selector. Add e2e flow `e2e/specs/14-ci-export-repo-selector.flow.json` (open agents → editor CI tab → open wizard → assert the selector shows the seeded repo + "Add repository…", no free-text placeholder, no trash)   → AC-52   → test_wizard_repo_selector, e2e_14_repo_selector

### Phase 3 — Export wizard Step 4 (Install): radiogroup + zip + i18n cleanup   (depends on: Phase 2)
- **Surface:** client (UI + new client dependency)
- **Skills to apply:** react-frontend-architecture, react-best-practices, next-best-practices, security (untrusted-input/secret check on the zip), dependency-checker (vet `fflate`) (+ react-testing-library for tests)
- **What changes & why:** make both install cards a real keyboard-operable radiogroup and
  wire "Copy files as a zip" to a client-side archive of the in-memory merged bundle (see
  the AC-54 decision above). Finish the i18n migration by moving the zip-card strings and
  deleting the now-empty `CI_TAB_COPY`.
- **How to test:** client `pnpm test` (extend `ExportWizard.test.tsx`; stub
  `URL.createObjectURL`/anchor click + spy the zip helper) + a new e2e flow + `pnpm
  typecheck`/`pnpm lint`. Security: confirm the archive is the same server-generated
  bundle (manifest + skills + memory + committed runner + workflow) and carries NO secret
  (`OPENROUTER_API_KEY` referenced by the workflow, never inlined; no `GITHUB_TOKEN`).
- [ ] T7  Edit `client/messages/en/ci.json`: add `exportWizard.zipCardTitle` = "Copy files as a zip", `exportWizard.zipCardHint` = "add them manually", `exportWizard.docsLink` = "GitHub Action setup docs →"   → AC-53   → test_ci_json_zip_keys
- [ ] T8  Lift install-action state into `ExportWizard.tsx` (`installAction: "open_pr" | "files"`, default `"open_pr"`); in `InstallStep.tsx` render the two cards as a `role="radiogroup"` of `role="radio"` items with `aria-checked`, roving `tabIndex`, arrow-key navigation, a visible focus ring, and the "recommended" TEXT label ("Open a PR" checked by default); read the zip-card strings via `useTranslations`; the footer "Install" drives the selected action   → AC-53   → test_install_radiogroup, e2e_15_install_radios
- [ ] T9  Add `fflate` to `client/package.json` (align `^0.8.2`); add `ExportWizard/zip.ts` `downloadBundleZip(files: CiFile[], repoName: string)` that zips `{path → contents}` and triggers a browser download; wire `ExportWizard.install()` so `action=files` builds+downloads the zip from `mergedFiles` (Step-2 edits included) with NO export mutation → no PR, no installation, while `action=open_pr` keeps the existing `useExportCi` mutation unchanged   → AC-54   → test_zip_download_files
- [ ] T10  Remove the now-unused `CI_TAB_COPY` object from `CiTab/constants.ts` (all consumers migrated to `ci` keys in T2/T7); confirm no references remain via `pnpm typecheck`   → AC-46, AC-53 (i18n-migration cleanup)   → test_ci_json_keys (guarded by typecheck)

### Phase 4 — Docs (non-blocking)   (depends on: —)
- **Surface:** docs
- **Skills to apply:** none (prose only)
- **What changes & why:** document the designed export prerequisite so the parent AC-44
  "runner bundle not found" error is understood as a missing build step, not a bug.
- **How to test:** manual doc review / grep for the command string.
- [ ] T11  In `ONBOARDING.md` (and cross-reference `agent-runner/README.md`): add a note that `cd agent-runner && pnpm build` must be run to produce the gitignored `agent-runner/dist/index.js` before exporting, and that the parent AC-44 "runner bundle not found" error is designed behaviour (a missing build step), not a bug. Check-before-create: extend the existing files, do not overwrite   → AC-55   → test_docs_runner_prereq (manual)

## Traceability matrix
| AC   | Task    | Test                                    | Commit |
|------|---------|-----------------------------------------|--------|
| AC-46 | T1, T2, T10 | test_ci_tab_header                  | —      |
| AC-47 | T1, T3  | test_ci_tab_failon                      | —      |
| AC-48 | T3      | test_ci_tab_failon (four options)       | —      |
| AC-49 | T1, T3  | test_ci_tab_failon                      | —      |
| AC-50 | T4      | test_ci_tab_failon_stacked              | —      |
| AC-51 | T5      | test_wizard_repo_prefill                | —      |
| AC-52 | T6      | test_wizard_repo_selector, e2e_14_repo_selector | — |
| AC-53 | T7, T8, T10 | test_install_radiogroup, e2e_15_install_radios | — |
| AC-54 | T9      | test_zip_download_files                 | —      |
| AC-55 | T11     | test_docs_runner_prereq (manual)        | —      |

Commit is "—" at planning time; the implementer fills it as tasks land; plan-verifier
audits AC↔task↔test coverage against this table. (Extra i18n-migration keys ride along
T1/T2/T7; `CI_TAB_COPY` removal is T10, guarded by typecheck rather than a bespoke test.)

## Risks & mitigations
- **AC-53 e2e reaching Step 4 depends on the hermetic stack having
  `agent-runner/dist/index.js`.** Step 4 is only reachable after a successful Step-2
  `action=files` preview, which is the exact export path that raises parent AC-44 when the
  runner bundle is missing. *Mitigation:* the unit test (`test_install_radiogroup`) is the
  reliable gate for AC-53 (radiogroup semantics + footer action); the e2e flow
  (`15-ci-install-radios`) is the deterministic confirmation and requires
  `cd agent-runner && pnpm build` (the AC-55 prerequisite) in the hermetic setup. If the
  bundle cannot be guaranteed in e2e, scope `15-` to the deepest deterministically
  reachable step and note it in the flow's `description`.
- **Existing wizard tests break on AC-52.** `gotoPreview()`/`test_disabled_target` type
  into the removed placeholder input. *Mitigation:* T6 explicitly updates those helpers to
  drive the selector; the green barrier catches any missed spot.
- **jsdom lacks `URL.createObjectURL`/anchor-download.** *Mitigation:* stub in
  `beforeEach` and spy the zip helper (mirrors the existing `scrollIntoView`/`PointerEvent`
  stubbing convention) rather than asserting a real download.
- **New client dependency (`fflate`).** *Mitigation:* pin `^0.8.2` (same as the server;
  zero-dependency, browser-safe, already vetted in-repo); run `pnpm lint` — a new dep must
  be added to `pnpm-workspace.yaml` `allowBuilds` only if it has an install script (fflate
  does not).
- **i18n plural regression.** The migrated pill must still render exactly "Active in 2
  repos" / "Active in 1 repo". *Mitigation:* the ICU `{n, plural, one {…} other {…}}` form
  preserves both; `test_ci_tab_header` asserts the rendered text and the existing
  `CiTab.test.tsx:80` assertion ("Active in 2 repos") must stay green.

## Critical files for implementation
- `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/CiTab.tsx` — header + inline pill.
- `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/_components/FailOnControl.tsx` — gate label/hint/options/layout.
- `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/_components/ExportWizard/ExportWizard.tsx` — repo prefill + install-action state + zip wiring.
- `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/_components/ExportWizard/steps/{TargetStep,InstallStep}.tsx` — selector + radiogroup.
- `client/messages/en/ci.json` — all new/changed `ci`-namespace copy.

## Open questions / assumptions
- **Assumption (non-blocking):** "Add repository…" reuses the nav-switcher behaviour —
  routing to `/onboarding` via `useRouter().push` (mirrors `useShellContext.onAddRepo`).
  Navigating away closes the wizard, which is acceptable for the empty-repo edge case.
- **Assumption:** AC-54's "footer sends `files`" is satisfied by the client-side zip path
  (no server call), since re-fetching would drop the Step-2 edits AC-54 requires.
- **Assumption:** the zip lives in a colocated `ExportWizard/zip.ts` helper (project-
  specific glue, not a shared util); the download side effect stays out of the render body.
- **Verified non-issue (no task):** the generated-files count is already dynamic (`{count}`
  → `mergedFiles.length`); no hardcoded number exists in code.
