# Development Plan: Project Context attach — duplicate-key (23505) race fix

- **Spec:** none (ACs derived below)
- **Execution mode:** single-agent

## Context

Every checkbox toggle on the agent/skill **Context** tab surfaces a 500 toast
`duplicate key value violates unique constraint "agent_specs_agent_id_path_pk"`
(or `skill_specs_skill_id_path_pk`), even though the attachment still persists —
a confusing, noisy failure on an otherwise-successful action.

The bug was fully diagnosed by live reproduction (agent
`54797abe-3b1d-4222-beea-2e98e1bc3945`): a single `POST /agents/:id/specs`
always returns 200 (3/3 repeats); two **concurrent identical** POSTs yield
exactly one 200 + one 500 with PG error `23505` (6/6 pairs). There are two
independent root causes and BOTH must be fixed:

1. **Client — the source of the double POST.** In
   `client/src/components/context-attach/useContextAttach.ts:67-78`, `toggle`
   calls `doPersist(order, next)` (a POST side effect) **inside** the
   `setLinked((prev) => { ... })` updater. With `reactStrictMode: true`
   (`client/next.config.mjs`), React StrictMode double-invokes updater functions
   in development (react.dev/reference/react/useState — "In Strict Mode, React
   will call your updater function twice"), so one click fires **two** concurrent
   POSTs. The correct pattern already exists in the sibling
   `SkillsTab.tsx:36-42`: compute `next` outside the updater, then
   `setLinked(next); if (order) persist(order, next);`.

2. **Server — defense-in-depth so concurrent identical writes converge.** In
   `server/src/modules/project-context/repository.ts`, `setAgentSpecs`
   (lines 71-90) and `setSkillSpecs` (lines 150-169) do a **non-transactional**
   DELETE-then-INSERT with no conflict handling. Under READ COMMITTED, the losing
   request's DELETE removes 0 rows after the winner commits, so its INSERT still
   hits `23505`. A transaction alone does NOT fix this — the **upsert**
   (`onConflictDoUpdate`) is the load-bearing part; the transaction keeps the
   replace-set atomic against readers/crashes.

The intended outcome: toggling attach/detach never raises a 500, and two racing
identical writes both settle successfully with the correct final state.

## Acceptance criteria

- **AC-1** — A single agent/skill **Context**-tab checkbox toggle issues exactly
  **one** persist POST, even under React StrictMode's development double-invoke of
  state updaters. (Root cause 1 — client.)
- **AC-2** — Two concurrent identical `setAgentSpecs` (resp. `setSkillSpecs`)
  calls with the same paths both settle **without** a PG `23505` error, and the
  final persisted set is correct (paths present → `order = index`; absent → detached).
  (Root cause 2 — server defense-in-depth.)
- **AC-3** — Existing semantics of `setAgentSpecs` / `setSkillSpecs` are
  preserved: paths absent from the list are detached, each present path stores
  `order = index`, and the method returns the fresh ordered set via
  `attachedSpecsForAgent` / `attachedSpecsForSkill`. No schema or migration
  changes. (Regression guard for both fixes.)

## Affected packages & files

- `client/src/components/context-attach/useContextAttach.ts` — **edit** `toggle`
  (lines 67-78) to compute `next` and call `doPersist` OUTSIDE the `setLinked`
  updater. Reuse: mirror the already-correct `SkillsTab.tsx:36-42` shape; the
  sibling `moveBefore`/`move` in this same file already call `doPersist` outside
  their updaters and are the in-file precedent.
- `server/src/modules/project-context/repository.ts` — **edit** `setAgentSpecs`
  (71-90) and `setSkillSpecs` (150-169) to wrap delete+insert in ONE
  `this.db.transaction(async (tx) => …)` and add `.onConflictDoUpdate(...)` to the
  insert. Reuse: the `db.transaction` delete-then-insert idiom in
  `server/src/modules/pulls/repository.ts:160-175`; the `onConflictDoUpdate`
  idiom in `server/src/modules/settings/repository.ts:31-34` and
  `server/src/modules/reviews/repository/run.repo.ts:205`.
- `client/src/components/context-attach/useContextAttach.strictmode.test.tsx` —
  **new** hook test (via `renderHook` under `React.StrictMode`) pinning AC-1.
- `server/test/project-context-attach.it.test.ts` — **extend** (existing file)
  with a concurrency it-test pinning AC-2/AC-3.

Read-only anchors (do NOT modify): `server/src/db/schema/project-context.ts`
(PKs: `agent_specs (agent_id, path)`, `skill_specs (skill_id, path)` — no schema
change); `client/next.config.mjs` (`reactStrictMode: true` — confirms the trigger).

## Shared scaffold (context pack)

Ready fragments the implementer should apply verbatim — no need to re-open the
source files.

### A. Client `toggle` — current (buggy) shape
`client/src/components/context-attach/useContextAttach.ts:67-78`:
```ts
const toggle = React.useCallback(
  (path: string) => {
    setLinked((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      if (order) doPersist(order, next);   // ← side effect inside the updater
      return next;
    });
  },
  [order, doPersist],
);
```

### B. Client target shape — mirror of the correct sibling
`SkillsTab.tsx:36-42` is the proven pattern (compute `next` outside, then
`setLinked(next)` + persist outside). Applied to this hook's `useCallback`
(current state is `linked`, persist is `doPersist(order, next)`):
```ts
const toggle = React.useCallback(
  (path: string) => {
    const next = new Set(linked);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setLinked(next);
    if (order) doPersist(order, next);
  },
  [linked, order, doPersist],   // deps: `linked` now read directly
);
```
Note: `moveBefore` (80-90) and `move` (92-104) already call `doPersist` outside
their setters and require no change.

### C. Server upsert idioms (drizzle-orm 0.38, verbatim in-repo)
- `db.transaction` delete-then-insert — `pulls/repository.ts:160-175`:
  ```ts
  await this.db.transaction(async (tx) => {
    await tx.delete(t.prFiles).where(eq(t.prFiles.prId, prId));
    if (files.length > 0) {
      await tx.insert(t.prFiles).values(files.map((f) => ({ /* … */ })));
    }
  });
  ```
- `onConflictDoUpdate({ target, set })` — `settings/repository.ts:31-34`:
  ```ts
  .onConflictDoUpdate({
    target: [t.settings.workspaceId, t.settings.userId, t.settings.key],
    set: { value },
  });
  ```
- PK columns to target (schema, read-only):
  `agent_specs` → `[t.agentSpecs.agentId, t.agentSpecs.path]`;
  `skill_specs` → `[t.skillSpecs.skillId, t.skillSpecs.path]`.
- Fields to refresh on conflict: the insert is a **single BATCH statement**
  (`.values(paths.map((path, i) => ({...})))`) sharing ONE `.onConflictDoUpdate`
  clause, so a per-row `i` is NOT in scope in `set` — the `set` must reference the
  `EXCLUDED` pseudo-row via raw SQL (`sql` from `drizzle-orm`; `order` is a reserved
  word so it must be quoted). A losing concurrent writer then converges the row to
  the intended order (and workspace) instead of erroring:
  ```ts
  .onConflictDoUpdate({
    target: [t.agentSpecs.agentId, t.agentSpecs.path],
    set: {
      order: sql`excluded."order"`,
      workspaceId: sql`excluded.workspace_id`,
    },
  })
  ```
  (In-repo precedent for the `sql` template + `excluded`/raw column SQL:
  `server/src/modules/repo-intel/repository.ts:445` and `:448`.)
  ALTERNATIVE (also acceptable): insert **row-by-row in a loop inside the
  transaction** so the literal `set: { order: i, workspaceId }` is in scope — but
  that is N round-trips instead of 1. If the batch insert is kept, the `excluded`
  form is REQUIRED.

### D. Test conventions
- Server DB-backed test = `*.it.test.ts`; run in WSL:
  `wsl.exe -d Ubuntu-24.04-dev-digest-test -- bash -lc 'cd /mnt/e/Sources/NeoVersity/Projects/AIAgenticEngineering/dev-digest/server && pnpm test'`
  (integration-only: `pnpm exec vitest run .it.test`). The existing
  `server/test/project-context-attach.it.test.ts` shows the fixtures to reuse:
  `startPg` / `dockerAvailable` (`d = hasDocker ? describe : describe.skip`),
  `seed(pg.handle.db)`, the `makeApp` / `workspace` / `createAgent` /
  `createSkill` helpers, and direct `pg.handle.db.insert(t.agentSpecs)` reads.
  The repository can be exercised directly via `container.projectContextRepo`
  or through the `POST /agents/:id/specs` route with `Promise.allSettled`.
- Client test = Vitest + RTL + jsdom (fetch mocked). Use `renderHook` from
  `@testing-library/react` wrapped in `React.StrictMode` (via the `wrapper`
  option) with a `vi.fn()` persist, then `act(() => result.current.toggle(path))`
  and assert `persist` was called exactly once. Mirror provider/setup style from
  `client/src/components/context-attach/ContextPreviewDrawer.test.tsx`.

## Tasks

### Phase 1 — Client: move the persist side effect out of the `setLinked` updater   (parallel-safe)
- **Surface:** client (UI)
- **Skills to apply:** `react-frontend-architecture`, `react-best-practices`, `next-best-practices`; `react-testing-library` for the test.
- **What changes & why:** Rewrite `toggle` in `useContextAttach.ts` to scaffold **B**
  — compute `next` from `linked` outside the updater, then `setLinked(next)` and
  `if (order) doPersist(order, next)` outside it; change `useCallback` deps to
  `[linked, order, doPersist]`. This removes the impure side effect from the state
  updater so React StrictMode's development double-invoke can no longer fire two
  concurrent POSTs. `moveBefore`/`move` are already correct — leave them.
- **How to test:** New `useContextAttach.strictmode.test.tsx` (scaffold **D**,
  client). Render the hook under `React.StrictMode` with a `vi.fn()` persist and
  seeded `docs`/`attached`; toggle a path once; assert persist fired exactly once
  with the expected path set. Run `client` `pnpm test` + `pnpm typecheck` green.
- [x] T1  `toggle` computes `next` and calls `doPersist` OUTSIDE the `setLinked` updater (deps `[linked, order, doPersist]`); one toggle → one persist call under `React.StrictMode`   → AC-1  → test_toggle_persists_once_under_strictmode
- [x] T2  Existing `useContextAttach` behavior preserved — attach/detach flips `isAttached`, `attachedPaths` reflects the toggle, and `moveBefore`/`move` still persist once each (no regression from the deps change)   → AC-1  → test_toggle_attach_detach_behavior_unchanged

### Phase 2 — Server: atomic transactional upsert for the spec setters   (parallel-safe)
- **Surface:** server (backend)
- **Skills to apply:** `onion-architecture` (preloaded — change stays inside the repository layer, no leak upward), `drizzle-orm-patterns`, `fastify-best-practices` (route/service untouched; verify the edge still returns the ordered set); `security` (preloaded — concurrent-write integrity).
- **What changes & why:** Rewrite `setAgentSpecs` (71-90) and `setSkillSpecs`
  (150-169) per scaffold **C**: wrap the delete + insert in ONE
  `this.db.transaction(async (tx) => …)`, and add
  `.onConflictDoUpdate({ target: [<owner>, path], set: { order: i, workspaceId } })`
  to the insert (`agentSpecs` → `[agentId, path]`, `skillSpecs` → `[skillId, path]`).
  The upsert is what makes a losing concurrent writer converge instead of raising
  `23505`; the transaction keeps the replace-set atomic. Keep the method signature,
  the `paths.length > 0` guard, `order = index`, and the return via
  `attachedSpecsForAgent`/`attachedSpecsForSkill` unchanged.
- **How to test:** Extend `server/test/project-context-attach.it.test.ts`
  (scaffold **D**, server). Add a concurrency test: fire two identical
  `setAgentSpecs` (and one for `setSkillSpecs`) via `Promise.allSettled` (repo
  directly or via `POST /agents/:id/specs`); assert both settle **fulfilled** (no
  `23505` / no 500) and the final `attachedSpecsForAgent`/DB rows match the
  expected ordered set. Run `server` integration tests + `pnpm typecheck` in WSL.
- [x] T3  `setAgentSpecs` wraps delete+insert in `db.transaction` and upserts via `onConflictDoUpdate({ target:[agentId,path], set:{ order, workspaceId } })` where `set` uses the `excluded` pseudo-row form from scaffold C (`sql\`excluded."order"\`` / `sql\`excluded.workspace_id\``), NOT literal per-row values; two concurrent identical calls both settle without 23505   → AC-2  → test_concurrent_setAgentSpecs_no_duplicate_key
- [x] T4  `setSkillSpecs` wraps delete+insert in `db.transaction` and upserts via `onConflictDoUpdate({ target:[skillId,path], set:{ order, workspaceId } })` where `set` uses the `excluded` pseudo-row form from scaffold C, NOT literal per-row values; two concurrent identical calls both settle without 23505   → AC-2  → test_concurrent_setSkillSpecs_no_duplicate_key
- [x] T5  Both setters preserve semantics — present paths get `order = index`, absent paths are detached, and the fresh ordered set is returned (existing T9 attach/reorder/detach it-test still passes)   → AC-3  → test_setSpecs_semantics_preserved

## Traceability matrix
| AC   | Task   | Test                                              | Commit |
|------|--------|---------------------------------------------------|--------|
| AC-1 | T1     | test_toggle_persists_once_under_strictmode        | —      |
| AC-1 | T2     | test_toggle_attach_detach_behavior_unchanged      | —      |
| AC-2 | T3     | test_concurrent_setAgentSpecs_no_duplicate_key    | —      |
| AC-2 | T4     | test_concurrent_setSkillSpecs_no_duplicate_key    | —      |
| AC-3 | T5     | test_setSpecs_semantics_preserved                 | —      |

## Risks & mitigations
- **Deps-array change reintroduces a stale-closure bug.** Reading `linked`
  directly (vs `prev`) means `toggle` must list `linked` in its deps. Mitigation:
  scaffold **B** already sets deps to `[linked, order, doPersist]`; T2 asserts
  rapid toggles still flip correctly — this is exactly the sibling `SkillsTab`
  shape already in production.
- **`onConflictDoUpdate` mis-targeted.** Using the wrong target columns silently
  disables conflict handling. Mitigation: targets are the actual PKs from
  `project-context.ts` (`[agentId, path]` / `[skillId, path]`), quoted in scaffold
  **C**; T3/T4 fail loudly (23505) if the target is wrong.
- **Concurrency test flakiness.** Two `allSettled` calls may serialize by luck.
  Mitigation: assert the invariant (both fulfilled + correct final set), which
  holds regardless of interleaving; the pre-fix code fails deterministically
  enough (6/6 pairs in live repro) that the test is a meaningful guard.
- **Docker/WSL unavailable → it-tests skip.** Mitigation: the file already guards
  with `d = hasDocker ? describe : describe.skip`; the client StrictMode test
  (T1/T2) runs with no DB, so AC-1 is always covered locally.

## Critical files for implementation
- `client/src/components/context-attach/useContextAttach.ts` (edit `toggle`, 67-78)
- `server/src/modules/project-context/repository.ts` (edit `setAgentSpecs` 71-90, `setSkillSpecs` 150-169)
- `server/test/project-context-attach.it.test.ts` (extend — concurrency it-test)
- `client/src/components/context-attach/useContextAttach.strictmode.test.tsx` (new — StrictMode regression)
- `server/src/db/schema/project-context.ts` (read-only — PK targets for the upsert)

## Open questions / assumptions
- **Assumption:** No schema or migration change is needed — the existing composite
  PKs `(agent_id, path)` / `(skill_id, path)` are exactly what `onConflictDoUpdate`
  targets. (Confirmed against `project-context.ts`; matches the diagnosis.)
- **Assumption:** The client fix (Fix 1) removes the double POST in practice, and
  the server fix (Fix 2) is defense-in-depth for any other concurrent-write source
  (e.g. two tabs, a retry). Both are in scope per the approved diagnosis.
- **Follow-ups / out of scope (no task):** `AgentsRepository.setSkills`
  (`server/src/modules/agents/repository.ts:235-241`) has the identical latent
  non-transactional delete-then-insert shape over `agent_skills`. It is explicitly
  out of scope for this bugfix; flag for a future hardening pass.
