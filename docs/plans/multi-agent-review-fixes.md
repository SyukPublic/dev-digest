# Development Plan: Multi-Agent Review — Follow-up Fixes

- **Spec:** docs/specs/SPEC-2026-07-15-multi-agent-review-fixes.md
- **Execution mode:** multi-agent

## Context

The shipped L07 Multi-Agent Review feature is functionally correct end-to-end, but
hands-on use surfaced four **client-only** UI defects that make it feel broken: the nav
item is in the wrong section, re-opening Configure-run loses the run's agent selection,
the PR-header picker lists disabled agents, and launching from the PR header lands on an
empty Configure form instead of the live Results. The spec's goal, restated: make the
studio match the design and behave coherently — nav item in `GLOBAL`, Configure-run
starts from the agents that ran, the PR-header picker offers the same enabled-only set as
the Configure page, and launching from the PR header lands on Results for that PR.

Scope is strictly `client/**`: no server, no `@devdigest/shared` contract, no hook, no DB
change. Every fix edits an existing client file, and the existing tests are aligned. The
four fixes map to three **disjoint, file-non-overlapping** slices that run in one parallel
wave (Slice A = nav, Slice B = restore selection, Slice C = PR-header picker + navigation).

## Requirements review & recommendations

The spec is approved, has zero `[NEEDS CLARIFICATION]`, and carries file:line grounding
for every defect. All 13 ACs are observable/testable; bidirectional coverage
(AC ↔ task ↔ test) is complete (see Traceability matrix). No blocking questions — planning
proceeded in one pass. Findings and recommendations for implementers:

- **AC-12 / AC-13 require NO production change (verification-only against existing behavior).**
  Fix 4's *only* production edit is the navigation target in `AgentPicker.tsx`. The
  destination page already implements the skeleton-while-loading → Results resolution:
  `runLoading` gates a `<Skeleton>` (page.tsx:78) so the empty Configure form is *not*
  shown while the just-launched run's GET is in flight, and `inResults` (page.tsx:51)
  flips to Results once `run != null`. So AC-12/AC-13 are covered by *new tests* in
  `page.test.tsx`, not by touching `page.tsx`. Implementers of Slice C should not hunt for
  a page.tsx change.
- **AC-4 robustness to `useAgents` load timing (implementation-level).** The restored
  selection is `run.columns[].agent_id ∩ enabled agents`, and the enabled set comes from
  `useAgents()`. When the user lands directly on `/multi-agent?pr=X` and clicks
  "Configure run", `ConfigureRun` may be the *first* consumer of the `["agents"]` query, so
  `agents` can be `undefined` at mount. A bare `useState(() => …)` mount initializer would
  then seed an empty set and never recover, failing AC-4. **Recommendation:** seed the
  selection the first render where `agents != null` (agents loaded), not unconditionally at
  mount — see Slice B design. The component tests mock `useAgents` synchronously, so both
  approaches pass the tests; the load-timing guard is what makes AC-4 hold in production.
- **AC-7 reset location (implementation-level).** Keep the "reset on PR change" logic
  *inside* `ConfigureRun` (a render-phase `prId`-change latch) rather than relying on a
  page-level `key={prId}`. This makes the reset self-contained and unit-testable in
  `ConfigureRun.test.tsx` via `rerender`, and keeps `page.tsx` a pure additive prop pass.
- **Test convention overrides the generic RTL skill (must-follow).** The client uses
  `fireEvent` (NOT `@testing-library/user-event`, which is not a dependency) and `vi.mock`
  at the hook boundary (NOT MSW). Follow the existing test files' shape, reproduced verbatim
  in the context pack. Do not introduce `userEvent`/MSW.
- **Existing Sidebar test block must be rewritten, not appended.** The block
  "Multi-Agent Review nav item (T14/AC-34)" currently asserts WORKSPACE placement and
  references the old spec's AC-34; after Fix 1 it must assert GLOBAL placement above CI Runs
  and absence from WORKSPACE (Slice A test tasks).
- **Command palette / `activeKeyFor` unchanged (no action needed).** The nav item keeps its
  `key: "multi-agent"`, so the command palette's `nav.multi-agent` still resolves, and
  `activeKeyFor` (helpers.ts:28) is path-based, so the active highlight keeps working after
  the group move — both are verified, not edited.

## Affected packages & files

Package: **`client` only.** No `server`, `@devdigest/shared`, or DB/migration.

Production files edited (all pre-existing):
- `client/src/vendor/ui/nav.ts` — relocate the `multi-agent` NavItemDef WORKSPACE → GLOBAL (Fix 1, Slice A).
- `client/src/app/repos/[repoId]/multi-agent/_components/ConfigureRun/ConfigureRun.tsx` — add `initialAgentIds` prop + seed/reset selection (Fix 2, Slice B).
- `client/src/app/repos/[repoId]/multi-agent/page.tsx` — compute `initialAgentIds` from the run and pass it to `<ConfigureRun>` (Fix 2, Slice B).
- `client/src/app/repos/[repoId]/pulls/[number]/_components/AgentPicker/AgentPicker.tsx` — filter to enabled agents (Fix 3) + navigate with `?pr=${prId}` after launch (Fix 4, Slice C).

Test files aligned (pre-existing):
- `client/src/vendor/ui/shell/Sidebar.test.tsx` (Slice A).
- `client/src/app/repos/[repoId]/multi-agent/_components/ConfigureRun/ConfigureRun.test.tsx` (Slice B).
- `client/src/app/repos/[repoId]/pulls/[number]/_components/AgentPicker/AgentPicker.test.tsx` (Slice C).
- `client/src/app/repos/[repoId]/multi-agent/page.test.tsx` (Slice C — AC-12/AC-13 verification only).

Reused as-is (NOT edited): `client/src/components/app-shell/helpers.ts` (`activeKeyFor`),
`client/src/lib/hooks/multi-agent.ts` (`useMultiAgentRun` / `useLaunchMultiAgentRun` /
`useAgentEstimates`), `client/src/lib/hooks/agents.ts` (`useAgents`),
`client/src/vendor/shared/contracts/observability.ts` (`MultiAgentRun` / `AgentColumn`),
`messages/en/*` (no new i18n keys).

## Shared scaffold (context pack)

Parallel implementers must NOT re-open the sources below — the load-bearing fragments are
lifted here verbatim with `file:line` citations.

### CP-1 — Recorded client conventions (from `client/INSIGHTS.md`, verbatim)

- **Test stack (2026-06-24, Tooling):** "Client component tests use `fireEvent` from
  `@testing-library/react` — `@testing-library/user-event` is NOT a dependency, so
  `import userEvent` fails typecheck. Pattern: `vi.mock` the data hooks + `next/navigation`,
  render under `NextIntlClientProvider` (messages imported by relative path, `@/` can't
  reach `messages/`) + `ToastProvider`; assert toasts via their rendered text."
- **Mocked-module completeness (2026-07-05):** when a test `vi.mock`s a shared hooks module,
  ALL used exports must be provided in the factory, or an un-mocked hook runs its `useQuery`
  without a provider and the suite dies with "No QueryClient set". `AgentPicker.test.tsx`
  already overrides all three `@/lib/hooks/multi-agent` exports — keep that when editing it.
- **Type-only contract imports (2026-06-28):** import `@devdigest/shared` types with
  `import type` only — never value-import a Zod schema in the client (it would pull `zod`
  into the bundle). Both target files already do this; preserve it.
- **jsdom `scrollIntoView` stub (2026-06-26):** `AgentPicker.test.tsx` already stubs
  `window.HTMLElement.prototype.scrollIntoView = vi.fn()` in `beforeEach` — keep it.
- **Reset-on-prop-change is a render-phase pattern, not an effect (react-best-practices,
  "Derive, Don't Store" / "adjusting state when a prop changes"):** call `setState` during
  render guarded by a comparison to the previous value; do NOT sync props→state via
  `useEffect`. No side effect goes inside a `setState` updater (INSIGHTS 2026-07-05).

### CP-2 — `useMultiAgentRun` (full body, `client/src/lib/hooks/multi-agent.ts:59-67`) — Slice B & C

```ts
export function useMultiAgentRun(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["multi-agent-run", prId],
    queryFn: () => api.get<MultiAgentRun>(`/pulls/${prId}/multi-agent`),
    enabled: prId != null,
    refetchInterval: (query) =>
      (query.state.data?.columns ?? []).some((c) => c.status === "running") ? 4000 : false,
  });
}
```

Consequence for the plan: on the destination page (Fix 4), `["multi-agent-run", prId]` has
no cached data yet (the launch ack does not seed it — see CP-3), so `useMultiAgentRun`
starts in a loading state → the page's `runLoading` skeleton shows (AC-12), then resolves to
Results (AC-13). It self-polls while any column is `running`.

### CP-3 — `useLaunchMultiAgentRun` (full body, `client/src/lib/hooks/multi-agent.ts:39-51`) — Slice B & C

```ts
export function useLaunchMultiAgentRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ prId, agentIds }: LaunchMultiAgentRunInput) =>
      api.post<MultiAgentRunLaunch>(`/pulls/${prId}/multi-agent-run`, {
        agent_ids: agentIds,
      } satisfies MultiAgentRunRequest),
    onSuccess: (_d, { prId }) => {
      qc.invalidateQueries({ queryKey: ["multi-agent-run", prId] });
    },
  });
}
// Input: { prId: string; agentIds: string[] }  (unchanged by these fixes)
```

`onSuccess` only invalidates — it does not `setQueryData` the run. Fix 4 changes ONLY the
client navigation target after a successful launch; the request and this hook are untouched.

### CP-4 — `useAgents` + the `enabled` predicate (`client/src/lib/hooks/agents.ts:8-13`) — Slice B & C

```ts
export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: () => api.get<Agent[]>("/agents"),
  });
}
```

Each `Agent` carries an `enabled: boolean` flag. "Enabled agents" = `agents.filter(a => a.enabled)`
— the exact predicate `ConfigureRun` already applies (ConfigureRun.tsx:40). Fix 3 makes
`AgentPicker` use the same predicate.

### CP-5 — `AgentColumn.agent_id` (`client/src/vendor/shared/contracts/observability.ts:35-49`) — Slice B

```ts
export const AgentColumn = z.object({
  run_id: z.string(),
  agent_id: z.string(),        // ← the id used to restore the Configure-run selection (Fix 2)
  agent_name: z.string(),
  // …
});
```

`MultiAgentRun.columns: AgentColumn[]` (observability.ts:75-86); each column's `agent_id`
names an agent that participated in the run. Restored selection (AC-4/AC-5) =
`run.columns.map(c => c.agent_id)` ∩ `enabled agent ids`.

### CP-6 — `activeKeyFor` (`client/src/components/app-shell/helpers.ts:26-40`, UNCHANGED) — Slice A

```ts
export function activeKeyFor(pathname: string): string {
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.includes("/multi-agent")) return "multi-agent";   // ← already handles the move
  // … memory / agent-performance keys exist ONLY here, NOT in NAV …
  if (pathname.startsWith("/ci-runs")) return "ci-runs";
  return "";
}
```

This is path-based, not group-based, so moving the nav item between sections requires zero
change here (AC-2). The `memory` / `agent-performance` keys are future scaffolding that must
stay out of `NAV` (AC-3).

### CP-7 — `NAV` GLOBAL section target shape (`client/src/vendor/ui/nav.ts:40-49`) — Slice A

After Fix 1 the GLOBAL section's `items` array is (order matters — Multi-Agent Review FIRST,
above CI Runs), with the item def copied verbatim from WORKSPACE (nav.ts:26):

```ts
section: "GLOBAL",
items: [
  { key: "multi-agent", label: "Multi-Agent Review", icon: "Users", href: "/repos/:repoId/multi-agent", gKey: "m" },
  { key: "ci-runs", label: "CI Runs", icon: "Activity", href: "/ci-runs" },
],
```

The WORKSPACE `items` array loses the `multi-agent` entry (remaining order: `pulls`,
`onboarding-tour`, `context`). `SHORTCUTS` (nav.ts:72-86, the `g m` entry at :76) is
untouched. No `memory`/`agent-performance` item is added.

### CP-8 — Test-file skeleton (verbatim from `ConfigureRun.test.tsx:1-53`) — pattern for Slice B & C

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import runsMessages from "../../../../../../../messages/en/runs.json";
import { ToastProvider } from "@/lib/toast";
import { ConfigureRun } from "./ConfigureRun";

const usePulls = vi.fn();
const useAgents = vi.fn();
const useAgentEstimates = vi.fn();
const launchMutate = vi.fn();

vi.mock("@/lib/hooks/core", () => ({ usePulls: () => usePulls() }));
vi.mock("@/lib/hooks/agents", () => ({ useAgents: () => useAgents() }));
vi.mock("@/lib/hooks/multi-agent", () => ({
  useAgentEstimates: () => useAgentEstimates(),
  useLaunchMultiAgentRun: () => ({ mutate: launchMutate, isPending: false }),
}));
// beforeEach seeds each vi.fn() return; afterEach(cleanup). Messages imported by RELATIVE
// path (the @/ alias can't reach messages/). Assert via fireEvent + screen (no userEvent).
```

`AgentPicker.test.tsx` uses the same shape plus `vi.mock("next/navigation", …)` exposing a
hoisted `push`/`mutateAsync` (AgentPicker.test.tsx:15-43). `page.test.tsx` mocks the child
views as text markers (page.test.tsx:26-29) and drives mode via the `useMultiAgentRun` mock.

### CP-9 — Verification (this machine — WSL ext4 mirror, NOT `pnpm test` from `/mnt/e`)

- Client unit/component tests (green barrier): `bash scripts/test-mirror.sh client test`
- Client lint (run before push — lint-only failures are invisible to test/typecheck):
  `bash scripts/test-mirror.sh client lint`
- Run from inside WSL: `wsl.exe -d Ubuntu-24.04-dev-digest-test -- bash -lc '…'`.
- **Evals gate does NOT apply** — no `.claude/**`, `CLAUDE.md`, or `AGENTS.md` edits.

## Tasks

### Phase 1 — Slice A: Nav placement (Fix 1)   (parallel-safe)
- **Surface:** client (UI)
- **Disjoint scope:** `client/src/vendor/ui/nav.ts`, `client/src/vendor/ui/shell/Sidebar.test.tsx`
- **Skills to apply:** react-frontend-architecture, react-best-practices, react-testing-library (tests)
- **What changes & why:** Relocate the existing `multi-agent` nav item from `WORKSPACE` to
  `GLOBAL` (above `ci-runs`) so the sidebar matches the design mock, preserving all its
  attributes. Pure config relocation — see CP-7. `activeKeyFor` (CP-6) and `SHORTCUTS` are
  untouched. Then align the Sidebar test's Multi-Agent block from WORKSPACE to GLOBAL.
- **How to test:** `bash scripts/test-mirror.sh client test` (+ `… client lint`). Assertions
  exercise the real `NAV`/`SHORTCUTS` config via `<Sidebar>` (no data hooks).
- [x] T1  Move the `multi-agent` `NavItemDef` out of `WORKSPACE.items` and into `GLOBAL.items` as the FIRST entry (above `ci-runs`), copying key/label/icon(`Users`)/href/gKey(`m`) verbatim; make no other change (no new `memory`/`agent-performance` item, `SHORTCUTS` `g m` untouched).   → AC-1, AC-3   → test_multi_agent_in_global_above_ci_runs
- [x] T2  Rewrite the `Sidebar.test.tsx` "Multi-Agent Review nav item" block: assert the item renders in the `GLOBAL` group positioned BEFORE "CI Runs", is ABSENT from the `WORKSPACE` group, and still `toMatchObject({ key, label, icon:"Users", href, gKey:"m" })`.   → AC-1   → test_multi_agent_in_global_above_ci_runs
- [x] T3  Keep/adapt the active-highlight case: `<Sidebar ctx={{ activeKey: "multi-agent" }} />` marks the Multi-Agent link with `aria-current="page"` and leaves others unset (activeKeyFor unchanged).   → AC-2   → test_multi_agent_active_highlight
- [x] T4  Assert no `memory` or `agent-performance` item exists in `NAV` (`NAV.flatMap(g=>g.items)`), and the `g m` shortcut is still present in `SHORTCUTS` mapped to Multi-Agent Review.   → AC-3   → test_no_new_nav_items_and_gm_shortcut

### Phase 2 — Slice B: Configure-run restores the run's selection (Fix 2)   (parallel-safe)
- **Surface:** client (UI)
- **Disjoint scope:** `client/src/app/repos/[repoId]/multi-agent/_components/ConfigureRun/ConfigureRun.tsx`, `client/src/app/repos/[repoId]/multi-agent/page.tsx`, `client/src/app/repos/[repoId]/multi-agent/_components/ConfigureRun/ConfigureRun.test.tsx`
- **Skills to apply:** react-best-practices (Derive-Don't-Store; adjust-state-on-prop-change render-phase pattern), react-frontend-architecture, react-testing-library (tests)
- **What changes & why:** When Configure-run is opened for a PR that already has a multi-run,
  pre-check the run's agents (∩ enabled). The page has the `run` in hand (from
  `useMultiAgentRun`, CP-2) when "Configure run" is clicked from Results, so it passes the
  run's agent ids down; `ConfigureRun` seeds its selection from `initialAgentIds ∩ enabled`
  (CP-4/CP-5) once `agents` is loaded, and resets when the PR changes. **Recommended
  mechanism (self-contained, unit-testable, robust to `useAgents` load timing — see
  Requirements review):** a render-phase latch in `ConfigureRun`, e.g. track
  `{ prId, seeded }`; when `prId` changes → reset (`selected = new Set()`, `seeded=false`,
  clears stale selection for AC-7); else when `!seeded && agents != null` → seed
  `selected = new Set(initialAgentIds.filter(id => enabledIds.has(id)))` and set `seeded=true`
  (AC-4/AC-5; empty `initialAgentIds` → empty selection for AC-6). No `useEffect` prop→state
  sync; no side effect inside a `setState` updater (CP-1).
- **How to test:** `bash scripts/test-mirror.sh client test` (+ `… client lint`). Hooks
  mocked at the boundary per CP-8; `useAgents` returns two enabled + one disabled agent.
- [x] T5  In `ConfigureRun.tsx`, add prop `initialAgentIds?: readonly string[]` and seed `selected` from `initialAgentIds ∩ enabled agent ids` the first render `agents` is loaded; leave existing enabled-only list / estimate / launch logic intact.   → AC-4, AC-5   → test_configure_restores_run_selection
- [x] T6  In `page.tsx`, compute `initialAgentIds = run?.columns.map(c => c.agent_id) ?? []` (memoized on `run`) and pass it to `<ConfigureRun … initialAgentIds={…} />`; do NOT alter the `runLoading` skeleton or `inResults` logic (additive change only).   → AC-4   → test_configure_restores_run_selection
- [x] T7  In `ConfigureRun.tsx`, reset the selection when the `prId` prop changes (render-phase latch) so no stale selection carries across PRs; a fresh PR (empty `initialAgentIds`) yields an empty selection.   → AC-6, AC-7   → test_configure_pr_change_resets
- [x] T8  Add ConfigureRun test: given `initialAgentIds=["a1","a2"]` (both enabled) and `prId="pr1"`, the "Security" and "Performance" checkboxes render checked and the launch button reads "Run multi-agent review (2)".   → AC-4   → test_configure_restores_run_selection
- [x] T9  Add ConfigureRun test: given `initialAgentIds=["a1","a3"]` where a3 is disabled, only a1 is checked, "Retired" is not rendered, count is 1, and launching sends `agentIds:["a1"]`.   → AC-5   → test_configure_restore_intersects_enabled
- [x] T10 Add ConfigureRun test: with no `initialAgentIds` the selection starts empty and the run button is "(0)" disabled (current behavior preserved).   → AC-6   → test_configure_fresh_pr_empty
- [x] T11 Add ConfigureRun test: render with `prId="pr1"` + `initialAgentIds=["a1"]`, toggle another agent, then `rerender` with `prId="pr2"` + `initialAgentIds=[]` and assert the selection reset (no stale checkboxes; button back to "(0)").   → AC-7   → test_configure_pr_change_resets

### Phase 3 — Slice C: PR-header picker enabled-only + land on Results (Fix 3 + Fix 4)   (parallel-safe)
- **Surface:** client (UI)
- **Disjoint scope:** `client/src/app/repos/[repoId]/pulls/[number]/_components/AgentPicker/AgentPicker.tsx`, `client/src/app/repos/[repoId]/pulls/[number]/_components/AgentPicker/AgentPicker.test.tsx`, `client/src/app/repos/[repoId]/multi-agent/page.test.tsx`
- **Skills to apply:** react-best-practices, next-best-practices (`useRouter().push` from `next/navigation`), react-frontend-architecture, react-testing-library (tests)
- **What changes & why:** (Fix 3) `AgentPicker` currently renders `const all = agents ?? []`
  (AgentPicker.tsx:62) — all workspace agents. Filter it to enabled (CP-4) so the list, the
  count, clear, the launch payload, and the empty state all operate over the enabled subset,
  matching the Configure-run page. (Fix 4) `handleLaunch` pushes `/repos/${repoId}/multi-agent`
  without `?pr=` (AgentPicker.tsx:90); change it to `/repos/${repoId}/multi-agent?pr=${prId}`
  so the destination opens for that PR and resolves to Results (the page already handles
  skeleton→Results — see Requirements review; no page.tsx change). AC-12/AC-13 are verified by
  new `page.test.tsx` cases only.
- **How to test:** `bash scripts/test-mirror.sh client test` (+ `… client lint`).
  `AgentPicker.test.tsx` needs a per-test-configurable `useAgents` mock (mirror CP-8 —
  `const useAgents = vi.fn()` set in `beforeEach`) to vary enabled/disabled sets; keep the
  existing all-exports override of `@/lib/hooks/multi-agent` (CP-1) and the `next/navigation`
  hoisted `push`/`mutateAsync`.
- **Cross-slice note:** Slice B edits `page.tsx` (production) while this slice edits
  `page.test.tsx` (tests) — different files, no overlap. Slice B's change is additive
  prop-threading and does not touch the `runLoading` skeleton / `inResults` logic that AC-12/
  AC-13 assert; the `page.test.tsx` mock renders `ConfigureRun` as a text marker, so it is
  independent of Slice B. Safe to run concurrently.
- [x] T12 In `AgentPicker.tsx`, change `const all = agents ?? []` to `const all = (agents ?? []).filter((a) => a.enabled)` so the list, count, clear, launch payload, and empty state all operate over enabled agents only.   → AC-8, AC-9, AC-10   → test_agentpicker_enabled_only
- [x] T13 In `AgentPicker.tsx` `handleLaunch`, navigate to `` `/repos/${repoId}/multi-agent?pr=${prId}` `` after a successful launch (was `/repos/${repoId}/multi-agent`); leave the error/toast/no-navigation-on-failure path unchanged.   → AC-11   → test_agentpicker_navigates_with_pr
- [x] T14 Refactor `AgentPicker.test.tsx` to a per-test `useAgents` mock, then assert the picker lists only enabled agents (a disabled agent is not rendered as a checkbox).   → AC-8   → test_agentpicker_enabled_only
- [x] T15 Add AgentPicker test: with a mix of enabled + disabled agents, count/select/clear and the launch `mutateAsync` payload include only enabled agent ids (disabled excluded).   → AC-9   → test_agentpicker_enabled_subset_ops
- [x] T16 Add AgentPicker test: when `useAgents` returns zero enabled agents, the panel shows the `agentPicker.noAgents` empty state (computed over the enabled subset).   → AC-10   → test_agentpicker_empty_state
- [x] T17 Update the two existing AgentPicker launch assertions (happy-path + merged-PR) to expect `push` called with `/repos/r1/multi-agent?pr=pr1`.   → AC-11   → test_agentpicker_navigates_with_pr
- [x] T18 Add `page.test.tsx` case: with `?pr=pr1` and `useMultiAgentRun` returning `{ data: undefined, isLoading: true }`, the page renders the skeleton and NOT the "CONFIGURE" marker.   → AC-12   → test_page_skeleton_while_loading
- [x] T19 Add `page.test.tsx` case: with `?pr=pr1` and `useMultiAgentRun` returning `{ data: RUN, isLoading: false }`, the page resolves to Results (Columns/Conflicts markers) and NOT "CONFIGURE".   → AC-13   → test_page_resolves_to_results

## Traceability matrix
| AC   | Task | Test                                    | Commit |
|------|------|-----------------------------------------|--------|
| AC-1 | T1, T2   | test_multi_agent_in_global_above_ci_runs | —      |
| AC-2 | T3       | test_multi_agent_active_highlight        | —      |
| AC-3 | T1, T4   | test_no_new_nav_items_and_gm_shortcut    | —      |
| AC-4 | T5, T6, T8 | test_configure_restores_run_selection  | —      |
| AC-5 | T5, T9   | test_configure_restore_intersects_enabled | —     |
| AC-6 | T7, T10  | test_configure_fresh_pr_empty            | —      |
| AC-7 | T7, T11  | test_configure_pr_change_resets          | —      |
| AC-8 | T12, T14 | test_agentpicker_enabled_only            | —      |
| AC-9 | T12, T15 | test_agentpicker_enabled_subset_ops      | —      |
| AC-10| T12, T16 | test_agentpicker_empty_state             | —      |
| AC-11| T13, T17 | test_agentpicker_navigates_with_pr       | —      |
| AC-12| T18      | test_page_skeleton_while_loading         | —      |
| AC-13| T19      | test_page_resolves_to_results            | —      |

Commit is "—" at planning time; implementers fill it as tasks land; plan-verifier audits
AC↔task↔test coverage against this table.

## Risks & mitigations

- **AC-4 fails on direct-land (agents cold at mount).** If the seed uses a bare mount-time
  `useState` initializer, a direct navigation to `/multi-agent?pr=X` → "Configure run" can
  seed empty and never recover. *Mitigation:* seed the first render `agents != null` (Slice B
  design); the component test that mocks `useAgents` synchronously does not catch this, so the
  guard must be applied by design, not left to the test.
- **Restored selection leaks disabled agents into the launch payload.** If the seed does not
  intersect with enabled ids, `selected` (and thus `count` / `agentIds`) could include a
  disabled agent that ran. *Mitigation:* intersect at seed time (AC-5) — covered by T9.
- **AC-7 not testable at the unit level.** If reset lives in a page-level `key={prId}`,
  `ConfigureRun.test.tsx` cannot exercise it via `rerender`. *Mitigation:* keep the reset
  inside `ConfigureRun` (render-phase `prId` latch) — T7/T11.
- **Sidebar order regression from the group move.** WORKSPACE still contains
  `pulls → onboarding-tour → context`; the existing Onboarding-Tour/Project-Context order
  tests must stay green. *Mitigation:* verify the whole `Sidebar.test.tsx` suite passes, not
  just the rewritten block.
- **Cross-slice `page` confusion.** Two slices touch the "page" (Slice B → `page.tsx`, Slice C
  → `page.test.tsx`). *Mitigation:* the disjoint-scope lists and the Slice C cross-slice note
  pin the file boundary; Slice B's change is additive and orthogonal to the skeleton/Results
  logic.
- **Lint-only failures invisible to tests.** A stray import/boundary violation reddens CI's
  `pnpm lint` + `next build` but not `pnpm test`/`typecheck`. *Mitigation:* run
  `bash scripts/test-mirror.sh client lint` before push (CP-9).

## Critical files for implementation
- `client/src/vendor/ui/nav.ts` — the Fix 1 relocation (Slice A).
- `client/src/app/repos/[repoId]/multi-agent/_components/ConfigureRun/ConfigureRun.tsx` — Fix 2 seed/reset (Slice B).
- `client/src/app/repos/[repoId]/multi-agent/page.tsx` — Fix 2 `initialAgentIds` threading; also the (unchanged) skeleton/Results logic AC-12/AC-13 rely on (Slice B / verified by Slice C).
- `client/src/app/repos/[repoId]/pulls/[number]/_components/AgentPicker/AgentPicker.tsx` — Fix 3 enabled filter + Fix 4 `?pr=` navigation (Slice C).
- `client/src/lib/hooks/multi-agent.ts` — reused as-is; defines the loading/polling behavior the destination page depends on (context, not edited).

## Open questions / assumptions
- **Assumption (AC-7 semantics):** "reset or reload sensibly" is satisfied by resetting the
  selection to empty when the PR changes; the plan does not require re-seeding a *different*
  PR's existing run on mid-Configure PR switch (the canonical AC-4 flow enters Configure-run
  from Results, where the run is already loaded). Non-blocking.
- **Assumption (no new i18n copy):** all fixes reuse existing `messages/en/*` keys (Fix 3's
  empty state reuses `agentPicker.noAgents`; nav labels are hardcoded English, not i18n). No
  `messages/en/*` edit is planned, consistent with the spec's non-goal. Non-blocking.
- **Assumption (page-wiring not asserted at page level):** the pre-check behavior is unit-
  tested in `ConfigureRun.test.tsx`; `page.test.tsx` is not extended to assert the
  `initialAgentIds` prop threading (the ConfigureRun mock ignores props). Non-blocking.
