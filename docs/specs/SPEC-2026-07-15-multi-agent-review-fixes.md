# Spec: Multi-Agent Review — Follow-up Fixes | Spec ID: SPEC-2026-07-15-multi-agent-review-fixes | Status: approved
Created: 2026-07-15 | Supersedes: — | Superseded by: —

## Problem & context

The L07 Multi-Agent Review feature is already specified, approved, and implemented
(`docs/specs/SPEC-2026-07-14-multi-agent-review.md`). Hands-on use of the shipped UI
surfaced five **client-only** defects that make the feature feel broken even though the
backend, contracts, and data flow are correct. This spec is a **follow-up bug-fix /
refinement** on top of SPEC-2026-07-14; it is a **separate document** — its acceptance
criteria are numbered fresh from AC-1 (it does NOT extend the 07-14 numbering).

The five defects, each verified against the current code (file:line in *Inputs*):

1. **Nav placement is wrong.** The "Multi-Agent Review" item sits in the `WORKSPACE`
   nav section, but the design mock (`pr-review-empty-01.png`) places it in the
   `GLOBAL` section (with CI Runs). The `GLOBAL` section already exists and
   `activeKeyFor` already highlights `multi-agent`, so this is a pure relocation.
2. **Configure-run does not restore the run's selected agents.** Opening "Configure
   run" from Results mode renders the reviewer picker with an empty selection, so the
   agents that already ran are not pre-checked — the user has to re-pick from scratch.
3. **The PR Detail "Run Review" picker lists disabled agents.** It renders *all*
   workspace agents, unlike the Configure-run page, which lists only enabled agents.
4. **Launching from PR Detail lands on an empty Configure-run screen.** After a
   successful launch the picker navigates to the multi-agent page *without* the `?pr=`
   query param, so the page opens in Configure-run mode with no PR and no agents
   selected (the reported `step-01` → `step-02` regression) instead of showing the live
   Results for the run that was just launched.
5. **No way to reach existing Results from Configure-run.** On the Multi-Agent Review page's
   Configure-run mode, when the selected PR already has a multi-run there is **no** affordance
   to view those existing results — the only action is launching a *new* run via "Run
   multi-agent review (N)". The Results header already offers the symmetric "Configure run"
   button, but Configure-run has no reciprocal "View results" path, so a user who lands on
   (or switches to) Configure for a PR that already has results cannot jump to them without
   re-running.

Intended outcome: the shipped Multi-Agent Review experience matches the design and
behaves coherently — the nav item is in the right section, re-configuring a run starts
from the agents that ran, the PR-header picker offers the same enabled-only agent set as
the Configure page, launching from the PR header lands the user on the live Results
for that PR, and Configure-run offers a reciprocal "View results" path to the existing
Results for the selected PR. **Fixes 1–5 are strictly the `client/**` package** — no server, no
shared contract, and no database change is required; every fix edits an existing client file.

A **sixth** defect was found later (added 2026-07-15, after Fixes 1–5) and, unlike the
others, is deliberately **NOT** client-only:

6. **"Show only conflicts" is dead UI; duplicates never surface.** The server's
   `buildConflicts` already drops every agreement group (all reviewers flagged the same
   file:line with the same severity), so the array it returns contains only disagreements.
   The client's `conflicts.filter(isDisagreement)` therefore removes nothing — the toggle
   is a no-op — and the "duplicates stop nagging, the same place is visible once" value of
   the original US-4 is not delivered: a location both agents flag identically is silently
   hidden instead of shown once. Fix 6 makes `buildConflicts` return EVERY cross-agent group
   (agreements included) and defaults the client toggle **ON**, so the block still opens on
   disagreements only but turning the toggle OFF now reveals the duplicate/agreement groups.
   This is the one deliberate server + client change in this spec (see the amended non-goals
   and RD6).

## Goals / Non-goals

### Goals
- Move the existing Multi-Agent Review nav item from `WORKSPACE` to `GLOBAL`, above
  CI Runs, with all of its attributes unchanged (Fix 1).
- When re-entering Configure-run mode for a PR that already has a multi-run, pre-select
  the agents that were part of that run (Fix 2).
- Make the PR Detail agent picker list only **enabled** agents, matching the Configure-run
  page, across selection, count, select/clear, launch, and the empty state (Fix 3).
- After a launch from the PR Detail picker, navigate to the Multi-Agent Review page **for
  that PR** so it opens in **Results** mode (live during the run), never on an empty
  Configure form (Fix 4).
- Give Configure-run mode a **"View results"** affordance (the reciprocal of the Results
  page's "Configure run" button) that appears only when the currently-selected PR already
  has a multi-run and jumps to that PR's Results mode without launching a new run (Fix 5).

- **Deliver the cross-agent dedup value behind a default-ON toggle (Fix 6).** Make the
  "Where agents disagree" block surface agreement/duplicate groups when "Show only conflicts"
  is turned OFF, while keeping the default view (toggle ON) exactly as it is today
  (disagreements only). This requires `buildConflicts` to stop dropping agreements.

### Non-goals (explicit)
- **No server / contract / DB change — EXCEPT Fix 6.** Fixes 1–5 add no new or altered
  `@devdigest/shared` contract, route, hook, migration, or schema; the existing
  `MultiAgentRun` / `AgentColumn` shapes and the `client/src/lib/hooks/multi-agent.ts` +
  `agents.ts` hooks are reused as-is. **Fix 6 is the one deliberate exception:** it changes
  the pure server helper `server/src/modules/reviews/conflicts.ts` (`buildConflicts`) so it
  returns every cross-agent group. It still touches **no** contract (`Conflict` / `AgentColumn`
  shapes unchanged), no route, no hook signature, no migration, and no schema — only the
  pure grouping logic and the client toggle default.
- **No new nav items.** Do NOT add Memory or Agent Performance items — they are not in
  `NAV` today; only `activeKeyFor` carries future-scaffolded keys for them. The `SHORTCUTS`
  "g m" entry stays exactly as-is.
- **Minimal new i18n copy.** Fixes 1–4 add none. Fix 5 adds exactly **one** English key — a
  "View results" label under the `runs` namespace's `page.*` group in
  `messages/en/runs.json`; no other new copy is introduced and no other locale directory is
  added (English-only, single `en` locale).
- **No re-design of Multi-Agent Review behavior** beyond these fixes — Columns/Tabs, trace
  drawer, parallel fan-out, estimates, and all SPEC-2026-07-14 acceptance criteria are
  unchanged. Do not widen scope. **Fix 6 refines only the conflicts block:** it revises the
  07-14 `conflicts`-set semantics (the returned array now also carries agreement/duplicate
  groups; the disagreement-only narrowing moves to the default-ON "Show only conflicts"
  toggle). SPEC-2026-07-14 AC-21/AC-22/AC-23 stay satisfied — AC-23's "toggle enabled ⇒ only
  disagreements" is exactly the default view — and AC-37's agents-agree empty state is
  preserved per the current toggle state.
- **No new client store** — state stays in TanStack Query + local component state; no
  ad-hoc `fetch` (data goes through the existing hooks / `lib/api.ts`).

## User stories

- **US-1 (Nav placement).** As a reviewer, I want Multi-Agent Review to appear in the
  GLOBAL section (as the design shows), so workspace-wide surfaces are grouped consistently
  and the nav matches the mock.
- **US-2 (Restore selection).** As a reviewer re-configuring an already-reviewed PR, I want
  the agents that already ran to be pre-checked, so I can adjust the set instead of
  reselecting everything from scratch.
- **US-3 (Enabled-only picker).** As a reviewer on the PR Detail header, I want the agent
  picker to offer only enabled agents — the same set the Configure-run page shows — so I
  cannot launch a disabled agent.
- **US-4 (Land on Results).** As a reviewer launching from the PR header, I want to land on
  the live Results for the PR I just launched, not an empty Configure form, so I can watch
  the run I started.
- **US-5 (Reach existing Results).** As a reviewer on the Configure-run page whose selected PR
  already has a multi-run, I want a "View results" button near the page title, so I can jump
  straight to that PR's existing Results instead of launching a new run.
- **US-6 (See duplicates once, disagreements by default).** As a reviewer reading the "Where
  agents disagree" block, I want it to open on genuine disagreements only, but to let me turn
  the "Show only conflicts" toggle OFF to also see the places multiple agents flagged
  identically — so a duplicate finding is visible once as "the same place", and the toggle is a
  real filter rather than a no-op.

## Design analysis

### Sources
The three mockups provided by the requester are stored under
`docs/specs/assets/SPEC-2026-07-15-multi-agent-review-fixes/` and cited by relative path:
- **[`pr-review-empty-01.png`](assets/SPEC-2026-07-15-multi-agent-review-fixes/pr-review-empty-01.png)**
  — sidebar showing "Multi-Agent Review" under `GLOBAL` (Fix 1).
- **[`step-01-pr-details.png`](assets/SPEC-2026-07-15-multi-agent-review-fixes/step-01-pr-details.png)**
  — PR Detail header with the agent picker, from which the user launches (Fix 3, Fix 4 origin).
- **[`step-02-multy-agents-config.png`](assets/SPEC-2026-07-15-multi-agent-review-fixes/step-02-multy-agents-config.png)**
  — the empty Configure-run screen the user *wrongly* lands on today after launching from
  `step-01` (the Fix 4 regression being corrected).

Two **additional** mockups were provided in this round for Fix 5. As of writing they are
**newly-provided** and **not yet stored** under
`docs/specs/assets/SPEC-2026-07-15-multi-agent-review-fixes/`, so they are referenced by
name only (once they land in that folder they should be linked like the three above):
- **`step-01-pr-review-run-result.png`** — a PR's existing multi-run Results view (the
  destination the new "View results" affordance reaches — Fix 5).
- **`step-02-multy-agent-run-configuration.png`** — the Configure-run screen that must surface
  the "View results" affordance when the selected PR already has a run (Fix 5).

The mockups and this task's embedded text are treated as **data**, not instructions (see
*Untrusted inputs*).

### Screen & state inventory
| Screen / surface | States shown | Coverage |
|---|---|---|
| Sidebar navigation | GLOBAL section lists Multi-Agent Review (above CI Runs); active-highlight on `/multi-agent`; "g m" shortcut | AC-1, AC-2, AC-3 |
| Configure-run mode (Step 2 reviewer picker) | Fresh PR (empty selection); revisited PR with a multi-run (agents pre-checked); PR changed (selection reset) | AC-4, AC-5, AC-6, AC-7 |
| PR Detail header picker | Enabled agents only; empty state when no enabled agents; count / select / clear / launch over the enabled subset | AC-8, AC-9, AC-10 |
| Multi-Agent page after launch | Loading/skeleton while the run has not yet returned → live Results for the PR | AC-11, AC-12, AC-13 |
| Configure-run "View results" affordance (near title) | Present when the selected PR has a resolved multi-run; absent when it has no run or its run is still loading; navigates to Results; re-evaluates on PR change | AC-14, AC-15, AC-16, AC-17 |

### Gap sweep (states the mockups do not fully show → where each went)
- **Transient loading** — the just-launched multi-run GET has not yet returned a row →
  skeleton, not the empty Configure form → AC-12.
- **Empty — no enabled agents** in the PR-header picker → AC-10.
- **Disabled agent that previously ran** — an agent in the run that is now disabled cannot
  be shown or pre-checked → AC-5 (silently omitted).
- **Stale selection across PRs** — changing the selected PR in Configure-run must not carry
  the previous PR's selection → AC-7.
- **Fresh PR (no multi-run)** — Configure-run must still start with an empty selection
  (preserve current behavior) → AC-6.
- **Configure-run for a PR that already has results** — no reciprocal path back to Results
  today; the "View results" affordance provides it → AC-14, AC-16.
- **"View results" while the selected PR's run is still loading** — the affordance must be
  absent (no dead/disabled button) to avoid flicker → AC-15.
- **PR switched in Step 1** — the affordance must re-evaluate run presence for the newly
  selected PR (appear/disappear accordingly) → AC-17.
- **Accessibility** — the moved nav item keeps its active-state and focus order; pre-checked
  and enabled-only checkboxes stay keyboard-operable with a correct checked state; the new
  "View results" button has an accessible name and natural focus order →
  Non-functional (a11y).
- **i18n / long English strings** — no new copy; existing agent-name/label layouts unchanged
  → Non-functional (i18n).

## Acceptance criteria (EARS)

Numbering is append-only and permanent within THIS document; it starts fresh at AC-1 and is
independent of SPEC-2026-07-14. One EARS pattern tag per criterion.

### Fix 1 — Nav placement (WORKSPACE → GLOBAL)
- **AC-1 [Ubiquitous]** The Multi-Agent Review navigation item shall reside in the `GLOBAL`
  nav section positioned **above** CI Runs, and shall no longer appear in the `WORKSPACE`
  section, retaining its existing `key` (`multi-agent`), label ("Multi-Agent Review"),
  icon (`Users`), href (`/repos/:repoId/multi-agent`), and `gKey` (`m`).
- **AC-2 [State-driven]** WHILE the active route matches a `/multi-agent` path, the system
  shall render the Multi-Agent Review item (now in `GLOBAL`) as the active nav item, via the
  existing unchanged `activeKeyFor` behavior.
- **AC-3 [Ubiquitous]** The relocation shall not add any Memory or Agent Performance nav
  item, and the "g m" keyboard shortcut shall remain mapped to Multi-Agent Review.

### Fix 2 — Configure-run restores the run's selected agents
- **AC-4 [Event-driven]** WHEN the user enters Configure-run mode for a PR that already has a
  multi-run, the system shall pre-select (check) the agents that were part of that run,
  identified by the run's per-agent `agent_id`s.
- **AC-5 [State-driven]** WHILE restoring a run's selection, the system shall pre-select only
  the intersection of the run's `agent_id`s with the currently-**enabled** workspace agents;
  an agent that ran but is now disabled shall be silently omitted (it is not listed, so it
  cannot be pre-checked).
- **AC-6 [Event-driven]** WHEN Configure-run opens for a PR that has no existing multi-run,
  the reviewer picker shall start with an empty selection (current behavior preserved).
- **AC-7 [Unwanted behavior]** IF the user changes the selected PR while in Configure-run
  mode, THEN the picker shall not carry a stale selection from the previously-selected PR;
  the selection shall reset or reload sensibly for the newly-selected PR.

### Fix 3 — PR Detail picker lists only enabled agents
- **AC-8 [Ubiquitous]** The PR Detail "Run Review" agent picker shall list only **enabled**
  workspace agents (disabled agents excluded), matching the Configure-run page's enabled-only
  behavior.
- **AC-9 [Ubiquitous]** The picker's selection count, its select/clear affordances, its
  "Run multi-agent review (N)" launch, and the agent-id set sent on launch shall all operate
  over the enabled subset only.
- **AC-10 [State-driven]** WHILE the set of enabled agents is empty, the picker shall show
  its "no agents" empty state, computed over the enabled subset (not over all agents).

### Fix 4 — Launching from PR Detail lands on Results (not empty Configure)
- **AC-11 [Event-driven]** WHEN a launch from the PR Detail picker succeeds, the system shall
  navigate to the Multi-Agent Review page **for that PR** — carrying the PR id as the `pr`
  query param (`/repos/:repoId/multi-agent?pr=:prId`) — rather than to the page with no `pr`
  param.
- **AC-12 [State-driven]** WHILE the just-launched multi-run has not yet been returned by the
  read, the destination page shall show its loading/skeleton state (and keep polling), and
  shall NOT display the empty Configure-run form.
- **AC-13 [Event-driven]** WHEN the multi-run for that PR becomes available, the page shall
  resolve to **Results** mode for that PR (live per-agent columns during the run), not to
  Configure-run mode.

### Fix 5 — Reach existing Results from Configure-run
- **AC-14 [State-driven]** WHILE in Configure-run mode AND the currently-selected PR has an
  existing multi-run, the system shall present a "View results" affordance near the page title
  that, when activated, navigates to that PR's Results mode — the reciprocal of the Results
  header's existing "Configure run" affordance.
- **AC-15 [State-driven]** WHILE the currently-selected PR has no existing multi-run, or its
  run is still loading, the system shall not present the "View results" affordance (no dead or
  disabled control that launches nothing).
- **AC-16 [Event-driven]** WHEN the user activates "View results", the system shall switch to
  Results mode for the currently-selected PR without launching a new run.
- **AC-17 [Event-driven]** WHEN the user changes the selected PR in Step 1, the "View results"
  affordance shall reflect the newly-selected PR's run presence — appearing for a PR that has
  a run and disappearing for a PR that has none.

### Fix 6 — "Where agents disagree" surfaces duplicates behind a default-ON toggle
- **AC-18 [Ubiquitous]** The cross-agent grouping (`buildConflicts`) shall return EVERY grouped
  location (same `file` + overlapping line range + `category`) reviewed by **at least two**
  `done` agents — genuine disagreements (divergent severities, or flagged-vs-did-not-flag) AND
  agreement/duplicate groups (all reviewers flagged the same severity) — computed on read, with
  no storage or contract-shape change. A run with fewer than two reviewing agents shall yield no
  groups.
- **AC-19 [State-driven]** WHILE the "Where agents disagree" block first renders, its "Show only
  conflicts" toggle shall default to **ON**, so the block opens showing only genuine
  disagreements (a location whose takes carry more than one distinct verdict, counting the
  synthesized `ignored` = "did not flag").
- **AC-20 [Event-driven]** WHEN the user turns the "Show only conflicts" toggle OFF, the block
  shall additionally show the agreement/duplicate groups, so a location that multiple reviewers
  flagged identically is visible once as the same place (US-6).
- **AC-21 [Unwanted behavior]** IF, given the current toggle state, no grouped location
  qualifies to show, THEN the block shall render the agents-agree empty state (preserving the
  SPEC-2026-07-14 AC-37 empty-state semantics for the block).

## Edge cases

| # | Case | Handling / mapping |
|---|---|---|
| E1 | Active route is under `/multi-agent` after the nav move | Item still highlights via existing `activeKeyFor` (no rewiring) → AC-2 |
| E2 | Configure-run entered from Results for a PR with a multi-run | Pre-check the run's agents (intersection with enabled) → AC-4, AC-5 |
| E3 | An agent that ran is now disabled | Omitted from the list and from the restored pre-selection → AC-5 |
| E4 | Configure-run opened for a PR with no multi-run | Empty selection (unchanged) → AC-6 |
| E5 | User switches the selected PR mid-configure | No stale selection carried across PRs → AC-7 |
| E6 | Workspace has zero enabled agents (PR-header picker) | Enabled-only "no agents" empty state → AC-10 |
| E7 | Launch succeeds but the multi-run GET has not returned yet | Skeleton on the destination, not the empty Configure form → AC-12 |
| E8 | Launch fails (mutation error) | Existing error toast; user stays on PR Detail; no navigation → out of scope of the fix (unchanged existing behavior) |
| E9 | Runs still `running` at the destination | Existing polling / live Results render the in-progress run — acceptable and desired → AC-13 |
| E10 | Configure-run for a PR that has no multi-run | No "View results" affordance shown (no dead button) → AC-15 |
| E11 | User switches the selected PR in Step 1 | "View results" flips to match the new PR's run presence (appears/disappears) → AC-17 |
| E12 | Selected PR's run is still loading in Configure-run | "View results" is absent until the run resolves (avoids flicker / a dead control) → AC-15 |
| E13 | All reviewers flagged the same file:line with the SAME severity (pure duplicate) | Returned as a group (no longer dropped); hidden by the default-ON toggle, shown when it is turned OFF → AC-18, AC-19, AC-20 |
| E14 | Only one agent reviewed (`done`), or a failed/running agent alongside it | No cross-agent group — nothing to compare → AC-18 |
| E15 | Every grouped location is an agreement (zero disagreements) | Default view (toggle ON) shows the agents-agree empty state; toggling OFF reveals the duplicate groups → AC-19, AC-20, AC-21 |

## Workflows & service communication

Both fixes are client-side flows (no service-communication change). The flowchart below shows
the corrected Fix 4 launch path: after a successful launch the picker forwards the PR id as
`?pr=`, the destination reads it, shows a skeleton while the run has not yet returned, and
resolves to live Results — never the empty Configure form.

```mermaid
flowchart TD
  A[PR Detail header: pick agents, Run multi-agent review N] --> B{launch succeeds?}
  B -- no --> C[error toast, stay on PR Detail, no navigation]
  B -- yes --> D[push /repos/:repoId/multi-agent?pr=:prId]
  D --> E[page reads prId from the pr query param]
  E --> F{multi-run available?}
  F -- not yet, run loading --> G[show skeleton and keep polling]
  G --> F
  F -- yes --> H[Results mode: live per-agent columns for this PR]
```

The state diagram below shows the Fix 2 selection seeding in Configure-run mode: a PR with a
multi-run opens pre-checked (the run's agents that are still enabled), a fresh PR opens empty,
and changing the PR clears any stale selection.

```mermaid
stateDiagram-v2
  [*] --> Empty: open Configure-run, PR has no multi-run
  [*] --> Restored: open Configure-run from Results, PR has a multi-run
  note right of Restored
    pre-check = the run's agent ids
    that are still enabled agents
  end note
  Empty --> Edited: toggle a checkbox
  Restored --> Edited: toggle a checkbox
  Edited --> Empty: change the selected PR (stale selection cleared)
  Restored --> Empty: change the selected PR (stale selection cleared)
```

The flowchart below shows the Fix 5 reciprocal path: in Configure-run mode the "View results"
affordance renders only when the selected PR has a resolved multi-run; activating it returns to
Results mode for that PR without launching anything, and switching the PR re-evaluates whether
the affordance is shown.

```mermaid
flowchart TD
  A[Configure-run mode for the selected PR] --> B{selected PR has a resolved multi-run?}
  B -- no or run still loading --> C[hide View results affordance]
  B -- yes --> D[show View results near the page title]
  D -- user activates --> E[switch to Results mode for this PR without launching a run]
  A -- user changes the PR in Step 1 --> B
```

## Contracts (shape-level)

**No new or changed shared contracts.** These fixes consume existing shapes as-is:

- **`MultiAgentRun`** (`observability.ts`) — `{ id, pr_id, pr_number?, ran_at, agent_count,
  total_duration_ms, total_cost_usd, columns: AgentColumn[], conflicts: Conflict[] }`.
- **`AgentColumn`** (`observability.ts`) — its `agent_id` field is the identifier used to
  restore the Configure-run selection (Fix 2). Semantics: each column's `agent_id` names an
  agent that participated in the run.
- **Agent list** (`useAgents`) — each agent carries an `enabled` flag; "enabled agents" is
  `agents.filter(a => a.enabled)`, the same predicate the Configure-run page already applies
  (Fix 3).
- **Launch input** (`useLaunchMultiAgentRun`) — `{ prId, agentIds }`; unchanged. Fix 4 changes
  only the post-launch client navigation target, not the request or response.

Derived (client-side, no persisted shape) — the **restored selection** for Configure-run:

| Input | Type / source | Rule |
|---|---|---|
| run agent ids | `run.columns[].agent_id` (from `useMultiAgentRun`) | the agents that ran |
| enabled agents | `useAgents().filter(enabled)` | the currently-selectable set |
| restored selection | set of agent ids | `run agent ids` ∩ `enabled agent ids` (AC-5) |

*Non-binding design note for the planner (HOW, not a requirement):* the page has the run in
hand when "Configure run" is clicked from Results, so the restored set can be threaded to the
picker (e.g. an `initialAgentIds` prop) and used to seed component state at mount; the exact
threading is a planner choice. AC-4/AC-5/AC-7 state only the behavior.

## Non-functional

- **Layering (Onion):** N/A — client-only; no server/service/repository/contract/DB change.
- **State & data access:** TanStack Query only; **no new store** (React Context stays limited
  to the active repo). All data flows through the existing hooks (`useMultiAgentRun`,
  `useAgents`, `useLaunchMultiAgentRun`, `useAgentEstimates`) and `lib/api.ts`; **no ad-hoc
  fetch**. Repo-intel confirms the client's React-Query conventions (array `queryKey`,
  `invalidateQueries` after a mutation) — honored by the reused hooks.
- **Zod-contract discipline:** N/A — no new contract, no barrel edit, nothing re-vendored.
- **Accessibility:** the relocated nav item keeps its active state and focus order; the
  pre-checked (Fix 2) and enabled-only (Fix 3) checkboxes remain fully keyboard-operable with
  an accurate `checked` state and unchanged accessible names. The Fix 5 "View results" control
  is a real button with an accessible name, keyboard-operable and in the natural focus order
  near the page title; when the selected PR has no run it is removed from the DOM (not merely
  visually hidden or left as a disabled dead control).
- **i18n:** English-only (single `en` locale). Fixes 1–4 add no copy. Fix 5 adds exactly **one**
  English label — a "View results" key under the `runs` namespace's `page.*` group in
  `messages/en/runs.json`; no other new copy and no other `messages/<locale>/` directory are
  introduced.
- **Performance:** N/A — no new network calls; the enabled-agent filter and the run∩enabled
  intersection are trivial in-memory operations over small lists. Fix 4 reuses the page's
  existing polling/skeleton (no new polling introduced).
- **Security:** N/A for new attacker-controlled surfaces. The `prId` forwarded as `?pr=` is
  the same internal identifier the page and `useMultiAgentRun` already consume (not free-text
  user input). Launch agent ids are still validated server-side at the unchanged launch edge.
  Untrusted PR/finding content continues to be rendered as data (see *Untrusted inputs*).
- **Local-first:** unchanged — runs against the local API (:3001) and local Postgres; no new
  external dependency.

## Inputs (provenance)

- **[verified by direct read]** every defect fact was confirmed against current code:
  - `client/src/vendor/ui/nav.ts` — `multi-agent` item is in `WORKSPACE` at `:26`; the
    `GLOBAL` section exists at `:45-49` with only `ci-runs` (`:47`); the "g m" shortcut is at
    `SHORTCUTS[:76]`.
  - `client/src/components/app-shell/helpers.ts` — `activeKeyFor` highlights `multi-agent` for
    `/multi-agent` paths at `:28`; future-scaffolded `memory` / `agent-performance` keys exist
    only here (`:36-37`), NOT in `NAV`.
  - `client/src/app/repos/[repoId]/multi-agent/_components/ConfigureRun/ConfigureRun.tsx` —
    filters enabled agents at `:40`; initializes `selected` to an empty `Set` at `:47`;
    `selectAll` operates over `enabledAgents` (`:56-58`).
  - `client/src/app/repos/[repoId]/multi-agent/page.tsx` — reads `prId` from `search.get("pr")`
    at `:35`; `useMultiAgentRun(prId)` at `:41`; `inResults = !configuring && prId != null &&
    run != null` at `:51`; `runLoading` skeleton at `:78`; "Configure run" sets
    `configuring=true` at `:104`.
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/AgentPicker/AgentPicker.tsx` —
    `const all = agents ?? []` (no enabled filter) at `:62`; `handleLaunch` pushes
    `/repos/${repoId}/multi-agent` without `?pr=` at `:84-94`; empty state over `all` at
    `:136-137`.
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/PrDetailHeader/PrDetailHeader.tsx`
    — passes `prId` (the same identifier the page/hooks consume) into `AgentPicker` at `:84-90`.
  - `client/src/vendor/shared/contracts/observability.ts` — `AgentColumn.agent_id` at `:34-49`;
    `MultiAgentRun` at `:74-86`.
  - `client/src/lib/hooks/multi-agent.ts` — `useLaunchMultiAgentRun`, `useAgentEstimates`, and
    `useMultiAgentRun` (polls while any column is `running`, `:64-65`); `useAgents` in
    `client/src/lib/hooks/agents.ts`. No new hooks needed.
  - **Fix 5 surfaces (verified this round):**
    `client/src/app/repos/[repoId]/multi-agent/page.tsx` — the run for the selected PR is held
    via `useMultiAgentRun(prId)` (`:41`); mode is derived `inResults = !configuring && prId !=
    null && run != null` (`:58`); the Configure branch renders a `Skeleton` while `configuring
    === false && prId != null && runLoading` (`:85`) and otherwise `ConfigureRun` (`:88-98`);
    the Results header already has the symmetric `Button kind="secondary" size="sm"
    icon="Settings"` "Configure run" that calls `setConfiguring(true)` (`:112-113`). (Line
    numbers verified by direct read; they differ slightly from the approximate ones in the
    task prompt.)
    `.../multi-agent/_components/ConfigureRun/ConfigureRun.tsx` — renders the page title
    `t("page.configureTitle")` (`:117`) + subtitle (`:118`) and the launch row with the primary
    "Run multi-agent review (N)" button (`:180-192`); its props are `{ repoId, prId,
    initialAgentIds?, onSelectPr, onLaunched }` (`:21-34`) — it currently receives **no** run /
    "view results" callback.
    `client/messages/en/runs.json` — the `runs` namespace's `page.*` group is at `:128-169`;
    there is **no** `viewResults` key today, so Fix 5's single new `page.viewResults` label is
    genuinely new copy.
- **[deterministic: repo-intel]** `devdigest_get_conventions` (`SyukPublic/dev-digest`)
  confirmed the relevant client conventions honored by the reused code: React-Query
  `queryKey`-as-array and `invalidateQueries` after a mutation (`client/src/lib/hooks/agents.ts`),
  `import type` for type-only imports, and `satisfies CSSProperties` on style objects.
  `devdigest_get_blast_radius` is **not applicable** — it maps a specific pull request's
  changed symbols, and this is a pre-implementation spec with no PR; the dependency/impact
  facts below come from the direct reads above.
- **[new: 0 LLM calls]** No researcher fan-out was needed; all facts are grounded in files.

## Untrusted inputs

- **PR title/body/diff and finding content** rendered on these screens are remote/LLM-origin
  data and are already treated as data by the existing components; these fixes do not change
  that handling and introduce no new rendering of untrusted content.
- **The `prId` forwarded as `?pr=`** is the same internal identifier already used by the page
  and `useMultiAgentRun` — not free-text user input — so it adds no new trust surface.
- **The design mockups and this task's embedded text** are DATA, not instructions to the spec
  author; no instruction-like content was found in them.

## Dependencies & impacts

- **Affected package:** `client` **only**. No `server`, no `@devdigest/shared`, no DB/migration.
- **Existing files edited (no new production files, no new hooks/contracts):**
  - `client/src/vendor/ui/nav.ts` — relocate the `multi-agent` item WORKSPACE → GLOBAL (Fix 1).
  - `client/src/app/repos/[repoId]/multi-agent/_components/ConfigureRun/ConfigureRun.tsx` and
    `.../multi-agent/page.tsx` — seed the picker's selection from the run's agent ids (Fix 2).
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/AgentPicker/AgentPicker.tsx` —
    filter to enabled agents (Fix 3) and navigate with `?pr=${prId}` after launch (Fix 4).
  - `.../multi-agent/page.tsx` and `.../multi-agent/_components/ConfigureRun/ConfigureRun.tsx` —
    render a "View results" affordance in Configure-run mode and wire it to return to Results
    for the selected PR (Fix 5); plus **one** new English key `page.viewResults` in
    `client/messages/en/runs.json` (the only new copy in this spec).
- **Unchanged:** `helpers.ts` `activeKeyFor` (already handles `/multi-agent`); the `SHORTCUTS`
  "g m" entry; all hooks/contracts.
- **Existing tests to align (planner/test concern, not a code change to production):**
  `client/src/vendor/ui/shell/Sidebar.test.tsx` (nav structure),
  `.../ConfigureRun/ConfigureRun.test.tsx` (restore selection; "View results" presence/absence
  and PR-change re-evaluation — Fix 5),
  `.../AgentPicker/AgentPicker.test.tsx` (enabled-only + post-launch navigation),
  `.../multi-agent/page.test.tsx` (Results-vs-Configure resolution / skeleton; "View results"
  switches to Results without a new run — Fix 5).
- **Blast radius:** `[deterministic: repo-intel]` not applicable (no PR to map — see Inputs).

## Resolved decisions (do not reopen)

- **RD1 — Nav (Fix 1).** Move the existing `multi-agent` item from `WORKSPACE` to `GLOBAL`,
  positioned **above** `ci-runs` (order in GLOBAL: Multi-Agent Review, then CI Runs). Keep its
  `key`, `label`, `icon: "Users"`, `href`, and `gKey: "m"` unchanged. Do NOT add Memory /
  Agent Performance items (they do not exist in `NAV`; only `activeKeyFor` has the
  future-scaffolded keys). The `SHORTCUTS` "g m" entry stays as-is.
- **RD2 — Restore selection (Fix 2).** When Configure-run is opened for a PR that already has a
  multi-run, pre-check the intersection of the run's `agent_id`s with the currently-enabled
  agents. An agent that ran but is now disabled is silently omitted (it is not listed).
  *Design note (ordering assumption):* the run is already loaded when "Configure run" is clicked
  from Results, so seeding the selection at mount from the run is sufficient; changing the PR
  must still clear/reload the selection so no stale selection carries across a different PR.
- **RD3 — Enabled-only picker (Fix 3).** The PR Detail picker lists only enabled agents,
  matching the Configure-run page; selection count, select/clear, launch, and the empty state
  all operate over the enabled subset.
- **RD4 — Land on Results (Fix 4).** After a successful launch from the PR Detail picker, push
  `/repos/:repoId/multi-agent?pr=:prId`. While the just-launched runs are still `running`, the
  page's existing skeleton + polling show live Results — this is acceptable and desired; the
  fix must not leave the user on an empty Configure screen. The transient window where the
  multi-run GET has not yet returned shows loading, and the destination resolves to Results
  (not Configure) once the run is available.
- **RD5 — Reach existing Results from Configure-run (Fix 5).** Add a secondary "View results"
  button near the Configure-run page title — the symmetric counterpart to the Results header's
  "Configure run" button (same `kind="secondary" size="sm"` styling; an icon consistent with
  the existing set, e.g. a columns/results-type icon — the exact icon is a planner/implementer
  choice). Show it **only** when the currently-selected PR has an existing multi-run (`run !=
  null`); hide it when the PR has no run yet and while that PR's run is still loading (no
  dead/disabled control, no flicker). Activating it returns to Results mode for the selected PR
  by clearing the Configure override (mechanically `setConfiguring(false)` so `inResults`
  becomes true) — it launches **no** new run. It must react to the Step-1 PR selection
  (appear/disappear with the newly-selected PR's run presence). The exact prop/callback wiring
  is a planner choice — e.g. an `onViewResults` callback plus a run-presence / `hasResults` flag
  threaded into `ConfigureRun`. New copy: a single English `page.viewResults` = "View results"
  key in `messages/en/runs.json` (namespace `runs`), kept minimal.

- **RD6 — Duplicates behind a default-ON toggle (Fix 6).** `buildConflicts`
  (`server/src/modules/reviews/conflicts.ts`) stops filtering to conflicts: it returns EVERY
  cross-agent group and requires ≥2 `done` reviewers (a lone reviewer yields none — its findings
  already live in its own column/tab). The `Conflict` / `AgentColumn` contract shapes are kept
  as-is (the name `Conflict` now also covers agreement groups — the UI toggle is the conflict
  filter). On the client, `ConflictsBlock`'s "Show only conflicts" toggle defaults to **ON**
  (`useState(true)`) so the block opens on disagreements only (via the existing `isDisagreement`
  helper, now finally meaningful); turning it OFF reveals the agreement/duplicate groups. No
  route, hook, migration, i18n copy, or schema change. Chosen over renaming the section /
  defaulting the toggle OFF (which would show agreements under a "Where agents disagree" heading)
  — the default-ON toggle keeps the heading truthful while still delivering the dedup value on
  demand.

## Traceability

| AC | Story | Design ref (mockup) | Verification | Plan phase |
|---|---|---|---|---|
| AC-1 | US-1 | [pr-review-empty-01.png](assets/SPEC-2026-07-15-multi-agent-review-fixes/pr-review-empty-01.png) | unit (client pnpm test) — Sidebar: multi-agent under GLOBAL above CI Runs, gone from WORKSPACE | — |
| AC-2 | US-1 | [pr-review-empty-01.png](assets/SPEC-2026-07-15-multi-agent-review-fixes/pr-review-empty-01.png) | unit (client pnpm test) — active highlight on `/multi-agent` (activeKeyFor unchanged) | — |
| AC-3 | US-1 | [pr-review-empty-01.png](assets/SPEC-2026-07-15-multi-agent-review-fixes/pr-review-empty-01.png) | unit (client pnpm test) — no Memory/Agent-Performance item added; "g m" shortcut present | — |
| AC-4 | US-2 | — | unit (client pnpm test) — ConfigureRun pre-checks the run's agents when opened with a multi-run | — |
| AC-5 | US-2 | — | unit (client pnpm test) — restored selection = run agent ids ∩ enabled (disabled-but-ran omitted) | — |
| AC-6 | US-2 | — | unit (client pnpm test) — no multi-run → empty selection | — |
| AC-7 | US-2 | — | unit (client pnpm test) — changing PR does not carry stale selection | — |
| AC-8 | US-3 | [step-01-pr-details.png](assets/SPEC-2026-07-15-multi-agent-review-fixes/step-01-pr-details.png) | unit (client pnpm test) — AgentPicker lists only enabled agents | — |
| AC-9 | US-3 | [step-01-pr-details.png](assets/SPEC-2026-07-15-multi-agent-review-fixes/step-01-pr-details.png) | unit (client pnpm test) — count/select/clear/launch payload over enabled subset | — |
| AC-10 | US-3 | [step-01-pr-details.png](assets/SPEC-2026-07-15-multi-agent-review-fixes/step-01-pr-details.png) | unit (client pnpm test) — enabled-set empty → "no agents" empty state | — |
| AC-11 | US-4 | [step-01-pr-details.png](assets/SPEC-2026-07-15-multi-agent-review-fixes/step-01-pr-details.png) / [step-02-multy-agents-config.png](assets/SPEC-2026-07-15-multi-agent-review-fixes/step-02-multy-agents-config.png) | unit (client pnpm test) — successful launch pushes `/multi-agent?pr=:prId` | — |
| AC-12 | US-4 | [step-02-multy-agents-config.png](assets/SPEC-2026-07-15-multi-agent-review-fixes/step-02-multy-agents-config.png) | unit (client pnpm test) — page shows skeleton (not empty Configure) while run not yet returned | — |
| AC-13 | US-4 | [step-02-multy-agents-config.png](assets/SPEC-2026-07-15-multi-agent-review-fixes/step-02-multy-agents-config.png) | unit (client pnpm test) — page resolves to Results mode once the run is available | — |
| AC-14 | US-5 | step-02-multy-agent-run-configuration.png / step-01-pr-review-run-result.png (new — by name) | unit (client pnpm test) — ConfigureRun.test.tsx + page.test.tsx: "View results" shown near title when selected PR has a run | — |
| AC-15 | US-5 | step-02-multy-agent-run-configuration.png (new — by name) | unit (client pnpm test) — ConfigureRun.test.tsx + page.test.tsx: no "View results" when PR has no run / run still loading | — |
| AC-16 | US-5 | step-01-pr-review-run-result.png (new — by name) | unit (client pnpm test) — page.test.tsx: activating "View results" switches to Results mode, no new run launched | — |
| AC-17 | US-5 | step-02-multy-agent-run-configuration.png (new — by name) | unit (client pnpm test) — ConfigureRun.test.tsx + page.test.tsx: changing the selected PR flips the affordance | — |
| AC-18 | US-6 | — | unit (server) — conflicts.test.ts: buildConflicts returns the agreement group; ≥2 reviewers required | — |
| AC-19 | US-6 | — | unit (client) — ConflictsBlock.test.tsx: default view (toggle ON) shows disagreements only | — |
| AC-20 | US-6 | — | unit (client) — ConflictsBlock.test.tsx: turning the toggle OFF reveals the agreement group | — |
| AC-21 | US-6 | — | unit (client) — ConflictsBlock.test.tsx: agents-agree empty state given the toggle state | — |
