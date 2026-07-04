# Development Plan: Project Context Folder — post-review fixes

- **Spec:** docs/specs/SPEC-2026-07-04-project-context-folder.md (approved; AC-14 soft
  token-budget warn-only, AC-15 "missing" badge for unresolved attached paths).
- **Parent plan:** docs/plans/project-context-folder.md (the shipped feature; this
  batch closes its two unchecked tasks **T5** and **T24**, both mapped to AC-14).
- **Execution mode:** **single-agent, sequential.** The four fixes are largely
  independent slices, but they are executed by ONE agent, one phase after another
  (no parallel waves). Phases are ordered so the two that touch the same module /
  panel (FIX 1 → AC-14 transport, and FIX 3b → server `missing`) do not collide.
- **Branch:** labs/l05.

## Context

The "Project Context Folder" feature shipped (commit `ddf63dc`), then a review
surfaced a small, bounded batch of follow-ups. This plan covers **exactly four
fixes and nothing more** — three are user-visible correctness/consistency issues,
one is code hygiene. Grounded against the code (not memory):

1. **AC-14 is only half-wired.** The server already carries the soft budget
   (`config.projectContextTokenBudget`, `server/src/platform/config.ts:37,74,105`),
   but the client hardcodes `const SOFT_TOKEN_BUDGET = 12_000;`
   (`client/src/components/context-attach/ContextAttachPanel.tsx:23`). The UI never
   receives the server value → AC-14 is not truly end-to-end, which is why parent-plan
   **T5** and **T24** are still unchecked.
2. **A cosmetic mismatch in the skill "SERIALIZES AS" preview.** It prints
   `## Project specifications` (`ContextAttachPanel.tsx:124`), while the ACTUAL
   run-time heading the reviewer injects is `## Project context`
   (`reviewer-core/src/prompt.ts:141`). The preview lies about the real serialization.
3. **Three hygiene items:** a dead `FolderType` type alias shadowing the real shared
   enum; the server never populating the `DiscoveredDocument.missing` contract field
   (the client computes it instead); and three partial, forward-looking `uk` locale
   mirrors that the product decision is to DELETE (not translate).
4. **No sidebar nav item for the Project Context page.** The `/context` route and
   `activeKeyFor()` mapping exist, but there is no `NavItemDef` for it, so the page is
   unreachable from the sidebar.

Intended outcome: AC-14 verified end-to-end (server budget → UI warn), a truthful
serialize preview, cleaner code, and a reachable Project Context page — with the two
parent-plan tasks (T5, T24) ticked once AC-14 is proven.

## Affected packages & files

- **`server/src/platform/config.ts`** — the soft budget already lives here
  (`projectContextTokenBudget`, line 74; env key `PROJECT_CONTEXT_TOKEN_BUDGET`,
  line 37). No new key; FIX 1 only needs to EXPOSE it over the API.
- **`server/src/vendor/shared/contracts/project-context.ts`** — the shared contracts.
  FIX 1 adds a NEW response shape (a tiny config DTO) here; FIX 3b uses the existing
  `DiscoveredDocument.missing` field (already declared, line 55). This is the SERVER
  copy = source of truth; the client copy is a mirror (see Shared scaffold CP-A).
- **`server/src/modules/project-context/routes.ts`** — Fastify plugin. FIX 1 adds one
  new GET endpoint; FIX 3b extends `discover` with an optional owner selector (see FIX 3b
  design). Every handler already calls `getContext` (AC-20 guard).
- **`server/src/modules/project-context/service.ts`** — the producer service. FIX 3b
  computes `missing` here (in/around `discover`, lines 83-114). FIX 1 exposes the
  budget (a config passthrough — the value is on `container.config`).
- **`server/src/modules/project-context/constants.ts:48`** — `export type FolderType
  = string;` (FIX 3a: DEAD alias to delete — confirmed unused, see FIX 3a).
- **`client/src/components/context-attach/ContextAttachPanel.tsx`** — FIX 1 replaces
  the hardcoded `SOFT_TOKEN_BUDGET` (line 23, used line 67) with the server value;
  FIX 2 changes the preview heading (line 124).
- **`client/src/lib/hooks/project-context.ts`** — FIX 1 adds a hook for the new config
  endpoint (mirror the existing `useProjectContextDocs`, lines 18-24). FIX 3b: the docs
  hook passes the owner selector so the server returns the `missing` rows, and
  `useContextAttach` stops synthesizing them (see FIX 3b).
- **`client/src/components/context-attach/useContextAttach.ts`** — FIX 3b removes the
  client-side `missing` computation (lines 47-58, 106-118) — the server provides it.
- **`client/src/vendor/ui/nav.ts`** — FIX 4 adds the "Project Context" `NavItemDef`
  to the `NAV` WORKSPACE group (array at lines 21-36) + a `SHORTCUTS` entry.
- **`client/src/i18n/request.ts`** — READ-ONLY confirmation for FIX 3c: the loader
  `readdirSync`s ONLY `messages/en` (single locale `LOCALE = "en"`, lines 14,17,28-29)
  — deleting `uk/*` cannot break the build/runtime. No loader change needed.
- **Locale files (FIX 3c, DELETE):** `client/messages/uk/agents.json`,
  `client/messages/uk/skills.json`, `client/messages/uk/runs.json`.
  **KEEP:** `client/messages/uk/context.json` (complete).

**Tests to update / verify (existing — verified present):**
- `client/src/app/skills/[id]/_components/SkillEditor/_components/ContextTab/ContextTab.test.tsx:62`
  — asserts `/## Project specifications/` (FIX 2 must update to `## Project context`).
- `client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/ContextTab.test.tsx`
  — the agent twin does NOT assert the serialize heading (it uses `showTotalInBadge`,
  not `showSerialize`), but it DOES hardcode the 12k budget in its T24 case
  (lines 79-98: `"Over soft budget"`, `"≈ 15,000 tokens"`) — FIX 1 must update this test
  to the server-driven value (see FIX 1 test note).
- `client/src/test/project-context-i18n.test.ts` — imports `uk/runs.json`,
  `uk/agents.json`, `uk/skills.json` (lines 5,7,9) and asserts them in an `it.each`
  (lines 72-86). **FIX 3c MUST update this test** or deleting those files breaks its
  imports (compile/module-resolution failure). See FIX 3c.
- `server/test/project-context.it.test.ts` — discover + config-keys integration
  (config-keys block lines 197-216). FIX 1's endpoint + FIX 3b's `missing` add cases
  here. `server/test/project-context-contracts.test.ts` — shared-contract parse tests
  (FIX 1's new DTO adds a case; imports `FolderType` from shared, line 6 — untouched
  by FIX 3a).

**Reuse (do not re-create):**
- FIX 1 hook: mirror `useProjectContextDocs` (`hooks/project-context.ts:18-24`).
- FIX 1 endpoint: mirror the discover route scaffold (`routes.ts:45-52`) incl.
  `getContext` + `RepoParams`.
- FIX 4 icon: `Folder` (the only folder-ish icon in `vendor/ui/icons.tsx`).

## Shared scaffold (context pack)

Ready fragments so the single agent never re-opens the sources. `file:line` citations
point to the source of record.

### CP-A — Shared-contract sync (CRITICAL — read before editing any contract)
`@devdigest/shared` is TWO vendored copies: `server/src/vendor/shared` (SOURCE OF
TRUTH) and `client/src/vendor/shared` (mirror; reviewer-core aliases to the server
copy). **Never hand-edit the client copy.** After editing a contract in the server
copy, run `node scripts/sync-shared.mjs` (from repo root); CI fails on drift via
`--check` in `client.yml`. (Client INSIGHTS 2026-06-22, corrected entry.) The client
imports contracts **type-only** — do NOT value-import a contract schema in client code
(it would pull `zod` into the client bundle; client INSIGHTS 2026-06-28). FIX 1's new
DTO is added to the server copy then synced.

### CP-B — Existing discover route + `getContext` guard. `server/src/modules/project-context/routes.ts:27-52`
```ts
const RepoParams = z.object({ repoId: z.string().uuid() });
// ...
app.get(
  '/repos/:repoId/project-context',
  { schema: { params: RepoParams, response: { 200: z.array(DiscoveredDocument) } } },
  async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.discover(workspaceId, req.params.repoId);
  },
);
```
FIX 1's new endpoint mirrors this exactly (same `RepoParams`, same `getContext` call,
new `response` schema). `getContext` is the AC-20 workspace guard — call it in the
new handler too. FIX 3b extends THIS handler with an optional owner query (see FIX 3b).

### CP-C — Existing discover docs hook (mirror for FIX 1). `client/src/lib/hooks/project-context.ts:17-24`
```ts
export function useProjectContextDocs(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["project-context-docs", repoId],
    queryFn: () => api.get<DiscoveredDocument[]>(`/repos/${repoId}/project-context`),
    enabled: !!repoId,
  });
}
```
FIX 1 adds a sibling `useProjectContextConfig(repoId)` returning the budget DTO from
the new endpoint, keyed `["project-context-config", repoId]`, `enabled: !!repoId`.

### CP-D — The hardcoded budget to replace (FIX 1). `client/src/components/context-attach/ContextAttachPanel.tsx:23,66-67`
```ts
const SOFT_TOKEN_BUDGET = 12_000;                         // line 23 — DELETE
// ...
const overBudget = totalTokens > SOFT_TOKEN_BUDGET;       // line 67 — use server value
```
Replace with the value from `useProjectContextConfig(repoId)`. Keep a sensible
fallback while the query is loading (default to the server default `20_000` so the
warn threshold matches config, or gate `overBudget` off until the value resolves —
implementer's choice, but the resolved value must win). Note: config default is
`20_000` (`config.ts:37`), NOT the current client `12_000`.

### CP-E — The serialize preview heading to change (FIX 2). `client/src/components/context-attach/ContextAttachPanel.tsx:120-126`
```ts
{showSerialize && attachedCount > 0 && (
  <>
    <div style={s.serializeHead}>{t("serializeHead")}</div>
    <pre className="mono" style={s.serializeBlock}>
      {`## Project specifications\n${state.attachedPaths.map((p) => `- ${p}`).join("\n")}`}
    </pre>
```
Change `## Project specifications` → `## Project context` to match the real run-time
heading (`reviewer-core/src/prompt.ts:141`: `userSections.push(\`## Project
context\n${specsBlock}\`)`). This string is a UI-only PREVIEW; grep confirmed it
appears ONLY in this file + the one skill test — the server/runtime serialization is
already `## Project context` and needs NO change.

### CP-F — Dead type alias to delete (FIX 3a). `server/src/modules/project-context/constants.ts:47-48`
```ts
/** The `folder_type` badge a discovered doc carries (its owning root). */
export type FolderType = string;   // DEAD — shadows the real z.enum in shared
```
The real `FolderType` is the Zod enum at `server/src/vendor/shared/contracts/project-context.ts:22-23`.
`service.ts:9` imports `FolderType` from `@devdigest/shared` (NOT from constants);
the contracts test imports it from shared too. Delete the alias (and its doc comment).
Verify no importer FIRST (see FIX 3a acceptance).

### CP-G — Nav item to add (FIX 4). `client/src/vendor/ui/nav.ts:21-36`
The WORKSPACE group currently holds only Pull Requests. Add, in the WORKSPACE group,
after Pull Requests:
```ts
{ key: "context", label: "Project Context", icon: "Folder", href: "/context", gKey: "x" },
```
- `icon: "Folder"` is the only folder-ish icon in `vendor/ui/icons.tsx` (registry line 117).
- `gKey: "x"` is FREE (used: p/s/a/c/`,`; "x" mnemonic for conte**x**t) — also add a
  `SHORTCUTS` entry `{ keys: "g x", label: "Go to Project Context", group: "Navigation" }`
  (`nav.ts:58-68`) to match the pattern.
- `href: "/context"` (NOT `:repoId`-templated — the route is repo-agnostic; the page
  reads the active repo from context). `activeKeyFor()` already returns `"context"` for
  `/context` (`client/src/components/app-shell/helpers.ts:30`) — no change there.
- The sidebar renders ONLY the static `NAV` array (`vendor/ui/shell/Sidebar.tsx`
  iterates `NAV.map(...)`); there is no dynamic injection, so this edit is the whole fix.

### CP-H — i18n loader is single-locale (FIX 3c safety). `client/src/i18n/request.ts:14,16-24,28-29`
`LOCALE = "en"`; `loadMessages` `readdirSync`s `messages/<locale>/` and `getRequestConfig`
loads only `loadMessages(LOCALE)` = `messages/en`. NOTHING statically references a `uk`
namespace at runtime. Adding/removing an `en` namespace needs no wiring; deleting
`uk/*.json` cannot break the build or runtime. The ONLY consumer of the doomed `uk`
files is the test in FIX 3c.

### CP-I — Verification commands (run in WSL). See TESTING.md.
Per CLAUDE.local.md the toolchain lives inside WSL; run tests/typecheck via
`wsl.exe -d Ubuntu-24.04-dev-digest-test -- bash -lc 'cd <pkg> && pnpm test'` (and
`pnpm typecheck`). Per package: `server` (`pnpm test`, `pnpm typecheck`), `client`
(`pnpm test`, `pnpm typecheck`), `reviewer-core` (not touched by any fix — no run
needed unless FIX 2 verification wants to confirm the heading). Migrations are MANUAL
(`cd server && pnpm db:migrate`) — no fix here adds a migration. Do NOT run any
mutating command as part of planning.

## Phases

Single agent, sequential. Order rationale: FIX 3a/3c/4 are the safest, fully isolated
edits (do them first to bank progress); FIX 2 is a one-line + one-test change; FIX 1
and FIX 3b both touch the project-context module and `ContextAttachPanel` /
`useContextAttach`, so they run LAST and consecutively to avoid re-touching the same
files twice. Each phase lists the files it OWNS; because it is single-agent these are
sequencing (not parallelism) boundaries.

### Phase 1 — FIX 3a: remove the dead `FolderType` alias
- **Surface:** server (backend)
- **Owns:** `server/src/modules/project-context/constants.ts` (delete lines 47-48).
- **Depends on:** none.
- **Skills to apply:** `typescript-expert`, `onion-architecture` (contracts = single
  source of truth — the shared enum is the one authority).
- **What changes & why:** delete `export type FolderType = string;` (CP-F). It shadows
  the real `FolderType` z.enum in `@devdigest/shared` and is imported by nothing —
  `service.ts` and the tests import `FolderType` from `@devdigest/shared`. Removing the
  string alias removes a foot-gun (a future `import { FolderType } from './constants'`
  would silently get `string` instead of the enum).
- **Acceptance criteria (mini-AC F3a-1):** the alias is gone; every `FolderType`
  usage resolves to the shared z.enum; `server` typechecks and tests stay green.
- **How to test:** BEFORE deleting, prove it is unused: `rg "from ['\"].*constants['\"]"`
  in `server/src/modules/project-context` and `rg "\bFolderType\b" server/src server/test`
  — confirm no import of `FolderType` from `./constants`/`constants.js` (grep already
  shows only shared + service-local-function usages). Then `cd server && pnpm typecheck
  && pnpm test` (WSL). No test change expected.

### Phase 2 — FIX 3c: delete the partial `uk` locale mirrors
- **Surface:** client (i18n) + tests
- **Owns:** delete `client/messages/uk/agents.json`, `client/messages/uk/skills.json`,
  `client/messages/uk/runs.json`; edit `client/src/test/project-context-i18n.test.ts`.
  Does NOT touch `client/messages/uk/context.json` (KEEP — complete) or any `en` file.
- **Depends on:** none.
- **Skills to apply:** `next-best-practices`, `react-testing-library`, `typescript-expert`.
- **What changes & why:** product decision — DELETE (do not translate) the three
  partial `uk` mirrors (each holds a single Project-Context key; verified: `agents.json`
  / `skills.json` = `editor.tabs.context`, `runs.json` = `trace.prompt.perSpec`). Safe
  at runtime because the i18n loader reads only `messages/en` (CP-H). The ONLY breakage
  is the parity test `project-context-i18n.test.ts`, which imports and asserts these
  three files (lines 5,7,9 imports; lines 72-86 `it.each`). Update that test: remove the
  three `uk` imports (`ukRuns`/`ukAgents`/`ukSkills`) and the corresponding `it.each`
  rows, KEEP the `en` imports and the `context.json` en↔uk parity block (that pair still
  exists). Also drop the now-unused `enRuns`/`enAgents`/`enSkills` imports if they become
  unreferenced (typecheck/lint will flag them). Leave the test's docstring accurate.
- **Acceptance criteria (mini-AC F3c-1):** the three `uk` files are gone;
  `uk/context.json` remains; `client` build/typecheck/tests are green; the i18n parity
  test still meaningfully checks `context.json` en↔uk and no longer references the
  deleted files.
- **How to test:** `cd client && pnpm typecheck && pnpm test` (WSL). Confirm
  `project-context-i18n.test.ts` passes without the deleted imports. Optionally
  `pnpm build` to prove no static reference to the removed namespaces.

### Phase 3 — FIX 4: add the "Project Context" sidebar nav item
- **Surface:** client (UI — vendored nav config)
- **Owns:** `client/src/vendor/ui/nav.ts` (add one `NavItemDef` to the WORKSPACE
  group + one `SHORTCUTS` entry).
- **Depends on:** none.
- **Skills to apply:** `react-frontend-architecture` (where nav config lives),
  `next-best-practices`.
- **What changes & why:** add the nav item per CP-G so the existing `/context` page is
  reachable from the sidebar. `nav.ts` is the vendored route/shortcut CONFIG file (per
  `vendor/ui/README.md` Nav row) — editing it directly is the intended mechanism (the
  "one component per file" rule is about components, not this config). `activeKeyFor()`
  already keys `/context` → `"context"`, so highlighting works with no other change.
  **Placement (accepted):** the item goes in the WORKSPACE group **after "Pull
  Requests"** — the mockups show it "after Onboarding Tour", but no "Onboarding Tour"
  nav item exists in `nav.ts` (it is a ghost key in `activeKeyFor` only), so after Pull
  Requests (the only WORKSPACE item) is the accepted position.
- **Acceptance criteria (mini-AC F4-1):** a "Project Context" item (key `context`,
  label "Project Context", icon `Folder`, href `/context`, gKey `x`) renders in the
  WORKSPACE group after Pull Requests; navigating to `/context` highlights it; the
  `g x` shortcut is listed.
- **How to test:** `cd client && pnpm typecheck && pnpm test` (WSL). The smoke test
  (`src/test/smoke.test.tsx`) mounts the shell/showcase and fails on a broken nav/export;
  confirm it stays green. If a nav-rendering test asserts the item set, extend it;
  otherwise a light RTL assertion that the sidebar shows "Project Context" is optional
  (implementer's judgment — do not over-test a static config).

### Phase 4 — FIX 2: fix the "SERIALIZES AS" preview heading
- **Surface:** client (UI) + tests
- **Owns:** `client/src/components/context-attach/ContextAttachPanel.tsx` (line 124
  string) and `client/src/app/skills/[id]/_components/SkillEditor/_components/ContextTab/ContextTab.test.tsx`
  (line 62 expectation).
- **Depends on:** none (but sequenced before Phase 5 because Phase 5 also edits
  `ContextAttachPanel.tsx` — do the tiny string change first, then the FIX 1 budget
  wiring, to keep each diff clean).
- **Skills to apply:** `react-best-practices`, `react-testing-library`.
- **What changes & why:** change `## Project specifications` → `## Project context`
  (CP-E) so the skill-tab serialize PREVIEW matches the reviewer's real run-time heading
  (`reviewer-core/src/prompt.ts:141`). Update the skill `ContextTab.test.tsx:62`
  expectation from `/## Project specifications/` to `/## Project context/`. The agent
  `ContextTab.test.tsx` does NOT assert this string (agent tab uses `showTotalInBadge`,
  not `showSerialize`) — no change there. reviewer-core is NOT touched (its heading is
  already correct).
- **Acceptance criteria (mini-AC F2-1):** the skill Context tab's SERIALIZES AS block
  renders `## Project context` followed by the attached path list; its test asserts the
  new heading; `client` tests green.
- **How to test:** `cd client && pnpm test` (WSL) — the updated skill `ContextTab.test.tsx`
  proves the heading. Grep after the change: `rg "Project specifications" client/` returns
  nothing.

### Phase 5 — FIX 1: propagate `PROJECT_CONTEXT_TOKEN_BUDGET` server → UI (AC-14 end-to-end)
- **Surface:** server (backend) + `@devdigest/shared` (contract) + client (UI) +
  cross-cutting.
- **Owns (in this order):**
  1. `server/src/vendor/shared/contracts/project-context.ts` — add the new config DTO;
     then run `node scripts/sync-shared.mjs` (CP-A) to mirror into the client copy.
  2. `server/src/modules/project-context/service.ts` — a config passthrough method
     returning the budget from `container.config.projectContextTokenBudget`.
  3. `server/src/modules/project-context/routes.ts` — the new GET endpoint (CP-B).
  4. `client/src/lib/hooks/project-context.ts` — `useProjectContextConfig` (CP-C).
  5. `client/src/components/context-attach/ContextAttachPanel.tsx` — replace the
     hardcoded `SOFT_TOKEN_BUDGET` with the fetched value (CP-D).
- **Depends on:** Phase 4 (same file `ContextAttachPanel.tsx`; sequential single agent).
- **Skills to apply:** `onion-architecture` (thin route → service → config; contract at
  the boundary), `fastify-best-practices`, `zod` (new DTO), `security` (workspace-scope
  the endpoint via `getContext`), `react-frontend-architecture`, `react-best-practices`,
  `typescript-expert`.
- **Transport decision (justified):** expose the budget via a NEW, dedicated endpoint
  `GET /repos/:repoId/project-context/config` returning `{ token_budget: number }`,
  rather than folding it into the `discover` response.
  - **Why not on `DiscoveredDocument`:** the budget is a single per-workspace/repo
    scalar, not a per-document property — putting it on every doc row is wrong modelling
    and would bloat the array.
  - **Why not an envelope on `discover`:** `GET /repos/:repoId/project-context` returns
    a bare `DiscoveredDocument[]` (contract `z.array(DiscoveredDocument)`, `routes.ts:47`)
    consumed by `useProjectContextDocs` and the Project Context page + tests
    (`server/test/project-context.it.test.ts:126` asserts `res.json()` is an array).
    Wrapping it in `{ documents, token_budget }` is a breaking shape change touching more
    surface. A separate tiny endpoint is the least-invasive, additive design and matches
    the shared-contracts "new file/shape" convention.
  - The endpoint is a config passthrough: no DB, no clone read — a thin route → service
    → `container.config`. Still workspace-guarded via `getContext` for consistency, and
    it may 404 for a foreign/absent repo (mirror `discover`'s `repoRef` guard) so it
    never leaks a budget for a repo the caller can't see.
- **What changes & why:** the UI stops guessing the budget. `ContextAttachPanel`
  computes `overBudget = totalTokens > budget` using the SERVER value (**server default
  `20_000` per `config.ts:37`, kept as-is** — see the confirmed decision below — not the
  old client `12_000`). Warn-only, never blocks attach, never truncates (AC-14 unchanged
  in behavior — only the source of the threshold moves).
- **Budget default (DECISION — CONFIRMED):** keep the server default `20_000`
  (`config.ts:37`) unchanged. The UI shows whatever the server returns, so with defaults
  the warn threshold is effectively 20k. The old client `12_000` literal is removed. This
  RAISES the UI warn threshold from 12k to 20k by design (it now tracks the configurable
  server budget); the T24-related client test that hardcodes `12_000` is updated to the
  server-driven value (see the test note below).
- **Acceptance criteria:**
  - **AC-14 (end-to-end):** the attach UI's over-budget warn indicator is driven by the
    server `PROJECT_CONTEXT_TOKEN_BUDGET`; changing the env var changes the UI threshold;
    attaching is never blocked and no doc is truncated.
  - **Mini-AC F1-1:** `GET /repos/:repoId/project-context/config` returns
    `{ token_budget }` from config, is workspace-scoped (foreign repo → 404), and the
    new shape parses via the shared contract.
  - **Mini-AC F1-2 (parent-plan closeout):** `ContextAttachPanel` no longer contains a
    hardcoded budget literal (`rg "SOFT_TOKEN_BUDGET|12_000" client/src/components/context-attach`
    returns nothing).
- **How to test:**
  - Server: `cd server && pnpm test` (WSL). Add an integration case in
    `server/test/project-context.it.test.ts` (the config-keys/endpoint area,
    lines 197-216 + the `d(...)` discover block) hitting the new endpoint: returns the
    configured budget; a foreign-workspace repo 404s. Add a shared-contract parse case
    in `server/test/project-context-contracts.test.ts` for the new DTO.
  - Client: `cd client && pnpm test` (WSL). The existing agent `ContextTab.test.tsx`
    T24 case (lines 79-98) hardcodes the 12k threshold via `"Over soft budget"` +
    `"≈ 15,000 tokens"` on a 15k attached total. With the mocked config hook it must
    assert the warn fires against the SERVER-driven value. **Update that test** to mock
    `useProjectContextConfig` returning the server default `{ token_budget: 20_000 }` and
    adjust the attached total so the over-budget case still exercises the warn (e.g. a
    total above 20k), replacing the hardcoded 12k assumption. Add a case proving the
    threshold follows the mocked server value (e.g. a higher budget → same total does NOT
    warn), so the test proves the SERVER-driven threshold rather than a client literal.
- **Closeout task (do LAST, only after AC-14 is verified end-to-end):** tick **T5** and
  **T24** in `docs/plans/project-context-folder.md` (change `- [ ]` → `- [x]` at the T5
  and T24 lines, ~275 and ~396) and update their status in the Traceability matrix if a
  status column is present (the matrix rows AC-14 → T5,T24 → `test_token_ui_and_budget`
  have a `Commit` column left `—`; fill it if the project convention is to record the
  commit — otherwise leave `—` per the plan's stated "implementers fill it as tasks land").

### Phase 6 — FIX 3b: server computes `DiscoveredDocument.missing`; client consumes it
- **Surface:** server (backend) + `@devdigest/shared` semantics + client (UI).
- **Owns:**
  - `server/src/modules/project-context/service.ts` (`discover` + owner-aware handling
    that knows the owner's attached paths) and `routes.ts` (the optional owner query on
    the discover endpoint).
  - `client/src/components/context-attach/useContextAttach.ts` (**delete the client-side
    `missing` synthesis** — the attached-first seeding at lines 47-58 and the
    synthesized-row build at lines 106-118) and `client/src/lib/hooks/project-context.ts`
    (the docs hook used by the Context tab passes the owner selector).
- **Depends on:** Phase 5 (same module + same panel/hook files; sequential).
- **Skills to apply:** `onion-architecture` (the `missing` decision is service logic
  over repo state; DB via repository; clone read via `container.git`),
  `fastify-best-practices`, `zod`, `react-frontend-architecture`, `react-testing-library`,
  `typescript-expert`, `security` (keep the AC-20 workspace guard + AC-22 traversal
  guard already in the service).
- **The core design problem (grounded):** `DiscoveredDocument.missing` is a declared,
  nullish contract field (`server/src/vendor/shared/contracts/project-context.ts:55`)
  that the SERVER never sets — `discover()` (`service.ts:83-114`) returns ONLY docs that
  physically exist on the clone, so an attached-but-absent path is not in that list at
  all. Today the CLIENT derives "missing" purely from the delta between the owner's
  attached paths and the discovered set: `useContextAttach` seeds attached-first
  (`useContextAttach.ts:49-58`) and synthesizes a `{ …, missing: true }` row for any
  attached path not found in `docs` (`useContextAttach.ts:107-118`); `ContextRow` renders
  the badge off `doc.missing` (`ContextRow.tsx:42,96-100`). To move this to the server,
  the server must know the OWNER's attached paths — but `discover` is repo-only.
- **Design (APPROVED): B1 — owner-aware discovery.** The discover endpoint computes and
  returns `DiscoveredDocument.missing`; the client deletes its own `missing` synthesis
  entirely. Concretely:
  - Extend `GET /repos/:repoId/project-context` with an optional owner selector (query
    `?owner=agents|skills&ownerId=<id>`, or an equivalent `?forAgent=<id>` / `?forSkill=<id>`
    form) → the service loads that owner's attached paths (via `resolveSpecPathsForAgent`
    for an agent, or `attachedSpecsForSkill` for a skill), then RETURNS the union: present
    discovered docs (with `missing: false`/absent) PLUS a synthesized `DiscoveredDocument`
    row for each attached path NOT present on the clone (`missing: true`, `folder_type`
    derived from the leading segment, `tokens: 0`).
  - The Project Context PAGE keeps calling the endpoint with NO owner (present docs only,
    current behavior byte-for-byte). The Context TABS pass the owner → the server-computed
    `missing` rows come back, and `useContextAttach` **removes its `missing` synthesis
    entirely** (delete the attached-first seeding branch and the synthesized-row build;
    render straight from the server-provided doc list, which now already contains any
    `missing: true` rows in order). The ordering/attached-first result must still hold —
    achieved via the server-returned list order, not client synthesis.
  - **Behavior parity requirement (AC-15):** the rendered result must be IDENTICAL to
    today — a missing attached path shows a "missing" badge, stays checked, and stays
    detachable (the agent test T25, `agents/.../ContextTab.test.tsx:100-109`, encodes
    exactly this). The server just becomes the source of the `missing` flag instead of
    the client.
- **What changes & why:** the server owns `missing` (single source of truth at the
  boundary, per onion contract rule); the client stops re-deriving it. `useContextAttach`
  seeds from the server-provided rows directly (a `missing:true` row is just another row
  in `docs`), removing the synthesis branch entirely.
- **Acceptance criteria:**
  - **AC-15 (unchanged behavior, new source):** an attached path that no longer resolves
    on the clone renders with a "missing" badge in the agent AND skill Context tabs, stays
    checked, and stays detachable — with the flag now supplied by the SERVER.
  - **Mini-AC F3b-1:** the server sets `DiscoveredDocument.missing` for attached-but-absent
    paths; discovery WITHOUT an owner is unchanged (present docs only, no `missing:true`
    rows) so the Project Context page is unaffected.
  - **Mini-AC F3b-2:** `useContextAttach` no longer computes `missing` (grep the file for
    the synthesized-row branch — it is gone); rows come straight from the docs list.
- **How to test:**
  - Server: `cd server && pnpm test` (WSL). Add an integration case in
    `server/test/project-context.it.test.ts`: seed an agent (and a skill) with an attached
    path that does NOT exist under the clone roots, request owner-aware discovery, assert a
    row with that path and `missing: true` comes back; assert owner-LESS discovery does not
    include it. Reuse the `FsGitClient` + `seedRepo` harness already in that file.
  - Client: `cd client && pnpm test` (WSL). The agent T25 test
    (`agents/.../ContextTab.test.tsx:100-109`) currently mocks `useProjectContextDocs`
    returning present docs and relies on the CLIENT to synthesize the missing row from
    `mockAttached`. After B1, update the mock so the docs list already includes the
    `{ path: "specs/deleted.md", …, missing: true }` row (as the server would return),
    and assert the badge + detachable behavior are unchanged. Add/adjust a
    `useContextAttach` unit test if one exists to prove no client-side synthesis remains.

## Tasks

Task numbering follows phase order (Phase 1 → T1, …); Phase 5 (FIX 1) spans several
tasks (contract DTO+sync, endpoint, hook+UI wiring, tests, closeout tick); Phase 6
(FIX 3b) splits into a server task and a client task. Each maps to its AC-ID(s) and a
snake_case test id (for pure-deletion/hygiene tasks the "test" is the guarding suite
staying green plus the stated grep).

- [ ] T1 Remove the dead `FolderType` string alias in project-context `constants.ts` → F3a-1 → test_dead_alias_removed
- [ ] T2 Delete the three partial `uk` locale mirrors and update the i18n parity test → F3c-1 → test_i18n_parity_after_delete
- [ ] T3 Add the "Project Context" WORKSPACE nav item (after Pull Requests) + `g x` shortcut → F4-1 → test_nav_item
- [ ] T4 Change the SERIALIZES-AS preview heading to `## Project context` and update the skill ContextTab test → F2-1 → test_serialize_heading
- [ ] T5 Add the config DTO to the shared contract and run `sync-shared.mjs` → F1-1 → test_config_contract_parse
- [ ] T6 Add the `GET /repos/:repoId/project-context/config` endpoint (thin route → service → `container.config`, workspace-guarded, 404 on foreign repo) → AC-14, F1-1 → test_config_endpoint
- [ ] T7 Wire `useProjectContextConfig` and replace the hardcoded `SOFT_TOKEN_BUDGET` with the server value; update the T24 agent test to the server-driven threshold → AC-14, F1-2 → test_budget_ui_server_driven
- [ ] T8 Tick parent-plan T5/T24 (and fill the Traceability `Commit` cells per convention) once AC-14 is verified end-to-end → AC-14 → test_token_ui_and_budget
- [ ] T9 Server computes `DiscoveredDocument.missing` via owner-aware discovery (optional owner selector; owner-less path unchanged) → AC-15, F3b-1 → test_missing_server_side
- [ ] T10 Client consumes server `missing`: pass the owner selector from the docs hook and delete the `useContextAttach` synthesis; update the T25 agent test → AC-15, F3b-2 → test_missing_client_consume

## Traceability matrix

| AC | Task(s) | Test | Commit |
|---|---|---|---|
| F3a-1 | T1 | test_dead_alias_removed | — |
| F3c-1 | T2 | test_i18n_parity_after_delete | — |
| F4-1 | T3 | test_nav_item | — |
| F2-1 | T4 | test_serialize_heading | — |
| F1-1 | T5, T6 | test_config_contract_parse, test_config_endpoint | — |
| F1-2 | T7 | test_budget_ui_server_driven | — |
| AC-14 | T6, T7, T8 | test_config_endpoint, test_budget_ui_server_driven, test_token_ui_and_budget | — |
| F3b-1 | T9 | test_missing_server_side | — |
| F3b-2 | T10 | test_missing_client_consume | — |
| AC-15 | T9, T10 | test_missing_server_side, test_missing_client_consume | — |

> Parent-plan closeout: **T8** ticks parent-plan tasks **T5** and **T24** (both mapped
> to **AC-14**) only after AC-14 is verified end-to-end, and fills the parent plan's
> Traceability `Commit` cells per its "implementers fill it as tasks land" convention.
> The `Commit` column above is `—` for all rows; implementers fill it as tasks land.

## Risks & mitigations

- **FIX 1 default-value change (12_000 → 20_000).** The client currently warns at 12k;
  the server default is 20k. Keeping the server default (the confirmed decision) and
  removing the client literal RAISES the UI warn threshold to 20k. *Mitigation:* this is
  the intended behavior of AC-14 (server-configurable budget); called out in the phase and
  the T24 test update, which now asserts against the server-driven `20_000`. If a
  different threshold is ever wanted, change `PROJECT_CONTEXT_TOKEN_BUDGET`'s default in
  `config.ts` — never re-hardcode in the UI.
- **FIX 1 client bundle / zod (CP-A).** The client imports contracts type-only; the new
  DTO must be consumed type-only in client code (do not value-import its schema).
  *Mitigation:* the hook types the response via `api.get<{ token_budget: number }>` or a
  type-only `import type`; never `.parse()` client-side.
- **FIX 3b shape change (B1).** Adding owner-aware discovery is the largest change in this
  batch and adds an optional owner query to a request the Context tabs make.
  *Mitigation:* keep the owner-less discovery path byte-identical (Project Context page
  unaffected); make the owner params optional and additive.
- **FIX 3c test breakage (already identified).** Deleting the three `uk` files WILL break
  `project-context-i18n.test.ts` imports if the test is not updated in the SAME phase.
  *Mitigation:* Phase 2 owns both the deletion and the test edit; do not split them.
- **FIX 4 mockup vs code mismatch (accepted).** The mockups place the item "after
  Onboarding Tour", but no Onboarding Tour nav item exists in `nav.ts` (it is a ghost key
  in `activeKeyFor` only). *Resolution (accepted):* place it in the WORKSPACE group after
  Pull Requests (the only WORKSPACE item).
- **Shared-copy drift (all contract edits).** Editing only the server copy without
  `node scripts/sync-shared.mjs` fails CI (`--check`). *Mitigation:* CP-A makes the sync
  step explicit in Phase 5.
- **`*.it.test.ts` flakes.** Server integration tests have documented cold-start /
  Testcontainers-Reaper flakes (server INSIGHTS 2026-06-27, 2026-07-02) — a lone failure
  may be environmental. *Mitigation:* re-run the isolated file before treating a single
  red as a regression.

## Critical files for implementation

- `client/src/components/context-attach/ContextAttachPanel.tsx` — FIX 1 (budget, line 23/67)
  AND FIX 2 (heading, line 124); the shared attach surface for both Context tabs.
- `server/src/modules/project-context/service.ts` — FIX 1 (config passthrough) AND FIX 3b
  (compute `missing`); the producer service.
- `server/src/vendor/shared/contracts/project-context.ts` — FIX 1 (new config DTO) + the
  `missing` field FIX 3b populates (line 55). Source of truth; sync to client after edit.
- `client/src/components/context-attach/useContextAttach.ts` — FIX 3b removes the
  client-side `missing` synthesis.
- `client/src/vendor/ui/nav.ts` — FIX 4 (nav item + shortcut).

## Open questions / assumptions

*Non-blocking defaults taken; each flagged for the caller. The three items below are now
resolved — kept for traceability.*

- **FIX 1 transport (assumption):** a dedicated `GET /repos/:repoId/project-context/config`
  → `{ token_budget }` is used, NOT an envelope on `discover` (keeps the
  `DiscoveredDocument[]` contract + its tests intact). Reversible if the reviewer prefers
  an envelope, at the cost of a breaking shape change.
- **FIX 1 default (DECISION — CONFIRMED):** keep the server default `20_000`
  (`config.ts:37`) unchanged; the UI shows whatever the server returns (effectively 20k
  with defaults), replacing the old client `12_000` literal. The T24-related client test
  that hardcoded `12_000` is updated to the server-driven value.
- **FIX 3b design (DECISION — CONFIRMED):** **B1 — owner-aware discovery.** The discover
  endpoint computes and returns `DiscoveredDocument.missing`; the client deletes its own
  `missing` synthesis entirely. (The earlier B2 alternative is dropped.)
- **FIX 4 placement (DECISION — ACCEPTED):** the item goes in the WORKSPACE group after
  "Pull Requests" because no "Onboarding Tour" nav item exists (mockup vs code mismatch);
  gKey `x` and icon `Folder` chosen from what's free/available. Adjust label/position if
  the product wants a distinct group or a different icon once more icons are added.
- **T5/T24 closeout:** ticked ONLY after AC-14 is verified end-to-end in Phase 5; the
  Traceability `Commit` column is filled per the parent plan's stated convention
  ("implementers fill it as tasks land").
